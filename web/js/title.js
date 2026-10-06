// The title screen: a pixel-art beach drawn in code. Ferris dances on the sand with two
// crab friends, waves roll in, palms sway, a forge-shaped sandcastle puffs smoke, kites fly,
// a ship with the Rust gear on its sail crosses the horizon, and bottles with bits of Rust
// wash ashore. Static layers (sky, sea, sand) are drawn once per window size and cached.

import { ferrisGrid, drawGrid, crabPalette, danceStep, drawDecor } from "./sprites.js";

const PX = 4; // CSS pixels per scene pixel

// Two crab friends who copy Ferris' moves a beat later.
const FRIENDS = [
  { side: -1, lag: 2, palette: crabPalette("#2fa7a0", "#6fd9cf", "#1d7a75", "#0f3b39") },
  { side: 1, lag: 4, palette: crabPalette("#9b5de5", "#c49af2", "#6c3aa8", "#2e1650") },
];

const BOTTLE_NOTES = [
  "fn main() {}", "Ok(🦀)", "&mut self", "'a", "cargo run", "impl Crab for Ferris",
  "Some(treasure)", "?", "unsafe { 🙈 }", "match tide { … }", "loop { dance(); }",
  "#[derive(Fun)]", "Box<Sandcastle>", "Rc::clone(&shell)",
];

const NOTE = ["..#..", "..##.", "..#.#", "..#..", "###..", "###.."];
const GEAR_SAIL = ["..#.#..", ".#####.", "##...##", ".#...#.", "##...##", ".#####.", "..#.#.."];
const BRACE = [".##", ".#.", "#..", ".#.", ".##"];
const GULL = [
  ["#.....#", ".#...#.", "..###.."],
  [".......", "##...##", "..###.."],
];
const BOTTLE = [
  "..gggg...",
  "pgwwwwggc",
  "pgwwwwggc",
  "..gggg...",
];
const BOTTLE_PAL = { g: "#4fae6a", w: "#fff3d0", c: "#a0703a", p: "#8fd6a0" };
const STARFISH = ["..o..", "ooooo", ".ooo.", ".o.o."];
const SHELL = [".pp.", "pwwp", "pppp"];
const SHELL_PAL = { p: "#f7a8b8", w: "#fff0f3", o: "#ff8a5c" };

/** A small deterministic random number in [0, 1) for position i. */
function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** 4×4 ordered dither: smooth gradients that still look like pixel art. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);

function lerpColor(a, b, f) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = s => Math.round(((pa >> s) & 255) * (1 - f) + ((pb >> s) & 255) * f);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export class TitleScene {
  constructor({ canvas, ferrisCanvas, ferris, props, reduced }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ferrisCanvas = ferrisCanvas;
    this.ferris = ferris;
    this.props = props;
    this.reduced = reduced;
    this.cache = null;
    this.cacheKey = "";
    this.cloudSprites = new Map();
    this.notes = [];
    this.lastNote = 0;
    this.smoke = [];
    this.lastSmoke = 0;
    this.gulls = [];
    this.nextGull = 2000;
    this.bottle = null;
    this.nextBottle = 4000;
    this.prints = [];
    this.nextTrail = 1500;
    this.trail = null;
    this.sparks = [];
    this.look = null;
    this.exitAt = 0;

    // HTML on top of the scene: the wooden sign and the note from a bottle.
    this.sign = document.createElement("div");
    this.sign.className = "beach-sign";
    this.sign.innerHTML = `<div class="beach-sign-board"></div><div class="beach-sign-post"></div>`;
    this.note = document.createElement("div");
    this.note.className = "bottle-note";
    props.append(this.sign, this.note);
  }

  /** The text on the sign, e.g. the compiler version. */
  setSign(text) {
    this.sign.querySelector(".beach-sign-board").textContent = text;
  }

  /** Where everything goes, from the window size and where Ferris stands. */
  layout() {
    // While Ferris scuttles off, his canvas moves: keep the beach where it was.
    if (this.exitAt && this.frozen) return this.frozen;
    const w = Math.ceil(innerWidth / PX), h = Math.ceil(innerHeight / PX);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const f = this.ferrisCanvas.getBoundingClientRect();
    // Ferris' canvas is 38 cells tall; his shadow sits on row 35.
    const feet = f.height ? (f.top + f.height * (35.5 / 38)) / PX : h * 0.62;
    const ferrisX = f.width ? (f.left + f.width / 2) / PX : w / 2;
    const shore = Math.max(40, Math.round(feet - 16));
    const horizon = Math.max(26, Math.round(shore * 0.6));
    // Props shrink a little on smaller windows so the beach doesn't get crowded.
    const s = Math.max(0.55, Math.min(1, w / 360, h / 225));
    // Where the crab friends dance (see drawFriends), with room for their moves.
    const gap = Math.max(60, ((f.width || 312) / PX) * 0.62 + 28);
    const friends = [-1, 1].map(side => {
      const x = Math.round(ferrisX + side * gap - 20);
      return { left: x - 4, right: x + 44, top: feet - 38, bottom: feet + 3 };
    });
    // The tagline under the Start button, which the props on the sand keep clear of.
    const tag = document.querySelector(".title-foot")?.getBoundingClientRect();
    const foot = tag?.width ? { left: tag.left / PX, right: tag.right / PX, top: tag.top / PX } : null;
    return { w, h, feet, ferrisX, shore, horizon, s, foot, friends, gap, ferrisW: (f.width || 312) / PX };
  }

  /** Splash of sparkles where the player clicked (CSS pixels). */
  splash(cx, cy) {
    if (this.reduced) return;
    const x = cx / PX, y = cy / PX;
    const L = this.lastLayout;
    const colors = !L || y < L.horizon ? ["#ffd54a", "#fff6c2", "#ffffff"]
      : y < L.shore ? ["#ffffff", "#bfe6ff", "#8fd3f5"]
      : ["#f6dc9e", "#ffffff", "#ffd54a", "#e2bb72"];
    for (let i = 0; i < 14; i++) {
      const a = Math.PI * (1 + Math.random());
      const v = 12 + Math.random() * 22;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: performance.now(), color: colors[i % colors.length] });
    }
  }

  /** Ferris (and friends) look towards something, or null to keep dancing. */
  setLook(look) { this.look = look; }

  /** Everyone waves and scuttles off (when Start is clicked). */
  exit() { this.frozen = this.lastLayout; this.exitAt = performance.now(); }
  reset() { this.exitAt = 0; this.frozen = null; }

  // ------------------------------------------------------------------ static layers

  buildCache(L) {
    const { w, h, shore, horizon } = L;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const dither = (y0, y1, stops) => {
      for (let y = y0; y < y1; y++) {
        const p = (y - y0) / Math.max(1, y1 - y0 - 1) * (stops.length - 1);
        const i = Math.min(stops.length - 2, Math.floor(p)), frac = p - i;
        for (let x = 0; x < w; x++) {
          ctx.fillStyle = frac > BAYER[(y % 4) * 4 + (x % 4)] ? stops[i + 1] : stops[i];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    };
    // Sky: blue above, warm golden haze near the horizon.
    dither(0, horizon, ["#4f9fe0", "#69b2ea", "#8cc6f0", "#b5daf1", "#e9dfc7", "#f7cf98"]);
    // Sea: hazy at the horizon, deep in the middle, turquoise in the shallows.
    dither(horizon, shore + 6, ["#a9cde0", "#5aa2d6", "#3d8fcf", "#3a97cc", "#45b3c6"]);
    // Sand: light near the water, warmer towards the viewer.
    dither(shore, h, ["#f6db9c", "#f3d492", "#efcd88", "#e9c47d"]);
    // A few speckles in the sand.
    for (let i = 0; i < w * (h - shore) / 40; i++) {
      const x = Math.floor(hash(i) * w), y = shore + 4 + Math.floor(hash(i + 999) * (h - shore - 4));
      ctx.fillStyle = hash(i + 77) > 0.6 ? "#fbe8bb" : "#d9b06c";
      ctx.fillRect(x, y, 1, 1);
    }
    // Shells and starfish, away from the middle where Ferris and the buttons are.
    const items = [[0.08, 0.55, STARFISH, "#ff8a5c"], [0.3, 0.86, SHELL], [0.62, 0.92, STARFISH, "#ffb04a"], [0.7, 0.5, SHELL], [0.93, 0.78, SHELL], [0.42, 0.95, SHELL]];
    for (const [fx, fy, sprite, color] of items) {
      const x = Math.round(fx * w), y = Math.round(shore + 8 + fy * (h - shore - 14));
      sprite.forEach((row, j) => [...row].forEach((ch, i) => {
        if (ch === ".") return;
        ctx.fillStyle = color && ch === "o" ? color : SHELL_PAL[ch];
        ctx.fillRect(x + i, y + j, 1, 1);
      }));
    }
    // Distant islands on the horizon: a hint of the 25 islands on the map.
    const isle = (cx, rx, ry, col) => {
      ctx.fillStyle = col;
      for (let x = -rx; x <= rx; x++) {
        const hgt = Math.round(ry * Math.sqrt(1 - (x / rx) ** 2));
        ctx.fillRect(Math.round(cx + x), horizon - hgt, 1, hgt);
      }
    };
    isle(w * 0.08, 16, 5, "#93b9cc");
    isle(w * 0.15, 9, 3, "#a4c4d3");
    isle(w * 0.64, 12, 4, "#9cbfd0");
    isle(w * 0.93, 20, 6, "#8db3c7");
    // A tiny palm on one, and a lighthouse on another (its light blinks; see draw).
    ctx.fillStyle = "#6f97ab";
    ctx.fillRect(Math.round(w * 0.08), horizon - 9, 1, 4);
    ctx.fillRect(Math.round(w * 0.08) - 2, horizon - 10, 5, 1);
    const lx = Math.round(w * 0.93);
    for (let y = 0; y < 9; y++) {
      ctx.fillStyle = y % 3 === 1 ? "#d9534f" : "#f4f4f4";
      ctx.fillRect(lx - 1, horizon - 6 - y, 3, 1);
    }
    return c;
  }

  cloudSprite(size, shade, light) {
    const key = `${size}|${shade}|${light}`;
    if (this.cloudSprites.has(key)) return this.cloudSprites.get(key);
    const c = document.createElement("canvas");
    const blobs = [[0, 0.55], [0.32, 0.8], [0.66, 1], [1, 0.7], [1.3, 0.5]].map(([fx, fr]) => [fx * size * 2.2, fr * size]);
    c.width = Math.ceil(size * 4.2); c.height = Math.ceil(size * 2.4);
    const ctx = c.getContext("2d");
    const base = Math.ceil(size * 1.9);
    const blob = (cx, cy, r, col) => {
      ctx.fillStyle = col;
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r && cy + y <= base) ctx.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
    };
    for (const [bx, r] of blobs) blob(bx + size * 0.6, base - r * 0.6 + 1, Math.round(r), shade);
    for (const [bx, r] of blobs) blob(bx + size * 0.6, base - r * 0.6 - 1, Math.round(r), light);
    this.cloudSprites.set(key, c);
    return c;
  }

  // ------------------------------------------------------------------ drawing

  draw(t) {
    const L = this.layout();
    this.lastLayout = L;
    const key = `${L.w}x${L.h}:${L.shore}:${L.horizon}`;
    if (key !== this.cacheKey) { this.cache = this.buildCache(L); this.cacheKey = key; }
    const ctx = this.ctx;
    const sec = this.reduced ? 12 : t / 1000;
    ctx.drawImage(this.cache, 0, 0);

    this.drawSun(L, sec);
    this.drawClouds(L, sec);
    this.drawShip(L, sec);
    this.drawLighthouse(L, sec);
    this.drawSea(L, sec);
    this.drawKites(L, sec);
    if (!this.reduced) this.drawGulls(L, t);
    this.drawPrints(L, t);
    // The castle and the umbrella stand further back than the palms, whose trunks come
    // all the way down to the bottom of the screen; the crabs dance in front of them all.
    this.drawCastle(L, sec, t);
    this.drawUmbrella(L, sec);
    this.drawPalm(L, Math.round(L.w * 0.03), L.h + 2, 1, sec);
    this.drawPalm(L, Math.round(L.w * 0.97), L.h + 2, -1, sec + 2);
    this.drawBottle(L, t);
    this.drawFriends(L, t);
    this.drawSignSpot(L);
    if (!this.reduced) this.drawNotes(L, t);
    this.drawSparks(t);
  }

  drawSun(L, sec) {
    const ctx = this.ctx;
    const cx = Math.round(L.w * 0.78), cy = L.horizon - 9;
    const glow = 3 + Math.round((Math.sin(sec * 1.5) + 1));
    for (const [r, a] of [[14 + glow + 4, 0.12], [14 + glow, 0.2]]) {
      ctx.fillStyle = `rgba(255, 226, 150, ${a})`;
      for (let y = -r; y <= r; y++) {
        const half = Math.floor(Math.sqrt(r * r - y * y));
        if (cy + y < L.horizon) ctx.fillRect(cx - half, cy + y, half * 2 + 1, 1);
      }
    }
    for (let y = -11; y <= 11; y++) {
      if (cy + y >= L.horizon) break;
      const half = Math.floor(Math.sqrt(121 - y * y));
      ctx.fillStyle = y > 3 ? "#ffd98a" : y > -4 ? "#ffe9a8" : "#fff4c8";
      ctx.fillRect(cx - half, cy + y, half * 2 + 1, 1);
    }
  }

  drawClouds(L, sec) {
    // Three layers: far ones are small, warm and slow; near ones big, white and faster.
    const layers = [
      { n: 3, size: 4, speed: 0.8, y: [0.62, 0.78], shade: "#efcfb0", light: "#fbe9d6" },
      { n: 3, size: 6, speed: 2, y: [0.3, 0.5], shade: "#d5e3ef", light: "#ffffff" },
      { n: 2, size: 9, speed: 3.6, y: [0.1, 0.22], shade: "#cfdcea", light: "#ffffff" },
    ];
    layers.forEach((layer, li) => {
      const sprite = this.cloudSprite(layer.size, layer.shade, layer.light);
      const span = L.w + sprite.width + 20;
      for (let i = 0; i < layer.n; i++) {
        const seed = li * 10 + i;
        const x = ((hash(seed) * span + sec * layer.speed) % span) - sprite.width - 10;
        const y = Math.round(L.horizon * (layer.y[0] + hash(seed + 5) * (layer.y[1] - layer.y[0])) - sprite.height / 2);
        this.ctx.drawImage(sprite, Math.round(x), y);
      }
    });
  }

  drawShip(L, sec) {
    const ctx = this.ctx;
    const span = L.w + 40;
    const x = Math.round(((sec * 3.2) % span) - 20);
    const y = L.horizon - 1 + (Math.floor(sec * 2) % 2);
    ctx.fillStyle = "#6b4226";
    for (let i = 0; i < 3; i++) ctx.fillRect(x - 7 + i, y + i, 15 - i * 2, 1);
    ctx.fillStyle = "#4a2c18";
    ctx.fillRect(x, y - 12, 1, 12);
    ctx.fillStyle = "#fff8ec";
    ctx.fillRect(x - 5, y - 11, 10, 9);
    ctx.fillStyle = "#b7410e";
    GEAR_SAIL.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === "#") ctx.fillRect(x - 4 + i, y - 10 + j, 1, 1); }));
    ctx.fillStyle = "#f2601c";
    ctx.fillRect(x + 1, y - 14, 3, 2);
  }

  drawLighthouse(L, sec) {
    const on = Math.floor(sec * 1.5) % 3 !== 0;
    const ctx = this.ctx;
    const x = Math.round(L.w * 0.93), y = L.horizon - 16;
    ctx.fillStyle = on ? "#fff3a0" : "#8a8a7a";
    ctx.fillRect(x - 1, y, 3, 2);
    if (on) { ctx.fillStyle = "rgba(255, 240, 160, .35)"; ctx.fillRect(x - 4, y, 9, 2); }
  }

  drawSea(L, sec) {
    const ctx = this.ctx;
    const { w, horizon, shore } = L;
    // Sparkles drifting on the water.
    for (let i = 0; i < 70; i++) {
      const depth = hash(i + 300);
      const y = Math.round(horizon + 2 + depth * (shore - horizon - 6));
      const x = Math.round((hash(i) * w + sec * (1 + depth * 3)) % w);
      const on = (i + Math.floor(sec * 2)) % 5;
      if (on > 2) continue;
      ctx.fillStyle = on === 0 ? "#ffffff" : "#bfe2f5";
      ctx.fillRect(x, y, 1 + Math.round(depth * 3), 1);
    }
    // The sun's reflection: a broken shimmering column under the sun.
    const sx = Math.round(w * 0.78);
    for (let y = horizon + 1; y < shore - 2; y += 2) {
      const spread = 3 + (y - horizon) * 0.25;
      const wob = Math.sin(sec * 3 + y * 0.9) * spread * 0.6;
      const len = Math.max(1, Math.round(spread * (0.6 + 0.4 * Math.sin(sec * 5 + y))));
      ctx.fillStyle = (y + Math.floor(sec * 4)) % 4 === 0 ? "#fff4c8" : "#ffd98a";
      ctx.fillRect(Math.round(sx + wob - len / 2), y, len, 1);
    }
    // Waves: the water's edge rolls in and out; foam breaks on the sand.
    const tide = Math.sin(sec * (Math.PI * 2 / 6)) * 3.5;
    const edge = x => shore + tide + Math.sin(x * 0.13 + sec * 1.4) * 1.2 + Math.sin(x * 0.047 - sec * 0.8) * 1.4;
    for (let x = 0; x < w; x++) {
      const e = Math.round(edge(x));
      // Wet sand where the last wave reached.
      ctx.fillStyle = "#d9b46c";
      const reach = shore + 5;
      if (reach > e + 1) ctx.fillRect(x, e + 1, 1, reach - e - 1);
      // Water down to the edge, then foam.
      ctx.fillStyle = "#45b3c6";
      const top = shore - 6;
      if (e > top) ctx.fillRect(x, top, 1, e - top);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, e, 1, 1);
      if ((x + Math.floor(sec * 6)) % 7 < 3) ctx.fillRect(x, e - 1, 1, 1);
      // A second, fainter line of foam further out.
      const out = Math.round(e - 5 - Math.sin(sec * 1.1 + x * 0.05) * 1.5);
      if ((x + Math.floor(sec * 3)) % 5 < 3) { ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.fillRect(x, out, 1, 1); }
    }
  }

  drawKites(L, sec) {
    const ctx = this.ctx;
    // A Rust gear on the left, a { } kite on the right. Strings go down to the sand.
    const kites = [
      { ax: L.w * 0.2, ay: L.horizon * 0.42, gx: L.w * 0.14, gy: L.shore + 22, type: "gear" },
      { ax: L.w * 0.84, ay: L.horizon * 0.33, gx: L.w * 0.8, gy: L.shore + 18, type: "braces" },
    ];
    kites.forEach((k, ki) => {
      const x = Math.round(k.ax + Math.sin(sec * 0.6 + ki * 2) * 6);
      const y = Math.round(k.ay + Math.sin(sec * 0.9 + ki) * 3);
      // String with a gentle sag.
      ctx.fillStyle = "rgba(255,255,255,.75)";
      for (let i = 0; i <= 60; i++) {
        const f = i / 60;
        const sx = x + (k.gx - x) * f, sy = y + 6 + (k.gy - y - 6) * f + Math.sin(f * Math.PI) * 6;
        ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1);
      }
      // Tail ribbons.
      for (let i = 0; i < 12; i++) {
        const tx = x + Math.sin(sec * 4 + i * 0.6) * (1 + i * 0.3), ty = y + (k.type === "gear" ? 7 : 10) + i;
        ctx.fillStyle = i % 4 < 2 ? "#ffd54a" : "#e5533d";
        ctx.fillRect(Math.round(tx), ty, 1, 1);
      }
      if (k.type === "gear") {
        // The Rust gear, turning slowly.
        const rot = sec * 0.8;
        for (let j = -7; j <= 7; j++) for (let i = -7; i <= 7; i++) {
          const r = Math.hypot(i, j), a = Math.atan2(j, i);
          const tooth = Math.cos(8 * (a - rot)) > 0.2;
          if (r <= (tooth ? 7 : 5.3) && r > 2.2) {
            ctx.fillStyle = r > 4.6 ? "#b7410e" : (i + j < 0 ? "#e0661f" : "#c94f15");
            ctx.fillRect(x + i, y + j, 1, 1);
          }
        }
      } else {
        // A diamond kite with { } on it.
        for (let j = -10; j <= 10; j++) {
          const half = Math.round(9 - Math.abs(j) * 9 / 10);
          for (let i = -half; i <= half; i++) {
            const border = Math.abs(i) === half || Math.abs(j) === 10;
            ctx.fillStyle = border ? "#8a5a1a" : (i < 0) !== (j < 0) ? "#ffd54a" : "#ffe27a";
            ctx.fillRect(x + i, y + j, 1, 1);
          }
        }
        ctx.fillStyle = "#3a1a08";
        BRACE.forEach((row, j) => [...row].forEach((ch, i) => {
          if (ch !== "#") return;
          ctx.fillRect(x - 4 + i, y - 2 + j, 1, 1);
          ctx.fillRect(x + 4 - i, y - 2 + j, 1, 1);
        }));
      }
    });
  }

  drawGulls(L, t) {
    if (t > this.nextGull) {
      this.nextGull = t + 6000 + Math.random() * 7000;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.gulls.push({ dir, born: t, y: L.horizon * (0.15 + Math.random() * 0.45), speed: 14 + Math.random() * 8, seed: Math.random() * 10 });
    }
    const ctx = this.ctx;
    this.gulls = this.gulls.filter(g => {
      const age = (t - g.born) / 1000;
      const x = g.dir > 0 ? -8 + age * g.speed : L.w + 8 - age * g.speed;
      if (x < -12 || x > L.w + 12) return false;
      const y = Math.round(g.y + Math.sin(age * 1.5 + g.seed) * 3);
      const gliding = (age * 0.5 + g.seed) % 1 < 0.4;
      const frame = gliding ? 1 : Math.floor(age * 6) % 2;
      ctx.fillStyle = "#3f4a55";
      GULL[frame].forEach((row, j) => [...row].forEach((ch, i) => { if (ch === "#") ctx.fillRect(Math.round(x) - 3 + i, y + j, 1, 1); }));
      return true;
    });
  }

  drawPrints(L, t) {
    // Every so often a little crab scuttles across the sand, leaving tracks that fade.
    if (!this.reduced && !this.trail && t > this.nextTrail) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.trail = { dir, born: t, y: L.shore + 26 + Math.random() * Math.max(4, L.h - L.shore - 36), last: 0 };
    }
    if (this.trail) {
      const tr = this.trail;
      const age = (t - tr.born) / 1000;
      const x = tr.dir > 0 ? -4 + age * 18 : L.w + 4 - age * 18;
      if (x < -6 || x > L.w + 6) { this.trail = null; this.nextTrail = t + 9000 + Math.random() * 8000; }
      else {
        if (t - tr.last > 220) {
          tr.last = t;
          this.prints.push({ x, y: tr.y + Math.sin(age * 2) * 2, born: t, step: this.prints.length % 2 });
        }
        // The tiny crab itself.
        const ctx = this.ctx;
        const cy = Math.round(tr.y + Math.sin(age * 2) * 2) - 2;
        ctx.fillStyle = "#e5533d";
        ctx.fillRect(Math.round(x) - 1, cy, 3, 2);
        ctx.fillRect(Math.round(x) - 2 + (Math.floor(age * 8) % 2), cy - 1, 1, 1);
        ctx.fillRect(Math.round(x) + 2 - (Math.floor(age * 8) % 2), cy - 1, 1, 1);
      }
    }
    const ctx = this.ctx;
    this.prints = this.prints.filter(p => {
      const age = (t - p.born) / 1000;
      if (age > 8) return false;
      ctx.fillStyle = `rgba(150, 105, 45, ${0.45 * (1 - age / 8)})`;
      const off = p.step ? 2 : -2;
      ctx.fillRect(Math.round(p.x), Math.round(p.y + off), 1, 1);
      ctx.fillRect(Math.round(p.x) + 1, Math.round(p.y + off) + 1, 1, 1);
      return true;
    });
  }

  // ------------------------------------------------------------------ the forge castle

  /** The sandcastle's static parts, drawn once: shaped, lit from the right (the sun), with
   *  battlements, arrow slits, pressed-in shells, a stone arch, and sand heaped at its foot. */
  castleSprite() {
    if (this._castle) return this._castle;
    const W = 58, H = 44, G = 41; // G: the ground line
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const px = (x, y, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); };
    // The beach's own sand colors (see buildCache), from shadow to sunlit.
    const SAND = ["#b48a4a", "#c99e5c", "#dbb36f", "#efcd88", "#f6db9c", "#fcebc0"];
    // A pixel of packed sand at shade level k (fractions are dithered, like the beach),
    // with the beach's speckles.
    const sand = (x, y, k) => {
      const lo = Math.max(0, Math.min(5, Math.floor(k))), frac = k - Math.floor(k);
      let col = SAND[frac > BAYER[(y % 4) * 4 + (x % 4)] ? Math.min(5, lo + 1) : lo];
      const n = hash(x * 1.3, y * 2.1, 7);
      if (n > 0.965) col = "#fbe8bb";
      else if (n < 0.035) col = "#d9b06c";
      px(x, y, col);
    };
    // A wall lit from the right (the sun): darker on the left, brighter on the right.
    // Round walls (towers) shade smoothly across; flat ones only darken at the edges.
    const wall = (x0, y0, w, h, round = false, grounded = false) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const f = (x - x0) / Math.max(1, w - 1);
        let k = round ? 0.9 + f * 3.4 : x === x0 ? 1.6 : x === x0 + w - 1 ? 4.3 : 3.0;
        // Walls that stand on the beach get darker towards the sand.
        const fromBottom = y0 + h - 1 - y;
        if (grounded && fromBottom < 3) k -= (3 - fromBottom) * 0.4;
        sand(x, y, k);
      }
    };
    const teeth = (x0, y, w, count) => {
      const step = w / count;
      for (let i = 0; i < count; i++) {
        const tx = Math.round(x0 + i * step + (step - 3) / 2);
        wall(tx, y - 3, 3, 3);
        px(tx + 2, y - 3, SAND[4]);
      }
    };
    // Main hall with battlements.
    wall(15, 19, 28, G - 19 + 1, false, true);
    teeth(15, 19, 28, 6);
    // Left tower: tall and round, with a pointed roof.
    wall(5, 9, 11, G - 9 + 1, true, true);
    for (let j = 0; j < 7; j++) {
      const half = Math.round((j + 1) * 5.5 / 7);
      for (let i = -half; i <= half; i++) px(10 + i, 2 + j, SAND[i < -half / 2 ? 2 : i > half / 3 ? 5 : 4]);
    }
    for (let i = 0; i < 11; i++) px(5 + i, 9, SAND[1]);
    // Right tower: squat and round, with battlements and a stone chimney.
    wall(41, 15, 11, G - 15 + 1, true, true);
    teeth(41, 15, 11, 2);
    for (let y = 4; y < 14; y++) for (let x = 46; x < 50; x++) {
      const stone = ((y + (x > 47 ? 1 : 0)) % 3 === 0) ? "#5f5a55" : x === 49 ? "#a49e95" : "#7d7770";
      px(x, y, stone);
    }
    for (let x = 45; x < 51; x++) px(x, 3, "#5f5a55");
    // Arrow slits.
    for (const [x, y] of [[10, 13], [10, 22], [46, 21], [20, 24], [37, 24]]) {
      px(x, y, "#4a2c16"); px(x, y + 1, "#4a2c16"); px(x, y + 2, "#4a2c16");
    }
    // Shells pressed into the walls.
    for (const [x, y, col] of [[7, 28, "#f7a8b8"], [24, 21, "#fff0f3"], [34, 30, "#f7a8b8"], [48, 27, "#fff0f3"], [12, 37, "#f7a8b8"], [44, 38, "#fff0f3"]]) {
      px(x, y, col); px(x + 1, y, col); px(x, y + 1, "#e38c9c");
    }
    // The forge door: a stone arch (the fire inside is drawn every frame).
    const DX = 25, DY = G - 8, DW = 9, DH = 9;
    for (let y = DY; y < DY + DH; y++) for (let x = DX; x < DX + DW; x++) {
      const top = y < DY + 3 && Math.abs(x - (DX + DW / 2 - 0.5)) > (y - DY) + 2;
      if (top) continue;
      const edge = x === DX || x === DX + DW - 1 || y === DY || (y < DY + 3 && Math.abs(x - (DX + DW / 2 - 0.5)) >= (y - DY) + 1);
      px(x, y, edge ? (hash(x, y, 2) > 0.5 ? "#7d7770" : "#a49e95") : "#2a160a");
    }
    // Sand heaped up unevenly along the foot of the walls (not in front of the door).
    for (let x = 3; x < W - 3; x++) {
      if (x >= DX && x < DX + DW) continue;
      const hgt = Math.max(0, Math.round(1 + hash(x, 1, 21) * 1.8 - (x < 6 || x > W - 7 ? 1 : 0)));
      for (let j = 0; j < hgt; j++) sand(x, G - j, 2.4 + (x / W) * 1.4 - j * 0.3);
    }
    // A thin outline of damp, darker sand around the whole castle, so it stands out from
    // the beach while staying the same sand.
    const img = ctx.getImageData(0, 0, W, H);
    const filled = (x, y) => x >= 0 && y >= 0 && x < W && y < H && img.data[(y * W + x) * 4 + 3] > 0;
    // (Not along the bottom: there the castle meets the beach.)
    for (let y = 0; y < G - 1; y++) for (let x = 0; x < W; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) px(x, y, "#a98042");
    }
    this._castle = { canvas: c, W, H, G, door: { x: DX + 1, y: DY + 2, w: DW - 2, h: DH - 2 }, chimney: { x: 48, y: 3 }, flag: { x: 10, y: 1 } };
    return this._castle;
  }

  /**
   * Where a prop on the sand goes: near its preferred spot, but never under a dancing
   * crab or the tagline. It moves down the beach first (in front of the crab), then sideways.
   * Box offsets are relative to the prop's left edge and ground line.
   */
  placeProp(L, { x, base, w, top, bottom }, crab, away) {
    const hits = (b, x0, y) => x0 < b.right && x0 + w > b.left && y + top < b.bottom && y + bottom > b.top;
    if (hits(crab, x, base)) base = Math.max(base, Math.ceil(crab.bottom - top) + 1);
    base = Math.min(base, L.h - bottom - 1);
    if (hits(crab, x, base)) x = away < 0 ? Math.floor(crab.left) - w - 1 : Math.ceil(crab.right) + 1;
    if (L.foot && base + bottom > L.foot.top && x < L.foot.right && x + w > L.foot.left) {
      x = away < 0 ? Math.floor(L.foot.left) - w - 2 : Math.ceil(L.foot.right) + 2;
    }
    return { x: Math.max(1, Math.min(L.w - w - 1, x)), base };
  }

  drawCastle(L, sec, t) {
    const ctx = this.ctx;
    const C = this.castleSprite();
    const spot = this.placeProp(L, {
      x: Math.round(L.w * 0.16) - Math.round(C.W / 2),
      base: Math.round(L.shore + Math.max(46, (L.h - L.shore) * 0.52)),
      w: C.W + 6, top: -C.G - 10, bottom: 6,
    }, L.friends[0], -1);
    const x0 = spot.x, base = spot.base;
    const y0 = base - C.G;
    // For the sign, which keeps clear of the castle (in CSS pixels).
    this.castleBox = { left: x0 * PX, right: (x0 + C.W + 6) * PX, top: (y0 - 8) * PX, bottom: (base + 6) * PX };
    // Its shadow lies on the sand: along the foot of the castle, and stretching out to the
    // left, away from the sun.
    ctx.fillStyle = "rgba(110, 72, 28, .26)";
    for (let j = -2; j <= 2; j++) {
      const left = x0 - 16 + Math.abs(j) * 4, right = x0 + C.W - 4 - Math.max(0, j) * 2;
      ctx.fillRect(left, base + j, right - left, 1);
    }
    ctx.drawImage(C.canvas, x0, y0);
    const motion = !this.reduced;
    const frame = motion ? Math.floor(sec * 8) : 0;

    // Fire in the forge: a red bed, orange flames, flickering yellow tips.
    const d = C.door;
    for (let i = 0; i < d.w; i++) {
      const hgt = 2 + Math.round(hash(i, frame, 3) * (d.h - 3)) - (i === 0 || i === d.w - 1 ? 2 : 0);
      for (let j = 0; j < hgt; j++) {
        const y = y0 + d.y + d.h - 1 - j;
        const col = j < 2 ? "#c0391b" : j < hgt - 1 ? "#ff8a2a" : "#ffd54a";
        ctx.fillStyle = col;
        ctx.fillRect(x0 + d.x + i, y, 1, 1);
      }
    }
    // Its glow on the sand in front.
    const glow = 0.16 + 0.08 * Math.sin(sec * 9) * (motion ? 1 : 0);
    ctx.fillStyle = `rgba(255, 150, 50, ${glow})`;
    for (let j = 0; j < 5; j++) {
      const half = 6 - j;
      ctx.fillRect(x0 + d.x + Math.floor(d.w / 2) - half, base + j, half * 2 + 1, 1);
    }

    // The flag on the left tower, waving.
    const fx = x0 + C.flag.x, fy = y0 + C.flag.y;
    ctx.fillStyle = "#4a2c18"; ctx.fillRect(fx, fy - 8, 1, 8);
    ctx.fillStyle = "#f2601c";
    const wave = frame % 2;
    ctx.fillRect(fx + 1, fy - 8, 5, 1); ctx.fillRect(fx + 1, fy - 7 + wave, 6, 1); ctx.fillRect(fx + 1, fy - 6, 4 + wave, 1);
    ctx.fillStyle = "#ffd54a"; ctx.fillRect(fx + 3, fy - 7 + wave, 1, 1);

    // The anvil on a stump, with a hammer that taps now and then.
    const ax = x0 + C.W - 4, ay = base;
    ctx.fillStyle = "#6e4423"; ctx.fillRect(ax - 3, ay - 4, 7, 4);
    ctx.fillStyle = "#8a5a2b"; ctx.fillRect(ax - 3, ay - 4, 7, 1);
    ctx.fillStyle = "#a5703a"; ctx.fillRect(ax + 2, ay - 3, 1, 3);
    ctx.fillStyle = "#3d3a37"; ctx.fillRect(ax - 4, ay - 8, 9, 2); ctx.fillRect(ax - 1, ay - 6, 3, 2); ctx.fillRect(ax - 3, ay - 5, 7, 1);
    ctx.fillStyle = "#3d3a37"; ctx.fillRect(ax + 5, ay - 8, 2, 1);
    ctx.fillStyle = "#8d8984"; ctx.fillRect(ax - 4, ay - 8, 9, 1);
    const tap = motion ? (sec % 3.2) : 9;
    if (tap < 0.35) {
      // Lying on the anvil, just struck: a burst of sparks.
      ctx.fillStyle = "#8a5a2b"; ctx.fillRect(ax + 1, ay - 9, 7, 1);
      ctx.fillStyle = "#5f5a55"; ctx.fillRect(ax - 2, ay - 10, 3, 2);
      ctx.fillStyle = "#8d8984"; ctx.fillRect(ax - 2, ay - 10, 3, 1);
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI * (0.15 + 0.7 * hash(i, Math.floor(sec / 3.2)));
        const r = 1 + tap * 26;
        ctx.fillStyle = i % 2 ? "#ffd54a" : "#fff3a0";
        ctx.fillRect(Math.round(ax + Math.cos(a) * r), Math.round(ay - 10 + Math.sin(a) * r), 1, 1);
      }
    } else {
      // Leaning against the stump.
      ctx.fillStyle = "#8a5a2b";
      for (let i = 0; i < 6; i++) ctx.fillRect(ax + 5 + Math.floor(i / 2), ay - 1 - i, 1, 1);
      ctx.fillStyle = "#5f5a55"; ctx.fillRect(ax + 7, ay - 8, 3, 2);
      ctx.fillStyle = "#8d8984"; ctx.fillRect(ax + 7, ay - 8, 3, 1);
    }

    // Sparks drifting up out of the forge door.
    if (motion && Math.random() < 0.25) {
      this.smoke.push({ spark: true, x: x0 + d.x + d.w / 2 + (Math.random() - 0.5) * 4, y: y0 + d.y + 1, born: t, drift: (Math.random() - 0.5) * 2 });
    }
    // Smoke from the chimney: dark at first, lighter and bigger as it rises.
    if (motion && t - this.lastSmoke > 380) {
      this.lastSmoke = t;
      this.smoke.push({ x: x0 + C.chimney.x, y: y0 + C.chimney.y - 1, born: t, drift: 0.6 + Math.random() * 0.8 });
    }
    this.smoke = this.smoke.filter(s => {
      const age = (t - s.born) / 1000;
      if (s.spark) {
        if (age > 1.1) return false;
        ctx.fillStyle = age < 0.5 ? "#ffd54a" : "rgba(255, 140, 40, .7)";
        ctx.fillRect(Math.round(s.x + s.drift * age * 3 + Math.sin(age * 9) * 0.6), Math.round(s.y - age * 9), 1, 1);
        return true;
      }
      if (age > 3.4) return false;
      const r = Math.round(1 + age * 1.1);
      const x = Math.round(s.x + age * s.drift * 4 + Math.sin(age * 3));
      const y = Math.round(s.y - age * 7);
      const g = Math.round(110 + Math.min(1, age / 2) * 115);
      ctx.fillStyle = `rgba(${g}, ${g - 4}, ${g - 8}, ${0.8 * (1 - age / 3.4)})`;
      for (let j = -r; j <= r; j++) {
        const half = Math.floor(Math.sqrt(r * r - j * j));
        ctx.fillRect(x - half, y + j, half * 2 + 1, 1);
      }
      return true;
    });
  }

  // ------------------------------------------------------------------ the beach spot

  /** The umbrella's static parts: towel with flip-flops, bucket and spade, pole, sand mound. */
  umbrellaSprite() {
    if (this._umbrella) return this._umbrella;
    const W = 60, H = 46, G = 40, P = 38; // G: ground line, P: pole x
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const px = (x, y, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); };
    // Shadow of the canopy, an oval falling to the left (away from the sun).
    ctx.fillStyle = "rgba(120, 80, 30, .24)";
    for (let j = -3; j <= 3; j++) {
      const half = Math.round(16 * Math.sqrt(1 - (j / 3.5) ** 2));
      ctx.fillRect(P - 9 - half, G + j, half * 2, 1);
    }
    // Towel, at a slight angle, with fringed ends and a folded corner.
    for (let j = 0; j < 7; j++) {
      const skew = Math.floor(j / 2);
      for (let i = 0; i < 24; i++) {
        const x = 8 + i + skew, y = G - 4 + j;
        const stripe = Math.floor(i / 4) % 2;
        let col = stripe ? "#fdfaf2" : "#2fa7a0";
        if (j === 6) col = stripe ? "#d9d3c4" : "#1f7f7a";
        if (i >= 20 && j <= i - 20) col = stripe ? "#c9c2b0" : "#1d6f6b"; // folded corner (underside)
        px(x, y, col);
      }
      if (j % 2 === 0) { px(7 + skew, G - 4 + j, "#e9e2cf"); px(32 + skew, G - 4 + j, "#e9e2cf"); }
    }
    // Flip-flops on the towel.
    for (const [fx, col] of [[13, "#ff7a8a"], [17, "#ff7a8a"]]) {
      for (let j = 0; j < 4; j++) { px(fx, G - 3 + j, col); px(fx + 1, G - 3 + j, col); }
      px(fx, G - 2, "#ffffff"); px(fx + 1, G - 3, "#ffffff");
    }
    // Bucket and spade, left of the towel.
    const bx = 1, by = G - 5;
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
      if (j > 3 && (i === 0 || i === 5)) continue;
      px(bx + i, by + j, j === 0 ? "#ffb4a6" : i === 0 ? "#b83a2a" : i === 5 ? "#ff7a66" : "#e5533d");
    }
    for (let i = 1; i < 5; i++) px(bx + i, by - 1, "#f0cf8d");
    px(bx, by - 2, "#5a5a5a"); px(bx + 1, by - 3, "#5a5a5a"); px(bx + 2, by - 3, "#5a5a5a"); px(bx + 3, by - 3, "#5a5a5a"); px(bx + 4, by - 3, "#5a5a5a"); px(bx + 5, by - 2, "#5a5a5a");
    for (let i = 0; i < 6; i++) px(bx + 6 + Math.floor(i / 2), by - 4 + i, "#ffd54a");
    for (let j = 0; j < 3; j++) { px(bx + 9, by + 2 + j, "#3a8fd6"); px(bx + 10, by + 2 + j, "#6cb6ec"); }
    // Pole: thick, lit on the right, with a metal joint halfway, pushed into a mound of sand.
    for (let y = 8; y < G; y++) {
      px(P, y, "#7a5230"); px(P + 1, y, "#a8794a");
    }
    for (let x = P - 1; x <= P + 2; x++) { px(x, 23, "#c9c2b6"); px(x, 24, "#8d8984"); }
    for (let j = 0; j < 2; j++) for (let i = -3 + j; i <= 4 - j; i++) px(P + i, G - j, j ? "#f0cf8d" : "#e3bb76");
    this._umbrella = { canvas: c, W, H, G, P };
    return this._umbrella;
  }

  drawUmbrella(L, sec) {
    const ctx = this.ctx;
    const U = this.umbrellaSprite();
    const spot = this.placeProp(L, {
      x: Math.round(L.w * 0.8) - U.P,
      base: Math.round(L.shore + Math.max(46, (L.h - L.shore) * 0.55)),
      w: U.W, top: -U.G, bottom: 5,
    }, L.friends[1], 1);
    const x0 = spot.x, base = spot.base;
    const y0 = base - U.G;
    this.umbrellaBox = { left: x0 * PX, right: (x0 + U.W) * PX, top: y0 * PX, bottom: (base + 5) * PX };
    ctx.drawImage(U.canvas, x0, y0);
    // The canopy: a dome whose panels curve in to the top, lit from the right.
    const cx = x0 + U.P + 0.5, top = y0 + 3, rx = 17, rows = 10;
    const panels = 6;
    for (let j = 0; j < rows; j++) {
      const half = rx * Math.sqrt(1 - ((rows - 1 - j) / rows) ** 2);
      for (let x = Math.floor(cx - half); x <= Math.ceil(cx - 1 + half); x++) {
        const u = (x + 0.5 - cx) / half; // -1 .. 1 across this row
        if (Math.abs(u) > 1) continue;
        const k = Math.min(panels - 1, Math.floor((u + 1) / 2 * panels));
        const orange = k % 2 === 0;
        const lit = u > 0.35, dark = u < -0.55;
        const col = orange ? (lit ? "#f47a3c" : dark ? "#c84e22" : "#e8602c") : (lit ? "#fffaf0" : dark ? "#e3d6bd" : "#fff3e0");
        ctx.fillStyle = col;
        ctx.fillRect(x, top + j, 1, 1);
      }
    }
    // The underside, just visible below the rim.
    ctx.fillStyle = "#a83e1a";
    ctx.fillRect(Math.round(cx - rx + 3), top + rows, rx * 2 - 6, 1);
    // A scalloped hem that flutters a little in the breeze.
    const flutter = this.reduced ? 0 : Math.floor(sec * 3) % 2;
    for (let k = 0; k < panels; k++) {
      const sx = Math.round(cx - rx + k * (rx * 2 / panels));
      const w = Math.round(rx * 2 / panels);
      ctx.fillStyle = k % 2 === 0 ? "#e8602c" : "#fff3e0";
      ctx.fillRect(sx + 1, top + rows, w - 1, 1);
      ctx.fillRect(sx + 2, top + rows + 1 + ((k + flutter) % 2), w - 3, 1);
    }
    // Ball on top.
    ctx.fillStyle = "#ffd54a"; ctx.fillRect(Math.round(cx) - 1, top - 2, 2, 2);
    ctx.fillStyle = "#fff3a0"; ctx.fillRect(Math.round(cx), top - 2, 1, 1);
  }

  drawBottle(L, t) {
    if (this.reduced) return;
    // A bottle drifts in from the sea, lies on the beach showing its note, then floats away.
    if (!this.bottle && t > this.nextBottle) {
      const fx = Math.random() < 0.5 ? 0.07 + Math.random() * 0.13 : 0.8 + Math.random() * 0.13;
      this.bottle = { fx, born: t, text: BOTTLE_NOTES[Math.floor(Math.random() * BOTTLE_NOTES.length)] };
    }
    const b = this.bottle;
    if (!b) return;
    const age = (t - b.born) / 1000;
    const IN = 7, STAY = 5, OUT = 5;
    if (age > IN + STAY + OUT) {
      this.bottle = null;
      this.nextBottle = t + 6000 + Math.random() * 6000;
      this.note.classList.remove("show");
      return;
    }
    const ease = f => f * f * (3 - 2 * f);
    const far = L.horizon + 6, beach = L.shore + 1;
    let y, alpha = 1;
    if (age < IN) y = far + (beach - far) * ease(age / IN);
    else if (age < IN + STAY) y = beach;
    else { const f = (age - IN - STAY) / OUT; y = beach - (beach - far) * ease(f) * 0.6; alpha = 1 - f; }
    const x = Math.round(b.fx * L.w);
    const bob = age < IN + STAY && age > IN ? 0 : Math.round(Math.sin(age * 3));
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    const scaleDown = y < L.horizon + (L.shore - L.horizon) / 2 ? 1 : 0;
    BOTTLE.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch === "." || (scaleDown && i % 2)) return;
      ctx.fillStyle = BOTTLE_PAL[ch];
      ctx.fillRect(x - 4 + (scaleDown ? Math.floor(i / 2) + 2 : i), Math.round(y) - 3 + j + bob, 1, 1);
    }));
    ctx.globalAlpha = 1;
    const showNote = age > IN - 0.3 && age < IN + STAY;
    if (showNote && !this.note.classList.contains("show")) {
      this.note.textContent = b.text;
      this.note.style.left = `${x * PX}px`;
      this.note.style.top = `${(Math.round(y) - 5) * PX}px`;
      this.note.classList.add("show");
    } else if (!showNote && this.note.classList.contains("show")) {
      this.note.classList.remove("show");
    }
  }

  drawFriends(L, t) {
    const ctx = this.ctx;
    const gap = L.gap;
    const exitAge = this.exitAt ? (t - this.exitAt) / 1000 : 0;
    const frame = this.ferris ? this.ferris.frame : Math.floor(t / 125);
    for (const fr of FRIENDS) {
      let step = this.reduced ? { dx: 0, hop: 0, mood: "happy", flip: false } : danceStep(frame - fr.lag);
      let look = null;
      if (this.look) {
        look = { dx: -fr.side, dy: 1 };
        step = { dx: 0, hop: 0, mood: "happy", flip: false };
      }
      let x = Math.round(L.ferrisX + fr.side * gap - 20 + step.dx * 0.5);
      if (exitAge) {
        // Wave (hop) for a moment, then scuttle off to the side.
        step = { dx: 0, hop: exitAge < 0.35 ? -[0, 2, 3, 2][Math.floor(exitAge * 12) % 4] : (Math.floor(exitAge * 12) % 2 ? -1 : 0), mood: "excited", flip: fr.side < 0 };
        if (exitAge > 0.35) x += Math.round(fr.side * (exitAge - 0.35) * 260);
      }
      const y = Math.round(L.feet - 28 + step.hop);
      // Shadow.
      ctx.fillStyle = "rgba(60, 30, 10, .22)";
      const air = Math.min(3, -Math.min(0, step.hop));
      ctx.fillRect(x + 9 + air, Math.round(L.feet - 1), 22 - air * 2, 2);
      const g = ferrisGrid({ mood: step.mood, frame, look, mouthOpen: frame % 2 === 0 });
      const grid = step.flip ? g.map(row => row.slice().reverse()) : g;
      drawGrid(ctx, grid, x, y, 1, fr.palette);
    }
  }

  drawPalm(L, baseX, baseY, dir, sec) {
    const ctx = this.ctx;
    const height = Math.round(Math.min(L.h * 0.6, L.h - L.horizon * 0.55) * (0.75 + 0.25 * L.s));
    let tx = baseX, ty = baseY;
    // A curved trunk, thick at the bottom, with rings.
    for (let i = 0; i < height; i++) {
      const f = i / height;
      const x = Math.round(baseX + dir * f * f * Math.min(height * 0.3, L.w * 0.08));
      const y = baseY - i;
      const wdt = Math.round(7 - f * 3);
      const left = x - Math.floor(wdt / 2);
      ctx.fillStyle = i % 5 === 0 ? "#6e4423" : "#8a5a2b";
      ctx.fillRect(left, y, wdt, 1);
      ctx.fillStyle = i % 5 === 0 ? "#8a5a2b" : "#a5703a";
      ctx.fillRect(dir > 0 ? left + 1 : left + wdt - 3, y, 2, 1);
      ctx.fillStyle = "#5a3418";
      ctx.fillRect(dir > 0 ? left + wdt - 1 : left, y, 1, 1);
      tx = x; ty = y;
    }
    // Fronds, swaying in the breeze.
    const fronds = [-2.9, -2.45, -1.95, -1.45, -0.95, -0.45, 0.05, 0.4];
    fronds.forEach((a0, k) => {
      const a = (dir > 0 ? a0 : -Math.PI - a0) + Math.sin(sec * 1.1 + k * 0.7) * 0.06;
      const len = Math.round((26 + ((k * 5) % 3) * 5) * L.s);
      for (let s = 0; s < len; s++) {
        const f = s / len;
        const x = Math.round(tx + Math.cos(a) * s);
        const y = Math.round(ty + Math.sin(a) * s + f * f * len * 0.5);
        // Leaflets on both sides of the stem, longest in the middle of the frond.
        const leaf = Math.round(Math.sin(f * Math.PI) * 4);
        ctx.fillStyle = "#2e7a2a";
        ctx.fillRect(x, y + 1, 1, leaf + 1);
        ctx.fillStyle = f > 0.8 ? "#3f9b3a" : "#4fae42";
        ctx.fillRect(x, y - Math.ceil(leaf / 2), 1, Math.ceil(leaf / 2) + 1);
        ctx.fillStyle = "#7bd05a";
        if (s % 2 === 0) ctx.fillRect(x, y, 1, 1);
      }
    });
    // Coconuts in the crown.
    ctx.fillStyle = "#5a3a1a";
    for (const [cx, cy] of [[-3, 1], [0, 2], [2, 1]]) ctx.fillRect(tx + cx, ty + cy, 3, 3);
    ctx.fillStyle = "#7a5230";
    for (const [cx, cy] of [[-3, 1], [0, 2], [2, 1]]) ctx.fillRect(tx + cx, ty + cy, 1, 1);
  }

  drawSignSpot(L) {
    // The sign is HTML (for crisp text). Try a few spots on the sand and use the first one
    // that covers nothing: not the castle, the umbrella, the crabs, Start or the tagline.
    const blockers = [...document.querySelectorAll("#btn-start, .title-foot")].map(el => el.getBoundingClientRect());
    for (const box of [this.castleBox, this.umbrellaBox]) if (box) blockers.push(box);
    for (const f of L.friends) blockers.push({ left: f.left * PX, right: f.right * PX, top: f.top * PX, bottom: f.bottom * PX });
    const low = L.h - 4, nearWater = L.shore + 24;
    const candidates = [[L.w * 0.25, low], [L.w * 0.12, nearWater], [L.w * 0.6, low], [L.w * 0.4, low]];
    if (this.castleBox) candidates.push([this.castleBox.right / PX + 22, low]);
    let placed = false;
    for (const [fx, fy] of candidates) {
      this.sign.style.left = `${Math.round(fx) * PX}px`;
      this.sign.style.top = `${Math.round(fy) * PX}px`;
      const r = this.sign.getBoundingClientRect();
      const clear = r.left > 0 && r.right < innerWidth && r.bottom <= innerHeight && blockers.every(o =>
        !(r.left < o.right + 8 && r.right > o.left - 8 && r.top < o.bottom + 8 && r.bottom > o.top - 8));
      if (clear) { placed = true; break; }
    }
    this.sign.style.visibility = placed && L.w >= 220 ? "" : "hidden";
  }

  drawNotes(L, t) {
    // Music notes rising from Ferris while he dances.
    const f = this.ferrisCanvas.getBoundingClientRect();
    if (!this.look && !this.exitAt && t - this.lastNote > 550 && f.width) {
      this.lastNote = t;
      const side = this.notes.length % 2 ? 1 : -1;
      this.notes.push({
        x: (f.left + f.width / 2) / PX + side * (6 + Math.random() * 10),
        y: (f.top + f.height * 0.25) / PX,
        born: t,
        drift: side * (0.4 + Math.random() * 0.6),
        color: ["#ffd54a", "#ff9fd0", "#ffffff", "#a6ec7c"][this.notes.length % 4],
      });
    }
    const ctx = this.ctx;
    this.notes = this.notes.filter(n => t - n.born < 2600);
    for (const n of this.notes) {
      const age = (t - n.born) / 1000;
      const x = Math.round(n.x + n.drift * age * 8 + Math.sin(age * 5) * 2);
      const y = Math.round(n.y - age * 14);
      ctx.fillStyle = age > 2 ? "rgba(255,255,255,.5)" : n.color;
      NOTE.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === "#") ctx.fillRect(x + i, y + j, 1, 1); }));
    }
  }

  drawSparks(t) {
    const ctx = this.ctx;
    this.sparks = this.sparks.filter(s => {
      const age = (t - s.born) / 1000;
      if (age > 0.9) return false;
      const x = s.x + s.vx * age, y = s.y + s.vy * age + 40 * age * age;
      ctx.globalAlpha = 1 - age / 0.9;
      ctx.fillStyle = s.color;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      ctx.globalAlpha = 1;
      return true;
    });
  }
}
