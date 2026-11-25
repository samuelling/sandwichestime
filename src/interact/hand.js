// A Hand is the common currency of every input device: a 21-landmark skeleton
// (MediaPipe topology) in world space, a grip point, a pinch state, an
// orientation, and an accumulated wrist roll (for unscrewing lids / flipping).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

// Canonical LEFT hand, local frame: origin wrist, +y toward fingers, +x toward
// thumb, +z = back of hand (mirrored in x for the right hand). Open and pinch poses (metres).
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
// A loose fist: each finger curls toward the palm (-z) from its knuckle; the thumb lies across the front of the fingers.
const FIST = OPEN.map(p => p.slice());
for (const [m, k] of [[5, 1], [9, 1.05], [13, 1], [17, 0.85]]) {
  const [x, y] = OPEN[m];
  FIST[m + 1] = [x, y + 0.006 * k, -0.0345 * k]; FIST[m + 2] = [x, y - 0.0157 * k, -0.0383 * k]; FIST[m + 3] = [x, y - 0.022 * k, -0.021 * k];
}
Object.assign(FIST, { 1: [0.022, 0.028, -0.012], 2: [0.032, 0.05, -0.03], 3: [0.022, 0.068, -0.042], 4: [0.006, 0.075, -0.045] });
export const POSE = { OPEN, PINCH, FIST };
// How closed the hand is: mean distance of the four fingertips from the palm centre, in palm lengths (3D, so it does
// not depend on the view). About 1.2 open, 0.4 in a fist. pts: 21 points with x, y, z.
export function curlOf(pts) {
  const c = [0, 5, 17].reduce((a, i) => [a[0] + pts[i].x / 3, a[1] + pts[i].y / 3, a[2] + pts[i].z / 3], [0, 0, 0]);
  const size = Math.hypot(pts[9].x - pts[0].x, pts[9].y - pts[0].y, pts[9].z - pts[0].z) || 1;
  return [8, 12, 16, 20].reduce((a, i) => a + Math.hypot(pts[i].x - c[0], pts[i].y - c[1], pts[i].z - c[2]), 0) / 4 / size;
}
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
    this.xrJoints = null;                // headset only: joint name -> Object3D with the runtime's pose
    this.twistGain = 1;                  // multiplies hand rotation when unscrewing (webcam uses > 1)
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
    const mirror = this.side === 'R' ? -1 : 1;
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
    const across = new THREE.Vector3().subVectors(J[5], J[17]).normalize(); // pinky -> index
    if (this.side === 'R') across.negate();   // so that across × fwd is the back of the hand for both hands
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

// ---------------------------------------------------------------------------
// HandRig: a skinned hand mesh (WebXR generic-hand, 25 bones) driven either by
// the 21 landmarks every input source provides, or directly by WebXR joint poses.
//
// Landmarks carry positions only, so each bone's orientation is built from the
// landmark geometry (bone direction + a palm reference axis). The construction
// is calibrated once against the mesh's bind pose: C = F_bind^-1 * Q_bind, so at
// run time Q = F * C. That makes it independent of the rig's axis conventions.
// ---------------------------------------------------------------------------

const FINGER_NAMES = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
// 25 rig joints: [name, landmark index or -1 (finger metacarpals are not landmarks), kind, finger]
const RIG = [['wrist', 0, 'wrist', -1], ['thumb-metacarpal', 1, 'thumb', 0], ['thumb-phalanx-proximal', 2, 'thumb', 0], ['thumb-phalanx-distal', 3, 'thumb', 0], ['thumb-tip', 4, 'thumbtip', 0]];
FINGER_NAMES.forEach((f, k) => {
  const b = 5 + 4 * k;
  RIG.push([`${f}-metacarpal`, -1, 'meta', k], [`${f}-phalanx-proximal`, b, 'seg', k], [`${f}-phalanx-intermediate`, b + 1, 'seg', k], [`${f}-phalanx-distal`, b + 2, 'seg', k], [`${f}-tip`, b + 3, 'tip', k]);
});
export const HAND_TONES = { neutral: 0xc4ccd2, tone1: 0xf1d2c0, tone2: 0xe2b594, tone3: 0xc48d68, tone4: 0x97623f, tone5: 0x5b3a27 };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _mm = new THREE.Matrix4();
function frameFrom(dir, ref, alt, out) {       // y = dir, x ≈ ref (perpendicular to dir), z = x × y
  _a.copy(ref).addScaledVector(dir, -ref.dot(dir));
  if (_a.lengthSq() < 0.03) _a.copy(alt).addScaledVector(dir, -alt.dot(dir));
  _a.normalize(); _b.crossVectors(_a, dir);
  return out.setFromRotationMatrix(_mm.makeBasis(_a, dir, _b));
}
// landmarks (21 Vector3) -> 25 joint positions + constructed frames
function solve(L, metaLocal, sizeRef, P, F) {
  const fwd = _c.subVectors(L[9], L[0]); const size = fwd.length() || 0.09; fwd.divideScalar(size);
  const across = new THREE.Vector3().subVectors(L[5], L[17]).normalize();
  const normal = new THREE.Vector3().crossVectors(across, fwd).normalize();
  across.crossVectors(fwd, normal).normalize();
  const fwd0 = fwd.clone();
  const palmQ = new THREE.Quaternion().setFromRotationMatrix(_mm.makeBasis(across, fwd0, normal));
  const s = sizeRef ? size / sizeRef : 1;
  RIG.forEach(([, li, kind, k], j) => {
    if (kind === 'wrist') { P[j].copy(L[0]); F[j].copy(palmQ); return; }
    if (kind === 'meta') {
      if (metaLocal) P[j].copy(metaLocal[k]).multiplyScalar(s).applyQuaternion(palmQ).add(L[0]); // else P[j] preset (bind)
      frameFrom(_d.subVectors(L[5 + 4 * k], P[j]).normalize(), across, normal, F[j]); return;
    }
    P[j].copy(L[li]);
    const tip = kind === 'tip' || kind === 'thumbtip';
    _d.subVectors(tip ? L[li] : L[li + 1], tip ? L[li - 1] : L[li]).normalize();
    frameFrom(_d, kind.startsWith('thumb') ? normal : across, kind.startsWith('thumb') ? across : normal, F[j]);
  });
  return palmQ;
}

export class HandRig {
  constructor(scene, side, { tone = 'neutral' } = {}) {
    this.scene = scene; this.side = side; this.ready = false;
    this.mat = new THREE.MeshPhysicalMaterial({ color: HAND_TONES[tone] ?? HAND_TONES.neutral, roughness: 0.52, sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffe4d6), clearcoat: 0.06, clearcoatRoughness: 0.6 });
    this.P = Array.from({ length: 25 }, () => new THREE.Vector3()); this.F = Array.from({ length: 25 }, () => new THREE.Quaternion());
    this.fallback = new SkeletonRig(scene, side, this.mat);
    this.load();
  }
  async load() {
    try {
      const url = new URL(`../../vendor/hands/${this.side === 'L' ? 'left' : 'right'}.glb`, import.meta.url).href;
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene; this.scene.add(root); root.updateMatrixWorld(true);
      let mesh = null; root.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
      const holder = new THREE.Group(); holder.name = `hand_${this.side}`; this.scene.add(holder);
      this.bones = RIG.map(([name]) => { const b = root.getObjectByName(name); holder.attach(b); return b; });   // bones now live in world space
      // forearm: the hand mesh is open at the wrist and a first-person camera looks straight into that opening,
      // so continue it with a tapered forearm that dissolves (dithered) toward the elbow
      mesh.geometry.computeBoundingBox();
      const wy = this.bones[0].getWorldPosition(new THREE.Vector3()); mesh.worldToLocal(wy);
      this.cuff = Math.max(0, mesh.geometry.boundingBox.max.y - wy.y);
      const fg = new THREE.CylinderGeometry(0.036, 0.0285, 0.27, 32, 6, true); fg.translate(0, 0.135, 0);
      const fm = this.mat.clone(); fm.alphaHash = true;
      fm.onBeforeCompile = sh => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vAlongY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlongY = position.y;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlongY;').replace('#include <alphahash_fragment>', 'diffuseColor.a *= 1.0 - smoothstep(0.15, 0.265, vAlongY);\n#include <alphahash_fragment>');
      };
      this.forearm = new THREE.Mesh(fg, fm); this.forearm.scale.z = 0.74; this.forearm.castShadow = true; this.forearm.receiveShadow = true; this.forearm.frustumCulled = false;
      this.forearm.userData.noAOI = true; this.forearm.userData.isHand = this.side; this.forearm.visible = false; this.scene.add(this.forearm);
      mesh.material = this.mat; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      mesh.userData.noAOI = true; mesh.userData.isHand = this.side;
      // bind-pose calibration
      const Pb = this.bones.map(b => b.position.clone()), Qb = this.bones.map(b => b.quaternion.clone());
      const Lb = Array.from({ length: 21 }, () => new THREE.Vector3());
      RIG.forEach(([, li], j) => { if (li >= 0) Lb[li].copy(Pb[j]); });
      const P = Pb.map(p => p.clone()), F = Pb.map(() => new THREE.Quaternion());
      const palmQ = solve(Lb, null, 0, P, F), inv = palmQ.clone().invert();
      this.sizeRef = Lb[9].distanceTo(Lb[0]);
      this.metaLocal = [0, 1, 2, 3].map(k => Pb[5 + 5 * k].clone().sub(Pb[0]).applyQuaternion(inv));
      this.C = F.map((f, j) => f.clone().invert().multiply(Qb[j]));
      this.mesh = mesh; this.root = root; this.ready = true;
    } catch (e) { console.warn('hand mesh unavailable, using skeleton hands', e); }
  }
  set visible(v) { if (this.mesh) this.mesh.visible = v && this.ready; if (this.forearm) this.forearm.visible = v && this.ready; this.fallback.visible = v && !this.ready; }
  // shoulder (optional, world): the forearm leans from the wrist back toward where the elbow would be
  placeForearm(hand, shoulder) {
    const W = hand.joints[0], fwd = _c.subVectors(hand.joints[9], W).normalize();
    const dir = _d.copy(fwd).negate();
    if (shoulder) { _a.set(shoulder.x, shoulder.y - 0.3, shoulder.z + 0.02).sub(W).normalize(); dir.multiplyScalar(0.62).addScaledVector(_a, 0.38).normalize(); }
    const x = _a.set(1, 0, 0).applyQuaternion(hand.quat); x.addScaledVector(dir, -x.dot(dir)).normalize();
    const z = _b.crossVectors(x, dir);
    this.forearm.quaternion.setFromRotationMatrix(_mm.makeBasis(x, dir, z));
    this.forearm.position.copy(W).addScaledVector(fwd, -(this.cuff - 0.022));
  }
  update(hand, shoulder) {
    this.visible = hand.tracked;
    if (!hand.tracked) return;
    if (!this.ready) { this.fallback.update(hand); return; }
    this.placeForearm(hand, shoulder);
    if (hand.xrJoints) {             // headset: copy the runtime's own joint poses
      RIG.forEach(([name], j) => { const o = hand.xrJoints[name]; if (o) { o.getWorldPosition(this.bones[j].position); o.getWorldQuaternion(this.bones[j].quaternion); } });
      return;
    }
    solve(hand.joints, this.metaLocal, this.sizeRef, this.P, this.F);
    for (let j = 0; j < 25; j++) { this.bones[j].position.copy(this.P[j]); this.bones[j].quaternion.copy(this.F[j]).multiply(this.C[j]); }
  }
}

// Fallback / debug: joints + bones as instanced primitives.
class SkeletonRig {
  constructor(scene, side, mat) {
    this.joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), mat, 21);
    this.bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), mat, BONES.length);
    for (const m of [this.joints, this.bones]) { m.castShadow = true; m.frustumCulled = false; m.userData.noAOI = true; m.userData.isHand = side; m.visible = false; scene.add(m); }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
  }
  set visible(v) { this.joints.visible = this.bones.visible = v; }
  update(hand) {
    const J = hand.joints, m = this._m;
    const radius = i => (i === 0 ? 0.013 : [4, 8, 12, 16, 20].includes(i) ? 0.0075 : [1, 5, 9, 13, 17].includes(i) ? 0.0105 : 0.009);
    for (let i = 0; i < 21; i++) { const r = radius(i); m.compose(J[i], this._q.identity(), this._s.set(r, r, r)); this.joints.setMatrixAt(i, m); }
    BONES.forEach(([a, b], k) => {
      const pa = J[a], pb = J[b], len = pa.distanceTo(pb), r = Math.min(radius(a), radius(b)) * 0.92;
      this._q.setFromUnitVectors(this._up, _a.subVectors(pb, pa).normalize());
      m.compose(_b.addVectors(pa, pb).multiplyScalar(0.5), this._q, this._s.set(r, len, r)); this.bones.setMatrixAt(k, m);
    });
    this.joints.instanceMatrix.needsUpdate = this.bones.instanceMatrix.needsUpdate = true;
  }
}
