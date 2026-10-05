// Vim mode: keystrokes go to the player's own Neovim (running on the game server),
// and the editor shows Neovim's buffer, cursor and mode.

const SPECIAL = {
  Escape: "Esc", Enter: "CR", Backspace: "BS", Tab: "Tab", Delete: "Del", Insert: "Insert",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6", F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
};
const PRINTABLE_NAMES = { "<": "lt", "\\": "Bslash", "|": "Bar", " ": "Space" };

/** Translate a keydown event into Neovim key notation (e.g. "x", "<C-r>", "<Esc>"), or null. */
export function nvimKey(e) {
  const k = e.key;
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Unidentified", "Process"].includes(k)) return null;
  let name, special = false;
  if (SPECIAL[k]) { name = SPECIAL[k]; special = true; }
  else if (k.length === 1 || [...k].length === 1) name = PRINTABLE_NAMES[k] || k;
  else return null;
  let mods = "";
  if (e.ctrlKey) mods += "C-";
  if (e.altKey || e.metaKey) mods += "M-";
  if (e.shiftKey && special) mods += "S-";
  if (!mods) return name.length === 1 || [...name].length === 1 ? name : `<${name}>`;
  return `<${mods}${name}>`;
}

const enc = new TextEncoder();

/** Neovim columns are UTF-8 byte offsets; the browser counts UTF-16 units. */
export function byteToIndex(line, byteCol) {
  let bytes = 0, i = 0;
  for (const ch of line) {
    if (bytes >= byteCol) break;
    bytes += enc.encode(ch).length;
    i += ch.length;
  }
  return i;
}

export function indexToByte(line, idx) {
  return enc.encode(line.slice(0, idx)).length;
}

export const MODE_NAMES = {
  n: "NORMAL", no: "PENDING", i: "INSERT", ic: "INSERT", ix: "INSERT", R: "REPLACE", Rv: "V-REPLACE",
  v: "VISUAL", V: "V-LINE", "\x16": "V-BLOCK", s: "SELECT", S: "S-LINE", c: "COMMAND", t: "TERMINAL",
};

export function modeName(mode) {
  if (!mode) return "…";
  return MODE_NAMES[mode] || MODE_NAMES[mode.slice(0, 2)] || MODE_NAMES[mode[0]] || mode.toUpperCase();
}

/** One WebSocket connection = one Neovim on the server. */
export class VimBridge {
  constructor({ onState, onError }) {
    this.onState = onState;
    this.onError = onError;
    this.queue = [];
    this.seq = 0;
    this.ws = null;
    this.closed = false;
  }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/api/vim`);
    this.ws.onopen = () => { for (const m of this.queue.splice(0)) this.ws.send(m); };
    this.ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "error" || msg.type === "stopped") this.onError(msg);
      else this.onState(msg);
    };
    this.ws.onclose = () => { if (!this.closed) this.onError({ type: "disconnected", message: "Lost the connection to Neovim." }); };
  }

  /** Send a request; returns its sequence number (replies echo it back). */
  send(obj) {
    obj.seq = ++this.seq;
    const text = JSON.stringify(obj);
    this.connect();
    if (this.ws.readyState === 1) this.ws.send(text); else this.queue.push(text);
    return obj.seq;
  }

  start(text, row, col, config) { return this.send({ type: "start", text, row, col, config }); }
  keys(keys) { return this.send({ type: "keys", keys }); }
  set(text, row = 1, col = 0) { return this.send({ type: "set", text, row, col }); }
  cursor(row, col) { this.send({ type: "cursor", row, col }); }
  paste(text) { this.send({ type: "paste", text }); }

  close() {
    this.closed = true;
    this.queue = [];
    if (this.ws) this.ws.close();
  }
}
