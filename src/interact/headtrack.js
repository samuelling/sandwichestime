// Webcam head tracking: turn your head to look around the kitchen.
//
// MediaPipe's face landmarker gives the head's pose as a 4x4 transform (column-major) of a canonical face model in
// a metric space whose camera sits at the origin looking down -z, x to the right of the (unmirrored) picture and
// y up. The face's forward direction is the matrix's third column; its position the fourth, in cm.
//
// The view turns by more than the head does (about 2.5x for a 20-degree turn, more for larger ones), so the eyes can
// stay on the screen while the view swings round. A small dead zone keeps the view still when you are just looking
// at the screen, and leaning shifts the viewpoint a few centimetres (parallax). Straight ahead is taken from the
// first second of looking at the screen; R recentres, H turns head tracking off and on. Losing the face eases the view
// back to straight ahead. This sets body.head; Body.applyToCamera adds it on top of the body's own facing, so the
// shoulders, the hands' reach and the counter mapping do not move with the head.
import { OneEuro, clamp, toast } from '../util/util.js';

const DEAD = 0.035;               // rad, about 2 degrees
const YAW = { g: 2.2, g2: 2.6, max: 2.0 };          // view yaw = g*a + g2*a^2 past the dead zone (a in rad); 20° -> ~55°, 30° -> ~95°
const PITCH = { g: 1.8, g2: 1.6, up: 0.85, down: 0.7 };
const LEAN = { x: 0.15, y: 0.08, z: 0.12, gain: 1.0 };   // m of viewpoint shift per m of head shift, and the limits
const LOST = 0.5;                 // s the last pose is held when the face is lost, before easing back
const shape = (x, g, g2) => { const a = Math.max(0, Math.abs(x) - DEAD); return Math.sign(x) * (g * a + g2 * a * a); };
const median = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };

export class HeadTracker {
  constructor(vision, bus, { mirrored = false, flipYaw = false } = {}) {
    Object.assign(this, { vision, bus, mirrored });
    this.sx = (mirrored ? -1 : 1) * (flipYaw ? -1 : 1);
    this.f = ['yaw', 'pitch', 'x', 'y', 'z'].reduce((o, k) => ((o[k] = new OneEuro(k.length > 1 ? 1.0 : 0.6, k.length > 1 ? 0.8 : 0.5)), o), {});
    this.raw = null; this.neutral = null; this.collect = null; this.enabled = true;
    this.out = { yaw: 0, pitch: 0, dx: 0, dy: 0, dz: 0 }; this.lost = Infinity; this.last = null; this.seen = false; this.rate = 0; this._n = 0; this._t = 0;
    addEventListener('keydown', e => {
      if (e.target?.tagName === 'INPUT') return;
      if (e.code === 'KeyR') this.recenter();
      if (e.code === 'KeyH') { this.enabled = !this.enabled; toast(this.enabled ? 'Head tracking on' : 'Head tracking off: the view stays still', 2200); this.bus?.emit('head_tracking', { on: this.enabled }); }
    });
  }
  // take "straight ahead" from the next `seconds` of looking at the screen
  recenter(seconds = 1.0) { this.collect = { until: null, seconds, yaw: [], pitch: [], x: [], y: [], z: [] }; }

  // the latest face pose, in the participant's terms: yaw > 0 = turned to their left, pitch > 0 = looking up, x > 0 = moved to their left (m)
  read() {
    const r = this.vision.faceResult; if (!r || r === this.last) return null; this.last = r;
    const m = r.facialTransformationMatrixes?.[0]?.data; if (!m) return 'none';
    const fx = m[8], fy = m[9], fz = m[10];
    return { yaw: this.sx * Math.atan2(fx, fz), pitch: Math.atan2(fy, Math.hypot(fx, fz)), x: this.sx * m[12] / 100, y: m[13] / 100, z: m[14] / 100 };
  }

  update(dt_, t, body) {
    const dtw = clamp(this.tPrev === undefined ? 1 / 60 : t - this.tPrev, 0, 1), dt = Math.min(dtw, 0.1); this.tPrev = t;      /* real time: the head moves in real time */
    const p = this.read();
    if (p && p !== 'none') {
      this._n++; this.lost = 0; this.seen = true;
      for (const k in this.f) p[k] = this.f[k].filter(p[k], t);
      this.raw = p;
      if (!this.neutral && !this.collect) this.recenter();
      if (this.collect) {
        const C = this.collect; C.until ??= t + C.seconds;
        for (const k of ['yaw', 'pitch', 'x', 'y', 'z']) C[k].push(p[k]);
        if (t >= C.until && C.yaw.length >= 5) {
          this.neutral = Object.fromEntries(['yaw', 'pitch', 'x', 'y', 'z'].map(k => [k, median(C[k])])); this.collect = null;
          this.bus?.emit('head_neutral', Object.fromEntries(Object.entries(this.neutral).map(([k, v]) => [k, +v.toFixed(4)])));
        }
      }
    } else if (p === 'none' || p === null) { this.lost += dtw; if (this.lost > LOST) this.seen = false; }
    // wall-clock tracker rate, for the preview
    this._t += dtw; if (this._t >= 1) { this.rate = this._n / this._t; this._n = 0; this._t = 0; }
    // target view offsets
    const O = this.out, N = this.neutral, R = this.raw;
    let want = { yaw: 0, pitch: 0, dx: 0, dy: 0, dz: 0 };
    if (this.enabled && N && R && this.lost <= LOST) {
      const pitch = shape(R.pitch - N.pitch, PITCH.g, PITCH.g2);
      want = { yaw: clamp(shape(R.yaw - N.yaw, YAW.g, YAW.g2), -YAW.max, YAW.max), pitch: clamp(pitch, -PITCH.down, PITCH.up),
        dx: clamp(-(R.x - N.x) * LEAN.gain, -LEAN.x, LEAN.x), dy: clamp((R.y - N.y) * LEAN.gain, -LEAN.y, LEAN.y), dz: clamp(-(R.z - N.z) * LEAN.gain, -LEAN.z, LEAN.z) };
    }
    // follow the head closely while it is tracked; ease back to straight ahead when it is lost or switched off
    const k = 1 - Math.exp(-dt * (this.enabled && this.lost <= LOST ? 18 : 2.5));
    for (const key in O) O[key] += (want[key] - O[key]) * k;
    body.head = O;
  }
  status() { return { seen: this.seen, enabled: this.enabled, centred: !!this.neutral, yawDeg: Math.round(this.out.yaw * 57.3), pitchDeg: Math.round(this.out.pitch * 57.3), rate: this.rate }; }
}
