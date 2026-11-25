// Desktop pilot controls: the cursor drives the active hand; click toggles grasp.
// Not the scientific mode, but it exercises every code path and logs identically.
import * as THREE from 'three';
import { Reacher } from './reach.js';
import { clamp } from '../util/util.js';

const _v = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0), _e = new THREE.Euler();

export class Body {
  constructor() { this.x = 0; this.targetX = 0; this.z = 0.5; this.yaw = 0; this.pitch = -0.62; this.eye = 1.62; this.xMin = -2.0; this.xMax = 1.35; }
  update(dt) { this.x += (this.targetX - this.x) * (1 - Math.exp(-dt * 6)); }
  step(dx, bus) { const nx = clamp(this.targetX + dx, this.xMin, this.xMax); if (nx !== this.targetX) { this.targetX = nx; bus?.emit('step', { x: +nx.toFixed(3) }); } }
  // head: view offsets from head tracking (yaw, pitch in rad; dx, dy, dz in m, in the body's frame), on top of the body
  applyToCamera(cam) {
    const H = this.head;
    cam.position.set(this.x, this.eye, this.z);
    if (H) cam.position.add(_v.set(H.dx, H.dy, H.dz).applyAxisAngle(_yAxis, this.yaw));
    cam.quaternion.setFromEuler(_e.set(clamp(this.pitch + (H?.pitch ?? 0), -1.4, 0.7), this.yaw + (H?.yaw ?? 0), 0, 'YXZ'));
  }
  shoulder(side, out = new THREE.Vector3()) {
    return out.set(side === 'L' ? -0.18 : 0.18, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(_v.set(this.x, 1.38, this.z - 0.3));   // the viewpoint sits back from the counter; the shoulders are at its edge
  }
}

export function palmDownQuat(yaw, pitchDown = 0.45) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 - pitchDown, yaw, 0, 'YXZ'));
}

export class MouseInput {
  constructor(canvas, camera, world, hands, manip, body) {
    Object.assign(this, { canvas, camera, world, hands, manip, body });
    this.reacher = new Reacher(camera, world, manip, body);
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
  }
  step(dx) { this.body.step(dx, this.bus); }
  get gazeScreen() { return this.screen || [0.5, 0.5]; }

  update(dt) {
    this.body.update(dt);
    const i = this.active, h = this.hands[i];
    h.press = this.keys.has('Space');
    if (this.toggle[i]) { this.toggle[i] = false; h.pinch = !h.holding; if (!h.pinch) this.lift[i] = 0.07; }
    this.reacher.aim(h, this.ndc, this.targets[i], h.press ? 0 : this.lift[i]);
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
