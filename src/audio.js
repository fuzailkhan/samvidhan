/* =========================================================
   SAMVIDHAN: LEGAL EMPIRE — src/audio.js
   100% synthesized audio (Web Audio API). No external files.

   Public API  (Samvidhan.Audio):
     init()  unlock()  resume()  suspend()  isReady()
     setMaster(0-100)  setAmbience(0-100)
     play(name, opts)          -> see SFX table below
     say(phrase, opts)         -> 'objection' | 'order' | 'overruled' | 'sustained'
                                  | 'granted' | 'dismissed' | 'hmm' | 'hurt'
     gavel(strength)  gavelCount(n)  verdict(granted)  fanfare(kind)
     footstep(surface, running)  haptic(ms)
     startAmbience(room)  stopAmbience()      room: courtroom|library|thana|chambers|corridor
     startMusic(name)  stopMusic()  setTension(0-1)   name: menu|fight
   ========================================================= */
(function (global) {
'use strict';

const SV = global.Samvidhan = global.Samvidhan || {};
const AC = global.AudioContext || global.webkitAudioContext;

let ctx = null, master = null, comp = null, sfx = null, amb = null, music = null;
let reverb = null, revSend = null, whiteBuf = null, brownBuf = null;
let active = 0;
const MAX_VOICES = 28;
const vol = { master: 70, ambience: 50 };

let currentRoom = null, ambBus = null, ambSources = [], ambTimers = [];
let musicName = null, musicBus = null, musicSources = [], musicTimers = [];
let tension = 0.3;
let unlockBound = false;

/* ---------------------------------------------------------
   Helpers
   --------------------------------------------------------- */
function rand(a, b) { return a + Math.random() * (b - a); }
function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function curve(v) { const x = Math.max(0, Math.min(100, v)) / 100; return x * x; }

function makeNoise(seconds, type) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (type === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  } else {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}
function makeIR(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function init() {
  if (ctx) return ctx;
  if (!AC) return null;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { ctx = null; return null; } }
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 20; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
  master = ctx.createGain(); master.gain.value = curve(vol.master);
  comp.connect(master); master.connect(ctx.destination);
  sfx = ctx.createGain(); sfx.gain.value = 1; sfx.connect(comp);
  amb = ctx.createGain(); amb.gain.value = curve(vol.ambience); amb.connect(comp);
  music = ctx.createGain(); music.gain.value = curve(vol.ambience) * 0.8; music.connect(comp);
  reverb = ctx.createConvolver(); reverb.buffer = makeIR(1.7, 2.6);
  revSend = ctx.createGain(); revSend.gain.value = 0.3;
  revSend.connect(reverb); reverb.connect(comp);
  whiteBuf = makeNoise(2, 'white');
  brownBuf = makeNoise(4, 'brown');
  if (SV.State && SV.State.settings) {
    vol.master = SV.State.settings.volume; vol.ambience = SV.State.settings.ambience;
    master.gain.value = curve(vol.master); amb.gain.value = curve(vol.ambience); music.gain.value = curve(vol.ambience) * 0.8;
  }
  return ctx;
}

function unlock() {
  if (unlockBound) return;
  unlockBound = true;
  const handler = function () {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    try { // iOS: play a silent buffer inside the gesture
      if (ctx) { const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); }
    } catch (e) { /* ignore */ }
    if (ctx && ctx.state === 'running') {
      ['pointerdown', 'touchend', 'mousedown', 'keydown'].forEach(ev => global.removeEventListener(ev, handler, true));
    }
  };
  ['pointerdown', 'touchend', 'mousedown', 'keydown'].forEach(ev => global.addEventListener(ev, handler, true));
  if (global.document) {
    global.document.addEventListener('visibilitychange', () => { if (global.document.hidden) suspend(); else resume(); });
  }
}
function resume() { if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } } }
function suspend() { if (ctx && ctx.state === 'running') { try { ctx.suspend(); } catch (e) { /* ignore */ } } }
function isReady() { return !!ctx && ctx.state === 'running'; }

function setMaster(v) { vol.master = v; if (master) master.gain.setTargetAtTime(curve(v), ctx.currentTime, 0.05); }
function setAmbience(v) {
  vol.ambience = v;
  if (amb) amb.gain.setTargetAtTime(curve(v), ctx.currentTime, 0.1);
  if (music) music.gain.setTargetAtTime(curve(v) * 0.8, ctx.currentTime, 0.1);
}
function setReverb(amount) { if (revSend) revSend.gain.setTargetAtTime(amount, ctx.currentTime, 0.3); }

function haptic(ms) {
  try {
    const on = SV.State && SV.State.settings ? SV.State.settings.haptics : true;
    if (on && global.navigator && global.navigator.vibrate) global.navigator.vibrate(ms);
  } catch (e) { /* ignore */ }
}

/* ---------------------------------------------------------
   Primitive builders
   --------------------------------------------------------- */
function track(node) {
  active++;
  let done = false;
  const prev = node.onended;
  node.onended = function () { if (!done) { done = true; active = Math.max(0, active - 1); } if (typeof prev === 'function') prev(); };
}
function route(node, o) {
  o = o || {};
  node.connect(o.dest || sfx);
  if (o.wet > 0 && revSend) { const g = ctx.createGain(); g.gain.value = o.wet; node.connect(g); g.connect(revSend); }
}

/* o: f, f2, type, dur, vol, at, attack, wet, detune, dest, filter:{type,freq,q,to} */
function tone(o) {
  if (!ctx || (active > MAX_VOICES && !o.force)) return null;
  const t = ctx.currentTime + (o.at || 0);
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const a = o.attack || 0.005, v = o.vol === undefined ? 0.3 : o.vol;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  let n = osc;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter.type; f.frequency.setValueAtTime(o.filter.freq, t); f.Q.value = o.filter.q || 1;
    if (o.filter.to) f.frequency.exponentialRampToValueAtTime(o.filter.to, t + o.dur);
    osc.connect(f); n = f;
  }
  n.connect(g);
  route(g, { wet: o.wet === undefined ? 0.1 : o.wet, dest: o.dest });
  osc.start(t); osc.stop(t + o.dur + 0.05); track(osc);
  return osc;
}

/* o: dur, vol, type, freq, to, q, at, attack, wet, dest, buf */
function noise(o) {
  if (!ctx || (active > MAX_VOICES && !o.force)) return null;
  const t = ctx.currentTime + (o.at || 0);
  const src = ctx.createBufferSource();
  src.buffer = o.buf || whiteBuf;
  const f = ctx.createBiquadFilter();
  f.type = o.type || 'bandpass';
  f.frequency.setValueAtTime(o.freq || 1000, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  f.Q.value = o.q || 1;
  const g = ctx.createGain();
  const a = o.attack || 0.003, v = o.vol === undefined ? 0.3 : o.vol;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f); f.connect(g);
  route(g, { wet: o.wet === undefined ? 0.1 : o.wet, dest: o.dest });
  const maxOff = Math.max(0, src.buffer.duration - o.dur - 0.06);
  src.start(t, Math.random() * maxOff, o.dur + 0.05); track(src);
  return src;
}

/* ---------------------------------------------------------
   Formant voice synth (comic "Wrestling Empire" style shouts)
   --------------------------------------------------------- */
const VOWELS = {
  a: [800, 1150, 2900], e: [560, 1800, 2600], i: [320, 2250, 3000],
  o: [480, 830, 2800], u: [350, 650, 2500], ae: [700, 1500, 2600], uh: [620, 1200, 2600]
};
const PHRASES = {
  objection: [{ v: 'o', dur: 0.13, p: 1.0, ca: 'b' }, { v: 'e', dur: 0.17, p: 1.4, amp: 1.3, cb: 'j', ca: 'k' }, { v: 'uh', dur: 0.32, p: 1.05, cb: 'sh', ca: 'n' }],
  order:     [{ v: 'o', dur: 0.24, p: 1.3, amp: 1.3 }, { v: 'uh', dur: 0.22, p: 0.85, cb: 'd' }],
  overruled: [{ v: 'o', dur: 0.12, p: 1.0 }, { v: 'uh', dur: 0.1, p: 0.95, cb: 'v' }, { v: 'u', dur: 0.3, p: 1.25, amp: 1.2, cb: 'r', ca: 'd' }],
  sustained: [{ v: 'uh', dur: 0.12, p: 1.0, cb: 's' }, { v: 'e', dur: 0.22, p: 1.25, amp: 1.2, cb: 't' }, { v: 'e', dur: 0.2, p: 0.9, cb: 'n', ca: 'd' }],
  granted:   [{ v: 'ae', dur: 0.25, p: 1.3, amp: 1.3, cb: 'k' }, { v: 'uh', dur: 0.24, p: 0.85, cb: 't', ca: 'd' }],
  dismissed: [{ v: 'i', dur: 0.14, p: 1.0, cb: 'd', ca: 's' }, { v: 'i', dur: 0.32, p: 1.3, amp: 1.3, cb: 'm', ca: 't' }],
  hmm:       [{ v: 'uh', dur: 0.35, p: 0.9 }],
  hurt:      [{ v: 'a', dur: 0.16, p: 1.4, amp: 1.2 }, { v: 'o', dur: 0.2, p: 0.8 }]
};

function consonant(type, at, v) {
  switch (type) {
    case 'k': noise({ dur: 0.035, vol: 0.5 * v, type: 'bandpass', freq: 1800, q: 1.2, at, wet: 0.1 }); break;
    case 't': case 'd': noise({ dur: 0.025, vol: 0.45 * v, type: 'bandpass', freq: 3200, q: 1.5, at, wet: 0.1 }); break;
    case 'b': tone({ f: 140, f2: 90, dur: 0.05, vol: 0.3 * v, at, wet: 0.05 }); break;
    case 'sh': noise({ dur: 0.1, vol: 0.4 * v, type: 'bandpass', freq: 3800, q: 0.8, at, wet: 0.1 }); break;
    case 's': noise({ dur: 0.09, vol: 0.3 * v, type: 'highpass', freq: 6000, q: 0.7, at, wet: 0.1 }); break;
    case 'j': noise({ dur: 0.06, vol: 0.35 * v, type: 'bandpass', freq: 3000, q: 1, at, wet: 0.1 }); break;
    case 'v': case 'r': case 'm': case 'n': break;
    default: break;
  }
}

/* syls: array of syllable specs; o: {pitch, rate, vol, at, dest, wet} */
function sayPhrase(syls, o) {
  if (!ctx || active > MAX_VOICES) return 0;
  o = o || {};
  const t0 = ctx.currentTime + (o.at || 0);
  const rate = o.rate || 1, base = o.pitch || 115, v = o.vol === undefined ? 0.45 : o.vol;
  const src = ctx.createOscillator(); src.type = 'sawtooth';
  src.frequency.setValueAtTime(base, t0);
  const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
  const vg = ctx.createGain(); vg.gain.value = base * 0.012;
  vib.connect(vg); vg.connect(src.frequency);
  const out = ctx.createGain(); out.gain.setValueAtTime(0.0001, t0);
  const first = VOWELS[syls[0].v] || VOWELS.a;
  const filters = [0, 1, 2].map(i => {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = [7, 9, 11][i]; f.frequency.setValueAtTime(first[i], t0);
    const g = ctx.createGain(); g.gain.value = [1, 0.55, 0.3][i];
    src.connect(f); f.connect(g); g.connect(out);
    return f;
  });
  let t = t0;
  syls.forEach(s => {
    const d = (s.dur || 0.18) / rate, form = VOWELS[s.v] || VOWELS.a, amp = v * (s.amp || 1);
    if (s.cb) consonant(s.cb, Math.max(0, t - ctx.currentTime - 0.02), v);
    filters.forEach((f, i) => f.frequency.setTargetAtTime(form[i], t, 0.025));
    src.frequency.setTargetAtTime(base * (s.p || 1), t, 0.04);
    out.gain.setTargetAtTime(amp, t, 0.012);
    out.gain.setTargetAtTime(amp * 0.2, t + d * 0.75, 0.03);
    if (s.ca) consonant(s.ca, t + d * 0.85 - ctx.currentTime, v);
    t += d;
  });
  out.gain.setTargetAtTime(0.0001, t, 0.04);
  route(out, { wet: o.wet === undefined ? 0.3 : o.wet, dest: o.dest });
  const end = t + 0.3;
  src.start(t0); vib.start(t0); src.stop(end); vib.stop(end); track(src);
  return (t - t0) * 1000;
}
function say(name, o) {
  if (!init()) return 0;
  const p = PHRASES[name]; if (!p) return 0;
  o = o || {};
  const pitch = o.pitch || (o.female ? 205 : (name === 'order' || name === 'granted' || name === 'dismissed' ? 95 : 118));
  return sayPhrase(p, { pitch, rate: o.rate || 1, vol: o.vol, at: o.at, wet: o.wet });
}
function whisper(dest) {
  const vs = ['a', 'e', 'i', 'o', 'u', 'uh', 'ae'];
  const n = 2 + Math.floor(Math.random() * 3);
  const syls = [];
  for (let i = 0; i < n; i++) syls.push({ v: pickOne(vs), dur: rand(0.09, 0.2), p: rand(0.85, 1.25), cb: Math.random() < 0.4 ? pickOne(['s', 't', 'k']) : undefined });
  sayPhrase(syls, { pitch: rand(95, 230), vol: rand(0.05, 0.1), rate: rand(1.0, 1.5), dest: dest || amb, wet: 0.5 });
}

/* ---------------------------------------------------------
   Sound effects
   --------------------------------------------------------- */
function gavel(strength) {
  if (!init()) return;
  const s = strength || 1;
  noise({ dur: 0.05, vol: 0.75 * s, type: 'bandpass', freq: 2200, q: 1.2, wet: 0.3, force: true });
  tone({ f: 210, f2: 90, type: 'sine', dur: 0.14, vol: 0.85 * s, wet: 0.2, force: true });
  tone({ f: 820, f2: 500, type: 'triangle', dur: 0.06, vol: 0.35 * s, force: true });
  noise({ dur: 0.25, vol: 0.14 * s, type: 'lowpass', freq: 600, at: 0.01, wet: 0.5, force: true });
  haptic(30 + Math.round(20 * s));
}
function gavelCount(n) {
  if (!init()) return;
  gavel(0.75 + 0.2 * n);
  say('order', { at: 0.08, vol: 0.5 + 0.08 * n });
}
/* Returns total duration (ms) so combat.js can time the verdict reveal. */
function verdict(granted) {
  if (!init()) return 0;
  say(granted ? 'granted' : 'dismissed', { at: 0.05, vol: 0.65 });
  gavel(1.3);
  setTimeout(() => { fanfare(granted ? 'win' : 'lose'); crowd(granted ? 'cheer' : 'gasp'); }, 700);
  return 2600;
}
function brass(f, at, dur, v) {
  const fl = { type: 'lowpass', freq: 600, to: 2600, q: 0.8 };
  tone({ f, type: 'sawtooth', dur, vol: v, at, attack: 0.04, wet: 0.35, filter: fl, force: true });
  tone({ f, type: 'sawtooth', dur, vol: v * 0.7, at, attack: 0.05, wet: 0.35, detune: 8, filter: fl, force: true });
}
function fanfare(kind) {
  if (!init()) return;
  const C4 = 261.63, D4 = 293.66, E4 = 329.63, G4 = 392, A4 = 440, C5 = 523.25, E5 = 659.25, G5 = 783.99;
  if (kind === 'lose') {
    const seq = [[233.08, 0, 0.38], [220, 0.4, 0.38], [207.65, 0.8, 0.38]];
    seq.forEach(n => tone({ f: n[0], f2: n[0] * 0.97, type: 'sawtooth', dur: n[2], vol: 0.22, at: n[1], attack: 0.03, wet: 0.3, force: true, filter: { type: 'lowpass', freq: 900, to: 400, q: 2 } }));
    tone({ f: 196, f2: 140, type: 'sawtooth', dur: 1.1, vol: 0.24, at: 1.2, attack: 0.04, wet: 0.35, force: true, filter: { type: 'lowpass', freq: 700, to: 250, q: 2 } });
    return;
  }
  const seq = kind === 'promotion'
    ? [[C4, 0, 0.16], [E4, 0.16, 0.16], [G4, 0.32, 0.16], [C5, 0.48, 0.16], [E5, 0.64, 0.16], [G5, 0.8, 0.9]]
    : [[G4, 0, 0.17], [C5, 0.17, 0.17], [E5, 0.34, 0.17], [G5, 0.51, 0.95]];
  seq.forEach(n => brass(n[0], n[1], n[2], 0.17));
  const last = seq[seq.length - 1][1];
  [C5, E5, G4].forEach(f => brass(f, last, 1.0, 0.1));
  noise({ dur: 1.2, vol: 0.12, type: 'highpass', freq: 5000, at: last, attack: 0.05, wet: 0.4, force: true });
  tone({ f: A4 / 4, f2: A4 / 8, dur: 0.4, vol: 0.5, at: last, force: true });
  haptic(80);
}
function crowd(kind) {
  if (!init()) return;
  if (kind === 'gasp') {
    noise({ dur: 0.6, vol: 0.18, type: 'bandpass', freq: 2500, to: 1200, q: 0.6, attack: 0.15, wet: 0.5, force: true });
  } else {
    noise({ dur: 1.6, vol: 0.2, type: 'bandpass', freq: 1400, q: 0.5, attack: 0.5, wet: 0.5, force: true, buf: brownBuf });
    noise({ dur: 1.4, vol: 0.12, type: 'bandpass', freq: 3000, q: 0.6, attack: 0.4, wet: 0.5, force: true });
    for (let i = 0; i < 5; i++) whisperCheer(i * 0.12);
  }
}
function whisperCheer(at) { sayPhrase([{ v: pickOne(['a', 'o', 'e']), dur: rand(0.3, 0.5), p: rand(1, 1.2) }], { pitch: rand(110, 220), vol: 0.1, at, wet: 0.5 }); }

function footstep(surface, running) {
  if (!init()) return;
  const v = running ? 0.5 : 0.3, k = rand(0.9, 1.1);
  if (surface === 'carpet') {
    noise({ dur: 0.07, vol: 0.18 * v, type: 'lowpass', freq: 350 * k, wet: 0.02 });
  } else if (surface === 'stone') {
    noise({ dur: 0.05, vol: 0.4 * v, type: 'bandpass', freq: 1700 * k, q: 1.5, wet: 0.35 });
    tone({ f: 130 * k, f2: 80, dur: 0.06, vol: 0.25 * v, wet: 0.3 });
  } else {
    noise({ dur: 0.05, vol: 0.4 * v, type: 'bandpass', freq: 900 * k, q: 1.2, wet: 0.2 });
    tone({ f: 120 * k, f2: 65, dur: 0.08, vol: 0.35 * v, wet: 0.15 });
  }
}

const SFX = {
  click:   () => { tone({ f: 900, f2: 600, type: 'square', dur: 0.04, vol: 0.12, wet: 0 }); },
  open:    () => { tone({ f: 400, f2: 700, type: 'triangle', dur: 0.1, vol: 0.18 }); },
  close:   () => { tone({ f: 700, f2: 380, type: 'triangle', dur: 0.1, vol: 0.18 }); },
  correct: () => { tone({ f: 659, type: 'sine', dur: 0.25, vol: 0.28, wet: 0.25 }); tone({ f: 880, type: 'sine', dur: 0.4, vol: 0.28, at: 0.12, wet: 0.25 }); tone({ f: 1318, type: 'sine', dur: 0.5, vol: 0.12, at: 0.12, wet: 0.3 }); haptic(25); },
  wrong:   () => { tone({ f: 140, f2: 100, type: 'sawtooth', dur: 0.3, vol: 0.25, wet: 0.1, filter: { type: 'lowpass', freq: 500, q: 1 } }); haptic([40, 40, 60]); },
  coin:    () => { tone({ f: 1318, type: 'square', dur: 0.08, vol: 0.12, wet: 0.1 }); tone({ f: 1760, type: 'square', dur: 0.22, vol: 0.12, at: 0.07, wet: 0.2 }); },
  pickup:  () => { tone({ f: 500, f2: 1000, type: 'triangle', dur: 0.14, vol: 0.22 }); noise({ dur: 0.08, vol: 0.1, type: 'highpass', freq: 3000 }); },
  paper:   () => { noise({ dur: 0.16, vol: 0.14, type: 'highpass', freq: 3500, to: 7000, wet: 0.1 }); },
  door:    () => { tone({ f: 90, f2: 150, type: 'sawtooth', dur: 0.45, vol: 0.12, wet: 0.3, filter: { type: 'bandpass', freq: 300, to: 700, q: 4 } }); tone({ f: 100, f2: 55, dur: 0.15, vol: 0.4, at: 0.45, wet: 0.2 }); },
  knock:   () => { for (let i = 0; i < 2; i++) { tone({ f: 190, f2: 110, dur: 0.07, vol: 0.5, at: i * 0.15, wet: 0.15 }); noise({ dur: 0.04, vol: 0.2, type: 'bandpass', freq: 1200, at: i * 0.15 }); } },
  stamp:   () => { tone({ f: 150, f2: 55, dur: 0.16, vol: 0.55, wet: 0.2 }); noise({ dur: 0.05, vol: 0.3, type: 'bandpass', freq: 1000, q: 1 }); tone({ f: 1200, type: 'triangle', dur: 0.35, vol: 0.08, at: 0.02, wet: 0.4 }); haptic(25); },
  writ:    () => { SFX.stamp(); noise({ dur: 0.4, vol: 0.1, type: 'highpass', freq: 4500, at: 0.1, attack: 0.1, wet: 0.3 }); },
  swoosh:  () => { noise({ dur: 0.18, vol: 0.2, type: 'bandpass', freq: 400, to: 2200, q: 0.9, attack: 0.05, wet: 0.1 }); },
  argue:   () => { SFX.swoosh(); tone({ f: 170, f2: 75, dur: 0.1, vol: 0.5, at: 0.1, wet: 0.15 }); noise({ dur: 0.06, vol: 0.35, type: 'lowpass', freq: 1500, at: 0.1 }); haptic(20); },
  hit:     () => { tone({ f: 130, f2: 50, dur: 0.18, vol: 0.7, wet: 0.2 }); noise({ dur: 0.08, vol: 0.45, type: 'lowpass', freq: 1800 }); haptic(45); },
  block:   () => { tone({ f: 1500, type: 'triangle', dur: 0.12, vol: 0.2, wet: 0.2 }); tone({ f: 2100, type: 'triangle', dur: 0.1, vol: 0.14, at: 0.01, wet: 0.2 }); },
  hurt:    () => { say('hurt', { vol: 0.5 }); SFX.hit(); },
  ko:      () => { SFX.hit(); say('hurt', { at: 0.05, vol: 0.55, rate: 0.7 }); tone({ f: 90, f2: 40, dur: 0.5, vol: 0.5, at: 0.1, wet: 0.4 }); haptic([60, 30, 90]); },
  tick:    () => { tone({ f: 1600, type: 'square', dur: 0.025, vol: 0.1, wet: 0 }); },
  cheer:   () => { crowd('cheer'); },
  gasp:    () => { crowd('gasp'); },
  objection: o => { say('objection', { vol: 0.7, female: o && o.female }); gavel(0.9); },
  overruled: o => { say('overruled', { vol: 0.65, female: o && o.female }); },
  sustained: o => { say('sustained', { vol: 0.65, female: o && o.female }); },
  promotion: () => { fanfare('promotion'); crowd('cheer'); },
  win:     () => { fanfare('win'); },
  defeat:  () => { fanfare('lose'); },
  gavel:   o => { gavel(o && o.strength); }
};
function play(name, opts) {
  if (!init()) return;
  resume();
  const fn = SFX[name];
  if (fn) { try { fn(opts); } catch (e) { /* never break gameplay for audio */ } }
}

/* ---------------------------------------------------------
   Ambience (per room)
   --------------------------------------------------------- */
const ROOM_AUDIO = {
  courtroom: { tone: 0.35, toneFreq: 450, murmur: 1.0, wet: 0.4,  whisper: [0.7, 2.2], ticks: false, pages: false, hum: false, radio: false },
  library:   { tone: 0.18, toneFreq: 320, murmur: 0.2, wet: 0.2,  whisper: [4, 9],     ticks: true,  pages: true,  hum: false, radio: false },
  thana:     { tone: 0.25, toneFreq: 380, murmur: 0.35, wet: 0.25, whisper: [3, 7],    ticks: false, pages: false, hum: true,  radio: true },
  chambers:  { tone: 0.14, toneFreq: 280, murmur: 0.1, wet: 0.5,  whisper: [6, 12],    ticks: true,  pages: true,  hum: false, radio: false },
  corridor:  { tone: 0.3, toneFreq: 420, murmur: 0.5, wet: 0.55,  whisper: [1.5, 4],   ticks: false, pages: false, hum: false, radio: false }
};
function loopTimer(list, fn, min, max, room) {
  const tick = function () {
    if (currentRoom !== room) return;
    try { fn(); } catch (e) { /* ignore */ }
    const id = setTimeout(tick, rand(min, max) * 1000);
    list.push(id);
  };
  list.push(setTimeout(tick, rand(min, max) * 1000));
}
function startAmbience(room) {
  if (!init()) return;
  if (currentRoom === room) return;
  stopAmbience();
  currentRoom = room;
  const p = ROOM_AUDIO[room] || ROOM_AUDIO.courtroom;
  const t = ctx.currentTime;
  ambBus = ctx.createGain(); ambBus.gain.setValueAtTime(0.0001, t); ambBus.gain.linearRampToValueAtTime(1, t + 1.2); ambBus.connect(amb);
  setReverb(p.wet);

  const base = ctx.createBufferSource(); base.buffer = brownBuf; base.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.toneFreq;
  const g = ctx.createGain(); g.gain.value = p.tone;
  base.connect(lp); lp.connect(g); g.connect(ambBus); base.start(); ambSources.push(base);

  if (p.murmur > 0) {
    const m = ctx.createBufferSource(); m.buffer = whiteBuf; m.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.7;
    const mg = ctx.createGain(); mg.gain.value = 0.05 * p.murmur;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23;
    const lg = ctx.createGain(); lg.gain.value = 0.03 * p.murmur;
    lfo.connect(lg); lg.connect(mg.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
    const lg2 = ctx.createGain(); lg2.gain.value = 180;
    lfo2.connect(lg2); lg2.connect(bp.frequency);
    m.connect(bp); bp.connect(mg); mg.connect(ambBus);
    m.start(); lfo.start(); lfo2.start();
    ambSources.push(m, lfo, lfo2);
  }
  if (p.hum) {
    [100, 50].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i ? 'sine' : 'triangle'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = i ? 0.02 : 0.012;
      o.connect(og); og.connect(ambBus); o.start(); ambSources.push(o);
    });
  }
  const room_ = room;
  if (p.murmur > 0.3 || room === 'courtroom') loopTimer(ambTimers, () => whisper(ambBus), p.whisper[0], p.whisper[1], room_);
  if (p.ticks) {
    let toggle = false;
    loopTimer(ambTimers, () => { toggle = !toggle; noise({ dur: 0.02, vol: toggle ? 0.06 : 0.04, type: 'bandpass', freq: toggle ? 3000 : 2200, q: 3, wet: 0.2, dest: ambBus }); }, 1.0, 1.0, room_);
  }
  if (p.pages) loopTimer(ambTimers, () => noise({ dur: 0.16, vol: 0.06, type: 'highpass', freq: 3500, to: 6500, wet: 0.2, dest: ambBus }), 4, 9, room_);
  if (p.radio) loopTimer(ambTimers, () => { for (let i = 0; i < 6; i++) noise({ dur: 0.03, vol: 0.04, type: 'bandpass', freq: rand(1800, 3500), q: 2, at: i * rand(0.03, 0.08), dest: ambBus }); }, 3, 8, room_);
}
function stopAmbience() {
  currentRoom = null;
  ambTimers.forEach(clearTimeout); ambTimers = [];
  if (!ctx) { ambSources = []; ambBus = null; return; }
  const t = ctx.currentTime, srcs = ambSources, bus = ambBus;
  ambSources = []; ambBus = null;
  if (bus) { bus.gain.cancelScheduledValues(t); bus.gain.setTargetAtTime(0.0001, t, 0.2); }
  setTimeout(() => { srcs.forEach(s => { try { s.stop(); } catch (e) { /* ignore */ } }); try { if (bus) bus.disconnect(); } catch (e) { /* ignore */ } }, 900);
}

/* ---------------------------------------------------------
   Music: tanpura drone (menu) and tabla pulse (fight)
   --------------------------------------------------------- */
function pluck(f, at, v) {
  const fl = { type: 'lowpass', freq: 2600, to: 450, q: 1 };
  tone({ f, type: 'sawtooth', dur: 3.4, vol: v, at, attack: 0.01, wet: 0.45, dest: musicBus, filter: fl, force: true });
  tone({ f: f * 2.004, type: 'triangle', dur: 2.4, vol: v * 0.35, at, wet: 0.45, dest: musicBus, force: true });
}
function startMusic(name) {
  if (!init()) return;
  if (musicName === name) return;
  stopMusic();
  musicName = name;
  musicBus = ctx.createGain(); musicBus.gain.setValueAtTime(0.0001, ctx.currentTime); musicBus.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5); musicBus.connect(music);
  if (name === 'menu') {
    const sa = 130.81, pa = 196.0, saH = 261.63;
    const pattern = [pa, saH, saH, sa / 2];
    let i = 0;
    const step = function () {
      if (musicName !== 'menu') return;
      pluck(pattern[i % 4], 0, i % 4 === 3 ? 0.16 : 0.12);
      i++;
      musicTimers.push(setTimeout(step, 1150));
    };
    step();
    const pad = ctx.createOscillator(); pad.type = 'sine'; pad.frequency.value = sa;
    const pg = ctx.createGain(); pg.gain.value = 0.035; pad.connect(pg); pg.connect(musicBus); pad.start(); musicSources.push(pad);
  } else if (name === 'fight') {
    const bpm = 96, stepDur = 60 / bpm / 2;
    let next = ctx.currentTime + 0.1, stepNo = 0;
    const pad = ctx.createOscillator(); pad.type = 'triangle'; pad.frequency.value = 65.41;
    const pg = ctx.createGain(); pg.gain.value = 0.03; pad.connect(pg); pg.connect(musicBus); pad.start(); musicSources.push(pad);
    const id = setInterval(() => {
      if (musicName !== 'fight' || !ctx) return;
      while (next < ctx.currentTime + 0.25) {
        const at = Math.max(0, next - ctx.currentTime), k = 0.35 + 0.65 * tension, s = stepNo % 8;
        if (s === 0) tone({ f: 95, f2: 52, dur: 0.22, vol: 0.4 * k, at, dest: musicBus, wet: 0.2, force: true });
        else if (s === 4) tone({ f: 80, f2: 48, dur: 0.18, vol: 0.3 * k, at, dest: musicBus, wet: 0.2, force: true });
        else if (s === 6) tone({ f: 420, f2: 360, type: 'triangle', dur: 0.08, vol: 0.1 * k, at, dest: musicBus, force: true });
        if (s % 2 === 1) noise({ dur: 0.03, vol: 0.05 * k, type: 'highpass', freq: 7000, at, dest: musicBus, force: true });
        next += stepDur; stepNo++;
      }
    }, 80);
    musicTimers.push(id);
  }
}
function stopMusic() {
  musicName = null;
  musicTimers.forEach(id => { clearTimeout(id); clearInterval(id); }); musicTimers = [];
  if (!ctx) { musicSources = []; musicBus = null; return; }
  const t = ctx.currentTime, srcs = musicSources, bus = musicBus;
  musicSources = []; musicBus = null;
  if (bus) { bus.gain.cancelScheduledValues(t); bus.gain.setTargetAtTime(0.0001, t, 0.3); }
  setTimeout(() => { srcs.forEach(s => { try { s.stop(); } catch (e) { /* ignore */ } }); try { if (bus) bus.disconnect(); } catch (e) { /* ignore */ } }, 1200);
}
function setTension(v) { tension = Math.max(0, Math.min(1, v)); }

/* ---------------------------------------------------------
   Export + auto-wire to settings
   --------------------------------------------------------- */
SV.Audio = {
  init, unlock, resume, suspend, isReady,
  setMaster, setAmbience, play, say, gavel, gavelCount, verdict, fanfare, crowd, footstep, haptic,
  startAmbience, stopAmbience, startMusic, stopMusic, setTension,
  sfxNames: Object.keys(SFX)
};

unlock();
if (SV.State && SV.State.on) {
  SV.State.on('settings', s => { if (!s) return; setMaster(s.volume); setAmbience(s.ambience); });
}

})(typeof window !== 'undefined' ? window : globalThis);
