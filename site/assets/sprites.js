// Pixel-art sprites drawn in code: Ferris (with moods), plus small map decorations.

const PALETTE = {
  O: "#4a1607", // outline
  R: "#f2601c", // body
  H: "#ff9a52", // highlight
  D: "#c13f0d", // shadow
  W: "#fff8ec", // eye white
  K: "#22140c", // pupil
  M: "#6b1508", // mouth
  T: "#ff7a8a", // tongue
  P: "#ff9fb0", // blush
  S: "#6cc6ff", // sweat
  s: "#d8f1ff", // sweat shine
  G: "#ffd54a", // sparkle
};

const FW = 40, FH = 30;

function grid(w, h) {
  return Array.from({ length: h }, () => Array(w).fill(null));
}

function set(g, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = c;
}

function ellipse(g, cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) {
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) set(g, x, y, c);
    }
  }
}

/** Draw on the left half and mirror it to the right (Ferris is symmetric). */
function sym(g, x, y, c) {
  set(g, x, y, c);
  set(g, FW - 1 - x, y, c);
}

function outline(g, color = "O") {
  const h = g.length, w = g[0].length;
  const out = g.map(r => r.slice());
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (g[y][x]) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx] && g[y + dy][x + dx] !== color);
    if (n) out[y][x] = color;
  }
  return out;
}

/**
 * Build Ferris for a mood and animation frame.
 * moods: idle, happy, talking, thinking, worried, excited, sleepy
 */
export function ferrisGrid({ mood = "idle", frame = 0, blink = false, mouthOpen = false, look = null } = {}) {
  let g = grid(FW, FH);
  const cx = 20, cy = 18;
  const excited = mood === "excited";
  const legShift = (mood === "excited" || mood === "walking") && frame % 2 ? 1 : 0;

  // Legs (three per side)
  for (let k = 0; k < 3; k++) {
    const x = 10 + k * 3 + (k === 2 ? 0 : 0);
    const lx = x - legShift * (k % 2 ? -1 : 1);
    sym(g, lx, 23, "D"); sym(g, lx - 1, 24, "D"); sym(g, lx - 1, 25, "D"); sym(g, lx - 2, 26, "D");
  }

  // Body with spikes along the top
  ellipse(g, cx, cy, 13.2, 6.4, "R");
  for (const x of [9, 13, 17]) {
    const top = cy - 6;
    sym(g, x, top, "R"); sym(g, x + 1, top, "R"); sym(g, x, top - 1, "R");
  }

  // Arms and claws
  const clawUp = excited ? (frame % 2 ? 3 : 2) : (mood === "talking" && frame % 2 ? 1 : 0);
  const cyc = 9 - clawUp;
  for (let i = 0; i < 5; i++) { sym(g, 8 - i * 0.6, 17 - i * (1.2 + clawUp * 0.25), "R"); sym(g, 9 - i * 0.6, 17 - i * (1.2 + clawUp * 0.25), "R"); }
  for (let y = 0; y < FH; y++) for (let x = 0; x < 10; x++) {
    const dx = (x + 0.5 - 4.6) / 4.2, dy = (y + 0.5 - cyc) / 3.8;
    if (dx * dx + dy * dy <= 1) sym(g, x, y, "R");
  }
  // pincer gap
  for (const [x, y] of [[4, cyc - 3], [4, cyc - 2], [5, cyc - 2], [5, cyc - 1], [4, cyc - 4], [3, cyc - 4]]) { set(g, x, y, null); set(g, FW - 1 - x, y, null); }

  // Eye stalks
  for (let y = 7; y <= 12; y++) sym(g, 16, y, "R");

  // Eyes
  ellipse(g, 16.5, 6.5, 2.7, 2.7, "W");
  ellipse(g, FW - 16.5, 6.5, 2.7, 2.7, "W");

  g = outline(g);

  // Shading: highlight the top rim, shadow the bottom rows of the body.
  for (let y = 1; y < FH - 1; y++) for (let x = 0; x < FW; x++) {
    if (g[y][x] !== "R") continue;
    if (g[y - 1][x] === "O") g[y][x] = "H";
    else if (y >= cy + 3 && (g[y + 1][x] === "O" || g[y + 2]?.[x] === "O")) g[y][x] = "D";
  }

  // Pupils / eye shapes
  const eyes = [16, FW - 17];
  if (blink || mood === "sleepy") {
    for (const ex of eyes) {
      for (let y = 3; y <= 10; y++) for (let x = ex - 3; x <= ex + 4; x++) if (g[y][x] === "W") g[y][x] = "H";
      for (let x = ex - 1; x <= ex + 2; x++) set(g, x, 7, "K");
    }
  } else if (excited || mood === "happy-eyes") {
    for (const ex of eyes) { for (let y = 4; y <= 9; y++) for (let x = ex - 2; x <= ex + 3; x++) if (g[y][x] === "W") g[y][x] = "R"; set(g, ex - 1, 7, "K"); set(g, ex, 6, "K"); set(g, ex + 1, 6, "K"); set(g, ex + 2, 7, "K"); }
  } else {
    let dx = 0, dy = 0;
    if (mood === "thinking") { dx = -1; dy = -1; }
    if (mood === "worried") { dy = 1; }
    if (mood === "talking" || mood === "happy") { dy = 0; dx = frame % 8 < 4 ? 0 : 1; }
    // Looking at something: { dx, dy } from -1 to 1.
    if (look) { dx = look.dx; dy = look.dy; }
    for (const ex of eyes) {
      for (const [px, py] of [[0, 0], [1, 0], [0, 1], [1, 1]]) set(g, ex + dx + px, 6 + dy + py, "K");
    }
  }

  // Mouth
  const m = (pts, c = "M") => pts.forEach(([x, y]) => set(g, x, y, c));
  if (mood === "talking" && mouthOpen) {
    m([[18, 17], [19, 17], [20, 17], [21, 17], [18, 18], [21, 18], [18, 19], [19, 19], [20, 19], [21, 19]]); m([[19, 18], [20, 18]], "T");
  } else if (excited) {
    m([[17, 16], [18, 16], [19, 16], [20, 16], [21, 16], [22, 16], [17, 17], [22, 17], [18, 18], [19, 18], [20, 18], [21, 18]]); m([[18, 17], [19, 17], [20, 17], [21, 17]], "T");
  } else if (mood === "worried") {
    m([[17, 18], [18, 17], [19, 18], [20, 17], [21, 18], [22, 17]]);
  } else if (mood === "thinking") {
    m([[19, 17], [20, 17], [21, 17]]);
  } else {
    m([[17, 16], [18, 17], [19, 17], [20, 17], [21, 17], [22, 16]]);
  }

  // Blush
  if (["happy", "excited", "talking", "idle"].includes(mood)) {
    for (const x of [11, 12, FW - 13, FW - 12]) set(g, x, 16, "P");
  }

  // Sweat drop when worried
  if (mood === "worried") {
    m([[30, 3], [30, 4], [29, 5], [30, 5], [31, 5], [29, 6], [30, 6], [31, 6], [30, 7]], "S");
    set(g, 29, 5, "s");
  }

  // Sparkles when excited
  if (excited) {
    const sp = frame % 2 ? [[2, 1], [37, 2]] : [[1, 3], [38, 0]];
    for (const [x, y] of sp) { set(g, x, y, "G"); set(g, x + 1, y + 1, "G"); set(g, x - 1, y + 1, "G"); set(g, x, y + 2, "G"); }
  }
  return g;
}

/** Ferris' colors with a different shell: for his crab friends on the title screen. */
export function crabPalette(body, highlight, shadow, outlineColor = PALETTE.O) {
  return { ...PALETTE, R: body, H: highlight, D: shadow, O: outlineColor };
}

/** Frames in one round of the dance (at 8 frames a second). */
export const DANCE_FRAMES = 64;

/**
 * One beat of the dance: sideways offset, hop height, mood and facing.
 * Shuffle, claws-up hops, a spin, shuffle back, a little song, and a big jump.
 */
export function danceStep(frame) {
  const f = ((frame % DANCE_FRAMES) + DANCE_FRAMES) % DANCE_FRAMES;
  if (f < 16) {
    // Shuffle side to side, claws pumping.
    const dx = [0, 2, 4, 2, 0, -2, -4, -2][f % 8];
    return { dx, hop: f % 2 ? -1 : 0, mood: "excited", flip: false };
  }
  if (f < 24) {
    // Claws up, hopping in place.
    return { dx: 0, hop: [0, -3, -5, -3][f % 4], mood: "excited", flip: false };
  }
  if (f < 32) {
    // A spin: turning round twice, with a little lift.
    return { dx: 0, hop: f % 4 === 1 || f % 4 === 2 ? -2 : 0, mood: "happy", flip: Math.floor(f / 2) % 2 === 1 };
  }
  if (f < 48) {
    // Shuffle the other way, facing the other side.
    const dx = [0, -2, -4, -2, 0, 2, 4, 2][f % 8];
    return { dx, hop: f % 2 ? -1 : 0, mood: "excited", flip: true };
  }
  if (f < 56) {
    // Wiggle and sing.
    return { dx: f % 2 ? 1 : -1, hop: 0, mood: "talking", flip: f % 4 < 2 };
  }
  // One big jump to finish.
  return { dx: 0, hop: [0, -3, -6, -8, -8, -6, -3, 0][f - 56], mood: "excited", flip: false };
}

export function drawGrid(ctx, g, ox, oy, scale, palette = PALETTE) {
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) {
    const c = g[y][x];
    if (!c) continue;
    ctx.fillStyle = palette[c] || c;
    ctx.fillRect(Math.round((ox + x) * scale), Math.round((oy + y) * scale), scale, scale);
  }
}

/** An animated Ferris on a canvas. */
export class Ferris {
  /** `pad` adds empty cells around Ferris so he has room to dance. */
  constructor(canvas, { scale = 6, shadow = true, pad = 0 } = {}) {
    this.canvas = canvas;
    this.scale = scale;
    this.shadow = shadow;
    this.pad = pad;
    this.dancing = false;
    // Where Ferris is looking ({ dx, dy }), or null to look around as usual.
    this.look = null;
    canvas.width = (FW + pad * 2) * scale;
    canvas.height = (FH + 2 + pad) * scale;
    this.ctx = canvas.getContext("2d");
    this.mood = "idle";
    this.frame = 0;
    this.blinkUntil = 0;
    this.nextBlink = performance.now() + 2500;
    this.moodUntil = 0;
    this.baseMood = "idle";
    this._loop = this._loop.bind(this);
    this._last = 0;
    requestAnimationFrame(this._loop);
  }

  /** Set a mood; with `ms`, return to the base mood afterwards. */
  setMood(mood, ms = 0) {
    if (ms > 0) { this.mood = mood; this.moodUntil = performance.now() + ms; }
    else { this.baseMood = mood; if (performance.now() >= this.moodUntil) this.mood = mood; }
  }

  /** Start or stop Ferris' dance routine. */
  setDance(on) {
    this.dancing = on;
    this.frame = 0;
  }

  _loop(t) {
    requestAnimationFrame(this._loop);
    const fps = this.dancing ? 8 : this.mood === "talking" ? 8 : this.mood === "excited" ? 8 : 4;
    if (t - this._last < 1000 / fps) return;
    this._last = t;
    this.frame++;
    if (this.moodUntil && t >= this.moodUntil) { this.moodUntil = 0; this.mood = this.baseMood; }
    if (t > this.nextBlink) { this.blinkUntil = t + 160; this.nextBlink = t + 2200 + Math.random() * 3000; }
    this.draw(t < this.blinkUntil);
  }

  /** One step of the dance (see danceStep). */
  danceStep() {
    return danceStep(this.frame);
  }

  draw(blink = false) {
    const { ctx, scale, pad } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let dx = 0, bob, mood = this.mood, flip = false;
    if (this.dancing && !this.look) {
      const step = this.danceStep();
      ({ dx, mood, flip } = step);
      bob = step.hop;
      blink = false;
    } else {
      bob = this.mood === "excited" ? (this.frame % 2 ? -2 : 0) : (this.frame % 4 < 2 ? 0 : 1);
    }
    if (this.shadow) {
      // The shadow shrinks a little while Ferris is in the air.
      const air = Math.min(3, -Math.min(0, bob));
      ctx.fillStyle = "rgba(60, 30, 10, .25)";
      for (let x = 8 + air; x < 32 - air; x++) ctx.fillRect((x + pad + dx) * scale, (29 + pad) * scale, scale, scale);
      for (let x = 11 + air; x < 29 - air; x++) ctx.fillRect((x + pad + dx) * scale, (30 + pad) * scale, scale, scale);
    }
    if (this.look) mood = "happy";
    const g = ferrisGrid({ mood, frame: this.frame, blink, mouthOpen: this.frame % 2 === 0, look: this.look });
    if (flip) {
      ctx.save();
      ctx.translate(this.canvas.width, 0);
      ctx.scale(-1, 1);
      drawGrid(ctx, g, pad - dx, 1 + pad + bob, scale);
      ctx.restore();
    } else {
      drawGrid(ctx, g, pad + dx, 1 + pad + bob, scale);
    }
  }
}

// ---------- Small map decorations (string pixel art) ----------
const DECOR_PAL = {
  o: "#2d1a0e", g: "#3f8f2f", G: "#6cc04a", l: "#9be06e", t: "#7a4a24", T: "#a8693a",
  w: "#f3ead8", r: "#c0392b", R: "#e5533d", y: "#ffd54a", s: "#8d8d8d", S: "#bdbdbd", d: "#5a5a5a",
  b: "#3a2a20", p: "#ff9fd0", n: "#2e6b25", O: "#e86a1d", c: "#ffffff", k: "#151515",
};

export const DECOR = {
  tree: [
    "..oooo..",
    ".oGGlGo.",
    "oGlGGGGo",
    "oGGGGgGo",
    "ogGGGGgo",
    ".ogggg o".replace(" ", "o"),
    "..otTo..",
    "..otTo..",
  ],
  pine: [
    "...oo...",
    "..oGGo..",
    ".oGlGGo.",
    "..oGgo..",
    ".oGGGgo.",
    "oGGlGGgo",
    "oooTtooo",
    "...tT...",
  ],
  palm: [
    ".oo..oo.",
    "oGGooGGo",
    ".oGGGGo.",
    "oG.oT.Go",
    "...oTo..",
    "...oTo..",
    "..oTto..",
    "..oTto..",
  ],
  house: [
    "...oo...",
    "..oRRo..",
    ".oRRRRo.",
    "oRRrrRRo",
    "owwwwwwo",
    "owTTwyyo",
    "owTTwyyo",
    "oooooooo",
  ],
  rock: [
    "........",
    "...oo...",
    "..oSSo..",
    ".oSSsso.",
    "oSssssdo",
    "oSsssddo",
    ".oooooo.",
    "........",
  ],
  cave: [
    "..oooo..",
    ".oSSSSo.",
    "oSSkkSSo",
    "oSkkkkdo",
    "oSkkkkdo",
    "osskkddo",
    "oooooooo",
    "........",
  ],
  flower: [
    "........",
    "..p.p...",
    ".pyp....",
    "..p..p..",
    "..n.pyp.",
    "..n..p..",
    "..n..n..",
    "........",
  ],
  anvil: [
    "........",
    "oooooooo",
    "osssssso",
    ".oossoo.",
    "..osso..",
    ".osssso.",
    "oddddddo",
    "........",
  ],
  volcano: [
    "...RR...",
    "..oRRo..",
    "..odd o".replace(" ", "o"),
    ".odddd o".replace(" ", "o"),
    ".oddRddo",
    "oddddRdo",
    "odddddddo".slice(0, 8),
    "oooooooo",
  ],
  flag: [
    "oRRRo...",
    "oRRRRRo.",
    "oRRRo...",
    "o.......",
    "o.......",
    "o.......",
    "o.......",
    "oo......",
  ],
  barrier: [
    "........",
    "oooooooo",
    "oyykkyyo",
    "okkyykko",
    "oooooooo",
    ".ot..to.",
    ".ot..to.",
    "oTo..oTo",
  ],
  lock: [
    "..oooo..",
    ".o....o.",
    ".o....o.",
    "oyyyyyyo",
    "oyyooyyo",
    "oyyooyyo",
    "oyyyyyyo",
    "oooooooo",
  ],
};

export function drawDecor(ctx, name, x, y, scale = 1) {
  const rows = DECOR[name];
  if (!rows) return;
  for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
    const c = rows[j][i];
    if (c === "." || c === " ") continue;
    ctx.fillStyle = DECOR_PAL[c] || "#000";
    ctx.fillRect(Math.round(x + i * scale), Math.round(y + j * scale), scale, scale);
  }
}

/** A tiling grass texture for the page background. */
export function grassTileURL() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#5c9e3c";
  ctx.fillRect(0, 0, 32, 32);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const shades = ["#4f8f33", "#6aae47", "#589a39", "#73b84f"];
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = shades[Math.floor(rnd() * shades.length)];
    const x = Math.floor(rnd() * 32), y = Math.floor(rnd() * 32);
    ctx.fillRect(x, y, 1, 2);
  }
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(rnd() * 30), y = Math.floor(rnd() * 30);
    ctx.fillStyle = "#3d7a2a"; ctx.fillRect(x, y + 1, 1, 2); ctx.fillRect(x + 2, y, 1, 3); ctx.fillRect(x + 1, y + 1, 1, 2);
  }
  return c.toDataURL();
}
