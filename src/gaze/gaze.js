// Gaze: pluggable sources -> a world-space gaze ray -> AOI hit test -> online
// I-VT fixation detection. Raw samples are logged; fixations are re-derived
// offline in analysis/ with the same thresholds.
import * as THREE from 'three';
import { isDescendant } from '../core/world.js';

const _ray = new THREE.Raycaster(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _ndc = new THREE.Vector2();

export class Gaze {
  constructor(world, camera, cfg, th) {
    Object.assign(this, { world, camera, cfg, th });
    this.source = cfg.gaze; this.sample = null; this.prevDir = null;
    this.fix = null; this.provider = null;
    this.entList = [...world.entities.values()].filter(e => e.role !== 'fixture');
    this.radius = new Map();
  }
  setProvider(p) { this.provider = p; }
  // screen = [u,v] in [0,1] (top-left origin) or null; for XR the head ray is used
  update(t, xrPresenting) {
    let origin, dir, screen = null, valid = false, conf = 1;
    if (xrPresenting && !this.provider?.xrEye) {
      const cam = this.camera; origin = cam.getWorldPosition(new THREE.Vector3());
      dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())); valid = true; this.kind = 'head';
    } else if (this.provider) {
      const s = this.provider.get(t);
      if (s && s.valid) {
        screen = [s.x, s.y]; conf = s.conf ?? 1;
        _ndc.set(s.x * 2 - 1, -(s.y * 2 - 1)); _ray.setFromCamera(_ndc, this.camera);
        origin = _ray.ray.origin.clone(); dir = _ray.ray.direction.clone(); valid = true; this.kind = this.source;
      }
    }
    if (!valid) { this.sample = { t, valid: false }; this.fixUpdate(t, null); return this.sample; }
    // AOI hit
    _ray.set(origin, dir); _ray.far = 8;
    let aoi = null, hit = null, dist = null;
    for (const h of _ray.intersectObjects(this.world.aoiMeshes, false)) {
      if (!h.object.visible || h.object.userData.isHand) continue;
      aoi = this.world.aoiOf(h.object); hit = h.point; dist = h.distance; break;
    }
    // nearest object within angular tolerance (eye-tracker accuracy)
    let near = null, nearDeg = Infinity;
    for (const e of this.entList) {
      if (!e.root.parent) continue;
      e.root.getWorldPosition(_v);
      let r = this.radius.get(e); if (r === undefined) { const b = new THREE.Box3().setFromObject(e.root); r = b.isEmpty() ? 0.03 : b.getSize(_v2).length() / 2; this.radius.set(e, r); e.root.getWorldPosition(_v); }
      const to = _v2.subVectors(_v, origin), d = to.length(); if (d < 0.05) continue;
      const ang = Math.acos(THREE.MathUtils.clamp(to.dot(dir) / d, -1, 1)) - Math.atan(r * 0.7 / d);
      if (ang < nearDeg) { nearDeg = ang; near = e.aoi; }
    }
    nearDeg = THREE.MathUtils.radToDeg(Math.max(0, nearDeg));
    this.sample = { t, valid: true, kind: this.kind, screen, origin, dir, aoi, hit, dist, near, nearDeg, conf };
    this.fixUpdate(t, this.sample);
    return this.sample;
  }
  // I-VT with minimum duration; emits fixation events with the modal AOI.
  fixUpdate(t, s) {
    const vth = this.th.fixation_velocity_deg_s, minDur = this.th.fixation_min_ms / 1000;
    if (!s) { this.endFix(t); this.prevDir = null; return; }
    let vel = 0;
    if (this.prevDir && this.prevT !== undefined) vel = THREE.MathUtils.radToDeg(this.prevDir.angleTo(s.dir)) / Math.max(1e-3, t - this.prevT);
    this.prevDir = s.dir.clone(); this.prevT = t;
    const a = s.aoi && (this.world.entities.has(s.aoi) || !s.near || s.nearDeg > this.th.gaze_aoi_tolerance_deg) ? s.aoi : (s.nearDeg <= this.th.gaze_aoi_tolerance_deg ? s.near : s.aoi);
    s.label = a;
    if (vel < vth) {
      if (!this.fix) this.fix = { t0: t, n: 0, counts: {}, dir: new THREE.Vector3() };
      this.fix.n++; this.fix.counts[a || 'none'] = (this.fix.counts[a || 'none'] || 0) + 1; this.fix.dir.add(s.dir); this.fix.t1 = t;
      if (s.hit) this.fix.hit = s.hit.clone();
    } else this.endFix(t);
    this.minDur = minDur;
  }
  endFix(t) {
    const f = this.fix; this.fix = null;
    if (!f || f.t1 - f.t0 < this.minDur) return;
    const aoi = Object.entries(f.counts).sort((a, b) => b[1] - a[1])[0][0];
    this.world.bus.emit('fixation', { t0: +f.t0.toFixed(4), t1: +f.t1.toFixed(4), dur: +(f.t1 - f.t0).toFixed(4), aoi, n: f.n, dir: f.dir.normalize().toArray().map(v => +v.toFixed(4)), hit: f.hit?.toArray().map(v => +v.toFixed(4)) || null });
  }
}

// ---------- providers ----------
export class MouseGaze { constructor(mouse) { this.mouse = mouse; } get() { const [x, y] = this.mouse.gazeScreen; return { valid: true, x, y, conf: 1 }; } }

// External eye tracker (EyeLink / Tobii / Pupil bridge): JSON lines over WebSocket
// {"x":0..1, "y":0..1, "t": <tracker seconds>, "valid": true}. See tools/gaze_bridge_example.py
export class SocketGaze {
  constructor(url, bus) {
    this.url = url; this.bus = bus; this.last = null; this.n = 0; this.connect();
  }
  connect() {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => this.bus.emit('gaze_source', { kind: 'socket', status: 'open', url: this.url });
      this.ws.onmessage = e => { try { const m = JSON.parse(e.data); this.last = { ...m, recv: performance.now() / 1000 }; this.n++; } catch { /* ignore */ } };
      this.ws.onclose = () => { this.bus.emit('gaze_source', { kind: 'socket', status: 'closed' }); setTimeout(() => this.connect(), 1500); };
    } catch (e) { this.bus.emit('gaze_source', { kind: 'socket', status: 'error', message: String(e) }); }
  }
  get() { const s = this.last; if (!s || performance.now() / 1000 - s.recv > 0.1) return null; return { valid: s.valid !== false, x: s.x, y: s.y, conf: s.conf ?? 1, trackerT: s.t }; }
}

// Webcam iris gaze. Features: iris offsets within each eye + head pose; a
// second-order polynomial ridge regression maps them to the screen.
const IRIS_R = 468, IRIS_L = 473, EYE = { R: [33, 133, 159, 145], L: [362, 263, 386, 374] };
export class WebcamGaze {
  constructor(vision, bus) { this.vision = vision; this.bus = bus; this.W = null; this.filtered = null; }
  features() {
    const r = this.vision.faceResult; if (!r?.faceLandmarks?.length) return null;
    const lm = r.faceLandmarks[0]; if (lm.length < 478) return null;
    const eye = (iris, [a, b, up, lo]) => {
      const w = Math.hypot(lm[b].x - lm[a].x, lm[b].y - lm[a].y) || 1e-3;
      const cx = (lm[a].x + lm[b].x) / 2, cy = (lm[up].y + lm[lo].y) / 2;
      return [(lm[iris].x - cx) / w, (lm[iris].y - cy) / w, (lm[lo].y - lm[up].y) / w];
    };
    const [rx, ry, ro] = eye(IRIS_R, EYE.R), [lx, ly, lo] = eye(IRIS_L, EYE.L);
    if (ro < 0.08 && lo < 0.08) return { blink: true };
    const m = r.facialTransformationMatrixes?.[0]?.data;
    let yaw = 0, pitch = 0, tx = 0, ty = 0, tz = 0;
    if (m) { yaw = Math.atan2(m[8], m[10]); pitch = Math.asin(-Math.max(-1, Math.min(1, m[9]))); tx = m[12]; ty = m[13]; tz = m[14]; }
    return { f: [(rx + lx) / 2, (ry + ly) / 2, yaw, pitch, tx / 30, ty / 30, tz / 60] };
  }
  static expand(f) { const [a, b, c, d, e, g, h] = f; return [1, a, b, c, d, e, g, h, a * a, b * b, a * b, a * c, b * d, c * c, d * d]; }
  fit(X, Yx, Yy, lambda = 1e-3) {
    const P = X.map(WebcamGaze.expand), n = P[0].length;
    const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => P.reduce((s, p) => s + p[i] * p[j], 0) + (i === j ? lambda : 0)));
    const solve = (Y) => { const b = Array.from({ length: n }, (_, i) => P.reduce((s, p, k) => s + p[i] * Y[k], 0)); return gauss(A.map(r => r.slice()), b); };
    this.W = [solve(Yx), solve(Yy)];
  }
  predict(f) { const p = WebcamGaze.expand(f); return [p.reduce((s, v, i) => s + v * this.W[0][i], 0), p.reduce((s, v, i) => s + v * this.W[1][i], 0)]; }
  get(t) {
    if (!this.W) return null; const F = this.features(); if (!F) return null; if (F.blink) return { valid: false, blink: true };
    let [x, y] = this.predict(F.f);
    if (this.filtered) { const k = 0.35; x = this.filtered[0] + k * (x - this.filtered[0]); y = this.filtered[1] + k * (y - this.filtered[1]); }
    this.filtered = [x, y];
    return { valid: x > -0.1 && x < 1.1 && y > -0.1 && y < 1.1, x, y, conf: 0.5 };
  }
  // 9-point calibration + 5-point validation on a full-screen overlay
  async calibrate(overlay, dot, msg) {
    overlay.hidden = false;
    const grid = [[0.1, 0.1], [0.5, 0.1], [0.9, 0.1], [0.1, 0.5], [0.5, 0.5], [0.9, 0.5], [0.1, 0.9], [0.5, 0.9], [0.9, 0.9]];
    const val = [[0.3, 0.3], [0.7, 0.3], [0.5, 0.5], [0.3, 0.7], [0.7, 0.7]];
    const collect = async (pts, label) => {
      const X = [], Y = [];
      for (const [x, y] of pts) {
        dot.style.left = `${x * 100}%`; dot.style.top = `${y * 100}%`; msg.textContent = label;
        await sleep(700); const t0 = performance.now();
        while (performance.now() - t0 < 900) { await frame(); const F = this.features(); if (F && !F.blink) { X.push(F.f); Y.push([x, y]); } }
      }
      return { X, Y };
    };
    const cal = await collect(grid, 'Look at the dot and keep your head still');
    if (cal.X.length < 30) { overlay.hidden = true; throw new Error('face not visible enough for calibration'); }
    this.fit(cal.X, cal.Y.map(p => p[0]), cal.Y.map(p => p[1]));
    const v = await collect(val, 'Checking accuracy…');
    const errs = v.X.map((f, i) => { const [px, py] = this.predict(f); return Math.hypot((px - v.Y[i][0]) * innerWidth, (py - v.Y[i][1]) * innerHeight); });
    errs.sort((a, b) => a - b);
    const medPx = errs[Math.floor(errs.length / 2)] || NaN;
    // approximate degrees: assume ~55 cm viewing distance and 96 css px per inch
    const deg = Math.atan((medPx / 96 * 2.54) / 55) * 180 / Math.PI;
    overlay.hidden = true;
    const result = { type: 'webcam_gaze', nCal: cal.X.length, nVal: v.X.length, medianErrorPx: +medPx.toFixed(1), approxDeg: +deg.toFixed(2), weights: this.W };
    this.bus.emit('calibration', result);
    return result;
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(r));
function gauss(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
  return x;
}
export { isDescendant };
