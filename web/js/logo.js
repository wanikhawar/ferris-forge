// The title sign: an old, sun-bleached wooden board with the name in rusty iron letters,
// each nailed on with a rusty nail. Drawn as pixel art on a canvas. Now and then a letter
// wobbles on its nail, flakes of rust fall off, and a rusty gear turns in the corner.

// The letters, on a grid where one cell is 2×2 sign pixels. Capitals are 9 cells tall,
// small letters 6 (starting at row 3), and g hangs 2 cells lower.
const GLYPHS = {
  F: ["######", "######", "##....", "##....", "#####.", "#####.", "##....", "##....", "##...."],
  e: ["", "", "", ".####.", "##..##", "######", "##....", "##..##", ".####."],
  r: ["", "", "", "##.##", "#####", "##...", "##...", "##...", "##..."],
  i: ["##", "##", "..", "##", "##", "##", "##", "##", "##"],
  s: ["", "", "", ".#####", "##....", ".####.", "....##", "....##", "#####."],
  "'": ["##", "##", "#."],
  o: ["", "", "", ".####.", "##..##", "##..##", "##..##", "##..##", ".####."],
  g: ["", "", "", ".#####", "##..##", "##..##", "##..##", ".#####", "....##", "##..##", ".####."],
};
const TITLE = "Ferris' Forge";
const CELL = 2; // sign pixels per glyph cell
const GAP = 1; // cells between letters
const SPACE = 3; // cells for a space

const MARGIN_X = 16, TOP = 5, TEXT_Y = 7, BOARD_H = 47, FALL = 28;

function hash(x, y, seed = 0) {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Patchy noise: a blend of coarse and fine, for rust that comes in blotches. */
function patchy(x, y, seed) {
  return hash(Math.floor(x / 3), Math.floor(y / 3), seed) * 0.6 + hash(x, y, seed + 1) * 0.4;
}

/** Build one rusty iron letter: its sprite, its shadow, and where its nail is. */
function buildLetter(ch, seed) {
  const rows = GLYPHS[ch];
  const cw = Math.max(...rows.map(r => r.length));
  const w = cw * CELL, h = rows.length * CELL;
  const filled = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return (rows[Math.floor(y / CELL)][Math.floor(x / CELL)] || ".") === "#";
  };
  // Corrosion: a few edge pixels have rusted away.
  const solid = (x, y) => {
    if (!filled(x, y)) return false;
    const edge = !filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y + 1);
    return !(edge && filled(x, y - 1) && hash(x, y, seed + 9) > 0.9);
  };
  const c = document.createElement("canvas");
  c.width = w + 2; c.height = h + 2;
  const ctx = c.getContext("2d");
  const shadow = document.createElement("canvas");
  shadow.width = w + 2; shadow.height = h + 2;
  const sctx = shadow.getContext("2d");
  sctx.fillStyle = "rgba(60, 30, 12, .38)";
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    const px = x + 1, py = y + 1;
    if (!solid(x, y)) {
      // A dark outline around the plate.
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
        ctx.fillStyle = "#3a1406";
        ctx.fillRect(px, py, 1, 1);
        sctx.fillRect(px, py, 1, 1);
      }
      continue;
    }
    sctx.fillRect(px, py, 1, 1);
    let color;
    if (!solid(x, y - 1)) color = "#eaa46c"; // light top rim, so the name reads well
    else if (!solid(x, y + 1) || !solid(x + 1, y)) color = "#6e2a0c";
    else if (hash(Math.floor(x / 4), Math.floor(y / 4), seed + 7) > 0.9 && hash(x, y, seed + 3) > 0.45) {
      color = hash(x, y, seed + 5) > 0.5 ? "#8a7a70" : "#9c8f84"; // a little bare iron showing through
    } else {
      const n = patchy(x, y, seed);
      color = n < 0.25 ? "#8e3510" : n < 0.55 ? "#b7410e" : n < 0.8 ? "#c8561c" : "#d9773a";
    }
    ctx.fillStyle = color;
    ctx.fillRect(px, py, 1, 1);
  }
  // The nail: in a solid spot near the top middle of the letter.
  let nail = null;
  if (ch !== "'") {
    const top = rows.findIndex(r => r.includes("#")) * CELL;
    const want = { x: w / 2 - 1, y: top + (ch === "i" ? 7 : 3) };
    let best = Infinity;
    for (let y = 1; y < h - 2; y++) for (let x = 1; x < w - 2; x++) {
      if (![[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [2, 0]].every(([dx, dy]) => filled(x + dx, y + dy))) continue;
      const d = (x - want.x) ** 2 + (y - want.y) ** 2;
      if (d < best) { best = d; nail = { x: x + 1, y: y + 1 }; }
    }
    if (nail) {
      const { x, y } = nail;
      ctx.fillStyle = "#7a3510";
      ctx.fillRect(x - 1, y, 1, 2); ctx.fillRect(x + 2, y, 1, 2); ctx.fillRect(x, y + 2, 2, 1);
      ctx.fillStyle = "#6d6862"; ctx.fillRect(x, y, 2, 2);
      ctx.fillStyle = "#b0aaa1"; ctx.fillRect(x, y, 1, 1);
    }
  }
  if (!nail) nail = { x: Math.round(c.width / 2), y: 2 };
  return { ch, sprite: c, shadow, w: c.width, h: c.height, nail, rows, solid };
}

export class LogoSign {
  constructor({ canvas, sub, reduced }) {
    this.canvas = canvas;
    this.sub = sub;
    this.reduced = reduced;
    this.ctx = canvas.getContext("2d");
    this.letters = [];
    this.flakes = [];
    this.wobble = null;
    this.nextWobble = 3500;
    this.nextFlake = 1500;
    this.scale = 0;
    // Lay out the letters once.
    let x = 0, seed = 1;
    for (const ch of TITLE) {
      if (ch === " ") { x += SPACE * CELL; continue; }
      const L = buildLetter(ch, seed++ * 13);
      L.x = x - 1;
      L.y = -1;
      this.letters.push(L);
      x += (L.w - 2) + GAP * CELL;
    }
    this.textW = x - GAP * CELL;
    this.W = this.textW + MARGIN_X * 2;
    this.H = TOP + BOARD_H + FALL;
    canvas.width = this.W;
    canvas.height = this.H;
    this.board = this.buildBoard();
    this.resize();
  }

  /** Pick a size that fits the window, in whole CSS pixels per sign pixel. */
  resize() {
    const scale = innerWidth >= 960 && innerHeight >= 760 ? 4 : innerWidth >= 700 && innerHeight >= 520 ? 3 : 2;
    if (scale === this.scale) return;
    this.scale = scale;
    const s = this.canvas.style;
    s.width = `${this.W * scale}px`;
    s.height = `${this.H * scale}px`;
    // The space for falling flakes below the board takes no room in the layout.
    s.marginBottom = `${-FALL * scale}px`;
    const hang = this.canvas.parentElement;
    hang.style.setProperty("--rope-end", `${(TOP + 1) * scale}px`);
    // The subtitle is painted on the lowest plank.
    this.sub.style.top = `${(TOP + 33) * scale}px`;
    this.sub.style.height = `${12 * scale}px`;
    this.sub.style.lineHeight = `${12 * scale}px`;
    this.sub.style.fontSize = `${7.5 * scale}px`;
  }

  /** Where the ropes hang: 16% in from each side (matches the CSS ropes). */
  ropeX() {
    return [Math.round(this.W * 0.16 + 1), Math.round(this.W * 0.84 - 1)];
  }

  buildBoard() {
    const { W } = this;
    const c = document.createElement("canvas");
    c.width = W; c.height = this.H;
    const ctx = c.getContext("2d");
    const y0 = TOP, H = BOARD_H;
    const px = (x, y, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); };
    // Three planks of sun-bleached wood, with grain and a couple of knots.
    const planks = [[0, 15], [16, 31], [32, H - 1]];
    planks.forEach(([a, b], pi) => {
      for (let y = a; y <= b; y++) for (let x = 0; x < W; x++) {
        const grain = Math.sin(x * 0.07 + pi * 3 + Math.sin(x * 0.013 + y * 0.9 + pi) * 2.2 + y * 1.7);
        let col = grain > 0.86 ? "#a86d38" : grain > 0.55 ? "#bd7f45" : grain < -0.92 ? "#dfa86a" : "#c98a4e";
        if (y === a) col = "#e2ae72"; // light top edge of each plank
        if (y === b) col = "#8e5a2c";
        px(x, y0 + y, col);
      }
      // A knot.
      const kx = Math.round(W * (0.12 + hash(pi, 1) * 0.76)), ky = y0 + Math.round((a + b) / 2);
      for (let j = -2; j <= 2; j++) for (let i = -3; i <= 3; i++) {
        const d = (i / 3) ** 2 + (j / 2) ** 2;
        if (d <= 1) px(kx + i, ky + j, d < 0.35 ? "#6e4423" : "#9a6233");
      }
    });
    // Seams between planks.
    for (const y of [15.5, 31.5]) { ctx.fillStyle = "#5a3418"; ctx.fillRect(0, y0 + Math.ceil(y), W, 1); }
    // Dark border with chipped corners and a few worn spots.
    ctx.fillStyle = "#4a2410";
    ctx.fillRect(0, y0, W, 1); ctx.fillRect(0, y0 + H - 1, W, 1);
    ctx.fillRect(0, y0, 1, H); ctx.fillRect(W - 1, y0, 1, H);
    ctx.fillStyle = "#3a1c0c"; ctx.fillRect(0, y0 + H - 2, W, 1);
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [W - 1, 0], [W - 2, 0], [W - 1, 1], [0, H - 1], [1, H - 1], [0, H - 2], [W - 1, H - 1], [W - 2, H - 1], [W - 1, H - 2]]) {
      ctx.clearRect(x, y0 + y, 1, 1);
    }
    for (let i = 0; i < 6; i++) {
      const x = Math.round(8 + hash(i, 4) * (W - 16));
      ctx.clearRect(x, y0, 2, 1);
      ctx.fillStyle = "#4a2410"; ctx.fillRect(x, y0 + 1, 2, 1);
    }
    // Rusty nails in the corners, each leaving a rust streak down the wood.
    const nail = (x, y) => {
      for (let i = 1; i <= 9; i++) {
        const a = 0.5 * (1 - i / 10);
        ctx.fillStyle = `rgba(140, 58, 18, ${a})`;
        ctx.fillRect(x + (i > 4 && hash(x, i) > 0.5 ? 1 : 0), y + 1 + i, 1 + (i < 4 ? 1 : 0), 1);
      }
      px(x - 1, y, "#7a3510"); px(x + 2, y, "#7a3510"); px(x, y - 1, "#7a3510"); px(x + 1, y + 2, "#7a3510");
      ctx.fillStyle = "#8a4a22"; ctx.fillRect(x, y, 2, 2);
      px(x, y, "#c87a42"); px(x + 1, y + 1, "#5a2a10");
    };
    nail(3, y0 + 3);
    nail(W - 5, y0 + 3);
    nail(3, y0 + H - 7);
    // Rusty iron brackets where the ropes are tied, with a ring above the board.
    for (const x of this.ropeX()) {
      ctx.fillStyle = "#7a3510"; ctx.fillRect(x - 3, y0, 7, 4);
      ctx.fillStyle = "#a84a18"; ctx.fillRect(x - 2, y0 + 1, 5, 2);
      px(x - 2, y0 + 1, "#c8561c"); px(x + 2, y0 + 2, "#8d8984");
      ctx.fillStyle = "#5a2a10";
      ctx.fillRect(x - 1, y0 - 3, 3, 1); ctx.fillRect(x - 2, y0 - 2, 1, 2); ctx.fillRect(x + 2, y0 - 2, 1, 2);
      px(x - 1, y0 - 3, "#8d8984");
    }
    return c;
  }

  /** The board just landed: a puff of dust and a shower of rust flakes. */
  land() {
    if (this.reduced) return;
    const t = performance.now();
    for (let i = 0; i < 26; i++) {
      const x = 4 + Math.random() * (this.W - 8);
      this.flakes.push({
        x, y: TOP + BOARD_H - 1, vx: (x - this.W / 2) / this.W * 30 + (Math.random() - 0.5) * 8, vy: -4 - Math.random() * 10,
        born: t, life: 0.9 + Math.random() * 0.6, color: ["#d9c29a", "#bfa37a", "#e8d6b0"][i % 3], dust: true,
      });
    }
    for (let i = 0; i < 10; i++) this.dropFlake(t);
  }

  dropFlake(t) {
    const L = this.letters[Math.floor(Math.random() * this.letters.length)];
    const ox = MARGIN_X + L.x, oy = TOP + TEXT_Y + L.y;
    // From a random spot along the letter's lower edge.
    for (let tries = 0; tries < 20; tries++) {
      const x = Math.floor(Math.random() * (L.w - 2)), y = Math.floor(Math.random() * (L.h - 2));
      if (L.solid(x, y) && !L.solid(x, y + 1)) {
        this.flakes.push({
          x: ox + x + 1, y: oy + y + 2, vx: (Math.random() - 0.5) * 3, vy: 1,
          born: t, life: 2.4, color: ["#b7410e", "#c8561c", "#8e3510", "#d9773a"][tries % 4], sway: Math.random() * 6,
        });
        return;
      }
    }
  }

  draw(t) {
    this.resize();
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.drawImage(this.board, 0, 0);
    const motion = !this.reduced;

    // Now and then a letter works loose and wobbles on its nail.
    if (motion && t > this.nextWobble && !this.wobble) {
      this.wobble = { i: Math.floor(Math.random() * this.letters.length), born: t };
      this.nextWobble = t + 3000 + Math.random() * 3000;
    }
    let angleFor = () => 0;
    if (this.wobble) {
      const age = (t - this.wobble.born) / 1000;
      if (age > 1.6) this.wobble = null;
      else {
        const a = 0.13 * Math.exp(-age * 3.2) * Math.sin(age * 15);
        // Turn in whole steps, so it stays pixel art rather than going blurry.
        const stepped = Math.round(a / 0.035) * 0.035;
        angleFor = i => (i === this.wobble.i ? stepped : 0);
      }
    }
    const drawLetter = (L, i, img, dx, dy) => {
      const ox = MARGIN_X + L.x + dx, oy = TOP + TEXT_Y + L.y + dy;
      const a = angleFor(i);
      if (!a) { ctx.drawImage(img, ox, oy); return; }
      ctx.save();
      ctx.translate(ox + L.nail.x + 1, oy + L.nail.y + 1);
      ctx.rotate(a);
      ctx.drawImage(img, -L.nail.x - 1, -L.nail.y - 1);
      ctx.restore();
    };
    this.letters.forEach((L, i) => drawLetter(L, i, L.shadow, 2, 2));
    this.letters.forEach((L, i) => drawLetter(L, i, L.sprite, 0, 0));

    this.drawGear(motion ? t / 1000 : 0);

    // Rust flakes falling from the letters.
    if (motion && t > this.nextFlake) {
      this.dropFlake(t);
      this.nextFlake = t + 900 + Math.random() * 1800;
    }
    this.flakes = this.flakes.filter(f => {
      const age = (t - f.born) / 1000;
      if (age > f.life) return false;
      const x = f.x + f.vx * age + (f.sway ? Math.sin(age * 4 + f.sway) * 1.5 : 0);
      const y = f.y + f.vy * age + (f.dust ? 10 : 9) * age * age;
      ctx.globalAlpha = Math.min(1, (f.life - age) / 0.5);
      ctx.fillStyle = f.color;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      ctx.globalAlpha = 1;
      return true;
    });
  }

  drawGear(sec) {
    // A small rusty gear turning in the bottom-right corner.
    const ctx = this.ctx;
    const cx = this.W - 16, cy = TOP + BOARD_H - 9;
    const rot = sec * 0.6;
    for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) {
      const r = Math.hypot(i, j), a = Math.atan2(j, i);
      const tooth = Math.cos(8 * (a - rot)) > 0.25;
      if (r > (tooth ? 6.2 : 4.6) || r < 1.6) continue;
      const edge = r > (tooth ? 5.3 : 3.8);
      const spot = hash(i + 20, j + 20, 5) > 0.82;
      ctx.fillStyle = edge ? "#6e2a0c" : spot ? "#8d8984" : (i + j < 0 ? "#c8561c" : "#a84a18");
      ctx.fillRect(cx + i, cy + j, 1, 1);
    }
    ctx.fillStyle = "#4a2410";
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }
}
