// Minimal WebAudio synth SFX — no assets needed.

let ctx = null;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'sine', vol = 0.2, delay = 0, slideTo = null) {
  try {
    const a = ac();
    const t0 = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  } catch (_) { /* audio blocked */ }
}

function noise(dur, vol = 0.25, delay = 0, lowpass = 2000) {
  try {
    const a = ac();
    const t0 = a.currentTime + delay;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    const g = a.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(a.destination);
    src.start(t0);
  } catch (_) { /* audio blocked */ }
}

export const sfx = {
  unlock() { ac(); },
  click() { tone(660, 0.06, 'square', 0.08); },
  whoosh() { noise(0.35, 0.2, 0, 1200); tone(300, 0.3, 'sine', 0.06, 0, 90); },
  rope() { tone(140, 0.12, 'triangle', 0.25, 0, 80); noise(0.08, 0.15, 0, 900); },
  snap() { noise(0.15, 0.4, 0, 3500); tone(90, 0.25, 'sawtooth', 0.18, 0.02, 40); },
  win(big = false) {
    const base = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
    base.forEach((f, i) => tone(f, 0.22, 'triangle', 0.16, i * 0.09));
  },
  lose() { tone(220, 0.3, 'sawtooth', 0.12, 0, 110); tone(110, 0.4, 'sine', 0.15, 0.12, 55); },
  coin() { tone(1568, 0.1, 'square', 0.06); tone(2093, 0.18, 'square', 0.06, 0.06); },
  tick() { tone(880, 0.04, 'square', 0.045); },
  crash() { noise(0.5, 0.5, 0, 700); tone(70, 0.6, 'sawtooth', 0.3, 0, 30); },
  moo() { tone(180, 0.5, 'sawtooth', 0.1, 0, 120); tone(90, 0.5, 'triangle', 0.12, 0.05, 70); },
  jump() { noise(0.18, 0.1, 0, 1800); tone(230, 0.24, 'sine', 0.06, 0, 430); },
  land() { noise(0.1, 0.18, 0, 500); tone(85, 0.18, 'sine', 0.16, 0, 55); },
};
