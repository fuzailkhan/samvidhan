/* =========================================================
   SAMVIDHAN: LEGAL EMPIRE — src/game.js
   Master Controller & Input Loop
   ========================================================= */
(function (global) {
'use strict';

const SV = global.Samvidhan = global.Samvidhan || {};
const doc = global.document;

const Game = {
  playerRig: null,
  activeTrigger: null,
  clock: null,
  input: {
    mx: 0, mz: 0, sx: 0, sy: 0,
    A: false, G: false, R: false, P: false, T: false,
    held: { R: false }
  },

  init() {
    this.clock = new THREE.Clock();

    // 1. Initialize State
    SV.State.load();

    // 2. Initialize 3D Graphics
    const canvas = doc.getElementById('game-canvas');
    if (!SV.Graphics.init(canvas, { lowGfx: SV.State.settings.lowgfx })) {
      console.error("Graphics init failed");
      return;
    }
    SV.Graphics.buildAll();

    // 3. Initialize Audio
    if (SV.Audio) SV.Audio.init();

    // 4. Setup World & Player
    SV.World.init();
    this.spawnPlayer();

    // 5. Setup Controls & UI Bindings
    this.bindControls();
    this.bindUI();

    // 6. Dismiss Loading Screen
    const loadFill = doc.getElementById('loading-fill');
    if (loadFill) loadFill.style.width = '100%';
    setTimeout(() => {
      const loadScreen = doc.getElementById('loading-screen');
      if (loadScreen) loadScreen.classList.remove('active');
      const hud = doc.getElementById('hud');
      if (hud) hud.classList.remove('hidden');

      // Check if new career needed
      if (!SV.State.hasSave()) {
        this.openModal('modal-main-menu');
      } else {
        this.updateHUD();
      }
    }, 400);

    // 7. Start Loop
    requestAnimationFrame(t => this.loop(t));
  },

  spawnPlayer() {
    const pData = SV.State.data.player;
    this.playerRig = SV.Graphics.rigForPlayer(pData, { female: false });
    const corridor = SV.Graphics.getRoom('corridor');
    const spawn = corridor ? corridor.anchors.spawn : { x: 0, z: 0 };
    this.playerRig.setPosition(spawn.x, 0, spawn.z);
    SV.Graphics.addChar(this.playerRig);
    SV.Graphics.cameraFollow(this.playerRig);
    SV.Graphics.snapCamera();
  },

  bindControls() {
    const stickZone = doc.getElementById('joystick-zone');
    const stickBase = doc.getElementById('joystick-base');
    const stickKnob = doc.getElementById('joystick-knob');

    let activeTouchId = null;
    let basePos = { x: 0, y: 0 };

    const resetStick = () => {
      activeTouchId = null;
      this.input.sx = 0;
      this.input.sy = 0;
      this.input.mx = 0;
      this.input.mz = 0;
      if (stickKnob) stickKnob.style.transform = `translate(0px, 0px)`;
      if (stickBase) stickBase.classList.remove('active');
    };

    stickZone.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      activeTouchId = t.identifier;
      const rect = stickBase.getBoundingClientRect();
      basePos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      stickBase.classList.add('active');
      if (SV.Audio) SV.Audio.unlock();
    }, { passive: false });

    stickZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === activeTouchId) {
          const dx = t.clientX - basePos.x;
          const dy = t.clientY - basePos.y;
          const dist = Math.hypot(dx, dy);
          const maxR = 48;
          const angle = Math.atan2(dy, dx);
          const r = Math.min(dist, maxR);

          const nx = (Math.cos(angle) * r);
          const ny = (Math.sin(angle) * r);

          stickKnob.style.transform = `translate(${nx}px, ${ny}px)`;

          this.input.sx = nx / maxR;
          this.input.sy = -(ny / maxR);

          // Camera-relative direction
          const cam = SV.Graphics.getCameraBasis();
          this.input.mx = this.input.sx * cam.fx - this.input.sy * cam.fz;
          this.input.mz = this.input.sx * cam.fz + this.input.sy * cam.fx;
        }
      }
    }, { passive: false });

    stickZone.addEventListener('touchend', e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId) resetStick();
      }
    });

    // Buttons
    doc.querySelectorAll('.act-btn').forEach(btn => {
      const act = btn.getAttribute('data-action');
      btn.addEventListener('touchstart', e => {
        e.preventDefault();
        btn.classList.add('pressed');
        this.input[act] = true;
        if (act === 'R') this.input.held.R = true;
      }, { passive: false });

      btn.addEventListener('touchend', e => {
        btn.classList.remove('pressed');
        if (act === 'R') this.input.held.R = false;
      });
    });

    // Keyboard support
    window.addEventListener('keydown', e => {
      const k = e.key.toUpperCase();
      if (['W', 'A', 'S', 'D', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT'].includes(k)) {
        if (k === 'W' || k === 'ARROWUP') this.input.sy = 1;
        if (k === 'S' || k === 'ARROWDOWN') this.input.sy = -1;
        if (k === 'A' || k === 'ARROWLEFT') this.input.sx = -1;
        if (k === 'D' || k === 'ARROWRIGHT') this.input.sx = 1;
        const cam = SV.Graphics.getCameraBasis();
        this.input.mx = this.input.sx * cam.fx - this.input.sy * cam.fz;
        this.input.mz = this.input.sx * cam.fz + this.input.sy * cam.fx;
      }
      if (['J', 'K', 'L', 'I', 'U'].includes(k)) {
        if (k === 'J') this.input.A = true;
        if (k === 'K') this.input.G = true;
        if (k === 'L') { this.input.R = true; this.input.held.R = true; }
        if (k === 'I') this.input.P = true;
        if (k === 'U') this.input.T = true;
      }
    });

    window.addEventListener('keyup', e => {
      const k = e.key.toUpperCase();
      if (k === 'L') this.input.held.R = false;
      if (['W', 'A', 'S', 'D', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT'].includes(k)) {
        this.input.sx = 0; this.input.sy = 0; this.input.mx = 0; this.input.mz = 0;
      }
    });
  },

  bindUI() {
    doc.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-close');
        this.closeModal(id);
      });
    });

    const btnNew = doc.getElementById('btn-new-career');
    if (btnNew) btnNew.addEventListener('click', () => {
      this.closeModal('modal-main-menu');
      this.openModal('modal-create');
    });

    const btnStart = doc.getElementById('btn-start-career');
    if (btnStart) btnStart.addEventListener('click', () => {
      const name = (doc.getElementById('input-name') || {}).value || 'Advocate';
      SV.State.newCareer({ name });
      this.closeModal('modal-create');
      this.updateHUD();
    });

    const btnContinue = doc.getElementById('btn-continue');
    if (btnContinue) btnContinue.addEventListener('click', () => {
      this.closeModal('modal-main-menu');
      this.updateHUD();
    });

    const btnPause = doc.getElementById('btn-pause');
    if (btnPause) btnPause.addEventListener('click', () => this.openModal('modal-pause'));
    const btnResume = doc.getElementById('btn-resume');
    if (btnResume) btnResume.addEventListener('click', () => this.closeModal('modal-pause'));
  },

  openModal(id) {
    const el = doc.getElementById(id);
    if (el) el.classList.add('open');
  },

  closeModal(id) {
    const el = doc.getElementById(id);
    if (el) el.classList.remove('open');
  },

  updateHUD() {
    const p = SV.State.data.player;
    const nameEl = doc.getElementById('player-name');
    if (nameEl) nameEl.textContent = p.name.toUpperCase();
    const rankEl = doc.getElementById('player-rank');
    if (rankEl) rankEl.textContent = SV.State.rankTitle().toUpperCase();
    const purseEl = doc.getElementById('purse');
    if (purseEl) purseEl.textContent = p.purse.toLocaleString('en-IN');
    const repEl = doc.getElementById('stat-rep');
    if (repEl) repEl.textContent = p.rep;
    const locEl = doc.getElementById('location-label');
    if (locEl) locEl.textContent = SV.State.courtLabel().toUpperCase();
  },

  handleInteract() {
    if (!this.activeTrigger) return;

    if (this.activeTrigger.type === 'door') {
      const d = this.activeTrigger.door;
      if (d.locked) return;
      SV.World.setupRoom(d.to);
      const destRoom = SV.Graphics.getRoom(d.to);
      const spawn = (destRoom && destRoom.anchors.spawn) || { x: 0, z: 0 };
      this.playerRig.setPosition(spawn.x, 0, spawn.z);
      SV.Graphics.cameraFollow(this.playerRig);
      SV.Graphics.snapCamera();
      this.updateHUD();
    } else if (this.activeTrigger.type === 'npc') {
      const npc = this.activeTrigger.npc;
      if (npc.role === 'judge' || npc.role === 'advocate' || npc.role === 'prosecutor') {
        const cCase = SV.State.generateCase();
        SV.Combat.start({
          cs: cCase,
          player: this.playerRig,
          opponent: this.activeTrigger.rig,
          npc: npc,
          room: SV.World.currentRoom,
          onEnd: res => {
            SV.State.resolveCase(cCase, res);
            this.updateHUD();
          }
        });
      }
    }
  },

  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.05, this.clock.getDelta());

    if (SV.Combat && SV.Combat.isActive()) {
      SV.Combat.update(dt, this.input);
    } else {
      // Free roam movement
      if (this.playerRig) {
        const mag = Math.hypot(this.input.mx, this.input.mz);
        const running = this.input.held.R;
        const spd = running ? 4.8 : 2.8;

        if (mag > 0.1) {
          const pos = this.playerRig.group.position;
          const next = SV.Graphics.collide(SV.World.currentRoom, pos.x + this.input.mx * spd * dt, pos.z + this.input.mz * spd * dt, 0.4);
          this.playerRig.setPosition(next.x, 0, next.z);
          this.playerRig.turnToward(Math.atan2(this.input.mx, this.input.mz), dt, 12);
        }

        // Trigger interaction check
        this.activeTrigger = SV.World.checkTriggers(this.playerRig.group.position);
        const prompt = doc.getElementById('interact-prompt');
        if (this.activeTrigger && prompt) {
          prompt.classList.remove('hidden');
          const txt = doc.getElementById('interact-text');
          if (txt) {
            txt.textContent = this.activeTrigger.type === 'door'
              ? `Enter ${this.activeTrigger.door.label}`
              : `Talk to ${this.activeTrigger.npc.name}`;
          }
        } else if (prompt) {
          prompt.classList.add('hidden');
        }

        if (this.input.P) {
          this.handleInteract();
        }
      }
    }

    // Reset single-frame edge triggers
    this.input.A = false;
    this.input.G = false;
    this.input.R = false;
    this.input.P = false;
    this.input.T = false;

    SV.Graphics.frame(dt);
  }
};

window.addEventListener('DOMContentLoaded', () => Game.init());

})(typeof window !== 'undefined' ? window : globalThis);
