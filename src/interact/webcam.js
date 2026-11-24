// Webcam hand tracking -> two hands in the kitchen.
//
// A single webcam measures the image plane well and depth poorly, and the task
// lives on a horizontal counter. So the precise axes go where precision matters:
//
//   hand position in the image  -> a ray from the scene camera; the hand goes to
//                                  whatever that ray lands on (left/right and
//                                  near/far on the counter, or up onto shelves)
//   hand distance to the webcam -> height while holding something: holding
//                                  carries at 7 cm; push toward the screen to
//                                  lower / press, pull back to lift higher
//   thumb-index pinch           -> grasp / release
//   hand rotation in the image  -> rotates the held object, unscrews lids
//   turning the hand over       -> flips a slice
//
// Equivalently: the participant's hands act on a tilted copy of the counter that
// stands upright in front of the webcam (up = away from the body, toward the
// camera = down). Hand shape comes from MediaPipe's metric world landmarks,
// rotated by that same tilt.
import * as THREE from 'three';
import { OneEuro, OneEuro3, clamp } from '../util/util.js';
import { BONES } from './hand.js';

const HOLD_LOST = 0.6;          // s a hand may vanish before it is treated as gone (held objects are kept until then)
const CARRY = 0.07, LIFT_GAIN = 0.47, LIFT_MAX = 0.4;
const BOX = { u0: 0.12, u1: 0.88, v0: 0.14, v1: 0.9 };   // part of the camera image that maps onto the full screen

export class WebcamHands {
  constructor(vision, hands, body, bus, reacher, { mirrored = false } = {}) {
    Object.assign(this, { vision, hands, body, bus, reacher, mirrored });
    this.st = hands.map((h, i) => ({
      fu: new OneEuro(1.2, 10), fv: new OneEuro(1.2, 10), fk: new OneEuro(0.8, 3),
      pts: Array.from({ length: 21 }, () => new OneEuro3(2.0, 20)),
      T: new THREE.Vector3(body.x + (i ? 0.22 : -0.22), 1.02, 0.18), smooth: new THREE.Vector3(body.x + (i ? 0.22 : -0.22), 1.02, 0.18),
      ndc: new THREE.Vector2(i ? 0.3 : -0.3, -0.3), lost: Infinity, lnk: 0, lnkRef: 0, lnk0: null, lift: CARRY, pinchN: 0, pinchD: 1, img: null, u: 0.5, v: 0.5, edge: 0, seen: false,
    }));
    for (const h of hands) h.twistGain = 2.5;      // ~180° of real rotation opens a lid instead of ~450°
    this.rate = 0; this._n = 0; this._t = 0; this._frameT = -1; this.space = false;
    addEventListener('keydown', e => { if (e.code === 'Space') { this.space = true; e.preventDefault(); } if (e.code === 'KeyF') for (const h of hands) if (h.holding) h.flip = !h.flip;   // keyboard fallback for turning the hand over
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') body.step(-0.35, bus); if (e.code === 'ArrowRight' || e.code === 'KeyD') body.step(0.35, bus); });
    addEventListener('keyup', e => { if (e.code === 'Space') this.space = false; });
  }

  // ---- parse one MediaPipe result into per-hand measurements ----
  measure(res) {
    const out = [], vw = this.vision.video?.videoWidth || 1280, vh = this.vision.video?.videoHeight || 720, aspect = vw / vh;
    if (!res?.landmarks) return out;
    res.landmarks.forEach((lm, k) => {
      const wl = res.worldLandmarks[k];
      let label = res.handednesses?.[k]?.[0]?.categoryName || res.handedness?.[k]?.[0]?.categoryName || 'Right';
      if (!this.mirrored) label = label === 'Left' ? 'Right' : 'Left';   // MediaPipe assumes a selfie-mirrored image
      const cx = (lm[0].x + lm[5].x + lm[17].x) / 3, cy = (lm[0].y + lm[5].y + lm[17].y) / 3;
      // scale = image size / metric size, pooled over all bones: robust to finger pose and palm tilt
      let num = 0, den = 0;
      for (const [a, b] of BONES) {
        const li = Math.hypot((lm[a].x - lm[b].x) * aspect, lm[a].y - lm[b].y), wi = Math.hypot(wl[a].x - wl[b].x, wl[a].y - wl[b].y);
        num += li * wi; den += wi * wi;
      }
      const size = Math.hypot(wl[9].x - wl[0].x, wl[9].y - wl[0].y, wl[9].z - wl[0].z) || 0.09;
      const pinchD = Math.hypot(wl[4].x - wl[8].x, wl[4].y - wl[8].y, wl[4].z - wl[8].z) / size;
      out.push({ label, lm, wl, u: this.mirrored ? cx : 1 - cx, v: cy, lnk: Math.log(Math.max(1e-6, num / Math.max(den, 1e-9))), pinchD });
    });
    return out;
  }
  // keep left and right from swapping when MediaPipe's handedness label flickers
  assign(dets) {
    const slots = [null, null], S = this.st;
    const known = i => S[i].lost < 1.0;
    const d = (det, i) => Math.hypot(det.u - S[i].u, det.v - S[i].v);
    if (dets.length >= 2) {
      const [a, b] = dets;
      let swap;
      if (known(0) && known(1)) swap = d(a, 1) + d(b, 0) < d(a, 0) + d(b, 1);
      else if (a.label !== b.label) swap = a.label === 'Right';
      else swap = a.u > b.u;
      slots[swap ? 1 : 0] = a; slots[swap ? 0 : 1] = b;
    } else if (dets.length === 1) {
      const a = dets[0]; let i = a.label === 'Left' ? 0 : 1;
      if (known(0) !== known(1)) { const j = known(0) ? 0 : 1; if (d(a, j) < 0.25) i = j; }
      else if (known(0) && known(1)) i = d(a, 0) < d(a, 1) ? 0 : 1;
      slots[i] = a;
    }
    return slots;
  }

  // Neutral pose: gives the comfortable distance (used for the "too close / too far" hint).
  async calibrate(setMsg, seconds = 2.0) {
    setMsg('Hold both hands up in front of the camera, relaxed and open…');
    const t0 = performance.now(), samples = [[], []]; let first = null;
    while (performance.now() - t0 < 12000) {
      await new Promise(r => requestAnimationFrame(r));
      for (const i of [0, 1]) if (this.st[i].seen) samples[i].push(this.st[i].lnk);
      if (this.st[0].seen && this.st[1].seen && first === null) first = performance.now();
      if (first !== null) setMsg(`Hold still… ${Math.max(0, seconds - (performance.now() - first) / 1000).toFixed(1)} s`);
      if (first !== null && performance.now() - first > seconds * 1000) break;
    }
    const med = a => { const b = a.slice(-90).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
    this.st.forEach((s, i) => { s.lnk0 = med(samples[i]); });
    const ok = this.st.every(s => s.lnk0 !== null);
    const cam = this.vision.video;
    this.bus.emit('calibration', { type: 'webcam_hands', ok, lnk0: this.st.map(s => s.lnk0), box: BOX, carry: CARRY, liftGain: LIFT_GAIN, video: [cam?.videoWidth || null, cam?.videoHeight || null] });
    setMsg(ok ? 'Pinch thumb and index finger to grab. Push toward the screen to press down.' : 'Could not see both hands; continuing anyway.');
    await new Promise(r => setTimeout(r, 1800));
    return ok;
  }

  update(dt, t) {
    const fresh = this.vision.frameT !== this._frameT; this._frameT = this.vision.frameT;
    if (fresh) { this._n++; }
    if (this._w0 === undefined) this._w0 = t;
    if (t - this._w0 > 1) { this.rate = this._n / (t - this._w0); this._n = 0; this._w0 = t; }   // tracker frames per wall-clock second
    const slots = this.assign(this.measure(this.vision.handResult));
    this.hands.forEach((h, i) => {
      const S = this.st[i], det = slots[i];
      S.seen = !!det;
      if (!det) {
        S.lost += dt;
        if (S.lost > HOLD_LOST) { h.tracked = false; h.pinch = false; S.pinchN = 0; }
        else if (h.tracked) h.track(dt);     // hold the last pose briefly through dropouts
        return;
      }
      if (S.lost > HOLD_LOST) { for (const f of [S.fu, S.fv, S.fk]) f.x = null; S.pts.forEach(p => p.f.forEach(f => (f.x = null))); S.lnkRef = det.lnk; }
      S.lost = 0; S.img = det.lm;
      S.u = S.fu.filter(det.u, t); S.v = S.fv.filter(det.v, t); S.lnk = S.fk.filter(det.lnk, t);
      S.ndc.set(clamp((S.u - BOX.u0) / (BOX.u1 - BOX.u0), 0, 1) * 2 - 1, 1 - 2 * clamp((S.v - BOX.v0) / (BOX.v1 - BOX.v0), 0, 1));
      // pinch: hysteresis + 2-frame debounce
      S.pinchD = det.pinchD;
      const want = h.pinch ? det.pinchD < 0.5 : det.pinchD < 0.3;
      if (want !== h.pinch) { if (fresh) S.pinchN++; if (S.pinchN >= 2) { h.pinch = want; S.pinchN = 0; } } else S.pinchN = 0;
      // height: free-held objects carry at CARRY; toward the camera lowers, away lifts
      const free = h.holding && h.hold?.mode === 'free';
      if (free) S.lift = this.space ? 0 : clamp(CARRY - LIFT_GAIN * (S.lnk - S.lnkRef), 0, LIFT_MAX);
      else { S.lnkRef += (S.lnk - S.lnkRef) * (1 - Math.exp(-dt * 6)); S.lift = CARRY; }
      if (S.lift < 0.006) S.lift = 0;
      h.press = free && S.lift === 0;
      this.reacher.aim(h, S.ndc, S.T, S.lift, 0.02);
      S.smooth.lerp(S.T, 1 - Math.exp(-dt * 14));
      // hand shape: metric landmarks about the pinch point, tilted into the scene
      const wl = det.wl, mx = (wl[4].x + wl[8].x) / 2, my = (wl[4].y + wl[8].y) / 2, mz = (wl[4].z + wl[8].z) / 2, sx = this.mirrored ? 1 : -1;
      const pts = wl.map((p, j) => S.pts[j].filter(new THREE.Vector3(sx * (p.x - mx), p.z - mz, p.y - my), t).add(S.smooth));
      h.fromJoints(pts); h.grip.copy(S.smooth);
      h.updateRoll(); h.tracked = true; h.track(dt);
      // walking: hold a hand at the side edge of the view to step that way
      const atEdge = Math.abs(S.ndc.x) >= 0.999 && !h.pinch && !h.holding ? Math.sign(S.ndc.x) : 0;
      S.edge = atEdge ? S.edge + dt : 0;
      if (S.edge > 1.0) { S.edge = 0; this.body.step(0.35 * atEdge, this.bus); }
    });
  }
  // for the on-screen preview
  status() {
    return this.st.map((S, i) => ({ side: this.hands[i].side, seen: S.seen, tracked: this.hands[i].tracked, img: S.img, pinch: this.hands[i].pinch, pinchD: S.pinchD, lift: S.lift, holding: !!this.hands[i].holding,
      dist: S.lnk0 === null ? 0 : S.lnk - S.lnk0, u: S.u, v: S.v }));
  }
}
