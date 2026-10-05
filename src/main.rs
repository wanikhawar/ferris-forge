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
    });
    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", PORT)).await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("can't open a port"),
    };
    let port = listener.local_addr().unwrap().port();
    let app = api::router(state)
        .fallback_service(ServeDir::new(root.join("web")))
        .layer(axum::middleware::from_fn_with_state(port, local_only));
    let url = format!("http://127.0.0.1:{port}");
    println!("\n  🦀  Ferris' Forge is running at {url}\n      (press Ctrl+C to quit)\n");
    if std::env::var_os("FERRIS_NO_BROWSER").is_none() {
        let _ = open::that(&url);
    }
    axum::serve(listener, app).await.unwrap();
}

/// Only answer the game's own page. The `Host` check stops DNS-rebinding tricks, and the
/// `Origin` check stops other websites from calling the API or the Neovim WebSocket
/// (which would let them type into Neovim, and Neovim can run shell commands).
async fn local_only(State(port): State<u16>, req: Request, next: Next) -> Response {
    let allowed = {
        let hosts = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];
        let get = |name: header::HeaderName| {
            req.headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
        };
        let host_ok = get(header::HOST).is_some_and(|h| hosts.contains(&h));
        let origin_ok =
            get(header::ORIGIN).is_none_or(|o| hosts.iter().any(|ok| o == format!("http://{ok}")));
        host_ok && origin_ok
    };
    if allowed {
        let mut res = next.run(req).await;
        // Always re-check files with the server. The game's scripts are separate modules,
        // and a cached old copy of one mixed with a new copy of another breaks the page.
        res.headers_mut()
            .insert(header::CACHE_CONTROL, header::HeaderValue::from_static("no-cache"));
        res
    } else {
        (
            StatusCode::FORBIDDEN,
            "Ferris' Forge only talks to its own page.",
        )
            .into_response()
    }
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
