// Task monitor: turns low-level events into subgoal completions and a final
// quality summary. Subgoals are never shown to the participant.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();

export class TaskMonitor {
  constructor(world, task, def, cfg) {
    Object.assign(this, { world, task, def, cfg, bus: world.bus });
    this.done = {}; this.counts = { grasps: 0, misses: 0, drops: 0, contamination: 0, regrasps: 0 };
    this.active = def.subgoals.filter(s => !s.condition || s.condition === cfg.condition);
    this.lastGrasp = {};
    const on = (t, f) => this.bus.on(t, f);
    on('bag_open', e => this.complete('bag_open', e.t));
    on('lid_off', e => this.complete(e.obj === 'pb_lid' ? 'pb_open' : 'jelly_open', e.t));
    on('lid_on', e => { if (this.done[e.obj === 'pb_lid' ? 'pb_spread' : 'jelly_spread']) this.complete(e.obj === 'pb_lid' ? 'pb_closed' : 'jelly_closed', e.t); });
    on('bag_closed', e => { if (this.done.slice_b) this.complete('bag_closed', e.t); });
    on('grasp', e => {
      this.counts.grasps++;
      if (e.obj === 'knife') this.complete('knife_in_hand', e.t);
      const prev = this.lastGrasp[e.obj];
      if (prev !== undefined && e.t - prev < 4 && !e.constraint) this.counts.regrasps++;
      this.lastGrasp[e.obj] = e.t;
    });
    on('grasp_miss', () => this.counts.misses++);
    on('knife_load', e => this.complete(e.substance === 'pb' ? 'pb_loaded' : 'jelly_loaded', e.t));
    on('spread', e => { if (e.coverage >= def.thresholds.spread_coverage_done) this.complete(e.substance === 'pb' ? 'pb_spread' : 'jelly_spread', e.t); });
    on('contamination', () => this.counts.contamination++);
    on('cut', e => this.complete('cut', e.t));
    on('bell', e => this.complete('done', e.t));
    on('settled', ({ entity, dropHeight }) => {
      if (entity.restingOn === 'floor') { this.counts.drops++; this.bus.emit('drop', { obj: entity.id, t: this.now(), height: +dropHeight.toFixed(3) }); }
      if (entity.kind === 'slice' || entity.kind === 'plate') this.checkPlate();
    });
  }
  now() { return this.world.clockT ?? 0; }
  complete(id, t) {
    if (this.done[id] !== undefined || !this.active.find(s => s.id === id)) return;
    this.done[id] = t ?? this.now();
    this.bus.emit('subgoal', { id, t: this.done[id], order: Object.keys(this.done).length });
  }
  onPlate(ent) { // support chain reaches the plate
    let e = ent, guard = 0;
    while (e && guard++ < 6) { if (e.restingOn === 'plate') return true; e = this.world.get(e.restingOn); }
    return false;
  }
  slices() { return [...this.world.entities.values()].filter(e => e.kind === 'slice'); }
  checkPlate() {
    const on = this.slices().filter(s => !s.heldBy && !s.state.inBag && this.onPlate(s));
    if (on.length >= 1) this.complete('slice_a', this.now());
    if (on.length >= 2) this.complete('slice_b', this.now());
    const q = this.sandwich();
    if (q && q.valid) this.complete('closed', this.now());
  }
  faceUp(s) { return new THREE.Vector3(0, 1, 0).applyQuaternion(s.root.getWorldQuaternion(_q)).y >= 0 ? 'A' : 'B'; }
  // Find a two-slice stack on the plate and grade it.
  sandwich() {
    const slices = this.slices();
    for (const top of slices) {
      const bot = this.world.get(top.restingOn);
      if (!bot || bot.kind !== 'slice' || !this.onPlate(bot)) continue;
      const tUp = this.faceUp(top), bUp = this.faceUp(bot);
      const tDown = tUp === 'A' ? 'B' : 'A', bDown = bUp === 'A' ? 'B' : 'A';
      const cov = (s, f, sub) => s.layers[sub + f].measure();
      const inner = { pb: cov(bot, bUp, 'pb') + cov(top, tDown, 'pb'), jelly: cov(bot, bUp, 'jelly') + cov(top, tDown, 'jelly') };
      const outer = { pb: cov(top, tUp, 'pb') + cov(bot, bDown, 'pb'), jelly: cov(top, tUp, 'jelly') + cov(bot, bDown, 'jelly') };
      top.root.getWorldPosition(_a); bot.root.getWorldPosition(_b);
      const offset = Math.hypot(_a.x - _b.x, _a.z - _b.z);
      const yawT = new THREE.Euler().setFromQuaternion(top.root.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
      const yawB = new THREE.Euler().setFromQuaternion(bot.root.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
      let dyaw = Math.abs(Math.atan2(Math.sin(yawT - yawB), Math.cos(yawT - yawB))); dyaw = Math.min(dyaw, Math.PI - dyaw); // flipped slices mirror
      const valid = inner.pb > 0.25 && inner.jelly > 0.25 && outer.pb < 0.08 && outer.jelly < 0.08 && offset < this.def.thresholds.sandwich_alignment_m * 1.6;
      return { valid, top: top.id, bottom: bot.id, inner, outer, offset: +offset.toFixed(4), yawDiffDeg: +(dyaw * 57.3).toFixed(1), heelUsed: top.state.heel || bot.state.heel };
    }
    return null;
  }
  summary(tEnd) {
    const s = this.sandwich();
    const cov = {};
    for (const sl of this.slices()) for (const [k, L] of Object.entries(sl.layers)) { const c = L.measure(); if (c > 0.005) cov[`${sl.id}.${k}`] = +c.toFixed(3); }
    const req = this.active.filter(g => !['pb_closed', 'jelly_closed', 'bag_closed'].includes(g.id) || this.cfg.condition === 'tidy');
    return {
      duration: tEnd, subgoals: this.done, completed: req.every(g => this.done[g.id] !== undefined),
      missing: req.filter(g => this.done[g.id] === undefined).map(g => g.id),
      sandwich: s, coverage: cov, counts: this.counts,
      jars: { pb: { amount: this.task.pb.state.amount, contamination: this.task.pb.state.contamination, open: this.task.pb.state.open }, jelly: { amount: this.task.jelly.state.amount, contamination: this.task.jelly.state.contamination, open: this.task.jelly.state.open } },
      knife: this.task.knife.state,
    };
  }
}
