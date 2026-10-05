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
    this.ta.addEventListener("keydown", e => this.onKey(e));
    this.ta.addEventListener("click", () => this.keepCaretVisible());
    this.ta.addEventListener("mouseup", () => this.vimClick());
    this.ta.addEventListener("paste", e => {
      if (!this.vim) return;
      e.preventDefault();
      this.vim.paste(e.clipboardData.getData("text"));
    });
    this.render();
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
    if (this.vim && this.vimConfig === useConfig) return;
    this.disableVim();
    this.vimConfig = useConfig;
    this.vimDead = false;
    this.vim = new VimBridge({ onState: st => this.applyVim(st), onError: m => this.vimError(m) });
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

  destroy() { this.disableVim(); }

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
        this.ta.setSelectionRange(a.idx, Math.min(text.length, b.idx + 1));
      }
    } else {
      if (st.visual && mode === "\x16") this.vimVisual = at(st.visual[0], st.visual[1]);
      this.ta.setSelectionRange(cur.idx, cur.idx);
    }
    const msg = st.cmdline ?? (st.err || "");
    this.setStatus(modeName(mode), msg, this.vimInfo || "");
    this.statusMsg.classList.toggle("err", !st.cmdline && !!st.err);
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
      // Neovim was quit with :q; start a fresh one with the current text.
      const cfg = this.vimConfig;
      this.disableVim();
      this.enableVim(cfg);
      return;
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
    let line, col;
    if (at) ({ row: line, col } = at);
    else {
      const pos = this.ta.selectionEnd;
      const before = this.ta.value.slice(0, pos);
      line = before.split("\n").length - 1;
      col = pos - before.lastIndexOf("\n") - 1;
    }
    const lh = this.lineHeight();
    const y = 10 + line * lh;
    const x = this.gutter.offsetWidth + 12 + col * this.charWidth();
    const s = this.scroller;
    if (y < s.scrollTop) s.scrollTop = y - 4;
    else if (y + lh > s.scrollTop + s.clientHeight) s.scrollTop = y + lh - s.clientHeight + 8;
    if (x < s.scrollLeft + this.gutter.offsetWidth + 10) s.scrollLeft = Math.max(0, x - this.gutter.offsetWidth - 40);
    else if (x > s.scrollLeft + s.clientWidth - 20) s.scrollLeft = x - s.clientWidth + 60;
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
