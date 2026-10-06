// A small Rust code editor: a transparent <textarea> on top of a highlighted <pre>.
// Optional Vim mode hands every keystroke to the player's own Neovim (see vim.js).
import { VimBridge, nvimKey, byteToIndex, indexToByte, modeName } from "./vim.js";

const KEYWORDS = new Set(
  "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while".split(" ")
);
const TYPES = new Set(
  "i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Some None Ok Err Box HashMap Rc RefCell Arc Mutex".split(" ")
);

const TOKEN = new RegExp(
  [
    String.raw`(?<com>\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*)`,
    String.raw`(?<str>b?"(?:\\[\s\S]|[^"\\])*(?:"|$))`,
    String.raw`(?<chr>'(?:\\.|[^'\\\n])')`,
    String.raw`(?<life>'[A-Za-z_]\w*)`,
    String.raw`(?<attr>#!?\[[^\]\n]*\]?)`,
    String.raw`(?<num>\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?(?:_?(?:[iu](?:8|16|32|64|128|size)|f32|f64))?\b)`,
    String.raw`(?<id>[A-Za-z_]\w*)(?<bang>!)?`,
  ].join("|"),
  "g"
);

export function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightRust(code) {
  let out = "";
  let last = 0;
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(code))) {
    if (m[0] === "") { TOKEN.lastIndex++; continue; }
    out += escapeHtml(code.slice(last, m.index));
    last = m.index + m[0].length;
    const g = m.groups;
    const text = escapeHtml(m[0]);
    let cls = null;
    if (g.com) cls = "com";
    else if (g.str || g.chr) cls = "str";
    else if (g.life) cls = "life";
    else if (g.attr) cls = "attr";
    else if (g.num) cls = "num";
    else if (g.id) {
      if (g.bang) cls = "mac";
      else if (KEYWORDS.has(g.id)) cls = "kw";
      else if (TYPES.has(g.id) || /^[A-Z]/.test(g.id)) cls = "ty";
      else if (code[last] === "(") cls = "fn";
    }
    out += cls ? `<span class="tk-${cls}">${text}</span>` : text;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

const graphemes = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** The index just after the character that starts at `idx`, with its accents
 *  (combining marks) and both halves of a surrogate pair. */
function charEnd(text, idx) {
  if (idx >= text.length) return text.length;
  if (graphemes) {
    for (const { segment } of graphemes.segment(text.slice(idx, idx + 64))) return idx + segment.length;
  }
  return idx + (text.codePointAt(idx) > 0xffff ? 2 : 1);
}

export class Editor {
  constructor(host, { onChange = () => {}, onRun = () => {}, onVimError = () => {} } = {}) {
    this.onChange = onChange;
    this.onRun = onRun;
    this.onVimError = onVimError;
    this.vim = null;
    this.locked = false;
    host.innerHTML = `
      <div class="ed">
        <div class="ed-scroll">
          <div class="ed-inner">
            <div class="ed-gutter"></div>
            <div class="ed-code">
              <div class="ed-marks"></div>
              <pre class="ed-hl"></pre>
              <div class="ed-vlayer"></div>
              <textarea class="ed-ta" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Rust code editor"></textarea>
            </div>
          </div>
        </div>
        <div class="ed-status"><span class="vs-mode"></span><span class="vs-msg"></span><span class="vs-info"></span></div>
      </div>`;
    this.root = host.querySelector(".ed");
    this.vlayer = host.querySelector(".ed-vlayer");
    this.statusMode = host.querySelector(".vs-mode");
    this.statusMsg = host.querySelector(".vs-msg");
    this.statusInfo = host.querySelector(".vs-info");
    this.scroller = host.querySelector(".ed-scroll");
    this.gutter = host.querySelector(".ed-gutter");
    this.pre = host.querySelector(".ed-hl");
    this.ta = host.querySelector(".ed-ta");
    this.marks = host.querySelector(".ed-marks");
    this.errorLines = new Set();

    this.ta.addEventListener("input", () => { this.render(); this.onChange(this.value); this.keepCaretVisible(); });
    // Each key press or mouse press is a new gesture. One gesture pastes at most once:
    // some browsers fire two paste events for a single Ctrl+Shift+V on a read-only textarea.
    this.gesture = 0;
    this.pastedGesture = -1;
    this.ta.addEventListener("keydown", e => { this.gesture++; this.onKey(e); });
    this.ta.addEventListener("mousedown", () => this.gesture++);
    this.ta.addEventListener("contextmenu", () => this.gesture++);
    this.ta.addEventListener("click", () => this.keepCaretVisible());
    this.ta.addEventListener("mouseup", () => this.vimClick());
    this.ta.addEventListener("paste", e => {
      if (!this.vim) return;
      e.preventDefault();
      if (this.pastedGesture === this.gesture) return;
      this.pastedGesture = this.gesture;
      this.vim.paste(e.clipboardData.getData("text"));
    });
    // A web font that finishes loading moves the text; move the Vim cursor with it.
    document.fonts?.addEventListener?.("loadingdone", () => this.relayout());
    this.render();
  }

  /** Redraw after the code font or the layout changed. */
  relayout() {
    if (this.vim) this.drawVimCursor();
  }

  /** Wait until Neovim has handled every key sent so far (and any mapping that is waiting
   *  for its timeout), so `value` is complete. Use before saving, running or switching. */
  async sync() {
    const bridge = this.vim;
    if (!bridge || this.vimDead) return;
    // Only a safety net: the server always answers (or the connection closes) well before this.
    const timeout = new Promise(resolve => setTimeout(resolve, 10000));
    await Promise.race([bridge.request({ type: "state", settle: true }), timeout]);
  }

  get value() { return this.ta.value; }
  set value(v) {
    this.ta.value = v;
    this.errorLines.clear();
    this.render();
    this.scroller.scrollTop = 0;
    this.scroller.scrollLeft = 0;
    // Replies to anything sent before this replacement are now stale.
    if (this.vim) this.vimEpoch = this.vim.set(v, 1, 0);
  }

  setReadOnly(ro) { this.locked = ro; this.ta.readOnly = ro || !!this.vim; }
  focus() { this.ta.focus(); }

  // ---------------------------------------------------------------- Vim mode

  get vimActive() { return !!this.vim; }

  enableVim(useConfig = true) {
    // The latest request wins: an older turnOffVim() or config switch that is still
    // waiting for its sync sees this and gives up.
    this.vimWanted = { on: true, config: useConfig };
    if (this.vim && this.vimConfig === useConfig) return;
    if (this.vim && !this.vimDead) {
      // Switching between your config and a clean Neovim: let the old one hand over every
      // key it's still holding (like the `j` of `jk`) before it's replaced.
      this.replaceVim(this.vimWanted);
      return;
    }
    this.startVim(useConfig);
  }

  async replaceVim(wanted) {
    const old = this.vim;
    await this.sync();
    if (this.vimWanted !== wanted || this.vim !== old) return;
    this.startVim(wanted.config);
  }

  startVim(useConfig) {
    this.disableVim();
    this.vimConfig = useConfig;
    this.vimDead = false;
    // Callbacks from an older bridge (before a restart) must not touch the editor.
    const bridge = new VimBridge({
      onState: st => { if (this.vim === bridge) this.applyVim(st); },
      onError: m => { if (this.vim === bridge) this.vimError(m); },
    });
    this.vim = bridge;
    this.ta.readOnly = true;
    this.root.classList.add("vim-on");
    const { row, col } = this.cursorRowCol();
    this.vimEpoch = this.vim.start(this.ta.value, row, col, useConfig);
    this.setStatus("…", "starting Neovim…", "");
  }

  disableVim() {
    if (!this.vim) return;
    this.vim.close();
    this.vim = null;
    this.vimMode = null;
    this.ta.readOnly = this.locked;
    this.root.classList.remove("vim-on", "vim-insert");
    this.vlayer.innerHTML = "";
  }

  /** Turn Vim mode off without losing keys Neovim is still holding (like the `j` of `jk`):
   *  their text reaches the editor first. */
  async turnOffVim() {
    const bridge = this.vim;
    const wanted = this.vimWanted = { on: false };
    if (!bridge) return;
    await this.sync();
    if (this.vim === bridge && this.vimWanted === wanted) this.disableVim();
  }

  destroy() { return this.turnOffVim(); }

  cursorRowCol() {
    const pos = this.ta.selectionStart || 0;
    const before = this.ta.value.slice(0, pos);
    const row = before.split("\n").length;
    const lineStart = before.lastIndexOf("\n") + 1;
    const line = this.ta.value.slice(lineStart).split("\n")[0];
    return { row, col: indexToByte(line, pos - lineStart) };
  }

  setStatus(mode, msg, info) {
    this.statusMode.textContent = mode;
    this.statusMode.dataset.mode = mode;
    this.statusMsg.textContent = msg || "";
    if (info !== undefined) this.statusInfo.textContent = info;
  }

  /** Show what Neovim reports: buffer text, cursor, mode, selection. */
  applyVim(st) {
    if (!this.vim) return;
    // A reply to a request sent before the buffer was last replaced (e.g. another level's
    // code) must not overwrite what's there now.
    if (typeof st.seq === "number" && st.seq < (this.vimEpoch || 0)) return;
    if (st.type === "mode") {
      this.vimMode = st.mode;
      this.setStatus(modeName(st.mode), "");
      this.drawVimCursor();
      return;
    }
    if (st.version) this.vimInfo = `nvim ${st.version} · ${st.config ? "your config" : "clean"}`;
    const lines = st.lines || [""];
    const text = lines.join("\n");
    if (text !== this.ta.value) {
      this.ta.value = text;
      this.render();
      this.onChange(text);
    }
    this.vimMode = st.mode;
    const offsets = [];
    let acc = 0;
    for (const l of lines) { offsets.push(acc); acc += l.length + 1; }
    const at = (r, byteCol) => {
      const line = lines[r - 1] ?? "";
      return { row: r - 1, col: byteToIndex(line, byteCol), idx: (offsets[r - 1] ?? 0) + byteToIndex(line, byteCol) };
    };
    const cur = at(st.cursor[0], st.cursor[1]);
    this.vimCursor = cur;
    this.vimVisual = null;
    const mode = st.mode || "n";
    if (st.visual && (mode[0] === "v" || mode[0] === "V")) {
      const v = at(st.visual[0], st.visual[1]);
      const [a, b] = v.idx <= cur.idx ? [v, cur] : [cur, v];
      if (mode[0] === "V") {
        const start = offsets[a.row];
        const end = offsets[b.row] + lines[b.row].length;
        this.ta.setSelectionRange(start, end);
      } else {
        this.ta.setSelectionRange(a.idx, Math.min(text.length, charEnd(text, b.idx)));
      }
    } else {
      if (st.visual && mode === "\x16") this.vimVisual = at(st.visual[0], st.visual[1]);
      this.ta.setSelectionRange(cur.idx, cur.idx);
    }
    const wasCmdline = this.shownCmdline;
    this.shownCmdline = st.cmdline != null;
    let msg;
    if (st.cmdline != null) msg = st.cmdline;
    else if (st.push) msg = wasCmdline ? "" : this.statusMsg.textContent;
    else msg = st.err || "";
    const isErr = st.cmdline == null && (st.push ? !wasCmdline && this.statusMsg.classList.contains("err") : !!st.err);
    this.setStatus(modeName(mode), msg, this.vimInfo || "");
    this.statusMsg.classList.toggle("err", isErr);
    this.drawVimCursor();
    this.keepCaretVisible(cur);
  }

  drawVimCursor() {
    const cur = this.vimCursor;
    if (!this.vim || !cur) { this.vlayer.innerHTML = ""; return; }
    const mode = this.vimMode || "n";
    const insert = mode[0] === "i" || mode[0] === "R";
    this.root.classList.toggle("vim-insert", insert);
    if (mode[0] === "c") { this.vlayer.innerHTML = ""; return; }
    const padT = parseFloat(getComputedStyle(this.pre).paddingTop) || 10;
    const lh = this.lineHeight();
    const lines = this.ta.value.split("\n");
    const idxOf = (row, col) => {
      let i = 0;
      for (let r = 0; r < row; r++) i += lines[r].length + 1;
      return i + col;
    };
    let html = "";
    const v = this.vimVisual;
    if (v && mode === "\x16") {
      const [r0, r1] = [Math.min(v.row, cur.row), Math.max(v.row, cur.row)];
      const a = this.charBox(idxOf(v.row, v.col)), b = this.charBox(idxOf(cur.row, cur.col));
      const left = Math.min(a.left, b.left), right = Math.max(a.left + a.width, b.left + b.width);
      html += `<div class="vblock" style="left:${left}px;top:${padT + r0 * lh}px;width:${right - left}px;height:${(r1 - r0 + 1) * lh}px"></div>`;
    }
    const box = this.charBox(idxOf(cur.row, cur.col));
    const cls = insert ? "vcursor bar" : mode.startsWith("no") ? "vcursor half" : "vcursor";
    html += `<div class="${cls}" style="left:${box.left}px;top:${padT + cur.row * lh}px;width:${box.width}px;height:${lh}px"></div>`;
    this.vlayer.innerHTML = html;
  }

  vimError(m) {
    if (m.type === "stopped") {
      this.vimDead = true;
      this.setStatus("QUIT", m.message, "");
      return;
    }
    // The connection (and with it this Neovim) is gone: the next key starts a new one.
    if (m.type === "disconnected" || /isn't running/.test(m.message || "")) this.vimDead = true;
    this.setStatus("ERROR", m.message || "Neovim error", "");
    this.statusMsg.classList.add("err");
    if (m.type !== "error") this.onVimError(m);
    else if (/install|start Neovim/.test(m.message || "")) this.onVimError(m);
  }

  /** Clicking in the editor moves Neovim's cursor there. */
  vimClick() {
    if (!this.vim) return;
    if (this.ta.selectionStart !== this.ta.selectionEnd) return;
    const { row, col } = this.cursorRowCol();
    this.vim.cursor(row, col);
  }

  vimKey(e) {
    if (e.isComposing) return;
    // Let Ctrl+Shift+C / Ctrl+Shift+V copy and paste with the system clipboard.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && /^[cv]$/i.test(e.key)) return;
    const k = nvimKey(e);
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    if (this.vimDead) {
      // Neovim was quit with :q (or the connection was lost): start a fresh one with the
      // current text, then send it this key, so the key isn't lost.
      this.startVim(this.vimConfig);
    }
    this.vim.keys(k);
  }

  markErrors(lines) {
    this.errorLines = new Set(lines);
    this.render();
  }

  render() {
    const code = this.ta.value;
    // A trailing newline needs an extra line so the caret has room.
    this.pre.innerHTML = highlightRust(code) + "\n ";
    const n = code.split("\n").length;
    let g = "";
    for (let i = 1; i <= n; i++) g += `<div class="${this.errorLines.has(i) ? "err" : ""}">${i}</div>`;
    this.gutter.innerHTML = g;
    const lh = this.lineHeight();
    const pad = parseFloat(getComputedStyle(this.pre).paddingTop) || 10;
    this.marks.innerHTML = [...this.errorLines]
      .filter(l => l <= n)
      .map(l => `<div style="position:absolute;left:0;right:0;top:${pad + (l - 1) * lh}px;height:${lh}px;background:rgba(226,83,59,.18);border-left:3px solid #e2533b"></div>`)
      .join("");
  }

  lineHeight() {
    return parseFloat(getComputedStyle(this.pre).lineHeight) || 22;
  }

  /** Width of one character in the code font, measured inside the <pre> itself. */
  charWidth() {
    const probe = document.createElement("span");
    probe.textContent = "MMMMMMMMMM";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    this.pre.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 10;
    probe.remove();
    return w || 9;
  }

  /** Where the character at `idx` is drawn: { left, width } relative to the code area. */
  charBox(idx) {
    const base = this.pre.parentElement.getBoundingClientRect();
    const value = this.ta.value;
    if (value[idx] === undefined || value[idx] === "\n") {
      // No character to measure. A caret right after a newline is reported at the end of
      // the line above, so an empty line starts at the left edge, and the end of a line
      // comes right after its last character.
      if (idx === 0 || value[idx - 1] === "\n") {
        const pre = this.pre.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(this.pre).paddingLeft) || 0;
        return { left: pre.left + pad - base.left, width: this.charWidth() };
      }
      const prev = this.charBox(idx - (/[\udc00-\udfff]/.test(value[idx - 1]) && idx > 1 ? 2 : 1));
      return { left: prev.left + prev.width, width: this.charWidth() };
    }
    const walker = document.createTreeWalker(this.pre, NodeFilter.SHOW_TEXT);
    let node, rest = idx, last = null;
    while ((node = walker.nextNode())) {
      last = node;
      if (rest < node.length) break;
      rest -= node.length;
    }
    if (!node) { node = last; rest = last ? last.length : 0; }
    if (!node) return { left: 12, width: this.charWidth() };
    const range = document.createRange();
    const text = node.data;
    const ch = text[rest];
    if (ch !== undefined && ch !== "\n") {
      const end = Math.min(text.length, rest + (/[\ud800-\udbff]/.test(ch) ? 2 : 1));
      range.setStart(node, rest);
      range.setEnd(node, end);
      const r = range.getBoundingClientRect();
      if (r.width > 0) return { left: r.left - base.left, width: r.width };
    }
    // End of a line: place the cursor just after the previous character.
    range.setStart(node, rest);
    range.setEnd(node, rest);
    const rects = range.getClientRects();
    const r = rects[0] || range.getBoundingClientRect();
    return { left: r.left - base.left, width: this.charWidth() };
  }

  keepCaretVisible(at = null) {
    let line, idx;
    if (at) ({ row: line, idx } = at);
    else {
      idx = this.ta.selectionEnd;
      line = this.ta.value.slice(0, idx).split("\n").length - 1;
    }
    const lh = this.lineHeight();
    const y = 10 + line * lh;
    // Measure the drawn character: tabs and wide characters (CJK, emoji) aren't one column.
    const box = this.charBox(idx);
    const codeLeft = this.pre.parentElement.getBoundingClientRect().left - this.scroller.getBoundingClientRect().left + this.scroller.scrollLeft;
    const x = codeLeft + box.left;
    const right = x + box.width;
    const s = this.scroller;
    if (y < s.scrollTop) s.scrollTop = y - 4;
    else if (y + lh > s.scrollTop + s.clientHeight) s.scrollTop = y + lh - s.clientHeight + 8;
    if (x < s.scrollLeft + codeLeft + 10) s.scrollLeft = Math.max(0, x - codeLeft - 40);
    else if (right > s.scrollLeft + s.clientWidth - 20) s.scrollLeft = right - s.clientWidth + 60;
  }

  /** Insert text at the cursor, keeping the browser's undo history. */
  insert(text) {
    this.ta.focus();
    if (!document.execCommand("insertText", false, text)) {
      this.ta.setRangeText(text, this.ta.selectionStart, this.ta.selectionEnd, "end");
      this.ta.dispatchEvent(new Event("input"));
    }
  }

  onKey(e) {
    const ta = this.ta;
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); this.onRun(); return; }
    if (this.vim) { this.vimKey(e); return; }
    if (ta.readOnly) return;
    const { selectionStart: s, selectionEnd: end, value } = ta;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;

    if (e.key === "Tab") {
      e.preventDefault();
      if (s === end && !e.shiftKey) { this.insert("    "); return; }
      // Indent / dedent every selected line.
      const blockEnd = value.indexOf("\n", end - (end > s && value[end - 1] === "\n" ? 1 : 0));
      const stop = blockEnd === -1 ? value.length : blockEnd;
      const block = value.slice(lineStart, stop);
      const changed = block.split("\n").map(l => e.shiftKey ? l.replace(/^ {1,4}/, "") : "    " + l).join("\n");
      ta.setSelectionRange(lineStart, stop);
      this.insert(changed);
      ta.setSelectionRange(lineStart, lineStart + changed.length);
      return;
    }

    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const line = value.slice(lineStart, s);
      const indent = line.match(/^\s*/)[0];
      const prev = line.trimEnd().slice(-1);
      const next = value[end];
      if ("{([".includes(prev) && prev !== "" && "})]".includes(next ?? "x") && next) {
        this.insert("\n" + indent + "    " + "\n" + indent);
        const p = s + 1 + indent.length + 4;
        ta.setSelectionRange(p, p);
      } else if ("{([".includes(prev) && prev !== "") {
        this.insert("\n" + indent + "    ");
      } else {
        this.insert("\n" + indent);
      }
      this.keepCaretVisible();
      return;
    }

    if (e.key === "}" && s === end) {
      const line = value.slice(lineStart, s);
      if (/^\s+$/.test(line) && line.length >= 4) {
        e.preventDefault();
        ta.setSelectionRange(s - 4, s);
        this.insert("}");
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      const stopIdx = value.indexOf("\n", end);
      const stop = stopIdx === -1 ? value.length : stopIdx;
      const lines = value.slice(lineStart, stop).split("\n");
      const allCommented = lines.every(l => /^\s*\/\//.test(l) || !l.trim());
      const changed = lines.map(l => allCommented ? l.replace(/^(\s*)\/\/ ?/, "$1") : (l.trim() ? l.replace(/^(\s*)/, "$1// ") : l)).join("\n");
      ta.setSelectionRange(lineStart, stop);
      this.insert(changed);
    }
  }
}

/** Find line numbers that rustc complains about (`--> main.rs:LINE:COL`). */
export function errorLinesFrom(compilerOutput, maxLine = Infinity) {
  const lines = new Set();
  const re = /-->\s*main\.rs:(\d+):\d+/g;
  let m;
  let block = "";
  for (const chunk of compilerOutput.split(/\n(?=error|warning)/)) {
    block = chunk;
    if (!block.startsWith("error")) continue;
    re.lastIndex = 0;
    while ((m = re.exec(block))) {
      const n = parseInt(m[1], 10);
      if (n <= maxLine) lines.add(n);
    }
  }
  return lines;
}
