// 8bit 風の効果音（WebAudio の矩形波）
const MUTE_KEY = 'nazca.mute';
let ctx = null;
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } })();

function ac() {
  if (muted) return null;
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, dur, { when = 0, type = 'square', vol = 0.05, slide = 0 } = {}) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.setValueAtTime(vol, t0 + dur * 0.7);
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const seq = (notes, step, opts) => notes.forEach((f, i) => f && tone(f, step * 0.9, { ...opts, when: i * step }));

export const sfx = {
  blip: () => tone(880, 0.045, { vol: 0.035 }),
  select: () => { tone(660, 0.05); tone(990, 0.07, { when: 0.05 }); },
  back: () => { tone(660, 0.05); tone(440, 0.07, { when: 0.05 }); },
  start: () => seq([523, 659, 784, 1047], 0.07),
  pause: () => seq([784, 523], 0.08),
  finish: () => seq([784, 988, 1175, 1568], 0.08, { vol: 0.045 }),
  coin: () => { tone(988, 0.07); tone(1319, 0.28, { when: 0.07 }); },
  tick: () => tone(1400, 0.02, { vol: 0.02 }),
  error: () => tone(160, 0.25, { type: 'sawtooth', vol: 0.04, slide: -60 }),
  discover: () => { seq([523, 659, 784, 1047, 1319], 0.06, { vol: 0.045 }); tone(1568, 0.3, { when: 0.32, vol: 0.04 }); },
  visit: () => seq([392, 523, 659, 784, 1047, 784, 1047], 0.08, { vol: 0.045 }),
  ping: () => { tone(1760, 0.03, { vol: 0.025 }); tone(2349, 0.05, { when: 0.04, vol: 0.02 }); },
  fanfare: (good) => (good
    ? seq([523, 523, 523, 659, 0, 784, 0, 1047], 0.09, { vol: 0.045 })
    : seq([392, 330, 262], 0.14, { vol: 0.04 })),
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* noop */ }
    if (!muted) this.select();
    return muted;
  },
};
