// Autopilot: a scripted participant that makes the sandwich through the same
// Hand/Manipulator code path as a person, with minimum-jerk reaches and a
// task-driven gaze policy (gaze leads the hand; occasional look-ahead and
// distractor glances). Used for testing and to generate reference logs.
//   ?input=autopilot&gaze=autopilot&auto=1
import * as THREE from 'three';
import { palmDownQuat } from './mouse.js';
import { rng } from '../util/util.js';

const mj = u => u * u * u * (10 - 15 * u + 6 * u * u); // minimum-jerk profile

export class Autopilot {
  constructor(world, task, hands, manip, body, camera, seed = 1) {
    Object.assign(this, { world, task, hands, manip, body, camera });
    this.r = rng(seed * 31 + 7);
    this.q = []; this.cur = null; this.t = 0; this.done = false;
    this.gazeP = new THREE.Vector3(0, 0.95, -0.3); this.gazeQ = []; // scheduled glances
    this.rest = [new THREE.Vector3(body.x - 0.22, 1.02, 0.2), new THREE.Vector3(body.x + 0.22, 1.02, 0.2)];
    hands.forEach((h, i) => { h.tracked = true; h.poseSynthetic(this.rest[i].clone(), palmDownQuat(0), 0.1); });
    this.speed = 1.0;
    this.plan();
  }
  // ---- plan in terms of world targets (functions evaluated at step start) ----
  plan() {
    const T = this.task, L = 0, R = 1, q = this.q;
    const pos = e => e.root.getWorldPosition(new THREE.Vector3());
    const plateC = () => pos(T.plate).add(new THREE.Vector3(0, 0.03, 0));
    const reach = (hand, target, look = true, extra = {}) => q.push({ type: 'reach', hand, target, look, ...extra });
    const grasp = hand => q.push({ type: 'pinch', hand, on: true });
    const release = hand => q.push({ type: 'pinch', hand, on: false });
    const wait = d => q.push({ type: 'wait', dur: d });
    const twist = (hand, turns) => q.push({ type: 'twist', hand, turns });
    const lift = (hand, dy) => reach(hand, () => this.hands[hand].grip.clone().add(new THREE.Vector3(0, dy, 0)), false);
    const nextSlice = () => { const s = T.bag.state.slices.filter(x => !x.state.heel).sort((a, b) => b.state.index - a.state.index)[0]; return s; };
    const sliceTarget = () => { const s = nextSlice(); this._slice = s; return pos(s).add(new THREE.Vector3(0, 0.065, 0)); };
    const onPlate = dx => () => plateC().add(new THREE.Vector3(dx, 0.04, 0));
    // set things down beside their jar, but never on the plate
    const away = (e, dz = 0.13, dx = 0) => () => {
      const p = pos(e), q = new THREE.Vector3(p.x + dx, p.y + 0.03, Math.min(-0.08, p.z + dz)), pc = pos(T.plate);
      const d = Math.hypot(q.x - pc.x, q.z - pc.z);
      if (d < 0.24) { const k = (0.26 - d) / Math.max(d, 1e-3); q.x += (q.x - pc.x) * k; q.z += (q.z - pc.z) * k; }
      return q;
    };
    const lidTop = jar => () => pos(jar).add(new THREE.Vector3(0, jar.geom.rimY + jar.lid.geom.h + 0.004, 0));
    // knife-relative targets: put a blade point at P
    const bladeAt = (P, sample = 4) => () => { const k = T.knife, h = this.hands[R]; const b = k.root.localToWorld(k.geom.bladeSamples[sample].clone()); return P().clone().sub(b.sub(h.grip)); };
    const jarDip = jar => () => pos(jar).add(new THREE.Vector3(0, jar.state.surfaceY - 0.001, 0));
    const jarAbove = jar => () => pos(jar).add(new THREE.Vector3(0, jar.geom.rimY + 0.06, 0));
    const sliceSurf = (getS, dx, dz) => () => { const s = getS(); const p = pos(s); return new THREE.Vector3(p.x + dx, p.y + 0.0072, p.z + dz); };

    // 0) stored layout: open containers first
    if (T.plate.restingOn === 'cupboard') {
      const door = this.world.get('cupboard_door');
      reach(L, () => door.root.localToWorld(new THREE.Vector3(door.constraint.radius, 1.55, 0.04))); grasp(L);
      reach(L, () => door.root.localToWorld(new THREE.Vector3(door.constraint.radius, 1.55, 0.04)).add(new THREE.Vector3(0.12, 0, 0.32)), false); release(L);
      reach(R, () => pos(T.plate).add(new THREE.Vector3(0.1, 0.02, 0))); grasp(R);
      reach(R, () => this.freeSpot(new THREE.Vector3(this.body.x, 0.91, -0.25), 0.24, T.plate).add(new THREE.Vector3(0, 0.09, 0)), false); release(R);
    }
    // 1) bread: left hand removes the clip, right hand takes two slices
    reach(L, () => T.bag.clip.root.getWorldPosition(new THREE.Vector3())); grasp(L);
    reach(L, away(T.bag, 0.12, 0.08), false); release(L);
    for (const dx of [-0.058, 0.058]) { reach(R, sliceTarget); grasp(R); lift(R, 0.08); reach(R, onPlate(dx)); release(R); }
    // 2) peanut butter: left unscrews, sets lid down
    reach(L, lidTop(T.pb)); grasp(L); twist(L, 1.35); lift(L, 0.05); reach(L, away(T.pb, 0.12, -0.05), false); release(L);
    // 3) knife (from the drawer if stored)
    if (T.knife.restingOn === 'drawer') {
      const dr = this.world.get('drawer');
      reach(R, () => pos(dr).add(new THREE.Vector3(0, 0.79, 0.03))); grasp(R);
      reach(R, () => pos(dr).add(new THREE.Vector3(0, 0.79, 0.43)), false); release(R);
    }
    reach(R, () => T.knife.root.localToWorld(T.knife.geom.grip.clone()).add(new THREE.Vector3(0, 0.004, 0))); grasp(R); lift(R, 0.1);
    reach(R, bladeAt(jarAbove(T.pb))); reach(R, bladeAt(jarDip(T.pb)), false, { dur: 0.5 }); wait(0.5); reach(R, bladeAt(jarAbove(T.pb)), false);
    this.spread(R, () => this.firstOnPlate(), sliceSurf, bladeAt);
    // 4) jelly: left opens; jelly on the other slice
    if (T.jelly.restingOn?.startsWith('fridge')) {
      const fd = this.world.get('fridge_door');
      q.push({ type: 'walk', x: -1.25 });
      reach(L, () => fd.root.localToWorld(new THREE.Vector3(fd.constraint.radius, 1.15, 0.11))); grasp(L);
      reach(L, () => fd.root.localToWorld(new THREE.Vector3(fd.constraint.radius, 1.15, 0.11)).add(new THREE.Vector3(0.28, 0, 0.45)), false); release(L);
      reach(L, () => pos(T.jelly).add(new THREE.Vector3(0, 0.06, 0))); grasp(L);
      q.push({ type: 'walk', x: 0 });
      reach(L, () => this.freeSpot(new THREE.Vector3(this.body.x - 0.32, 0.91, -0.3), 0.08, T.jelly).add(new THREE.Vector3(0, 0.08, 0)), false); release(L);
    }
    reach(L, lidTop(T.jelly)); grasp(L); twist(L, 1.35); lift(L, 0.05); reach(L, away(T.jelly, 0.12, 0.05), false); release(L);
    reach(R, bladeAt(jarAbove(T.jelly))); reach(R, bladeAt(jarDip(T.jelly)), false, { dur: 0.5 }); wait(0.5); reach(R, bladeAt(jarAbove(T.jelly)), false);
    this.spread(R, () => this.secondOnPlate(), sliceSurf, bladeAt);
    // 5) knife down on the towel, close the sandwich
    reach(R, () => pos(T.towel).add(new THREE.Vector3(0.0, 0.06, 0))); release(R);
    reach(R, () => pos(this.secondOnPlate()).add(new THREE.Vector3(0, 0.012, 0))); grasp(R); lift(R, 0.09);
    q.push({ type: 'flip', hand: R }); wait(0.35);
    reach(R, () => pos(this.firstOnPlate()).add(new THREE.Vector3(0, 0.035, 0))); release(R); wait(0.4);
    // 6) ring the bell
    reach(R, () => pos(T.bell).add(new THREE.Vector3(0, 0.07, 0))); grasp(R); release(R);
    reach(R, () => this.rest[R].clone(), false);
  }
  spread(hand, getSlice, sliceSurf, bladeAt) {
    const pts = [[-0.035, -0.035], [0.035, -0.03], [-0.035, -0.01], [0.035, 0.0], [-0.035, 0.015], [0.035, 0.028], [-0.03, 0.04], [0.03, 0.045]];
    this.q.push({ type: 'reach', hand, target: bladeAt(() => sliceSurf(getSlice, -0.03, -0.035)().add(new THREE.Vector3(0, 0.03, 0)), 3), look: true, lookAt: () => getSlice().root.getWorldPosition(new THREE.Vector3()) });
    for (const [dx, dz] of pts) this.q.push({ type: 'reach', hand, target: bladeAt(sliceSurf(getSlice, dx, dz), 3), look: false, dur: 0.28 });
    this.q.push({ type: 'reach', hand, target: bladeAt(() => sliceSurf(getSlice, 0, 0)().add(new THREE.Vector3(0, 0.06, 0)), 3), look: false, dur: 0.3 });
  }
  // nearest counter spot with `r` clearance from everything else on the counter
  freeSpot(p, r, self) {
    const others = [...this.world.entities.values()].filter(e => e !== self && e.root.parent && !e.heldBy && e.role !== 'fixture')
      .map(e => e.root.getWorldPosition(new THREE.Vector3())).filter(q => Math.abs(q.y - 0.91) < 0.2);
    // most clearance from everything else, with a mild preference for staying close to p
    let best = p.clone(), bs = -Infinity;
    for (let dx = -0.4; dx <= 0.4; dx += 0.04) for (let dz = -0.2; dz <= 0.16; dz += 0.04) {
      const q = new THREE.Vector3(p.x + dx, p.y, THREE.MathUtils.clamp(p.z + dz, -0.5, -0.12));
      const m = Math.min(r + 0.08, ...others.map(o => Math.hypot(o.x - q.x, o.z - q.z)));
      const sc = m - 0.25 * Math.hypot(dx, dz);
      if (sc > bs) { bs = sc; best = q; }
    }
    return best;
  }
  platedSlices() { return [...this.world.entities.values()].filter(e => e.kind === 'slice' && !e.state.inBag && !e.heldBy).sort((a, b) => a.root.getWorldPosition(new THREE.Vector3()).x - b.root.getWorldPosition(new THREE.Vector3()).x); }
  firstOnPlate() { return this.platedSlices()[0]; }
  secondOnPlate() { return this.platedSlices()[1] || this.platedSlices()[0]; }

  // ---- execution ----
  update(dt) {
    this.t += dt; this.body.update(dt);
    if (!this.cur && this.q.length) this.begin(this.q.shift());
    const c = this.cur;
    if (c) {
      c.el += dt;
      const h = this.hands[c.hand ?? 1];
      if (c.type === 'reach') { const u = Math.min(1, c.el / c.dur); h.grip.lerpVectors(c.from, c.to, mj(u)); if (u >= 1) this.cur = null; }
      else if (c.type === 'twist') { const u = Math.min(1, c.el / c.dur); h.twist = c.tw0 + c.turns * 2 * Math.PI * u; if (u >= 1 || !h.hold || h.hold.mode !== 'twist') this.cur = null; }
      else if (c.type === 'walk') { if (Math.abs(this.body.x - this.body.targetX) < 0.01) this.cur = null; }
      else if (c.el >= (c.dur || 0.12)) this.cur = null;
    } else if (!this.q.length) this.done = true;
    this.hands.forEach((h, i) => {
      const want = h.holding || h.pinch ? 1 : 0.12; h.closure += (want - h.closure) * (1 - Math.exp(-dt * 16));
      h.poseSynthetic(h.grip.clone(), palmDownQuat(this.body.yaw), h.closure); h.track(dt);
    });
    this.updateGaze(dt);
  }
  begin(s) {
    s.el = 0; this.cur = s; const h = this.hands[s.hand ?? 1];
    if (s.type === 'reach') {
      s.from = h.grip.clone(); s.to = s.target();
      const d = s.from.distanceTo(s.to); s.dur = s.dur ?? (0.32 + 0.85 * d) * (0.9 + 0.25 * this.r());
      if (s.look) this.lookAt(s.lookAt ? s.lookAt() : s.to.clone(), 0.04);
      // occasional look-ahead to the target of the next look-worthy reach
      const nxt = this.q.find(x => x.type === 'reach' && x.look);
      if (nxt && this.r() < 0.3) this.gazeQ.push({ at: this.t + s.dur * 0.7, dur: 0.3, target: () => { try { return nxt.target(); } catch { return null; } } });
      if (this.r() < 0.08) { const ds = [...this.world.entities.values()].filter(e => e.role === 'distractor' && e.root.parent); const e = ds[Math.floor(this.r() * ds.length)]; if (e) this.gazeQ.push({ at: this.t + 0.1, dur: 0.25, target: () => e.root.getWorldPosition(new THREE.Vector3()) }); }
    } else if (s.type === 'pinch') { h.pinch = s.on; }
    else if (s.type === 'twist') { s.tw0 = h.twist || 0; s.dur = 0.9 * s.turns; }
    else if (s.type === 'flip') { h.flip = !h.flip; }
    else if (s.type === 'walk') { this.body.targetX = s.x; this.world.bus.emit('step', { x: s.x }); const dx = s.x - this.body.x; for (const hh of this.hands) hh.grip.x += 0; this.rest.forEach(r => (r.x += dx)); }
  }
  lookAt(p, delay = 0) { this.gazeTarget = p; this.gazeHold = this.t + delay; }
  updateGaze(dt) {
    const g = this.gazeQ[0];
    let target = this.gazeTarget;
    if (g && this.t >= g.at) { if (this.t > g.at + g.dur) this.gazeQ.shift(); else { g.p = g.p || g.target(); if (g.p) target = g.p; } }
    if (target && this.t >= (this.gazeHold ?? 0)) this.gazeP.copy(target);
  }
  gazeProvider() {
    const self = this, v = new THREE.Vector3();
    return { get() {
      v.copy(self.gazeP).project(self.camera);
      const n = () => (self.r() - 0.5) * 0.006;
      const x = v.x * 0.5 + 0.5 + n(), y = -v.y * 0.5 + 0.5 + n();
      return { valid: v.z < 1 && x > 0 && x < 1 && y > 0 && y < 1, x, y, conf: 1 };
    } };
  }
}
