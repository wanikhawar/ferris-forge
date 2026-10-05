// The world map: pixel-art islands on an animated sea.
import { drawDecor, Ferris } from "./sprites.js";

const W = 480, H = 440;

// Where each world's island sits: 5 rows of 5, winding back and forth like a trail.
const SPOTS = Array.from({ length: 25 }, (_, i) => {
  const row = Math.floor(i / 5), col = i % 5;
  const x = 62 + (row % 2 ? 4 - col : col) * 89;
  const y = 52 + row * 84 + (col % 2 ? 9 : 0);
  return [x, y];
});

// Island looks, in world order (see levels/worldNN_*.toml).
const THEMES = [
  /* 0 Tutorial Beach */      { grass: null, decor: [["palm", -16, -14], ["palm", 10, -10], ["flag", -2, -12]] },
  /* 1 Variable Village */    { grass: "#6cbc48", decor: [["house", -14, -14], ["house", 4, -12], ["flower", -22, -2], ["flower", 14, -2], ["tree", 18, -16]] },
  /* 2 Flow Forest */         { grass: "#3f8f2f", decor: [["pine", -18, -16], ["tree", -6, -18], ["pine", 6, -14], ["tree", 16, -10], ["pine", -10, -6]] },
  /* 3 Ownership Caves */     { grass: "#8b8b7a", decor: [["cave", -6, -14], ["rock", -20, -8], ["rock", 12, -6], ["rock", 16, -16]] },
  /* 4 Borrow Bridge */       { grass: "#6cbc48", decor: [["tree", -18, -12], ["flower", 10, -8], ["house", 0, -16]] },
  /* 5 Struct Smithy */       { grass: "#7a9a58", decor: [["anvil", -4, -12], ["house", -18, -14], ["rock", 12, -8]] },
  /* 6 Enum Isles */          { grass: "#62b04a", decor: [["palm", -12, -14], ["flower", 6, -8], ["palm", 12, -12]] },
  /* 7 Collection Citadel */  { grass: "#9a9a8a", decor: [["house", -12, -16], ["house", 2, -16], ["house", -5, -8]] },
  /* 8 Error Marsh */         { grass: "#6f7a3a", decor: [["flower", -12, -8], ["tree", 4, -14], ["rock", -2, -4]] },
  /* 9 Guessing Game Grotto */{ grass: "#7b6b55", decor: [["cave", -6, -12], ["flower", 10, -8], ["rock", -18, -6]] },
  /* 10 Pattern Plains */     { grass: "#8fb35a", decor: [["flower", -14, -6], ["flower", 0, -10], ["rock", 12, -8], ["flower", 8, -2]] },
  /* 11 Module Mines */       { grass: "#6b5a45", decor: [["cave", -6, -12], ["rock", 10, -8], ["rock", -18, -6]] },
  /* 12 Testing Grounds */    { grass: "#5aa63a", decor: [["flag", -10, -16], ["flag", 6, -14], ["rock", -2, -4]] },
  /* 13 Trait Tower */        { grass: "#5aa63a", decor: [["house", -4, -18], ["tree", -18, -8], ["tree", 12, -8]] },
  /* 14 Lifetime Labyrinth */ { grass: "#2f7a2a", decor: [["pine", -16, -12], ["pine", -4, -16], ["pine", 8, -12], ["pine", 0, -4]] },
  /* 15 Iterator Rapids */    { grass: "#6a8fa8", decor: [["rock", -12, -8], ["tree", 6, -14], ["rock", 12, -2]] },
  /* 16 Minigrep Harbor */    { grass: "#7a9a58", decor: [["house", -12, -14], ["palm", 6, -14], ["flag", -2, -20]] },
  /* 17 Pointer Peaks */      { grass: "#dfe6ea", decor: [["rock", -14, -12], ["rock", 2, -16], ["rock", 12, -8]] },
  /* 18 Object Observatory */ { grass: "#7a6fa0", decor: [["house", -6, -16], ["tree", -18, -8], ["flower", 12, -6]] },
  /* 19 Thread Volcano */     { grass: "#4a3b33", decor: [["volcano", -4, -16], ["rock", -18, -6], ["rock", 12, -4]] },
  /* 20 Async Archipelago */  { grass: "#62b04a", decor: [["palm", -14, -12], ["palm", 10, -14], ["flower", -2, -6]] },
  /* 21 Cargo Docks */        { grass: "#8a7a5a", decor: [["house", -10, -16], ["flag", 8, -18], ["rock", 12, -4]] },
  /* 22 Advanced Abyss */     { grass: "#2e2a3a", decor: [["rock", -14, -10], ["cave", -2, -14], ["rock", 12, -6]] },
  /* 23 Web Server Citadel */ { grass: "#9a9a8a", decor: [["house", -16, -14], ["house", -4, -18], ["house", 8, -14], ["flag", 2, -24]] },
  /* 24 Ferris' Library */    { grass: "#7a5a3a", decor: [["house", -10, -16], ["tree", 6, -14], ["tree", -20, -6]] },
];

const levelCount = w => w.levels.length;

function rng(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function drawIsland(ctx, cx, cy, idx, locked) {
  const theme = THEMES[idx] || THEMES[idx % THEMES.length];
  const rx = idx === 0 ? 30 : 34, ry = 21;
  const ph = idx * 1.7;
  const shape = (x, y) => {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    const a = Math.atan2(dy, dx);
    const r = 1 + 0.1 * Math.sin(3 * a + ph) + 0.07 * Math.sin(5 * a + ph * 2);
    return { d: Math.hypot(dx, dy), r, dy };
  };
  for (let y = cy - ry * 1.5; y < cy + ry * 1.5; y++) {
    for (let x = cx - rx * 1.5; x < cx + rx * 1.5; x++) {
      const { d, r, dy } = shape(x, y);
      let c = null;
      if (d < r) {
        c = "#f1d48a"; // sand
        if (d > r * 0.9 && dy > 0) c = "#d4ad5e";
        if (theme.grass && d < r * 0.76) c = theme.grass;
        if (theme.grass && d < r * 0.76 && d > r * 0.7 && dy > 0) c = shade(theme.grass, -25);
      } else if (d < r * 1.16) {
        c = "rgba(170, 225, 250, 0.55)"; // shallow water ring
      }
      if (!c) continue;
      if (locked === "soon" && d < r) c = desaturate(c);
      ctx.fillStyle = c;
      ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
  }
  // grass texture specks
  if (theme.grass) {
    const r = rng(idx + 1);
    for (let i = 0; i < 40; i++) {
      const x = cx + (r() - 0.5) * rx * 1.3, y = cy + (r() - 0.5) * ry * 1.2;
      const { d, r: rr } = shape(x, y);
      if (d < rr * 0.7) { ctx.fillStyle = locked === "soon" ? "#8a8a80" : shade(theme.grass, 18); ctx.fillRect(Math.floor(x), Math.floor(y), 1, 2); }
    }
  }
  for (const [name, dx, dy] of theme.decor) drawDecor(ctx, name, cx + dx, cy + dy, 1);
  if (locked === "soon") {
    // Still being built: misty, with a striped construction barrier.
    ctx.fillStyle = "rgba(235, 238, 242, 0.32)";
    const r = rng(idx + 7);
    for (let i = 0; i < 5; i++) {
      const x = cx + (r() - 0.5) * rx * 1.6, y = cy + (r() - 0.5) * ry * 1.2;
      pixelCircle(ctx, x, y, 6 + r() * 5);
    }
    drawDecor(ctx, "barrier", cx - 4, cy - 6, 1);
  } else if (locked) {
    // Playable, but not unlocked yet: just a padlock, no mist.
    drawDecor(ctx, "lock", cx - 4, cy - 6, 1);
  }
}

function pixelCircle(ctx, cx, cy, rad) {
  for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
    if (x * x + y * y <= rad * rad) ctx.fillRect(Math.floor(cx + x), Math.floor(cy + y), 1, 1);
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = v => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

function desaturate(color) {
  if (color.startsWith("rgba")) return color;
  let r, g, b;
  if (color.startsWith("#")) { const n = parseInt(color.slice(1), 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
  else [r, g, b] = color.match(/\d+/g).map(Number);
  const v = r * 0.3 + g * 0.59 + b * 0.11;
  const mix = (c) => Math.round((c * 0.45 + v * 0.55) * 0.85 + 20);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export class WorldMap {
  constructor(canvas, overlay, { onSelect }) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.onSelect = onSelect;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext("2d");
    this.worlds = [];
    this.current = 0;
    this.waves = Array.from({ length: 70 }, (_, i) => {
      const r = rng(i + 100);
      return { x: r() * W, y: r() * H, len: 2 + Math.floor(r() * 3), speed: 2 + r() * 4, phase: r() * 10 };
    });
    this.clouds = Array.from({ length: 4 }, (_, i) => ({ x: i * 140 + 20, y: 20 + i * 61 % 220, speed: 3 + i }));
    this.islandLayer = document.createElement("canvas");
    this.islandLayer.width = W;
    this.islandLayer.height = H;
    this.ferrisCanvas = document.createElement("canvas");
    this.ferrisCanvas.className = "map-ferris sprite";
    this.ferris = new Ferris(this.ferrisCanvas, { scale: 2, shadow: true });
    this.seaSpecks = document.createElement("canvas");
    this.seaSpecks.width = W;
    this.seaSpecks.height = H;
    const sc = this.seaSpecks.getContext("2d");
    const r = rng(42);
    for (let i = 0; i < 260; i++) {
      sc.fillStyle = r() < 0.5 ? "#3986c9" : "#4797d8";
      sc.fillRect(Math.floor(r() * W), Math.floor(r() * H), 2 + Math.floor(r() * 3), 1);
    }
    this.running = false;
    this._frame = this._frame.bind(this);
    window.addEventListener("resize", () => this.layout());
  }

  setWorlds(worlds, currentWorldId) {
    this.worlds = worlds;
    this.current = currentWorldId;
    this.renderIslands();
    this.buildOverlay();
    this.layout();
  }

  renderIslands() {
    const ctx = this.islandLayer.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    // Trail of wooden planks between islands.
    for (let i = 0; i + 1 < SPOTS.length; i++) {
      const [x1, y1] = SPOTS[i], [x2, y2] = SPOTS[i + 1];
      const steps = Math.floor(Math.hypot(x2 - x1, y2 - y1) / 6);
      const open = this.worlds[i + 1]?.unlocked;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
        ctx.fillStyle = open ? "#8a5a2b" : "rgba(120, 100, 80, .55)";
        ctx.fillRect(Math.round(x) - 2, Math.round(y) - 1, 4, 3);
        ctx.fillStyle = open ? "#b07a3e" : "rgba(160, 140, 120, .5)";
        ctx.fillRect(Math.round(x) - 2, Math.round(y) - 1, 4, 1);
      }
    }
    SPOTS.forEach(([x, y], i) => {
      const w = this.worlds[i];
      drawIsland(ctx, x, y, i, !w || !w.available ? "soon" : w.unlocked ? false : "locked");
    });
  }

  buildOverlay() {
    this.overlay.innerHTML = "";
    SPOTS.forEach(([x, y], i) => {
      const w = this.worlds[i];
      if (!w) return;
      const btn = document.createElement("button");
      btn.className = "island-btn";
      btn.style.left = `${(x / W) * 100}%`;
      btn.style.top = `${(y / H) * 100}%`;
      btn.style.width = `${(70 / W) * 100}%`;
      btn.style.height = `${(46 / H) * 100}%`;
      btn.title = !w.available ? `${w.name} — coming soon: ${w.blurb}` : w.unlocked ? `${w.name} — ${w.blurb} (${w.done}/${levelCount(w)} cleared)` : `${w.name} — locked: clear the previous island first (you can read its lessons)`;
      btn.setAttribute("aria-label", btn.title);
      btn.addEventListener("click", () => this.onSelect(w));
      this.overlay.appendChild(btn);

      const label = document.createElement("div");
      label.className = "island-label" + (w.unlocked ? "" : w.available ? " locked" : " soon");
      label.style.left = `${(x / W) * 100}%`;
      label.style.top = `${((y + 21) / H) * 100}%`;
      const total = w.levels.length;
      // A small chip: progress for playable islands, "locked" or "soon" for the rest.
      let chip;
      if (!w.available) chip = `<span class="il-chip soon">soon</span>`;
      else if (!w.unlocked) chip = `<span class="il-chip locked">locked</span>`;
      else if (w.done === total) chip = `<span class="il-chip done">★ ${w.done}/${total}</span>`;
      else chip = `<span class="il-chip">${w.done}/${total}</span>`;
      const tag = w.tag === "project" ? " 🛠" : w.tag === "bonus" ? " 📚" : "";
      label.innerHTML = `${w.id}. ${w.name}${tag}${chip}`;
      this.overlay.appendChild(label);
    });
    this.overlay.appendChild(this.ferrisCanvas);
    this.placeFerris();
  }

  placeFerris() {
    const idx = Math.max(0, Math.min(SPOTS.length - 1, this.current));
    const [x, y] = SPOTS[idx];
    this.ferrisCanvas.style.left = `${(x / W) * 100}%`;
    this.ferrisCanvas.style.top = `${((y + 4) / H) * 100}%`;
  }

  /** Scroll so Ferris' island is in view. */
  scrollToCurrent() {
    const host = this.canvas.parentElement.parentElement;
    const [, y] = SPOTS[Math.max(0, Math.min(SPOTS.length - 1, this.current))];
    const top = (y / H) * this.canvas.parentElement.offsetHeight - host.clientHeight / 2;
    host.scrollTop = Math.max(0, top);
  }

  layout() {
    const wrap = this.canvas.parentElement;
    const host = wrap.parentElement;
    const availW = host.clientWidth - 24, availH = host.clientHeight - 24;
    // Fit the whole map when possible; otherwise keep islands readable and scroll down.
    let s = Math.max(Math.min(availW / W, availH / H), Math.min(availW / W, 1.8));
    if (s >= 2) s = Math.floor(s * 2) / 2;
    wrap.style.width = `${W * s}px`;
    wrap.style.height = `${H * s}px`;
    this.ferrisCanvas.style.width = `${26 * s}px`;
    this.ferrisCanvas.style.height = `${(26 * 32 / 40) * s}px`;
    this.overlay.style.fontSize = `${Math.max(11, s * 6)}px`;
    for (const l of this.overlay.querySelectorAll(".island-label")) l.style.fontSize = `${Math.max(11, Math.min(17, s * 5.2))}px`;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.layout();
    requestAnimationFrame(this._frame);
  }

  stop() { this.running = false; }

  _frame(t) {
    if (!this.running) return;
    requestAnimationFrame(this._frame);
    if (t - (this._last || 0) < 120) return;
    this._last = t;
    const ctx = this.ctx;
    const sec = t / 1000;
    ctx.fillStyle = "#3f8fd2";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(this.seaSpecks, 0, 0);
    // waves
    for (const wv of this.waves) {
      const x = (wv.x + sec * wv.speed) % (W + 10) - 5;
      const on = Math.sin(sec * 1.5 + wv.phase) > -0.2;
      if (!on) continue;
      ctx.fillStyle = "#7cc4ee";
      ctx.fillRect(Math.floor(x), Math.floor(wv.y), wv.len, 1);
      ctx.fillStyle = "#5aa9e0";
      ctx.fillRect(Math.floor(x) + 1, Math.floor(wv.y) + 1, wv.len, 1);
    }
    ctx.drawImage(this.islandLayer, 0, 0);
    // drifting clouds (shadows + clouds)
    for (const c of this.clouds) {
      const x = ((c.x + sec * c.speed) % (W + 80)) - 60;
      ctx.fillStyle = "rgba(20, 50, 90, .07)";
      cloud(ctx, x + 10, c.y + 26);
      ctx.fillStyle = "rgba(255, 255, 255, .85)";
      cloud(ctx, x, c.y);
    }
  }
}

function cloud(ctx, x, y) {
  pixelCircle(ctx, x, y, 7);
  pixelCircle(ctx, x + 10, y - 3, 9);
  pixelCircle(ctx, x + 22, y, 7);
  ctx.fillRect(Math.floor(x), Math.floor(y), 24, 7);
}
