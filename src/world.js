/* =========================================================
   SAMVIDHAN: LEGAL EMPIRE — src/world.js
   World Traversal, Triggers, NPC Interactions, and Room Props
   ========================================================= */
(function (global) {
'use strict';

const SV = global.Samvidhan = global.Samvidhan || {};

const World = {
  currentRoom: 'corridor',
  npcs: [],
  triggers: [],
  interactivePickups: [],

  init() {
    this.setupRoom('corridor');
  },

  setupRoom(roomId) {
    this.currentRoom = roomId;
    const GFX = SV.Graphics;
    if (!GFX) return;

    GFX.showRoom(roomId);
    this.npcs = [];
    this.triggers = [];

    const room = GFX.getRoom(roomId);
    if (!room) return;

    // Spawn Room NPCs based on current circuit & roster
    if (SV.State && SV.State.roster) {
      const roster = SV.State.roster;
      const circuit = SV.State.data.player.circuit;

      if (roomId === 'courtroom') {
        const judge = roster.find(n => n.role === 'judge' && n.tier === circuit) || roster.find(n => n.role === 'judge');
        if (judge && room.anchors.judgeSeat) {
          const rig = GFX.rigFromNpc(judge);
          rig.setPosition(room.anchors.judgeSeat.x, room.anchors.judgeSeat.y || 0.7, room.anchors.judgeSeat.z);
          rig.setFacing(room.anchors.judgeSeat.ry || 0);
          rig.setState('sit');
          GFX.addChar(rig);
          this.npcs.push({ data: judge, rig });
        }
      } else if (roomId === 'library') {
        const mentor = roster.find(n => n.role === 'mentor' && n.tier <= circuit);
        if (mentor && room.anchors.mentor1) {
          const rig = GFX.rigFromNpc(mentor);
          rig.setPosition(room.anchors.mentor1.x, 0, room.anchors.mentor1.z);
          rig.setFacing(room.anchors.mentor1.ry || 0);
          GFX.addChar(rig);
          this.npcs.push({ data: mentor, rig });
        }
      } else if (roomId === 'thana') {
        const inspector = roster.find(n => n.role === 'police');
        if (inspector && room.anchors.inspectorSeat) {
          const rig = GFX.rigFromNpc(inspector);
          rig.setPosition(room.anchors.inspectorSeat.x, 0, room.anchors.inspectorSeat.z);
          rig.setFacing(room.anchors.inspectorSeat.ry || 0);
          rig.setState('sit');
          GFX.addChar(rig);
          this.npcs.push({ data: inspector, rig });
        }
      }
    }
  },

  checkTriggers(pos) {
    const GFX = SV.Graphics;
    const room = GFX ? GFX.getRoom(this.currentRoom) : null;
    if (!room) return null;

    // Check doors
    for (const d of room.doors) {
      const dist = Math.hypot(pos.x - d.x, pos.z - d.z);
      if (dist <= d.r) {
        return { type: 'door', door: d };
      }
    }

    // Check nearby NPCs
    for (const npc of this.npcs) {
      const np = npc.rig.group.position;
      const dist = Math.hypot(pos.x - np.x, pos.z - np.z);
      if (dist <= 1.8) {
        return { type: 'npc', npc: npc.data, rig: npc.rig };
      }
    }

    return null;
  },

  update(dt) {
    // Keep ambient updates running
  }
};

SV.World = World;

})(typeof window !== 'undefined' ? window : globalThis);
