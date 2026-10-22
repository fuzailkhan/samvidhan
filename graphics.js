/* =========================================================
   SAMVIDHAN: LEGAL EMPIRE — src/graphics.js
   Three.js engine: low-poly procedural advocate rigs, courtroom
   environments, props, FX, and the 3/4 broadcast camera.
   No external models or textures: everything is generated in code.

   PUBLIC API  (Samvidhan.Graphics)  — see g4_api section at the bottom.
   CONVENTIONS
     • Character forward = (sin ry, cos ry); ry = 0 faces +z.
       A character's RIGHT hand is on -x, LEFT hand on +x.
     • Camera heading h uses the same convention: camera looks along (sin h, cos h).
       Joystick "up" = camera forward, "right" = (-cos h, sin h).
     • Rooms sit far apart in one scene; only the current room is visible.
       All anchors / colliders / bounds returned are in WORLD coordinates.
   ========================================================= */
(function (global) {
'use strict';

const SV = global.Samvidhan = global.Samvidhan || {};
const T = global.THREE;
if (!T) { console.error('[graphics] THREE.js is not loaded'); return; }

const PI = Math.PI, TAU = Math.PI * 2;
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function damp(a, b, k, dt) { return a + (b - a) * (1 - Math.exp(-k * dt)); }
function angDiff(a, b) { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; }
function rnd(a, b) { return a + Math.random() * (b - a); }
function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const SKIN = [0xf1c9a0, 0xe0a878, 0xc68642, 0xa9713f, 0x8d5524, 0x5e3a1e];
const HAIR = [0x0d0d0d, 0x2b1a10, 0x4a3020, 0x7b7b7b, 0xdcdcdc];

/* Rooms are placed far apart; only the current one is visible. */
const ROOM_OFFSET = {
  corridor:  { x: 0,   z: 0 },
  courtroom: { x: -60, z: 0 },
  library:   { x: 60,  z: 0 },
  thana:     { x: 0,   z: -60 },
  chambers:  { x: 0,   z: 60 }
};

const MOODS = {
  corridor:  { bg: 0x2a1a10, hemiSky: 0xfff1d0, hemiGnd: 0x4a3626, hemiI: 0.95, sunI: 0.5,  sun: 0xfff0d8, pt: 0xffd9a0, ptI: 0.45 },
  courtroom: { bg: 0x1d120a, hemiSky: 0xfff0d2, hemiGnd: 0x4a3222, hemiI: 0.9,  sunI: 0.55, sun: 0xfff0d8, pt: 0xffd28a, ptI: 0.55 },
  library:   { bg: 0x1b1209, hemiSky: 0xffe2a8, hemiGnd: 0x3d2a18, hemiI: 0.8,  sunI: 0.35, sun: 0xffe3b0, pt: 0xffc870, ptI: 0.6 },
  thana:     { bg: 0x131a14, hemiSky: 0xe8f2e0, hemiGnd: 0x2f3a2c, hemiI: 0.85, sunI: 0.35, sun: 0xeaf3e6, pt: 0xdfffe0, ptI: 0.4 },
  chambers:  { bg: 0x120f16, hemiSky: 0xfff6e8, hemiGnd: 0x4a4256, hemiI: 1.0,  sunI: 0.55, sun: 0xfff4e0, pt: 0xffe8b8, ptI: 0.55 }
};

/* ---------------------------------------------------------
   Core state
   --------------------------------------------------------- */
const G = {
  renderer: null, scene: null, camera: null, canvas: null, sun: null, hemi: null,
  lowGfx: false, ready: false, time: 0,
  rooms: {}, current: null,
  chars: [], updaters: [], fx: [],
  mood: null, moodT: 1
};

/* ---------------------------------------------------------
   Caches / builders
   --------------------------------------------------------- */
const _mats = {}, _geos = {};
function mat(color, o) {
  o = o || {};
  const key = String(color) + '|' + (o.emissive || '') + '|' + (o.opacity === undefined ? 1 : o.opacity) + '|' + (o.map ? o.map.uuid : '') + '|' + (o.side || 0) + '|' + (o.basic ? 'b' : 'l');
  if (_mats[key]) return _mats[key];
  const p = { color: color };
  if (o.map) p.map = o.map;
  if (o.opacity !== undefined && o.opacity < 1) { p.transparent = true; p.opacity = o.opacity; p.depthWrite = o.depthWrite !== undefined ? o.depthWrite : true; }
  if (o.side) p.side = o.side;
  let m;
  if (o.basic) m = new T.MeshBasicMaterial(p);
  else { if (o.emissive) { p.emissive = new T.Color(o.emissive); } m = new T.MeshLambertMaterial(p); }
  _mats[key] = m;
  return m;
}
function boxGeo(w, h, d) { const k = 'b' + w + ',' + h + ',' + d; return _geos[k] || (_geos[k] = new T.BoxGeometry(w, h, d)); }
function cylGeo(rt, rb, h, s) { const k = 'c' + rt + ',' + rb + ',' + h + ',' + (s || 8); return _geos[k] || (_geos[k] = new T.CylinderGeometry(rt, rb, h, s || 8)); }
function sphGeo(r, ws, hs) { const k = 's' + r + ',' + (ws || 8) + ',' + (hs || 6); return _geos[k] || (_geos[k] = new T.SphereGeometry(r, ws || 8, hs || 6)); }

function M(parent, geo, material, x, y, z, o) {
  const m = new T.Mesh(geo, material);
  m.position.set(x || 0, y || 0, z || 0);
  if (o) {
    if (o.rx) m.rotation.x = o.rx;
    if (o.ry) m.rotation.y = o.ry;
    if (o.rz) m.rotation.z = o.rz;
    m.castShadow = o.cast !== false;
  } else m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
function B(parent, w, h, d, color, x, y, z, o) { return M(parent, boxGeo(w, h, d), mat(color, o), x, y, z, o); }
function C(parent, rt, rb, h, color, x, y, z, o) { return M(parent, cylGeo(rt, rb, h, o && o.seg), mat(color, o), x, y, z, o); }
function S(parent, r, color, x, y, z, o) { return M(parent, sphGeo(r, o && o.ws, o && o.hs), mat(color, o), x, y, z, o); }

/* ---------------------------------------------------------
   Canvas textures + labels (labels re-render when web fonts arrive)
   --------------------------------------------------------- */
function canvasTex(w, h, draw, rx, ry) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c);
  if (rx) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry || rx); }
  return t;
}
function woodTex(rx, ry, base) {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = base || '#8b5e34'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      x.fillStyle = 'rgba(' + (i % 2 ? '255,230,180' : '0,0,0') + ',' + (0.05 + Math.random() * 0.07) + ')';
      x.fillRect(0, i * 32, w, 32);
      x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, i * 32, w, 2);
      for (let k = 0; k < 10; k++) { x.fillStyle = 'rgba(0,0,0,0.07)'; x.fillRect(Math.random() * w, i * 32 + Math.random() * 30, 30 + Math.random() * 90, 1); }
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(Math.random() * w, i * 32, 2, 32);
    }
  }, rx, ry);
}
function checkerTex(rx, ry, c1, c2) {
  return canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = c1; x.fillRect(0, 0, w, h);
    x.fillStyle = c2; x.fillRect(0, 0, w / 2, h / 2); x.fillRect(w / 2, h / 2, w / 2, h / 2);
    for (let i = 0; i < 300; i++) { x.fillStyle = 'rgba(0,0,0,0.04)'; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 2; x.strokeRect(0, 0, w, h);
  }, rx, ry);
}
function concreteTex(rx, ry, base) {
  return canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = base || '#8c8c84'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { x.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '0,0,0' : '255,255,255') + ',0.05)'; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 2; x.strokeRect(0, 0, w, h);
  }, rx, ry);
}
function carpetTex(rx, ry) {
  return canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = '#7a0c1e'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(255,210,31,0.55)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(w / 2, 8); x.lineTo(w - 8, h / 2); x.lineTo(w / 2, h - 8); x.lineTo(8, h / 2); x.closePath(); x.stroke();
    for (let i = 0; i < 400; i++) { x.fillStyle = 'rgba(0,0,0,0.06)'; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }, rx, ry);
}

const _labels = [];
function label(text, o) {
  o = Object.assign({ w: 2, h: 0.5, bg: '#5a3a1e', fg: '#ffd21f', border: '#111', font: 'Bangers, Impact, sans-serif', size: 0, weight: '', stroke: null, align: 'center', lineGap: 1.1, basic: true }, o || {});
  const k = Math.min(1, 1024 / (o.w * 160), 1024 / (o.h * 160));
  const pw = Math.max(64, Math.round(o.w * 160 * k)), ph = Math.max(32, Math.round(o.h * 160 * k));
  const c = document.createElement('canvas'); c.width = pw; c.height = ph;
  const ctx = c.getContext('2d');
  const tex = new T.CanvasTexture(c);
  const st = { text: String(text) };
  function draw() {
    ctx.clearRect(0, 0, pw, ph);
    if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, pw, ph); }
    if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = Math.max(3, ph * 0.05); ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, pw - ctx.lineWidth, ph - ctx.lineWidth); }
    const lines = st.text.split('\n');
    let size = o.size ? o.size * (ph / (o.h * 160)) : Math.min(ph / (lines.length * o.lineGap + 0.35), pw / 6);
    ctx.textBaseline = 'middle'; ctx.textAlign = o.align; ctx.fillStyle = o.fg;
    let widest = 0;
    ctx.font = (o.weight ? o.weight + ' ' : '') + size + 'px ' + o.font;
    lines.forEach(l => { widest = Math.max(widest, ctx.measureText(l).width); });
    const maxW = pw * (o.align === 'center' ? 0.92 : 0.88);
    if (widest > maxW) size *= maxW / widest;
    ctx.font = (o.weight ? o.weight + ' ' : '') + size + 'px ' + o.font;
    const total = lines.length * size * o.lineGap, y0 = ph / 2 - total / 2 + size * o.lineGap / 2;
    const tx = o.align === 'center' ? pw / 2 : o.align === 'left' ? pw * 0.06 : pw * 0.94;
    lines.forEach((l, i) => {
      const yy = y0 + i * size * o.lineGap;
      if (o.stroke) { ctx.lineWidth = Math.max(2, size * 0.12); ctx.strokeStyle = o.stroke; ctx.lineJoin = 'round'; ctx.strokeText(l, tx, yy); }
      ctx.fillText(l, tx, yy);
    });
    tex.needsUpdate = true;
  }
  draw();
  const m = new T.Mesh(new T.PlaneGeometry(o.w, o.h), new T.MeshBasicMaterial({ map: tex, transparent: !o.bg, side: o.double ? T.DoubleSide : T.FrontSide }));
  m.castShadow = false; m.receiveShadow = false;
  m.userData.setText = function (t2) { st.text = String(t2); draw(); };
  _labels.push(draw);
  return m;
}
if (global.document && global.document.fonts && global.document.fonts.ready) {
  global.document.fonts.ready.then(() => { _labels.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } }); });
}

/* ---------------------------------------------------------
   Updaters (fans, flags, pickups...). fn(dt, t) -> true removes it.
   --------------------------------------------------------- */
function addUpdater(fn) { G.updaters.push(fn); return fn; }
function removeUpdater(fn) { const i = G.updaters.indexOf(fn); if (i >= 0) G.updaters.splice(i, 1); }

/* ---------------------------------------------------------
   Particles (pooled, additive Points)
   --------------------------------------------------------- */
const PMAX = 700;
const P = { pos: null, col: null, vel: null, life: null, max: null, base: null, grav: null, drag: null, pts: null, head: 0, size: 0.2 };
function softDotTex() {
  return canvasTex(64, 64, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
}
function initParticles() {
  P.pos = new Float32Array(PMAX * 3); P.col = new Float32Array(PMAX * 3); P.vel = new Float32Array(PMAX * 3);
  P.life = new Float32Array(PMAX); P.max = new Float32Array(PMAX); P.base = new Float32Array(PMAX * 3);
  P.grav = new Float32Array(PMAX); P.drag = new Float32Array(PMAX);
  for (let i = 0; i < PMAX; i++) P.pos[i * 3 + 1] = -999;
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(P.pos, 3));
  geo.setAttribute('color', new T.BufferAttribute(P.col, 3));
  const m = new T.PointsMaterial({ size: 0.26, map: softDotTex(), vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true });
  P.pts = new T.Points(geo, m); P.pts.frustumCulled = false;
  G.scene.add(P.pts);
}
const PK = {
  spark:    { n: 12, sp: [2.5, 6],  life: [0.3, 0.6], grav: 5,   drag: 1.5, cols: [[1, 0.85, 0.2], [1, 0.55, 0.1], [1, 1, 0.7]], up: 0.4 },
  star:     { n: 10, sp: [1.5, 4],  life: [0.4, 0.8], grav: 1,   drag: 2,   cols: [[1, 1, 0.5], [1, 0.9, 0.2]], up: 0.6 },
  paper:    { n: 14, sp: [1, 3.5],  life: [1.0, 1.8], grav: 1.4, drag: 1.6, cols: [[0.95, 0.9, 0.7], [1, 1, 0.9]], up: 1.2 },
  dust:     { n: 6,  sp: [0.3, 1],  life: [0.5, 0.9], grav: -0.1, drag: 2.5, cols: [[0.45, 0.38, 0.3], [0.4, 0.4, 0.36]], up: 0.3 },
  confetti: { n: 40, sp: [2, 6],    life: [1.6, 2.8], grav: 2.4, drag: 1.1, cols: [[1, 0.2, 0.3], [1, 0.85, 0.1], [0.2, 0.8, 0.4], [0.3, 0.6, 1], [1, 0.5, 0.1]], up: 2.2 },
  gold:     { n: 14, sp: [0.8, 2.4], life: [0.7, 1.3], grav: -0.6, drag: 1.8, cols: [[1, 0.8, 0.2], [1, 0.95, 0.5]], up: 1.2 }
};
function burst(x, y, z, kind, count) {
  if (!P.pts) return;
  const k = PK[kind] || PK.spark, n = count || k.n;
  for (let j = 0; j < n; j++) {
    const i = P.head; P.head = (P.head + 1) % PMAX;
    const a = Math.random() * TAU, sp = rnd(k.sp[0], k.sp[1]), c = pickOne(k.cols);
    P.pos[i * 3] = x + rnd(-0.1, 0.1); P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z + rnd(-0.1, 0.1);
    P.vel[i * 3] = Math.cos(a) * sp * 0.7; P.vel[i * 3 + 1] = rnd(0.2, 1) * sp * k.up * 0.5 + (kind === 'confetti' ? rnd(1, k.up * 2) : 0); P.vel[i * 3 + 2] = Math.sin(a) * sp * 0.7;
    P.life[i] = P.max[i] = rnd(k.life[0], k.life[1]);
    P.base[i * 3] = c[0]; P.base[i * 3 + 1] = c[1]; P.base[i * 3 + 2] = c[2];
    P.grav[i] = k.grav; P.drag[i] = k.drag;
  }
}
function updateParticles(dt) {
  if (!P.pts) return;
  let any = false;
  for (let i = 0; i < PMAX; i++) {
    if (P.life[i] <= 0) { if (P.pos[i * 3 + 1] > -900) { P.pos[i * 3 + 1] = -999; P.col[i * 3] = P.col[i * 3 + 1] = P.col[i * 3 + 2] = 0; any = true; } continue; }
    any = true;
    P.life[i] -= dt;
    const d = Math.max(0, 1 - P.drag[i] * dt);
    P.vel[i * 3] *= d; P.vel[i * 3 + 2] *= d; P.vel[i * 3 + 1] = P.vel[i * 3 + 1] * d - P.grav[i] * dt;
    P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
    if (P.pos[i * 3 + 1] < 0.02 && P.grav[i] > 0) { P.pos[i * 3 + 1] = 0.02; P.vel[i * 3 + 1] = 0; P.vel[i * 3] *= 0.6; P.vel[i * 3 + 2] *= 0.6; }
    const f = clamp(P.life[i] / P.max[i], 0, 1), fade = Math.min(1, f * 2.2);
    P.col[i * 3] = P.base[i * 3] * fade; P.col[i * 3 + 1] = P.base[i * 3 + 1] * fade; P.col[i * 3 + 2] = P.base[i * 3 + 2] * fade;
  }
  if (any) { P.pts.geometry.attributes.position.needsUpdate = true; P.pts.geometry.attributes.color.needsUpdate = true; }
}

/* ---------------------------------------------------------
   Popups (floating comic text) + impact stars
   --------------------------------------------------------- */
const _popTex = {};
function popTexture(text, color, stroke) {
  const key = text + '|' + color;
  if (_popTex[key]) return _popTex[key];
  if (Object.keys(_popTex).length > 90) { Object.keys(_popTex).forEach(k => { _popTex[k].tex.dispose(); delete _popTex[k]; }); }
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  const size = 72; ctx.font = size + 'px Bangers, Impact, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 28; c.width = w; c.height = size + 26;
  ctx.font = size + 'px Bangers, Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = 12; ctx.strokeStyle = stroke || '#111'; ctx.strokeText(text, w / 2, c.height / 2 + 2);
  ctx.fillStyle = color; ctx.fillText(text, w / 2, c.height / 2 + 2);
  const tex = new T.CanvasTexture(c);
  return (_popTex[key] = { tex, aspect: c.width / c.height });
}
function popup(text, x, y, z, o) {
  o = o || {};
  const pt = popTexture(String(text), o.color || '#ffd21f', o.stroke);
  const sp = new T.Sprite(new T.SpriteMaterial({ map: pt.tex, transparent: true, depthTest: false, depthWrite: false }));
  const h = (o.size || 0.55);
  sp.scale.set(h * pt.aspect, h, 1); sp.position.set(x, y, z); sp.renderOrder = 50;
  G.scene.add(sp);
  G.fx.push({ kind: 'popup', obj: sp, t: 0, life: o.life || 1.1, vy: o.rise === undefined ? 1.1 : o.rise, base: h, aspect: pt.aspect });
  return sp;
}
let _starTex = null;
function starTexture() {
  if (_starTex) return _starTex;
  _starTex = canvasTex(128, 128, (x, w, h) => {
    x.translate(w / 2, h / 2); x.beginPath();
    for (let i = 0; i < 16; i++) { const r = i % 2 ? 26 : 60, a = i / 16 * TAU; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    x.closePath(); x.fillStyle = '#ffd21f'; x.fill(); x.lineWidth = 7; x.strokeStyle = '#111'; x.stroke();
    x.beginPath();
    for (let i = 0; i < 16; i++) { const r = i % 2 ? 12 : 30, a = i / 16 * TAU; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    x.closePath(); x.fillStyle = '#fff6a8'; x.fill();
  });
  return _starTex;
}
function impact(x, y, z, size) {
  const sp = new T.Sprite(new T.SpriteMaterial({ map: starTexture(), transparent: true, depthTest: false, depthWrite: false, rotation: rnd(-0.5, 0.5) }));
  sp.position.set(x, y, z); sp.scale.set(0.2, 0.2, 1); sp.renderOrder = 49;
  G.scene.add(sp);
  G.fx.push({ kind: 'impact', obj: sp, t: 0, life: 0.3, size: size || 1.2 });
}
function updateFx(dt) {
  for (let i = G.fx.length - 1; i >= 0; i--) {
    const f = G.fx[i]; f.t += dt;
    const u = f.t / f.life;
    if (u >= 1) { G.scene.remove(f.obj); f.obj.material.dispose(); G.fx.splice(i, 1); continue; }
    if (f.kind === 'popup') {
      f.obj.position.y += f.vy * dt * (1 - u * 0.7);
      const pop = u < 0.15 ? 0.4 + u / 0.15 * 0.8 : u < 0.25 ? 1.2 - (u - 0.15) / 0.1 * 0.2 : 1;
      f.obj.scale.set(f.base * f.aspect * pop, f.base * pop, 1);
      f.obj.material.opacity = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
    } else if (f.kind === 'impact') {
      const s = f.size * (u < 0.35 ? 0.2 + u / 0.35 * 0.8 : 1 + (u - 0.35) * 0.3);
      f.obj.scale.set(s, s, 1); f.obj.material.opacity = u > 0.6 ? 1 - (u - 0.6) / 0.4 : 1;
    }
  }
}

/* ---------------------------------------------------------
   Camera (60° FOV, 3/4 trailing broadcast camera)
   --------------------------------------------------------- */
const CAM = {
  mode: 'follow', heading: PI, fov: 60, fovPunch: 0,
  pos: new T.Vector3(0, 2.8, 5), look: new T.Vector3(0, 1.2, 0),
  a: null, b: null, shot: null, bounds: null, autoYaw: true,
  dist: 4.7, height: 2.9, shakeT: 0, shakeDur: 0, shakeAmt: 0, tmp: new T.Vector3(), tmp2: new T.Vector3(), t: 0
};
function chestOf(target, out, h) {
  if (!target) return out.set(0, 1.2, 0);
  if (typeof target.getChest === 'function') return target.getChest(out);
  if (target.position) return out.set(target.position.x, (h || 1.25), target.position.z);
  return out.set(target.x || 0, h || 1.25, target.z || 0);
}
function camPosFor(heading, center, dist, height, out) {
  return out.set(center.x - Math.sin(heading) * dist, height, center.z - Math.cos(heading) * dist);
}
function insideBounds(p) {
  const b = CAM.bounds; if (!b) return true;
  return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
}
function updateCamera(dt) {
  CAM.t += dt;
  const c = CAM, cp = c.tmp, mid = c.tmp2;
  let desiredPos = new T.Vector3(), desiredLook = new T.Vector3();
  let posK = 5, lookK = 8;

  if (c.mode === 'shot' && c.shot) {
    desiredPos.set(c.shot.px, c.shot.py, c.shot.pz); desiredLook.set(c.shot.lx, c.shot.ly, c.shot.lz); posK = 2.5; lookK = 3.5;
  } else if (c.mode === 'follow') {
    chestOf(c.a, cp);
    if (c.autoYaw && c.a && c.a.moveSpeed > 0.8) {
      const diff = angDiff(c.heading, c.a.moveHeading), w = Math.max(0, Math.cos(diff));
      c.heading += clamp(diff, -0.55 * dt, 0.55 * dt) * w;
    }
    camPosFor(c.heading, cp, c.dist, c.height, desiredPos);
    desiredLook.set(cp.x + Math.sin(c.heading) * 0.8, 1.15, cp.z + Math.cos(c.heading) * 0.8);
  } else {
    // two-subject modes: fight / lockup / verdict
    chestOf(c.a, cp); chestOf(c.b || c.a, mid);
    let center, dist, height;
    if (c.mode === 'verdict') {
      center = cp.clone().lerp(mid, 0.25); dist = 2.9; height = 1.75;
      c.heading += 0.09 * dt; posK = 3; lookK = 5;
    } else {
      center = cp.clone().add(mid).multiplyScalar(0.5);
      const sep = Math.hypot(cp.x - mid.x, cp.z - mid.z);
      dx2: {
        const dx = mid.x - cp.x, dz = mid.z - cp.z, len = Math.hypot(dx, dz) || 1;
        const n1 = Math.atan2(-dz / len, dx / len), n2 = Math.atan2(dz / len, -dx / len);
        const cand = [n1, n2].map(h => {
          const p = camPosFor(h, center, c.mode === 'lockup' ? 3.1 : 5, 2.8, new T.Vector3());
          return { h, score: Math.abs(angDiff(c.heading, h)) * 0.4 + (insideBounds(p) ? 0 : 3) + (Math.abs(angDiff(c.heading, h)) < 0.3 ? -0.5 : 0) };
        });
        cand.sort((p, q) => p.score - q.score);
        const want = cand[0].h, d = angDiff(c.heading, want);
        c.heading += clamp(d, -1.3 * dt, 1.3 * dt);
      }
      if (c.mode === 'lockup') { dist = 3.1 + Math.sin(c.t * 1.3) * 0.08; height = 2.05; c.heading += Math.sin(c.t * 0.9) * 0.05 * dt; posK = 4; lookK = 7; }
      else { dist = clamp(3.6 + sep * 0.95, 4.2, 7.6); height = clamp(2.5 + sep * 0.12, 2.5, 3.2); }
    }
    center.y = c.mode === 'verdict' ? 1.0 : 1.15;
    camPosFor(c.heading, center, dist, height, desiredPos);
    desiredLook.copy(center);
  }

  // keep camera inside the room
  if (c.bounds) {
    desiredPos.x = clamp(desiredPos.x, c.bounds.minX, c.bounds.maxX);
    desiredPos.z = clamp(desiredPos.z, c.bounds.minZ, c.bounds.maxZ);
    if (c.bounds.maxY) desiredPos.y = Math.min(desiredPos.y, c.bounds.maxY);
  }
  c.pos.set(damp(c.pos.x, desiredPos.x, posK, dt), damp(c.pos.y, desiredPos.y, posK, dt), damp(c.pos.z, desiredPos.z, posK, dt));
  c.look.set(damp(c.look.x, desiredLook.x, lookK, dt), damp(c.look.y, desiredLook.y, lookK, dt), damp(c.look.z, desiredLook.z, lookK, dt));

  const cam = G.camera;
  cam.position.copy(c.pos);
  if (c.shakeT > 0) {
    c.shakeT -= dt;
    const k = c.shakeAmt * Math.max(0, c.shakeT / c.shakeDur);
    cam.position.x += rnd(-k, k); cam.position.y += rnd(-k, k) * 0.7; cam.position.z += rnd(-k, k);
  }
  cam.lookAt(c.look);
  c.fovPunch = damp(c.fovPunch, 0, 7, dt);
  const f = c.fov + c.fovPunch;
  if (Math.abs(cam.fov - f) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
}
function snapCamera() {
  const dtBig = 5; // run a few big steps so every smoothing term converges
  const oldAuto = CAM.autoYaw; CAM.autoYaw = false;
  for (let i = 0; i < 6; i++) updateCamera(dtBig);
  CAM.autoYaw = oldAuto;
}
function cameraFollow(rig) { CAM.mode = 'follow'; CAM.a = rig; CAM.b = null; }
function cameraFight(a, b) { CAM.mode = 'fight'; CAM.a = a; CAM.b = b; }
function cameraLockup(a, b) { CAM.mode = 'lockup'; CAM.a = a; CAM.b = b; }
function cameraVerdict(target, other) { CAM.mode = 'verdict'; CAM.a = target; CAM.b = other || null; }
function cameraShot(px, py, pz, lx, ly, lz) { CAM.mode = 'shot'; CAM.shot = { px, py, pz, lx, ly, lz }; }
function setCameraHeading(h, snap) { CAM.heading = h; if (snap) snapCamera(); }
function getCameraBasis() {
  const h = CAM.heading, fx = Math.sin(h), fz = Math.cos(h);
  return { heading: h, fx, fz, rx: -fz, rz: fx };
}
function shake(amount, dur) {
  if (global.Samvidhan && global.Samvidhan.State && global.Samvidhan.State.settings && global.Samvidhan.State.settings.shake === false) return;
  CAM.shakeAmt = Math.max(CAM.shakeT > 0 ? CAM.shakeAmt : 0, amount || 0.15); CAM.shakeDur = CAM.shakeT = dur || 0.3;
}
function punchFov(d) { CAM.fovPunch = d; }

/* ---------------------------------------------------------
   Renderer / scene / lights
   --------------------------------------------------------- */
function applyQuality() {
  if (!G.renderer) return;
  const dpr = global.devicePixelRatio || 1;
  G.renderer.setPixelRatio(Math.min(dpr, G.lowGfx ? 1 : 2));
  G.renderer.shadowMap.enabled = !G.lowGfx;
  if (G.sun) G.sun.castShadow = !G.lowGfx;
  Object.keys(_mats).forEach(k => { _mats[k].needsUpdate = true; });
  resize();
}
function setLowGfx(v) { G.lowGfx = !!v; applyQuality(); }

function resize() {
  if (!G.renderer || !G.canvas) return;
  const p = G.canvas.parentNode || G.canvas;
  const w = Math.max(2, p.clientWidth || global.innerWidth), h = Math.max(2, p.clientHeight || global.innerHeight);
  G.renderer.setSize(w, h, false);
  G.camera.aspect = w / h; G.camera.updateProjectionMatrix();
}

function init(canvas, opts) {
  if (G.ready) return true;
  opts = opts || {};
  G.canvas = canvas; G.lowGfx = !!opts.lowGfx;
  try {
    G.renderer = new T.WebGLRenderer({ canvas, antialias: !G.lowGfx, powerPreference: 'high-performance', alpha: false, preserveDrawingBuffer: !!opts.preserve });
  } catch (e) { console.error('[graphics] WebGL unavailable', e); return false; }
  G.renderer.shadowMap.type = T.PCFShadowMap;
  G.scene = new T.Scene();
  G.scene.background = new T.Color(0x1d120a);
  G.scene.fog = new T.Fog(0x1d120a, 14, 46);
  G.camera = new T.PerspectiveCamera(60, 16 / 9, 0.1, 120);
  G.hemi = new T.HemisphereLight(0xfff1d0, 0x4a3626, 0.9); G.scene.add(G.hemi);
  G.sun = new T.DirectionalLight(0xfff0d8, 0.55);
  G.sun.position.set(6, 12, 4);
  G.sun.castShadow = !G.lowGfx;
  G.sun.shadow.mapSize.set(1024, 1024);
  const sc = G.sun.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 0.5; sc.far = 40;
  G.sun.shadow.bias = -0.0008;
  G.scene.add(G.sun); G.scene.add(G.sun.target);
  initParticles();
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); });
  global.addEventListener('resize', resize);
  global.addEventListener('orientationchange', () => setTimeout(resize, 250));
  applyQuality();
  G.ready = true;
  return true;
}

function setMood(id, instant) {
  const m = MOODS[id] || MOODS.courtroom;
  if (!G.mood || instant) {
    G.mood = {
      bg: new T.Color(m.bg), sky: new T.Color(m.hemiSky), gnd: new T.Color(m.hemiGnd), sun: new T.Color(m.sun),
      hemiI: m.hemiI, sunI: m.sunI, pt: new T.Color(m.pt), ptI: m.ptI
    };
    applyMood(); return;
  }
  G.moodTarget = m;
}
function applyMood() {
  const m = G.mood;
  G.scene.background.copy(m.bg); G.scene.fog.color.copy(m.bg);
  G.hemi.color.copy(m.sky); G.hemi.groundColor.copy(m.gnd); G.hemi.intensity = m.hemiI;
  G.sun.color.copy(m.sun); G.sun.intensity = m.sunI;
  const r = G.rooms[G.current];
  if (r && r.light) { r.light.color.copy(m.pt); r.light.intensity = m.ptI; }
}
function updateMood(dt) {
  if (!G.moodTarget || !G.mood) return;
  const t = G.moodTarget, m = G.mood, k = 1 - Math.exp(-5 * dt);
  m.bg.lerp(new T.Color(t.bg), k); m.sky.lerp(new T.Color(t.hemiSky), k); m.gnd.lerp(new T.Color(t.hemiGnd), k); m.sun.lerp(new T.Color(t.sun), k); m.pt.lerp(new T.Color(t.pt), k);
  m.hemiI = lerp(m.hemiI, t.hemiI, k); m.sunI = lerp(m.sunI, t.sunI, k); m.ptI = lerp(m.ptI, t.ptI, k);
  applyMood();
}

/* =========================================================
   PROPS
   ========================================================= */
function makeProp(type, o) {
  o = o || {};
  const g = new T.Group();
  switch (type) {
    case 'gavel':
      C(g, 0.022, 0.022, 0.34, '#6b4220', 0, 0.17, 0, { seg: 6 });
      B(g, 0.07, 0.09, 0.15, '#3a2411', 0, 0.36, 0);
      B(g, 0.075, 0.095, 0.02, '#c9a227', 0, 0.36, 0.062); B(g, 0.075, 0.095, 0.02, '#c9a227', 0, 0.36, -0.062);
      break;
    case 'brief':
      B(g, 0.3, 0.05, 0.38, '#e8dcc0', 0, 0, 0);
      B(g, 0.31, 0.012, 0.05, '#b3122b', 0, 0.03, 0.05); B(g, 0.05, 0.012, 0.39, '#b3122b', 0, 0.03, 0);
      break;
    case 'book': {
      const col = o.color || '#1b2a5c';
      B(g, 0.22, 0.06, 0.3, col, 0, 0, 0);
      B(g, 0.2, 0.045, 0.28, '#f3ead2', 0.012, 0, 0.0);
      B(g, 0.225, 0.065, 0.02, col, -0.0, 0, -0.14);
      B(g, 0.1, 0.012, 0.08, '#ffd21f', 0, 0.034, 0.05, { cast: false });
      break;
    }
    case 'file':
      B(g, 0.32, 0.09, 0.42, '#7a0c1e', 0, 0, 0);
      B(g, 0.3, 0.07, 0.4, '#f3ead2', 0.01, 0, 0);
      B(g, 0.12, 0.012, 0.1, '#ffd21f', 0, 0.05, 0.06, { cast: false });
      break;
    case 'paper':
      B(g, 0.24, 0.006, 0.32, '#fffdf2', 0, 0, 0, { cast: false });
      break;
    case 'scales':
      C(g, 0.03, 0.05, 0.5, '#c9a227', 0, 0.25, 0, { seg: 6 });
      B(g, 0.6, 0.03, 0.04, '#c9a227', 0, 0.52, 0);
      C(g, 0.12, 0.1, 0.03, '#c9a227', -0.27, 0.34, 0, { seg: 8 }); C(g, 0.12, 0.1, 0.03, '#c9a227', 0.27, 0.34, 0, { seg: 8 });
      B(g, 0.01, 0.18, 0.01, '#c9a227', -0.27, 0.43, 0, { cast: false }); B(g, 0.01, 0.18, 0.01, '#c9a227', 0.27, 0.43, 0, { cast: false });
      break;
    case 'lathi':
      C(g, 0.022, 0.026, 1.0, '#7a4a22', 0, 0.5, 0, { seg: 6 });
      break;
    case 'phone':
      B(g, 0.07, 0.01, 0.14, '#111', 0, 0, 0); B(g, 0.06, 0.012, 0.12, '#3a8fd8', 0, 0, 0, { cast: false });
      break;
    case 'mug':
      C(g, 0.04, 0.035, 0.08, '#f2f2f2', 0, 0.04, 0, { seg: 8 });
      break;
    case 'laptop':
      B(g, 0.34, 0.02, 0.24, '#2b2b2b', 0, 0, 0); B(g, 0.34, 0.22, 0.02, '#2b2b2b', 0, 0.11, -0.12, { rx: -0.2 });
      B(g, 0.3, 0.18, 0.005, '#7fc4ff', 0, 0.11, -0.108, { rx: -0.2, cast: false });
      break;
    case 'cuffs':
      C(g, 0.05, 0.05, 0.01, '#9a9a9a', -0.05, 0, 0, { seg: 8 }); C(g, 0.05, 0.05, 0.01, '#9a9a9a', 0.05, 0, 0, { seg: 8 });
      break;
    default:
      B(g, 0.15, 0.15, 0.15, '#ffd21f', 0, 0, 0);
  }
  return g;
}

/* =========================================================
   CHARACTER RIGS
   ========================================================= */
const HIP_Y = 0.93;
const CH = ['hipY', 'leanX', 'twistY', 'tiltZ', 'headX', 'headY', 'legLX', 'legRX', 'legLZ', 'legRZ', 'kneeLX', 'kneeRX', 'armLX', 'armRX', 'armLZ', 'armRZ', 'elbLX', 'elbRX', 'bodyRX', 'bodyY'];
function basePose() { const p = {}; CH.forEach(c => { p[c] = 0; }); p.hipY = HIP_Y; return p; }

/* Absolute-value keyframe overlays. Each key: [u, weight, {channel: value}] */
const OVERLAYS = {
  argue: { dur: 0.46, keys: [
    [0, 0, {}],
    [0.2, 1, { armRX: 0.7, elbRX: 1.3, twistY: 0.5, leanX: -0.12, armRZ: -0.2 }],
    [0.4, 1, { armRX: -1.65, elbRX: 0.15, twistY: -0.45, leanX: 0.3, armRZ: -0.1 }],
    [0.72, 0.8, { armRX: -1.5, elbRX: 0.2, twistY: -0.3, leanX: 0.25 }],
    [1, 0, {}] ] },
  cite: { dur: 1.0, keys: [
    [0, 0, {}],
    [0.25, 1, { armRX: -2.95, elbRX: 0.25, armRZ: -0.3, headX: -0.22, leanX: -0.1, armLX: -1.0, elbLX: 1.6 }],
    [0.5, 1, { armRX: -3.0, elbRX: 0.2, armRZ: -0.3, headX: -0.25, leanX: -0.12, armLX: -1.0, elbLX: 1.6 }],
    [0.64, 1, { armRX: -1.55, elbRX: 0.1, leanX: 0.32, headX: 0.05, armLX: -1.0, elbLX: 1.6 }],
    [0.86, 0.8, { armRX: -1.5, leanX: 0.25 }],
    [1, 0, {}] ] },
  hit: { dur: 0.5, keys: [
    [0, 0, {}],
    [0.12, 1, { leanX: -0.5, headX: -0.4, hipY: HIP_Y - 0.06, armLX: 0.4, armRX: 0.4, armLZ: 0.5, armRZ: -0.5 }],
    [0.5, 0.6, { leanX: -0.2, headX: -0.15 }],
    [1, 0, {}] ] },
  block: { dur: 0.6, keys: [
    [0, 0, {}],
    [0.15, 1, { armLX: -1.5, armRX: -1.5, elbLX: 1.9, elbRX: 1.9, armLZ: -0.45, armRZ: 0.45, leanX: 0.15, headX: 0.2 }],
    [0.75, 1, { armLX: -1.5, armRX: -1.5, elbLX: 1.9, elbRX: 1.9, armLZ: -0.45, armRZ: 0.45, leanX: 0.15, headX: 0.2 }],
    [1, 0, {}] ] },
  taunt: { dur: 0.95, keys: [
    [0, 0, {}],
    [0.2, 1, { armRX: -1.57, armRZ: -0.1, elbRX: 0.05, headX: -0.1, leanX: 0.1 }],
    [0.5, 1, { armRX: -1.35, armRZ: -0.1, elbRX: 0.1, headX: -0.15, leanX: 0.12 }],
    [0.8, 1, { armRX: -1.57, armRZ: -0.1, elbRX: 0.05, headX: -0.1, leanX: 0.1 }],
    [1, 0, {}] ] },
  objection: { dur: 0.8, keys: [
    [0, 0, {}],
    [0.2, 1, { armRX: -3.0, elbRX: 0.1, leanX: -0.15, headX: -0.2, armRZ: -0.15 }],
    [0.5, 1, { armRX: -3.05, elbRX: 0.1, leanX: -0.18, headX: -0.22 }],
    [0.62, 1, { armRX: -1.25, elbRX: 0.1, leanX: 0.35, headX: 0.05 }],
    [0.86, 0.6, { armRX: -1.2, leanX: 0.25 }],
    [1, 0, {}] ] },
  gavel: { dur: 0.6, keys: [
    [0, 0, {}],
    [0.22, 1, { armRX: -2.5, elbRX: 1.0, leanX: -0.05 }],
    [0.38, 1, { armRX: -1.05, elbRX: 0.35, leanX: 0.12 }],
    [0.55, 0.9, { armRX: -0.95, elbRX: 0.35, leanX: 0.1 }],
    [1, 0, {}] ] },
  throw: { dur: 0.85, keys: [
    [0, 0, {}],
    [0.25, 1, { twistY: 0.9, armRX: -0.7, armLX: -0.7, armRZ: -0.7, armLZ: 0.7, leanX: 0.2, elbRX: 0.8, elbLX: 0.8 }],
    [0.5, 1, { twistY: -0.9, armRX: -1.5, armLX: -1.5, leanX: 0.36, elbRX: 0.3, elbLX: 0.3 }],
    [0.78, 0.5, { twistY: -0.4, leanX: 0.2 }],
    [1, 0, {}] ] },
  stagger: { dur: 0.85, keys: [
    [0, 0, {}],
    [0.15, 1, { leanX: -0.35, tiltZ: 0.2, headX: -0.3 }],
    [0.4, 1, { tiltZ: -0.2, leanX: -0.15, headX: -0.1 }],
    [0.7, 0.6, { tiltZ: 0.1 }],
    [1, 0, {}] ] },
  nod: { dur: 0.5, keys: [[0, 0, {}], [0.3, 1, { headX: 0.4 }], [0.6, 1, { headX: -0.05 }], [1, 0, {}]] },
  shrug: { dur: 0.8, keys: [[0, 0, {}], [0.3, 1, { armLX: -0.5, armRX: -0.5, armLZ: 0.5, armRZ: -0.5, elbLX: 1.3, elbRX: 1.3, headX: -0.1 }], [0.7, 1, { armLX: -0.5, armRX: -0.5, armLZ: 0.5, armRZ: -0.5, elbLX: 1.3, elbRX: 1.3 }], [1, 0, {}]] },
  writ: { dur: 1.1, keys: [
    [0, 0, {}],
    [0.3, 1, { armRX: -2.3, elbRX: 0.5, armLX: -0.9, elbLX: 1.4, headX: -0.15, leanX: -0.05 }],
    [0.7, 1, { armRX: -2.3, elbRX: 0.5, armLX: -0.9, elbLX: 1.4, headX: -0.15 }],
    [1, 0, {}] ] }
};
function overlayEval(def, u, out) {
  const ks = def.keys;
  let i = 0; while (i < ks.length - 2 && u > ks[i + 1][0]) i++;
  const a = ks[i], b = ks[i + 1], k = clamp((u - a[0]) / Math.max(1e-4, b[0] - a[0]), 0, 1), s = k * k * (3 - 2 * k);
  const w = lerp(a[1], b[1], s);
  const chans = {};
  Object.keys(a[2]).forEach(c => { chans[c] = 1; }); Object.keys(b[2]).forEach(c => { chans[c] = 1; });
  Object.keys(chans).forEach(c => {
    const va = a[2][c] !== undefined ? a[2][c] : (b[2][c] !== undefined ? b[2][c] : 0);
    const vb = b[2][c] !== undefined ? b[2][c] : va;
    out[c] = lerp(va, vb, s);
  });
  return w;
}

const POSE = {
  idle: function (p, r) {
    const t = r.t;
    p.leanX = Math.sin(t * 1.6) * 0.015; p.armLX = Math.sin(t * 1.4) * 0.05 + 0.02; p.armRX = -Math.sin(t * 1.4 + 0.6) * 0.05 + 0.02;
    p.armLZ = 0.09; p.armRZ = -0.09; p.elbLX = 0.15; p.elbRX = 0.15; p.legLZ = 0.02; p.legRZ = -0.02;
    p.headY = Math.sin(t * 0.5) * 0.06; p.hipY = HIP_Y + Math.sin(t * 1.6) * 0.004;
  },
  walk: function (p, r, dt) {
    r.phase += dt * Math.min(r.speed, 6) * 2.3;
    const s = Math.sin(r.phase), c = Math.cos(r.phase), amp = clamp(0.2 + r.speed * 0.1, 0.25, 0.62);
    p.legLX = s * amp; p.legRX = -s * amp;
    p.kneeLX = Math.max(0, -c) * amp * 1.3; p.kneeRX = Math.max(0, c) * amp * 1.3;
    p.armLX = -s * amp * 0.9; p.armRX = s * amp * 0.9; p.elbLX = 0.25; p.elbRX = 0.25;
    p.armLZ = 0.07; p.armRZ = -0.07;
    p.hipY = HIP_Y - 0.03 + Math.abs(s) * 0.035; p.twistY = s * 0.1; p.leanX = 0.06;
  },
  run: function (p, r, dt) {
    r.phase += dt * Math.min(r.speed, 8) * 1.9;
    const s = Math.sin(r.phase), c = Math.cos(r.phase), amp = 0.85;
    p.legLX = s * amp; p.legRX = -s * amp;
    p.kneeLX = Math.max(0, -c) * 1.5; p.kneeRX = Math.max(0, c) * 1.5;
    p.armLX = -s * 1.0; p.armRX = s * 1.0; p.elbLX = 1.15; p.elbRX = 1.15;
    p.armLZ = 0.05; p.armRZ = -0.05;
    p.hipY = HIP_Y - 0.07 + Math.abs(s) * 0.06; p.twistY = s * 0.16; p.leanX = 0.24;
  },
  sit: function (p, r) {
    const t = r.t;
    p.hipY = 0.5; p.legLX = -1.5; p.legRX = -1.5; p.kneeLX = 1.5; p.kneeRX = 1.5;
    p.legLZ = 0.05; p.legRZ = -0.05;
    p.armLX = -0.6 + Math.sin(t * 1.2) * 0.02; p.armRX = -0.6; p.elbLX = 1.0; p.elbRX = 1.0; p.armLZ = 0.1; p.armRZ = -0.1;
    p.leanX = 0.03 + Math.sin(t * 1.5) * 0.01; p.headY = Math.sin(t * 0.4) * 0.1;
  },
  ko: function (p, r) {
    p.bodyRX = -PI / 2; p.bodyY = 0.14; p.hipY = HIP_Y - 0.05;
    p.armLZ = 0.7; p.armRZ = -0.7; p.armLX = 0.1; p.armRX = 0.1; p.legLZ = 0.2; p.legRZ = -0.2; p.headX = -0.1; p.headY = 0.3;
  },
  lockup: function (p, r) {
    const t = r.t;
    p.hipY = HIP_Y - 0.15; p.legLX = -0.5; p.legRX = 0.35; p.kneeLX = 0.75; p.kneeRX = 0.55;
    p.leanX = 0.36; p.armLX = -1.25; p.armRX = -1.25; p.elbLX = 0.6; p.elbRX = 0.6; p.armLZ = -0.15; p.armRZ = 0.15;
    p.twistY = Math.sin(t * 17) * 0.06; p.headX = -0.2; p.tiltZ = Math.sin(t * 9) * 0.03;
  },
  celebrate: function (p, r) {
    const t = r.t;
    p.armLX = -2.9 + Math.sin(t * 9) * 0.25; p.armRX = -2.9 + Math.sin(t * 9 + 1.5) * 0.25; p.armLZ = 0.3; p.armRZ = -0.3;
    p.elbLX = 0.2; p.elbRX = 0.2; p.hipY = HIP_Y + Math.abs(Math.sin(t * 7)) * 0.08; p.headX = -0.3; p.leanX = -0.05;
    p.legLX = Math.sin(t * 7) * 0.12; p.legRX = -Math.sin(t * 7) * 0.12;
  },
  defeated: function (p, r) {
    const t = r.t;
    p.leanX = 0.38 + Math.sin(t * 1.2) * 0.01; p.headX = 0.55; p.armLX = 0.12; p.armRX = 0.12; p.armLZ = 0.08; p.armRZ = -0.08;
    p.hipY = HIP_Y - 0.04; p.kneeLX = 0.1; p.kneeRX = 0.1;
  }
};

function createCharacter(opt) {
  const o = Object.assign({
    role: 'advocate', outfit: null, female: false, build: 'avg', height: 1, skin: 1, hair: 0, robe: '#141414',
    shirt: '#e8e8e8', pants: '#2a2a32', uniform: '#7a6a3c', name: '', senior: false, glasses: false, beard: false, trim: null
  }, opt || {});
  const outfit = o.outfit || ({ police: 'police', detainee: 'civil', civilian: 'civil', witness: 'civil', clerk: 'clerk' }[o.role] || 'robe');
  const wS = (o.build === 'slim' ? 0.92 : o.build === 'broad' ? 1.12 : 1) * (o.female ? 0.9 : 1);
  const sc = 0.92 * o.height * (o.female ? 0.96 : 1);
  const skin = SKIN[((o.skin % SKIN.length) + SKIN.length) % SKIN.length];
  const hairC = HAIR[((o.hair % HAIR.length) + HAIR.length) % HAIR.length];
  const robeC = o.robe, shoe = '#161616';
  const isRobe = outfit === 'robe', isPolice = outfit === 'police', isClerk = outfit === 'clerk';
  const sleeveC = isRobe ? robeC : isPolice ? o.uniform : isClerk ? '#f2f2f2' : o.shirt;
  const trousC = isPolice ? '#5e5230' : o.pants;

  const group = new T.Group();
  const blob = M(group, new T.CircleGeometry(0.5, 16), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: G.lowGfx ? 0.35 : 0.18, depthWrite: false }), 0, 0.025, 0, { rx: -PI / 2, cast: false });
  blob.receiveShadow = false;
  const ring = M(group, new T.RingGeometry(0.6, 0.76, 28), new T.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.9, depthWrite: false, side: T.DoubleSide }), 0, 0.04, 0, { rx: -PI / 2, cast: false });
  ring.visible = false; ring.receiveShadow = false;

  const body = new T.Group(); body.scale.setScalar(sc); group.add(body);
  const hips = new T.Group(); hips.position.y = HIP_Y; body.add(hips);
  B(hips, 0.42 * wS, 0.18, 0.26, trousC, 0, 0.02, 0);

  function leg(side) {
    const x = side * 0.115 * wS;
    const lg = new T.Group(); lg.position.set(x, -0.03, 0); hips.add(lg);
    B(lg, 0.15 * wS, 0.46, 0.17, trousC, 0, -0.23, 0);
    const knee = new T.Group(); knee.position.y = -0.46; lg.add(knee);
    B(knee, 0.13 * wS, 0.42, 0.14, trousC, 0, -0.21, 0);
    B(knee, 0.15 * wS, 0.08, 0.26, shoe, 0, -0.44, 0.05);
    return { lg, knee };
  }
  const L = leg(1), R = leg(-1);

  if (isRobe) {
    const skirt = new T.Mesh(cylGeo(0.26 * wS, 0.34 * wS, 0.8, 6), mat(robeC));
    skirt.position.set(0, -0.34, 0); skirt.castShadow = true; skirt.receiveShadow = true; skirt.rotation.y = PI / 6; hips.add(skirt);
    if (o.trim) B(hips, 0.5 * wS, 0.03, 0.3, o.trim, 0, -0.73, 0, { cast: false });
  }

  const torso = new T.Group(); torso.position.y = 0.1; hips.add(torso);
  const chestW = 0.5 * wS;
  B(torso, chestW, 0.58, 0.28, isRobe ? robeC : isPolice ? o.uniform : isClerk ? '#f4f4f4' : o.shirt, 0, 0.3, 0);
  if (isRobe) {
    B(torso, 0.17, 0.3, 0.012, '#f2f2f2', 0, 0.44, 0.146, { cast: false });           // shirt V
    B(torso, 0.05, 0.19, 0.016, '#ffffff', -0.045, 0.43, 0.155, { cast: false });      // neck bands
    B(torso, 0.05, 0.19, 0.016, '#ffffff', 0.045, 0.43, 0.155, { cast: false });
    B(torso, 0.03, 0.54, 0.014, '#0a0a0a', -0.115, 0.3, 0.147, { cast: false });
    B(torso, 0.03, 0.54, 0.014, '#0a0a0a', 0.115, 0.3, 0.147, { cast: false });
    if (o.trim) { B(torso, 0.04, 0.5, 0.016, o.trim, -0.2, 0.3, 0.148, { cast: false }); B(torso, 0.04, 0.5, 0.016, o.trim, 0.2, 0.3, 0.148, { cast: false }); }
  } else if (isPolice) {
    B(torso, chestW + 0.02, 0.06, 0.3, '#3a2411', 0, 0.04, 0);
    B(torso, 0.04, 0.06, 0.02, '#c9a227', 0.0, 0.04, 0.155, { cast: false });
    B(torso, 0.07, 0.07, 0.012, '#c9a227', 0.12, 0.42, 0.146, { cast: false });
    B(torso, 0.1, 0.03, 0.2, '#c9a227', 0.22 * wS, 0.58, 0, { cast: false }); B(torso, 0.1, 0.03, 0.2, '#c9a227', -0.22 * wS, 0.58, 0, { cast: false });
    B(torso, 0.16, 0.12, 0.012, '#6a5c34', -0.1, 0.38, 0.146, { cast: false });
  } else if (isClerk) {
    B(torso, chestW + 0.01, 0.4, 0.3, '#1b1b1b', 0, 0.22, 0);
    B(torso, 0.06, 0.12, 0.016, '#b3122b', 0, 0.46, 0.15, { cast: false });
  } else {
    B(torso, 0.1, 0.2, 0.012, skin, 0, 0.5, 0.146, { cast: false });
  }

  function arm(side) {
    const sx = side * (chestW / 2 + 0.065);
    const sh = new T.Group(); sh.position.set(sx, 0.52, 0); torso.add(sh);
    B(sh, 0.13, 0.3, 0.13, sleeveC, 0, -0.14, 0);
    const el = new T.Group(); el.position.y = -0.29; sh.add(el);
    B(el, 0.115, 0.27, 0.115, sleeveC, 0, -0.13, 0);
    const hand = new T.Group(); hand.position.y = -0.3; el.add(hand);
    B(hand, 0.1, 0.1, 0.1, skin, 0, -0.02, 0);
    const slot = new T.Group(); slot.position.set(0, -0.06, 0.03); slot.rotation.x = -1.3; hand.add(slot);
    return { sh, el, slot };
  }
  const AL = arm(1), AR = arm(-1);

  const neck = new T.Group(); neck.position.y = 0.6; torso.add(neck);
  C(neck, 0.06, 0.07, 0.1, skin, 0, 0.0, 0, { seg: 6 });
  const head = new T.Group(); head.position.y = 0.04; neck.add(head);
  B(head, 0.27, 0.3, 0.27, skin, 0, 0.2, 0);
  B(head, 0.04, 0.08, 0.04, skin, -0.145, 0.2, 0); B(head, 0.04, 0.08, 0.04, skin, 0.145, 0.2, 0);
  B(head, 0.05, 0.07, 0.05, skin, 0, 0.17, 0.15, { cast: false });
  // hair
  if (outfit === 'police') {
    B(head, 0.3, 0.1, 0.3, '#6a5c34', 0, 0.37, 0); B(head, 0.3, 0.025, 0.14, '#241c0c', 0, 0.335, 0.2); B(head, 0.05, 0.05, 0.012, '#c9a227', 0, 0.38, 0.155, { cast: false });
    B(head, 0.28, 0.08, 0.04, hairC, 0, 0.27, -0.14);
  } else {
    B(head, 0.29, 0.09, 0.29, hairC, 0, 0.375, 0);
    B(head, 0.29, 0.2, 0.06, hairC, 0, 0.28, -0.12);
    B(head, 0.03, 0.1, 0.22, hairC, -0.145, 0.31, -0.02); B(head, 0.03, 0.1, 0.22, hairC, 0.145, 0.31, -0.02);
    if (o.female) { B(head, 0.3, 0.38, 0.1, hairC, 0, 0.12, -0.14); B(head, 0.1, 0.1, 0.1, hairC, 0, 0.42, -0.1); }
  }
  // face
  const eyeL = B(head, 0.045, 0.05, 0.012, '#111', 0.07, 0.235, 0.138, { cast: false });
  const eyeR = B(head, 0.045, 0.05, 0.012, '#111', -0.07, 0.235, 0.138, { cast: false });
  B(head, 0.08, 0.018, 0.012, hairC, 0.07, 0.275, 0.139, { cast: false }); B(head, 0.08, 0.018, 0.012, hairC, -0.07, 0.275, 0.139, { cast: false });
  const jaw = B(head, 0.1, 0.03, 0.014, '#7a2a2a', 0, 0.115, 0.138, { cast: false });
  if (o.beard) B(head, 0.27, 0.1, 0.05, hairC, 0, 0.1, 0.12, { cast: false });
  if (o.glasses || o.senior) {
    B(head, 0.105, 0.075, 0.01, '#222', 0.07, 0.235, 0.147, { opacity: 0.4, cast: false }); B(head, 0.105, 0.075, 0.01, '#222', -0.07, 0.235, 0.147, { opacity: 0.4, cast: false });
    B(head, 0.04, 0.01, 0.01, '#222', 0, 0.245, 0.148, { cast: false });
  }
  if (isRobe && o.role === 'judge') B(torso, 0.1, 0.12, 0.012, '#c9a227', 0.12, 0.44, 0.158, { cast: false });

  const rig = {
    isRig: true, group, body, role: o.role, name: o.name, look: o, height: sc, outfit,
    state: 'auto', phase: Math.random() * 6, t: Math.random() * 10, speed: 0, moveSpeed: 0, moveHeading: 0,
    overlay: null, talkT: 0, blinkT: rnd(2, 5), lookTarget: null, tag: null, targeted: false,
    p: basePose(), held: { R: null, L: null }, _last: null, userData: {}
  };
  rig.joints = { hips, torso, head, legL: L.lg, legR: R.lg, kneeL: L.knee, kneeR: R.knee, armL: AL.sh, armR: AR.sh, elbL: AL.el, elbR: AR.el, jaw, eyeL, eyeR };
  rig.slots = { R: AR.slot, L: AL.slot };

  rig.setState = function (s) { rig.state = s || 'auto'; };
  rig.play = function (name, opts) {
    const def = OVERLAYS[name]; if (!def) return 0;
    const sp = (opts && opts.speed) || 1;
    rig.overlay = { def, t: 0, speed: sp, name };
    return (def.dur / sp) * 1000;
  };
  rig.isPlaying = function (name) { return !!rig.overlay && (!name || rig.overlay.name === name); };
  rig.hold = function (type, hand, popts) {
    const side = hand === 'L' ? 'L' : 'R';
    if (rig.held[side]) { rig.slots[side].remove(rig.held[side]); rig.held[side] = null; }
    if (type) { const pr = makeProp(type, popts); rig.slots[side].add(pr); rig.held[side] = pr; }
    return rig.held[side];
  };
  rig.talk = function (seconds) { rig.talkT = Math.max(rig.talkT, seconds || 0.6); };
  rig.lookAt = function (x, z) { rig.lookTarget = (x === null || x === undefined) ? null : { x, z }; };
  rig.setFacing = function (ry) { group.rotation.y = ry; };
  rig.faceToward = function (x, z) { const dx = x - group.position.x, dz = z - group.position.z; if (dx * dx + dz * dz > 1e-6) group.rotation.y = Math.atan2(dx, dz); };
  rig.turnToward = function (ry, dt, rate) {
    const d = angDiff(group.rotation.y, ry), step = (rate || 10) * dt;
    group.rotation.y += clamp(d, -step, step);
    return Math.abs(d);
  };
  rig.setPosition = function (x, y, z) { group.position.set(x, y || 0, z); rig._last = null; };
  rig.getChest = function (out) { return out.set(group.position.x, group.position.y + 1.25 * sc, group.position.z); };
  rig.setTargeted = function (v) { rig.targeted = !!v; ring.visible = !!v; };
  rig.setNameTag = function (text, sub) {
    if (rig.tag) { group.remove(rig.tag); rig.tag.material.map.dispose(); rig.tag.material.dispose(); rig.tag = null; }
    if (!text) return;
    const c = document.createElement('canvas'), ctx = c.getContext('2d');
    c.width = 384; c.height = sub ? 96 : 64;
    ctx.font = '34px Bangers, Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 8; ctx.strokeStyle = '#111'; ctx.strokeText(text, 192, 24); ctx.fillStyle = '#ffd21f'; ctx.fillText(text, 192, 24);
    if (sub) { ctx.font = '600 22px Oswald, Arial, sans-serif'; ctx.lineWidth = 6; ctx.strokeStyle = '#111'; ctx.strokeText(sub, 192, 62); ctx.fillStyle = '#ffffff'; ctx.fillText(sub, 192, 62); }
    const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false }));
    sp.scale.set(1.5, c.height / 384 * 1.5, 1); sp.position.y = 2.2 * sc + 0.1; sp.renderOrder = 40;
    group.add(sp); rig.tag = sp;
  };
  rig.showTag = function (v) { if (rig.tag) rig.tag.visible = !!v; };
  rig.dispose = function () { if (group.parent) group.parent.remove(group); rig.setNameTag(null); };

  const tmpPose = basePose();
  rig.update = function (dt) {
    rig.t += dt;
    const gp = group.position;
    if (rig._last) {
      const dx = gp.x - rig._last.x, dz = gp.z - rig._last.z, inst = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
      if (inst < 14) { rig.speed = damp(rig.speed, inst, 14, dt); if (inst > 0.08) rig.moveHeading = Math.atan2(dx, dz); }
      else rig.speed = 0;
      rig._last.x = gp.x; rig._last.z = gp.z;
    } else rig._last = { x: gp.x, z: gp.z };
    rig.moveSpeed = rig.speed;

    const st = rig.state === 'auto' ? (rig.speed > 3.6 ? 'run' : rig.speed > 0.3 ? 'walk' : 'idle') : rig.state;
    const tp = tmpPose; CH.forEach(c => { tp[c] = 0; }); tp.hipY = HIP_Y;
    (POSE[st] || POSE.idle)(tp, rig, dt);

    let k = st === 'ko' ? 8 : 15;
    if (rig.overlay) {
      const ov = rig.overlay; ov.t += dt * ov.speed;
      const u = ov.t / ov.def.dur;
      if (u >= 1) rig.overlay = null;
      else {
        const vals = {}, w = overlayEval(ov.def, u, vals);
        Object.keys(vals).forEach(c => { tp[c] = lerp(tp[c], vals[c], w); });
        k = 26;
      }
    }
    if (rig.lookTarget && st !== 'ko') {
      const want = Math.atan2(rig.lookTarget.x - gp.x, rig.lookTarget.z - gp.z);
      tp.headY = clamp(angDiff(group.rotation.y, want), -0.95, 0.95);
    }
    const p = rig.p;
    for (let i = 0; i < CH.length; i++) { const c = CH[i]; p[c] = damp(p[c], tp[c], k, dt); }

    const j = rig.joints;
    j.hips.position.y = p.hipY;
    j.torso.rotation.set(p.leanX, p.twistY, p.tiltZ);
    j.head.rotation.set(p.headX, p.headY, 0);
    j.legL.rotation.set(p.legLX, 0, p.legLZ); j.legR.rotation.set(p.legRX, 0, p.legRZ);
    j.kneeL.rotation.x = p.kneeLX; j.kneeR.rotation.x = p.kneeRX;
    j.armL.rotation.set(p.armLX, 0, p.armLZ); j.armR.rotation.set(p.armRX, 0, p.armRZ);
    j.elbL.rotation.x = -p.elbLX; j.elbR.rotation.x = -p.elbRX;
    body.rotation.x = p.bodyRX; body.position.y = p.bodyY;

    // face: talk + blink
    if (rig.talkT > 0) { rig.talkT -= dt; j.jaw.scale.y = 1 + Math.abs(Math.sin(rig.t * 22)) * 2.6; }
    else j.jaw.scale.y = 1;
    rig.blinkT -= dt;
    if (rig.blinkT < 0) { rig.blinkT = rnd(2.5, 5.5); j.eyeL.scale.y = j.eyeR.scale.y = 0.15; }
    else if (j.eyeL.scale.y < 1) { j.eyeL.scale.y = j.eyeR.scale.y = Math.min(1, j.eyeL.scale.y + dt * 12); }
    if (rig.targeted) { const s = 1 + Math.sin(rig.t * 6) * 0.08; ring.scale.set(s, s, s); ring.rotation.z += dt * 1.5; }
  };
  return rig;
}

function addChar(rig) { if (!rig.group.parent) G.scene.add(rig.group); if (G.chars.indexOf(rig) < 0) G.chars.push(rig); return rig; }
function removeChar(rig) { const i = G.chars.indexOf(rig); if (i >= 0) G.chars.splice(i, 1); if (rig.group.parent) rig.group.parent.remove(rig.group); }
function clearChars() { G.chars.slice().forEach(removeChar); }

/* =========================================================
   ROOMS
   Every room: { id, group, off, W, D, H, bounds, camBounds, colliders[], anchors{}, doors[], seats[], light }
   All coordinates stored in world space.
   ========================================================= */
let _dot = null;
function dotTex() { return _dot || (_dot = softDotTex()); }

function newRoom(id, W, D, H) {
  const off = ROOM_OFFSET[id];
  const group = new T.Group(); group.position.set(off.x, 0, off.z); group.visible = false; G.scene.add(group);
  const light = new T.PointLight(0xffd9a0, 0.5, 30, 1.2); light.position.set(0, H - 1.0, 0); group.add(light);
  const room = {
    id, group, off, W, D, H, light,
    bounds: { minX: off.x - W / 2 + 0.7, maxX: off.x + W / 2 - 0.7, minZ: off.z - D / 2 + 0.7, maxZ: off.z + D / 2 - 0.7 },
    camBounds: { minX: off.x - W / 2 + 0.55, maxX: off.x + W / 2 - 0.55, minZ: off.z - D / 2 + 0.55, maxZ: off.z + D / 2 - 0.55, maxY: H - 0.4 },
    colliders: [], anchors: {}, doors: [], seats: [], books: [], camHeading: PI, label: id
  };
  G.rooms[id] = room;
  return room;
}
function col(room, cx, cz, w, d) { room.colliders.push({ minX: room.off.x + cx - w / 2, maxX: room.off.x + cx + w / 2, minZ: room.off.z + cz - d / 2, maxZ: room.off.z + cz + d / 2 }); }
function anc(room, name, lx, lz, ry, y) { room.anchors[name] = { x: room.off.x + lx, z: room.off.z + lz, ry: ry || 0, y: y || 0 }; }

function shell(g, W, D, H, o) {
  const fl = new T.Mesh(new T.BoxGeometry(W, 0.2, D), new T.MeshLambertMaterial({ map: o.floorTex, color: 0xffffff }));
  fl.position.y = -0.1; fl.receiveShadow = true; g.add(fl);
  B(g, W, 0.25, D, o.ceil, 0, H + 0.12, 0, { cast: false });
  const t = 0.4;
  B(g, W + t * 2, H, t, o.wall, 0, H / 2, -D / 2 - t / 2, { cast: false });
  B(g, W + t * 2, H, t, o.wall, 0, H / 2, D / 2 + t / 2, { cast: false });
  B(g, t, H, D, o.wall, -W / 2 - t / 2, H / 2, 0, { cast: false });
  B(g, t, H, D, o.wall, W / 2 + t / 2, H / 2, 0, { cast: false });
  const wh = o.wainH || 1.3;
  B(g, W, wh, 0.1, o.wain, 0, wh / 2, -D / 2 + 0.05, { cast: false }); B(g, W, wh, 0.1, o.wain, 0, wh / 2, D / 2 - 0.05, { cast: false });
  B(g, 0.1, wh, D, o.wain, -W / 2 + 0.05, wh / 2, 0, { cast: false }); B(g, 0.1, wh, D, o.wain, W / 2 - 0.05, wh / 2, 0, { cast: false });
  B(g, W, 0.08, 0.16, o.trim, 0, wh, -D / 2 + 0.08, { cast: false }); B(g, W, 0.08, 0.16, o.trim, 0, wh, D / 2 - 0.08, { cast: false });
  B(g, 0.16, 0.08, D, o.trim, -W / 2 + 0.08, wh, 0, { cast: false }); B(g, 0.16, 0.08, D, o.trim, W / 2 - 0.08, wh, 0, { cast: false });
  B(g, W, 0.12, 0.2, o.trim, 0, H - 0.06, -D / 2 + 0.1, { cast: false }); B(g, W, 0.12, 0.2, o.trim, 0, H - 0.06, D / 2 - 0.1, { cast: false });
  B(g, 0.2, 0.12, D, o.trim, -W / 2 + 0.1, H - 0.06, 0, { cast: false }); B(g, 0.2, 0.12, D, o.trim, W / 2 - 0.1, H - 0.06, 0, { cast: false });
}
function fan(room, x, z, speed) {
  const g = new T.Group(); g.position.set(x, room.H - 0.55, z); room.group.add(g);
  C(g, 0.03, 0.03, 0.5, '#444', 0, 0.3, 0, { seg: 6, cast: false });
  C(g, 0.16, 0.16, 0.1, '#222', 0, 0, 0, { seg: 8, cast: false });
  for (let i = 0; i < 4; i++) { const a = new T.Group(); a.rotation.y = i * PI / 2; B(a, 0.95, 0.025, 0.17, '#cfc7b0', 0.62, 0, 0, { cast: false }); g.add(a); }
  addUpdater(dt => { if (room.group.visible) g.rotation.y += dt * (speed || 4); });
}
function tube(room, x, z, len, along) {
  const g = new T.Group(); g.position.set(x, room.H - 0.08, z); if (along === 'z') g.rotation.y = PI / 2; room.group.add(g);
  B(g, len + 0.1, 0.06, 0.2, '#555', 0, 0.02, 0, { cast: false });
  B(g, len, 0.05, 0.12, '#ffffff', 0, -0.02, 0, { basic: true, cast: false });
}
function windowPane(room, x, y, z, ry, w, h, shaft) {
  const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = ry; room.group.add(g);
  B(g, w + 0.2, h + 0.2, 0.1, '#3a2411', 0, 0, 0, { cast: false });
  B(g, w, h, 0.05, '#bfe3ff', 0, 0, 0.04, { basic: true, cast: false });
  B(g, 0.06, h, 0.06, '#3a2411', 0, 0, 0.07, { cast: false }); B(g, w, 0.06, 0.06, '#3a2411', 0, 0, 0.07, { cast: false });
  B(g, w + 0.3, 0.08, 0.2, '#3a2411', 0, -h / 2 - 0.1, 0.08, { cast: false });
  if (shaft && !G.lowGfx) {
    const m = new T.Mesh(new T.PlaneGeometry(w * 0.9, 6), new T.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.07, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
    m.position.set(0, -2.4, 1.2); m.rotation.x = -0.55; g.add(m);
  }
}
function door(room, id, to, lx, lz, ry, o) {
  o = o || {};
  const g = new T.Group(); g.position.set(lx, 0, lz); g.rotation.y = ry; room.group.add(g);
  const w = 1.7, h = 2.6;
  B(g, w + 0.4, h + 0.2, 0.2, o.frame || '#2e1c0c', 0, (h + 0.2) / 2, 0.05, { cast: false });
  B(g, w, h, 0.12, o.color || '#6b4220', 0, h / 2, 0.12, { cast: false });
  [[-1, 0.72], [1, 0.72], [-1, 0.3], [1, 0.3]].forEach(a => B(g, w * 0.36, h * 0.32, 0.03, o.panel || '#52321a', a[0] * w * 0.22, h * a[1], 0.19, { cast: false }));
  S(g, 0.06, '#c9a227', w * 0.36, 1.1, 0.22, { cast: false });
  const sign = label(o.label || id, { w: 2.5, h: 0.5, bg: o.signBg || '#5a3a1e', fg: '#ffd21f' });
  sign.position.set(0, h + 0.62, 0.17); g.add(sign);
  const lock = label('LOCKED', { w: 1.5, h: 0.42, bg: '#b3122b', fg: '#ffffff', border: '#111' });
  lock.position.set(0, 1.55, 0.26); lock.visible = !!o.locked; g.add(lock);
  const lockSub = label(o.lockText || '', { w: 1.9, h: 0.34, bg: '#111', fg: '#ffd21f', font: 'Oswald, Arial, sans-serif', weight: '600' });
  lockSub.position.set(0, 1.2, 0.26); lockSub.visible = !!o.locked && !!o.lockText; g.add(lockSub);
  const fx = Math.sin(ry), fz = Math.cos(ry);
  const d = { id, to, x: room.off.x + lx + fx * 1.5, z: room.off.z + lz + fz * 1.5, r: 1.4, label: o.label || id, locked: !!o.locked, lockMesh: lock, lockSub, sign, spawn: null };
  room.doors.push(d);
  return d;
}
function setDoorLocked(roomId, doorId, locked, text) {
  const r = G.rooms[roomId]; if (!r) return;
  r.doors.forEach(d => { if (d.id === doorId) { d.locked = !!locked; d.lockMesh.visible = !!locked; d.lockSub.visible = !!locked && !!text; if (text) d.lockSub.userData.setText(text); } });
}
function chair(g, x, y, z, ry, color, tall) {
  const c = new T.Group(); c.position.set(x, y, z); c.rotation.y = ry || 0; g.add(c);
  const col2 = color || '#4a2e16';
  B(c, 0.5, 0.07, 0.5, col2, 0, 0.45, 0);
  B(c, 0.5, tall ? 1.1 : 0.55, 0.07, col2, 0, tall ? 0.95 : 0.75, -0.23);
  [[-0.21, -0.21], [0.21, -0.21], [-0.21, 0.21], [0.21, 0.21]].forEach(p => B(c, 0.06, 0.45, 0.06, '#2e1c0c', p[0], 0.225, p[1], { cast: false }));
  return c;
}
function desk(g, x, y, z, w, d, h, color, front) {
  const k = new T.Group(); k.position.set(x, y, z); g.add(k);
  B(k, w, 0.08, d, color, 0, h, 0);
  B(k, 0.08, h, d - 0.1, '#3a2411', -w / 2 + 0.08, h / 2, 0); B(k, 0.08, h, d - 0.1, '#3a2411', w / 2 - 0.08, h / 2, 0);
  B(k, w - 0.2, h - 0.1, 0.06, '#4a2e16', 0, h / 2 + 0.03, d / 2 - 0.08);
  B(k, w - 0.2, h - 0.1, 0.06, '#4a2e16', 0, h / 2 + 0.03, -d / 2 + 0.08);
  return k;
}
function bench(g, x, z, w, ry) {
  const b = new T.Group(); b.position.set(x, 0, z); b.rotation.y = ry || 0; g.add(b);
  B(b, w, 0.07, 0.5, '#5a3a1e', 0, 0.45, 0); B(b, w, 0.7, 0.06, '#4a2e16', 0, 0.8, 0.28);
  for (let i = 0; i <= Math.max(1, Math.round(w / 2.4)); i++) { const px = -w / 2 + 0.1 + (w - 0.2) * i / Math.max(1, Math.round(w / 2.4)); B(b, 0.07, 0.45, 0.45, '#3a2411', px, 0.225, 0, { cast: false }); }
  return b;
}
function plant(g, x, z, s) {
  s = s || 1;
  C(g, 0.22 * s, 0.17 * s, 0.45 * s, '#8a4a2a', x, 0.22 * s, z, { seg: 8 });
  S(g, 0.3 * s, '#2f7d3a', x, 0.7 * s, z, { ws: 6, hs: 5 }); S(g, 0.22 * s, '#3b9a47', x + 0.16 * s, 0.95 * s, z + 0.05 * s, { ws: 6, hs: 5 }); S(g, 0.2 * s, '#287033', x - 0.14 * s, 0.9 * s, z - 0.08 * s, { ws: 6, hs: 5 });
}
function poster(room, x, y, z, ry, w, h, text, o) {
  const m = label(text, Object.assign({ w, h, bg: '#f3e7c9', fg: '#3a2411', border: '#5a3a1e', font: 'Special Elite, Courier New, monospace', lineGap: 1.25, align: 'left' }, o || {}));
  m.position.set(x, y, z); m.rotation.y = ry; room.group.add(m); return m;
}

/* Indian flag + Ashoka emblem textures */
let _flagTex = null, _emblemTex = null;
function flagTexture() {
  if (_flagTex) return _flagTex;
  _flagTex = canvasTex(192, 128, (x, w, h) => {
    x.fillStyle = '#ff9933'; x.fillRect(0, 0, w, h / 3); x.fillStyle = '#ffffff'; x.fillRect(0, h / 3, w, h / 3); x.fillStyle = '#138808'; x.fillRect(0, h * 2 / 3, w, h / 3);
    x.translate(w / 2, h / 2); x.strokeStyle = '#000080'; x.lineWidth = 2; x.beginPath(); x.arc(0, 0, 18, 0, TAU); x.stroke();
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * 18, Math.sin(a) * 18); x.stroke(); }
  });
  return _flagTex;
}
function emblemTexture() {
  if (_emblemTex) return _emblemTex;
  _emblemTex = canvasTex(256, 256, (x, w, h) => {
    x.translate(w / 2, h / 2);
    const g = x.createRadialGradient(0, 0, 10, 0, 0, 120); g.addColorStop(0, '#ffe58a'); g.addColorStop(1, '#c9a227');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, 118, 0, TAU); x.fill();
    x.lineWidth = 8; x.strokeStyle = '#7a5a10'; x.stroke();
    x.strokeStyle = '#1b2a5c'; x.lineWidth = 5; x.beginPath(); x.arc(0, 0, 70, 0, TAU); x.stroke();
    x.lineWidth = 3; for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; x.beginPath(); x.moveTo(Math.cos(a) * 14, Math.sin(a) * 14); x.lineTo(Math.cos(a) * 70, Math.sin(a) * 70); x.stroke(); }
    x.fillStyle = '#1b2a5c'; x.beginPath(); x.arc(0, 0, 12, 0, TAU); x.fill();
  });
  return _emblemTex;
}
function flagPole(room, x, y, z, ry) {
  const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = ry || 0; room.group.add(g);
  C(g, 0.04, 0.05, 3.2, '#c9a227', 0, 1.6, 0, { seg: 6 }); S(g, 0.08, '#c9a227', 0, 3.25, 0, { ws: 6, hs: 4 });
  const f = new T.Mesh(new T.PlaneGeometry(1.35, 0.9, 6, 3), new T.MeshLambertMaterial({ map: flagTexture(), side: T.DoubleSide }));
  f.position.set(0.7, 2.65, 0); f.castShadow = true; g.add(f);
  const base = f.geometry.attributes.position.array.slice();
  let t0 = Math.random() * 6;
  addUpdater(dt => {
    if (!room.group.visible) return;
    t0 += dt * 3; const pa = f.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) { const px = base[i * 3]; pa.array[i * 3 + 2] = Math.sin(t0 + px * 3.2) * 0.07 * (px + 0.7); }
    pa.needsUpdate = true;
  });
}
function emblem(room, x, y, z, ry, size, text) {
  const m = new T.Mesh(new T.CircleGeometry(size / 2, 24), new T.MeshBasicMaterial({ map: emblemTexture(), transparent: true }));
  m.position.set(x, y, z); m.rotation.y = ry; room.group.add(m);
  const t = label(text, { w: size * 2.2, h: size * 0.3, bg: null, border: null, fg: '#c9a227', stroke: '#2a1c0a', font: 'Playfair Display, Times New Roman, serif', weight: '900' });
  t.position.set(x + Math.sin(ry) * 0.01, y - size * 0.72, z + Math.cos(ry) * 0.01); t.rotation.y = ry; room.group.add(t);
  return t;
}

/* Instanced law books */
const BOOK_COLS = ['#7a0c1e', '#1b2a5c', '#3a2411', '#0f3d2e', '#c9a227', '#5a1a4a', '#8b5e34', '#b3122b', '#2b2b2b', '#e8dcc0', '#3a6f6f', '#1a1a1a'];
function bookshelf(room, x, z, ry, w, h, rows) {
  const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = ry; room.group.add(g);
  const d = 0.46;
  B(g, w, h, 0.06, '#3a2411', 0, h / 2, -d / 2 + 0.03);
  B(g, 0.08, h, d, '#4a2e16', -w / 2 + 0.04, h / 2, 0); B(g, 0.08, h, d, '#4a2e16', w / 2 - 0.04, h / 2, 0);
  B(g, w, 0.08, d, '#4a2e16', 0, h - 0.04, 0);
  const rowH = (h - 0.12) / rows, c = Math.cos(ry), s = Math.sin(ry), dens = G.lowGfx ? 0.55 : 1;
  for (let r = 0; r < rows; r++) {
    const y0 = 0.06 + r * rowH;
    B(g, w - 0.14, 0.05, d, '#4a2e16', 0, y0, 0, { cast: false });
    let px = -w / 2 + 0.12;
    while (px < w / 2 - 0.14) {
      const bw = rnd(0.035, 0.085), bh = rnd(0.62, 0.92) * (rowH - 0.07), bd = rnd(0.25, 0.34);
      if (Math.random() < dens) {
        const lx = px + bw / 2, lz = -0.02 + (0.3 - bd) * 0.2, ly = y0 + 0.025 + bh / 2;
        room.books.push({ x: x + c * lx + s * lz, y: ly, z: z - s * lx + c * lz, sx: bw, sy: bh, sz: bd, ry, col: pickOne(BOOK_COLS) });
      }
      px += bw + 0.004;
    }
  }
  return g;
}
function finalizeBooks(room) {
  const n = room.books.length; if (!n) return;
  const mesh = new T.InstancedMesh(boxGeo(1, 1, 1), new T.MeshLambertMaterial({ color: 0xffffff }), n);
  const o = new T.Object3D(), cc = new T.Color();
  room.books.forEach((b, i) => {
    o.position.set(b.x, b.y, b.z); o.rotation.set(0, b.ry, 0); o.scale.set(b.sx, b.sy, b.sz); o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix); cc.set(b.col); mesh.setColorAt(i, cc);
  });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
  room.group.add(mesh); room.books = [];
}

/* ---------------------------------------------------------
   COURTROOM
   --------------------------------------------------------- */
function buildCourtroom() {
  const W = 28, D = 22, H = 5.2, room = newRoom('courtroom', W, D, H), g = room.group;
  room.label = 'DISTRICT SESSIONS COURT';
  shell(g, W, D, H, { floorTex: woodTex(W / 3.5, D / 3.5), wall: '#e9dcb8', wain: '#5a3a1e', wainH: 1.5, ceil: '#d9cfb4', trim: '#2e1c0c' });
  // Judge's dais, bench and seat
  B(g, 9.6, 0.7, 3.4, '#4a2e16', 0, 0.35, -9.3); B(g, 9.8, 0.08, 3.5, '#3a2411', 0, 0.72, -9.3, { cast: false });
  B(g, 6.8, 1.15, 0.9, '#5a3a1e', 0, 1.28, -7.9); B(g, 7.0, 0.1, 1.1, '#3a2411', 0, 1.88, -7.9);
  B(g, 5.6, 0.7, 0.04, '#7a0c1e', 0, 1.35, -7.42, { cast: false });
  chair(g, 0, 0.7, -9.5, 0, '#4a2e16', true); B(g, 1.3, 1.5, 0.08, '#7a0c1e', 0, 2.1, -10.3, { cast: false });
  const nameplate = label("HON'BLE COURT", { w: 2.0, h: 0.34, bg: '#c9a227', fg: '#2a1c0a', border: '#2a1c0a' }); nameplate.position.set(0, 1.62, -7.41); g.add(nameplate);
  const gv = makeProp('gavel'); gv.position.set(1.5, 1.93, -7.9); gv.rotation.z = -PI / 2.4; g.add(gv);
  const bk = makeProp('book', { color: '#7a0c1e' }); bk.position.set(-1.8, 1.96, -7.95); g.add(bk);
  emblem(room, 0, 3.7, -10.92, 0, 1.9, 'SATYAMEVA JAYATE');
  flagPole(room, -4.8, 0.7, -10.3, 0); flagPole(room, 4.8, 0.7, -10.3, 0);
  col(room, 0, -9.0, 9.6, 3.9);
  // Witness box
  B(g, 2.3, 0.35, 2.1, '#4a2e16', 7.2, 0.175, -5.8);
  B(g, 2.3, 0.95, 0.1, '#5a3a1e', 7.2, 0.82, -4.8); B(g, 0.1, 0.95, 2.1, '#5a3a1e', 6.1, 0.82, -5.8); B(g, 0.1, 0.95, 2.1, '#5a3a1e', 8.3, 0.82, -5.8);
  const wl = label('WITNESS', { w: 1.3, h: 0.3, bg: '#5a3a1e', fg: '#ffd21f' }); wl.position.set(7.2, 0.82, -4.74); g.add(wl);
  col(room, 7.2, -5.6, 2.4, 2.4);
  // Clerk desk
  desk(g, -4.8, 0, -6.8, 2.3, 0.9, 0.85, '#6b4220'); chair(g, -4.8, 0, -7.7, 0, '#3a2411');
  const lp = makeProp('laptop'); lp.position.set(-4.4, 0.9, -6.8); g.add(lp); const pp = makeProp('paper'); pp.position.set(-5.4, 0.9, -6.8); g.add(pp);
  col(room, -4.8, -6.8, 2.4, 1.1);
  // Counsel tables
  [-1, 1].forEach(side => {
    const tx = side * 5.2;
    desk(g, tx, 0, -0.8, 3.6, 1.1, 0.9, '#6b4220');
    const pl = label(side < 0 ? 'DEFENCE' : 'PROSECUTION', { w: 1.7, h: 0.32, bg: side < 0 ? '#1b2a5c' : '#7a0c1e', fg: '#ffffff' }); pl.position.set(tx, 0.62, -0.23); g.add(pl);
    chair(g, tx - 0.9, 0, 0.75, PI, '#3a2411'); chair(g, tx + 0.9, 0, 0.75, PI, '#3a2411');
    const b1 = makeProp('book', { color: side < 0 ? '#1b2a5c' : '#7a0c1e' }); b1.position.set(tx - 0.9, 0.96, -0.8); g.add(b1);
    const b2 = makeProp('mug'); b2.position.set(tx + 1.2, 0.94, -0.7); g.add(b2);
    col(room, tx, -0.8, 3.7, 1.2);
  });
  // Bar railing with gate gap
  [[-7.7, 12.6], [7.7, 12.6]].forEach(seg => {
    B(g, seg[1], 0.1, 0.18, '#3a2411', seg[0], 1.08, 3.8); B(g, seg[1], 0.07, 0.1, '#3a2411', seg[0], 0.4, 3.8, { cast: false });
    for (let i = 0; i <= 8; i++) B(g, 0.1, 1.08, 0.1, '#4a2e16', seg[0] - seg[1] / 2 + 0.1 + (seg[1] - 0.2) * i / 8, 0.54, 3.8);
    col(room, seg[0], 3.8, seg[1], 0.3);
  });
  // Gallery benches
  [6.0, 7.6, 9.2].forEach(z => [-1, 1].forEach(side => {
    bench(g, side * 6.3, z, 9, PI); col(room, side * 6.3, z, 9, 0.8);
    for (let i = 0; i < 6; i++) room.seats.push({ x: room.off.x + side * 6.3 - 4 + i * 1.6, z: room.off.z + z - 0.05, y: 0, ry: PI });
  }));
  // Plaque, windows, lights
  poster(room, 13.93, 2.9, -2.5, -PI / 2, 3.6, 2.2,
    'PREAMBLE\n"WE, THE PEOPLE OF INDIA, having solemnly\nresolved to constitute India into a\nSOVEREIGN SOCIALIST SECULAR DEMOCRATIC\nREPUBLIC and to secure to all its citizens:\nJUSTICE, LIBERTY, EQUALITY, FRATERNITY"', { size: 15 });
  poster(room, -13.93, 2.9, 1.5, PI / 2, 3.0, 1.8, 'ARTICLE 21\n"No person shall be deprived of his\nlife or personal liberty except\naccording to procedure established\nby law."', { size: 15 });
  [-6, 0, 6].forEach(z => { windowPane(room, -13.9, 3.0, z - 4, PI / 2, 1.6, 1.8, true); windowPane(room, 13.9, 3.0, z + 4.5, -PI / 2, 1.6, 1.8, true); });
  fan(room, -5, -2, 4); fan(room, 5, -2, 4); fan(room, 0, 6, 3.4);
  tube(room, -6, -4, 2.2); tube(room, 6, -4, 2.2); tube(room, 0, 2, 2.2); tube(room, -6, 7, 2.2); tube(room, 6, 7, 2.2);
  plant(g, -12.6, 10.0, 1.1); plant(g, 12.6, 10.0, 1.1); plant(g, -12.6, -10.0, 1.1); plant(g, 12.6, -10.0, 1.1);
  const d = door(room, 'exit', 'corridor', 0, D / 2 - 0.02, PI, { label: 'EXIT TO LOBBY' });
  anc(room, 'spawn', 0, 9.0, PI); anc(room, 'judgeSeat', 0, -9.5, 0, 0.7); anc(room, 'witnessSpot', 7.2, -5.9, 0, 0.35);
  anc(room, 'defenseSeat', -5.9, 0.75, PI); anc(room, 'prosSeat', 5.9, 0.75, PI); anc(room, 'clerkSeat', -4.8, -7.7, 0);
  anc(room, 'arena', 0, 0.9, 0); anc(room, 'fightA', -1.6, 0.9, PI / 2); anc(room, 'fightB', 1.6, 0.9, -PI / 2);
  anc(room, 'pick_brief', -5.4, -0.8, 0, 1.2); anc(room, 'pick_book', 5.4, -0.8, 0, 1.2); anc(room, 'pick_gavel', 1.5, -7.9, 0, 2.2);
  room.arenaR = 3.0;
  room.camHeading = PI;
  finalizeBooks(room);
  return room;
}

/* ---------------------------------------------------------
   BAR LIBRARY
   --------------------------------------------------------- */
function buildLibrary() {
  const W = 24, D = 18, H = 4.6, room = newRoom('library', W, D, H), g = room.group;
  room.label = "ADVOCATES' BAR LIBRARY";
  shell(g, W, D, H, { floorTex: woodTex(W / 3.2, D / 3.2, '#6b4220'), wall: '#d8c79a', wain: '#3a2411', wainH: 1.2, ceil: '#cfc3a0', trim: '#2a1c0c' });
  B(g, 8, 0.03, 5.5, '#7a0c1e', 0, 0.02, 1.8, { cast: false });
  // shelves
  for (let i = 0; i < 6; i++) bookshelf(room, -9.5 + i * 3.8, -8.75, 0, 3.7, 3.7, 7);
  for (let i = 0; i < 4; i++) { bookshelf(room, -11.75, -6.2 + i * 3.8, PI / 2, 3.7, 3.7, 7); }
  for (let i = 0; i < 3; i++) { bookshelf(room, 11.75, -6.2 + i * 3.8, -PI / 2, 3.7, 3.7, 7); }
  [-6.5, 6.5].forEach(x => { bookshelf(room, x, -2.4, 0, 4.2, 2.6, 5); bookshelf(room, x, -2.9, PI, 4.2, 2.6, 5); col(room, x, -2.65, 4.4, 1.0); });
  col(room, 0, -8.7, 22, 1.0); col(room, -11.7, -1, 1.0, 15); col(room, 11.7, -4, 1.0, 9);
  // ladder
  B(g, 0.06, 3.4, 0.06, '#8b5e34', -2.6, 1.7, -8.25, { rz: 0.0, cast: false }); B(g, 0.06, 3.4, 0.06, '#8b5e34', -2.0, 1.7, -8.25, { cast: false });
  for (let i = 0; i < 7; i++) B(g, 0.6, 0.04, 0.06, '#8b5e34', -2.3, 0.4 + i * 0.45, -8.25, { cast: false });
  // study desk
  desk(g, 0, 0, 1.5, 6.0, 1.5, 0.85, '#6b4220');
  [-2, 0, 2].forEach(x => { const bkp = makeProp('book', { color: pickOne(BOOK_COLS) }); bkp.position.set(x, 0.92, 1.3); bkp.rotation.y = rnd(-0.3, 0.3); g.add(bkp); const lamp = new T.Group(); lamp.position.set(x + 0.7, 0.9, 1.6); g.add(lamp); C(lamp, 0.03, 0.05, 0.3, '#c9a227', 0, 0.15, 0, { seg: 6, cast: false }); B(lamp, 0.22, 0.12, 0.18, '#1f6b3a', 0, 0.34, 0); });
  [-2, 0, 2].forEach(x => { chair(g, x, 0, 2.7, PI, '#3a2411'); chair(g, x, 0, 0.3, 0, '#3a2411'); });
  col(room, 0, 1.5, 6.2, 1.7);
  const sd = label('STUDY DESK', { w: 2.3, h: 0.45, bg: '#1b2a5c', fg: '#ffd21f' }); sd.position.set(0, 2.5, 1.5); sd.rotation.y = PI; g.add(sd);
  // globe
  C(g, 0.05, 0.12, 1.0, '#3a2411', 3.8, 0.5, 2.4, { seg: 6 }); S(g, 0.4, '#2f6fb0', 3.8, 1.3, 2.4, { ws: 10, hs: 8 }); S(g, 0.28, '#3b9a47', 3.9, 1.35, 2.55, { ws: 6, hs: 5 }); col(room, 3.8, 2.4, 0.9, 0.9);
  // case desk
  desk(g, -7.2, 0, 4.9, 3.0, 1.2, 0.85, '#5a3a1e'); chair(g, -7.2, 0, 5.8, PI, '#3a2411');
  const pa = makeProp('paper'); pa.position.set(-7.8, 0.9, 4.9); g.add(pa); const fi = makeProp('file'); fi.position.set(-6.6, 0.95, 4.9); g.add(fi);
  const cd = label('CASE DESK', { w: 2.0, h: 0.42, bg: '#7a0c1e', fg: '#ffd21f' }); cd.position.set(-7.2, 2.3, 4.2); cd.rotation.y = PI; g.add(cd);
  col(room, -7.2, 4.9, 3.1, 1.3);
  // seniors' corner
  B(g, 4.4, 0.03, 3.4, '#1f4d6b', 7.8, 0.02, 4.8, { cast: false });
  chair(g, 6.6, 0, 3.6, PI * 0.9, '#7a0c1e', false); chair(g, 9.0, 0, 3.6, PI * 1.1, '#7a0c1e', false);
  C(g, 0.5, 0.5, 0.05, '#5a3a1e', 7.8, 0.55, 4.8, { seg: 10 }); C(g, 0.08, 0.1, 0.55, '#3a2411', 7.8, 0.27, 4.8, { seg: 6 });
  const tm = makeProp('mug'); tm.position.set(7.7, 0.58, 4.7); g.add(tm); const tm2 = makeProp('mug'); tm2.position.set(8.0, 0.58, 4.9); g.add(tm2);
  col(room, 7.8, 4.8, 1.2, 1.2);
  const sc2 = label("SENIORS' CORNER", { w: 2.4, h: 0.42, bg: '#5a3a1e', fg: '#ffd21f' }); sc2.position.set(7.8, 2.6, 6.8); sc2.rotation.y = PI; g.add(sc2);
  // Constitution pedestal
  B(g, 1.3, 0.9, 1.0, '#3a2411', 0, 0.45, -7.4); B(g, 1.1, 0.7, 0.8, '#bfe3ff', 0, 1.25, -7.4, { opacity: 0.28, depthWrite: false, cast: false });
  const cb = makeProp('book', { color: '#1b2a5c' }); cb.scale.setScalar(1.7); cb.position.set(0, 1.0, -7.4); g.add(cb);
  const cl = label('THE CONSTITUTION OF INDIA', { w: 2.6, h: 0.36, bg: '#c9a227', fg: '#2a1c0a', border: '#2a1c0a' }); cl.position.set(0, 0.62, -6.88); g.add(cl);
  col(room, 0, -7.4, 1.5, 1.2);
  // Lady Justice
  B(g, 0.9, 0.7, 0.9, '#8a8a8a', 10.3, 0.35, 7.3); C(g, 0.18, 0.3, 1.1, '#f2f2f2', 10.3, 1.25, 7.3, { seg: 8 }); S(g, 0.17, '#f2f2f2', 10.3, 1.95, 7.3, { ws: 8, hs: 6 });
  B(g, 0.38, 0.06, 0.2, '#111', 10.3, 1.97, 7.46, { cast: false }); const sc = makeProp('scales'); sc.position.set(10.3, 1.65, 7.55); sc.scale.setScalar(0.85); g.add(sc); col(room, 10.3, 7.3, 1.0, 1.0);
  // posters
  poster(room, -11.93, 2.8, 5.5, PI / 2, 2.6, 2.0, 'THE FIVE WRITS\n(Arts. 32 & 226)\nHabeas Corpus: produce the person\nMandamus: do your public duty\nProhibition: stop the lower court\nCertiorari: quash the lower order\nQuo Warranto: by what authority?', { size: 13 });
  poster(room, 11.93, 2.8, 7.6, -PI / 2, 2.2, 1.5, 'BNS 2023 replaced IPC\n(in force 1 July 2024)\nMurder: IPC 302 -> BNS 103\nCheating: IPC 420 -> BNS 318', { size: 13 });
  windowPane(room, 11.9, 2.9, 5.2, -PI / 2, 1.3, 1.6, true);
  fan(room, -5, 3, 3.2); fan(room, 5, 3, 3.2); tube(room, -5, -4.5, 2.2); tube(room, 5, -4.5, 2.2); tube(room, 0, 4, 2.2);
  plant(g, -11.2, 8.2, 1.1); plant(g, 11.2, 8.2, 1.1);
  door(room, 'exit', 'corridor', 0, D / 2 - 0.02, PI, { label: 'EXIT TO LOBBY' });
  anc(room, 'spawn', 0, 7.0, PI); anc(room, 'studyDesk', 0, 3.4, PI); anc(room, 'caseDesk', -7.2, 3.6, PI); anc(room, 'codex', 0, -5.9, 0);
  anc(room, 'mentor1', 7.2, 3.3, -PI / 2); anc(room, 'mentor2', 9.0, 5.9, PI);
  anc(room, 'pick_book1', 2.0, 1.5, 0, 1.2); anc(room, 'pick_book2', -2.0, 1.5, 0, 1.2);
  room.camHeading = PI;
  finalizeBooks(room);
  return room;
}

/* ---------------------------------------------------------
   POLICE THANA
   --------------------------------------------------------- */
function buildThana() {
  const W = 22, D = 16, H = 4.2, room = newRoom('thana', W, D, H), g = room.group;
  room.label = 'POLICE THANA';
  shell(g, W, D, H, { floorTex: concreteTex(W / 2.5, D / 2.5, '#8a857a'), wall: '#d6dcae', wain: '#3d5a40', wainH: 1.4, ceil: '#cfcfb8', trim: '#26382a' });
  // Lockup cell (NE)
  B(g, 7.6, 0.04, 6.4, '#4a4a46', 6.8, 0.02, -4.2, { cast: false });
  for (let i = 0; i <= 26; i++) { const x = 3.0 + i * (7.6 / 26); if (x > 3.4 && x < 4.7) continue; C(g, 0.025, 0.025, 3.0, '#2b2b2b', x, 1.5, -1.0, { seg: 5, cast: false }); }
  for (let i = 0; i <= 22; i++) C(g, 0.025, 0.025, 3.0, '#2b2b2b', 3.0, 1.5, -7.4 + i * (6.4 / 22), { seg: 5, cast: false });
  [0.15, 1.5, 3.0].forEach(y => { B(g, 7.6, 0.07, 0.07, '#2b2b2b', 6.8, y, -1.0, { cast: false }); B(g, 0.07, 0.07, 6.4, '#2b2b2b', 3.0, y, -4.2, { cast: false }); });
  B(g, 1.3, 2.8, 0.06, '#3a3a38', 4.05, 1.4, -1.0, { opacity: 0.9, cast: false }); S(g, 0.07, '#c9a227', 4.5, 1.2, -0.95, { cast: false });
  B(g, 2.8, 0.1, 0.9, '#5a3a1e', 9.2, 0.5, -6.9); B(g, 1.0, 0.08, 1.8, '#6e6e66', 6.8, 0.25, -5.4, { cast: false });
  col(room, 6.8, -4.2, 7.8, 6.6);
  const cl = label('LOCKUP', { w: 1.6, h: 0.42, bg: '#b3122b', fg: '#ffffff' }); cl.position.set(6.8, 3.4, -0.95); g.add(cl);
  // Inspector's desk
  desk(g, -5.5, 0, -4.2, 3.2, 1.3, 0.88, '#6b4220'); chair(g, -5.5, 0, -5.2, 0, '#2e1c0c', true);
  const reg = makeProp('file'); reg.scale.setScalar(1.25); reg.position.set(-5.2, 0.97, -4.2); g.add(reg);
  const ph = makeProp('phone'); ph.position.set(-6.4, 0.93, -4.1); g.add(ph); const mg = makeProp('mug'); mg.position.set(-4.4, 0.93, -4.0); g.add(mg);
  const np = label('INSPECTOR', { w: 1.5, h: 0.32, bg: '#3d5a40', fg: '#ffffff' }); np.position.set(-5.5, 0.6, -3.53); g.add(np);
  chair(g, -4.5, 0, -2.4, PI, '#3a2411'); chair(g, -6.6, 0, -2.4, PI, '#3a2411');
  col(room, -5.5, -4.2, 3.3, 1.4);
  // Complaint counter
  B(g, 5.2, 1.1, 0.7, '#4a2e16', -3.5, 0.55, 2.8); B(g, 5.4, 0.08, 0.9, '#6b4220', -3.5, 1.14, 2.8);
  const cc = label('COMPLAINTS / FIR', { w: 2.6, h: 0.4, bg: '#3d5a40', fg: '#ffd21f' }); cc.position.set(-3.5, 0.6, 3.17); g.add(cc);
  const ff = makeProp('file'); ff.position.set(-4.5, 1.22, 2.8); g.add(ff);
  col(room, -3.5, 2.8, 5.4, 1.0);
  // Boards, cupboard, bench
  B(g, 3.2, 1.8, 0.08, '#8b5e34', -10.9, 2.3, -1.0, { cast: false }); B(g, 3.0, 1.6, 0.04, '#c79a5a', -10.85, 2.3, -1.0, { cast: false });
  for (let i = 0; i < 14; i++) B(g, 0.3, 0.38, 0.02, ['#fffdf2', '#ffe9a8', '#cfe8ff'][i % 3], -10.8, 1.75 + Math.floor(i / 5) * 0.5, -2.1 + (i % 5) * 0.55, { cast: false });
  const fb = label('FIR BOARD', { w: 1.7, h: 0.36, bg: '#7a0c1e', fg: '#ffd21f' }); fb.position.set(-10.9, 3.4, -1.0); fb.rotation.y = PI / 2; g.add(fb);
  B(g, 1.4, 2.2, 0.7, '#6f7a78', -9.9, 1.1, -7.2); B(g, 0.04, 2.0, 0.02, '#3d4846', -9.9, 1.1, -6.82, { cast: false });
  const al = label('EVIDENCE', { w: 1.2, h: 0.3, bg: '#222', fg: '#ffd21f' }); al.position.set(-9.9, 2.5, -6.83); g.add(al); col(room, -9.9, -7.2, 1.5, 0.8);
  bench(g, -8.0, 6.2, 3.4, PI); col(room, -8.0, 6.2, 3.4, 0.8);
  poster(room, 0, 2.7, -7.93, 0, 3.4, 2.1, "D.K. BASU: YOUR RIGHTS ON ARREST\n1. Arrest memo, attested by a witness\n2. Inform a relative or friend\n3. Medical check-up in custody\n4. Meet your lawyer\n5. Produce before Magistrate in 24 hrs\n   (Art. 22, BNSS 187)", { size: 13 });
  poster(room, 10.93, 2.6, 4.5, -PI / 2, 2.2, 1.4, 'FIR / ZERO FIR (BNSS 173)\nAn FIR can be registered at ANY\nstation, and also online (e-FIR).', { size: 13 });
  emblem(room, 5.5, 3.0, -7.92, 0, 1.0, 'SATYAMEVA JAYATE');
  flagPole(room, -1.8, 0, -7.4, 0);
  const clock = new T.Group(); clock.position.set(-10.9, 3.2, 5.0); clock.rotation.y = PI / 2; g.add(clock); C(clock, 0.3, 0.3, 0.06, '#f2f2f2', 0, 0, 0, { seg: 12, rz: 0, cast: false }).rotation.x = PI / 2;
  fan(room, -4, 0, 5); fan(room, 5, 4, 5); tube(room, -5, -3, 2.0); tube(room, 5, 2, 2.0); tube(room, -6, 4, 2.0);
  plant(g, 10.2, 7.2, 1.0);
  door(room, 'exit', 'corridor', 0, D / 2 - 0.02, PI, { label: 'EXIT TO LOBBY' });
  anc(room, 'spawn', 0, 6.2, PI); anc(room, 'inspectorDesk', -5.5, -2.0, PI); anc(room, 'firBoard', -9.4, -1.0, PI / 2); anc(room, 'counter', -3.5, 1.6, PI);
  anc(room, 'interview', 5.6, 0.4, PI); anc(room, 'detainee1', 7.0, -4.4, PI); anc(room, 'detainee2', 9.2, -5.6, PI);
  anc(room, 'inspectorSeat', -5.5, -5.2, 0); anc(room, 'constable', -3.5, 3.9, PI);
  anc(room, 'arena', 0, 1.4, 0); anc(room, 'fightA', -1.6, 1.4, PI / 2); anc(room, 'fightB', 1.6, 1.4, -PI / 2);
  anc(room, 'pick_file', -4.8, -4.2, 0, 1.3);
  room.arenaR = 2.6; room.camHeading = PI;
  finalizeBooks(room);
  return room;
}

/* ---------------------------------------------------------
   HIGH COURT / SUPREME COURT CHAMBERS
   --------------------------------------------------------- */
function buildChambers() {
  const W = 28, D = 22, H = 7.4, room = newRoom('chambers', W, D, H), g = room.group;
  room.label = 'HIGH COURT CHAMBERS';
  shell(g, W, D, H, { floorTex: checkerTex(W / 3, D / 3, '#e8e0cc', '#6a6a72'), wall: '#efe6d0', wain: '#4a2e16', wainH: 2.2, ceil: '#e6dcc4', trim: '#c9a227' });
  B(g, 2.8, 0.03, 17, '#7a0c1e', 0, 0.02, 1.8, { cast: false });
  B(g, 15, 0.9, 3.8, '#3a2411', 0, 0.45, -9.1); B(g, 15.2, 0.08, 3.9, '#c9a227', 0, 0.92, -9.1, { cast: false });
  B(g, 11.4, 1.2, 1.0, '#4a2e16', 0, 1.5, -7.7); B(g, 11.6, 0.1, 1.2, '#c9a227', 0, 2.15, -7.7, { cast: false });
  B(g, 10.0, 0.8, 0.04, '#7a0c1e', 0, 1.55, -7.18, { cast: false });
  const seats = [];
  [-3.2, 0, 3.2].forEach((x, i) => { chair(g, x, 0.9, -9.5, 0, '#3a2411', true); B(g, 1.3, 1.6, 0.08, '#7a0c1e', x, 2.4, -10.3, { cast: false }); seats.push({ i, x, nodes: [] }); });
  const sideSeats = [];  // nodes hidden for High Court tier
  const gavelProp = makeProp('gavel'); gavelProp.position.set(1.8, 2.25, -7.7); gavelProp.rotation.z = -PI / 2.4; g.add(gavelProp);
  const emb = emblem(room, 0, 4.9, -10.92, 0, 2.5, 'SATYAMEVA JAYATE');
  flagPole(room, -6.4, 0.9, -10.3, 0); flagPole(room, 6.4, 0.9, -10.3, 0);
  col(room, 0, -8.8, 15.2, 4.3);
  // Pillars
  [-9, 9].forEach(x => [-5, 1, 7].forEach(z => {
    C(g, 0.62, 0.7, H - 0.3, '#efe0c0', x, (H - 0.3) / 2, z, { seg: 10 }); C(g, 0.78, 0.78, 0.3, '#c9a227', x, 0.15, z, { seg: 10, cast: false }); C(g, 0.78, 0.78, 0.3, '#c9a227', x, H - 0.45, z, { seg: 10, cast: false });
    col(room, x, z, 1.5, 1.5);
  }));
  // Lectern and counsel tables
  B(g, 1.0, 1.2, 0.7, '#4a2e16', 0, 0.6, -3.0); B(g, 1.1, 0.08, 0.8, '#c9a227', 0, 1.24, -3.0, { cast: false }); C(g, 0.015, 0.015, 0.3, '#222', 0, 1.4, -3.05, { seg: 4, cast: false });
  col(room, 0, -3.0, 1.2, 0.9);
  [-1, 1].forEach(side => {
    const tx = side * 6;
    desk(g, tx, 0, -1.0, 3.8, 1.1, 0.9, '#6b4220');
    const pl = label(side < 0 ? 'PETITIONER' : 'RESPONDENT', { w: 1.8, h: 0.32, bg: side < 0 ? '#1b2a5c' : '#7a0c1e', fg: '#ffffff' }); pl.position.set(tx, 0.62, -0.43); g.add(pl);
    chair(g, tx - 1.0, 0, 0.5, PI, '#3a2411'); chair(g, tx + 1.0, 0, 0.5, PI, '#3a2411');
    const b1 = makeProp('book', { color: side < 0 ? '#1b2a5c' : '#7a0c1e' }); b1.position.set(tx - 0.8, 0.96, -1.0); g.add(b1);
    col(room, tx, -1.0, 3.9, 1.2);
  });
  // Gallery
  [6.8, 8.4].forEach(z => [-1, 1].forEach(side => { bench(g, side * 5.2, z, 7, PI); col(room, side * 5.2, z, 7, 0.8); for (let i = 0; i < 5; i++) room.seats.push({ x: room.off.x + side * 5.2 - 2.8 + i * 1.4, z: room.off.z + z - 0.05, y: 0, ry: PI }); }));
  // Tall windows, posters, lights
  [-6, 1, 8].forEach(z => { windowPane(room, -13.9, 3.8, z, PI / 2, 1.8, 3.4, true); windowPane(room, 13.9, 3.8, z, -PI / 2, 1.8, 3.4, true); });
  poster(room, 0, 4.2, 10.93, PI, 5.6, 2.4, 'BASIC STRUCTURE DOCTRINE\nKesavananda Bharati v. State of Kerala (1973)\nParliament may amend the Constitution\nbut cannot destroy its basic structure.', { size: 17, bg: '#f3e7c9' });
  fan(room, -5, 1, 3); fan(room, 5, 1, 3); fan(room, 0, 7, 3);
  [-6, 0, 6].forEach(x => [-4, 3].forEach(z => tube(room, x, z, 2.4)));
  const d = door(room, 'exit', 'corridor', 0, D / 2 - 0.02, PI, { label: 'EXIT TO LOBBY', color: '#4a2e16' });
  anc(room, 'spawn', 0, 9.4, PI);
  anc(room, 'judgeSeat', 0, -9.5, 0, 0.9); anc(room, 'judgeSeat2', -3.2, -9.5, 0, 0.9); anc(room, 'judgeSeat3', 3.2, -9.5, 0, 0.9);
  anc(room, 'arena', 0, 1.0, 0); anc(room, 'fightA', -1.7, 1.0, PI / 2); anc(room, 'fightB', 1.7, 1.0, -PI / 2);
  anc(room, 'defenseSeat', -6.9, 0.55, PI); anc(room, 'prosSeat', 6.9, 0.55, PI); anc(room, 'lectern', 0, -2.0, PI);
  anc(room, 'pick_brief', -5.8, -1.0, 0, 1.2); anc(room, 'pick_gavel', 1.8, -7.7, 0, 2.5);
  room.arenaR = 3.2; room.camHeading = PI;
  room.emblemLabel = emb;
  finalizeBooks(room);
  return room;
}
function setCircuitTier(tier) {
  const r = G.rooms.chambers; if (!r) return;
  const sc = tier >= 3;
  r.label = sc ? 'SUPREME COURT OF INDIA' : 'HIGH COURT CHAMBERS';
  if (r.emblemLabel) r.emblemLabel.userData.setText(sc ? 'YATO DHARMASTATO JAYAH' : 'SATYAMEVA JAYATE');
  r.tier = tier;
}

/* ---------------------------------------------------------
   LOBBY / CORRIDOR HUB
   --------------------------------------------------------- */
function buildCorridor() {
  const W = 26, D = 16, H = 4.8, room = newRoom('corridor', W, D, H), g = room.group;
  room.label = 'BAR ASSOCIATION LOBBY';
  shell(g, W, D, H, { floorTex: checkerTex(W / 2.5, D / 2.5, '#e6dcc0', '#7d6a50'), wall: '#e8dbb8', wain: '#6a1424', wainH: 1.4, ceil: '#d8cdb0', trim: '#2e1c0c' });
  // Doors on all four walls
  const dCourt = door(room, 'to_courtroom', 'courtroom', -W / 2 + 0.02, 0, PI / 2, { label: 'DISTRICT COURT' });
  const dLib = door(room, 'to_library', 'library', W / 2 - 0.02, 0, -PI / 2, { label: 'BAR LIBRARY' });
  const dThana = door(room, 'to_thana', 'thana', 0, -D / 2 + 0.02, 0, { label: 'POLICE THANA', signBg: '#3d5a40' });
  const dCham = door(room, 'to_chambers', 'chambers', 0, D / 2 - 0.02, PI, { label: 'HIGH & SUPREME COURT', color: '#4a2e16', locked: true, lockText: 'Reach High Court rank', signBg: '#7a0c1e' });
  // Central scales
  C(g, 1.0, 1.15, 0.5, '#8a8a8a', 0, 0.25, 0, { seg: 12 }); const sc = makeProp('scales'); sc.scale.setScalar(2.2); sc.position.set(0, 0.5, 0); g.add(sc);
  const bl = label('SAMVIDHAN BAR ASSOCIATION', { w: 4.6, h: 0.6, bg: '#5a3a1e', fg: '#ffd21f' }); bl.position.set(0, 4.3, -7.9); g.add(bl);
  col(room, 0, 0, 2.4, 2.4);
  // Newspaper stand + cause list
  B(g, 1.8, 0.9, 0.7, '#5a3a1e', -4.5, 0.45, -6.9); for (let i = 0; i < 4; i++) B(g, 0.5, 0.04, 0.4, '#efe6d0', -5.0 + i * 0.3, 0.92 + i * 0.03, -6.9, { rx: -0.05, cast: false });
  const nl = label('SAMVIDHAN SAMACHAR', { w: 2.4, h: 0.4, bg: '#efe6d0', fg: '#1d1608', font: 'Playfair Display, Times New Roman, serif', weight: '900', border: '#1d1608' }); nl.position.set(-4.5, 1.9, -7.55); g.add(nl);
  col(room, -4.5, -6.9, 1.9, 0.8);
  B(g, 3.4, 2.0, 0.1, '#5a3a1e', 4.8, 2.0, -7.85); B(g, 3.2, 1.8, 0.04, '#c79a5a', 4.8, 2.0, -7.78, { cast: false });
  for (let i = 0; i < 8; i++) B(g, 0.6, 0.45, 0.02, ['#fffdf2', '#ffe9a8'][i % 2], 3.8 + (i % 4) * 0.66, 2.3 - Math.floor(i / 4) * 0.7, -7.75, { cast: false });
  const cl = label('CAUSE LIST', { w: 1.8, h: 0.4, bg: '#7a0c1e', fg: '#ffd21f' }); cl.position.set(4.8, 3.3, -7.78); g.add(cl);
  // Posters
  poster(room, -4.2, 2.9, 7.93, PI, 3.3, 2.3, 'PART III: FUNDAMENTAL RIGHTS\nEquality ................. Arts 14-18\nFreedom .................. Arts 19-22\nAgainst Exploitation ..... Arts 23-24\nReligion ................. Arts 25-28\nCulture & Education ...... Arts 29-30\nConstitutional Remedies .. Art 32', { size: 12 });
  poster(room, 4.2, 2.9, 7.93, PI, 3.3, 2.3, 'THREE NEW CRIMINAL LAWS\n(in force 1 July 2024)\nBNS  replaced the IPC\nBNSS replaced the CrPC\nBSA  replaced the Evidence Act\nNew: snatching, organised crime,\nmob lynching, community service', { size: 12 });
  // Benches, plants, fans
  bench(g, -9.5, -6.7, 4, 0); bench(g, 9.5, -6.7, 4, 0); bench(g, -9.5, 6.9, 4, PI); bench(g, 9.5, 6.9, 4, PI);
  col(room, -9.5, -6.7, 4, 0.8); col(room, 9.5, -6.7, 4, 0.8); col(room, -9.5, 6.9, 4, 0.8); col(room, 9.5, 6.9, 4, 0.8);
  plant(g, -11.8, -7.0, 1.2); plant(g, 11.8, -7.0, 1.2); plant(g, -11.8, 7.0, 1.2); plant(g, 11.8, 7.0, 1.2); plant(g, -2.0, -7.2, 0.9); plant(g, 2.0, 7.2, 0.9);
  windowPane(room, -12.9, 3.2, -5, PI / 2, 1.3, 1.6, true); windowPane(room, 12.9, 3.2, -5, -PI / 2, 1.3, 1.6, true); windowPane(room, -12.9, 3.2, 5, PI / 2, 1.3, 1.6, true); windowPane(room, 12.9, 3.2, 5, -PI / 2, 1.3, 1.6, true);
  fan(room, -6, 0, 3.6); fan(room, 6, 0, 3.6); [-8, -3, 3, 8].forEach(x => tube(room, x, 0, 2.2));
  anc(room, 'spawn', 0, 3.4, PI);
  anc(room, 'from_courtroom', -10.4, 0, PI / 2); anc(room, 'from_library', 10.4, 0, -PI / 2); anc(room, 'from_thana', 0, -5.4, 0); anc(room, 'from_chambers', 0, 5.4, PI);
  anc(room, 'newsStand', -4.5, -5.6, 0); anc(room, 'causeList', 4.8, -6.2, 0); anc(room, 'guide', 3.2, 2.4, -PI / 2);
  anc(room, 'arena', 0, 4.0, 0); anc(room, 'fightA', -1.6, 4.0, PI / 2); anc(room, 'fightB', 1.6, 4.0, -PI / 2);
  room.arenaR = 2.5;
  dCourt.spawn = room.anchors.from_courtroom; dLib.spawn = room.anchors.from_library; dThana.spawn = room.anchors.from_thana; dCham.spawn = room.anchors.from_chambers;
  // destination spawns are filled in after every room exists (see buildAll)
  room.camHeading = PI;
  finalizeBooks(room);
  return room;
}

/* ---------------------------------------------------------
   Pickups (floating props) + room switching
   --------------------------------------------------------- */
function spawnPickup(roomId, type, x, y, z, opts) {
  const room = G.rooms[roomId]; if (!room) return null;
  const grp = new T.Group(); grp.position.set(x - room.off.x, y, z - room.off.z); room.group.add(grp);
  const prop = makeProp(type, opts); prop.scale.setScalar(1.35); grp.add(prop);
  const glow = new T.Sprite(new T.SpriteMaterial({ map: dotTex(), color: 0xffd21f, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.8 }));
  glow.scale.set(1.1, 1.1, 1); grp.add(glow);
  const pk = { type, roomId, x, y, z, group: grp, collected: false, r: 1.1 };
  let t = Math.random() * 6;
  const up = addUpdater(dt => {
    if (pk.collected) return true;
    t += dt; grp.position.y = y + Math.sin(t * 2.4) * 0.07; prop.rotation.y += dt * 1.7; glow.material.opacity = 0.55 + Math.sin(t * 4) * 0.25;
    return false;
  });
  pk.remove = function () { pk.collected = true; if (grp.parent) grp.parent.remove(grp); removeUpdater(up); };
  return pk;
}

function showRoom(id) {
  Object.keys(G.rooms).forEach(k => { G.rooms[k].group.visible = (k === id); });
  const r = G.rooms[id]; if (!r) return null;
  G.current = id;
  CAM.bounds = r.camBounds;
  setMood(id, !G.mood);
  if (G.sun) { G.sun.shadow.camera.far = 40; }
  return r;
}
function buildAll() {
  buildCorridor(); buildCourtroom(); buildLibrary(); buildThana(); buildChambers();
  // link destination spawns for hub doors
  const hub = G.rooms.corridor;
  hub.doors.forEach(d => { const dest = G.rooms[d.to]; if (dest) d.destSpawn = dest.anchors.spawn; });
}

/* =========================================================
   FRAME LOOP, COLLISION, NPC -> RIG, PUBLIC API
   ========================================================= */
function update(dt) {
  if (!G.ready) return;
  dt = Math.min(dt, 0.05); G.time += dt;
  for (let i = 0; i < G.chars.length; i++) G.chars[i].update(dt);
  for (let i = G.updaters.length - 1; i >= 0; i--) { let rm = false; try { rm = G.updaters[i](dt, G.time); } catch (e) { rm = true; console.error(e); } if (rm) G.updaters.splice(i, 1); }
  updateParticles(dt); updateFx(dt); updateMood(dt); updateCamera(dt);
  G.sun.position.set(CAM.look.x + 6, 12, CAM.look.z + 4); G.sun.target.position.copy(CAM.look); G.sun.target.updateMatrixWorld();
}
function render() { if (G.ready) G.renderer.render(G.scene, G.camera); }
function frame(dt) { update(dt); render(); }

/* Push a circle (x,z,r) out of the room's colliders and keep it inside the walls. */
function collide(roomId, x, z, r) {
  const room = G.rooms[roomId || G.current]; if (!room) return { x, z, hit: false };
  r = r || 0.38; let hit = false;
  const b = room.bounds;
  for (let pass = 0; pass < 2; pass++) {
    x = clamp(x, b.minX, b.maxX); z = clamp(z, b.minZ, b.maxZ);
    for (let i = 0; i < room.colliders.length; i++) {
      const c = room.colliders[i];
      const nx = clamp(x, c.minX, c.maxX), nz = clamp(z, c.minZ, c.maxZ);
      const dx = x - nx, dz = z - nz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; x += dx * k; z += dz * k; }
        else { // centre inside the box: push out the shortest way
          const l = x - c.minX, rr = c.maxX - x, t2 = z - c.minZ, bb = c.maxZ - z, m = Math.min(l, rr, t2, bb);
          if (m === l) x = c.minX - r; else if (m === rr) x = c.maxX + r; else if (m === t2) z = c.minZ - r; else z = c.maxZ + r;
        }
      }
    }
  }
  x = clamp(x, b.minX, b.maxX); z = clamp(z, b.minZ, b.maxZ);
  return { x, z, hit };
}

/* Map a State.js roster NPC (or the player) to a rig */
function rigFromNpc(npc) {
  const lk = npc.look || {};
  const isJudge = npc.role === 'judge', isMentor = npc.role === 'mentor';
  return createCharacter({
    role: npc.role, name: npc.name, female: !!lk.female, build: lk.build || 'avg', height: lk.height || 1,
    skin: lk.skin || 0, hair: isMentor || (npc.tier >= 2 && npc.role !== 'police') ? 3 : (lk.hair || 0),
    robe: lk.robe || (isJudge ? '#5a0f1c' : '#141414'), senior: isMentor || (isJudge && npc.tier >= 2),
    trim: isJudge ? '#c9a227' : isMentor ? '#c9a227' : (npc.role === 'prosecutor' ? '#7a0c1e' : null),
    glasses: !!(isMentor || (lk.skin + (lk.hair || 0)) % 3 === 0), beard: !lk.female && ((lk.hair || 0) + (lk.skin || 0)) % 4 === 1 && npc.role !== 'police'
  });
}
function rigForPlayer(player, look) {
  look = look || {};
  return createCharacter({ role: 'player', name: player.name, female: !!look.female, build: look.build || 'avg', height: 1.0, skin: look.skin === undefined ? 2 : look.skin, hair: look.hair || 0, robe: player.robe || '#1a1a1a', trim: '#ffd21f' });
}
function rigCivilian(opts) {
  opts = opts || {};
  return createCharacter(Object.assign({ role: 'civilian', skin: Math.floor(rnd(0, 6)), hair: Math.floor(rnd(0, 5)), female: Math.random() < 0.45, build: pickOne(['slim', 'avg', 'broad']), height: rnd(0.94, 1.06), shirt: pickOne(['#c0392b', '#2c7be5', '#2ebf5b', '#e8a800', '#8e44ad', '#e8e8e8', '#f39c12']), pants: pickOne(['#2a2a32', '#3a3a50', '#4a3a2a']) }, opts));
}

function getRoom(id) { return G.rooms[id || G.current] || null; }
function dispose() { if (G.renderer) G.renderer.dispose(); G.ready = false; }

SV.Graphics = {
  THREE: T, G,
  // setup
  init, resize, setLowGfx, buildAll, showRoom, getRoom, setMood, dispose,
  get scene() { return G.scene; }, get camera() { return G.camera; }, get renderer() { return G.renderer; },
  get currentRoom() { return G.current; }, get rooms() { return G.rooms; },
  // frame
  update, render, frame,
  // characters & props
  createCharacter, rigFromNpc, rigForPlayer, rigCivilian, addChar, removeChar, clearChars, makeProp, spawnPickup,
  get chars() { return G.chars; },
  // rooms
  collide, setDoorLocked, setCircuitTier,
  // camera
  cameraFollow, cameraFight, cameraLockup, cameraVerdict, cameraShot, setCameraHeading, getCameraBasis, snapCamera, shake, punchFov,
  set cameraAutoYaw(v) { CAM.autoYaw = !!v; }, get cameraHeading() { return CAM.heading; },
  // fx
  burst, popup, impact, label, addUpdater, removeUpdater,
  util: { clamp, lerp, damp, angDiff, rnd, pickOne }
};

})(typeof window !== 'undefined' ? window : globalThis);
