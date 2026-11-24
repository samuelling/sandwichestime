// Reacher: turns "this hand points at this spot on the screen" into a 3D reach
// target. Shared by the mouse (one active hand) and the webcam (both hands).
//   not holding  -> the hand rides just above whatever is under the ray
//   holding      -> the held object travels over the support under the ray, at
//                   `lift` above its resting height (lift 0 = pressed down)
//   drawer/door  -> the hand slides in the plane of the handle
//   lid on a jar -> the hand stays on the lid while it is unscrewed
import * as THREE from 'three';
import { isDescendant } from '../core/world.js';

const _ray = new THREE.Raycaster(), _plane = new THREE.Plane(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

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
