// Pixel-art UI icons, drawn as crisp SVG so they match the rest of the game.

const PAL = {
  o: "#3b1d0b", // outline
  w: "#fff2cf", // page
  l: "#c9a46a", // text lines on pages
  R: "#d9442b", // red cover
  S: "#d3dae0", // metal light
  s: "#9aa4ae", // metal mid
  d: "#626a73", // metal dark
  h: "#ffffff", // highlight
  p: "#d8b072", // map folds
  g: "#5aa63a", // grass
  r: "#d9442b", // red marks
  y: "#ffd54a", // gold
  Y: "#d9961a", // gold shade
  c: "#fff6c4", // gold shine
  G: "#5cbf3f", // green
  L: "#a6ec7c", // green light
  B: "#4f9fe0", // blue
  b: "#a9dcff", // glass
  t: "#9a5a2b", // wood handle
  T: "#c98a4a", // wood light
  O: "#ef8a3c", // orange
  P: "#ffd07a", // orange light
  v: "#c7a2f5", // purple light
  V: "#8e5bd8", // purple
  k: "#ff9fb0", // pink
  K: "#ffe9a8", // pale yellow
};

// ---- tiny drawing kit for the programmatic icons (16×16, auto-outlined) ----
function canvas() {
  return Array.from({ length: 16 }, () => Array(16).fill("."));
}
function put(g, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (y >= 0 && y < 16 && x >= 0 && x < 16) g[y][x] = c;
}
function disc(g, cx, cy, r, c) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) g[y][x] = c;
  }
}
function poly(g, pts, c) {
  // Fill pixels whose centre is inside the polygon (even-odd rule).
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const px = x + 0.5, py = y + 0.5;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) g[y][x] = c;
  }
}
function rect(g, x0, y0, x1, y1, c) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(g, x, y, c);
}
function outlined(g) {
  const out = g.map(r => r.slice());
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (g[y][x] !== ".") continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (g[y + dy]?.[x + dx] ?? ".") !== ".")) out[y][x] = "o";
  }
  return out.map(r => r.join(""));
}
function shadeTop(g, from, to) {
  // Lighten the top edge of a shape for a little 3D feel.
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
    if (g[y][x] === from) { g[y][x] = to; break; }
  }
}

const BUILT = {
  run() {
    const g = canvas();
    poly(g, [[4, 2], [4, 14], [13.5, 8]], "G");
    for (let y = 0; y < 16; y++) if (g[y][4] === "G") g[y][4] = "L";
    shadeTop(g, "G", "L");
    return outlined(g);
  },
  explain() {
    const g = canvas();
    for (let i = 0; i < 4; i++) { rect(g, 9 + i, 9 + i, 10 + i, 10 + i, "t"); }
    disc(g, 6.5, 6.5, 5.4, "s");
    disc(g, 6.5, 6.5, 3.9, "b");
    put(g, 4, 4, "h"); put(g, 5, 4, "h"); put(g, 4, 5, "h");
    return outlined(g);
  },
  review() {
    const g = canvas();
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 3.1 : 7.2;
      pts.push([8 + r * Math.cos(a), 8.6 + r * Math.sin(a)]);
    }
    poly(g, pts, "y");
    for (let y = 9; y < 16; y++) for (let x = 0; x < 16; x++) if (g[y][x] === "y" && x >= 8) g[y][x] = "Y";
    put(g, 7, 4, "c"); put(g, 7, 5, "c"); put(g, 6, 6, "c");
    return outlined(g);
  },
  reset() {
    const g = canvas();
    // A ring with a gap at the top right, and an arrowhead on its end.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8.5;
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      if (d >= 3.4 && d <= 5.8 && !(ang > -Math.PI / 2 && ang < -0.15)) g[y][x] = "B";
    }
    poly(g, [[8, 0.5], [8, 6.5], [12.5, 3.5]], "B");
    return outlined(g);
  },
  skip() {
    const g = canvas();
    poly(g, [[1.5, 3], [1.5, 13], [7.5, 8]], "B");
    poly(g, [[7, 3], [7, 13], [13, 8]], "B");
    rect(g, 12, 3, 13, 12, "B");
    return outlined(g);
  },
  replay() {
    // Rewind: two triangles pointing left, with a bar (start over from the beginning).
    const g = canvas();
    rect(g, 1, 3, 2, 12, "V");
    poly(g, [[8.5, 2.5], [8.5, 13.5], [2.5, 8]], "V");
    poly(g, [[14.5, 2.5], [14.5, 13.5], [8.5, 8]], "V");
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (g[y][x] === "V" && y < 6) g[y][x] = "v";
    return outlined(g);
  },
  next() {
    const g = canvas();
    rect(g, 2, 6, 9, 9, "O");
    poly(g, [[8, 1.5], [8, 14.5], [14.5, 8]], "O");
    rect(g, 2, 6, 9, 6, "P");
    return outlined(g);
  },
  expand() {
    // Four corner brackets pointing outwards.
    const g = canvas();
    rect(g, 1, 1, 5, 2, "o"); rect(g, 1, 1, 2, 5, "o");
    rect(g, 10, 1, 14, 2, "o"); rect(g, 13, 1, 14, 5, "o");
    rect(g, 1, 13, 5, 14, "o"); rect(g, 1, 10, 2, 14, "o");
    rect(g, 10, 13, 14, 14, "o"); rect(g, 13, 10, 14, 14, "o");
    return g.map(r => r.join(""));
  },
  collapse() {
    // Four corner brackets pointing inwards.
    const g = canvas();
    rect(g, 2, 5, 6, 6, "o"); rect(g, 5, 2, 6, 6, "o");
    rect(g, 9, 5, 13, 6, "o"); rect(g, 9, 2, 10, 6, "o");
    rect(g, 2, 9, 6, 10, "o"); rect(g, 5, 9, 6, 13, "o");
    rect(g, 9, 9, 13, 10, "o"); rect(g, 9, 9, 10, 13, "o");
    return g.map(r => r.join(""));
  },
  // ---- level types ----
  fix() {
    // A wrench: handle from bottom-left, open jaw at top-right.
    const g = canvas();
    for (let i = 0; i < 7; i++) rect(g, 3 + i, 11 - i, 4 + i, 12 - i, "s");
    disc(g, 10.8, 5.2, 4.3, "s");
    disc(g, 12.6, 3.4, 2.3, ".");   // bite out the jaw opening (a "C" shape)
    for (const [x, y] of [[8, 4], [8, 5], [9, 3], [3, 11]]) put(g, x, y, "S");
    return outlined(g);
  },
  fill() {
    // A pencil, tip at the bottom-left.
    const g = canvas();
    const n = [0.72, 0.72];
    const at = (t, side) => [2.5 + t * 11 + side * n[0] * 2.2, 13.5 - t * 11 + side * n[1] * 2.2];
    poly(g, [at(0.27, -1), at(0.27, 1), at(0.82, 1), at(0.82, -1)], "y");
    poly(g, [at(0.82, -1), at(0.82, 1), at(1, 1), at(1, -1)], "k");
    poly(g, [[2.2, 13.8], at(0.27, -1), at(0.27, 1)], "K");
    put(g, 2, 13, "o"); put(g, 3, 13, "o"); put(g, 2, 12, "o");
    for (let t = 0.3; t < 0.8; t += 0.07) { const [x, y] = at(t, 0.6); put(g, x, y, "Y"); }
    return outlined(g);
  },
  predict() {
    // A crystal ball on a little wooden stand.
    const g = canvas();
    disc(g, 8, 6.5, 5.6, "V");
    disc(g, 7.4, 5.9, 4.3, "v");
    put(g, 5, 3, "h"); put(g, 6, 3, "h"); put(g, 5, 4, "h");
    put(g, 9, 7, "c"); put(g, 10, 6, "c");
    rect(g, 4, 12, 11, 12, "T");
    rect(g, 3, 13, 12, 14, "t");
    return outlined(g);
  },
  boss() {
    // A horned red ogre face.
    const g = canvas();
    disc(g, 8, 8.5, 5.6, "R");
    poly(g, [[2, 1], [5.5, 5], [3.5, 6.5]], "w");
    poly(g, [[14, 1], [10.5, 5], [12.5, 6.5]], "w");
    rect(g, 4, 7, 6, 8, "y"); rect(g, 9, 7, 11, 8, "y");
    put(g, 5, 8, "o"); put(g, 10, 8, "o");
    rect(g, 4, 6, 6, 6, "o"); rect(g, 9, 6, 11, 6, "o");
    rect(g, 5, 11, 10, 12, "o");
    put(g, 5, 11, "w"); put(g, 7, 11, "w"); put(g, 8, 11, "w"); put(g, 10, 11, "w");
    return outlined(g);
  },
  // Chat width: an arrow pushing against the panel's edge ("←|" widen, "|→" narrow).
  arrowLeft() {
    const g = canvas();
    rect(g, 12, 2, 13, 13, "o");               // the panel edge
    rect(g, 3, 7, 10, 8, "o");                 // shaft
    for (let i = 0; i < 4; i++) {              // arrowhead
      rect(g, 3 + i, 7 - i, 4 + i, 7 - i, "o");
      rect(g, 3 + i, 8 + i, 4 + i, 8 + i, "o");
    }
    return g.map(r => r.join(""));
  },
  arrowRight() {
    const g = canvas();
    rect(g, 2, 2, 3, 13, "o");
    rect(g, 5, 7, 12, 8, "o");
    for (let i = 0; i < 4; i++) {
      rect(g, 11 - i, 7 - i, 12 - i, 7 - i, "o");
      rect(g, 11 - i, 8 + i, 12 - i, 8 + i, "o");
    }
    return g.map(r => r.join(""));
  },
};

const ART = {
  book: [
    "................",
    "................",
    ".ooo........ooo.",
    "owwwoo....oowwwo",
    "owllwwoooowwllwo",
    "owwwwwwoowwwwwwo",
    "owllllwoowllllwo",
    "owwwwwwoowwwwwwo",
    "owllllwoowllllwo",
    "owwwwwwoowwwwwwo",
    "owlllwwoowwlllwo",
    "owwwwwwoowwwwwwo",
    "oRooooooooooooRo",
    ".oRRRRRRRRRRRRo.",
    "..oooooooooooo..",
    "................",
  ],
  anvil: [
    "................",
    "................",
    "................",
    "...oooooooooo...",
    "..ohSSSSSSSSSoo.",
    ".oSSSSSSSSSSSSSo",
    "..oossssssssooo.",
    "....ossssssso...",
    ".....osssso.....",
    ".....osssso.....",
    "....ossssssso...",
    "...odddddddddo..",
    "...ooooooooooo..",
    "................",
    "................",
    "................",
  ],
  gear: [
    "................",
    "......oooo......",
    "...oo.oSSo.oo...",
    "..oSSooSSooSSo..",
    "..oSSSSSSSSSSo..",
    "...oSSSddSSSo...",
    ".ooSSSdoodSSSoo.",
    ".oSSSdo..odSSSo.",
    ".oSSSdo..odSSSo.",
    ".ooSSSdoodSSSoo.",
    "...oSSSddSSSo...",
    "..oSSSSSSSSSSo..",
    "..oSSooSSooSSo..",
    "...oo.oSSo.oo...",
    "......oooo......",
    "................",
  ],
  coin: [
    "..oooo..",
    ".oyyyyo.",
    "oycyyyYo",
    "oyyyyyYo",
    "oyyyyyYo",
    "oyyyyYYo",
    ".oYYYYo.",
    "..oooo..",
  ],
  map: (() => {
    // A folded parchment map with a dotted trail and a red X.
    const g = Array.from({ length: 16 }, () => Array(16).fill("."));
    for (let y = 2; y <= 13; y++) for (let x = 1; x <= 14; x++) {
      const edge = y === 2 || y === 13 || x === 1 || x === 14;
      g[y][x] = edge ? "o" : x === 6 || x === 10 ? "p" : "w";
    }
    for (const [x, y] of [[3, 4], [4, 4], [2, 5], [3, 5], [4, 5], [3, 6]]) g[y][x] = "g";
    for (const [x, y] of [[4, 9], [6, 10], [8, 9], [9, 7]]) g[y][x] = "o";
    for (const [x, y] of [[11, 4], [13, 4], [12, 5], [11, 6], [13, 6]]) g[y][x] = "r";
    return g.map(r => r.join(""));
  })(),
};

// A tiny "!" alert badge (red for errors, yellow for warnings / new output).
ART.alert = [
  ".oooooo.",
  "oRRhhRRo",
  "oRRhhRRo",
  "oRRhhRRo",
  "oRRRRRRo",
  "oRRhhRRo",
  "oRRRRRRo",
  ".oooooo.",
];
ART.alertYellow = ART.alert.map(r => r.replace(/R/g, "y").replace(/h/g, "o"));
// Compiler (a little scroll with lines) and Output (a terminal with a prompt) slot icons.
ART.compiler = [
  "................",
  "..oooooooooooo..",
  ".oTwwwwwwwwwwTo.",
  ".oTwooooowwwwTo.",
  "..owwwwwwwwwwo..",
  "..owoooooowwwo..",
  "..owwwwwwwwwwo..",
  "..owooowoooowo..",
  "..owwwwwwwwwwo..",
  "..owoooooowwwo..",
  "..owwwwwwwwwwo..",
  ".oTwwwwwwwwwwTo.",
  ".oTwwwwwwwwwwTo.",
  "..oooooooooooo..",
  "................",
  "................",
];
ART.output = [
  "................",
  ".oooooooooooooo.",
  ".osssssssssssso.",
  ".oddddddddddddo.",
  ".odGddddddddddo.",
  ".oddGdddddddddo.",
  ".odGddGGGdddddo.",
  ".oddddddddddddo.",
  ".oddddddddddddo.",
  ".oddddddddddddo.",
  ".oddddddddddddo.",
  ".oooooooooooooo.",
  "......oooo......",
  "....oooooooo....",
  "................",
  "................",
];
ART.expected = [
  "................",
  "....oooooooo....",
  "...owwwwwwwwo...",
  "..owwwwwwwwwwo..",
  "..owGGwwwwwwwo..",
  "..owwGGwwGGwwo..",
  "..owwwGGGGwwwo..",
  "..owwwwGGwwwwo..",
  "..owwwwwwwwwwo..",
  "..owooooooowwo..",
  "..owwwwwwwwwwo..",
  "..owoooooowwwo..",
  "..owwwwwwwwwwo..",
  "..oooooooooooo..",
  "................",
  "................",
];
ART.hint = [
  "................",
  "......yyyy......",
  "....yyyyyyyy....",
  "...ycccyyyyyy...",
  "...yccyyyyyyY...",
  "...ycyyyyyyyY...",
  "...yyyyyyyyyY...",
  "....yyyyyyyY....",
  ".....yyyyyY.....",
  ".....yyyyYY.....",
  ".....ssssss.....",
  ".....dddddd.....",
  ".....ssssss.....",
  "......dddd......",
  "................",
  "................",
];
ART.hint = (() => {
  const g = ART.hint.map(r => r.split(""));
  return outlined(g);
})();
for (const [name, build] of Object.entries(BUILT)) ART[name] = build();
ART.quiz = ART.book;
// "back" is the orange "next" arrow, mirrored.
ART.back = ART.next.map(row => [...row].reverse().join(""));

/** SVG markup for a pixel icon. `px` is the size of one art pixel in CSS pixels. */
export function pixelIcon(name, px = 2) {
  const rows = ART[name];
  if (!rows) return "";
  const h = rows.length, w = rows[0].length;
  let rects = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c !== "." && PAL[c]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${PAL[c]}"/>`;
    }
  });
  return `<svg class="px-icon" width="${w * px}" height="${h * px}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

/** Replace every `[data-icon]` element's contents with its pixel icon. */
export function applyIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    el.innerHTML = pixelIcon(el.dataset.icon, Number(el.dataset.px) || 2);
  }
}
export { ART as ICON_ART, PAL as ICON_PALETTE };

// Tiny 7×7 pixel glyphs that take the colour of the text around them (for ✔ ✘ ⚠ ▶ ⏭).
const GLYPHS = {
  "✔": ["......#", ".....##", "#...##.", "##.##..", ".###...", "..#....", "......."],
  "✘": ["#.....#", "##...##", ".##.##.", "..###..", ".##.##.", "##...##", "#.....#"],
  "⚠": ["...#...", "..###..", "..#.#..", ".##.##.", ".##.##.", "#######", "###.###"],
  "▶": ["#......", "###....", "#####..", "#######", "#####..", "###....", "#......"],
  "⏭": ["#..#..#", "##.##.#", "#######", "#######", "##.##.#", "#..#..#", "......."],
};

/** Inline pixel glyph for a symbol, or null if there isn't one. */
export function pixelGlyph(ch) {
  const rows = GLYPHS[ch];
  if (!rows) return null;
  let rects = "";
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
  return `<svg class="px-glyph" viewBox="0 0 7 7" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}
