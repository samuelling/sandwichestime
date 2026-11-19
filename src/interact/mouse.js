// Desktop pilot controls: the cursor drives the active hand; click toggles grasp.
// Not the scientific mode, but it exercises every code path and logs identically.
import * as THREE from 'three';
import { isDescendant } from '../core/world.js';
import { clamp } from '../util/util.js';

const _v = new THREE.Vector3(), _ray = new THREE.Raycaster(), _plane = new THREE.Plane(), _q = new THREE.Quaternion();

export class Body {
  constructor() { this.x = 0; this.targetX = 0; this.z = 0.5; this.yaw = 0; this.pitch = -0.62; this.eye = 1.62; this.xMin = -2.0; this.xMax = 1.35; }
  update(dt) { this.x += (this.targetX - this.x) * (1 - Math.exp(-dt * 6)); }
  applyToCamera(cam) {
    cam.position.set(this.x, this.eye, this.z);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }
  shoulder(side, out = new THREE.Vector3()) {
    return out.set(side === 'L' ? -0.18 : 0.18, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(_v.set(this.x, 1.38, this.z - 0.05));
  }
}

export function palmDownQuat(yaw, pitchDown = 0.45) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 - pitchDown, yaw, 0, 'YXZ'));
}

export class MouseInput {
  constructor(canvas, camera, world, hands, manip, body) {
    Object.assign(this, { canvas, camera, world, hands, manip, body });
    this.ndc = new THREE.Vector2(0, -0.2); this.active = 1; this.lift = [0.07, 0.07];
    this.targets = [new THREE.Vector3(body.x - 0.22, 1.02, 0.18), new THREE.Vector3(body.x + 0.22, 1.02, 0.18)];
    this.smooth = this.targets.map(t => t.clone());
    this.closure = [0.1, 0.1];
    this.keys = new Set(); this.dragLook = null; this.toggle = [false, false];
    this.bus = world.bus;
    hands.forEach((h, i) => { h.tracked = true; h.poseSynthetic(this.targets[i], palmDownQuat(0), 0.1); });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.screen = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
      if (this.dragLook) {
        body.yaw = clamp(this.dragLook.yaw - (e.clientX - this.dragLook.x) * 0.004, -1.6, 1.6);
        body.pitch = clamp(this.dragLook.pitch - (e.clientY - this.dragLook.y) * 0.004, -1.25, 0.35);
      }
    });
    canvas.addEventListener('pointerdown', e => {
      if (e.button === 2) { this.dragLook = { x: e.clientX, y: e.clientY, yaw: body.yaw, pitch: body.pitch }; return; }
      if (e.button === 0) this.toggle[this.active] = true;
    });
    window.addEventListener('pointerup', e => { if (e.button === 2) this.dragLook = null; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const h = hands[this.active], d = Math.sign(e.deltaY);
      if (h.hold?.mode === 'twist') h.twist = (h.twist || 0) + d * 0.42;
      else if (h.holding) this.lift[this.active] = clamp(this.lift[this.active] - d * 0.012, 0.0, 0.45);
    }, { passive: false });
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
      const h = hands[this.active];
      if (e.code === 'Tab') { e.preventDefault(); this.active = 1 - this.active; this.bus.emit('ui', { action: 'switch_hand', hand: hands[this.active].side }); }
      if (e.code === 'KeyF') h.flip = !h.flip;
      if (e.code === 'KeyQ') h.yawOffset += 0.26;
      if (e.code === 'KeyE') h.yawOffset -= 0.26;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.step(-0.35);
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.step(0.35);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    this.rayTargets = null;
  }
  step(dx) {
    const b = this.body, nx = clamp(b.targetX + dx, b.xMin, b.xMax);
    if (nx !== b.targetX) { b.targetX = nx; this.bus.emit('step', { x: +nx.toFixed(3) }); }
  }
  get gazeScreen() { return this.screen || [0.5, 0.5]; }

  pick(exclude) {
    if (!this.rayTargets) this.rayTargets = [...new Set([...this.world.aoiMeshes, ...this.world.supportMeshes])];
    _ray.setFromCamera(this.ndc, this.camera);
    for (const h of _ray.intersectObjects(this.rayTargets, false)) {
      if (exclude && isDescendant(h.object, exclude.root)) continue;
      if (!h.object.visible) continue;
      return h;
    }
    return null;
  }
  supportHit(exclude) {
    _ray.setFromCamera(this.ndc, this.camera);
    for (const h of _ray.intersectObjects(this.world.supportMeshes, false)) {
      if (exclude && isDescendant(h.object, exclude.root)) continue;
      const own = h.object.userData.supportOwner; if (own && own.heldBy) continue;
      return h;
    }
    return null;
  }

  update(dt) {
    this.body.update(dt);
    const i = this.active, h = this.hands[i], T = this.targets[i];
    h.press = this.keys.has('Space');
    // grasp toggle
    if (this.toggle[i]) { this.toggle[i] = false; h.pinch = !h.holding; if (!h.pinch) this.lift[i] = 0.07; }
    if (h.holding && h.hold) {
      const mode = h.hold.mode;
      if (mode === 'twist') T.copy(h.hold.p0);
      else if (mode === 'prismatic' || mode === 'hinge') {
        _ray.setFromCamera(this.ndc, this.camera); _plane.set(new THREE.Vector3(0, 1, 0), -h.hold.p0.y);
        if (_ray.ray.intersectPlane(_plane, _v)) T.copy(_v);
      } else {
        const s = this.supportHit(h.holding);
        if (s) { T.x = s.point.x; T.z = s.point.z; }
        const base = this.manip.pressGripY(h);
        if (base !== null) T.y = base + (h.press ? 0 : this.lift[i]);
      }
      h.pickHint = null;
    } else {
      const hit = this.pick(null);
      if (hit) {
        T.copy(hit.point).addScaledVector(hit.face ? _v.copy(hit.face.normal).transformDirection(hit.object.matrixWorld) : _v.set(0, 1, 0), 0.012);
        h.pickHint = this.world.entityOf(hit.object);
        if (h.pickHint?.role === 'fixture' && !h.pickHint.constraint) h.pickHint = null;
      } else h.pickHint = null;
    }
    // reach limit from the shoulder
    for (const k of [0, 1]) {
      const sh = this.body.shoulder(this.hands[k].side), d = this.targets[k].distanceTo(sh);
      if (d > 0.78 && !(this.hands[k].hold && this.hands[k].hold.mode !== 'free')) this.targets[k].sub(sh).multiplyScalar(0.78 / d).add(sh);
    }
    // reach dynamics + synthetic pose
    this.hands.forEach((hh, k) => {
      this.smooth[k].lerp(this.targets[k], 1 - Math.exp(-dt * 18));
      const want = hh.holding || hh.pinch ? 1 : 0.12;
      this.closure[k] += (want - this.closure[k]) * (1 - Math.exp(-dt * 16));
      hh.poseSynthetic(this.smooth[k], palmDownQuat(this.body.yaw), this.closure[k]);
      hh.track(dt);
    });
  }
  postUpdate() { for (const h of this.hands) if (h.pinch && !h.holding) h.pinch = false; }
}
