//! Vim mode: runs the player's own Neovim (`nvim --embed`) in the background and
//! forwards keystrokes to it over msgpack-RPC. The browser editor just shows
//! whatever Neovim's buffer, cursor and mode are.

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::{IntoResponse, Response};
use rmpv::Value;
use serde_json::{Value as Json, json};
use std::collections::HashMap;
use std::io::{BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

use crate::api::AppState;

type Pending = Arc<Mutex<HashMap<u32, oneshot::Sender<Result<Value, String>>>>>;

/// Lua helpers installed into Neovim once it starts.
const SETUP_LUA: &str = r#"
_G.ferris = {}
function ferris.setup()
  -- Our own scratch buffer, so a startup dashboard can't take over.
  local buf = vim.api.nvim_create_buf(true, true)
  ferris.buf = buf
  vim.api.nvim_set_current_buf(buf)
  vim.bo[buf].swapfile = false
  vim.bo[buf].filetype = 'rust'
  -- Completion menus would be invisible in the game, and <CR>/<Tab> could
  -- silently accept them, so switch completion off for this buffer only.
  vim.b[buf].completion = false
  pcall(function() require('cmp').setup.buffer({ enabled = false }) end)
  vim.o.more = false
  vim.o.shortmess = vim.o.shortmess .. 'IF'
end
function ferris.focus()
  -- If a plugin opened another buffer (dashboard, help, ...), go back to ours.
  if ferris.buf and vim.api.nvim_buf_is_valid(ferris.buf) and vim.api.nvim_get_current_buf() ~= ferris.buf then
    pcall(vim.cmd, 'silent! only')
    pcall(vim.api.nvim_set_current_buf, ferris.buf)
  end
end
function ferris.state(peek)
  ferris.focus()
  local mode = vim.api.nvim_get_mode().mode
  -- A background look (peek) leaves the error message for the next real reply.
  local err = vim.NIL
  if not peek then
    err = vim.v.errmsg
    vim.v.errmsg = ''
  end
  local visual = vim.NIL
  if mode:match('^[vV\22]') then
    local p = vim.fn.getpos('v')
    visual = { p[2], p[3] - 1 }
  end
  local cmdline = vim.NIL
  if mode:sub(1, 1) == 'c' then cmdline = vim.fn.getcmdtype() .. vim.fn.getcmdline() end
  return {
    lines = vim.api.nvim_buf_get_lines(0, 0, -1, false),
    cursor = vim.api.nvim_win_get_cursor(0),
    mode = mode, visual = visual, cmdline = cmdline, err = err,
  }
end
function ferris.set(lines, row, col)
  ferris.focus()
  local ul = vim.bo.undolevels
  vim.bo.undolevels = -1 -- changing text with undo off clears the undo history
  vim.api.nvim_buf_set_lines(0, 0, -1, false, lines)
  vim.bo.undolevels = ul
  pcall(vim.api.nvim_win_set_cursor, 0, { row, col })
end
"#;

pub struct Nvim {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Pending,
    next_id: AtomicU32,
}

impl Drop for Nvim {
    fn drop(&mut self) {
        if let Ok(mut c) = self.child.lock() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

impl Nvim {
    pub fn spawn(use_config: bool, cwd: &std::path::Path) -> std::io::Result<Nvim> {
        std::fs::create_dir_all(cwd)?;
        let mut cmd = Command::new("nvim");
        // -n: no swap file, -i NONE: don't touch the player's shada history.
        // No --headless: Neovim waits for us to attach as a UI, so UIEnter/VeryLazy
        // fire and lazy-loaded config (keymaps, plugins) loads like normal.
        cmd.args(["--embed", "-n", "-i", "NONE"]);
        if !use_config {
            cmd.arg("--clean");
        }
        let mut child = cmd
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let stdin = child.stdin.take().expect("piped");
        let stdout = child.stdout.take().expect("piped");
        let pending: Pending = Arc::default();

        let reader_pending = pending.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            while let Ok(msg) = rmpv::decode::read_value(&mut reader) {
                // Responses look like [1, id, error, result]; notifications are ignored.
                let Value::Array(parts) = msg else { continue };
                if parts.len() == 4 && parts[0].as_u64() == Some(1) {
                    let id = parts[1].as_u64().unwrap_or(0) as u32;
                    let result = if parts[2].is_nil() {
                        Ok(parts[3].clone())
                    } else {
                        Err(error_text(&parts[2]))
                    };
                    if let Some(tx) = reader_pending.lock().unwrap().remove(&id) {
                        let _ = tx.send(result);
                    }
                }
            }
            // Neovim exited: fail everything still waiting.
            for (_, tx) in reader_pending.lock().unwrap().drain() {
                let _ = tx.send(Err("Neovim stopped".into()));
            }
        });

        Ok(Nvim {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending,
            next_id: AtomicU32::new(1),
        })
    }

    pub async fn call(&self, method: &str, args: Vec<Value>) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let msg = Value::Array(vec![0.into(), id.into(), method.into(), Value::Array(args)]);
        let mut buf = Vec::new();
        rmpv::encode::write_value(&mut buf, &msg).map_err(|e| e.to_string())?;
        {
            let mut stdin = self.stdin.lock().unwrap();
            stdin
                .write_all(&buf)
                .and_then(|_| stdin.flush())
                .map_err(|_| "Neovim stopped".to_string())?;
        }
        match tokio::time::timeout(Duration::from_secs(5), rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err("Neovim stopped".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err("Neovim didn't answer (is it waiting for something?)".into())
            }
        }
    }

    async fn lua(&self, code: &str, args: Vec<Value>) -> Result<Value, String> {
        self.call("nvim_exec_lua", vec![code.into(), Value::Array(args)])
            .await
    }

    async fn set_text(&self, text: &str, row: i64, col: i64) -> Result<(), String> {
        let lines: Vec<Value> = text.split('\n').map(Value::from).collect();
        // Back to Normal mode first, then replace the buffer.
        self.call("nvim_input", vec!["<C-\\><C-n>".into()]).await?;
        self.lua(
            "ferris.set(...)",
            vec![Value::Array(lines), row.max(1).into(), col.max(0).into()],
        )
        .await?;
        Ok(())
    }

    /// Current buffer, cursor and mode. While Neovim waits for more keys only the mode is known.
    /// `peek` is a background look: it doesn't use up the error message.
    async fn state(&self, peek: bool) -> Result<Json, String> {
        for _ in 0..3 {
            let mode = self.call("nvim_get_mode", vec![]).await?;
            let m = map_get(&mode, "mode")
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            let blocking = map_get(&mode, "blocking")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if m.starts_with('r') {
                // A "Press ENTER" prompt: dismiss it and look again.
                self.call("nvim_input", vec!["<CR>".into()]).await?;
                continue;
            }
            if blocking {
                return Ok(json!({ "type": "mode", "mode": m }));
            }
            let st = self
                .lua("return ferris.state(...)", vec![peek.into()])
                .await?;
            let mut out = to_json(&st);
            out["type"] = json!("state");
            return Ok(out);
        }
        Ok(json!({ "type": "mode", "mode": "r" }))
    }
}

impl Nvim {
    /// If Neovim is holding keys for a possible mapping (`j` of a `jk` mapping), resolve
    /// them now, exactly as if 'timeoutlen' had run out, so the buffer is complete.
    /// `<Ignore>` does that: it can't continue any mapping, and is otherwise ignored.
    /// Built-in prefixes (`g`, `d`, `"`...) and the command line never time out, and
    /// `<Ignore>` leaves them alone too.
    async fn settle(&self) -> Result<(), String> {
        let mode = self.call("nvim_get_mode", vec![]).await?;
        let m = map_get(&mode, "mode").and_then(Value::as_str).unwrap_or("");
        let blocking = map_get(&mode, "blocking")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if blocking && !m.starts_with('c') {
            self.call("nvim_input", vec!["<Ignore>".into()]).await?;
        }
        Ok(())
    }
}

/// What a state looks like for "did anything change?": everything but the error message.
fn state_key(st: &Json) -> String {
    json!([
        st["type"],
        st["mode"],
        st["lines"],
        st["cursor"],
        st["visual"],
        st["cmdline"]
    ])
    .to_string()
}

fn map_get<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    v.as_map()?
        .iter()
        .find(|(k, _)| k.as_str() == Some(key))
        .map(|(_, v)| v)
}

fn error_text(err: &Value) -> String {
    match err {
        Value::Array(a) if a.len() == 2 => a[1].as_str().unwrap_or("Neovim error").to_string(),
        other => other.to_string(),
    }
}

fn to_json(v: &Value) -> Json {
    match v {
        Value::Nil => Json::Null,
        Value::Boolean(b) => json!(b),
        Value::Integer(i) => i
            .as_i64()
            .map(|n| json!(n))
            .unwrap_or_else(|| json!(i.as_u64())),
        Value::F32(f) => json!(f),
        Value::F64(f) => json!(f),
        Value::String(s) => json!(
            s.as_str()
                .map(String::from)
                .unwrap_or_else(|| String::from_utf8_lossy(s.as_bytes()).into_owned())
        ),
        Value::Binary(b) => json!(String::from_utf8_lossy(b)),
        Value::Array(a) => Json::Array(a.iter().map(to_json).collect()),
        Value::Map(m) => Json::Object(
            m.iter()
                .map(|(k, v)| {
                    (
                        k.as_str()
                            .map(String::from)
                            .unwrap_or_else(|| k.to_string()),
                        to_json(v),
                    )
                })
                .collect(),
        ),
        Value::Ext(_, _) => Json::Null,
    }
}

/// How many Neovims may run at once (the level editor and the Workshop need two).
const MAX_SESSIONS: usize = 6;
static SESSIONS: AtomicUsize = AtomicUsize::new(0);
/// The biggest message the editor may send: plenty for any code, far below the 64 MB default.
const MAX_MESSAGE: usize = 1 << 20;

pub async fn vim_ws(ws: WebSocketUpgrade, State(s): State<Arc<AppState>>) -> Response {
    if SESSIONS.load(Ordering::SeqCst) >= MAX_SESSIONS {
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "Too many Neovims are running. Close a tab with the game and try again.",
        )
            .into_response();
    }
    ws.max_message_size(MAX_MESSAGE)
        .max_frame_size(MAX_MESSAGE)
        .on_upgrade(move |socket| async move {
            SESSIONS.fetch_add(1, Ordering::SeqCst);
            session(socket, s).await;
            SESSIONS.fetch_sub(1, Ordering::SeqCst);
        })
}

/// How long the editor must be quiet before we look for changes Neovim made by itself.
const IDLE_POLL: Duration = Duration::from_millis(250);

/// One browser editor ↔ one Neovim. Neovim is stopped when the editor disconnects.
async fn session(mut socket: WebSocket, state: Arc<AppState>) {
    let mut nvim: Option<Nvim> = None;
    // The last request handled, and the last state the browser was sent.
    let mut last_seq = Json::Null;
    let mut last_sent = String::new();
    loop {
        let next = if nvim.is_some() {
            tokio::time::timeout(IDLE_POLL, socket.recv()).await
        } else {
            Ok(socket.recv().await)
        };
        let msg = match next {
            Ok(Some(Ok(msg))) => msg,
            Ok(_) => break,
            Err(_) => {
                // Quiet for a moment. Neovim can still change things on its own: a mapping
                // that timed out (`j` of `jk`), a plugin, a timer. Tell the browser.
                let Some(n) = &nvim else { continue };
                let Ok(mut st) = n.state(true).await else {
                    continue;
                };
                let key = state_key(&st);
                if key == last_sent {
                    continue;
                }
                last_sent = key;
                // Tagged with the last request, so the browser can tell it apart from
                // replies to requests it sent later (e.g. after loading another level).
                st["seq"] = last_seq.clone();
                st["push"] = json!(true);
                if socket
                    .send(Message::Text(st.to_string().into()))
                    .await
                    .is_err()
                {
                    break;
                }
                continue;
            }
        };
        let Message::Text(text) = msg else { continue };
        let Ok(req) = serde_json::from_str::<Json>(&text) else {
            continue;
        };
        let seq = req["seq"].clone();
        let mut reply = match handle(&mut nvim, &req, &state).await {
            Ok(r) => r,
            Err(e) => json!({ "type": "error", "message": e }),
        };
        last_seq = seq.clone();
        if reply["type"] == "state" || reply["type"] == "mode" {
            last_sent = state_key(&reply);
        }
        reply["seq"] = seq;
        if socket
            .send(Message::Text(reply.to_string().into()))
            .await
            .is_err()
        {
            break;
        }
    }
}

async fn handle(nvim: &mut Option<Nvim>, req: &Json, state: &AppState) -> Result<Json, String> {
    let text = req["text"].as_str().unwrap_or("");
    let row = req["row"].as_i64().unwrap_or(1);
    let col = req["col"].as_i64().unwrap_or(0);

    if req["type"] == "start" {
        let use_config = req["config"].as_bool().unwrap_or(true);
        let n = Nvim::spawn(use_config, &state.save_dir.join("nvim")).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Neovim (nvim) isn't installed or isn't on your PATH.".to_string()
            } else {
                format!("Couldn't start Neovim: {e}")
            }
        })?;
        // Attach as a (wide, invisible) UI. Redraw events are ignored by the reader.
        let opts = Value::Map(vec![("ext_linegrid".into(), true.into())]);
        n.call("nvim_ui_attach", vec![220.into(), 60.into(), opts])
            .await?;
        // Let startup finish (VimEnter, VeryLazy, dashboards...) before taking over.
        for _ in 0..30 {
            let entered = n
                .call("nvim_get_vvar", vec!["vim_did_enter".into()])
                .await?;
            if entered.as_i64() == Some(1) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
        n.lua(SETUP_LUA, vec![]).await?;
        n.lua("ferris.setup()", vec![]).await?;
        n.set_text(text, row, col).await?;
        let version = n.lua("local v = vim.version(); return string.format('%d.%d.%d', v.major, v.minor, v.patch)", vec![]).await.ok().and_then(|v| v.as_str().map(String::from));
        let mut st = n.state(false).await?;
        st["version"] = json!(version);
        st["config"] = json!(use_config);
        *nvim = Some(n);
        return Ok(st);
    }

    let n = nvim.as_ref().ok_or("Neovim isn't running")?;
    let result = match req["type"].as_str() {
        Some("keys") => {
            let keys = req["keys"].as_str().unwrap_or("");
            n.call("nvim_input", vec![keys.into()]).await.map(|_| ())
        }
        Some("set") => n.set_text(text, row, col).await,
        Some("cursor") => n
            .call(
                "nvim_win_set_cursor",
                vec![
                    0.into(),
                    Value::Array(vec![row.max(1).into(), col.max(0).into()]),
                ],
            )
            .await
            .map(|_| ()),
        Some("paste") => n
            .call("nvim_paste", vec![text.into(), true.into(), (-1).into()])
            .await
            .map(|_| ()),
        // Just report the state; with "settle", first let a pending mapping time out.
        Some("state") if req["settle"] == true => n.settle().await,
        Some("state") => Ok(()),
        _ => Err("unknown request".into()),
    };
    let outcome = match result {
        Ok(()) => n.state(false).await,
        Err(e) => Err(e),
    };
    match outcome {
        Err(e) if e == "Neovim stopped" => {
            *nvim = None;
            Ok(
                json!({ "type": "stopped", "message": "Neovim quit (did you type :q?). It will restart when you type in the editor." }),
            )
        }
        other => other,
    }
}
