// Ferris' Forge — game UI.
import { api } from "./api.js";
import { Editor, errorLinesFrom, escapeHtml } from "./editor.js";
import { renderMarkdown } from "./md.js";
import { Ferris, grassTileURL } from "./sprites.js";
import { TitleScene } from "./title.js";
import { LogoSign } from "./logo.js";
import { WorldMap } from "./map.js";
import { sound } from "./sound.js";
import { applyIcons, pixelIcon, pixelGlyph } from "./icons.js";

const $ = sel => document.querySelector(sel);
/** A symbol like ✔ or ▶ with proper spacing after it (the pixel font's space is tiny). */
const sym = ch => `<span class="sym">${pixelGlyph(ch) || ch}</span>`;
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/** The number a level is shown with (its position), from its internal id. */
function levelNum(id) {
  for (const w of S.game?.worlds || []) {
    const l = w.levels.find(x => x.id === id);
    if (l) return l.num;
  }
  return id;
}

/** Levels you answer (predict the output, or a concept quiz) instead of coding. */
const answers = kind => kind === "predict" || kind === "quiz";

const KIND_INFO = {
  fix: { icon: "🔧", label: "Fix it" },
  fill: { icon: "✍️", label: "Fill it" },
  predict: { icon: "🔮", label: "Predict it" },
  boss: { icon: "👹", label: "Boss fight" },
  quiz: { icon: "📖", label: "Quiz" },
};
const HINT_COST = ["", "−10% XP", "−30% XP", "−60% XP"];

const S = {
  game: null,
  models: [],
  level: null,
  lastRun: null,
  running: false,
  talking: false,
  history: loadHistory(),
  screen: "title",
  quizSolved: false,
};

let editor, ferris, worldMap, titleFerris;
let draftTimer = null;

// ---------------------------------------------------------------- helpers

function loadHistory() {
  try { return JSON.parse(localStorage.getItem("ff-history") || "{}"); } catch { return {}; }
}
function saveHistory() {
  try { localStorage.setItem("ff-history", JSON.stringify(S.history)); } catch { /* storage unavailable */ }
}

/** A short message. `text` is HTML: escape anything that comes from outside the game
 *  (error messages, Neovim) with escapeHtml. */
function toast(icon, text) {
  const t = el("div", "toast frame-wood", `<span class="t-icon">${icon}</span><span>${text}</span>`);
  $("#toast-root").appendChild(t);
  setTimeout(() => t.remove(), 3700);
}

function floatXP(amount, anchor) {
  const r = (anchor || $("#hud-xp")).getBoundingClientRect();
  const f = el("div", "float-xp", `+${amount} XP`);
  f.style.left = `${r.left + r.width / 2 - 50}px`;
  f.style.top = `${r.top - 10}px`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1700);
}

/** The fanfare after a world's last level. After the very last island there is no new one to find. */
function worldClearedBanner(lv, nextId) {
  sound.fanfare();
  banner(`${lv.world.name} cleared!`, nextId ? "A new island appears on the map…" : "You've cleared every island. You're a true Rustacean! 🦀");
}

function banner(title, sub) {
  const b = el("div", "banner frame-wood", `${title}<small>${sub}</small>`);
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 3600);
}

function confetti() {
  const c = $("#fx-canvas");
  const scale = 4;
  c.width = Math.ceil(innerWidth / scale);
  c.height = Math.ceil(innerHeight / scale);
  const ctx = c.getContext("2d");
  const colors = ["#ffd54a", "#f2601c", "#7ee05a", "#6cc6ff", "#ff9fd0", "#fff2cf"];
  const parts = Array.from({ length: 140 }, () => ({
    x: c.width / 2 + (Math.random() - 0.5) * 40,
    y: c.height * 0.45,
    vx: (Math.random() - 0.5) * 3.2,
    vy: -Math.random() * 3.5 - 1,
    col: colors[Math.floor(Math.random() * colors.length)],
    s: Math.random() < 0.3 ? 2 : 1,
  }));
  const start = performance.now();
  (function tick(t) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.vy += 0.08; p.x += p.vx; p.y += p.vy;
      ctx.fillStyle = p.col;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    if (t - start < 2600) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, c.width, c.height);
  })(start);
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])';

function openModal({ title, body, wide = false, onClose } = {}) {
  sound.open();
  const opener = document.activeElement;
  const backdrop = el("div", "backdrop");
  const modal = el("div", `modal frame-parchment${wide ? " wide" : ""}`);
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  if (title) modal.setAttribute("aria-label", title.replace(/<[^>]*>/g, ""));
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", esc);
    onClose?.();
    // Give focus back to whatever opened the popup.
    if (opener && document.contains(opener) && document.activeElement === document.body) opener.focus?.();
  };
  const esc = e => {
    if (e.key === "Escape") { close(); return; }
    if (e.key !== "Tab") return;
    // Keep Tab inside the popup.
    const items = [...modal.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const x = el("button", "modal-close");
  x.title = "Close";
  x.setAttribute("aria-label", "Close");
  x.onclick = close;
  modal.append(x);
  if (title) modal.append(el("div", "modal-title", title));
  const b = el("div", "modal-body");
  if (typeof body === "string") b.innerHTML = body; else if (body) b.append(body);
  modal.append(b);
  backdrop.append(modal);
  backdrop.addEventListener("mousedown", e => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", esc);
  $("#modal-root").append(backdrop);
  // Start with focus inside the popup: its first field or main button, else Close.
  requestAnimationFrame(() => {
    if (modal.contains(document.activeElement)) return;
    const target = b.querySelector("input, textarea, .wood-btn.green, " + FOCUSABLE) || x;
    target.focus({ preventScroll: true });
  });
  return { modal, body: b, close };
}

function confirmModal(title, text, ok = "Yes") {
  return new Promise(resolve => {
    let answered = false;
    const body = el("div", "", `<p style="font-family:var(--font-talk);font-size:22px;margin:0">${text}</p>`);
    const foot = el("div", "modal-foot");
    const no = el("button", "wood-btn small", "Cancel");
    const yes = el("button", "wood-btn small green", ok);
    foot.append(no, yes);
    body.append(foot);
    const m = openModal({ title, body, onClose: () => { if (!answered) resolve(false); } });
    no.onclick = () => { answered = true; resolve(false); m.close(); };
    yes.onclick = () => { answered = true; resolve(true); m.close(); };
  });
}

function modelLabel(id) {
  const m = S.models.find(m => m.id === id);
  if (m) return m.name.replace("Claude ", "");
  return id;
}

// ---------------------------------------------------------------- HUD

let shownSaveError = null;

function updateHUD() {
  const g = S.game;
  if (!g) return;
  setSaveStatus(g.player.save_error || null);
  if (g.notice) { toast("⚠", escapeHtml(g.notice)); g.notice = null; }
  const p = g.player;
  $("#hud-name").textContent = p.name || "Adventurer";
  const next = p.next_rank;
  $("#hud-rank").textContent = next ? `${p.rank} · next: ${next.name} at ${next.xp} XP` : `${p.rank} · max rank!`;
  const floor = [...(p.ranks || [])].reverse().find(r => p.xp >= r.xp)?.xp ?? 0;
  const pct = next ? ((p.xp - floor) / (next.xp - floor)) * 100 : 100;
  $("#xp-fill").style.width = `${Math.max(2, Math.min(100, pct))}%`;
  $("#mini-xp-fill").style.width = `${Math.max(2, Math.min(100, pct))}%`;
  $(".hud-clock").title = `${p.name || "Adventurer"} · ${p.rank}` + (next ? ` · ${next.xp - p.xp} XP to ${next.name}` : " · max rank!");
  $("#hud-xp").textContent = p.xp.toLocaleString();
  updateClock();
  updateEnergy(g.usage);
  updateModelChip();
}

/** The rank ladder: ranks reached, the current one, and the XP each upcoming one needs. */
function openRanks() {
  const p = S.game.player;
  if (!p.ranks) return toast("⚠", "Restart the game (Ctrl+C, then cargo run) to see the ranks.");
  const body = el("div", "ranks");
  const current = p.ranks.findLastIndex(r => p.xp >= r.xp);
  const list = el("div", "rank-list");
  p.ranks.forEach((r, i) => {
    const row = el("div", `rank-row${i < current ? " reached" : i === current ? " current" : ""}`);
    const mark = i < current ? sym("✔") : i === current ? "⭐" : "🔒";
    let note;
    if (i < current) note = "reached";
    else if (i === current) note = "you are here";
    else note = `${(r.xp - p.xp).toLocaleString()} XP to go`;
    row.innerHTML = `<span class="rank-mark">${mark}</span><span class="rank-name">${escapeHtml(r.name)}</span>`
      + `<span class="rank-xp">${r.xp.toLocaleString()} XP</span><span class="rank-note">${note}</span>`;
    if (i === current + 1) {
      const floor = p.ranks[current].xp;
      const pct = Math.max(2, Math.min(100, ((p.xp - floor) / (r.xp - floor)) * 100));
      const bar = el("div", "xp-bar rank-bar");
      bar.append(el("div", "xp-fill"));
      bar.firstChild.style.width = `${pct}%`;
      row.append(bar);
    }
    list.append(row);
  });
  body.append(el("p", "rank-total", `${escapeHtml(p.name || "Adventurer")} has <b>${p.xp.toLocaleString()} XP</b>.`), list);
  // How far the islands built so far can take you.
  const left = S.game.worlds.flatMap(w => w.levels).filter(l => l.status !== "done").reduce((sum, l) => sum + l.xp, 0);
  if (left) body.append(el("p", "muted", `${left.toLocaleString()} XP is still waiting in the levels built so far (before hint costs), plus +15 for each idiomatic code review.`));
  openModal({ title: "🏅 Ranks", body });
}

function updateClock() {
  const p = S.game?.player;
  const now = new Date();
  const day = now.toLocaleDateString(undefined, { weekday: "short" });
  $("#hud-date").textContent = `${day}. ${now.getDate()}${p?.streak > 1 ? ` · 🔥${p.streak}` : ""}`;
  $("#hud-date").title = p ? `Days played: ${p.days} · Streak: ${p.streak} day(s)` : "";
  $("#hud-time").textContent = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function updateEnergy(usage) {
  const fill = $("#energy-fill");
  const box = $("#energy");
  fill.className = "energy-fill";
  if (S.game?.settings.teacher === "offline") {
    fill.style.height = "100%";
    fill.classList.add("unknown");
    box.title = "Ferris is in offline mode, so he isn't using your Claude subscription.";
    return;
  }
  if (!usage || usage.five_hour == null) {
    fill.style.height = "100%";
    fill.classList.add("unknown");
    box.title = "Claude energy: unknown until Ferris answers something.\nThis shows how much of your Claude plan's limit is left.";
    return;
  }
  const left = Math.max(0, 1 - usage.five_hour);
  fill.style.height = `${Math.round(left * 100)}%`;
  if (left < 0.15) fill.classList.add("low"); else if (left < 0.4) fill.classList.add("mid");
  const when = ts => ts ? new Date(ts * 1000).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "?";
  let tip = `Claude energy (your subscription)\n5-hour window: ${Math.round(left * 100)}% left · refills ${when(usage.five_hour_resets)}`;
  if (usage.seven_day != null) tip += `\nWeekly: ${Math.round((1 - usage.seven_day) * 100)}% left · refills ${when(usage.seven_day_resets)}`;
  box.title = tip;
}

function updateModelChip() {
  const chip = $("#model-chip");
  const s = S.game?.settings;
  if (!s) return;
  if (s.teacher === "offline") {
    chip.textContent = "💤 offline";
    chip.classList.add("offline");
  } else {
    chip.textContent = `🧠 ${modelLabel(s.model)}`;
    chip.classList.remove("offline");
  }
  chip.title = `Ferris' brain: ${s.teacher === "offline" ? "offline (built-in hints)" : `${modelLabel(s.model)} · effort ${s.effort}`}\nClick to switch models.`;
}

/** The code font setting. Changing it moves the text, so the Vim cursor is redrawn too. */
function applyCodeFont() {
  const pixel = S.game.settings.code_font === "pixel";
  if (document.body.classList.contains("code-pixel") === pixel) return;
  document.body.classList.toggle("code-pixel", pixel);
  requestAnimationFrame(() => editor?.relayout());
}

async function refreshState() {
  S.game = await api.state();
  sound.setEnabled(S.game.settings.sound);
  applyCodeFont();
  document.body.classList.toggle("readable", !!S.game.settings.readable_text);
  updateHUD();
  applyVimSetting();
  return S.game;
}

/** Turn Vim mode on or off for the level editor (never on read-only predict levels). */
function applyVimSetting() {
  const s = S.game?.settings;
  if (!s || !editor) return;
  const btn = $("#btn-vim");
  btn.classList.toggle("on", !!s.vim);
  btn.title = s.vim ? "Vim mode is ON (your Neovim). Click to turn it off." : "Vim mode is OFF. Click to edit with your own Neovim.";
  const want = s.vim && S.level && !answers(S.level.kind);
  if (want) editor.enableVim(s.nvim_config);
  else editor.turnOffVim();
}

// ---------------------------------------------------------------- screens

function show(screen) {
  S.screen = screen;
  document.body.dataset.screen = screen;
  for (const s of document.querySelectorAll(".screen")) s.classList.remove("active");
  $(`#${screen}-screen`).classList.add("active");
  $("#hud").classList.toggle("hidden", screen === "title");
  if (screen === "map") worldMap.start(); else worldMap.stop();
}

/** The level the player was on when they opened the map (for the "Back" button). */
let returnLevel = null;

async function showMap() {
  if (S.screen === "level" && S.level) returnLevel = { id: S.level.id, num: S.level.num, title: S.level.title };
  await refreshState();
  const g = S.game;
  const nextId = g.next_level;
  let current = 0;
  if (nextId) current = g.worlds.findIndex(w => w.levels.some(l => l.id === nextId));
  else current = Math.max(0, g.worlds.filter(w => w.available).length - 1);
  show("map");
  const back = $("#btn-map-back");
  back.classList.toggle("hidden", !returnLevel);
  if (returnLevel) back.innerHTML = `${pixelIcon("back", 2)}<span>Back to ${escapeHtml(returnLevel.num)} ${escapeHtml(returnLevel.title)}</span>`;
  worldMap.setWorlds(g.worlds, current);
  requestAnimationFrame(() => worldMap.scrollToCurrent());
}

/** A planned (not yet built) level as a greyed-out board row. */
function plannedRow(pl) {
  const row = el("div", "board-item planned");
  const icon = pixelIcon(KIND_INFO[pl.kind] ? pl.kind : "predict", 2);
  const books = pl.book.map(b => `<span class="bi-book">📖 ${escapeHtml(b)}</span>`).join("");
  row.innerHTML = `<span class="bi-icon">${icon}</span><span class="bi-id">🚧</span>`
    + `<span class="bi-main"><span class="bi-title">${escapeHtml(pl.title)}</span><span class="bi-about">${escapeHtml(pl.about)}</span><span class="bi-books">${books}</span></span>`
    + `<span class="bi-status">soon</span>`;
  return row;
}

function openWorldBoard(world) {
  sound.click();
  const body = el("div");
  const tag = world.tag === "project" ? "🛠 Project island · " : world.tag === "bonus" ? "📚 Bonus island · " : "";
  body.append(el("p", "muted", `${tag}${escapeHtml(world.blurb)}`));
  if (world.chapters?.length) body.append(el("p", "board-chapters", `📖 ${world.chapters.map(escapeHtml).join(" · ")}`));
  if (!world.available) {
    body.append(el("p", "board-soon", "🚧 This island is still being built. Here's what it will teach:"));
  } else if (!world.unlocked) {
    const prev = S.game.worlds.find(w => w.id === world.id - 1);
    body.append(el("p", "board-soon", `🔒 Clear the last level of ${escapeHtml(prev ? prev.name : "the previous island")} to play here. You can read the lessons already.`));
  }
  const list = el("div", "board-list");
  for (const l of world.levels) {
    const row = el("div", "board-row");
    const b = el("button", `board-item${l.kind === "boss" ? " boss" : ""}${l.status === "locked" ? " locked" : ""}`);
    let status = "";
    if (l.status === "done") status = `${sym("✔")}${l.earned} XP`;
    else if (l.status === "skipped") status = `${sym("⏭")}skipped`;
    else if (l.status === "locked") status = "🔒";
    else status = `${l.xp} XP`;
    b.innerHTML = `<span class="bi-icon">${pixelIcon(l.kind, 2)}</span><span class="bi-id">${l.num}</span><span class="bi-title">${escapeHtml(l.title)}</span><span class="bi-status">${status}</span>`;
    const read = () => { m.close(); previewLesson(l, world); };
    b.onclick = l.status === "locked" ? read : () => { m.close(); openLevel(l.id); };
    if (l.status === "locked") b.title = "Locked: click to read the lesson";
    const lesson = el("button", "bi-lesson", "📜");
    lesson.title = "Read the lesson";
    lesson.setAttribute("aria-label", `Read the lesson for ${l.num} ${l.title}`);
    lesson.onclick = read;
    row.append(b, lesson);
    list.append(row);
  }
  if (world.available && world.planned?.length) list.append(el("div", "board-divider", "🚧 Coming later on this island"));
  for (const pl of world.planned || []) list.append(plannedRow(pl));
  body.append(list);
  const m = openModal({ title: `${world.id}. ${world.name}`, body, wide: !world.available });
}

// ---------------------------------------------------------------- level

async function openLevel(id) {
  // Wait for every queued save, or the level could load an older draft than the editor had.
  await flushDraft();
  let lv;
  try {
    lv = await api.level(id);
  } catch (e) {
    await showMap();
    // A locked level (e.g. from an old link or shortcut): explain how to unlock it.
    const level = e.status === 403 && S.game.worlds.flatMap(w => w.levels).find(l => l.id === id);
    if (level) previewLesson(level, null);
    else toast("⚠", escapeHtml(e.message));
    return;
  }
  S.level = lv;
  S.lastRun = null;
  closeQuickMenu();
  S.quizSolved = lv.done;
  show("level");

  $("#lv-world").textContent = `World ${lv.world.id}: ${lv.world.name} · Level ${lv.index}/${lv.count}`;
  $("#lv-title").textContent = `${lv.num} ${lv.title}`;
  const kind = $("#lv-kind");
  kind.className = `badge ${lv.kind}`;
  kind.innerHTML = `${pixelIcon(lv.kind, 1)}<span>${KIND_INFO[lv.kind].label}</span>`;
  const xp = $("#lv-xp");
  xp.className = `badge xp${lv.done ? " done" : ""}`;
  xp.innerHTML = lv.done ? `${sym("✔")}Cleared` : `${lv.xp} XP`;

  const goalBox = $("#lv-goal");
  goalBox.textContent = lv.goal;
  goalBox.classList.remove("open");
  goalBox.title = "Click to show or hide the whole goal";
  // Only offer "more" when there's at least one whole extra line hidden.
  requestAnimationFrame(() => {
    const line = parseFloat(getComputedStyle(goalBox).lineHeight) || 22;
    goalBox.classList.toggle("long", goalBox.scrollHeight - goalBox.clientHeight > line * 0.6);
  });

  const predict = answers(lv.kind);
  document.querySelector(".left-col").classList.toggle("predict", predict);
  // Quizzes with no code hide the editor; the question and answers fill the column.
  document.querySelector(".left-col").classList.toggle("no-code", lv.kind === "quiz" && !lv.starter.trim());
  // Code whose save failed is newer than the server's copy: keep it and try saving again.
  const unsaved = unsavedDrafts.get(lv.id);
  editor.value = unsaved ?? lv.code;
  if (unsaved !== undefined) saveDraft(lv.id, unsaved);
  fitPredictCode();
  editor.setReadOnly(predict);
  applyVimSetting();
  $("#editor-status").textContent = predict ? "read-only: just read it!" : lv.check === "tests" ? "checked by Ferris' tests" : "checked by its output";

  // Results live in the console popup (hotbar: Compiler / Output / Expected or Tests).
  resetConsole();
  renderChoices();

  buildHotbar();
  renderDialogue();
  renderQuickActions();
  ferris.setMood("idle");
  if (!lv.done && lv.lesson && !seenLessons().has(lv.id)) setTimeout(() => openLesson(), 250);
  else if (!predict) setTimeout(() => editor.focus(), 50);
}

function seenLessons() {
  try { return new Set(JSON.parse(localStorage.getItem("ff-seen-lessons") || "[]")); } catch { return new Set(); }
}

function markLessonSeen(id) {
  const seen = seenLessons();
  seen.add(id);
  try { localStorage.setItem("ff-seen-lessons", JSON.stringify([...seen])); } catch { /* ignore */ }
}

/** The lesson as a parchment letter, with tabs for the C and Python comparisons. */
/** Tabs (Lesson / In C / In Python), the goal, the text and the book links for a level. */
function lessonContent(lv, tab, { goal = true } = {}) {
  const tabs = [["lesson", "Rust", lv.lesson], ["c", "In C", lv.c_compare], ["py", "In Python", lv.py_compare]].filter(t => t[2]);
  const body = el("div", "lesson-content");
  const tabBar = el("div", "tabs");
  const text = el("div", "lesson-body md");
  const show = key => {
    for (const b of tabBar.children) b.classList.toggle("active", b.dataset.tab === key);
    text.innerHTML = renderMarkdown(tabs.find(t => t[0] === key)?.[2] || "");
    text.scrollTop = 0;
  };
  for (const [key, label] of tabs) {
    const b = el("button", "", label);
    b.dataset.tab = key;
    b.onclick = () => { sound.click(); show(key); };
    tabBar.append(b);
  }
  if (tabs.length > 1) body.append(tabBar);
  if (goal) {
    const g = el("div", "goal lesson-goal");
    g.textContent = lv.goal;
    body.append(g);
  }
  body.append(text);
  if (lv.book?.length) {
    const links = el("div", "book-links");
    links.append(el("span", "", "📖 In the Rust Book:"));
    for (const b of lv.book) {
      const a = el("a", "", `${escapeHtml(b.id)} ${escapeHtml(b.title)} ↗`);
      a.href = b.url;
      a.target = "_blank";
      a.rel = "noopener";
      links.append(a);
    }
    body.append(links);
  }
  show(tabs.some(t => t[0] === tab) ? tab : "lesson");
  return body;
}

/** Why a level is locked: the level just before the first locked one is the one to clear. */
function unlockHint(id) {
  const all = S.game.worlds.flatMap(w => w.levels);
  const i = all.findIndex(l => l.id === id);
  const firstLocked = all.findIndex((l, j) => j <= i && l.status === "locked");
  const blocker = firstLocked > 0 ? all[firstLocked - 1] : null;
  return blocker
    ? `Clear <b>${escapeHtml(blocker.num)} ${escapeHtml(blocker.title)}</b> to unlock it.`
    : "Clear the levels before it to unlock it.";
}

/** A level's lesson from the world board, even when the level is still locked.
 *  Closing it goes back to the board (if there is one). */
async function previewLesson(level, world) {
  const locked = level.status === "locked";
  let lv = null, problem = null;
  try {
    lv = await api.lesson(level.id);
  } catch (e) {
    problem = e.message;
  }
  const body = el("div", "lesson-popup");
  if (locked) {
    const note = el("div", "lock-note");
    note.innerHTML = `<span class="lock-icon">🔒</span><span>This level is still locked. ${unlockHint(level.id)}${lv ? " Until then, here's what it teaches." : ""}</span>`;
    body.append(note);
  }
  if (lv) body.append(lessonContent(lv, "lesson"));
  else body.append(el("p", "muted", `The lesson couldn't be loaded. ${escapeHtml(problem || "")}`));
  const foot = el("div", "modal-foot");
  const back = el("button", "wood-btn small", world ? "⬅ Back to the island" : "OK");
  foot.append(back);
  body.append(foot);
  if (!locked && !lv) sound.fail();
  const m = openModal({ title: `${level.num} ${escapeHtml(level.title)}`, body, wide: !!lv, onClose: () => { if (world) openWorldBoard(world); } });
  back.onclick = () => m.close();
}

/** Lesson button / L key: the lesson popup (with In C / In Python tabs inside). */
function toggleLesson(tab = "lesson") {
  openLesson(tab);
}

function openLesson(tab = "lesson") {
  const lv = S.level;
  if (!lv) return;
  const body = el("div", "lesson-popup");
  body.append(lessonContent(lv, tab));
  const foot = el("div", "modal-foot");
  const go = el("button", "wood-btn small green", answers(lv.kind) ? "Got it, let me read the code ➜" : "Got it, let's code! ➜");
  foot.append(go);
  body.append(foot);
  const m = openModal({ title: `${lv.num} ${lv.title}`, body, wide: true, onClose: () => { if (!answers(lv.kind)) editor.focus(); } });
  go.onclick = () => m.close();
  markLessonSeen(lv.id);
}

/** A new level (or a code reset): no results yet, no alert badges. */
function resetConsole() {
  S.lastRun = null;
  S.unseen = {};
  updateConsoleBadges();
}

function colorizeCompiler(text) {
  return escapeHtml(text)
    .replace(/^(error(\[E\d+\])?:?.*)$/gm, '<span class="c-err">$1</span>')
    .replace(/^(warning(\[\w+\])?:?.*)$/gm, '<span class="c-warn">$1</span>')
    .replace(/^(\s*= help:.*|help:.*)$/gm, '<span class="c-help">$1</span>')
    .replace(/(--&gt; main\.rs:\d+:\d+)/g, '<span class="c-loc">$1</span>')
    .replace(/^(test .* ok)$/gm, '<span class="c-ok">$1</span>')
    .replace(/^(test .* FAILED)$/gm, '<span class="c-err">$1</span>')
    .replace(/^(test result: ok\..*)$/gm, '<span class="c-ok">$1</span>')
    .replace(/^(test result: FAILED\..*)$/gm, '<span class="c-err">$1</span>');
}

/** Expected output and the program's output side by side; differing lines are highlighted. */
function outputDiff(expected, actual) {
  const clean = t => t.replace(/\s+$/, "").split("\n").map(l => l.replace(/\s+$/, ""));
  const exp = clean(expected || "");
  const got = actual.trim() ? clean(actual) : [];
  const rows = Math.max(exp.length, got.length);
  let html = `<table class="out-diff"><thead><tr><th></th><th>Expected</th><th>Your program printed</th></tr></thead><tbody>`;
  for (let i = 0; i < rows; i++) {
    const e = exp[i], g = got[i];
    const ok = e === g;
    const cell = v => v === undefined ? '<span class="missing">(nothing)</span>' : (escapeHtml(v) || "&nbsp;");
    html += `<tr class="${ok ? "same" : "diff"}"><td class="ln">${ok ? "✓" : "✗"}</td><td>${cell(e)}</td><td>${cell(g)}</td></tr>`;
  }
  return html + "</tbody></table>";
}

/** Which console tabs this level has. */
function consoleTabs() {
  const lv = S.level;
  const tabs = [["compiler", "Compiler"], ["output", lv.check === "tests" && !answers(lv.kind) ? "Test results" : "Output"]];
  if (!answers(lv.kind) && lv.check === "tests") tabs.push(["tests", "Tests"]);
  else if (!answers(lv.kind) && lv.expected_output) tabs.push(["expected", "Expected"]);
  return tabs;
}

/** One-line summary of the last run (or a hint when nothing has run yet). */
function consoleSummary() {
  const r = S.lastRun;
  if (!r) {
    const how = `Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> or ${sym("▶")}Run to compile.`;
    return { cls: "", html: answers(S.level?.kind) ? "Answer first, then run the code to see what it really does." : how };
  }
  // The side-by-side comparison in the Output tab replaces the "Expected: ..." text.
  const text = S.level?.expected_output ? r.summary.split("\nExpected:")[0] : r.summary;
  return { cls: r.passed ? "pass" : r.compiled ? "warn" : "fail", html: sym(r.passed ? "✔" : r.compiled ? "⚠" : "✘") + escapeHtml(text) };
}

/** The HTML for one console tab. */
function consoleTabHTML(tab) {
  const r = S.lastRun;
  const lv = S.level;
  const pre = t => `<pre class="console-text">${t}</pre>`;
  if (tab === "expected") {
    // What the game gives the program (input, arguments, settings, files), then the expected output.
    let given = "";
    if (lv.args?.length) given += `<div class="console-label">Command-line arguments:</div>${pre(escapeHtml(lv.args.join(" ")))}`;
    const env = Object.entries(lv.env || {});
    if (env.length) given += `<div class="console-label">Environment variables:</div>${pre(escapeHtml(env.map(([k, v]) => `${k}=${v}`).join("\n")))}`;
    if (lv.files?.length) given += `<div class="console-label">Files next to your program:</div>${pre(escapeHtml(lv.files.join("\n")))}`;
    if (lv.stdin) given += `<div class="console-label">The game types this for you:</div>${pre(escapeHtml(lv.stdin.trimEnd()))}`;
    if (given) given += `<div class="console-label">Expected output:</div>`;
    return given + pre(escapeHtml(lv.expected_output?.trim() || ""));
  }
  if (tab === "tests") return renderMarkdown("These are the tests Ferris runs on your code:\n```rust\n" + (lv.tests || "").trim() + "\n```");
  if (!r) return `<p class="console-empty">Nothing here yet. Run your code first.</p>`;
  if (tab === "compiler") return pre(r.compiler.trim() ? colorizeCompiler(r.compiler) : '<span class="c-ok">No compiler messages. Clean build! ✨</span>');
  if (!r.compiled) return `<p class="console-empty">The program didn't run because it doesn't compile yet. Check the Compiler tab.</p>`;
  if (lv.check === "tests" && !answers(lv.kind)) return pre(colorizeCompiler((r.stdout || "") + (r.stderr ? `\n${r.stderr}` : "")) || "(no test output)");
  if (lv.check === "output" && !answers(lv.kind) && lv.expected_output) {
    return outputDiff(lv.expected_output, r.stdout || "") + (r.stderr ? pre(`<span class="c-err">${escapeHtml(r.stderr)}</span>`) : "");
  }
  return pre(escapeHtml((r.stdout || "") + (r.stderr ? `\n${r.stderr}` : "")) || "(the program printed nothing)");
}

/** The console as a popup, opened from the hotbar (Compiler, or Output with its Expected / Tests tab). */
function openConsole(tab = "compiler") {
  const lv = S.level;
  if (!lv) return;
  const tabs = consoleTabs();
  if (!tabs.some(t => t[0] === tab)) tab = tabs[0][0];
  const wrap = el("div", "console-popup frame-dark");
  const bar = el("div", "tabs dark");
  const sum = el("div", "console-summary");
  const body = el("div", "console-body");
  const show = key => {
    for (const b of bar.children) b.classList.toggle("active", b.dataset.tab === key);
    body.innerHTML = consoleTabHTML(key);
    body.scrollTop = 0;
    if (key === "compiler" || key === "output") { delete S.unseen[key]; updateConsoleBadges(); }
  };
  for (const [key, label] of tabs) {
    const b = el("button", "", label);
    b.dataset.tab = key;
    b.onclick = () => { sound.click(); show(key); };
    bar.append(b);
  }
  const summary = consoleSummary();
  sum.className = `console-summary ${summary.cls}`;
  sum.innerHTML = summary.html;
  wrap.append(bar, sum, body);
  const outer = el("div");
  outer.append(wrap);
  if (S.lastRun && !S.lastRun.passed && !answers(lv.kind)) {
    const foot = el("div", "modal-foot");
    const ask = el("button", "wood-btn small purple", "🔍 Explain this to me");
    ask.onclick = () => { m.close(); askFerris("explain"); };
    foot.append(ask);
    outer.append(foot);
  }
  const m = openModal({ title: "Console", body: outer, wide: true });
  show(tab);
}

/** The pixel "!" on the Compiler / Output buttons after a run, until you look. */
function updateConsoleBadges() {
  const u = S.unseen || {};
  for (const [id, kind] of [["compiler", u.compiler], ["output", u.output ? "new" : null]]) {
    for (const slot of document.querySelectorAll(`[data-console="${id}"]`)) {
      let badge = slot.querySelector(".slot-badge");
      if (!kind) { badge?.remove(); continue; }
      if (!badge) { badge = el("span", "slot-badge"); slot.append(badge); }
      badge.innerHTML = pixelIcon(kind === "error" ? "alert" : "alertYellow", 2);
      badge.title = kind === "error" ? "The compiler found errors" : kind === "warn" ? "The compiler has warnings" : "New output";
    }
  }
}

function runOutputText() {
  const r = S.lastRun;
  if (!r) return "";
  let t = `${r.summary}\n`;
  if (r.compiler.trim()) t += `\n[compiler]\n${r.compiler}`;
  if (r.stdout.trim()) t += `\n[program output]\n${r.stdout}`;
  if (r.stderr.trim()) t += `\n[stderr]\n${r.stderr}`;
  return t;
}

function showRunResult(r) {
  S.lastRun = r;
  const userLines = editor.value.split("\n").length;
  editor.markErrors(errorLinesFrom(r.compiler, userLines));
  // Alert badges: red "!" for compile errors, yellow for warnings or new output.
  S.unseen = {
    compiler: !r.compiled ? "error" : /^warning/m.test(r.compiler) ? "warn" : null,
    output: r.compiled,
  };
  updateConsoleBadges();
}

async function runCode() {
  const lv = S.level;
  if (!lv || S.running) return;
  if (lv.kind === "quiz") return;
  if (answers(lv.kind)) return runPredict();
  S.running = true;
  setSlotBusy("run", true);
  sound.compile();
  ferris.setMood("thinking");
  try {
    // Vim mode: compile what Neovim has, including keys it's still working on.
    await editor.sync();
    if (S.level !== lv) return;
    const res = await api.run(lv.id, editor.value);
    S.game.player = res.player;
    updateHUD();
    // The level was replayed while this compiled: the result belongs to the old attempt.
    if (res.stale) return;
    // The player may have switched levels while this was compiling: then only report it.
    if (S.level !== lv) {
      if (res.first_clear) toast("⭐", `Level ${lv.num} cleared! +${res.xp_gained} XP`);
      return;
    }
    showRunResult(res.result);
    if (res.result.passed) await onPass(res, lv);
    else onFail(res.result);
  } catch (e) {
    toast("⚠", escapeHtml(e.message));
    ferris.setMood("idle");
  } finally {
    S.running = false;
    buildHotbar();
    renderQuickActions();
  }
}

async function runPredict() {
  const lv = S.level;
  if (!lv || S.running) return;
  S.running = true;
  setSlotBusy("run", true);
  sound.compile();
  try {
    const r = await api.play(editor.value, lv.id);
    if (S.level !== lv) return;
    showRunResult({ ...r, summary: r.compiled ? (r.passed ? "This is what it really prints:" : r.summary) : "The real compiler says no:" });
    openConsole(r.compiled ? "output" : "compiler");
  } finally {
    S.running = false;
    setSlotBusy("run", false);
  }
}

async function onPass(res, lv) {
  sound.success();
  ferris.setMood("excited", 3500);
  ferris.setMood("happy");
  if (res.first_clear) {
    lv.done = true;
    $("#lv-xp").className = "badge xp done";
    $("#lv-xp").innerHTML = `${sym("✔")}Cleared`;
    confetti();
    floatXP(res.xp_gained, $("#lv-xp"));
    sound.coin();
    toast("⭐", `Level cleared! +${res.xp_gained} XP`);
  }
  if (res.world_cleared) {
    setTimeout(() => worldClearedBanner(lv, res.next_id), 700);
  }
  lv.next_id = res.next_id;
  buildHotbar();
  const lines = [
    "**You did it!** 🎉 The compiler is happy and so am I.",
    "**Perfect!** 🦀 That's real Rust you just wrote.",
    "**Level cleared!** ✨ Clean as a freshly polished shell.",
  ];
  const actions = [];
  if (res.next_id) actions.push({ label: "Next level ➜", cls: "green", fn: goNext });
  if (S.game.settings.teacher !== "offline") actions.push({ label: "⭐ Review my code (+15 XP if idiomatic)", cls: "purple", fn: () => askFerris("review") });
  else actions.push({ label: "⭐ Compare with Ferris' solution", cls: "purple", fn: () => askFerris("review") });
  addStaticFerris(lines[Math.floor(Math.random() * lines.length)], actions);
}

function onFail(r) {
  sound.fail();
  ferris.setMood("worried", 2500);
  ferris.setMood("idle");
  const msg = !r.compiled
    ? `Hmm, the compiler found ${r.error_codes.length > 1 ? "some problems" : "a problem"}${r.error_codes.length ? ` (${r.error_codes.map(c => "`" + c + "`").join(", ")})` : ""}. Open the **Compiler** (press 2) and read the **first** error. It usually points right at the line!`
    : r.timed_out ? "Whoa, your program ran too long and I had to stop it. Is there a loop that never ends? 🌀"
    : "It compiles, nice! 👍 But the result isn't quite right yet. Open **Output** (press 3) to compare it with what's expected.";
  if (S.game.settings.auto_explain && S.game.settings.teacher !== "offline") {
    addStaticFerris(msg);
    askFerris("explain");
  } else {
    addStaticFerris(msg, [
      { label: "🔍 Explain this to me", fn: () => askFerris("explain") },
      { label: `💡 Hint`, fn: () => askFerris("hint") },
    ]);
  }
}

function renderChoices() {
  const lv = S.level;
  const box = $("#choices");
  box.classList.toggle("show", answers(lv.kind));
  if (!answers(lv.kind)) { box.innerHTML = ""; return; }
  box.innerHTML = "";
  // On predict levels the goal is the question, so it lives here (the goal strip is hidden).
  const q = el("div", "choice-q");
  q.append(el("span", "", `🔮 ${escapeHtml(lv.goal)}`));
  const lessonBtn = el("button", "wood-btn small", "📜 Lesson");
  lessonBtn.onclick = () => toggleLesson("lesson");
  if (lv.lesson) q.append(lessonBtn);
  box.append(q);
  lv.choices.forEach((c, i) => {
    const b = el("button", "choice", `${String.fromCharCode(65 + i)}. ${escapeHtml(c)}`);
    b.dataset.index = i;
    b.disabled = S.quizSolved;
    b.onclick = () => answerQuiz(i, b);
    box.append(b);
  });
  if (S.quizSolved) box.append(el("div", "muted", lv.kind === "quiz" ? `${sym("✔")}Solved.` : `${sym("✔")}Solved. Press ${sym("▶")}Run it to see the real output.`));
}

async function answerQuiz(i, btn) {
  const lv = S.level;
  if (S.quizSolved || S.talking) return;
  const res = await api.quiz(lv.id, i);
  S.game.player = res.player;
  updateHUD();
  if (S.level !== lv) return;
  if (res.correct) {
    S.quizSolved = true;
    lv.done = true;
    btn.classList.add("right");
    for (const b of document.querySelectorAll(".choice")) b.disabled = true;
    sound.success();
    ferris.setMood("excited", 3000);
    ferris.setMood("happy");
    if (res.first_clear) {
      confetti();
      floatXP(res.xp_gained, btn);
      toast("🔮", `Correct! +${res.xp_gained} XP`);
      $("#lv-xp").className = "badge xp done";
      $("#lv-xp").innerHTML = `${sym("✔")}Cleared`;
    }
    if (res.world_cleared) setTimeout(() => worldClearedBanner(lv, res.next_id), 700);
    lv.next_id = res.next_id;
    buildHotbar();
    const actions = lv.kind === "quiz" ? [] : [{ label: `${sym("▶")}Run it to see`, fn: runPredict }];
    if (res.next_id) actions.unshift({ label: "Next level ➜", cls: "green", fn: goNext });
    addStaticFerris(`**Correct!** ${lv.kind === "quiz" ? "📖" : "🔮"} ${res.explanation}`, actions);
  } else {
    btn.classList.add("wrong");
    btn.disabled = true;
    sound.fail();
    ferris.setMood("worried", 2000);
    ferris.setMood("idle");
    askFerris("quiz", { choice: i, label: `I guessed ${String.fromCharCode(65 + i)}…` });
  }
}

async function goNext() {
  const lv = S.level;
  if (lv?.next_id) openLevel(lv.next_id);
  else showMap();
}

async function skipLevel() {
  const lv = S.level;
  if (lv.kind === "boss") { toast("👹", "Bosses can't be skipped. You've got this!"); return; }
  if (!(await confirmModal("Skip level?", "Skip this level for now? You won't get XP, but you can come back any time."))) return;
  const res = await api.skip(lv.id);
  if (res.next_id) openLevel(res.next_id); else showMap();
}

/** Reset menu: start the code over, or replay the whole level from scratch. */
function resetCode() {
  const lv = S.level;
  if (!lv) return;
  const body = el("div", "reset-menu");
  const option = (icon, title, text, cls, fn) => {
    const b = el("button", `reset-option ${cls}`, `<span class="ro-icon">${pixelIcon(icon, 2)}</span><span class="ro-main"><span class="ro-title">${title}</span><span class="ro-text">${text}</span></span>`);
    b.onclick = () => { m.close(); fn(); };
    body.append(b);
  };
  if (!answers(lv.kind)) {
    option("reset", "Reset code", "Throw away your changes and start again from the original code. Your progress on this level is kept.", "", () => {
      if (S.level !== lv) return;
      cancelDraft();
      editor.value = lv.starter;
      saveDraft(lv.id, lv.starter);
      resetConsole();
      toast(pixelIcon("reset", 2), "Code reset to the original.");
    });
  }
  const earned = lv.done ? "The XP you earned here is taken back, so you can earn it again." : "Any hints you used here stop counting against you.";
  option("replay", "Replay level from scratch", `Start this level over as if it were new: fresh code, no hints used, no attempts. ${earned} Nothing after it gets locked again.`, "replay", () => replayLevel(lv));
  const m = openModal({ title: "Reset", body });
}

async function replayLevel(lv) {
  try {
    // Let queued saves land first, or one could restore the old code after the reset.
    cancelDraft();
    await draftChain;
    const res = await api.replay(lv.id);
    // Edits typed while the replay was in flight belong to the old attempt.
    cancelDraft();
    await draftChain;
    unsavedDrafts.delete(lv.id);
    S.game.player = res.player;
    delete S.history[lv.id];
    saveHistory();
    try {
      const seen = seenLessons();
      seen.delete(lv.id);
      localStorage.setItem("ff-seen-lessons", JSON.stringify([...seen]));
    } catch { /* ignore */ }
    updateHUD();
    toast(pixelIcon("replay", 2), res.xp_returned ? `Level ${lv.num} reset. ${res.xp_returned} XP returned; earn it again!` : `Level ${lv.num} reset. Fresh start!`);
    await openLevel(lv.id);
  } catch (e) {
    toast("⚠", escapeHtml(e.message));
  }
}

// Autosave: one pending save at a time, written in order, so an older edit can never
// land after a newer one (e.g. after Reset).
let draftPending = null;
let draftChain = Promise.resolve();
// Code per level that the server hasn't confirmed yet. Reopening a level shows this
// instead of the server's (older) draft, so a failed save never loses edits.
const unsavedDrafts = new Map();

function saveDraft(id, code) {
  unsavedDrafts.set(id, code);
  draftChain = draftChain
    .then(() => api.draft(id, code))
    .then(() => {
      // A newer edit queued behind this one is still unsaved.
      if (unsavedDrafts.get(id) === code) unsavedDrafts.delete(id);
      if (!unsavedDrafts.size) setSaveStatus(null);
    })
    .catch(e => setSaveStatus(e.message || "Couldn't autosave your code."));
  return draftChain;
}

/** A warning in the HUD that stays until saving works again. */
function setSaveStatus(error) {
  const box = $("#save-status");
  box.classList.toggle("hidden", !error);
  if (error) {
    box.title = `${error}\nYour latest changes are only in this browser tab until saving works again.`;
    if (error !== shownSaveError) toast("⚠", `Not saved: ${escapeHtml(error)}`);
  }
  shownSaveError = error || null;
}

function scheduleDraft(id, code) {
  clearTimeout(draftTimer);
  draftPending = { id, code };
  draftTimer = setTimeout(() => { const d = draftPending; draftPending = null; if (d) saveDraft(d.id, d.code); }, 800);
}

function cancelDraft() {
  clearTimeout(draftTimer);
  draftPending = null;
}

/** Save a pending edit right away (e.g. before switching levels). Resolves once every
 *  queued save has finished. In Vim mode, first waits for Neovim to apply every key sent
 *  so far, so the last few keystrokes are part of the draft. */
async function flushDraft() {
  await editor?.sync();
  clearTimeout(draftTimer);
  const d = draftPending;
  draftPending = null;
  return d ? saveDraft(d.id, d.code) : draftChain;
}

// ---------------------------------------------------------------- hotbar

// The hotbar. `key` is the keyboard shortcut (used when you're not typing).
const SLOTS = [
  { id: "run", key: "1", icon: "run", label: "Run", primary: true, fn: () => runCode() },
  { id: "compiler", key: "2", icon: "compiler", label: "Compiler", console: "compiler", fn: () => openConsole("compiler") },
  // Output (or test results) together with what's expected (or the tests themselves), as
  // tabs in one console. Before the first run there's no output yet, so it opens on what's expected.
  { id: "output", key: "3", icon: "output", label: "Output", console: "output", fn: () => openConsole(S.lastRun ? "output" : expectedTab()) },
  { id: "hint", key: "4", icon: "hint", label: "Hint", fn: () => askFerris("hint") },
  { id: "explain", key: "5", icon: "explain", label: "Explain", fn: () => askFerris("explain") },
  { id: "review", key: "6", icon: "review", label: "Review", fn: () => askFerris("review") },
  { id: "reset", key: "7", icon: "reset", label: "Reset", fn: () => resetCode() },
  { id: "skip", key: "8", icon: "skip", label: "Skip", fn: () => skipLevel() },
  { id: "map", key: "9", icon: "map", label: "Map", fn: () => showMap() },
  { id: "next", key: "N", icon: "next", label: "Next", fn: () => goNext() },
];

/** The console tab with what the level expects: Ferris' tests, or the expected output. */
function expectedTab() {
  const want = S.level.check === "tests" ? "tests" : "expected";
  return consoleTabs().some(([key]) => key === want) ? want : "output";
}

function buildHotbar() {
  const lv = S.level;
  const bar = $("#hotbar");
  bar.innerHTML = "";
  const inner = el("div", "hotbar-inner");
  for (const s of SLOTS) {
    const b = el("button", `slot${s.primary ? " primary" : ""}`);
    b.dataset.slot = s.id;
    if (s.console) b.dataset.console = s.console;
    let label = s.label;
    if (s.id === "hint") label = `Hint ${lv.hint_tier}/3`;
    if (s.id === "run" && answers(lv.kind)) label = "Run it";
    if (s.id === "output" && lv.check === "tests" && !answers(lv.kind)) label = "Results";
    b.innerHTML = `<span class="slot-key">${s.key}</span><span class="slot-icon">${pixelIcon(s.icon, 2)}</span><span class="slot-label">${label}</span>`;
    b.title = slotTitle(s.id);
    b.disabled = !slotEnabled(s.id);
    b.onclick = () => { sound.click(); s.fn(); };
    inner.append(b);
  }
  bar.append(inner);
  updateConsoleBadges();
}

function slotTitle(id) {
  const lv = S.level;
  switch (id) {
    case "compiler": return "Compiler messages: errors and warnings (2)";
    case "output": return lv.check === "tests" && !answers(lv.kind) ? "Test results, and the tests Ferris runs on your code (3)" : "What your program printed, and what's expected (3)";
    case "run": return answers(lv.kind) ? "Compile and run the code (after you've answered)" : "Compile and check your code (Ctrl+Enter)";
    case "hint": return lv.hint_tier >= 3 ? "You've seen all 3 hints. Ask again for more help." : `Get hint ${lv.hint_tier + 1} of 3 (${HINT_COST[lv.hint_tier + 1]} on this level${lv.done ? ", but you've already cleared it" : ""})`;
    case "explain": return "Ask Ferris to explain the last error";
    case "review": return "Ask Ferris to review your passing code (+15 bonus XP if it's idiomatic)";
    case "reset": return "Reset the code, or replay the whole level from scratch";
    case "skip": return lv.kind === "boss" ? "Bosses can't be skipped" : "Skip this level (no XP)";
    case "map": return "Back to the world map";
    case "next": return "Go to the next level";
  }
  return "";
}

function slotEnabled(id) {
  const lv = S.level;
  const predict = answers(lv.kind);
  if (S.talking && ["hint", "explain", "review"].includes(id)) return false;
  switch (id) {
    case "run": return lv.kind !== "quiz" && (!predict || S.quizSolved);
    case "compiler": case "output": return lv.kind !== "quiz" && (!predict || S.quizSolved);
    case "explain": return !predict && !!S.lastRun && !S.lastRun.passed;
    case "review": return !predict && lv.done && !lv.skipped;
    case "reset": return !predict || lv.done || lv.hint_tier > 0;
    case "skip": return lv.kind !== "boss" && !lv.done;
    case "next": return !!lv.next_id && (lv.done || lv.skipped);
    default: return true;
  }
}

function setSlotBusy(id, busy) {
  const b = document.querySelector(`.slot[data-slot=${id}]`);
  if (b) b.classList.toggle("busy", busy);
}

// ---------------------------------------------------------------- Ferris dialogue

function historyFor(id) {
  if (!S.history[id]) S.history[id] = [];
  return S.history[id];
}

function stripVerdict(text) {
  return text.replace(/^.*VERDICT:.*$/gm, "").replace(/\n\s*(?:---|\*\*\*|___)\s*$/, "").trim();
}

function greeting(lv) {
  const title = lv.title.replace(/[!.?]+$/, "");
  if (lv.done) return `Welcome back to **${title}**! You've already cleared it. Feel free to experiment, or ask me anything.`;
  switch (lv.kind) {
    case "quiz": return `📖 **Quiz time!** No code to write here. Read the question, think it through, and pick an answer.`;
    case "predict": return `🔮 **Predict time!** Read the code carefully. Don't run it in your head too fast. Then pick an answer below.`;
    case "boss": return `👹 **Boss fight: ${lv.title.replace(/^BOSS:\s*/, "")}!** This one uses everything from ${lv.world.name}. Read the scroll, take it step by step, and remember: I'm right here.`;
    case "fill": return `✍️ **${title}**: some code is missing. Read the 📜 lesson, then fill in the blanks and press ▶ Run.`;
    default: return `🔧 **${title}**: this code is broken! Press ▶ Run to see what the compiler says, then fix it.`;
  }
}

function renderDialogue() {
  const log = $("#dialogue-log");
  log.innerHTML = "";
  const lv = S.level;
  addMessage("ferris", greeting(lv), { save: false });
  for (const [role, text] of historyFor(lv.id)) addMessage(role === "user" ? "user" : "ferris", text, { save: false });
  log.scrollTop = log.scrollHeight;
}

function addMessage(role, text, { save = true, tag = "", actions = [] } = {}) {
  const log = $("#dialogue-log");
  const m = el("div", `msg ${role}`);
  // Ferris' bubbles always get a tag line (empty ones are hidden), so code can safely update it.
  if (tag || role === "ferris") m.append(el("div", "msg-tag", tag));
  const body = el("div", role === "ferris" ? "md" : "");
  if (role === "ferris") body.innerHTML = renderMarkdown(stripVerdict(text));
  else body.textContent = text;
  m.append(body);
  if (actions.length) {
    const a = el("div", "actions");
    for (const act of actions) {
      const b = el("button", `wood-btn small ${act.cls || ""}`, act.label);
      b.onclick = () => { sound.click(); act.fn(); };
      a.append(b);
    }
    m.append(a);
  }
  log.append(m);
  log.scrollTop = log.scrollHeight;
  if (save && S.level && role !== "system") {
    historyFor(S.level.id).push([role === "user" ? "user" : "assistant", text]);
    saveHistory();
  }
  return { m, body };
}

function addStaticFerris(text, actions = []) {
  ferris.setMood("talking", 1200);
  sound.blip();
  return addMessage("ferris", text, { actions, save: false });
}

function quickActions() {
  const lv = S.level;
  const items = [];
  if (!answers(lv.kind) && S.lastRun && !S.lastRun.passed) items.push(["🔍", "Explain the error", "", () => askFerris("explain")]);
  if (!answers(lv.kind)) {
    const tier = Math.min(lv.hint_tier + 1, 3);
    items.push(["💡", `Hint ${tier}/3`, lv.done ? "" : HINT_COST[tier], () => askFerris("hint")]);
  }
  items.push(["❓", "What do I do here?", "", () => askFerris("chat", { message: "What exactly do I need to do in this level? Explain the goal simply." })]);
  if (!answers(lv.kind)) items.push(["🐍", "Compare with Python", "", () => askFerris("chat", { message: "How would this code look in Python, and what's different in Rust?" })]);
  items.push(["⚙️", "Compare with C", "", () => askFerris("chat", { message: "How does this level's idea compare to how C does it?" })]);
  if (lv.done && !answers(lv.kind)) items.push(["⭐", "Review my code", "", () => askFerris("review")]);
  return items;
}

/** Rebuild the quick-questions menu (it's only shown when the 💬 button is clicked). */
function renderQuickActions() {
  const menu = $("#quick-menu");
  menu.innerHTML = "";
  if (!S.level) return;
  menu.append(el("div", "quick-menu-title", "Ask Ferris…"));
  for (const [icon, label, note, fn] of quickActions()) {
    const b = el("button", "quick-item", `<span class="qi-icon">${icon}</span><span>${escapeHtml(label)}</span>${note ? `<span class="qi-note">${note}</span>` : ""}`);
    b.setAttribute("role", "menuitem");
    b.onclick = () => { sound.click(); closeQuickMenu(); fn(); };
    menu.append(b);
  }
}

function openQuickMenu() {
  if (!S.level || S.talking) return;
  renderQuickActions();
  $("#quick-menu").classList.remove("hidden");
  $("#btn-quick").classList.add("open");
  sound.open();
  $("#quick-menu .quick-item")?.focus();
}

function closeQuickMenu() {
  $("#quick-menu").classList.add("hidden");
  $("#btn-quick").classList.remove("open");
}

/** While Ferris answers: show what he's doing, lock the chat actions, offer Stop. */
function setFerrisBusy(state) {
  const busy = !!state;
  $("#ferris-status").textContent = state === "thinking" ? "Thinking…" : state === "talking" ? "Talking…" : "";
  $("#ask-input").disabled = busy;
  $("#btn-quick").disabled = busy;
  $("#btn-ask").classList.toggle("hidden", busy);
  $("#btn-stop").classList.toggle("hidden", !busy);
  if (busy) closeQuickMenu();
  if (S.level) buildHotbar();
}

async function askFerris(mode, { message = "", choice = null, label = "" } = {}) {
  const lv = S.level;
  if (!lv || S.talking) return;
  S.talking = true;
  S.ferrisStop = new AbortController();
  setFerrisBusy("thinking");

  const tags = { explain: "🔍 Explaining", hint: "💡 Hint", review: "⭐ Code review", chat: "", quiz: "🔮 Let's think" };
  const userText = mode === "chat" ? message : label || { explain: "Can you explain what went wrong?", hint: "Can I have a hint?", review: "Can you review my code?" }[mode];
  if (userText) addMessage("user", userText);

  const history = historyFor(lv.id).slice(0, -1).slice(-8);
  const { m, body } = addMessage("ferris", "", { save: false, tag: tags[mode] });
  body.innerHTML = '<span class="typing"><span>●</span> <span>●</span> <span>●</span></span>';
  ferris.setMood("thinking");

  let text = "";
  let pending = false;
  let modelName = "";
  const log = $("#dialogue-log");
  const paint = () => {
    pending = false;
    body.innerHTML = renderMarkdown(stripVerdict(text)) || body.innerHTML;
    log.scrollTop = log.scrollHeight;
  };

  try {
    await editor.sync();
    await api.ferris(
      { id: lv.id, mode, code: editor.value, output: runOutputText(), message, history, choice },
      ev => {
        switch (ev.type) {
          case "model":
            modelName = ev.model;
            break;
          case "delta":
            if (!text) setFerrisBusy("talking");
            text += ev.text;
            ferris.setMood("talking");
            sound.blip();
            if (!pending) { pending = true; requestAnimationFrame(paint); }
            break;
          case "usage":
            if (S.game) S.game.usage = ev;
            updateEnergy(ev);
            break;
          case "hint_tier":
            lv.hint_tier = ev.tier;
            m.querySelector(".msg-tag").textContent = `💡 Hint ${ev.tier}/3${lv.done ? "" : ` (${HINT_COST[ev.tier]} on this level)`}`;
            buildHotbar();
            break;
          case "error":
            addMessage("system", `Couldn't reach Claude: ${ev.message}`, { save: false });
            m.classList.add("error");
            break;
          case "offline":
            m.querySelector(".msg-tag").textContent += " · offline notes";
            break;
          case "bonus":
            floatXP(ev.xp, m);
            sound.coin();
            toast("✨", `Idiomatic Rust! +${ev.xp} bonus XP`);
            refreshState();
            break;
        }
      },
      S.ferrisStop.signal
    );
  } catch (e) {
    if (S.ferrisStop?.signal.aborted && e.name === "AbortError") {
      text = (text ? text + "\n\n" : "") + "_(You stopped me there.)_";
    } else {
      text = e.name === "AbortError" || e.name === "TimeoutError"
        ? "Hmm, that took far too long, so I gave up. Try again, or switch to a faster model with the 🧠 button."
        : `Oops, I couldn't think straight just now: ${e.message}`;
      m.classList.add("error");
    }
  } finally {
    // Whatever happened, Ferris must not stay "busy".
    S.talking = false;
    S.ferrisStop = null;
    setFerrisBusy(false);
    ferris.setMood("happy", 1500);
    ferris.setMood("idle");
  }
  paint();
  if (modelName) m.querySelector(".msg-tag").title = `Answered by ${modelName}`;
  // A model the cards don't know yet (e.g. a new Opus): the server saved it, so refresh the names.
  if (modelName && !S.models.some(x => x.resolved === modelName) && S.models.some(x => x.id === S.game.settings.model)) reloadModels();
  if (!text) body.innerHTML = renderMarkdown("_(Ferris didn't say anything. Try again?)_");
  historyFor(lv.id).push(["assistant", text]);
  saveHistory();
  renderQuickActions();
}

// ---------------------------------------------------------------- settings & model picker

/** Reload the model cards' names (after Claude Code reports a model we haven't seen). */
async function reloadModels() {
  try {
    S.models = await api.models();
    updateModelChip();
  } catch { /* keep the old names */ }
}

function modelCards(selected, onPick) {
  const grid = el("div", "model-cards");
  const cards = [...S.models];
  const custom = !cards.some(m => m.id === selected);
  for (const m of cards) {
    const c = el("button", `model-card${m.id === selected ? " selected" : ""}`);
    c.innerHTML = `<div><span class="mc-name">${m.name}</span><span class="mc-tag">${m.tag}</span></div><div class="mc-blurb">${m.blurb}</div><div class="mc-id">--model ${m.id}${m.resolved ? ` → ${escapeHtml(m.resolved)}` : ""}</div>`;
    c.onclick = () => { selected = m.id; for (const x of grid.querySelectorAll(".model-card")) x.classList.remove("selected"); c.classList.add("selected"); onPick(m.id); };
    grid.append(c);
  }
  const wrap = el("div");
  wrap.append(grid);
  const row = el("div", "row");
  row.style.marginTop = "8px";
  const input = el("input", "text-input");
  input.placeholder = "or type any model Claude Code accepts, e.g. claude-opus-5-5";
  input.style.flex = "1";
  if (custom) input.value = selected;
  const use = el("button", "wood-btn small", "Use");
  use.onclick = () => { if (input.value.trim()) { selected = input.value.trim(); for (const x of grid.querySelectorAll(".model-card")) x.classList.remove("selected"); onPick(selected); } };
  row.append(input, use);
  wrap.append(row);
  // Each card is an alias, so Ferris always gets the newest model. This only updates the names.
  const check = el("button", "wood-btn small", "🔄 Check for new versions");
  check.title = "Ask Claude Code which model each card is right now (one tiny message per card)";
  const note = el("span", "muted", "");
  check.onclick = async () => {
    sound.click();
    check.disabled = true;
    note.textContent = " Asking Claude Code…";
    try {
      const res = await api.refreshModels();
      S.models = res.models;
      updateModelChip();
      const fresh = modelCards(selected, onPick);
      wrap.replaceWith(fresh);
      if (res.errors.length) fresh.querySelector(".mc-check-note").textContent = ` Couldn't check: ${res.errors.map(e => e.id).join(", ")}.`;
      else fresh.querySelector(".mc-check-note").textContent = " Up to date!";
    } catch (e) {
      note.textContent = ` ${e.message}`;
      check.disabled = false;
    }
  };
  note.classList.add("mc-check-note");
  const checkRow = el("div", "row");
  checkRow.style.marginTop = "8px";
  checkRow.append(check, note);
  wrap.append(checkRow);
  return wrap;
}

function effortPicker(selected, onPick) {
  const seg = el("div", "seg");
  for (const e of ["low", "medium", "high", "xhigh", "max"]) {
    const b = el("button", e === selected ? "on" : "", e);
    b.onclick = () => { for (const x of seg.children) x.classList.remove("on"); b.classList.add("on"); onPick(e); };
    seg.append(b);
  }
  return seg;
}

// Settings are saved one at a time, each built from the settings the previous save
// returned, so quick changes (model, then effort) can't overwrite each other.
let settingsChain = Promise.resolve();

function saveSettings(patch, note) {
  settingsChain = settingsChain.then(async () => {
    const next = { ...S.game.settings, ...patch };
    try {
      S.game.settings = await api.saveSettings(next);
      sound.setEnabled(S.game.settings.sound);
      applyCodeFont();
      document.body.classList.toggle("readable", !!S.game.settings.readable_text);
      updateHUD();
      applyVimSetting();
      if (note && S.screen === "level") addMessage("system", note, { save: false });
    } catch (e) {
      toast("⚠", escapeHtml(e.message));
    }
  });
  return settingsChain;
}

function openModelPicker() {
  const s = S.game.settings;
  const body = el("div");
  body.append(el("div", "section-title", "🧠 Ferris' brain"), el("p", "muted", "Pick which Claude model Ferris thinks with. It runs through Claude Code on your subscription."));
  body.append(modelCards(s.model, id => saveSettings({ model: id, teacher: "claude_code" }, `🧠 Ferris is now thinking with **${modelLabel(id)}**.`)));
  body.append(el("div", "section-title", "Effort"), el("p", "muted", "Higher effort means deeper thinking, but slower replies that use more of your limit. Low is great for hints."));
  body.append(effortPicker(s.effort, e => saveSettings({ effort: e }, `Effort set to **${e}**.`)));
  const off = el("label", "toggle", `<input type="checkbox" ${s.teacher === "offline" ? "checked" : ""}> 💤 Offline mode (built-in hints only, uses none of your Claude limit)`);
  off.querySelector("input").onchange = e => saveSettings({ teacher: e.target.checked ? "offline" : "claude_code" }, e.target.checked ? "💤 Ferris switched to offline mode." : "🧠 Ferris is back online.");
  body.append(el("div", "section-title", "Mode"), off);
  openModal({ title: "Switch model", body });
}

function openSettings() {
  const s = S.game.settings;
  const body = el("div");

  body.append(el("div", "section-title", "👤 Your name"));
  const nameRow = el("div", "row");
  const name = el("input", "text-input");
  name.value = S.game.player.name || "";
  name.maxLength = 24;
  const saveName = el("button", "wood-btn small", "Save");
  saveName.onclick = async () => { await api.setName(name.value); await refreshState(); toast("👤", "Name saved"); };
  nameRow.append(name, saveName);
  body.append(nameRow);

  body.append(el("div", "section-title", "🧠 Ferris' brain (Claude model)"));
  body.append(el("p", "muted", "Ferris uses Claude Code on your Claude subscription, so there's no API key. Aliases always mean the newest version."));
  body.append(modelCards(s.model, id => saveSettings({ model: id, teacher: "claude_code" })));

  body.append(el("div", "section-title", "Effort"));
  body.append(effortPicker(s.effort, e => saveSettings({ effort: e })));

  const testRow = el("div", "row");
  testRow.style.marginTop = "10px";
  const testBtn = el("button", "wood-btn small purple", "🔌 Test connection");
  const result = el("div", "test-result hidden");
  testBtn.onclick = async () => {
    testBtn.disabled = true;
    testBtn.textContent = "⏳ Asking Claude…";
    result.className = "test-result";
    result.textContent = `Sending a tiny test message to ${modelLabel(S.game.settings.model)}…`;
    const r = await api.testModel(S.game.settings.model, S.game.settings.effort);
    testBtn.disabled = false;
    testBtn.textContent = "🔌 Test connection";
    if (r.ok) { result.className = "test-result ok"; result.innerHTML = `${sym("✔")}${escapeHtml(r.model)} says: “${escapeHtml(r.reply.trim())}”`; await refreshState(); }
    else { result.className = "test-result bad"; result.innerHTML = `${sym("✘")}${escapeHtml(r.error)}`; }
  };
  testRow.append(testBtn);
  body.append(testRow, result);

  body.append(el("div", "section-title", "🎮 Game"));
  const toggles = [
    ["teacher", s.teacher === "offline", "💤 Offline mode (built-in hints only, no Claude)", v => ({ teacher: v ? "offline" : "claude_code" })],
    ["auto_explain", s.auto_explain, "🔍 Ferris explains every failed run automatically (uses more of your limit)", v => ({ auto_explain: v })],
    ["sound", s.sound, "🔊 Sound effects", v => ({ sound: v })],
    ["code_font", s.code_font === "pixel", "👾 Pixel font in the code editor", v => ({ code_font: v ? "pixel" : "clean" })],
    ["readable_text", s.readable_text, "📖 Smooth, easier-to-read text for lessons and chat (the pixel art stays)", v => ({ readable_text: v })],
    ["vim", s.vim, "⌨️ Vim mode: type with your own Neovim (motions, operators, :commands)", v => ({ vim: v })],
    ["nvim_config", s.nvim_config, "📂 Load my Neovim config (init.lua, plugins, keymaps) in Vim mode", v => ({ nvim_config: v })],
  ];
  for (const [, on, label, patch] of toggles) {
    const t = el("label", "toggle", `<input type="checkbox" ${on ? "checked" : ""}> ${label}`);
    t.querySelector("input").onchange = e => saveSettings(patch(e.target.checked));
    body.append(t);
  }
  openModal({ title: "Settings", body, wide: true });
}

// ---------------------------------------------------------------- codex & workshop

function openCodex() {
  const codex = S.game.codex;
  const body = el("div");
  if (!codex.length) {
    body.innerHTML = `<p style="font-family:var(--font-talk);font-size:22px">📖 Your Error Codex is empty… for now!</p><p class="muted">Every time the compiler shows you an error code like <code>E0382</code>, it's collected here with the official explanation. Gotta catch 'em all!</p>`;
    openModal({ title: "Error Codex", body });
    return;
  }
  const grid = el("div", "codex-grid");
  const list = el("div", "codex-list");
  const view = el("div", "codex-view md", "<p class='muted'>Pick an error code.</p>");
  const showCode = async (entry, btn) => {
    for (const x of list.children) x.classList.remove("on");
    btn.classList.add("on");
    view.innerHTML = "<p class='muted'>Loading rustc's explanation…</p>";
    const r = await api.explain(entry.code);
    view.innerHTML = renderMarkdown(r.text, { soft: true });
    if (S.screen === "level") {
      const ask = el("button", "wood-btn small purple", "🦀 Ask Ferris to explain it simply");
      ask.onclick = () => { m.close(); askFerris("chat", { message: `Can you explain compiler error ${entry.code} in simple terms, with a tiny example?` }); };
      view.prepend(ask);
    }
  };
  for (const entry of [...codex].sort((a, b) => b.count - a.count)) {
    const b = el("button", "codex-item", `<span class="ci-code">${entry.code}</span><span class="ci-count">×${entry.count}</span><div class="muted">first met in ${escapeHtml(levelNum(entry.first_level))}</div>`);
    b.onclick = () => showCode(entry, b);
    list.append(b);
  }
  grid.append(list, view);
  body.append(el("p", "muted", `You've met ${codex.length} different compiler error${codex.length > 1 ? "s" : ""}. Each one is a lesson learned!`), grid);
  const m = openModal({ title: "Error Codex", body, wide: true });
  list.firstChild?.click();
}

function openWorkshop() {
  const body = el("div", "workshop-grid");
  const bar = el("div", "workshop-bar");
  const runBtn = el("button", "wood-btn small green", `${sym("▶")}Run`);
  bar.append(el("span", "muted", "A free sandbox: write any Rust you like. Ctrl+Enter runs it."), runBtn);
  const edFrame = el("div", "frame-dark workshop-editor");
  const host = el("div");
  host.style.flex = "1";
  host.style.minHeight = "0";
  edFrame.append(host);
  const out = el("div", "frame-dark workshop-output");
  const sum = el("div", "console-summary", "Output appears here.");
  const pre = el("pre", "console-body");
  out.append(sum, pre);
  body.append(bar, edFrame, out);
  let starter = `fn main() {\n    let crab = "🦀";\n    for i in 1..=3 {\n        println!("{} says hi #{}", crab, i);\n    }\n}\n`;
  try { starter = localStorage.getItem("ff-workshop") || starter; } catch { /* ignore */ }
  const run = async () => {
    sum.className = "console-summary";
    sum.textContent = "⚙ Compiling…";
    sound.compile();
    await ed.sync();
    const r = await api.play(ed.value);
    sum.className = `console-summary ${r.passed ? "pass" : r.compiled ? "warn" : "fail"}`;
    sum.textContent = r.summary;
    pre.innerHTML = r.compiled ? escapeHtml((r.stdout || "") + (r.stderr ? `\n${r.stderr}` : "")) + (r.compiler.trim() ? `\n\n${colorizeCompiler(r.compiler)}` : "") : colorizeCompiler(r.compiler);
    if (r.passed) sound.success(); else sound.fail();
  };
  runBtn.onclick = run;
  const ed = new Editor(host, {
    onRun: run,
    onChange: v => { try { localStorage.setItem("ff-workshop", v); } catch { /* ignore */ } },
    onVimError: m => toast("⌨️", escapeHtml(m.message || "Neovim problem")),
  });
  ed.value = starter;
  if (S.game?.settings.vim) ed.enableVim(S.game.settings.nvim_config);
  openModal({ title: "Workshop", body, wide: true, onClose: () => ed.destroy() });
  setTimeout(() => ed.focus(), 50);
}

// ---------------------------------------------------------------- title screen

// ---- Title screen: the animated beach (drawn by title.js) ----
let titleScene = null;
let logoSign = null;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let titleLast = 0;

function titleLoop(t) {
  requestAnimationFrame(titleLoop);
  // About 15 frames a second suits pixel art; once a second if motion should be reduced.
  const every = reducedMotion.matches ? 1000 : 66;
  if (S.screen !== "title" || !titleScene || t - titleLast < every) return;
  titleLast = t;
  titleScene.draw(t);
  logoSign?.draw(t);
}

/** Start: Ferris and his friends wave and scuttle off, then the game begins. */
let leavingTitle = false;
function leaveTitle() {
  if (leavingTitle) return;
  if (!titleScene || reducedMotion.matches) return startGame();
  leavingTitle = true;
  titleScene.setLook(null);
  titleScene.exit();
  titleFerris.look = null;
  titleFerris.setDance(false);
  titleFerris.setMood("excited");
  $("#title-ferris").classList.add("leaving");
  setTimeout(async () => {
    try {
      await startGame();
    } finally {
      // Still on the title (e.g. the name box was closed): everyone comes back.
      setTimeout(() => {
        leavingTitle = false;
        if (S.screen === "title") resetTitle();
      }, 400);
    }
  }, 850);
}

function resetTitle() {
  $("#title-ferris").classList.remove("leaving");
  titleScene?.reset();
  titleFerris.setMood("happy");
  titleFerris.setDance(!reducedMotion.matches);
}

/** The beach scene, its sign, and the little interactions on the title screen. */
function setupTitle() {
  titleScene = new TitleScene({
    canvas: $("#title-bg"),
    ferrisCanvas: $("#title-ferris"),
    ferris: titleFerris,
    props: $("#title-props"),
    reduced: reducedMotion.matches,
  });
  titleScene.setSign("rustc ✓");
  const start = $("#btn-start");
  // Hovering Start: everyone stops to look at the button.
  start.addEventListener("mouseenter", () => {
    if (leavingTitle) return;
    titleFerris.look = { dx: 0, dy: 1 };
    titleScene.setLook({ dx: 0, dy: 1 });
  });
  start.addEventListener("mouseleave", () => {
    titleFerris.look = null;
    titleScene.setLook(null);
  });
  // Clicking the beach makes a splash of sparkles.
  $("#title-screen").addEventListener("pointerdown", e => {
    if (e.target.closest("button, .modal")) return;
    titleScene.splash(e.clientX, e.clientY);
  });
  reducedMotion.addEventListener?.("change", () => {
    titleScene.reduced = reducedMotion.matches;
    if (logoSign) logoSign.reduced = reducedMotion.matches;
    if (!leavingTitle) titleFerris.setDance(!reducedMotion.matches);
  });
}

async function startGame() {
  sound.click();
  if (!S.game.player.name) {
    const body = el("div");
    body.innerHTML = `<p style="font-family:var(--font-talk);font-size:24px;margin-top:0">🦀 “Ahoy! I'm Ferris. I'll teach you Rust, one crab-step at a time. What should I call you?”</p>`;
    const row = el("div", "row");
    const input = el("input", "text-input");
    input.placeholder = "Your name";
    input.maxLength = 24;
    input.style.flex = "1";
    const go = el("button", "wood-btn small green", "Let's go!");
    row.append(input, go);
    body.append(row);
    const m = openModal({ title: "A new adventure", body });
    const submit = async () => {
      await api.setName(input.value.trim() || "Adventurer");
      m.close();
      await showMap();
      toast("🦀", "Click Tutorial Beach to begin!");
    };
    go.onclick = submit;
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    setTimeout(() => input.focus(), 50);
    return;
  }
  showMap();
}

/** Predict levels: make the code panel just tall enough for the code. */
function fitPredictCode() {
  const col = $(".left-col");
  if (!answers(S.level?.kind)) { col.style.removeProperty("--code-h"); return; }
  const lines = editor.value.trimEnd().split("\n").length;
  const lh = editor.lineHeight();
  // Every code line, plus the "main.rs" label, the frame and the editor's padding.
  const chrome = $(".editor-frame").offsetHeight - $("#editor").offsetHeight + 24;
  const h = Math.min(Math.round(innerHeight * 0.45), Math.max(110, Math.ceil(lines * lh + chrome)));
  col.style.setProperty("--code-h", `${h}px`);
}

// ---------------------------------------------------------------- boot

// If something breaks, say so (instead of buttons silently doing nothing).
let errorShown = false;
addEventListener("error", e => {
  if (errorShown) return;
  errorShown = true;
  toast("⚠", `Something went wrong (${escapeHtml(e.message || "script error")}). Try a hard refresh: Ctrl+Shift+R.`);
});

async function boot() {
  // The title buttons first, so nothing below can leave them dead.
  $("#btn-start").onclick = leaveTitle;
  $("#btn-title-settings").onclick = openSettings;
  applyIcons();
  for (const g of document.querySelectorAll("[data-glyph]")) g.innerHTML = pixelGlyph(g.dataset.glyph) || g.dataset.glyph;
  document.body.style.setProperty("--grass-tile", `url(${grassTileURL()})`);
  ferris = new Ferris($("#ferris-canvas"), { scale: 6 });
  titleFerris = new Ferris($("#title-ferris"), { scale: 6, pad: 6 });
  titleFerris.setMood("happy");
  titleFerris.setDance(!reducedMotion.matches);
  setupTitle();
  // The rusty sign. It lands about halfway through its drop animation.
  logoSign = new LogoSign({ canvas: $("#logo-canvas"), sub: $("#logo-sub"), reduced: reducedMotion.matches });
  setTimeout(() => logoSign.land(), 620);
  worldMap = new WorldMap($("#map-canvas"), $("#map-overlay"), { onSelect: openWorldBoard });
  editor = new Editor($("#editor"), {
    onRun: runCode,
    onVimError: m => toast("⌨️", escapeHtml(m.message || "Neovim problem")),
    onChange: code => {
      const id = S.level?.id;
      if (id && !answers(S.level.kind)) scheduleDraft(id, code);
    },
  });

  requestAnimationFrame(titleLoop);

  $("#btn-lesson").onclick = () => toggleLesson("lesson");
  const hudPlayer = $("#hud-player");
  hudPlayer.onclick = () => { sound.click(); openRanks(); };
  hudPlayer.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hudPlayer.click(); } };
  // Click a long goal to show or hide the rest of it.
  $("#lv-goal").onclick = () => {
    const g = $("#lv-goal");
    if (g.classList.contains("long")) g.classList.toggle("open");
  };
  $("#btn-start").onclick = leaveTitle;
  $("#btn-title-settings").onclick = openSettings;
  $("#btn-settings").onclick = openSettings;
  $("#btn-codex").onclick = openCodex;
  $("#btn-workshop").onclick = openWorkshop;
  $("#btn-back-map").onclick = () => { sound.click(); showMap(); };
  $("#model-chip").onclick = openModelPicker;
  const setWide = on => {
    document.body.classList.toggle("chat-wide", on);
    const b = $("#btn-wide-chat");
    // The arrow points the way the chat's edge will move.
    b.innerHTML = pixelIcon(on ? "arrowRight" : "arrowLeft", 2);
    b.title = on ? "Make Ferris' chat narrower" : "Make Ferris' chat wider";
    try { localStorage.setItem("ff-chat-wide", on ? "1" : ""); } catch { /* ignore */ }
  };
  const setExpanded = on => {
    document.body.classList.toggle("editor-expanded", on);
    const b = $("#btn-expand");
    b.innerHTML = pixelIcon(on ? "collapse" : "expand", 1);
    b.title = on ? "Back to the normal layout (Esc)" : "Expand the editor to fill the whole window";
    try { localStorage.setItem("ff-editor-expanded", on ? "1" : ""); } catch { /* ignore */ }
    if (editor.vimActive) requestAnimationFrame(() => editor.drawVimCursor());
  };
  try { setExpanded(localStorage.getItem("ff-editor-expanded") === "1"); } catch { setExpanded(false); }
  $("#btn-expand").onclick = () => { sound.click(); setExpanded(!document.body.classList.contains("editor-expanded")); };
  const goBack = () => { if (returnLevel) { sound.click(); openLevel(returnLevel.id); } };
  $("#btn-map-back").onclick = goBack;
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && S.screen === "map" && !$("#modal-root").children.length) goBack();
  });
  $("#btn-run-mini").onclick = () => runCode();
  $("#btn-zen-compiler").onclick = () => openConsole("compiler");
  $("#btn-zen-output").onclick = () => openConsole("output");
  // Esc leaves the full-window editor (in Vim mode Esc belongs to Neovim, so use the button).
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !document.body.classList.contains("editor-expanded")) return;
    if ($("#modal-root").children.length || editor.vimActive && document.activeElement === editor.ta) return;
    setExpanded(false);
  });
  $("#btn-vim").onclick = () => {
    sound.click();
    const on = !S.game.settings.vim;
    saveSettings({ vim: on }, on ? "⌨️ Vim mode on: your keys now go to your own Neovim." : "⌨️ Vim mode off.");
  };
  try { setWide(localStorage.getItem("ff-chat-wide") === "1"); } catch { setWide(false); }
  $("#btn-wide-chat").onclick = () => { sound.click(); setWide(!document.body.classList.contains("chat-wide")); };
  $("#btn-stop").onclick = () => { sound.click(); S.ferrisStop?.abort(); };
  $("#btn-quick").onclick = e => {
    e.stopPropagation();
    if ($("#quick-menu").classList.contains("hidden")) openQuickMenu(); else closeQuickMenu();
  };
  document.addEventListener("click", e => {
    if (!e.target.closest("#quick-menu, #btn-quick")) closeQuickMenu();
  });
  $("#quick-menu").addEventListener("keydown", e => {
    const items = [...document.querySelectorAll("#quick-menu .quick-item")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.stopPropagation(); closeQuickMenu(); $("#btn-quick").focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  });
  $("#ask-form").addEventListener("submit", e => {
    e.preventDefault();
    const input = $("#ask-input");
    const q = input.value.trim();
    if (!q || S.talking) return;
    input.value = "";
    askFerris("chat", { message: q });
  });

  document.addEventListener("keydown", e => {
    if (S.screen !== "level" || $("#modal-root").children.length) return;
    // Ctrl+Enter runs the code wherever the focus is (the editor handles it itself when focused).
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!answers(S.level?.kind) || S.quizSolved) runCode();
      return;
    }
    const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) && !document.activeElement.readOnly;
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "l" || e.key === "L") { e.preventDefault(); toggleLesson(); return; }
    if (e.key === "q" || e.key === "Q") { e.preventDefault(); openQuickMenu(); return; }
    const slot = SLOTS.find(x => x.key === e.key.toUpperCase());
    if (slot) {
      const b = document.querySelector(`.slot[data-slot=${slot.id}]`);
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    }
    if (answers(S.level?.kind) && !S.quizSolved && /^[a-d]$/i.test(e.key)) {
      const c = document.querySelectorAll(".choice")[e.key.toLowerCase().charCodeAt(0) - 97];
      if (c && !c.disabled) c.click();
    }
  });

  setInterval(updateClock, 15000);

  try {
    [S.models] = await Promise.all([api.models(), refreshState()]);
    if (S.game.rustc) titleScene?.setSign(`rustc ${S.game.rustc} ✓`);
  } catch (e) {
    toast("⚠", `Can't reach the game server: ${escapeHtml(e.message)}`);
  }
  updateModelChip();
}

boot();
