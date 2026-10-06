//! Ferris' Forge — a cozy pixel-art game that teaches Rust.
//!
//! `cargo run`          start the game and open it in your browser
//! `cargo run -- verify` check that every level's starter fails and its solution passes

mod api;
mod levels;
mod nvim;
mod progress;
mod runner;
mod teacher;

use axum::extract::{Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tower_http::services::ServeDir;

const PORT: u16 = 7878;

#[tokio::main]
async fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let worlds = levels::load_worlds(&root.join("levels")).unwrap_or_else(|e| {
        eprintln!("Couldn't load levels: {e}");
        std::process::exit(1);
    });

    let book = levels::Book::load(&root.join("levels").join("book.toml")).unwrap_or_else(|e| {
        eprintln!("Couldn't load the book index: {e}");
        std::process::exit(1);
    });

    if std::env::args().nth(1).as_deref() == Some("verify") {
        // `verify 5` checks only world 5 (coverage is always checked).
        let only: Option<u32> = std::env::args().nth(2).and_then(|a| a.parse().ok());
        let selected: Vec<levels::World> = worlds
            .iter()
            .filter(|w| only.is_none_or(|id| w.id == id))
            .cloned()
            .collect();
        let ok = verify(&root, &selected).await & check_coverage(&book, &worlds);
        std::process::exit(if ok { 0 } else { 1 });
    }

    // FERRIS_SAVE_DIR lets you play (or test) with a separate save folder.
    let save_dir = std::env::var_os("FERRIS_SAVE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("save"));
    std::fs::create_dir_all(save_dir.join("tmp")).expect("can't create save folder");
    let (progress, notice) = progress::Progress::load(&save_dir.join("progress.json"))
        .unwrap_or_else(|e| {
            eprintln!("Couldn't start: {e}");
            std::process::exit(1);
        });
    if let Some(n) = &notice {
        eprintln!("⚠ {n}");
    }

    let state = Arc::new(api::AppState {
        save_dir: save_dir.clone(),
        worlds,
        book,
        progress: Mutex::new(progress),
        usage: Arc::new(Mutex::new(None)),
        save_error: Mutex::new(None),
        notice: Mutex::new(notice),
        rustc: rustc_version().await,
    });
    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", PORT)).await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("can't open a port"),
    };
    let port = listener.local_addr().unwrap().port();
    let key = game_key(&save_dir).unwrap_or_else(|e| {
        eprintln!(
            "Couldn't create the game's key in {}: {e}",
            save_dir.display()
        );
        std::process::exit(1);
    });
    let guard = Arc::new(Guard {
        port,
        key: key.clone(),
    });
    let app = api::router(state)
        .fallback_service(ServeDir::new(root.join("web")))
        .layer(axum::middleware::from_fn_with_state(guard, local_only));
    // The key travels in the #fragment: browsers never send that part to a server.
    let url = format!("http://127.0.0.1:{port}/#key={key}");
    println!("\n  🦀  Ferris' Forge is running at {url}\n      (press Ctrl+C to quit)\n");
    if std::env::var_os("FERRIS_NO_BROWSER").is_none() {
        let _ = open::that(&url);
    }
    axum::serve(listener, app).await.unwrap();
}

/// "1.99.0" from `rustc --version` ("rustc 1.99.0 (b940084d7 2026-09-28)").
async fn rustc_version() -> Option<String> {
    let out = tokio::process::Command::new("rustc")
        .arg("--version")
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.split_whitespace().nth(1).map(str::to_owned)
}

/// The game's secret key, created once and kept in `save/game.key` (readable only by you).
/// The game runs Rust code and Neovim for whoever calls its API, so the API only answers
/// callers that know this key: the page you opened from the link the game printed, not
/// other programs or other users on this computer.
fn game_key(save_dir: &Path) -> std::io::Result<String> {
    use std::io::{Read, Write};
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let path = save_dir.join("game.key");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim();
        if existing.len() == 64 && existing.bytes().all(|b| b.is_ascii_hexdigit()) {
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
            return Ok(existing.to_string());
        }
    }
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    let key: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let _ = std::fs::remove_file(&path);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)?;
    file.write_all(key.as_bytes())?;
    Ok(key)
}

/// Why a request is refused, if it is.
fn refusal(guard: &Guard, req: &Request) -> Option<Response> {
    let port = guard.port;
    let get = |name: &str| {
        req.headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let hosts = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    let host_ok = get("host").is_some_and(|h| hosts.contains(&h));
    let origin = get("origin");
    let origin_ok = origin
        .as_deref()
        .is_none_or(|o| hosts.iter().any(|ok| o == format!("http://{ok}")));
    let path = req.uri().path();
    let is_api = path.starts_with("/api/");
    let is_ws = path == "/api/vim";
    if !host_ok || !origin_ok || (is_ws && origin.is_none()) {
        return Some(
            (
                StatusCode::FORBIDDEN,
                "Ferris' Forge only talks to its own page.",
            )
                .into_response(),
        );
    }
    if is_api {
        let from_query = req.uri().query().and_then(|q| {
            q.split('&')
                .find_map(|pair| pair.strip_prefix("key=").map(str::to_owned))
        });
        let given = get("x-ferris-key").or(if is_ws { from_query } else { None });
        if !given.is_some_and(|k| same_secret(&k, &guard.key)) {
            return Some((
                StatusCode::UNAUTHORIZED,
                axum::Json(serde_json::json!({ "error": "This page doesn't have the game's key. Open the game with the link printed in the terminal where you started it (cargo run)." })),
            )
                .into_response());
        }
    }
    None
}

/// What every request is checked against.
struct Guard {
    port: u16,
    key: String,
}

/// Compare without stopping at the first difference, so timing reveals nothing.
fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

/// Only answer the game's own page.
/// - `Host` must be this server: stops DNS-rebinding tricks.
/// - `Origin`, if sent, must be this server: stops other websites from calling the API.
///   The Neovim WebSocket must send it (browsers always do).
/// - Every `/api/` request must carry the game's key (header `x-ferris-key`, or `?key=`
///   for the WebSocket, where browsers can't add headers). Host and Origin are only
///   browser rules; any program on this computer could fake them, but not the key.
async fn local_only(State(guard): State<Arc<Guard>>, req: Request, next: Next) -> Response {
    if let Some(refusal) = refusal(&guard, &req) {
        return refusal;
    }
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    // Always re-check files with the server. The game's scripts are separate modules,
    // and a cached old copy of one mixed with a new copy of another breaks the page.
    headers.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-cache"),
    );
    // No other page may show the game inside a frame (it could trick you into clicking Run).
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        header::HeaderValue::from_static("frame-ancestors 'none'"),
    );
    headers.insert(
        header::X_FRAME_OPTIONS,
        header::HeaderValue::from_static("DENY"),
    );
    res
}

/// Every topic in the Rust Book must be taught by a level, built or planned.
fn check_coverage(book: &levels::Book, worlds: &[levels::World]) -> bool {
    let cov = levels::coverage(book, worlds);
    let total = cov.built.len() + cov.planned_only.len() + cov.missing.len();
    println!("\nRust Book coverage ({total} topics):");
    println!("  ✓ {} taught by playable levels", cov.built.len());
    println!("  ◷ {} planned (placeholders)", cov.planned_only.len());
    for s in &cov.missing {
        println!("  ✗ {} {} — not covered by any level", s.id, s.title);
    }
    for id in &cov.unknown {
        println!("  ✗ unknown book section \"{id}\" referenced by a level");
    }
    let ok = cov.missing.is_empty() && cov.unknown.is_empty();
    println!(
        "{}",
        if ok {
            "Every book topic is covered."
        } else {
            "Some book topics are not covered."
        }
    );
    ok
}

/// Every starter must fail, every solution must pass, and every predict answer must be true.
async fn verify(root: &Path, worlds: &[levels::World]) -> bool {
    use levels::Kind;
    let work = root.join("save").join("verify");
    std::fs::create_dir_all(&work).unwrap();
    let mut failures = 0;
    for world in worlds {
        println!("World {}: {}", world.id, world.name);
        for level in &world.levels {
            let problem = if level.kind == Kind::Quiz {
                level
                    .answer
                    .is_none_or(|a| a >= level.choices.len())
                    .then(|| "answer index missing or out of range".to_string())
            } else if level.kind == Kind::Predict {
                verify_predict(level, &work).await
            } else {
                let starter = runner::check_level(level, &level.starter, &work).await;
                let solution = runner::check_level(level, &level.solution, &work).await;
                if starter.passed {
                    Some("starter already passes".to_string())
                } else if !solution.passed {
                    Some(format!(
                        "solution fails: {}\n{}\n{}\n{}",
                        solution.summary, solution.compiler, solution.stdout, solution.stderr
                    ))
                } else {
                    None
                }
            };
            match problem {
                None => println!("  ✓ {} {}", level.id, level.title),
                Some(why) => {
                    failures += 1;
                    println!("  ✗ {} {} — {why}", level.id, level.title);
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&work);
    println!(
        "\n{}",
        if failures == 0 {
            "All levels OK.".to_string()
        } else {
            format!("{failures} level(s) broken.")
        }
    );
    failures == 0
}

async fn verify_predict(level: &levels::Level, work: &Path) -> Option<String> {
    if level.answer.is_none_or(|a| a >= level.choices.len()) {
        return Some("answer index missing or out of range".into());
    }
    let ran = runner::play(&level.starter, &runner::Setup::from_level(level), work).await;
    if level.compile_fails {
        return ran
            .compiled
            .then(|| "expected a compile error, but it compiled".into());
    }
    if !ran.compiled {
        return Some(format!("doesn't compile:\n{}", ran.compiler));
    }
    let expected = runner::normalize(level.expected_output.as_deref().unwrap_or(""));
    let got = runner::normalize(&ran.stdout);
    (got != expected).then(|| format!("output was:\n{got}\nexpected:\n{expected}"))
}
