// Little chiptune sound effects made with WebAudio (no audio files needed).

let ctx = null;
let enabled = true;

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = "square", vol = 0.04, at = 0, slideTo = null } = {}) {
  if (!enabled) return;
  try {
    const a = audio();
    const t = a.currentTime + at;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch {
    /* audio not available */
  }
}

let lastBlip = 0;

export const sound = {
  setEnabled(on) { enabled = on; },
  get enabled() { return enabled; },
  click() { tone(660, 0.05, { vol: 0.03 }); },
  open() { tone(520, 0.06, { vol: 0.03 }); tone(780, 0.08, { vol: 0.03, at: 0.05 }); },
  /** Talking blip, throttled so streaming text doesn't buzz. */
  blip() {
    const now = performance.now();
    if (now - lastBlip < 70) return;
    lastBlip = now;
    tone(380 + Math.random() * 160, 0.035, { vol: 0.018, type: "square" });
  },
  compile() { tone(300, 0.05, { vol: 0.025 }); tone(400, 0.05, { vol: 0.025, at: 0.06 }); },
  fail() { tone(220, 0.12, { vol: 0.04, slideTo: 140 }); tone(150, 0.18, { vol: 0.04, at: 0.12, slideTo: 90 }); },
  success() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, { vol: 0.04, at: i * 0.08 })); },
  coin() { tone(988, 0.06, { vol: 0.035 }); tone(1319, 0.14, { vol: 0.035, at: 0.06 }); },
  fanfare() {
    const notes = [523, 523, 523, 659, 784, 659, 784, 1047];
    notes.forEach((f, i) => tone(f, i === notes.length - 1 ? 0.4 : 0.1, { vol: 0.045, at: i * 0.11 }));
    [262, 330, 392, 523].forEach((f, i) => tone(f, 0.3, { vol: 0.025, type: "triangle", at: i * 0.22 }));
  },
};
