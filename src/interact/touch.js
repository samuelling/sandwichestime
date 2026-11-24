// Touch-screen controls (phones and tablets). Same model as the mouse, re-cut for one finger:
//
//   tap something       the active hand goes there and grabs it; holding something, a tap
//                       carries it to that spot and puts it down
//   drag                moves the hand (and what it holds); the hand rides a little above
//                       the finger so the finger does not cover it
//   drag in a circle    on a lid you have grabbed: unscrews it (counter-clockwise)
//   buttons             Press (lower what you hold: dip, spread, cut), Flip, Let go,
//                       Left/Right hand, step sideways
//
// It drives the same Hand / Reacher / Manipulator path as the other inputs, so logs are identical.
import * as THREE from 'three';
import { Reacher } from './reach.js';
import { palmDownQuat } from './mouse.js';

const TAP_MS = 380, TAP_PX = 14, DRAG_LIFT_PX = 44, TWIST_GAIN = 2.0, CARRY = 0.07;
const _v = new THREE.Vector3();

export class TouchInput {
  constructor(canvas, camera, world, hands, manip, body) {
    Object.assign(this, { canvas, camera, world, hands, manip, body, bus: world.bus });
    this.reacher = new Reacher(camera, world, manip, body);
    this.active = 1; this.pressOn = false; this.t = 0;
    this.targets = [new THREE.Vector3(body.x - 0.3, 0.96, -0.07), new THREE.Vector3(body.x + 0.3, 0.96, -0.07)];   // resting on the counter's front edge
    this.smooth = this.targets.map(t => t.clone()); this.closure = [0.1, 0.1];
    camera.updateMatrixWorld();
    this.ndc = this.targets.map(t => { const n = t.clone().project(camera); return new THREE.Vector2(n.x, n.y); });   // each hand starts out pointing at its resting spot
    this.ptr = null; this.pending = null; this.screen = [0.5, 0.5];
    hands.forEach((h, i) => { h.tracked = true; h.poseSynthetic(this.targets[i], palmDownQuat(0), 0.1); });
    canvas.style.touchAction = 'none';
    const rel = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, r.width, r.height]; };
    canvas.addEventListener('pointerdown', e => {
      if (this.ptr || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const [x, y] = rel(e); this.ptr = { id: e.pointerId, x0: x, y0: y, t0: performance.now(), moved: false, ang: null };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events have no capture */ }
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => {
      const p = this.ptr; if (!p || e.pointerId !== p.id) return;
      const [x, y, w, h] = rel(e);
      if (!p.moved && Math.hypot(x - p.x0, y - p.y0) > TAP_PX) p.moved = true;
      if (!p.moved) return;
      this.pending = null;
      const hand = hands[this.active];
      if (hand.hold?.mode === 'twist') {                 // circular drag around the lid turns it
        const c = hand.hold.p0.clone().project(camera), cx = (c.x + 1) / 2 * w, cy = (1 - c.y) / 2 * h;
        const ang = Math.atan2(-(y - cy), x - cx);       // screen-up positive: counter-clockwise increases
        if (p.ang !== null) { const d = Math.atan2(Math.sin(ang - p.ang), Math.cos(ang - p.ang)); hand.twist = (hand.twist || 0) + d * TWIST_GAIN; }
        p.ang = ang;
      } else { p.ang = null; this.point(x, y - DRAG_LIFT_PX, w, h); }
      this.screen = [x / w, y / h];
    });
    const up = e => {
      const p = this.ptr; if (!p || e.pointerId !== p.id) return; this.ptr = null;
      const [x, y, w, h] = rel(e);
      if (e.type === 'pointerup' && !p.moved && performance.now() - p.t0 < TAP_MS) {     // tap: go there, then grab / put down
        if (hands[this.active].hold?.mode !== 'twist') this.point(x, y, w, h);
        this.pending = { t: this.t }; this.screen = [x / w, y / h];
      }
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.buildBar();
  }
  point(x, y, w, h) { this.ndc[this.active].set(THREE.MathUtils.clamp(x / w, 0, 1) * 2 - 1, 1 - 2 * THREE.MathUtils.clamp(y / h, 0, 1)); }
  get gazeScreen() { return this.screen; }

  buildBar() {
    const bar = this.bar = document.createElement('div'); bar.id = 'touchbar';
    const mk = (id, label, fn, hold = false) => {
      const b = document.createElement('button'); b.dataset.act = id; b.textContent = label; bar.appendChild(b);
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(b); });
      return b;
    };
    const hand = () => this.hands[this.active];
    this.btn = {
      left: mk('left', '◀', () => this.body.step(-0.35, this.bus)),
      hand: mk('hand', 'Right hand', () => { this.active = 1 - this.active; this.pressOn = false; this.pending = null; this.bus.emit('ui', { action: 'switch_hand', hand: hand().side }); }),
      flip: mk('flip', 'Flip', () => { if (hand().holding) hand().flip = !hand().flip; }),
      press: mk('press', 'Press', () => { if (hand().holding && hand().hold?.mode === 'free') this.pressOn = !this.pressOn; }),
      drop: mk('drop', 'Let go', () => { this.pending = null; hand().pinch = false; }),
      right: mk('right', '▶', () => this.body.step(0.35, this.bus)),
    };
    document.body.appendChild(bar);
  }

  update(dt) {
    this.t += dt; this.body.update(dt);
    const i = this.active, h = this.hands[i];
    const free = h.holding && h.hold?.mode === 'free';
    if (!free) this.pressOn = false;
    h.press = this.pressOn;
    this.reacher.aim(h, this.ndc[i], this.targets[i], this.pressOn ? 0 : CARRY);
    // a tap takes effect once the hand has arrived (or after a short time-out)
    if (this.pending && (this.smooth[i].distanceTo(this.targets[i]) < 0.03 || this.t - this.pending.t > 0.7)) { this.pending = null; h.pinch = !h.holding; }
    this.hands.forEach((hh, k) => {
      this.smooth[k].lerp(this.targets[k], 1 - Math.exp(-dt * 16));
      const want = hh.holding || hh.pinch ? 1 : 0.12;
      this.closure[k] += (want - this.closure[k]) * (1 - Math.exp(-dt * 16));
      hh.poseSynthetic(this.smooth[k], palmDownQuat(this.body.yaw), this.closure[k]);
      hh.track(dt);
    });
    // button states
    const B = this.btn, holding = !!h.holding;
    B.hand.textContent = h.side === 'L' ? 'Left hand' : 'Right hand';
    B.drop.disabled = !holding; B.flip.disabled = !(holding && h.holding.settle === 'flat2'); B.press.disabled = !free;
    B.press.classList.toggle('on', this.pressOn);
    B.press.textContent = h.hold?.mode === 'twist' ? 'Circle ⟲' : 'Press';
  }
  postUpdate() { for (const h of this.hands) if (h.pinch && !h.holding) h.pinch = false; }
}
