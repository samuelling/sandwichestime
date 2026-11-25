// Reacher: turns "this hand points at this spot on the screen" into a 3D reach
// target. Shared by the mouse (one active hand) and the webcam (both hands).
//   not holding  -> the hand rides just above whatever is under the ray
//   holding      -> the held object travels over the support under the ray, at
//                   `lift` above its resting height (lift 0 = pressed down)
//   drawer/door  -> the hand slides in the plane of the handle
//   lid on a jar -> the hand stays on the lid while it is unscrewed
import * as THREE from 'three';
import { isDescendant } from '../core/world.js';

const _ray = new THREE.Raycaster(), _plane = new THREE.Plane(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _down = new THREE.Vector3(0, -1, 0), _w = new THREE.Vector3(), _w2 = new THREE.Vector3();

export class Reacher {
  constructor(camera, world, manip, body) { Object.assign(this, { camera, world, manip, body }); this.rayTargets = null; this.maxReach = 1.0 /* arm plus a lean; beyond that, step sideways or use the other hand */; this.onLimit = null; this._lim = -1e9; }
  pick(ndc, exclude) {
    if (!this.rayTargets) this.rayTargets = [...new Set([...this.world.aoiMeshes, ...this.world.supportMeshes])];
    _ray.setFromCamera(ndc, this.camera); _ray.far = 12;
    for (const h of _ray.intersectObjects(this.rayTargets, false)) {
      if (exclude && isDescendant(h.object, exclude.root)) continue;
      if (!h.object.visible) continue;
      return h;
    }
    return null;
  }
  supportHit(ndc, exclude) {
    _ray.setFromCamera(ndc, this.camera); _ray.far = 12;
    for (const h of _ray.intersectObjects(this.world.supportMeshes, false)) {
      if (exclude && isDescendant(h.object, exclude.root)) continue;
      const own = h.object.userData.supportOwner; if (own && (own.heldBy || own.state?.inBag)) continue;
      return h;
    }
    return null;
  }
  // Writes the reach target for `hand` into T. lift: metres above resting height while holding.
  aim(hand, ndc, T, lift = 0.07, hover = 0.012) {
    if (hand.holding && hand.hold) {
      const mode = hand.hold.mode;
      if (mode === 'twist') T.copy(hand.hold.p0);
      else if (mode === 'prismatic' || mode === 'hinge') {
        _ray.setFromCamera(ndc, this.camera); _plane.set(_up, -hand.hold.p0.y);
        if (_ray.ray.intersectPlane(_plane, _v)) T.copy(_v);
      } else {
        const s = this.supportHit(ndc, hand.holding);
        if (s) { T.x = s.point.x; T.z = s.point.z; }
        const base = this.manip.pressGripY(hand);
        if (base !== null) T.y = base + lift;
      }
      hand.pickHint = null;
    } else {
      const hit = this.pick(ndc, null);
      if (hit) {
        const n = hit.face ? _v.copy(hit.face.normal).transformDirection(hit.object.matrixWorld) : _v.set(0, 1, 0);
        T.copy(hit.point).addScaledVector(n, hover);
        // what the ray lands on, refined to the smallest graspable thing right there (the clip on the bag, the lid on the jar)
        const e = this.manip.nearestTo(hit.point, hand, 0.03) || this.world.entityOf(hit.object);
        hand.pickHint = e && !(e.role === 'fixture' && !e.constraint) ? e : null; hand.pickPoint = hit.point.clone();
      } else hand.pickHint = null;
    }
    return this.limit(hand, T);
  }
  // Counter mapping (webcam): the hand goes to a 3D point P in front of the body rather than along a screen ray.
  // Not holding: it stays above whatever is under it, and can take what is under it from up to `reachDown` above.
  // Holding: drawers/doors follow P in the handle's plane; a free object goes over P and the caller sets the height
  // from the returned resting grip height (null if there is none). Writes T.
  aimPoint(hand, P, T, hover = 0.012, reachDown = 0.16) {
    let base = null;
    if (hand.holding && hand.hold) {
      const mode = hand.hold.mode;
      if (mode === 'twist') T.copy(hand.hold.p0);
      else if (mode === 'prismatic' || mode === 'hinge') T.set(P.x, hand.hold.p0.y, P.z);
      else { T.x = P.x; T.z = P.z; T.y = P.y; base = this.manip.pressGripY(hand); }
      hand.pickHint = null;
    } else {
      T.copy(P);
      if (!this.rayTargets) this.rayTargets = [...new Set([...this.world.aoiMeshes, ...this.world.supportMeshes])];
      _ray.set(_v.set(P.x, P.y + 0.6, P.z), _down); _ray.far = 3;
      let hit = null;
      for (const h of _ray.intersectObjects(this.rayTargets, false)) { if (!h.object.visible || h.point.y > P.y + 0.1) continue; hit = h; break; }     /* skip a shelf overhead */
      if (hit && hit.point.y + hover > T.y) T.y = hit.point.y + hover;
      const under = hit && T.y - hit.point.y < reachDown;
      // what is directly under the hand wins (the clip on the bag, the lid on the jar); otherwise whatever the hand is right next to (a drawer handle)
      let e = (under ? this.manip.nearestTo(hit.point, hand, 0.03) || this.world.entityOf(hit.object) : null) || this.manip.nearestTo(T, hand, 0.05);
      // a small thing already offered (the clip, the lid) stays offered until the hand is clearly off it, so tracker
      // jitter cannot swap it for the bigger thing it sits on in the moment of the pinch. Never the other way round.
      const prev = hand.pickHint;
      // "Still by it" is judged sideways, at the thing's own height: a hand drifting just past the clip's edge sends the
      // ray down to the counter 8 cm below, which says nothing about how far the hand is from the clip.
      const near = prev && (this.manip.distanceTo(prev, _w.set(T.x, prev.root.getWorldPosition(_w2).y, T.z)) < 0.035 || this.manip.distanceTo(prev, under ? hit.point : T) < (under ? 0.045 : 0.065));
      if (prev && e && e !== prev && !prev.heldBy && this.manip.sizeOf(prev) < this.manip.sizeOf(e) && near) e = prev;
      hand.pickWhy = { under: !!under, hit: hit ? this.world.entityOf(hit.object)?.id ?? hit.object.name : null, hy: hit ? +hit.point.y.toFixed(3) : null, Ty: +T.y.toFixed(3), Py: +P.y.toFixed(3), prev: prev?.id, near: !!near };      /* for diagnosing picks */      /* looser than the 3 cm that picks it */
      hand.pickHint = e && !(e.role === 'fixture' && !e.constraint) ? e : null; hand.pickPoint = (under ? hit.point : T).clone();
      if (under && hand.pickHint) T.y = hit.point.y + hover;      /* something to take right below: the hand dips onto it, so it is held at the hand */
    }
    this.limit(hand, T);
    return base;
  }
  limit(hand, T) {
    // arm's length from the shoulder (not while operating a drawer/door, which defines its own path)
    if (!(hand.hold && hand.hold.mode !== 'free')) {
      const sh = this.body.shoulder(hand.side), d = T.distanceTo(sh);
      if (d > this.maxReach) {
        T.sub(sh).multiplyScalar(this.maxReach / d).add(sh);
        if (d > this.maxReach + 0.06 && performance.now() - this._lim > 6000) { this._lim = performance.now(); this.onLimit?.(hand); }
      }
    }
    return T;
  }
}
