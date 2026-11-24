// Manipulation: grasp selection, holding, twisting lids, articulated drawers and
// doors, knife contact (dip / spread / wipe / cut), release and settling.
// Everything that changes the task state is emitted on the bus for logging.
import * as THREE from 'three';
import { SLICE, ding, spreadBox } from '../scene/props.js';
import { settleQuat } from '../core/world.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _box = new THREE.Box3();
const Y = new THREE.Vector3(0, 1, 0);
let SPREAD_BB = null;

// twist angle of q about world Y (swing-twist decomposition)
export function twistY(q) { return 2 * Math.atan2(q.y, q.w); }
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// distance from a point to an entity's own meshes, using each mesh's oriented box
// (axis-aligned world boxes of long, rotated things like a spoon are far too big)
const _lp = new THREE.Vector3(), _sc = new THREE.Vector3();
function ownDistance(ent, p) {
  let best = Infinity, vol = 0;
  ent.root.updateWorldMatrix(true, true);
  ent.root.traverse(o => {
    if (!o.isMesh || o.userData.noAOI || !o.geometry) return;
    if (owningEntity(o) !== ent) return; // skip meshes of child entities (slices in the bag, lids on jars)
    const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
    _lp.copy(p); o.worldToLocal(_lp);
    o.getWorldScale(_sc); const k = (Math.abs(_sc.x) + Math.abs(_sc.y) + Math.abs(_sc.z)) / 3;
    best = Math.min(best, g.boundingBox.distanceToPoint(_lp) * k);
    const sz = g.boundingBox.getSize(_v3); vol += sz.x * sz.y * sz.z * k * k * k;
  });
  return { d: best, vol };
}
function owningEntity(o) { while (o) { if (o.userData.entity) return o.userData.entity; o = o.parent; } return null; }
function isUnderChildEntity(o, ent) { let p = o.parent; while (p && p !== ent.root) { if (p.userData.entity) return true; p = p.parent; } return false; }

export class Manipulator {
  constructor(world, task, cfg, taskDef) {
    Object.assign(this, { world, task, cfg, bus: world.bus });
    this.th = taskDef.thresholds;
    this.mode = cfg.input === 'xr' ? 'rigid' : 'upright';
    this.jars = [task.pb, task.jelly];
    this.dip = new Map();      // jar -> seconds of contact
    this._lastSpreadEmit = 0; this._lastWipeEmit = 0;
    this.cutPath = null;
    this.t = 0;
    this.boxes = new Map();
    SPREAD_BB = spreadBox();
  }
  emit(type, p) { this.bus.emit(type, p); }

  // ---------------- grasp selection ----------------
  candidates(point, hand) {
    const out = [];
    for (const e of this.world.entities.values()) {
      if (!e.grabbable || (e.heldBy && e.heldBy !== hand)) continue;
      if (e.role === 'fixture' && !e.constraint) continue;
      if (!e.constraint) { e.root.getWorldPosition(_v); if (_v.distanceTo(point) > 0.9) continue; } // doors pivot at floor level
      out.push(e);
    }
    return out;
  }
  nearest(hand) { return this.nearestTo(hand.grip, hand); }
  // Within `radius` of a point, prefer the smaller object (a slice inside the bag, the lid on the jar, the clip on the bag).
  nearestTo(point, hand, radius = this.th.grasp_radius_m) {
    let best = null, bs = Infinity;
    for (const e of this.candidates(point, hand)) {
      const { d, vol } = ownDistance(e, point);
      if (!(d <= radius)) continue;
      const score = d + 0.15 * Math.cbrt(Math.max(1e-9, vol));
      if (score < bs) { bs = score; best = e; }
    }
    return best;
  }
  resolve(ent, hand) {
    if (!ent) return null;
    // pointing at the open half of an open bag means "take a slice"; the closed half moves the bag
    if (ent.kind === 'bread_bag' && ent.state.open && ent.state.slices.length && hand?.pickPoint) {
      const top = ent.state.slices.reduce((a, b) => (b.state.index > a.state.index ? b : a));
      const lx = ent.root.worldToLocal(_v.copy(hand.pickPoint)).x;
      if (lx > top.root.position.x - 0.07) return top;
    }
    if (ent.kind === 'slice' && ent.state.inBag) {
      const bag = ent.state.bag;
      if (!bag.state.open) return bag;
      // only the two outermost slices (open end) are reachable; a pinch on a deeper slice goes to the nearest reachable one
      const open = bag.state.slices.slice().sort((a, b) => b.state.index - a.state.index).slice(0, 2);
      if (open.includes(ent)) return ent;
      const near = open.sort((a, b) => Math.abs(a.state.index - ent.state.index) - Math.abs(b.state.index - ent.state.index))[0];
      return near && Math.abs(near.state.index - ent.state.index) <= 3 ? near : bag;
    }
    if (ent.role === 'distractor' && !ent.grabbable) return null;
    return ent;
  }

  tryGrasp(hand) {
    let ent = hand.pickHint && hand.pickHint.grabbable !== false ? hand.pickHint : this.nearest(hand);
    if (hand.pickHint && hand.pickHint.root.getWorldPosition(_v).distanceTo(hand.grip) > 0.35) ent = this.nearest(hand);
    ent = this.resolve(ent, hand.pickHint ? hand : null);
    const base = { hand: hand.side, t: this.t, pos: hand.grip.toArray() };
    if (!ent || (ent.heldBy && ent.heldBy !== hand)) { this.emit('grasp_miss', { ...base, near: hand.pickHint?.id || null }); return; }
    const info = { ...base, obj: ent.id, kind: ent.kind, role: ent.role, from: ent.restingOn };

    if (ent.kind === 'bell') { this.ringBell(ent, hand); return; }
    if (ent.constraint) { // drawer / door
      const c = ent.constraint;
      hand.hold = { ent, mode: c.type, p0: hand.grip.clone(), v0: c.joint.value, psi0: c.type === 'hinge' ? this.hingeAngle(c, hand.grip) : 0 };
      hand.holding = ent; ent.heldBy = hand;
      this.emit('grasp', { ...info, constraint: c.type, value: c.joint.value });
      return;
    }
    if (ent.kind.endsWith('_lid') && ent.state.onJar) { // seated lid: twist to open
      // pointing modes: the hand goes onto the lid; headset: it is already there
      const p0 = hand.pickHint ? ent.root.getWorldPosition(new THREE.Vector3()).add(_v.set(0, ent.geom.h + 0.004, 0)) : hand.grip.clone();
      hand.hold = { ent, mode: 'twist', q0: hand.quat.clone(), prev: 0, acc: 0, twist0: hand.twist || 0, open0: ent.state.openness ?? 0, p0 };
      hand.holding = ent; ent.heldBy = hand;
      this.emit('grasp', { ...info, constraint: 'twist', openness: ent.state.openness ?? 0 });
      return;
    }
    // detach special parts
    if (ent.kind === 'bread_clip' && ent.state.onBag) {
      const bag = ent.state.onBag; ent.state.onBag = null; bag.setOpen(true);
      this.emit('bag_open', { ...base, obj: bag.id });
    }
    if (ent.kind === 'slice' && ent.state.inBag) {
      const bag = ent.state.bag; ent.state.inBag = false;
      bag.state.slices = bag.state.slices.filter(s => s !== ent);
      this.emit('slice_out', { ...base, obj: ent.id, heel: ent.state.heel, remaining: bag.state.slices.length });
    }
    this.startFree(hand, ent);
    this.emit('grasp', info);
  }

  startFree(hand, ent) {
    const root = ent.root;
    this.world.scene.attach(root);
    ent.restingOn = null; ent.heldBy = hand; hand.holding = ent;
    root.getWorldPosition(_v);
    const hold = { ent, mode: 'free', t0: this.t, handQ0: hand.quat.clone(), flip0: hand.flip, yaw0: hand.yawOffset, prevTw: 0, accTw: 0, rollFlip: false, roll0: hand.roll };
    if (this.mode === 'rigid') {
      const hm = new THREE.Matrix4().compose(hand.grip, hand.quat, _v3.set(1, 1, 1));
      hold.offset = hm.invert().multiply(root.matrixWorld.clone());
    } else {
      // upright: keep yaw, settle to a stable orientation while held (slices come out of the bag flat)
      hold.baseQ = settleQuat(root.quaternion, ent.settle === 'none' ? 'upright' : ent.settle);
      hold.offsetW = _v.clone().sub(hand.grip);
      if (ent.kind === 'slice') hold.offsetW.set(0, -0.01, 0.0);          // slice hangs just under the pinch
      if (ent.kind === 'knife') hold.offsetW.copy(ent.geom.grip).applyQuaternion(hold.baseQ).negate().add(_v2.set(0, -0.004, 0));
      if (ent.kind.endsWith('_lid')) hold.offsetW.set(0, -ent.geom.h, 0);
      hold.qNow = root.quaternion.clone();
    }
    hand.hold = hold;
  }

  // ---------------- per-frame ----------------
  update(dt, hands, t) {
    this.t = t;
    for (const h of hands) {
      if (!h.tracked) { if (h.holding) this.release(h); continue; }
      if (h.pinch && !h._wasPinch) this.tryGrasp(h);
      if (!h.pinch && h._wasPinch && h.holding) this.release(h);
      h._wasPinch = h.pinch;
      if (h.holding) this.updateHold(h, dt);
      else h.hover = this.resolve(h.pickHint || (this.mode === 'rigid' ? this.nearest(h) : null), h.pickHint ? h : null);
    }
  }

  hingeAngle(c, p) { return Math.atan2(p.z - c.pivot.z, p.x - c.pivot.x); }

  updateHold(hand, dt) {
    const H = hand.hold, ent = H.ent;
    if (H.mode === 'prismatic') {
      const c = ent.constraint, d = _v.subVectors(hand.grip, H.p0).dot(c.axis);
      const before = c.joint.value; c.joint.set(H.v0 + d / c.length);
      if (Math.abs(c.joint.value - before) > 1e-4) ent.state.open = c.joint.value;
      return;
    }
    if (H.mode === 'hinge') {
      const c = ent.constraint; let dpsi = wrap(this.hingeAngle(c, hand.grip) - H.psi0);
      c.joint.set(H.v0 + dpsi / c.maxAngle); ent.state.open = c.joint.value;
      return;
    }
    if (H.mode === 'twist') {
      const lid = ent, jar = lid.state.onJar;
      _q.copy(hand.quat).multiply(_q2.copy(H.q0).invert());
      const tw = twistY(_q); H.acc += wrap(tw - H.prev); H.prev = tw;
      const turns = (H.acc * (hand.twistGain || 1) + (hand.twist || 0) - H.twist0) / (2 * Math.PI);
      const thr = this.th.lid_turns_to_open;
      lid.state.openness = THREE.MathUtils.clamp(H.open0 + turns, 0, thr);
      lid.root.rotation.y = lid.state.openness * Math.PI * 2;
      lid.root.position.y = lid.seatY + lid.state.openness * 0.003;
      if (Math.abs(lid.state.openness - (H.lastEmit ?? H.open0)) > 0.25) { H.lastEmit = lid.state.openness; this.emit('lid_twist', { hand: hand.side, obj: lid.id, openness: +lid.state.openness.toFixed(3), t: this.t }); }
      if (lid.state.openness < 0.05 && !lid.state.tight) { lid.state.tight = true; this.emit('lid_tight', { hand: hand.side, obj: lid.id, jar: jar.id, t: this.t }); }
      const pulled = hand.grip.distanceTo(H.p0) > 0.03 && lid.state.openness > thr - 0.3;
      if (lid.state.openness >= thr - 1e-6 || pulled) {
        lid.state.onJar = null; lid.state.tight = false; jar.state.open = true;
        this.emit('lid_off', { hand: hand.side, obj: lid.id, jar: jar.id, t: this.t });
        this.startFree(hand, lid);
      }
      return;
    }
    // free hold
    const root = ent.root;
    if (this.mode === 'rigid') {
      const hm = new THREE.Matrix4().compose(hand.grip, hand.quat, _v3.set(1, 1, 1)).multiply(H.offset);
      hm.decompose(root.position, root.quaternion, _v3);
    } else {
      _q.copy(hand.quat).multiply(_q2.copy(H.handQ0).invert());
      const tw = twistY(_q); H.accTw += wrap(tw - H.prevTw); H.prevTw = tw;
      const dyaw = H.accTw + (hand.yawOffset - H.yaw0);
      // wrist roll flips two-sided objects (webcam); F toggles on desktop
      const droll = hand.roll - H.roll0;
      if (!H.rollFlip && Math.abs(droll) > 2.0) { H.rollFlip = true; H.roll0 = hand.roll; }
      else if (H.rollFlip && Math.abs(droll) > 2.0) { H.rollFlip = false; H.roll0 = hand.roll; }
      const flip = (hand.flip !== H.flip0) !== H.rollFlip;
      const target = _q.setFromAxisAngle(Y, dyaw).multiply(H.baseQ);
      if (flip && ent.settle === 'flat2') target.multiply(_q2.setFromAxisAngle(_v.set(1, 0, 0), Math.PI));
      H.qNow.slerp(target, 1 - Math.exp(-dt * 14));
      root.quaternion.copy(H.qNow);
      root.position.copy(hand.grip).add(_v.copy(H.offsetW).applyAxisAngle(Y, dyaw));
      if (H.flipLast !== flip) { if (H.flipLast !== undefined) this.emit('flip', { hand: hand.side, obj: ent.id, t: this.t }); H.flipLast = flip; }
    }
    // never sink through surfaces (and through jar contents for the knife)
    this.clampAbove(ent);
    if (ent.kind === 'knife') this.knifeContact(hand, ent, dt);
  }

  clampAbove(ent) {
    const root = ent.root; root.updateMatrixWorld(true);
    if (ent.kind === 'knife') {
      let need = 0;
      for (const p of ent.geom.bladeSamples) {
        const w = root.localToWorld(_v3.copy(p));
        const f = this.floorUnder(w, ent);
        need = Math.max(need, f - (w.y - 0.001));
      }
      if (need > 0) root.position.y += need;
      return;
    }
    root.getWorldPosition(_v);
    const s = this.world.supportBelow(_v2.set(_v.x, _v.y + 0.12, _v.z), ent, 0.6);
    const bottom = _v.y - ent.restOffset;
    if (s && bottom < s.y) root.position.y += s.y - bottom;
  }

  // what a point (e.g. a blade sample) would bottom out on
  floorUnder(w, exclude) {
    const jar = this.jarUnder(w);
    if (jar) return jar.root.localToWorld(_v2.set(0, jar.state.surfaceY, 0)).y - 0.004;
    const s = this.world.supportBelow(_v2.set(w.x, w.y + 0.12, w.z), exclude, 1.5);
    return s ? s.y : 0;
  }
  jarUnder(w) {
    for (const j of this.jars) {
      if (!j.state.open) continue;
      const l = j.root.worldToLocal(_v2.copy(w));
      if (Math.hypot(l.x, l.z) < j.geom.mouthR && l.y < j.geom.rimY + 0.25) return j;
    }
    return null;
  }

  jarAt(w) {
    for (const j of this.jars) {
      if (!j.state.open) continue;
      const l = j.root.worldToLocal(_v2.copy(w));
      if (Math.hypot(l.x, l.z) < j.geom.mouthR && l.y < j.geom.rimY + 0.03 && l.y > j.state.surfaceY - 0.03) return j;
    }
    return null;
  }

  // Height the desktop hand should go to when "pressing" with a held object.
  pressGripY(hand) {
    const ent = hand.holding; if (!ent || hand.hold?.mode !== 'free') return null;
    const root = ent.root, gripY = hand.grip.y;
    if (ent.kind === 'knife') {
      let need = -Infinity;
      for (const p of ent.geom.bladeSamples) {
        const w = root.localToWorld(_v3.copy(p));
        need = Math.max(need, this.floorUnder(w, ent) + 0.0015 - (w.y - gripY));
      }
      return need;
    }
    root.getWorldPosition(_v);
    const s = this.world.supportBelow(_v2.set(_v.x, _v.y + 0.12, _v.z), ent, 1.5);
    return (s ? s.y : 0) + ent.restOffset + (gripY - _v.y) + 0.002;
  }

  // ---------------- knife ----------------
  knifeContact(hand, knife, dt) {
    const st = knife.state, root = knife.root;
    const pts = knife.geom.bladeSamples.map(p => root.localToWorld(p.clone()));
    const speed = hand.velocity.length();
    // jars
    let inJar = null;
    for (const w of pts) {
      const jar = this.jarAt(w); if (!jar) continue;
      const l = jar.root.worldToLocal(_v.copy(w));
      if (l.y < jar.state.surfaceY + 0.008) { inJar = jar; break; }
    }
    for (const j of this.jars) {
      const prev = this.dip.get(j) || 0;
      if (j === inJar) {
        if (prev === 0) this.emit('dip_start', { hand: hand.side, jar: j.id, t: this.t, load: +st.load.toFixed(3) });
        const nt = prev + dt; this.dip.set(j, nt);
        if (nt >= this.th.knife_load_seconds && (st.load < 0.4 || st.substance !== j.kind.replace('_jar', ''))) this.loadKnife(hand, knife, j);
      } else if (prev > 0) { this.dip.set(j, 0); this.emit('dip_end', { hand: hand.side, jar: j.id, t: this.t, load: +st.load.toFixed(3) }); }
    }
    // slices: only top faces that are exposed
    let contactSlice = null, contactFace = null;
    for (const s of this.world.entities.values()) {
      if (s.kind !== 'slice' || s.state.inBag || s.heldBy) continue;
      const up = _v3.set(0, 1, 0).applyQuaternion(s.root.getWorldQuaternion(_q)).y >= 0 ? 1 : -1;
      if (this.sliceCovered(s)) continue;
      let hit = false;
      for (const w of pts) {
        const l = s.root.worldToLocal(_v.copy(w)), yf = up * l.y;
        if (yf < SLICE.t / 2 - 0.005 || yf > SLICE.t / 2 + 0.006) continue;
        if (l.x < SPREAD_BB.x0 || l.x > SPREAD_BB.x1 || l.z < SPREAD_BB.z0 || l.z > SPREAD_BB.z1) continue;
        hit = true;
        if (!this._lastDab) this._lastDab = new Map();
        const key = pts.indexOf(w), last = this._lastDab.get(key);
        if (last && last.distanceTo(w) < 0.004) continue;
        this._lastDab.set(key, w.clone());
        if (st.load > 0.01 && st.substance) {
          const face = up > 0 ? 'A' : 'B';
          const L = s.layers[st.substance + face];
          const u = (l.x - SPREAD_BB.x0) / (SPREAD_BB.x1 - SPREAD_BB.x0);
          const v = (l.z - SPREAD_BB.z0) / (SPREAD_BB.z1 - SPREAD_BB.z0); // same planar map on both faces
          L.dab(u, v, 0.085, Math.min(1, 0.3 + 0.6 * st.load));
          st.load = Math.max(0, st.load - 0.0042);
          st.residue[st.substance] = Math.max(st.residue[st.substance], 0.6);
          contactSlice = s; contactFace = face;
        }
      }
      if (hit && !contactSlice) { contactSlice = s; contactFace = up > 0 ? 'A' : 'B'; }
      if (hit) break;
    }
    if (contactSlice && st.load > 0 && this.t - this._lastSpreadEmit > 0.15 && st.substance) {
      this._lastSpreadEmit = this.t;
      const L = contactSlice.layers[st.substance + contactFace];
      this.emit('spread', { hand: hand.side, obj: contactSlice.id, face: contactFace, substance: st.substance, coverage: +L.measure().toFixed(3), load: +st.load.toFixed(3), t: this.t });
    }
    // cutting: unloaded knife drawn across a sandwich (slice resting on a slice)
    if (contactSlice && contactSlice.restingOn?.startsWith?.('slice') && st.load < 0.05) {
      const l = contactSlice.root.worldToLocal(pts[2].clone());
      if (!this.cutPath || this.cutPath.slice !== contactSlice) this.cutPath = { slice: contactSlice, start: l.clone(), max: 0 };
      this.cutPath.max = Math.max(this.cutPath.max, l.distanceTo(this.cutPath.start));
      if (this.cutPath.max > 0.085 && !contactSlice.state.cut) { contactSlice.state.cut = true; this.emit('cut', { hand: hand.side, obj: contactSlice.id, t: this.t }); }
    } else if (!contactSlice) this.cutPath = null;
    if (st.load <= 0.01 && st.substance && st.load !== 0) { st.load = 0; }
    // towel wipe
    const towel = this.task.towel;
    if (!towel.heldBy && speed > 0.03) {
      for (const w of pts) {
        const l = towel.root.worldToLocal(_v.copy(w));
        if (Math.abs(l.x) < 0.12 && Math.abs(l.z) < 0.08 && l.y < 0.024 && l.y > 0.004) {
          st.residue.pb *= 0.93; st.residue.jelly *= 0.93; st.load *= 0.9;
          if (this.t - this._lastWipeEmit > 0.25) { this._lastWipeEmit = this.t; this.emit('wipe', { hand: hand.side, obj: 'knife', residue: { pb: +st.residue.pb.toFixed(3), jelly: +st.residue.jelly.toFixed(3) }, t: this.t }); }
          break;
        }
      }
    }
    knife.updateGlob(this.world.M);
  }

  sliceCovered(s) { for (const o of this.world.entities.values()) if (o.kind === 'slice' && o !== s && o.restingOn === s.id) return true; return false; }

  loadKnife(hand, knife, jar) {
    const st = knife.state, sub = jar.kind.replace('_jar', ''), other = sub === 'pb' ? 'jelly' : 'pb';
    const dirty = (st.substance === other && st.load > 0.05) || st.residue[other] > 0.15;
    if (dirty) {
      jar.state.contamination[other] = Math.min(1, jar.state.contamination[other] + 0.5);
      jar.parts.smear.visible = true; jar.parts.smear.position.y = jar.state.surfaceY + 0.0006;
      this.emit('contamination', { hand: hand.side, jar: jar.id, by: other, residue: +st.residue[other].toFixed(3), t: this.t });
    }
    st.load = 1; st.substance = sub; st.residue[sub] = Math.max(st.residue[sub], 0.8);
    jar.setAmount(Math.max(0, jar.state.amount - 0.04));
    this.dip.set(jar, -1e9); // require leaving the jar before re-loading
    this.emit('knife_load', { hand: hand.side, jar: jar.id, substance: sub, t: this.t });
  }

  ringBell(bell, hand) {
    ding();
    const p = bell.parts.plunger; p.position.y = 0.055; setTimeout(() => (p.position.y = 0.06), 120);
    this.emit('bell', { hand: hand.side, obj: bell.id, t: this.t });
  }

  // ---------------- release ----------------
  release(hand) {
    const H = hand.hold, ent = H?.ent; hand.holding = null; hand.hold = null;
    if (!ent) return;
    ent.heldBy = null;
    const base = { hand: hand.side, obj: ent.id, kind: ent.kind, t: this.t, pos: ent.root.getWorldPosition(new THREE.Vector3()).toArray() };
    if (H.mode !== 'free') { this.emit('release', { ...base, constraint: H.mode, value: ent.constraint?.joint.value ?? ent.state.openness }); if (ent.constraint) this.emit(ent.kind === 'drawer' ? 'drawer' : 'door', { obj: ent.id, open: +ent.constraint.joint.value.toFixed(3), t: this.t }); return; }
    // lid back on a jar?
    if (ent.kind.endsWith('_lid')) {
      const jar = this.jars.find(j => j.lid === ent);
      const l = jar.root.worldToLocal(base.pos && new THREE.Vector3(...base.pos));
      if (Math.hypot(l.x, l.z) < 0.03 && l.y > jar.geom.rimY - 0.02 && l.y < jar.geom.rimY + 0.06) {
        jar.root.add(ent.root); ent.root.position.set(0, ent.seatY + 0.003, 0); ent.root.quaternion.identity();
        ent.state.onJar = jar; ent.state.openness = this.th.lid_turns_to_open - 0.2; ent.state.tight = false; jar.state.open = false;
        ent.restingOn = jar.id;
        this.emit('release', { ...base, on: jar.id }); this.emit('lid_on', { hand: hand.side, obj: ent.id, jar: jar.id, t: this.t });
        return;
      }
    }
    if (ent.kind === 'bread_clip') {
      const bag = this.task.bag, tail = bag.root.localToWorld(bag.clip.attachPose.pos.clone());
      if (tail.distanceTo(new THREE.Vector3(...base.pos)) < 0.06) {
        bag.root.add(ent.root); ent.root.position.copy(ent.attachPose.pos); ent.root.quaternion.copy(ent.attachPose.quat);
        ent.state.onBag = bag; bag.setOpen(false); ent.restingOn = bag.id;
        this.emit('release', { ...base, on: bag.id }); this.emit('bag_closed', { hand: hand.side, obj: bag.id, t: this.t });
        return;
      }
    }
    const below = this.world.drop(ent);
    this.emit('release', { ...base, on: below?.owner?.id || below?.fixture || (below ? 'surface' : 'floor') });
  }
}
