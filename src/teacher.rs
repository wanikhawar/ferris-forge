//! Ferris the teacher: talks to Claude through the Claude Code CLI (`claude -p`),
//! so it runs on the player's Claude subscription. No API key needed.

use crate::levels::{Kind, Level, World};
use serde_json::{Value, json};
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc::Sender;

/// The longest a single Ferris reply may take.
const REPLY_DEADLINE: Duration = Duration::from_secs(240);
/// Returned when the browser stopped listening; nothing needs to be shown.
pub const CANCELLED: &str = "cancelled";

/// At most two Claude Code processes at once; more requests wait their turn.
static CLAUDE_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
/// The most of a reply (and of Claude Code's error output) that is kept.
const MAX_REPLY_BYTES: usize = 200_000;
const MAX_STDERR_BYTES: u64 = 16_000;

pub const SYSTEM_PROMPT: &str = r#"You are Ferris, the friendly orange crab who is the mascot of the Rust programming language. You are the mentor inside "Ferris' Forge", a cozy pixel-art game (think Stardew Valley) that teaches Rust from the ground up.

Your student knows Python and C but is not a professional developer. They learn best when a new Rust idea is connected to something they already know, so compare with C (pointers, malloc/free, undefined behaviour, int sizes) or Python (references, garbage collection, exceptions) when it genuinely helps — one short comparison, not both every time.

How you speak:
- Warm, encouraging and a little playful, like a cozy farming-game villager. An occasional crab pun or "🦀" is fine; don't overdo it.
- Your words appear in a small speech bubble, so be brief: usually 40–130 words. Short paragraphs. Use Markdown sparingly: `inline code`, **bold**, short ```rust code blocks``` and simple "- " lists.
- Refer to the student's actual code and line numbers. Be concrete.
- Never claim the code passes or fails — the real compiler and tests decide that. You teach.
- Teach, don't do the work: unless your instructions for this turn say you may show the answer, never write out the corrected solution. Guide with questions and pointers instead.
- If the student asks something unrelated to learning Rust or programming, gently steer back to the adventure.
- Only talk about the current level and what the student has already learned. Don't guess what later levels contain.
- You have no tools. Do not offer to edit files or run commands."#;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Mode {
    Explain,
    Hint(u32),
    Review,
    Chat,
    Quiz,
}

impl Mode {
    pub fn parse(mode: &str, tier: u32) -> Option<Mode> {
        Some(match mode {
            "explain" => Mode::Explain,
            "hint" => Mode::Hint(tier.clamp(1, 3)),
            "review" => Mode::Review,
            "chat" => Mode::Chat,
            "quiz" => Mode::Quiz,
            _ => return None,
        })
    }

    fn instructions(self) -> &'static str {
        match self {
            Mode::Explain => {
                "The student just ran their code and it did not pass. Explain what went wrong in plain English: name the line, say what the compiler (or test) is complaining about and WHY Rust cares. Translate any error code into a simple idea. Do not give the corrected code. End with one guiding question that points them toward the fix."
            }
            Mode::Hint(1) => {
                "The student asked for hint 1 of 3 (a gentle nudge). Give a single Socratic question or observation that points at the right area of the code. Do not name the exact fix. Keep it under 50 words."
            }
            Mode::Hint(2) => {
                "The student asked for hint 2 of 3 (a strong hint). Name the Rust concept involved and point to the exact line(s) to change, and describe what kind of change is needed — but still don't write the final code."
            }
            Mode::Hint(_) => {
                "The student asked for hint 3 of 3 (show the answer). You may now show the fix as a short code snippet, but explain each change so they understand it and could do it themselves next time. Finish with one sentence on the general rule to remember."
            }
            Mode::Review => {
                "The student's code PASSED this level. Celebrate briefly, then review it like a kind senior Rustacean: mention one thing they did well, and one or two ways to make it more idiomatic Rust (if any). If it is already clean and idiomatic, say so. On the very last line, write exactly `VERDICT: idiomatic` if the code is idiomatic Rust for what this level teaches, or `VERDICT: improvable` otherwise."
            }
            Mode::Chat => {
                "The student is asking you a question. Answer it clearly in the context of the current level. If they ask for the solution, encourage them to try once more and offer a hint instead — but if they insist, you may explain the answer."
            }
            Mode::Quiz => {
                "This is a 'predict the output' quiz. The student picked a wrong answer. Without immediately revealing the correct choice, figure out what misunderstanding probably led to their pick, correct that misunderstanding, and nudge them to try again."
            }
        }
    }
}

pub struct Context<'a> {
    pub world: &'a World,
    pub level: &'a Level,
    pub code: &'a str,
    pub output: &'a str,
    pub message: &'a str,
    pub history: &'a [(String, String)],
    pub choice: Option<usize>,
    pub profile: String,
    /// The Rust Book sections this level teaches, e.g. "4.2 References and Borrowing".
    pub book: Vec<String>,
}

fn numbered(code: &str) -> String {
    code.lines()
        .enumerate()
        .map(|(i, l)| format!("{:>3} | {l}\n", i + 1))
        .collect()
}

pub fn build_prompt(mode: Mode, ctx: &Context) -> String {
    let level = ctx.level;
    let mut p = String::new();
    p.push_str(&format!(
        "## Where we are\nWorld {}: {} — Level {} \"{}\" ({:?} level)\nGoal: {}\n",
        ctx.world.id, ctx.world.name, level.id, level.title, level.kind, level.goal
    ));
    if !ctx.book.is_empty() {
        p.push_str(&format!(
            "The game follows \"The Rust Programming Language\" (Brown University's interactive edition). This level teaches: {}. You may point the student to those sections.\n",
            ctx.book.join("; ")
        ));
    }
    if !level.lesson.is_empty() {
        p.push_str(&format!(
            "\n## The lesson they just read\n{}\n",
            level.lesson.trim()
        ));
    }
    p.push_str(&format!("\n## About the student\n{}\n", ctx.profile));

    if matches!(level.kind, Kind::Predict | Kind::Quiz) {
        p.push_str(&format!(
            "\n## Code to read\n```rust\n{}```\n## Choices\n",
            numbered(&level.starter)
        ));
        for (i, c) in level.choices.iter().enumerate() {
            p.push_str(&format!("{}. {c}\n", i + 1));
        }
        if let Some(i) = ctx.choice {
            p.push_str(&format!(
                "\nThe student picked: {}. {}\n",
                i + 1,
                level.choices.get(i).map(String::as_str).unwrap_or("?")
            ));
        }
        if let Some(ans) = level.answer {
            p.push_str(&format!(
                "(For you only, don't reveal unless appropriate: the correct choice is {}. Why: {})\n",
                ans + 1,
                level.explanation
            ));
        }
    } else {
        p.push_str(&format!(
            "\n## The student's current code (main.rs)\n```rust\n{}```\n",
            numbered(ctx.code)
        ));
        if let Some(tests) = &level.tests {
            p.push_str(&format!(
                "\n## The tests the game runs against it\n```rust\n{tests}\n```\n"
            ));
        }
        if let Some(expected) = &level.expected_output {
            p.push_str(&format!(
                "\n## Expected program output\n```\n{expected}\n```\n"
            ));
        }
        let output = ctx.output.trim();
        if !output.is_empty() {
            let clipped: String = output.chars().take(6000).collect();
            p.push_str(&format!(
                "\n## Latest result from the compiler / program\n```\n{clipped}\n```\n"
            ));
        }
        if matches!(mode, Mode::Hint(3) | Mode::Review) && !level.solution.is_empty() {
            p.push_str(&format!(
                "\n## Reference solution (for you)\n```rust\n{}\n```\n",
                level.solution.trim()
            ));
        }
    }

    if !ctx.history.is_empty() {
        p.push_str("\n## Recent conversation on this level\n");
        for (role, text) in ctx.history.iter().rev().take(8).rev() {
            let who = if role == "user" { "Student" } else { "Ferris" };
            let clipped: String = text.chars().take(1200).collect();
            p.push_str(&format!("{who}: {clipped}\n"));
        }
    }

    p.push_str(&format!("\n## Your task now\n{}\n", mode.instructions()));
    if !ctx.message.trim().is_empty() {
        p.push_str(&format!("\nThe student says: \"{}\"\n", ctx.message.trim()));
    }
    p
}

/// Turns Claude Code's rate-limit event into a small "energy" summary for the HUD.
fn usage_from(event: &Value) -> Option<Value> {
    let info = event.get("rate_limit_info")?;
    let windows = info.get("unifiedWindows");
    let get = |name: &str, field: &str| {
        windows
            .and_then(|w| w.get(name))
            .and_then(|w| w.get(field))
            .cloned()
    };
    Some(json!({
        "type": "usage",
        "status": info.get("status"),
        "five_hour": get("five_hour", "utilization"),
        "five_hour_resets": get("five_hour", "resetsAt"),
        "seven_day": get("seven_day", "utilization"),
        "seven_day_resets": get("seven_day", "resetsAt"),
    }))
}

/// A finished reply, and the exact model Claude Code used for it (if it said).
pub struct Reply {
    pub text: String,
    pub model: Option<String>,
}

/// Run one Ferris reply. Streams `{"type":"delta"}` events to `tx` and returns the full text.
pub async fn ask(
    prompt: String,
    model: &str,
    effort: &str,
    workdir: &Path,
    tx: &Sender<Value>,
    usage: &Arc<Mutex<Option<Value>>>,
) -> Result<Reply, String> {
    std::fs::create_dir_all(workdir).map_err(|e| e.to_string())?;
    // One deadline for the whole reply, from waiting for a free slot to the last line.
    let deadline = tokio::time::Instant::now() + REPLY_DEADLINE;
    let too_slow = || {
        format!(
            "Claude took longer than {} minutes, so I stopped it. Try again, or pick a faster model.",
            REPLY_DEADLINE.as_secs() / 60
        )
    };
    let _slot = tokio::select! {
        slot = CLAUDE_SLOTS.acquire() => slot.expect("semaphore is never closed"),
        _ = tokio::time::sleep_until(deadline) => return Err(too_slow()),
        _ = tx.closed() => return Err(CANCELLED.into()),
    };
    let mut child = Command::new("claude")
        .arg("-p")
        .args(["--model", model])
        .args(["--effort", effort])
        .args(["--tools", ""])
        .arg("--strict-mcp-config")
        .args(["--setting-sources", ""])
        .args(["--system-prompt", SYSTEM_PROMPT])
        .args(["--output-format", "stream-json"])
        .arg("--include-partial-messages")
        .arg("--verbose")
        .arg("--no-session-persistence")
        .current_dir(workdir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "I can't find the `claude` command. Is Claude Code installed? You can switch me to offline mode in Settings.".to_string()
            } else {
                format!("Couldn't start Claude Code: {e}")
            }
        })?;

    // Write the prompt in the background, so the deadline and "nobody is listening"
    // checks below also cover a Claude Code that doesn't read it. Killing the process
    // ends the write too.
    let mut stdin = child.stdin.take().expect("stdin is piped");
    tokio::spawn(async move {
        let _ = stdin.write_all(prompt.as_bytes()).await;
    });

    // Keep the start of the error output (for messages) and throw the rest away, so a
    // chatty process can neither fill memory nor block on a full pipe.
    let stderr = child.stderr.take().expect("stderr is piped");
    let stderr_task = tokio::spawn(async move {
        let mut stderr = stderr;
        let mut s = String::new();
        let _ = (&mut stderr)
            .take(MAX_STDERR_BYTES)
            .read_to_string(&mut s)
            .await;
        let _ = tokio::io::copy(&mut stderr, &mut tokio::io::sink()).await;
        s
    });

    let mut lines = BufReader::new(child.stdout.take().expect("stdout is piped")).lines();
    let mut text = String::new();
    let mut model = None;
    let mut final_result: Option<(bool, String)> = None;

    // Stop Claude if it runs too long, or as soon as nobody is listening any more
    // (the player left the page). Dropping `child` kills the process.
    loop {
        let line = tokio::select! {
            line = lines.next_line() => line,
            _ = tokio::time::sleep_until(deadline) => return Err(too_slow()),
            _ = tx.closed() => return Err(CANCELLED.into()),
        };
        let Ok(Some(line)) = line else { break };
        let Ok(event) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match event.get("type").and_then(Value::as_str) {
            Some("stream_event") => {
                let inner = &event["event"];
                match inner["type"].as_str() {
                    Some("message_start") => {
                        if let Some(m) = inner["message"]["model"].as_str() {
                            model = Some(m.to_string());
                            let _ = tx.send(json!({"type": "model", "model": m})).await;
                        }
                    }
                    Some("content_block_delta") if inner["delta"]["type"] == "text_delta" => {
                        if let Some(t) = inner["delta"]["text"].as_str() {
                            if text.len() + t.len() > MAX_REPLY_BYTES {
                                return Err(
                                    "Claude's reply was far too long, so I stopped it.".into()
                                );
                            }
                            text.push_str(t);
                            if tx.send(json!({"type": "delta", "text": t})).await.is_err() {
                                return Err(CANCELLED.into());
                            }
                        }
                    }
                    _ => {}
                }
            }
            Some("rate_limit_event") => {
                if let Some(u) = usage_from(&event) {
                    *usage.lock().unwrap() = Some(u.clone());
                    let _ = tx.send(u).await;
                }
            }
            Some("result") => {
                let is_error = event["is_error"].as_bool().unwrap_or(false);
                let result = event["result"].as_str().unwrap_or_default().to_string();
                final_result = Some((is_error, result));
            }
            _ => {}
        }
    }

    let status = match tokio::time::timeout(Duration::from_secs(10), child.wait()).await {
        Ok(status) => status.map_err(|e| e.to_string())?,
        Err(_) => return Err("Claude Code didn't exit after answering.".into()),
    };
    let stderr_text = tokio::time::timeout(Duration::from_secs(2), stderr_task)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
    match final_result {
        Some((false, result)) => Ok(Reply {
            text: if text.is_empty() { result } else { text },
            model,
        }),
        Some((true, result)) => Err(result),
        None if !text.is_empty() => Ok(Reply { text, model }),
        None => {
            let detail: String = stderr_text.trim().chars().take(400).collect();
            Err(format!(
                "Claude Code stopped without answering (exit {}). {}",
                status.code().map(|c| c.to_string()).unwrap_or("?".into()),
                if detail.is_empty() {
                    "Are you logged in? Try running `claude` once in a terminal.".into()
                } else {
                    detail
                }
            ))
        }
    }
}

/// Send a tiny prompt to check that a model works with the player's account.
pub async fn test_model(
    model: &str,
    effort: &str,
    workdir: &Path,
    usage: &Arc<Mutex<Option<Value>>>,
) -> Result<(String, String), String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Value>(256);
    let prompt = "In one short cheerful sentence (max 12 words), say you're ready to teach Rust."
        .to_string();
    // Nobody reads the streamed events here; drain them so `ask` never waits.
    let drain = tokio::spawn(async move { while rx.recv().await.is_some() {} });
    let reply = ask(prompt, model, effort, workdir, &tx, usage).await;
    drop(tx);
    let _ = drain.await;
    reply.map(|r| (r.model.unwrap_or_else(|| model.to_string()), r.text))
}
