// Webcam hand tracking -> 3D hands in the kitchen.
// Mapping: image x -> lateral, image y -> height, apparent hand size -> reach.
// Hand shape and orientation come from MediaPipe's metric world landmarks.
import * as THREE from 'three';
import { OneEuro3, clamp } from '../util/util.js';
import { K } from '../scene/kitchen.js';

const _v = new THREE.Vector3();

export class WebcamHands {
  constructor(vision, hands, body, bus, { mirrored = false } = {}) {
    Object.assign(this, { vision, hands, body, bus, mirrored });
    this.filters = hands.map(() => ({ wrist: new OneEuro3(1.0, 0.05), pts: Array.from({ length: 21 }, () => new OneEuro3(1.5, 0.03)) }));
    // calibration: hand size at "near" (by your body) and "far" (full reach) — refined by calibrate()
    this.cal = { sNear: 0.11, sFar: 0.2, uSpan: 1.25, vTop: 0.15, vBottom: 0.95 };
    this.lost = [0, 0];
  }
  // Two poses, each held ~1.5 s: hands near the body, then reached forward.
  async calibrate(msgEl) {
    const sample = async (label) => {
      msgEl.textContent = label; await new Promise(r => setTimeout(r, 1200));
      const xs = []; const t0 = performance.now();
      while (performance.now() - t0 < 1500) { await new Promise(r => requestAnimationFrame(r)); const res = this.vision.handResult; if (res?.landmarks?.length) for (const lm of res.landmarks) xs.push(imgSize(lm)); }
      xs.sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null;
    };
    const near = await sample('Hold both hands relaxed in front of your chest…');
    const far = await sample('Now reach both hands forward toward the screen…');
    if (near && far && far > near * 1.1) { this.cal.sNear = near; this.cal.sFar = far; }
    this.bus.emit('calibration', { type: 'webcam_hands', ...this.cal });
    return this.cal;
  }
  update(dt, t) {
    const res = this.vision.handResult;
    const seen = [false, false];
    if (res?.landmarks) res.landmarks.forEach((lm, k) => {
      const wl = res.worldLandmarks[k];
      let label = res.handednesses?.[k]?.[0]?.categoryName || res.handedness?.[k]?.[0]?.categoryName || 'Right';
      // MediaPipe labels assume a mirrored (selfie) image.
      if (!this.mirrored) label = label === 'Left' ? 'Right' : 'Left';
      const i = label === 'Left' ? 0 : 1; if (seen[i]) return; seen[i] = true;
      const h = this.hands[i], f = this.filters[i];
      const C = this.cal, size = imgSize(lm);
      const reach = clamp((size - C.sNear) / (C.sFar - C.sNear), -0.2, 1.3);
      const u = this.mirrored ? lm[0].x : 1 - lm[0].x;
      const b = this.body;
      const wrist = new THREE.Vector3(
        b.x + (u - 0.5) * C.uSpan,
        K.counterY + 0.02 + (C.vBottom - lm[0].y) / (C.vBottom - C.vTop) * 0.55,
        b.z - 0.25 - reach * 0.55);
      f.wrist.filter(wrist, t);
      // metric landmarks: camera (x right, y down, z toward camera) -> world (unmirrored: x flips)
      const pts = wl.map((p, j) => {
        const v = new THREE.Vector3((this.mirrored ? 1 : -1) * (p.x - wl[0].x), -(p.y - wl[0].y), (p.z - wl[0].z));
        // the camera looks back at the participant; rotate so palm-forward reads as reaching into the counter
        v.applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.9);
        return f.pts[j].filter(v.add(wrist), t);
      });
      const d = h.fromJoints(pts);
      // pinch with hysteresis (normalised thumb-index distance)
      if (!h.pinch && d < 0.28) h.pinch = true; else if (h.pinch && d > 0.45) h.pinch = false;
      h.updateRoll();
      h.tracked = true; this.lost[i] = 0;
      h.track(dt);
    });
    this.hands.forEach((h, i) => { if (!seen[i]) { this.lost[i] += dt; if (this.lost[i] > 0.35) { h.tracked = false; h.pinch = false; } } });
  }
}
// apparent hand size in the image (wrist -> middle MCP), normalised by image height
function imgSize(lm) { return Math.hypot(lm[9].x - lm[0].x, (lm[9].y - lm[0].y)); }
