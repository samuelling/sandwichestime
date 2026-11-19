// A Hand is the common currency of every input device: a 21-landmark skeleton
// (MediaPipe topology) in world space, a grip point, a pinch state, an
// orientation, and an accumulated wrist roll (for unscrewing lids / flipping).
import * as THREE from 'three';

export const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

// Canonical right hand, local frame: origin wrist, +y toward fingers, +x toward
// thumb, +z = back of hand. Open and pinch poses (metres).
const OPEN = [[0, 0, 0], [0.022, 0.028, -0.008], [0.04, 0.048, -0.014], [0.054, 0.068, -0.018], [0.064, 0.088, -0.02],
  [0.026, 0.09, 0], [0.029, 0.126, 0], [0.03, 0.149, 0], [0.031, 0.17, 0],
  [0.006, 0.095, 0], [0.006, 0.136, 0], [0.006, 0.162, 0], [0.006, 0.183, 0],
  [-0.013, 0.09, 0], [-0.015, 0.126, 0], [-0.016, 0.149, 0], [-0.017, 0.167, 0],
  [-0.029, 0.08, 0], [-0.034, 0.106, 0], [-0.036, 0.123, 0], [-0.038, 0.139, 0]];
const PINCH = [[0, 0, 0], [0.022, 0.028, -0.012], [0.038, 0.05, -0.026], [0.042, 0.075, -0.036], [0.038, 0.098, -0.042],
  [0.026, 0.09, -0.004], [0.031, 0.118, -0.026], [0.034, 0.112, -0.044], [0.037, 0.099, -0.046],
  [0.006, 0.095, -0.004], [0.007, 0.12, -0.034], [0.008, 0.104, -0.054], [0.008, 0.086, -0.052],
  [-0.013, 0.09, -0.004], [-0.014, 0.112, -0.034], [-0.014, 0.097, -0.05], [-0.014, 0.082, -0.046],
  [-0.029, 0.08, -0.004], [-0.032, 0.098, -0.028], [-0.032, 0.088, -0.042], [-0.031, 0.076, -0.04]];
export const GRIP_LOCAL = new THREE.Vector3(0.0375, 0.0985, -0.044); // between thumb tip & index tip in pinch pose

const _v = new THREE.Vector3(), _m = new THREE.Matrix4();

export class Hand {
  constructor(side) {
    this.side = side;                    // 'L' | 'R'
    this.joints = Array.from({ length: 21 }, () => new THREE.Vector3());
    this.grip = new THREE.Vector3();     // pinch point, world
    this.quat = new THREE.Quaternion();  // hand frame, world
    this.closure = 0;                    // 0 open .. 1 pinched (rendering)
    this.pinch = false;                  // logical grasp state
    this.press = false;                  // desktop "apply" (space) — natural contact elsewhere
    this.roll = 0;                       // accumulated wrist roll (rad)
    this.yawOffset = 0;                  // desktop Q/E rotation of held object
    this.flip = false;                   // desktop F toggle
    this.tracked = false;
    this.holding = null;                 // Entity
    this.hover = null;                   // Entity under/near the hand
    this.pickHint = null;                // desktop: entity under the cursor
    this.path = 0;                       // cumulative grip path length (m)
    this._last = null;
    this.velocity = new THREE.Vector3();
  }
  // Pose the canonical skeleton at a grip point with a frame (desktop / synthetic).
  poseSynthetic(grip, quat, closure) {
    this.closure = closure; this.quat.copy(quat);
    const mirror = this.side === 'L' ? -1 : 1;
    const off = _v.copy(GRIP_LOCAL); off.x *= mirror; off.applyQuaternion(quat);
    const wrist = grip.clone().sub(off);
    for (let i = 0; i < 21; i++) {
      const a = OPEN[i], b = PINCH[i];
      this.joints[i].set((a[0] + (b[0] - a[0]) * closure) * mirror, a[1] + (b[1] - a[1]) * closure, a[2] + (b[2] - a[2]) * closure).applyQuaternion(quat).add(wrist);
    }
    this.grip.copy(grip);
  }
  // From world-space landmarks (webcam, XR): derive grip, frame and closure.
  fromJoints(pts) {
    for (let i = 0; i < 21; i++) this.joints[i].copy(pts[i]);
    const J = this.joints;
    this.grip.copy(J[4]).add(J[8]).multiplyScalar(0.5);
    const fwd = _v.copy(J[9]).sub(J[0]).normalize();
    const across = new THREE.Vector3().subVectors(J[5], J[17]).normalize(); // toward thumb side (right hand)
    if (this.side === 'L') across.negate();
    const back = new THREE.Vector3().crossVectors(across, fwd).normalize();
    across.crossVectors(fwd, back).normalize();
    _m.makeBasis(across, fwd, back); this.quat.setFromRotationMatrix(_m);
    const size = J[0].distanceTo(J[9]) || 0.09;
    const d = J[4].distanceTo(J[8]) / size;
    this.closure = THREE.MathUtils.clamp(1 - (d - 0.15) / 0.55, 0, 1);
    return d;
  }
  // Roll about the forward axis, unwrapped and accumulated.
  updateRoll() {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    const fwd = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
    // reference: world up projected perpendicular to fwd
    const ref = new THREE.Vector3(0, 1, 0).addScaledVector(fwd, -fwd.y);
    if (ref.lengthSq() < 1e-4) return;
    ref.normalize();
    const ang = Math.atan2(new THREE.Vector3().crossVectors(ref, right).dot(fwd), ref.dot(right));
    if (this._rollPrev !== undefined) { let d = ang - this._rollPrev; d = Math.atan2(Math.sin(d), Math.cos(d)); this.roll += d; }
    this._rollPrev = ang;
  }
  track(dt) {
    if (this._last) {
      const d = this.grip.distanceTo(this._last);
      if (d < 0.5) { this.path += d; this.velocity.subVectors(this.grip, this._last).divideScalar(Math.max(dt, 1e-3)); }
      this._last.copy(this.grip);
    } else this._last = this.grip.clone();
  }
}

// Renders a Hand as joints + bones (instanced).
export class HandRig {
  constructor(scene, side, color = 0xe2b49a) {
    const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0xffd6c8), transparent: true, opacity: 0.92 });
    this.joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), mat, 21);
    this.bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), mat, BONES.length);
    for (const m of [this.joints, this.bones]) { m.castShadow = true; m.frustumCulled = false; m.userData.noAOI = true; m.userData.isHand = side; scene.add(m); }
    this.palm = new THREE.Mesh(new THREE.BufferGeometry(), mat); this.palm.castShadow = true; this.palm.frustumCulled = false; scene.add(this.palm);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
  }
  set visible(v) { this.joints.visible = this.bones.visible = this.palm.visible = v; }
  update(hand) {
    this.visible = hand.tracked;
    if (!hand.tracked) return;
    const J = hand.joints, m = this._m;
    const radius = i => (i === 0 ? 0.013 : [4, 8, 12, 16, 20].includes(i) ? 0.0075 : [1, 5, 9, 13, 17].includes(i) ? 0.0105 : 0.009);
    for (let i = 0; i < 21; i++) { const r = radius(i); m.compose(J[i], this._q.identity(), this._s.set(r, r, r)); this.joints.setMatrixAt(i, m); }
    BONES.forEach(([a, b], k) => {
      const pa = J[a], pb = J[b], len = pa.distanceTo(pb), r = Math.min(radius(a), radius(b)) * 0.92;
      const mid = new THREE.Vector3().addVectors(pa, pb).multiplyScalar(0.5);
      this._q.setFromUnitVectors(this._up, new THREE.Vector3().subVectors(pb, pa).normalize());
      m.compose(mid, this._q, this._s.set(r, len, r)); this.bones.setMatrixAt(k, m);
    });
    this.joints.instanceMatrix.needsUpdate = this.bones.instanceMatrix.needsUpdate = true;
    // palm: double-sided fan of triangles over wrist + MCPs (buffer allocated once)
    const idx = [0, 1, 5, 0, 5, 9, 0, 9, 13, 0, 13, 17, 1, 2, 5];
    if (!this.palm.geometry.attributes.position) this.palm.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(idx.length * 6), 3));
    const attr = this.palm.geometry.attributes.position, pos = attr.array;
    idx.forEach((j, i) => { pos[i * 3] = J[j].x; pos[i * 3 + 1] = J[j].y; pos[i * 3 + 2] = J[j].z; });
    for (let i = 0; i < idx.length; i += 3) for (const [o, src] of [[0, 0], [1, 2], [2, 1]]) { const k = (idx.length + i + o) * 3, j = idx[i + src]; pos[k] = J[j].x; pos[k + 1] = J[j].y; pos[k + 2] = J[j].z; }
    attr.needsUpdate = true; this.palm.geometry.computeVertexNormals(); this.palm.geometry.computeBoundingSphere();
  }
}
