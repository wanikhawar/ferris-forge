//! Compiles and runs the player's code with the real `rustc`.

use crate::levels::{Check, Level};
use regex::Regex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::{Notify, Semaphore};

const COMPILE_TIMEOUT: Duration = Duration::from_secs(60);
const RUN_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_OUTPUT: usize = 64_000;
/// At most two compiles/runs at once, so spamming Run can't overload the machine.
static RUN_SLOTS: Semaphore = Semaphore::const_new(2);

static RUN_COUNTER: AtomicU64 = AtomicU64::new(0);
static ERROR_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"error\[(E\d{4})\]").unwrap());

#[derive(Debug, Default, Serialize, Clone)]
pub struct RunResult {
    pub compiled: bool,
    pub passed: bool,
    pub timed_out: bool,
    /// Compiler messages (errors and warnings).
    pub compiler: String,
    /// What the program (or the test harness) printed.
    pub stdout: String,
    pub stderr: String,
    pub error_codes: Vec<String>,
    /// One-line summary for the UI.
    pub summary: String,
}

/// A scratch directory that is deleted when dropped.
struct Scratch(PathBuf);

impl Scratch {
    fn new(work: &Path) -> std::io::Result<Self> {
        let n = RUN_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = work.join(format!("run-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir)?;
        Ok(Scratch(dir))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn truncate(mut s: String) -> String {
    if s.len() > MAX_OUTPUT {
        let mut cut = MAX_OUTPUT;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s.truncate(cut);
        s.push_str("\n… (output cut off)");
    }
    s
}

/// Trailing spaces and trailing blank lines don't count when comparing output.
pub fn normalize(s: &str) -> String {
    s.lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim_end()
        .to_string()
}

struct Compiled {
    ok: bool,
    messages: String,
    binary: PathBuf,
}

async fn compile(dir: &Path, source: &str, as_tests: bool) -> std::io::Result<Compiled> {
    let src = dir.join("main.rs");
    let binary = dir.join("game_bin");
    std::fs::write(&src, source)?;

    let mut cmd = Command::new("rustc");
    cmd.arg("--edition=2024")
        .arg("--color=never")
        .arg("--crate-name=main")
        .arg("-o")
        .arg(&binary)
        .arg("main.rs")
        .current_dir(dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if as_tests {
        // `main` is never called in test mode, so don't nag about it.
        cmd.arg("--test").arg("-A").arg("dead_code");
    }
    let child = cmd.spawn()?;
    match tokio::time::timeout(COMPILE_TIMEOUT, child.wait_with_output()).await {
        Ok(out) => {
            let out = out?;
            let messages = String::from_utf8_lossy(&out.stderr).into_owned();
            Ok(Compiled {
                ok: out.status.success(),
                messages: truncate(messages),
                binary,
            })
        }
        Err(_) => Ok(Compiled {
            ok: false,
            messages: "The compiler took too long.".into(),
            binary,
        }),
    }
}

struct Ran {
    success: bool,
    timed_out: bool,
    stdout: String,
    stderr: String,
}

/// Read at most `MAX_OUTPUT` bytes. Returns the bytes and whether there was more.
async fn read_capped(mut pipe: impl AsyncRead + Unpin, over: Arc<Notify>) -> (Vec<u8>, bool) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match pipe.read(&mut chunk).await {
            Ok(0) | Err(_) => return (buf, false),
            Ok(n) => {
                let room = MAX_OUTPUT - buf.len();
                buf.extend_from_slice(&chunk[..n.min(room)]);
                if n > room {
                    // Too much output: stop reading and tell the runner to stop the program.
                    over.notify_one();
                    return (buf, true);
                }
            }
        }
    }
}

async fn run_binary(binary: &Path, dir: &Path, args: &[&str]) -> std::io::Result<Ran> {
    let mut child = Command::new(binary)
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        // Its own process group, so anything it starts can be stopped along with it.
        .process_group(0)
        .spawn()?;
    let pgid = child.id();
    let over = Arc::new(Notify::new());
    let out_task = tokio::spawn(read_capped(
        child.stdout.take().expect("piped"),
        over.clone(),
    ));
    let err_task = tokio::spawn(read_capped(
        child.stderr.take().expect("piped"),
        over.clone(),
    ));

    // Output is never buffered beyond MAX_OUTPUT: the program is stopped as soon as it
    // prints too much, runs too long, or finishes.
    let (status, timed_out) = tokio::select! {
        status = child.wait() => (Some(status?), false),
        _ = over.notified() => (None, false),
        _ = tokio::time::sleep(RUN_TIMEOUT) => (None, true),
    };
    // Stop the program and everything it started. A leftover child process would
    // otherwise keep the output pipes open and hold the run past its deadline.
    if let Some(pgid) = pgid {
        kill_group(pgid);
    }
    if status.is_none() {
        let _ = child.kill().await;
    }
    let grace = Duration::from_secs(1);
    let (stdout, out_over) = tokio::time::timeout(grace, out_task)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
    let (stderr, err_over) = tokio::time::timeout(grace, err_task)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
    let mut stdout = String::from_utf8_lossy(&stdout).into_owned();
    let mut stderr = String::from_utf8_lossy(&stderr).into_owned();
    if out_over || err_over {
        stdout.push_str("\n… (output cut off)");
        stderr.push_str(&format!(
            "Stopped: the program printed more than {} KB.",
            MAX_OUTPUT / 1000
        ));
    } else if timed_out {
        stderr = format!(
            "Stopped after {} seconds — is there an infinite loop?",
            RUN_TIMEOUT.as_secs()
        );
    }
    Ok(Ran {
        success: status.is_some_and(|s| s.success()),
        timed_out,
        stdout,
        stderr,
    })
}

/// Kill a whole process group (the program plus anything it spawned).
fn kill_group(pgid: u32) {
    // SAFETY: kill() only sends a signal; a negative pid targets the process group.
    unsafe {
        libc::kill(-(pgid as libc::pid_t), libc::SIGKILL);
    }
}

fn error_codes(messages: &str) -> Vec<String> {
    let mut codes: Vec<String> = ERROR_CODE
        .captures_iter(messages)
        .map(|c| c[1].to_string())
        .collect();
    codes.dedup();
    codes
}

/// Compile and run code with no pass/fail check (the workshop and predict levels).
pub async fn play(code: &str, work: &Path) -> RunResult {
    match play_inner(code, work).await {
        Ok(r) => r,
        Err(e) => internal_error(e),
    }
}

async fn play_inner(code: &str, work: &Path) -> std::io::Result<RunResult> {
    let _slot = RUN_SLOTS
        .acquire()
        .await
        .expect("semaphore is never closed");
    let scratch = Scratch::new(work)?;
    let compiled = compile(&scratch.0, code, false).await?;
    let mut result = RunResult {
        compiled: compiled.ok,
        error_codes: error_codes(&compiled.messages),
        compiler: compiled.messages,
        ..Default::default()
    };
    if !compiled.ok {
        result.summary = "It doesn't compile yet.".into();
        return Ok(result);
    }
    let ran = run_binary(&compiled.binary, &scratch.0, &[]).await?;
    result.passed = ran.success;
    result.timed_out = ran.timed_out;
    result.stdout = ran.stdout;
    result.stderr = ran.stderr;
    result.summary = if ran.timed_out {
        "The program ran too long and was stopped.".into()
    } else if ran.success {
        "It ran!".into()
    } else {
        "It compiled, but crashed (panicked) while running.".into()
    };
    Ok(result)
}

/// Compile the player's code and decide whether the level is passed.
pub async fn check_level(level: &Level, code: &str, work: &Path) -> RunResult {
    match check_inner(level, code, work).await {
        Ok(r) => r,
        Err(e) => internal_error(e),
    }
}

async fn check_inner(level: &Level, code: &str, work: &Path) -> std::io::Result<RunResult> {
    let _slot = RUN_SLOTS
        .acquire()
        .await
        .expect("semaphore is never closed");
    let scratch = Scratch::new(work)?;
    let as_tests = level.check == Check::Tests;
    let source = match (&level.tests, as_tests) {
        (Some(tests), true) => format!("{code}\n\n// ---- Ferris' tests ----\n{tests}\n"),
        _ => code.to_string(),
    };

    let compiled = compile(&scratch.0, &source, as_tests).await?;
    let mut result = RunResult {
        compiled: compiled.ok,
        error_codes: error_codes(&compiled.messages),
        compiler: compiled.messages,
        ..Default::default()
    };
    if !compiled.ok {
        result.summary = "It doesn't compile yet.".into();
        return Ok(result);
    }

    let args: &[&str] = if as_tests {
        &["--test-threads=1", "--color=never"]
    } else {
        &[]
    };
    let ran = run_binary(&compiled.binary, &scratch.0, args).await?;
    result.timed_out = ran.timed_out;
    result.stdout = ran.stdout;
    result.stderr = ran.stderr;

    if ran.timed_out {
        result.summary = "The program ran too long and was stopped.".into();
        return Ok(result);
    }

    match level.check {
        Check::Tests => {
            result.passed = ran.success;
            result.summary = if ran.success {
                "All of Ferris' tests passed!".into()
            } else {
                "It compiles, but some tests failed.".into()
            };
        }
        Check::Output => {
            let expected = normalize(level.expected_output.as_deref().unwrap_or(""));
            let got = normalize(&result.stdout);
            result.passed = ran.success && got == expected;
            result.summary = if result.passed {
                "Output matches. Level passed!".into()
            } else if !ran.success {
                "It compiled, but crashed (panicked) while running.".into()
            } else {
                format!("It runs, but the output isn't right yet.\nExpected:\n{expected}")
            };
        }
    }
    Ok(result)
}

fn internal_error(e: std::io::Error) -> RunResult {
    RunResult {
        summary: format!("The game couldn't run rustc: {e}"),
        compiler: format!("Internal error: {e}\nIs Rust installed and on your PATH?"),
        ..Default::default()
    }
}

/// The official long explanation for an error code, from `rustc --explain`.
pub async fn explain(code: &str) -> String {
    let valid =
        code.len() == 5 && code.starts_with('E') && code[1..].chars().all(|c| c.is_ascii_digit());
    if !valid {
        return "Not an error code.".into();
    }
    match Command::new("rustc")
        .arg("--explain")
        .arg(code)
        .output()
        .await
    {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).into_owned(),
        _ => format!("rustc has no explanation for {code}."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ferris-forge-runner-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn normalize_ignores_trailing_whitespace() {
        assert_eq!(normalize("a  \nb\n\n"), "a\nb");
    }

    #[tokio::test]
    async fn runs_a_program() {
        let r = play("fn main() { println!(\"hi\"); }", &work_dir("hello")).await;
        assert!(r.compiled && r.passed, "{r:?}");
        assert_eq!(r.stdout.trim(), "hi");
    }

    #[tokio::test]
    async fn reports_error_codes() {
        let r = play("fn main() { let x = 1; x = 2; }", &work_dir("e0384")).await;
        assert!(!r.compiled);
        assert_eq!(r.error_codes, vec!["E0384".to_string()]);
    }

    #[tokio::test]
    async fn endless_output_is_capped_and_stopped_early() {
        let start = std::time::Instant::now();
        let r = play(
            "fn main() { loop { println!(\"spam spam spam spam\"); } }",
            &work_dir("flood"),
        )
        .await;
        assert!(!r.passed);
        assert!(
            r.stdout.len() <= MAX_OUTPUT + 100,
            "stdout was {} bytes",
            r.stdout.len()
        );
        assert!(r.stderr.contains("printed more than"), "{}", r.stderr);
        // Compiling takes a moment, but the run itself must stop long before the 5 s timeout.
        assert!(start.elapsed() < RUN_TIMEOUT + Duration::from_secs(30));
        assert!(!r.timed_out);
    }

    #[tokio::test]
    async fn leftover_child_processes_cannot_outlive_the_run() {
        let start = std::time::Instant::now();
        let code = r#"fn main() {
            std::process::Command::new("sleep").arg("30").spawn().unwrap();
            println!("parent done");
        }"#;
        let r = play(code, &work_dir("grandchild")).await;
        assert!(r.compiled, "{}", r.compiler);
        assert_eq!(r.stdout.trim(), "parent done");
        // Compiling takes a few seconds; the 30 s child must not hold the run open.
        assert!(
            start.elapsed() < Duration::from_secs(25),
            "took {:?}",
            start.elapsed()
        );
    }

    #[tokio::test]
    async fn infinite_loops_time_out() {
        let r = play(
            "fn main() { loop { std::hint::black_box(0); } }",
            &work_dir("spin"),
        )
        .await;
        assert!(r.timed_out && !r.passed);
    }
}
