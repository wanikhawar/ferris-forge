import { drawGrid, Ferris, ferrisGrid } from "./sprites.js";

// The game's own Ferris sprite. With reduced motion he is drawn once per mood
// instead of bobbing, blinking and dancing.
export function createMascot(canvas, { scale = 6, pad = 0 } = {}) {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!still.matches) {
    const ferris = new Ferris(canvas, { scale, pad });
    return {
      setMood: (mood, ms = 0) => ferris.setMood(mood, ms),
      setDance: (on) => ferris.setDance(on),
      get dancing() {
        return ferris.dancing;
      },
    };
  }

  canvas.width = (40 + pad * 2) * scale;
  canvas.height = (32 + pad) * scale;
  const context = canvas.getContext("2d");
  let timer = 0;
  let dancing = false;
  const draw = (mood) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid(context, ferrisGrid({ mood }), pad, 1 + pad, scale);
  };
  draw("idle");
  return {
    setMood(mood, ms = 0) {
      window.clearTimeout(timer);
      draw(mood);
      if (ms > 0) timer = window.setTimeout(() => draw("idle"), ms);
    },
    setDance(on) {
      dancing = on;
      draw(on ? "excited" : "idle");
    },
    get dancing() {
      return dancing;
    },
  };
}
