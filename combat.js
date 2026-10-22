/* =========================================================
   SAMVIDHAN: LEGAL EMPIRE — src/combat.js
   Courtroom argument dispute engine.

   Combat.start({ cs, player, opponent, npc, judge, room, onEnd })
   Combat.update(dt, input)       call every frame (also during the fight's pauses)
   Combat.isActive()  Combat.abort()  Combat.debug()

   input = {
     mx, mz        camera-relative WORLD move vector, length <= 1
     sx, sy        raw joystick (right +, up +) — used for G + direction moves
     A, G, R, P, T edge-pressed THIS frame (booleans)
     held: { R }   run button held
   }

   MECHANICS
   • A  Argue: strike combo (3rd hit = OBJECTION!). Opponents can block, or REVERSE if their Precedent Recall beats yours.
   • G + direction  Constitutional moves.
       Up Art 21 (shield) · Down Habeas Corpus · Left Art 14 · Right Art 19 (counter-interrogation throw)
     THE CITATION MATRIX: opponents telegraph attacks. Cite the matching provision during the wind-up to REVERSE it:
       DEPRIVE OF LIBERTY -> Art 21 (Up)      ILLEGAL DETENTION -> Habeas Corpus (Down)
       ARBITRARY CHARGE   -> Art 14 (Left)    GAG ORDER         -> Art 19 (Right)
     Status effects (detained / charged / gagged) are broken by the matching citation.
   • G (no direction) beside the opponent: OBJECTION LOCK-UP = a timed legal question about the case (or the codex).
       Right answer: huge damage + momentum. Wrong: you are overruled. Wrong/right answers feed spaced repetition.
   • G (no direction) far away: brace.   • T: taunt (flow + bait, but you take more damage).
   • Judge's Leaning meter: +/- 1 forces an early ruling.
   • Opponent health 0 -> press G beside them: VERDICT HOLD, three gavels, they may kick out.
     If YOUR fortitude hits 0, mash A / G to escape the count.
   ========================================================= */
(function (global) {
'use strict';

const SV = global.Samvidhan = global.Samvidhan || {};
const doc = global.document;
const $ = id => doc.getElementById(id);
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rnd(a, b) { return a + Math.random() * (b - a); }
function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function GFX() { return SV.Graphics; }
function ST() { return SV.State; }
function sfx(name, o) { try { if (SV.Audio) SV.Audio.play(name, o); } catch (e) { /* audio must never break combat */ } }
function voice(name, o) { try { if (SV.Audio) SV.Audio.say(name, o); } catch (e) { /* ignore */ } }

/* ---------------------------------------------------------
   Data
   --------------------------------------------------------- */
const ARROW = { up: '▲', down: '▼', left: '◀', right: '▶' };
const ATTACKS = {
  plain:     { text: 'HEAVY ARGUMENT!',      dmg: 1.0, reach: 2.1, wind: 0.75, counter: null },
  liberty:   { text: 'DEPRIVE OF LIBERTY!',  dmg: 1.7, reach: 3.2, wind: 1.25, counter: 'up',    kind: 'article', ref: '21',    name: 'Article 21',    learn: 'Art 21: no one is deprived of life or personal liberty except by procedure established by law.' },
  detention: { text: 'ILLEGAL DETENTION!',   dmg: 0.6, reach: 3.2, wind: 1.25, counter: 'down',  kind: 'writ',    ref: 'habeas', name: 'Habeas Corpus', learn: 'Habeas corpus (Arts 32 & 226) tests whether a detention is lawful.', status: 'detained', dur: 2.6, statusText: 'DETAINED!' },
  arbitrary: { text: 'ARBITRARY CHARGE!',    dmg: 0.6, reach: 3.2, wind: 1.25, counter: 'left',  kind: 'article', ref: '14',    name: 'Article 14',    learn: 'Art 14: equality before law. Arbitrary State action violates it (E.P. Royappa).', status: 'charged', dur: 4.0, statusText: 'CHARGED!' },
  gag:       { text: 'GAG ORDER!',           dmg: 0.6, reach: 3.2, wind: 1.25, counter: 'right', kind: 'article', ref: '19',    name: 'Article 19',    learn: 'Art 19(1)(a): freedom of speech and expression, subject to reasonable restrictions.', status: 'gagged', dur: 3.2, statusText: 'GAGGED!' }
};
const COUNTER_BY_DIR = { up: 'liberty', down: 'detention', left: 'arbitrary', right: 'gag' };
const PERSONA = {
  aggressive: { atk: 0.78, block: 0.12, move: 1.15, circle: 0.0, plainW: 1.6, matrixW: 0.8 },
  technical:  { atk: 1.0,  block: 0.30, move: 1.0,  circle: 0.2, plainW: 0.5, matrixW: 1.7 },
  slippery:   { atk: 1.0,  block: 0.20, move: 1.25, circle: 1.0, plainW: 1.0, matrixW: 1.2, rev: 1.4 },
  steady:     { atk: 1.0,  block: 0.30, move: 1.0,  circle: 0.3, plainW: 1.0, matrixW: 1.0 }
};
const VERDICT_WIN  = { trial: ['ACQUITTED', 'CLIENT ACQUITTED'], bail: ['GRANTED', 'BAIL GRANTED'], pil: ['ALLOWED', 'PIL ALLOWED'], writ: ['ISSUED', 'WRIT ISSUED'], appeal: ['ALLOWED', 'APPEAL ALLOWED'] };
const VERDICT_LOSE = { trial: ['CONVICTED', 'CLIENT CONVICTED'], bail: ['REJECTED', 'BAIL REJECTED'], pil: ['DISMISSED', 'PIL DISMISSED'], writ: ['DISMISSED', 'WRIT DISMISSED'], appeal: ['DISMISSED', 'APPEAL DISMISSED'] };
function verdictWords(cs, won) {
  const t = (cs && cs.type) || 'bail', tab = won ? VERDICT_WIN : VERDICT_LOSE, w = tab[t] || tab.bail;
  return { stamp: w[0], title: w[1], dismissed: !won };
}
const FIGHT_LIMIT = 180;   // seconds before the Bench decides on its own

let S = null;

/* ---------------------------------------------------------
   HUD / DOM helpers
   --------------------------------------------------------- */
let _coTimer = null;
function callout(text, cls) {
  const el = $('callout'); if (!el) return;
  el.classList.remove('hidden', 'good', 'bad'); if (cls) el.classList.add(cls);
  el.textContent = text; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(_coTimer); _coTimer = setTimeout(() => el.classList.add('hidden'), 1000);
}
function toast(text, cls) {
  const box = $('toast-container'); if (!box) return;
  const d = doc.createElement('div'); d.className = 'toast' + (cls ? ' ' + cls : ''); d.textContent = text; box.appendChild(d);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 3000);
}
function setBar(id, frac, num) {
  const el = $(id); if (!el) return;
  const f = el.querySelector('.fill'); if (f) f.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
  const n = el.querySelector('.bar-num'); if (n && num !== undefined) n.textContent = Math.max(0, Math.round(num));
  el.classList.toggle('low', frac < 0.25);
}
function showPrompt(key, text) {
  const el = $('interact-prompt'); if (!el) return;
  const k = el.querySelector('.key-chip'); if (k) k.textContent = key;
  const t = $('interact-text'); if (t) t.textContent = text;
  el.classList.remove('hidden');
}
function hidePrompt() { const el = $('interact-prompt'); if (el) el.classList.add('hidden'); }
function gavelUI(num, text) {
  const el = $('gavel-countdown'); if (!el) return;
  const n = $('gavel-number'), t = $('gavel-text');
  if (n) { n.textContent = num; n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; n.style.display = num === '' ? 'none' : ''; }
  if (t) t.textContent = text || '';
  el.classList.remove('hidden');
  const gi = el.querySelector('.gavel-icon'); if (gi) { gi.style.animation = 'none'; void gi.offsetWidth; gi.style.animation = ''; }
}
function hideGavelUI() { const el = $('gavel-countdown'); if (el) el.classList.add('hidden'); const n = $('gavel-number'); if (n) n.style.display = ''; }
function flash(red) {
  const f = $('flash-layer'); if (!f) return;
  f.classList.remove('flash', 'flash-red'); void f.offsetWidth; f.classList.add(red ? 'flash-red' : 'flash');
  setTimeout(() => f.classList.remove('flash', 'flash-red'), 60);
}
function updateHud() {
  if (!S) return;
  setBar('bar-fortitude', S.pHp / S.pMax, S.pHp);
  setBar('bar-flow', S.pFlow / S.pFlowMax, S.pFlow);
  setBar('bar-opp-health', S.oHp / S.oMax, S.oHp);
  setBar('bar-opp-flow', S.oFlow / S.oFlowMax, S.oFlow);
  const vb = $('bar-verdict'); if (vb) { const f = vb.querySelector('.fill'); if (f) f.style.left = ((S.lean + 1) / 2 * 96 + 0).toFixed(1) + '%'; }
}

/* ---------------------------------------------------------
   Geometry helpers
   --------------------------------------------------------- */
function pp(rig) { return rig.group.position; }
function dist(a, b) { const p = pp(a), q = pp(b); return Math.hypot(p.x - q.x, p.z - q.z); }
function angleTo(a, b) { const p = pp(a), q = pp(b); return Math.atan2(q.x - p.x, q.z - p.z); }
function constrain(x, z) {
  const a = S.arena, R = S.arenaR + 1.3;
  let dx = x - a.x, dz = z - a.z; const d = Math.hypot(dx, dz);
  if (d > R) { x = a.x + dx / d * R; z = a.z + dz / d * R; }
  const c = GFX().collide(S.room, x, z, 0.4);
  return { x: c.x, z: c.z };
}
function moveRig(rig, dx, dz) {
  const p = pp(rig), c = constrain(p.x + dx, p.z + dz);
  p.x = c.x; p.z = c.z;
}
function separate() {
  const P = pp(S.P), O = pp(S.O), dx = O.x - P.x, dz = O.z - P.z, d = Math.hypot(dx, dz), min = 0.9;
  if (d < min && d > 1e-4) {
    const k = (min - d) / 2 / d; let c1 = constrain(P.x - dx * k, P.z - dz * k), c2 = constrain(O.x + dx * k, O.z + dz * k);
    P.x = c1.x; P.z = c1.z; O.x = c2.x; O.z = c2.z;
  }
}
function needHint(type) {
  const a = ATTACKS[type]; if (!a || !a.kind) return false;
  try { return ST().getMastery(a.kind, a.ref).box < 3; } catch (e) { return true; }
}

/* ---------------------------------------------------------
   Start / end
   --------------------------------------------------------- */
function start(opts) {
  if (S) abort();
  const st = ST(), gx = GFX();
  const cs = opts.cs || {};
  const npc = opts.npc || (cs.opponentId && st.getNpc ? st.getNpc(cs.opponentId) : null) || { name: 'Opposing Counsel', role: 'advocate', tier: 0, stats: { power: 40, flow: 40, recall: 40, fortitude: 40 }, persona: 'steady' };
  const roomId = opts.room || gx.currentRoom, room = gx.getRoom(roomId);
  const ps = Object.assign({}, st.data.player.stats), os = Object.assign({ power: 40, flow: 40, recall: 40, fortitude: 40 }, npc.stats);
  S = {
    cs, npc, P: opts.player, O: opts.opponent, judge: opts.judge || null, room: roomId, onEnd: opts.onEnd || function () {},
    phase: 'intro', t: 0, fightT: 0, tier: npc.tier || 0, persona: npc.persona || 'steady',
    arena: room.anchors.arena, arenaR: room.arenaR || 3,
    pStats: ps, oStats: os,
    pMax: st.maxHealth(), pFlowMax: st.maxFlow(), oMax: Math.round(55 + os.fortitude * 0.9), oFlowMax: Math.round(60 + os.flow),
    lean: 0, mom: 0, correct: 0, total: 0, byDecision: false,
    cd: { A: 0, G: 0, T: 0 }, combo: { n: 0, t: 0 },
    st: { detained: 0, charged: 0, gagged: 0, shield: 0, taunt: 0, brace: 0, grace: 0 }, dotAcc: 0,
    ai: { state: 'approach', t: 0, nextAtk: rnd(1.6, 2.6), atk: null, wind: 1, stun: 0, kd: 0, kdOn: false, block: 0, exh: 0, rec: 0, circle: 1, circleT: 2 },
    askedCase: false, asked: {}, learned: {}, told: {}, cite: null, count: null, fin: null, reveal: null, counters: 0,
    diffMul: 0.85 + 0.15 * (cs.difficulty || 1),
    prevCase: ($('case-title') || {}).textContent
  };
  S.pHp = S.pMax; S.pFlow = S.pFlowMax; S.oHp = S.oMax; S.oFlow = S.oFlowMax;

  const a = room.anchors;
  S.P.setPosition(a.fightA.x, a.fightA.y || 0, a.fightA.z); S.P.setFacing(a.fightA.ry);
  S.O.setPosition(a.fightB.x, a.fightB.y || 0, a.fightB.z); S.O.setFacing(a.fightB.ry);
  S.P.setState('auto'); S.O.setState('auto'); S.P.setTargeted(false); S.O.setTargeted(true);
  gx.cameraFight(S.P, S.O); gx.snapCamera();

  const op = $('opponent-panel'); if (op) op.classList.remove('hidden');
  const vm = $('verdict-meter'); if (vm) vm.classList.remove('hidden');
  const on = $('opp-name'); if (on) on.textContent = String(npc.name || 'OPPONENT').toUpperCase();
  const orl = $('opp-role'); if (orl) orl.textContent = (st.roleLabel ? st.roleLabel(npc.role) : npc.role).toUpperCase();
  const ct = $('case-title'); if (ct) ct.textContent = cs.title || 'CASE';
  hideGavelUI(); hidePrompt(); hideCite();
  updateHud();
  callout('COURT IS IN SESSION!');
  if (S.judge) { S.judge.talk(1.2); S.judge.play('gavel'); }
  sfx('gavel', { strength: 1 });
  try { if (SV.Audio) { SV.Audio.startMusic('fight'); SV.Audio.setTension(0.3); } } catch (e) { /* ignore */ }
}

function cleanupUI() {
  hideGavelUI(); hidePrompt(); hideCite();
  const op = $('opponent-panel'); if (op) op.classList.add('hidden');
  const vm = $('verdict-meter'); if (vm) vm.classList.add('hidden');
  const co = $('callout'); if (co) co.classList.add('hidden');
  const ct = $('case-title'); if (ct && S && S.prevCase !== undefined) ct.textContent = S.prevCase;
  try { if (SV.Audio) SV.Audio.stopMusic(); } catch (e) { /* ignore */ }
}
function abort() {
  if (!S) return;
  try { S.P.setState('auto'); S.O.setState('auto'); S.O.setTargeted(false); } catch (e) { /* ignore */ }
  cleanupUI(); S = null;
}
function finish(won) {
  if (!S) return;
  const s = S, w = verdictWords(s.cs, won);
  try { s.O.setTargeted(false); } catch (e) { /* ignore */ }
  cleanupUI();
  const result = { won, correct: s.correct, total: s.total, byDecision: s.byDecision, stamp: w.stamp, title: w.title, dismissed: w.dismissed, counters: s.counters, hp: s.pHp / s.pMax };
  S = null;
  s.onEnd(result);
}

/* ---------------------------------------------------------
   Damage
   --------------------------------------------------------- */
function baseP() { return 5 + S.pStats.power * 0.14; }
function baseO() { return (5 + S.oStats.power * 0.12) * S.diffMul; }

function hitOpp(dmg, o) {
  o = o || {};
  const gx = GFX(), p = pp(S.O);
  S.oHp = Math.max(0, S.oHp - dmg);
  S.O.play('hit'); sfx(o.heavy ? 'ko' : 'hit');
  gx.popup('-' + Math.round(dmg), p.x, p.y + 2.3, p.z, { color: o.heavy ? '#ff7a3d' : '#ffd21f', size: o.heavy ? 0.7 : 0.5 });
  gx.impact(p.x, p.y + 1.4, p.z, o.heavy ? 1.6 : 1.1); gx.burst(p.x, p.y + 1.3, p.z, 'spark', o.heavy ? 18 : 8);
  if (o.heavy) { gx.shake(0.18, 0.28); gx.punchFov(3); }
  S.lean = clamp(S.lean + (o.lean || 0.04), -1, 1);
  if (!o.noStun) S.ai.stun = Math.max(S.ai.stun, o.stun || 0.25);
  if (S.ai.state === 'windup' && !o.keepWind) { S.ai.state = 'approach'; S.ai.atk = null; S.ai.nextAtk = rnd(1.0, 1.8); }
  S.O.talk(0.3);
}
function damagePlayer(dmg, o) {
  o = o || {};
  const gx = GFX(), p = pp(S.P);
  if (S.st.grace > 0 && !o.bypass) return 0;
  if (!o.bypass) {
    if (S.st.shield > 0) dmg *= 0.4;
    if (S.st.brace > 0) dmg *= 0.25;
    if (S.st.taunt > 0) dmg *= 1.25;
    dmg *= (1 - 0.25 * S.lean);
  }
  S.pHp = Math.max(0, S.pHp - dmg);
  if (!o.silent) {
    S.P.play('hit'); sfx('hurt');
    gx.popup('-' + Math.round(dmg), p.x, p.y + 2.3, p.z, { color: '#ff5a6e', size: 0.5 });
    gx.shake(0.12, 0.22); flash(true);
    gx.burst(p.x, p.y + 1.2, p.z, 'dust', 6);
  }
  S.lean = clamp(S.lean - (o.lean === undefined ? 0.04 : o.lean), -1, 1);
  return dmg;
}

/* ---------------------------------------------------------
   Player actions
   --------------------------------------------------------- */
function stickDir(inp) {
  const sx = inp.sx || 0, sy = inp.sy || 0;
  if (Math.hypot(sx, sy) < 0.45) return null;
  if (Math.abs(sy) >= Math.abs(sx)) return sy > 0 ? 'up' : 'down';
  return sx > 0 ? 'right' : 'left';
}

function playerStrike() {
  const P = S.P, O = S.O, ai = S.ai, gx = GFX();
  S.cd.A = 0.42; S.pFlow = Math.max(0, S.pFlow - 6);
  P.faceToward(pp(O).x, pp(O).z); P.play('argue'); sfx('argue');
  if (dist(P, O) > 1.95 || ai.state === 'ko') { gx.popup('MISS', pp(P).x, 2.0, pp(P).z, { color: '#ffffff', size: 0.4 }); S.combo.n = 0; return; }
  S.combo.n = S.combo.t > 0 ? Math.min(3, S.combo.n + 1) : 1; S.combo.t = 0.95;
  const n = S.combo.n;
  let dmg = baseP() * [1, 1.15, 1.5][n - 1] * rnd(0.9, 1.1) * (1 + 0.25 * S.lean);
  const per = PERSONA[S.persona] || PERSONA.steady;
  if (ai.stun > 0 || ai.kd > 0) dmg *= 1.2;
  else if (ai.exh > 0) dmg *= 1.25;
  else {
    if (ai.state !== 'windup' && Math.random() < per.block) {
      ai.block = 0.5; O.play('block'); sfx('block'); gx.popup('BLOCKED', pp(O).x, 2.3, pp(O).z, { color: '#9ad0ff', size: 0.4 });
      S.oFlow = Math.max(0, S.oFlow - 4); hitOpp(dmg * 0.25, { noStun: true, lean: 0.0, keepWind: true }); return;
    }
    const rev = clamp(0.05 + (S.oStats.recall - S.pStats.recall) / 160, 0.03, 0.4) * (per.rev || 1);
    if (S.oStats.recall > S.pStats.recall - 5 && Math.random() < rev && ai.state !== 'windup') {
      O.play('argue'); voice('overruled', { female: !!(S.npc.look && S.npc.look.female) });
      gx.popup('REVERSED!', pp(P).x, 2.4, pp(P).z, { color: '#ff7a3d', size: 0.6 }); callout('OVERRULED!', 'bad');
      damagePlayer(baseO() * 0.8, { lean: 0.06 }); S.combo.n = 0; return;
    }
  }
  const heavy = n === 3;
  if (heavy) { callout('OBJECTION!'); voice('objection', { vol: 0.6 }); S.combo.n = 0; }
  hitOpp(dmg, { heavy, stun: heavy ? 0.7 : 0.25, lean: heavy ? 0.08 : 0.04 });
}

function counterSuccess(atk) {
  const gx = GFX(), a = ATTACKS[atk], ai = S.ai, move = ST().DB.MOVES[a.counter];
  const p = pp(S.O);
  ai.state = 'approach'; ai.atk = null; ai.nextAtk = rnd(1.6, 2.4);
  const dmg = baseP() * 1.8 * (1 + 0.25 * S.lean);
  ai.stun = 1.4;
  hitOpp(dmg, { heavy: true, stun: 1.4, lean: 0.22, keepWind: true });
  S.mom = Math.min(3, S.mom + 0.5); S.counters++;
  S.st[a.status] = 0; S.pFlow = Math.min(S.pFlowMax, S.pFlow + 8);
  callout(move.callout, 'good'); sfx(a.kind === 'writ' ? 'writ' : 'stamp'); S.P.play(a.kind === 'writ' ? 'writ' : 'cite');
  gx.burst(p.x, p.y + 1.6, p.z, 'paper', 14);
  toast(a.name + ' — ' + a.learn, 'good');
  const key = a.kind + ':' + a.ref;
  if (!S.learned[key]) { S.learned[key] = 1; try { ST().recordAnswer(a.kind, a.ref, true); } catch (e) { /* ignore */ } }
}

function doCite(dir) {
  const P = S.P, O = S.O, ai = S.ai, gx = GFX(), move = ST().DB.MOVES[dir];
  if (S.cd.G > 0) return;
  if (S.pFlow < move.cost) { callout('NO FLOW!', 'bad'); sfx('wrong'); return; }
  S.pFlow -= move.cost; S.cd.G = 0.9;
  P.faceToward(pp(O).x, pp(O).z);
  if (ai.state === 'windup' && ai.atk && ATTACKS[ai.atk].counter === dir) { counterSuccess(ai.atk); return; }
  const p = pp(P), near = dist(P, O) <= 1.9;
  P.play(move.kind === 'writ' ? 'writ' : 'cite'); sfx(move.kind === 'writ' ? 'writ' : 'stamp');
  const brokeStatus = { up: null, down: 'detained', left: 'charged', right: 'gagged' }[dir];
  if (brokeStatus && S.st[brokeStatus] > 0) { S.st[brokeStatus] = 0; callout('BROKE FREE!', 'good'); toast(move.name + ' frees you from ' + brokeStatus.toUpperCase() + '.', 'good'); }
  if (ai.state === 'windup' && ai.atk && ATTACKS[ai.atk].counter) {
    gx.popup('NOT APPLICABLE', p.x, 2.4, p.z, { color: '#ff8fa0', size: 0.45 }); sfx('wrong');
    const need = ATTACKS[ai.atk];
    toast('Wrong citation! ' + need.text.replace('!', '') + ' needs ' + need.name + ' (' + ARROW[need.counter] + ').', 'bad');
    return;
  }
  if (dir === 'up') { S.st.shield = 3.0; gx.popup('ART. 21 SHIELD', p.x, 2.3, p.z, { color: '#7fe3ff', size: 0.5 }); if (near) hitOpp(baseP() * 0.6, { lean: 0.03 }); }
  else if (dir === 'down') { if (near) hitOpp(baseP() * 0.7, { stun: 0.5, lean: 0.03 }); gx.popup('HABEAS CORPUS', p.x, 2.3, p.z, { color: '#ffd21f', size: 0.45 }); }
  else if (dir === 'left') { if (near) hitOpp(baseP() * 0.9, { lean: 0.04 }); gx.popup('ARTICLE 14', p.x, 2.3, p.z, { color: '#ffd21f', size: 0.45 }); }
  else if (dir === 'right') {
    if (near && ai.kd <= 0) {
      P.play('throw'); hitOpp(baseP() * 1.7 * (1 + 0.25 * S.lean), { heavy: true, stun: 1.2, lean: 0.1 });
      ai.kd = 1.4; callout('COUNTER-INTERROGATION!');
    } else gx.popup('TOO FAR', p.x, 2.2, p.z, { color: '#ffffff', size: 0.4 });
  }
}

function doTaunt() {
  if (S.cd.T > 0) return;
  S.cd.T = 4; S.P.play('taunt'); sfx('swoosh');
  S.pFlow = Math.min(S.pFlowMax, S.pFlow + 14); S.st.taunt = 3; S.lean = clamp(S.lean + 0.05, -1, 1);
  S.ai.nextAtk = Math.min(S.ai.nextAtk, 0.7);
  GFX().popup('TAUNT!', pp(S.P).x, 2.3, pp(S.P).z, { color: '#c9a3ff', size: 0.5 });
}

/* ---------------------------------------------------------
   Objection lock-up (citation challenge)
   --------------------------------------------------------- */
function focusFor(kind) { return { article: 'articles', writ: 'writs', bns: 'bns', bnss: 'procedure', bsa: 'procedure', case: 'cases' }[kind] || 'all'; }
function pickQuestion() {
  const st = ST();
  if (!S.askedCase && S.cs.question) { S.askedCase = true; const q = Object.assign({}, S.cs.question); q.caseQ = true; return q; }
  for (let i = 0; i < 6; i++) {
    const arr = st.makeQuestions(1, { focus: i < 3 ? focusFor(S.cs.kind) : 'all', tierMax: st.data.player.circuit + 1 });
    const q = arr && arr[0];
    if (q && !S.asked[q.id]) { S.asked[q.id] = 1; return q; }
  }
  const q = st.makeQuestions(1, { focus: 'all' })[0]; return q || Object.assign({ caseQ: true }, S.cs.question);
}
function startCitation() {
  const gx = GFX(), q = pickQuestion();
  S.cite = { q, t: 0, limit: 10 + S.pStats.flow * 0.06, hint: false, answered: false, correct: false, resultT: 0 };
  S.phase = 'citation'; S.ai.state = 'approach'; S.ai.atk = null;
  S.P.setState('lockup'); S.O.setState('lockup');
  const a = pp(S.P), b = pp(S.O), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, d = Math.max(0.9, dist(S.P, S.O));
  S.P.faceToward(b.x, b.z); S.O.faceToward(a.x, a.z);
  gx.cameraLockup(S.P, S.O); sfx('swoosh'); sfx('stamp'); callout('OBJECTION LOCK-UP!');
  S.O.setTargeted(false);
  renderCite();
}
function renderCite() {
  const c = S.cite, q = c.q, panel = $('cite-panel'); if (!panel) return;
  $('cite-title').textContent = (q.title || 'LEGAL QUESTION').toUpperCase();
  $('cite-facts').textContent = q.prompt;
  const box = $('cite-options'); box.innerHTML = '';
  q.options.forEach((label, i) => {
    const b = doc.createElement('button'); b.className = 'cite-opt'; b.textContent = label; b.setAttribute('data-i', String(i));
    b.addEventListener('click', () => answerCitation(i)); box.appendChild(b);
  });
  const hb = $('cite-hint'), ht = $('cite-hinttext');
  hb.disabled = false; hb.classList.remove('hidden'); ht.classList.add('hidden'); ht.textContent = '';
  hb.onclick = () => { if (!S || !S.cite || S.cite.answered) return; S.cite.hint = true; ht.textContent = q.hint || 'Think about the rights involved.'; ht.classList.remove('hidden'); hb.disabled = true; sfx('click'); };
  $('cite-result').classList.add('hidden'); $('cite-result').classList.remove('good', 'bad');
  $('cite-continue').onclick = () => { if (S && S.cite && S.cite.answered) endCitation(); };
  const tf = $('cite-timer-fill'); if (tf) tf.style.width = '100%'; $('cite-timer').classList.remove('low');
  panel.classList.remove('hidden');
}
function hideCite() { const p = $('cite-panel'); if (p) p.classList.add('hidden'); }

function answerCitation(i) {
  if (!S || S.phase !== 'citation' || !S.cite || S.cite.answered) return;
  const c = S.cite, q = c.q, ok = i === q.correctIndex;
  c.answered = true; c.correct = ok; c.resultT = 0;
  S.total++; if (ok) S.correct++;
  if (!q.caseQ) { try { ST().recordAnswer(q.kind, q.ref, ok); } catch (e) { /* ignore */ } }
  sfx(ok ? 'correct' : 'wrong');
  const btns = $('cite-options').querySelectorAll('.cite-opt');
  btns.forEach((b, k) => { b.disabled = true; if (k === q.correctIndex) b.classList.add('correct'); else if (k === i) b.classList.add('wrong'); });
  $('cite-hint').disabled = true;
  const res = $('cite-result'); res.classList.remove('hidden'); res.classList.add(ok ? 'good' : 'bad');
  $('cite-result-title').textContent = i === -1 ? "TIME'S UP!" : ok ? 'CORRECT!' : 'NOT QUITE';
  $('cite-result-text').textContent = q.explain || '';
}
function endCitation() {
  const c = S.cite, gx = GFX(); hideCite();
  S.P.setState('auto'); S.O.setState('auto'); S.O.setTargeted(true);
  gx.cameraFight(S.P, S.O);
  S.st.grace = 0; S.phase = 'fight'; S.cite = null;
  if (c.correct) {
    const frac = 0.28 * (c.hint ? 0.5 : 1) * (1 + 0.25 * S.lean);
    const dmg = Math.max(baseP() * 2, S.oMax * frac);
    S.mom = Math.min(3, S.mom + 1); S.ai.stun = 1.6;
    S.P.play('cite'); callout('CITED!', 'good');
    hitOpp(dmg, { heavy: true, stun: 1.6, lean: c.hint ? 0.2 : 0.3, keepWind: true });
    gx.burst(pp(S.O).x, 1.6, pp(S.O).z, 'paper', 16);
  } else {
    S.mom = 0; S.O.play('taunt'); voice('overruled', { female: !!(S.npc.look && S.npc.look.female) }); callout('OVERRULED!', 'bad');
    damagePlayer(S.pMax * 0.14, { lean: 0.25 });
    S.ai.nextAtk = rnd(1.0, 1.6);
  }
  S.st.grace = 1.0;
}

/* ---------------------------------------------------------
   Opponent AI
   --------------------------------------------------------- */
function chooseAttack() {
  const per = PERSONA[S.persona] || PERSONA.steady, c = ST().data.player.circuit;
  const pool = [['plain', 3 * per.plainW], ['liberty', 2 * per.matrixW], ['detention', 2 * per.matrixW]];
  if (c >= 1) pool.push(['arbitrary', 2 * per.matrixW]);
  if (c >= 2) pool.push(['gag', 2 * per.matrixW]);
  const total = pool.reduce((s, p) => s + p[1], 0); let r = Math.random() * total;
  for (const p of pool) { r -= p[1]; if (r <= 0) return p[0]; }
  return 'plain';
}
function beginWindup() {
  const ai = S.ai, O = S.O, gx = GFX(), type = chooseAttack(), a = ATTACKS[type];
  ai.state = 'windup'; ai.atk = type; ai.t = 0;
  ai.wind = clamp(a.wind - S.tier * 0.12 + (a.counter && needHint(type) ? 0.3 : 0), 0.55, 1.7);
  O.faceToward(pp(S.P).x, pp(S.P).z);
  O.play(type === 'plain' ? 'argue' : 'objection', { speed: Math.max(0.5, (type === 'plain' ? 0.46 : 0.8) / (ai.wind * 0.95)) });
  S.oFlow = Math.max(0, S.oFlow - 14);
  if (a.counter) {
    callout(a.text, 'bad'); voice('objection', { vol: 0.5, female: !!(S.npc.look && S.npc.look.female) });
    if (needHint(type)) gx.popup(ARROW[a.counter] + ' ' + a.name.toUpperCase(), pp(O).x, 2.75, pp(O).z, { color: '#7fe3ff', size: 0.42, life: ai.wind });
    else gx.popup('!', pp(O).x, 2.6, pp(O).z, { color: '#ff5a6e', size: 0.55, life: 0.6 });
  } else gx.popup('!', pp(O).x, 2.6, pp(O).z, { color: '#ffd21f', size: 0.5, life: 0.5 });
}
function resolveAttack() {
  const ai = S.ai, a = ATTACKS[ai.atk], gx = GFX(), P = S.P;
  sfx('swoosh');
  ai.state = 'recover'; ai.rec = 0.55;
  if (dist(P, S.O) > a.reach) { gx.popup('EVADED!', pp(P).x, 2.3, pp(P).z, { color: '#9bffb8', size: 0.5 }); S.pFlow = Math.min(S.pFlowMax, S.pFlow + 6); ai.atk = null; return; }
  const dmg = baseO() * a.dmg * rnd(0.9, 1.1);
  const braced = S.st.brace > 0, shielded = S.st.shield > 0;
  damagePlayer(dmg);
  if (a.status && !braced && !shielded) {
    S.st[a.status] = a.dur; callout(a.statusText, 'bad');
    const mv = ST().DB.MOVES[a.counter];
    if (!S.told[a.status]) { S.told[a.status] = 1; toast(a.statusText.replace('!', '') + ': cite ' + mv.name + ' (' + ARROW[a.counter] + ' + G) to break free.', 'bad'); }
  }
  ai.atk = null;
  try { if (SV.Audio) SV.Audio.setTension(clamp(1 - S.pHp / S.pMax, 0.2, 1)); } catch (e) { /* ignore */ }
}
function aiUpdate(dt) {
  const ai = S.ai, O = S.O, P = S.P, per = PERSONA[S.persona] || PERSONA.steady;
  ai.stun = Math.max(0, ai.stun - dt); ai.block = Math.max(0, ai.block - dt); ai.exh = Math.max(0, ai.exh - dt);
  if (ai.kd > 0) {
    if (!ai.kdOn) { ai.kdOn = true; O.setState('ko'); }
    ai.kd -= dt; if (ai.kd <= 0) { ai.kd = 0; ai.kdOn = false; O.setState('auto'); O.play('stagger'); }
    return;
  }
  S.oFlow = Math.min(S.oFlowMax, S.oFlow + (7 + S.oStats.flow * 0.05) * dt);
  if (S.oFlow < 6 && ai.exh <= 0) { ai.exh = 2.2; GFX().popup('TIRED', pp(O).x, 2.5, pp(O).z, { color: '#ffffff', size: 0.4 }); }
  if (ai.state === 'ko') return;
  if (ai.stun > 0) return;
  const d = dist(P, O), speed = (1.5 + 0.15 * S.tier) * per.move;
  O.turnToward(angleTo(O, P), dt, 10);
  if (ai.state === 'windup') {
    ai.t += dt;
    if (ai.t >= ai.wind) resolveAttack();
    return;
  }
  if (ai.state === 'recover') { ai.rec -= dt; if (ai.rec <= 0) { ai.state = 'approach'; ai.nextAtk = (2.4 - 0.25 * S.tier) * per.atk * rnd(0.85, 1.2); if (ai.exh > 0) ai.nextAtk += 1.2; } return; }
  // approach / circle
  const want = 1.5, p = pp(O), q = pp(P);
  let dx = q.x - p.x, dz = q.z - p.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  let mvx = 0, mvz = 0;
  if (d > want + 0.15) { mvx = dx * speed; mvz = dz * speed; }
  else if (d < want - 0.45) { mvx = -dx * speed * 0.6; mvz = -dz * speed * 0.6; }
  if (per.circle > 0 && d < 3.2) { ai.circleT -= dt; if (ai.circleT <= 0) { ai.circle = -ai.circle; ai.circleT = rnd(1.5, 3.5); } mvx += -dz * ai.circle * speed * 0.55 * per.circle; mvz += dx * ai.circle * speed * 0.55 * per.circle; }
  moveRig(O, mvx * dt, mvz * dt);
  ai.nextAtk -= dt;
  if (ai.nextAtk <= 0 && S.oFlow >= 14 && d < 2.6) beginWindup();
}

/* ---------------------------------------------------------
   Finisher: verdict hold & gavel count
   --------------------------------------------------------- */
function enterFinisher() {
  S.phase = 'finisher'; S.fin = { t: 0 };
  S.ai.state = 'ko'; S.ai.atk = null; S.ai.kd = 0; S.ai.kdOn = false; S.O.setState('ko'); S.O.setTargeted(false);
  callout('ARGUMENT DEPLETED!', 'good'); sfx('gasp');
  GFX().punchFov(4);
}
function placeBeside(mover, fixed) {
  const f = pp(fixed), m = pp(mover);
  let dx = m.x - f.x, dz = m.z - f.z; const d = Math.hypot(dx, dz) || 1;
  const px = -dz / d, pz = dx / d; // perpendicular
  const side = (px * dx + pz * dz) >= 0 ? 1 : -1;
  const c = constrain(f.x + px * 0.95 * side, f.z + pz * 0.95 * side);
  mover.setPosition(c.x, m.y, c.z); mover.faceToward(f.x, f.z);
}
function startCount(side) {
  const gx = GFX();
  S.phase = 'count'; hidePrompt();
  S.count = { side, n: 0, t: 0, started: false, escape: 0, stage: 'wait' };
  if (side === 'opp') { placeBeside(S.P, S.O); S.P.setState('lockup'); gx.cameraVerdict(S.O, S.P); }
  else { placeBeside(S.O, S.P); S.O.setState('lockup'); gx.cameraVerdict(S.P, S.O); showPrompt('A', 'MASH A / G to escape!'); }
  callout(side === 'opp' ? 'VERDICT HOLD!' : 'ARGUMENT LOST!', side === 'opp' ? 'good' : 'bad');
}
function countStep(dt, inp) {
  const c = S.count; c.t += dt;
  if (c.side === 'player') {
    c.escape = Math.max(0, c.escape - 0.22 * dt);
    if (inp.A || inp.G) { c.escape += 0.17 + S.pStats.flow * 0.002; sfx('tick'); GFX().popup('!', pp(S.P).x, 2.2, pp(S.P).z, { color: '#ffd21f', size: 0.35, life: 0.4 }); }
  }
  if (c.stage === 'wait') { if (c.t >= 0.9) { c.stage = 'gavel'; c.t = 0; c.n = 1; fireGavel(c.n); } return; }
  if (c.stage === 'gavel' && c.t >= 1.15) {
    // end of count c.n: kickout check on counts 1 and 2
    if (c.n < 3 && kickoutCheck(c)) return;
    if (c.n >= 3) { beginReveal(c.side === 'opp'); return; }
    c.n++; c.t = 0; fireGavel(c.n);
  }
}
function fireGavel(n) {
  gavelUI(String(n), 'ORDER!'); sfx('tick');
  try { if (SV.Audio) SV.Audio.gavelCount(n); } catch (e) { /* ignore */ }
  if (S.judge) { S.judge.talk(0.5); S.judge.play('gavel'); }
  GFX().shake(0.08, 0.18);
}
function kickoutCheck(c) {
  let kicked = false;
  if (c.side === 'opp') {
    const chance = clamp(0.10 + S.oStats.fortitude * 0.004 - S.mom * 0.07 - S.pStats.power * 0.0015 + (c.n === 2 ? 0.05 : 0), 0.04, 0.55);
    kicked = Math.random() < chance;
  } else kicked = c.escape >= 0.8;
  if (!kicked) return false;
  hideGavelUI(); hidePrompt(); const gx = GFX();
  if (c.side === 'opp') {
    S.oHp = Math.round(S.oMax * 0.2); S.mom = 0; S.ai.state = 'approach'; S.ai.nextAtk = rnd(1.2, 2.0); S.ai.stun = 0.9;
    S.O.setState('auto'); S.O.play('stagger'); S.P.setState('auto'); callout('KICKED OUT!', 'bad'); S.O.setTargeted(true);
  } else {
    S.pHp = Math.round(S.pMax * 0.25); S.pFlow = Math.round(S.pFlowMax * 0.5);
    S.P.setState('auto'); S.P.play('stagger'); S.O.setState('auto'); S.ai.stun = 0.9; S.ai.state = 'approach'; S.ai.nextAtk = 2; S.st.grace = 1.2;
    callout('KICKED OUT!', 'good');
  }
  sfx('gasp'); gx.cameraFight(S.P, S.O); S.phase = 'fight'; S.count = null;
  return true;
}
function playerDown() {
  S.phase = 'playerDown'; S.pHp = 0; S.P.setState('ko'); S.ai.state = 'approach'; S.ai.atk = null;
  callout('FORTITUDE LOST!', 'bad'); sfx('ko'); GFX().shake(0.2, 0.35);
  S.fin = { t: 0 };
}
function beginReveal(won, byDecision) {
  const gx = GFX(), w = verdictWords(S.cs, won);
  S.phase = 'reveal'; S.reveal = { t: 0, won }; S.byDecision = !!byDecision; S.count = null; hidePrompt();
  gavelUI('', w.stamp + '!');
  let ms = 2600; try { if (SV.Audio) ms = SV.Audio.verdict(won) || ms; } catch (e) { /* ignore */ }
  S.reveal.dur = Math.max(2.4, ms / 1000);
  if (S.judge) { S.judge.talk(1.0); S.judge.play('gavel'); }
  const pO = pp(S.P);
  if (won) { S.P.setState('celebrate'); S.O.setState('ko'); gx.burst(pO.x, 2.2, pO.z, 'confetti', 60); gx.burst(pO.x, 1.6, pO.z, 'gold', 20); }
  else { S.P.setState('ko'); S.O.setState('celebrate'); }
  gx.shake(0.15, 0.3);
}

/* ---------------------------------------------------------
   Main update
   --------------------------------------------------------- */
function normInput(i) {
  i = i || {};
  return { mx: i.mx || 0, mz: i.mz || 0, sx: i.sx || 0, sy: i.sy || 0, A: !!i.A, G: !!i.G, R: !!i.R, P: !!i.P, T: !!i.T, held: i.held || {} };
}
function update(dt, input) {
  if (!S) return;
  dt = Math.min(dt, 0.05);
  const inp = normInput(input);
  S.t += dt;
  const ph = S.phase;
  if (ph === 'intro') { if (S.t > 1.7) { S.phase = 'fight'; S.ai.nextAtk = rnd(1.4, 2.2); } }
  else if (ph === 'fight') updateFight(dt, inp);
  else if (ph === 'citation') updateCitationPhase(dt);
  else if (ph === 'finisher') updateFinisher(dt, inp);
  else if (ph === 'count') countStep(dt, inp);
  else if (ph === 'playerDown') updatePlayerDown(dt);
  else if (ph === 'reveal') { S.reveal.t += dt; if (S.reveal.t >= S.reveal.dur) finish(S.reveal.won); }
  if (S) updateHud();
}

function updateFight(dt, inp) {
  const P = S.P, O = S.O, st = S.st, ps = S.pStats;
  S.fightT += dt;
  ['A', 'G', 'T'].forEach(k => { if (S.cd[k] > 0) S.cd[k] -= dt; });
  if (S.combo.t > 0) { S.combo.t -= dt; if (S.combo.t <= 0) S.combo.n = 0; }
  Object.keys(st).forEach(k => { if (st[k] > 0) st[k] = Math.max(0, st[k] - dt); });
  if (st.charged > 0) { S.dotAcc += dt; if (S.dotAcc >= 0.8) { S.dotAcc = 0; damagePlayer(2 + S.pMax * 0.012, { silent: true, bypass: true, lean: 0 }); GFX().popup('CHARGED', pp(P).x, 2.2, pp(P).z, { color: '#ff8fa0', size: 0.35, life: 0.6 }); } }

  // movement
  let mx = inp.mx, mz = inp.mz; const mag = Math.hypot(mx, mz);
  if (mag > 1) { mx /= mag; mz /= mag; }
  const running = inp.held.R && S.pFlow > 4 && mag > 0.2 && st.detained <= 0;
  const spd = running ? 4.4 : 2.7;
  if (st.detained <= 0 && mag > 0.05) moveRig(P, mx * spd * dt, mz * spd * dt);
  if (running) S.pFlow = Math.max(0, S.pFlow - 7 * dt);
  const dOpp = dist(P, O);
  if (dOpp < 3.4 || mag < 0.1) P.turnToward(angleTo(P, O), dt, 14); else P.turnToward(Math.atan2(mx, mz), dt, 12);
  P.lookAt(pp(O).x, pp(O).z); O.lookAt(pp(P).x, pp(P).z);

  // actions
  if (inp.A) { if (st.gagged > 0) { callout('GAGGED!', 'bad'); sfx('wrong'); } else if (S.cd.A <= 0 && S.pFlow >= 6) playerStrike(); else if (S.pFlow < 6 && S.cd.A <= 0) { sfx('wrong'); GFX().popup('NO FLOW', pp(P).x, 2.2, pp(P).z, { color: '#9ad0ff', size: 0.35 }); } }
  if (inp.G) {
    const dir = stickDir(inp);
    if (dir) doCite(dir);
    else if (dOpp <= 2.2 && S.ai.state !== 'ko' && S.pFlow >= 8) { S.pFlow -= 8; startCitation(); return; }
    else { st.brace = 0.7; P.play('block'); sfx('block'); GFX().popup('BRACE', pp(P).x, 2.2, pp(P).z, { color: '#9ad0ff', size: 0.4 }); }
  }
  if (inp.T) doTaunt();

  // flow regen
  if (!running) S.pFlow = Math.min(S.pFlowMax, S.pFlow + (9 + ps.flow * 0.06) * dt);

  aiUpdate(dt); separate();

  // judge timer + extremes
  if (S.fightT > FIGHT_LIMIT - 30 && !S.warned) { S.warned = true; callout("JUDGE'S PATIENCE RUNS OUT!", 'bad'); }
  if (S.fightT >= FIGHT_LIMIT) { S.byDecision = true; beginReveal(S.lean > 0, true); return; }
  if (S.lean >= 1) { S.lean = 0.95; S.oHp = 0; callout('BENCH RULES FOR YOU!', 'good'); }
  if (S.lean <= -1) { S.lean = -0.95; S.pHp = 0; callout('BENCH TURNS AGAINST YOU!', 'bad'); }
  if (S.oHp <= 0) { enterFinisher(); return; }
  if (S.pHp <= 0) { playerDown(); return; }
}
function updateCitationPhase(dt) {
  const c = S.cite; if (!c) { S.phase = 'fight'; return; }
  if (!c.answered) {
    c.t += dt; const rem = clamp(1 - c.t / c.limit, 0, 1), tf = $('cite-timer-fill');
    if (tf) tf.style.width = (rem * 100).toFixed(1) + '%'; const tm = $('cite-timer'); if (tm) tm.classList.toggle('low', rem < 0.3);
    if (c.t >= c.limit) answerCitation(-1);
  } else {
    c.resultT += dt; if (c.resultT > 9) endCitation();
  }
}
function updateFinisher(dt, inp) {
  const f = S.fin; f.t += dt;
  const P = S.P, O = S.O;
  if (inp.mx || inp.mz) moveRig(P, inp.mx * 2.7 * dt, inp.mz * 2.7 * dt);
  P.turnToward(angleTo(P, O), dt, 12);
  const d = dist(P, O);
  if (d <= 2.4) showPrompt('G', 'VERDICT HOLD!'); else showPrompt('G', 'Move beside them, then G');
  if (inp.G && d <= 2.4) { startCount('opp'); return; }
  if (f.t > 10) {
    hidePrompt(); S.oHp = Math.round(S.oMax * 0.22); S.ai.state = 'approach'; S.ai.nextAtk = 2; S.ai.stun = 0.8; S.O.setState('auto'); S.O.play('stagger'); S.O.setTargeted(true);
    callout('THEY RECOVER!', 'bad'); S.phase = 'fight';
  }
}
function updatePlayerDown(dt) {
  S.fin.t += dt;
  const O = S.O, P = S.P;
  O.turnToward(angleTo(O, P), dt, 10);
  if (dist(O, P) > 1.2) { const a = pp(O), b = pp(P), dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; moveRig(O, dx / l * 2.5 * dt, dz / l * 2.5 * dt); }
  if (S.fin.t > 1.2) startCount('player');
}

/* ---------------------------------------------------------
   Public API
   --------------------------------------------------------- */
SV.Combat = {
  start, update, abort,
  isActive: () => !!S,
  phase: () => (S ? S.phase : null),
  debug: () => S,
  answerCitation, verdictWords,
  ATTACKS, COUNTER_BY_DIR
};

})(typeof window !== 'undefined' ? window : globalThis);
