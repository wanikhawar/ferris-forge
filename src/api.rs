//! HTTP API used by the browser UI.

use crate::levels::{Book, Kind, Level, World};
use crate::progress::{Completion, Progress, Settings, today};
use crate::runner;
use crate::teacher::{self, Mode};
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::ReceiverStream;

pub const REVIEW_BONUS_XP: u32 = 15;
const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

pub struct AppState {
    /// Where progress and scratch files live (`save/`, or `FERRIS_SAVE_DIR`).
    pub save_dir: PathBuf,
    pub worlds: Vec<World>,
    pub book: Book,
    pub progress: Mutex<Progress>,
    pub usage: Arc<Mutex<Option<Value>>>,
    /// Set when the last save failed (shown in the game), cleared when a save works again.
    pub save_error: Mutex<Option<String>>,
    /// A one-time message from startup, e.g. that a damaged save was backed up.
    pub notice: Mutex<Option<String>>,
}

type Shared = Arc<AppState>;

impl AppState {
    fn save_path(&self) -> PathBuf {
        self.save_dir.join("progress.json")
    }
    fn work_dir(&self) -> PathBuf {
        self.save_dir.join("tmp")
    }
    fn ferris_dir(&self) -> PathBuf {
        self.save_dir.join("ferris")
    }
    fn save(&self, progress: &Progress) {
        let result = progress.save(&self.save_path());
        if let Err(e) = &result {
            eprintln!("⚠ Saving failed: {e}");
        }
        *self.save_error.lock().unwrap() = result.err();
    }
    fn level(&self, id: &str) -> Result<(&World, usize, &Level), ApiError> {
        World::find(&self.worlds, id)
            .ok_or(ApiError(StatusCode::NOT_FOUND, format!("no level {id}")))
    }

    /// Find a level the player is allowed to play right now.
    fn playable(&self, id: &str) -> Result<(&World, usize, &Level), ApiError> {
        let (world, li, level) = self.level(id)?;
        let wi = self
            .worlds
            .iter()
            .position(|w| w.id == world.id)
            .unwrap_or(0);
        let p = self.progress.lock().unwrap();
        if !self.level_unlocked(&p, wi, li) && !p.is_done(id) {
            return Err(ApiError(
                StatusCode::FORBIDDEN,
                "That level is still locked.".into(),
            ));
        }
        Ok((world, li, level))
    }

    fn world_unlocked(&self, p: &Progress, idx: usize) -> bool {
        idx == 0
            || self.worlds[idx - 1]
                .levels
                .last()
                .is_some_and(|l| p.has_reached(&l.id))
    }

    fn level_unlocked(&self, p: &Progress, world_idx: usize, level_idx: usize) -> bool {
        self.world_unlocked(p, world_idx)
            && (level_idx == 0 || p.has_reached(&self.worlds[world_idx].levels[level_idx - 1].id))
    }

    /// The first unfinished level that is open to play.
    fn next_level(&self, p: &Progress) -> Option<String> {
        for (wi, w) in self.worlds.iter().enumerate() {
            for (li, l) in w.levels.iter().enumerate() {
                if !p.is_done(&l.id) && self.level_unlocked(p, wi, li) {
                    return Some(l.id.clone());
                }
            }
        }
        None
    }

    fn level_after(&self, id: &str) -> Option<String> {
        let all: Vec<&Level> = self.worlds.iter().flat_map(|w| &w.levels).collect();
        let i = all.iter().position(|l| l.id == id)?;
        all.get(i + 1).map(|l| l.id.clone())
    }

    /// Bonus XP for idiomatic code, once per finished level.
    fn award_review_bonus(&self, level_id: &str) -> bool {
        let mut p = self.progress.lock().unwrap();
        if !p.completed.contains_key(level_id) || !p.review_bonus.insert(level_id.to_string()) {
            return false;
        }
        p.xp += REVIEW_BONUS_XP;
        if let Some(c) = p.completed.get_mut(level_id) {
            c.xp += REVIEW_BONUS_XP;
        }
        self.save(&p);
        true
    }

    fn player(&self, p: &Progress) -> Value {
        let (rank, next) = p.rank();
        let total: usize = self.worlds.iter().map(|w| w.levels.len()).sum();
        json!({
            "name": p.name,
            "xp": p.xp,
            "rank": rank,
            "next_rank": next.map(|(xp, name)| json!({"xp": xp, "name": name})),
            "streak": p.streak(),
            "days": p.days_played.len(),
            "completed": p.completed.len(),
            "total_levels": total,
            "save_error": *self.save_error.lock().unwrap(),
        })
    }
}

pub struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

pub fn router(state: Shared) -> Router {
    Router::new()
        .route("/api/state", get(get_state))
        .route("/api/level/{id}", get(get_level))
        .route("/api/run", post(run_level))
        .route("/api/play", post(play))
        .route("/api/quiz", post(quiz))
        .route("/api/skip", post(skip))
        .route("/api/replay", post(replay))
        .route("/api/draft", post(save_draft))
        .route("/api/name", post(set_name))
        .route("/api/settings", post(set_settings))
        .route("/api/models", get(models))
        .route("/api/models/test", post(test_model))
        .route("/api/explain/{code}", get(explain))
        .route("/api/ferris", post(ferris))
        .route("/api/vim", get(crate::nvim::vim_ws))
        .with_state(state)
}

async fn get_state(State(s): State<Shared>) -> Json<Value> {
    let p = s.progress.lock().unwrap();
    let worlds: Vec<Value> = s
        .worlds
        .iter()
        .enumerate()
        .map(|(wi, w)| {
            let levels: Vec<Value> = w
                .levels
                .iter()
                .enumerate()
                .map(|(li, l)| {
                    let status = if p.completed.contains_key(&l.id) {
                        "done"
                    } else if p.skipped.contains(&l.id) {
                        "skipped"
                    } else if s.level_unlocked(&p, wi, li) {
                        "open"
                    } else {
                        "locked"
                    };
                    json!({
                        "id": l.id, "title": l.title, "kind": l.kind, "xp": l.xp, "status": status,
                        "earned": p.completed.get(&l.id).map(|c| c.xp),
                    })
                })
                .collect();
            let done = w.levels.iter().filter(|l| p.is_done(&l.id)).count();
            let planned: Vec<Value> = w
                .planned
                .iter()
                .map(|pl| json!({"title": pl.title, "kind": pl.kind, "about": pl.about, "book": s.book.labels(&pl.book)}))
                .collect();
            json!({
                "id": w.id, "name": w.name, "blurb": w.blurb, "tag": w.tag,
                "available": !w.levels.is_empty(),
                "unlocked": !w.levels.is_empty() && s.world_unlocked(&p, wi),
                "done": done, "levels": levels, "planned": planned,
                "chapters": world_chapters(&s.book, w),
            })
        })
        .collect();
    let codex: Vec<Value> = p
        .codex
        .iter()
        .map(|(code, e)| json!({"code": code, "count": e.count, "first_level": e.first_level}))
        .collect();
    Json(json!({
        "player": s.player(&p),
        "settings": p.settings,
        "usage": *s.usage.lock().unwrap(),
        "worlds": worlds,
        "codex": codex,
        "next_level": s.next_level(&p),
        "notice": s.notice.lock().unwrap().take(),
    }))
}

/// The book chapters a world covers, e.g. ["Ch 4: Understanding Ownership"].
fn world_chapters(book: &Book, w: &World) -> Vec<String> {
    let mut chapters: Vec<String> = Vec::new();
    let ids = w
        .levels
        .iter()
        .flat_map(|l| &l.book)
        .chain(w.planned.iter().flat_map(|p| &p.book));
    for id in ids {
        let chapter = id.split('.').next().unwrap_or(id);
        let label = match book.get(chapter) {
            Some(s) if chapter.chars().all(|c| c.is_ascii_digit()) => {
                format!("Ch {chapter}: {}", s.title)
            }
            _ => "Appendices".to_string(),
        };
        if !chapters.contains(&label) {
            chapters.push(label);
        }
    }
    chapters
}

/// Book links for a level: id, title and URL of each section it teaches.
fn book_links(book: &Book, ids: &[String]) -> Vec<Value> {
    ids.iter()
        .filter_map(|id| book.get(id))
        .map(|sec| json!({"id": sec.id, "title": sec.title, "url": book.url(sec)}))
        .collect()
}

async fn get_level(
    State(s): State<Shared>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (world, li, level) = s.playable(&id)?;
    let p = s.progress.lock().unwrap();
    let done = p.completed.contains_key(&id);
    Ok(Json(json!({
        "id": level.id, "title": level.title, "kind": level.kind, "goal": level.goal,
        "lesson": level.lesson, "c_compare": level.c_compare, "py_compare": level.py_compare,
        "starter": level.starter,
        "code": p.drafts.get(&id).cloned().unwrap_or_else(|| level.starter.clone()),
        "check": level.check, "expected_output": level.expected_output, "tests": level.tests,
        "choices": level.choices, "xp": level.xp,
        "hint_count": level.hints.len().max(3), "hint_tier": p.hint_tier.get(&id).copied().unwrap_or(0),
        "done": done, "skipped": p.skipped.contains(&id),
        "explanation": if done { level.explanation.clone() } else { String::new() },
        "world": {"id": world.id, "name": world.name},
        "index": li + 1, "count": world.levels.len(),
        "next_id": s.level_after(&id),
        "book": book_links(&s.book, &level.book),
    })))
}

#[derive(Deserialize)]
struct CodeReq {
    id: String,
    code: String,
}

async fn run_level(
    State(s): State<Shared>,
    Json(req): Json<CodeReq>,
) -> Result<Json<Value>, ApiError> {
    let (world, li, level) = s.playable(&req.id)?;
    if level.kind == Kind::Predict {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Predict levels are answered, not run.".into(),
        ));
    }
    // Save the submitted code *before* compiling. Edits the player makes while it compiles
    // are autosaved afterwards and must win, so the result below never touches the draft.
    {
        let mut p = s.progress.lock().unwrap();
        p.drafts.insert(req.id.clone(), req.code.clone());
        s.save(&p);
    }
    let result = runner::check_level(level, &req.code, &s.work_dir()).await;

    let mut p = s.progress.lock().unwrap();
    p.days_played.insert(today());
    p.record_errors(&req.id, &result.error_codes);
    let first_clear = result.passed && !p.completed.contains_key(&req.id);
    let mut xp_gained = 0;
    if !p.completed.contains_key(&req.id) {
        *p.attempts.entry(req.id.clone()).or_default() += 1;
    }
    if first_clear {
        xp_gained = p.xp_for(&req.id, level.xp);
        p.xp += xp_gained;
        let completion = Completion {
            xp: xp_gained,
            hints_used: p.hint_tier.get(&req.id).copied().unwrap_or(0),
            attempts: p.attempts.get(&req.id).copied().unwrap_or(1),
        };
        p.completed.insert(req.id.clone(), completion);
        p.skipped.remove(&req.id);
        p.reached.insert(req.id.clone());
    }
    let world_cleared = first_clear && li + 1 == world.levels.len();
    s.save(&p);
    Ok(Json(json!({
        "result": result, "xp_gained": xp_gained, "first_clear": first_clear,
        "world_cleared": world_cleared, "player": s.player(&p), "next_id": s.level_after(&req.id),
    })))
}

#[derive(Deserialize)]
struct PlayReq {
    code: String,
}

async fn play(State(s): State<Shared>, Json(req): Json<PlayReq>) -> Json<Value> {
    Json(json!(runner::play(&req.code, &s.work_dir()).await))
}

#[derive(Deserialize)]
struct QuizReq {
    id: String,
    choice: usize,
}

async fn quiz(State(s): State<Shared>, Json(req): Json<QuizReq>) -> Result<Json<Value>, ApiError> {
    let (world, li, level) = s.playable(&req.id)?;
    let correct = level.answer == Some(req.choice);
    let mut p = s.progress.lock().unwrap();
    p.days_played.insert(today());
    let mut xp_gained = 0;
    let first_clear = correct && !p.completed.contains_key(&req.id);
    if first_clear {
        let wrong = p.wrong_guesses.get(&req.id).copied().unwrap_or(0);
        let base = if wrong == 0 { level.xp } else { level.xp / 2 };
        xp_gained = p.xp_for(&req.id, base);
        p.xp += xp_gained;
        let completion = Completion {
            xp: xp_gained,
            hints_used: p.hint_tier.get(&req.id).copied().unwrap_or(0),
            attempts: wrong + 1,
        };
        p.completed.insert(req.id.clone(), completion);
        p.skipped.remove(&req.id);
        p.reached.insert(req.id.clone());
    } else if !correct && !p.completed.contains_key(&req.id) {
        *p.wrong_guesses.entry(req.id.clone()).or_default() += 1;
        *p.attempts.entry(req.id.clone()).or_default() += 1;
    }
    s.save(&p);
    Ok(Json(json!({
        "correct": correct,
        "explanation": if correct { level.explanation.clone() } else { String::new() },
        "xp_gained": xp_gained, "first_clear": first_clear,
        "world_cleared": first_clear && li + 1 == world.levels.len(),
        "player": s.player(&p), "next_id": s.level_after(&req.id),
    })))
}

#[derive(Deserialize)]
struct IdReq {
    id: String,
}

async fn skip(State(s): State<Shared>, Json(req): Json<IdReq>) -> Result<Json<Value>, ApiError> {
    let (_, _, level) = s.playable(&req.id)?;
    if level.kind == Kind::Boss {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Bosses can't be skipped — you've got this!".into(),
        ));
    }
    let mut p = s.progress.lock().unwrap();
    if !p.completed.contains_key(&req.id) {
        p.skipped.insert(req.id.clone());
        p.reached.insert(req.id.clone());
    }
    s.save(&p);
    Ok(Json(json!({ "next_id": s.level_after(&req.id) })))
}

/// Play a level again from scratch (its XP is taken back and can be earned again).
async fn replay(State(s): State<Shared>, Json(req): Json<IdReq>) -> Result<Json<Value>, ApiError> {
    s.playable(&req.id)?;
    let mut p = s.progress.lock().unwrap();
    let xp_returned = p.replay(&req.id);
    s.save(&p);
    Ok(Json(
        json!({ "xp_returned": xp_returned, "player": s.player(&p) }),
    ))
}

/// Autosave. Fails loudly (500) when the save file can't be written, so the page can say so.
async fn save_draft(
    State(s): State<Shared>,
    Json(req): Json<CodeReq>,
) -> Result<StatusCode, ApiError> {
    let mut p = s.progress.lock().unwrap();
    p.drafts.insert(req.id, req.code);
    s.save(&p);
    match s.save_error.lock().unwrap().clone() {
        Some(e) => Err(ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Couldn't save: {e}"),
        )),
        None => Ok(StatusCode::NO_CONTENT),
    }
}

#[derive(Deserialize)]
struct NameReq {
    name: String,
}

async fn set_name(State(s): State<Shared>, Json(req): Json<NameReq>) -> StatusCode {
    let mut p = s.progress.lock().unwrap();
    p.name = req.name.trim().chars().take(24).collect();
    s.save(&p);
    StatusCode::NO_CONTENT
}

async fn set_settings(
    State(s): State<Shared>,
    Json(new): Json<Settings>,
) -> Result<Json<Settings>, ApiError> {
    if !EFFORTS.contains(&new.effort.as_str()) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "unknown effort level".into(),
        ));
    }
    if !["claude_code", "offline"].contains(&new.teacher.as_str()) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "unknown teacher mode".into(),
        ));
    }
    let model = new.model.trim();
    if model.is_empty()
        || model.len() > 80
        || !model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.[]".contains(c))
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "that doesn't look like a model name".into(),
        ));
    }
    let mut p = s.progress.lock().unwrap();
    p.settings = Settings {
        model: model.to_string(),
        ..new
    };
    s.save(&p);
    Ok(Json(p.settings.clone()))
}

async fn models() -> Json<Value> {
    Json(json!([
        {"id": "fable", "name": "Claude Fable 5.1", "tag": "Wizard", "blurb": "The most capable model. Deepest explanations, slowest replies, uses the most of your plan's limits."},
        {"id": "opus", "name": "Claude Opus 5.5", "tag": "Sage", "blurb": "Excellent teacher. Thoughtful and clear — the recommended default."},
        {"id": "sonnet", "name": "Claude Sonnet 5.5", "tag": "Ranger", "blurb": "Fast and smart. A great everyday choice that's lighter on your limits."},
        {"id": "haiku", "name": "Claude Haiku 4.5", "tag": "Sprite", "blurb": "The quickest replies and the lightest on your limits. Best for quick hints."},
    ]))
}

#[derive(Deserialize)]
struct TestReq {
    model: String,
    effort: String,
}

async fn test_model(State(s): State<Shared>, Json(req): Json<TestReq>) -> Json<Value> {
    let effort = if EFFORTS.contains(&req.effort.as_str()) {
        req.effort.as_str()
    } else {
        "low"
    };
    match teacher::test_model(&req.model, effort, &s.ferris_dir(), &s.usage).await {
        Ok((model, reply)) => Json(json!({"ok": true, "model": model, "reply": reply})),
        Err(e) => Json(json!({"ok": false, "error": e})),
    }
}

async fn explain(Path(code): Path<String>) -> Json<Value> {
    Json(json!({ "code": code, "text": runner::explain(&code).await }))
}

#[derive(Deserialize)]
struct FerrisReq {
    id: String,
    mode: String,
    #[serde(default)]
    code: String,
    #[serde(default)]
    output: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    history: Vec<(String, String)>,
    #[serde(default)]
    choice: Option<usize>,
}

/// Streams Ferris' reply as newline-delimited JSON events.
async fn ferris(State(s): State<Shared>, Json(req): Json<FerrisReq>) -> Result<Response, ApiError> {
    let (world, _, level) = s.playable(&req.id)?;
    let (world, level) = (world.clone(), level.clone());

    // Hints cost XP, so the server keeps track of the tier.
    let (mode, settings, profile) = {
        let mut p = s.progress.lock().unwrap();
        let tier = if req.mode == "hint" {
            let t = p.hint_tier.entry(req.id.clone()).or_default();
            *t = (*t + 1).min(3);
            *t
        } else {
            0
        };
        let mode = Mode::parse(&req.mode, tier)
            .ok_or(ApiError(StatusCode::BAD_REQUEST, "unknown mode".into()))?;
        s.save(&p);
        (mode, p.settings.clone(), p.learner_profile())
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<Value>(512);
    let state = s.clone();
    tokio::spawn(async move {
        if let Mode::Hint(tier) = mode {
            let _ = tx.send(json!({"type": "hint_tier", "tier": tier})).await;
        }
        let ctx = teacher::Context {
            world: &world,
            level: &level,
            code: &req.code,
            output: &req.output,
            message: &req.message,
            history: &req.history,
            choice: req.choice,
            profile,
            book: state.book.labels(&level.book),
        };

        let reply = if settings.teacher == "offline" {
            Err(None)
        } else {
            let prompt = teacher::build_prompt(mode, &ctx);
            teacher::ask(
                prompt,
                &settings.model,
                &settings.effort,
                &state.ferris_dir(),
                &tx,
                &state.usage,
            )
            .await
            .map_err(Some)
        };

        match reply {
            Ok(text) => {
                if mode == Mode::Review
                    && verdict_is_idiomatic(&text)
                    && state.award_review_bonus(&level.id)
                {
                    let _ = tx
                        .send(json!({"type": "bonus", "xp": REVIEW_BONUS_XP}))
                        .await;
                }
            }
            Err(Some(message)) if message == teacher::CANCELLED => {}
            Err(err) => {
                if let Some(message) = err {
                    let _ = tx.send(json!({"type": "error", "message": message})).await;
                }
                let _ = tx.send(json!({"type": "offline"})).await;
                let text = offline_reply(mode, &ctx);
                let _ = tx.send(json!({"type": "delta", "text": text})).await;
            }
        }
        let _ = tx.send(json!({"type": "done"})).await;
    });

    let stream = ReceiverStream::new(rx).map(|v| Ok::<_, std::io::Error>(format!("{v}\n")));
    Ok(Response::builder()
        .header("content-type", "application/x-ndjson")
        .header("cache-control", "no-cache")
        .body(Body::from_stream(stream))
        .unwrap())
}

/// Reads the `VERDICT: idiomatic|improvable` line at the end of a code review.
fn verdict_is_idiomatic(text: &str) -> bool {
    text.rfind("VERDICT")
        .map(|i| text[i..].to_lowercase())
        .is_some_and(|rest| rest.contains("idiomatic") && !rest.contains("improvable"))
}

/// What Ferris says without Claude: built-in hints and error notes.
fn offline_reply(mode: Mode, ctx: &teacher::Context) -> String {
    let level = ctx.level;
    match mode {
        Mode::Hint(tier) => {
            let i = tier as usize - 1;
            match level.hints.get(i) {
                Some(h) => h.clone(),
                None if !level.solution.is_empty() => {
                    format!("Here's one way to solve it:\n```rust\n{}\n```", level.solution.trim())
                }
                None => level.hints.last().cloned().unwrap_or_else(|| "Read the goal once more, slowly. 🦀".into()),
            }
        }
        Mode::Explain => explain_offline(ctx.output),
        Mode::Review => {
            if level.solution.is_empty() {
                "Nicely done! 🎉 (I'm in offline mode, so no detailed review this time.)".into()
            } else {
                format!(
                    "Nicely done! 🎉 I'm in offline mode, so compare your code with my version:\n```rust\n{}\n```",
                    level.solution.trim()
                )
            }
        }
        Mode::Chat => "I'm in **offline mode** right now, so I can't chat. Try a hint (💡) — or switch my brain back on in Settings ⚙.".into(),
        Mode::Quiz => "Not quite! Read the code once more, line by line, and ask: *who owns each value, and when does each line run?* Then try again.".into(),
    }
}

fn explain_offline(output: &str) -> String {
    const NOTES: &[(&str, &str)] = &[
        (
            "E0382",
            "**Use after move.** A value was moved to a new owner, and then the old name was used again. In C this would be a use-after-free waiting to happen; Rust stops it at compile time. Try `.clone()` or (later) borrowing with `&`.",
        ),
        (
            "E0384",
            "**Assigning twice to an immutable variable.** Rust variables can't change unless you say so: `let mut x`.",
        ),
        (
            "E0308",
            "**Mismatched types.** Rust expected one type and got another. Check what each side should be — and watch for a stray `;` at the end of a function, which turns the value into `()`.",
        ),
        (
            "E0425",
            "**Unknown name.** You used a variable or function that doesn't exist here. Check spelling and scope — a name declared inside `{ }` disappears at the `}`.",
        ),
        (
            "E0423",
            "**Expected a function, found a macro.** Macros like `println!` need a `!` after their name.",
        ),
        (
            "E0277",
            "**A trait is missing.** Often this means mixing types, e.g. `i32 * f64`. Rust never converts numbers silently — use `as f64`.",
        ),
        (
            "E0502",
            "**Borrow conflict.** You can't borrow something mutably while it's also borrowed immutably.",
        ),
        (
            "E0499",
            "**Two mutable borrows at once.** Only one `&mut` can exist at a time.",
        ),
        (
            "E0596",
            "**Borrowing as mutable something that isn't `mut`.** Add `mut` where the variable is declared.",
        ),
        (
            "E0599",
            "**No such method.** That type doesn't have a method with this name. Check the spelling and the type.",
        ),
    ];
    let mut out = String::from("I'm in offline mode, but here's what I can tell you:\n\n");
    let mut found = false;
    for (code, note) in NOTES {
        if output.contains(&format!("[{code}]")) {
            out.push_str(&format!("- `{code}` — {note}\n"));
            found = true;
        }
    }
    if !found {
        let first = output
            .lines()
            .find(|l| l.starts_with("error") || l.contains("panicked") || l.contains("FAILED"))
            .unwrap_or("Compare your output with the expected output, line by line.");
        out.push_str(&format!("Start with the **first** problem:\n```\n{first}\n```\nThe `-->` line tells you the line number."));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::verdict_is_idiomatic;

    #[test]
    fn reads_the_review_verdict() {
        assert!(verdict_is_idiomatic("Nice!\n\nVERDICT: idiomatic"));
        assert!(verdict_is_idiomatic("Nice!\n---\n**VERDICT: idiomatic**"));
        assert!(!verdict_is_idiomatic("Close.\nVERDICT: improvable"));
        assert!(!verdict_is_idiomatic(
            "No verdict at all, but idiomatic code"
        ));
    }
}
