// Cartoon hands that act out each calibration pose before the participant tries it.
// They are drawn from the same canonical hand shape the tracker is tested with
// (POSE in interact/hand.js), seen as in the mirrored camera picture: palms
// toward the screen, fingers up, thumbs pointing inward.
import { POSE } from '../interact/hand.js';
import { HAND_COL } from './campreview.js';

const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const seg = (t, a, b) => ease((t - a) / (b - a));      // 0 before a, 1 after b, smooth in between
const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const WIDTH = [0.021, 0.018, 0.019, 0.0175, 0.0155];   // finger thickness in metres: thumb, index, middle, ring, little
const FILL = '#f6efe3';
// The tracker's pinch curls the fingers toward the camera, which head-on reads as a fist. The cartoon pinches the way it
// should look from the front instead: index curls over to meet the thumb in a clear "O", the other fingers stay up.
const PINCH2D = POSE.OPEN.map(a => [a[0], a[1]]);
Object.assign(PINCH2D, { 2: [0.044, 0.052], 3: [0.063, 0.074], 4: [0.071, 0.103], 6: [0.03, 0.128], 7: [0.054, 0.139], 8: [0.07, 0.117],
  10: [0.006, 0.134], 11: [0.008, 0.158], 12: [0.01, 0.177], 14: [-0.015, 0.124], 15: [-0.017, 0.146], 16: [-0.019, 0.163] });

// 21 canvas points for one hand. (u, v): palm centre as a fraction of the rect; k: size (rect heights per metre).
function handPoints(side, pinch, u, v, k, r, squash = 1) {
  const m = side === 'R' ? -1 : 1;
  const wl = POSE.OPEN.map((a, i) => { const b = PINCH2D[i]; return [-(lerp(a[0], b[0], pinch)) * m, -lerp(a[1], b[1], pinch)]; });
  const pc = [0, 5, 17].reduce((p, i) => [p[0] + wl[i][0] / 3, p[1] + wl[i][1] / 3], [0, 0]);
  return wl.map(([x, y]) => [r.x + u * r.w - k * (x - pc[0]) * r.h, r.y + v * r.h + k * (y - pc[1]) * r.h * squash]);      /* squash < 1: a flat hand seen from above, foreshortened */
}

// one cartoon hand: a cuffed wrist, a soft palm and capsule fingers, outlined in the hand's colour
export function drawCartoonHand(g, side, { u, v, k, pinch = 0, alpha = 1, ghost = false, back = false, squash = 1 }, r) {
  const P = handPoints(side, pinch, u, v, k, r, squash), s = k * r.h, col = HAND_COL[side], ol = Math.max(2, 0.0032 * s);
  const palm = [0, 1, 5, 9, 13, 17];
  // wrist and cuff run from the wrist joint away from the fingers
  const dx = P[0][0] - P[9][0], dy = P[0][1] - P[9][1], dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
  const wl_ = squash < 1 ? 0.07 : 0.05, wristEnd = [P[0][0] + ux * wl_ * s, P[0][1] + uy * wl_ * s], cuffEnd = [P[0][0] + ux * (wl_ + 0.03) * s, P[0][1] + uy * (wl_ + 0.03) * s];
  g.save(); g.globalAlpha = alpha; g.lineCap = 'round'; g.lineJoin = 'round';
  if (ghost) g.setLineDash([6, 6]);
  const shape = (extra, color, fill) => {
    g.strokeStyle = color; g.fillStyle = color;
    g.lineWidth = 0.05 * s + extra; g.beginPath(); g.moveTo(P[0][0], P[0][1]); g.lineTo(...wristEnd); g.stroke();       // wrist
    g.beginPath(); palm.forEach((i, n) => (n ? g.lineTo(P[i][0], P[i][1]) : g.moveTo(P[i][0], P[i][1]))); g.closePath();
    g.lineWidth = 0.02 * s + extra; if (fill) g.fill(); g.stroke();                                                        // palm
    FINGERS.forEach((f, n) => { g.lineWidth = WIDTH[n] * s + extra; g.beginPath(); g.moveTo(P[f[0]][0], P[f[0]][1]); for (const i of f) g.lineTo(P[i][0], P[i][1]); g.stroke(); });
  };
  if (ghost) {      // dashed outline only: where the hand was
    g.lineWidth = ol; g.strokeStyle = col; g.globalAlpha = alpha * 0.7;
    g.beginPath(); palm.forEach((i, n) => (n ? g.lineTo(P[i][0], P[i][1]) : g.moveTo(P[i][0], P[i][1]))); g.closePath(); g.stroke();
    for (const f of FINGERS) { g.beginPath(); g.moveTo(P[f[0]][0], P[f[0]][1]); for (const i of f) g.lineTo(P[i][0], P[i][1]); g.stroke(); }
    g.restore(); return P;
  }
  shape(2 * ol, col, true);       // outline pass
  // cuff
  g.lineWidth = 0.064 * s + 2 * ol; g.strokeStyle = col; g.lineCap = 'butt'; g.beginPath(); g.moveTo(...wristEnd); g.lineTo(...cuffEnd); g.stroke();
  g.lineCap = 'round';
  shape(0, FILL, true);           // fill pass
  if (back) {        // seen from above: the back of the hand, with fingernails
    g.fillStyle = col; g.globalAlpha = alpha * 0.35;
    FINGERS.forEach((f, n) => { const a = P[f[2]], b = P[f[3]], ex = b[0] - a[0], ey = b[1] - a[1], el = Math.hypot(ex, ey) || 1, w = WIDTH[n] * s * 0.3, l = Math.min(el * 0.55, WIDTH[n] * s * 0.6);
      const cx = b[0] - ex / el * l * 0.55, cy = b[1] - ey / el * l * 0.55;
      g.save(); g.translate(cx, cy); g.rotate(Math.atan2(ey, ex)); g.beginPath(); g.roundRect(-l / 2, -w, l, 2 * w, w); g.fill(); g.restore(); });
    g.restore(); return P;
  }
  // finger creases: short strokes across each middle joint
  g.strokeStyle = col; g.globalAlpha = alpha * 0.45; g.lineWidth = Math.max(1, ol * 0.6);
  FINGERS.forEach((f, n) => { for (const j of [f[1], f[2]]) { const a = P[j], b = P[j + 1], ex = b[0] - a[0], ey = b[1] - a[1], el = Math.hypot(ex, ey) || 1, w = WIDTH[n] * s * 0.32;
    g.beginPath(); g.moveTo(a[0] - ey / el * w, a[1] + ex / el * w); g.lineTo(a[0] + ey / el * w, a[1] - ex / el * w); g.stroke(); } });
  g.restore();
  return P;
}

// ---- the four demonstrations: hand states as a function of time (s, looped) ----
const BASE = { L: { u: 0.33, v: 0.56 }, R: { u: 0.67, v: 0.56 } };
export const DEMOS = {
  open: { len: 2.6, caption: 'palms to the screen · fingers up · hold still',
    at: t => { const rise = seg(t, 0, 0.7); return { hands: ['L', 'R'].map(sd => ({ side: sd, u: BASE[sd].u, v: lerp(0.98, BASE[sd].v, rise), k: 2.3, pinch: 0, alpha: rise })), ring: seg(t, 0.9, 2.1), check: t > 2.1 }; } },
  pinch: { len: 2.9, caption: 'thumb tip meets index tip, other fingers up · hold it',
    at: t => { const p = seg(t, 0.35, 0.85) * (1 - seg(t, 2.45, 2.85)); return { hands: ['L', 'R'].map(sd => ({ side: sd, ...BASE[sd], k: 2.3, pinch: p })), ring: seg(t, 0.95, 2.0), check: t > 2.0 && t < 2.45, spark: p > 0.95 }; } },
  push: { len: 3.1, caption: 'keep pinching · push toward the screen · hold',
    at: t => { const g = seg(t, 0.35, 1.05) * (1 - seg(t, 2.55, 3.05)); return { hands: ['L', 'R'].map(sd => ({ side: sd, ...BASE[sd], k: 2.0 * (1 + 0.38 * g), pinch: 1 })), ghost: g > 0.05 ? 2.0 : 0, push: g, ring: seg(t, 1.15, 2.15), check: t > 2.15 && t < 2.55 }; } },
  range: { len: 4.4, caption: 'open hands · sweep to every edge you can reach',
    at: t => {
      // the right hand's path (the left mirrors it): out to the top corner, down to the bottom corner, back to rest
      const K = [[0, 0.62, 0.56], [1.0, 0.88, 0.27], [1.5, 0.88, 0.27], [2.6, 0.88, 0.76], [3.1, 0.88, 0.76], [4.0, 0.62, 0.56], [4.4, 0.62, 0.56]];
      const at = x => { let i = 0; while (i < K.length - 2 && x > K[i + 1][0]) i++; const [t0, u0, v0] = K[i], [t1, u1, v1] = K[i + 1], f = seg(x, t0, t1); return [lerp(u0, u1, f), lerp(v0, v1, f)]; };
      const q = at(t);
      let u1 = 0.62, v0 = 0.56, v1 = 0.56;       // extent covered so far (sampled along the path)
      for (let x = 0; x <= t; x += 0.05) { const p = at(x); u1 = Math.max(u1, p[0]); v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]); }
      const fade = 1 - seg(t, 4.0, 4.4);
      return { hands: [{ side: 'L', u: 1 - q[0], v: q[1], k: 1.45, pinch: 0 }, { side: 'R', u: q[0], v: q[1], k: 1.45, pinch: 0 }], box: { u0: 1 - u1, u1, v0, v1 }, boxAlpha: fade };
    } },
};
DEMOS.check = DEMOS.open;

// ---- counter mapping: the same poses seen from your own eyes, over a counter in perspective ----
// Hands are placed by x (sideways, ±1 ≈ the reachable width), d (0 = near edge of the counter, 1 = back) and h (height).
const NEAR = { L: -0.38, R: 0.38 }, HREST = 0.28;
const both = f => ['L', 'R'].map(sd => ({ side: sd, x: NEAR[sd], d: 0.12, h: HREST, pinch: 0, ...f(sd) }));
Object.assign(DEMOS, {
  c_open: { len: 2.6, scene: 'counter', caption: 'palms down · fingers toward the screen · hover just above the counter',
    at: t => { const k = seg(t, 0, 0.8); return { hands: both(() => ({ h: lerp(1.3, HREST, k), alpha: k })), ring: seg(t, 0.9, 2.1), check: t > 2.1 }; } },
  c_pinch: { len: 2.9, scene: 'counter', caption: 'palms down · thumb tip meets index tip · hold it',
    at: t => { const p = seg(t, 0.35, 0.85) * (1 - seg(t, 2.45, 2.85)); return { hands: both(() => ({ pinch: p })), ring: seg(t, 0.95, 2.0), check: t > 2.0 && t < 2.45, spark: p > 0.95 }; } },
  c_far: { len: 3.1, scene: 'counter', caption: 'same height · reach toward the screen · hold',
    at: t => { const f = seg(t, 0.35, 1.1) * (1 - seg(t, 2.55, 3.05)); return { hands: both(() => ({ d: lerp(0.12, 0.92, f) })), arrows: 'far', moving: seg(t, 0.2, 0.5) * (1 - seg(t, 1.05, 1.3)), ring: seg(t, 1.15, 2.15), check: t > 2.15 && t < 2.55 }; } },
  c_up: { len: 3.1, scene: 'counter', caption: 'raise your hands, as if to a high shelf · hold',
    at: t => { const f = seg(t, 0.35, 1.1) * (1 - seg(t, 2.55, 3.05)); return { hands: both(() => ({ h: lerp(HREST, 1.35, f) })), arrows: 'up', moving: seg(t, 0.2, 0.5) * (1 - seg(t, 1.05, 1.3)), ring: seg(t, 1.15, 2.15), check: t > 2.15 && t < 2.55 }; } },
  c_range: { len: 4.4, scene: 'counter', caption: 'at counter height · slide left and right as far as is comfortable',
    at: t => {
      const K_ = [[0, 0.38], [1.0, 1.25], [1.5, 1.25], [2.6, 0.05], [3.1, 0.05], [4.0, 0.38], [4.4, 0.38]];
      const at = x => { let i = 0; while (i < K_.length - 2 && x > K_[i + 1][0]) i++; return lerp(K_[i][1], K_[i + 1][1], seg(x, K_[i][0], K_[i + 1][0])); };
      let lo = 0.38, hi = 0.38; for (let x = 0; x <= t; x += 0.05) { const q = at(x); lo = Math.min(lo, q); hi = Math.max(hi, q); }
      const q = at(t); return { hands: both(sd => ({ x: sd === 'L' ? -q : q })), band: [lo, hi], bandAlpha: 1 - seg(t, 4.0, 4.4) };
    } },
});
DEMOS.c_check = DEMOS.c_open;

// perspective for the counter scene: (x, d, h) -> point in r, and the size factor there
function proj(x, d, h, r) { const sp = 1 / (1 + 1.1 * d); return { X: r.x + r.w / 2 + x * r.h * 0.62 * sp, Y: r.y + r.h * (0.24 + 0.56 * sp) - h * r.h * 0.42 * sp, Yp: r.y + r.h * (0.24 + 0.56 * sp), sp }; }
function drawCounter(g, r, st) {
  const sc = r.h / 540, P = (x, d) => proj(x, d, 0, r);
  g.save();
  const q = [P(-1.7, -0.3), P(1.7, -0.3), P(1.7, 1.1), P(-1.7, 1.1)];
  g.fillStyle = '#4a3c2e'; g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(p.X, p.Yp) : g.moveTo(p.X, p.Yp))); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,240,220,.07)'; g.lineWidth = 1.5 * sc;
  for (const x of [-1.2, -0.6, 0, 0.6, 1.2]) { const a = P(x, -0.3), b = P(x, 1.1); g.beginPath(); g.moveTo(a.X, a.Yp); g.lineTo(b.X, b.Yp); g.stroke(); }
  for (const d of [0.35, 0.7]) { const a = P(-1.7, d), b = P(1.7, d); g.beginPath(); g.moveTo(a.X, a.Yp); g.lineTo(b.X, b.Yp); g.stroke(); }
  const e0 = P(-1.7, 1.1), e1 = P(1.7, 1.1); g.strokeStyle = 'rgba(255,240,220,.25)'; g.lineWidth = 2 * sc; g.beginPath(); g.moveTo(e0.X, e0.Yp); g.lineTo(e1.X, e1.Yp); g.stroke();   // back edge
  const n0 = P(-1.7, 0), n1 = P(1.7, 0); g.strokeStyle = 'rgba(255,240,220,.18)'; g.beginPath(); g.moveTo(n0.X, n0.Yp); g.lineTo(n1.X, n1.Yp); g.stroke();   // near edge
  if (st.band) {      // what the sweep has covered so far
    const [lo, hi] = st.band, c = [P(-hi - 0.1, -0.05), P(hi + 0.1, -0.05), P(hi + 0.1, 0.32), P(-hi - 0.1, 0.32)];
    g.globalAlpha = st.bandAlpha; g.fillStyle = 'rgba(255,255,255,.1)'; g.strokeStyle = 'rgba(255,255,255,.85)'; g.setLineDash([9 * sc, 7 * sc]); g.lineWidth = 2.5 * sc;
    g.beginPath(); c.forEach((p, i) => (i ? g.lineTo(p.X, p.Yp) : g.moveTo(p.X, p.Yp))); g.closePath(); g.fill(); g.stroke(); g.setLineDash([]);
  }
  g.restore();
}

// draw demo `id` at time t (s) into rect r; `big` adds the caption
export function drawDemo(g, id, t, r, { caption = true, label = '' } = {}) {
  const D = DEMOS[id]; if (!D) return;
  const st = D.at(t % D.len), sc = r.h / 540;
  if (D.scene === 'counter') {
    drawCounter(g, r, st);
    for (const h of st.hands) {      // shadow under each hand: the gap to it is the height
      const p = proj(h.x, h.d, h.h, r), a = 0.5 * (1 - Math.min(1, h.h / 1.6)) * (h.alpha ?? 1);
      g.save(); g.fillStyle = `rgba(0,0,0,${a})`; g.beginPath(); g.ellipse(p.X, p.Yp, 70 * sc * p.sp, 20 * sc * p.sp, 0, 0, 6.2832); g.fill(); g.restore();
      Object.assign(h, { u: (p.X - r.x) / r.w, v: (p.Y - r.y) / r.h - 0.02 * p.sp, k: 1.9 * p.sp, back: true, squash: 0.5 + 0.12 * Math.min(1, h.h / 1.3) });     /* raised hands tilt toward you a little */
    }
    if (st.arrows && st.moving > 0.01) {
      g.save(); g.globalAlpha = st.moving; g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 4 * sc; g.lineCap = 'round'; g.lineJoin = 'round';
      if (st.arrows === 'far') for (const d of [0.45, 0.62, 0.79]) { const a = proj(-0.09, d - 0.06, 0, r), m = proj(0, d + 0.04, 0, r), b = proj(0.09, d - 0.06, 0, r); g.beginPath(); g.moveTo(a.X, a.Yp); g.lineTo(m.X, m.Yp); g.lineTo(b.X, b.Yp); g.stroke(); }
      else for (const h of st.hands) { const p = proj(h.x + (h.side === 'L' ? -0.32 : 0.32), h.d, 0.55, r); g.beginPath(); g.moveTo(p.X, p.Y + 40 * sc); g.lineTo(p.X, p.Y - 40 * sc); g.moveTo(p.X - 12 * sc, p.Y - 26 * sc); g.lineTo(p.X, p.Y - 40 * sc); g.lineTo(p.X + 12 * sc, p.Y - 26 * sc); g.stroke(); }
      g.restore();
    }
  }
  if (st.box) {
    // the area covered so far, padded by about a hand (the real step draws the same box around your sweep)
    const b = st.box, pu = 0.09 * r.h / r.w, pv = 0.16;
    g.save(); g.globalAlpha = st.boxAlpha; g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2.5 * sc; g.setLineDash([9 * sc, 7 * sc]);
    g.strokeRect(r.x + (b.u0 - pu) * r.w, r.y + (b.v0 - pv) * r.h, (b.u1 - b.u0 + 2 * pu) * r.w, (b.v1 - b.v0 + 2 * pv) * r.h); g.restore();
  }
  if (st.ghost) for (const h of st.hands) drawCartoonHand(g, h.side, { ...h, k: st.ghost, ghost: true, alpha: 0.9 }, r);
  if (st.push > 0.02) {       // ripples: the hands are coming toward you
    g.save(); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2 * sc;
    for (const h of st.hands) for (let j = 0; j < 3; j++) { const ph = ((t * 1.6 + j / 3) % 1); g.globalAlpha = (1 - ph) * st.push * 0.8;
      g.beginPath(); g.arc(r.x + h.u * r.w, r.y + h.v * r.h, (60 + 90 * ph) * sc, 0, 6.2832); g.stroke(); }
    g.restore();
  }
  for (const h of st.hands) {
    const Q = handPoints(h.side, h.pinch, h.u, h.v, h.k, r, h.squash ?? 1), cx = (Q[0][0] + Q[5][0] + Q[17][0]) / 3, cy = (Q[0][1] + Q[5][1] + Q[17][1]) / 3, R = 0.075 * h.k * r.h;
    if (st.ring > 0) {    // the same hold ring the real step shows, behind the hand
      g.save(); g.lineWidth = 8 * sc; g.strokeStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.stroke();
      g.strokeStyle = st.check ? '#8fd18a' : HAND_COL[h.side]; g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + st.ring * 6.2832); g.stroke(); g.restore();
    }
    const P = drawCartoonHand(g, h.side, h, r);
    if (st.spark) {       // the touching fingertips
      const px = (P[4][0] + P[8][0]) / 2, py = (P[4][1] + P[8][1]) / 2;
      g.save(); g.fillStyle = HAND_COL[h.side]; g.globalAlpha = 0.9; g.beginPath(); g.arc(px, py, 7 * sc, 0, 6.2832); g.fill(); g.restore();
    }
    if (st.check) {       // tick on the palm
      g.save(); g.strokeStyle = '#5fae5a'; g.lineWidth = 7 * sc; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
      g.moveTo(cx - 16 * sc, cy + 2 * sc); g.lineTo(cx - 4 * sc, cy + 14 * sc); g.lineTo(cx + 18 * sc, cy - 12 * sc); g.stroke(); g.restore();
    }
  }
  if (caption && D.caption) {
    g.save(); g.font = `600 ${Math.round(17 * sc)}px ui-sans-serif, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const text = label ? `${label}  ·  ${D.caption}` : D.caption, w = g.measureText(text).width + 34 * sc, x = r.x + r.w / 2, y = r.y + r.h - 34 * sc;
    g.fillStyle = 'rgba(20,16,12,.8)'; g.beginPath(); g.roundRect(x - w / 2, y - 17 * sc, w, 34 * sc, 17 * sc); g.fill();
    g.fillStyle = '#f3e9d8'; g.fillText(text, x, y); g.restore();
  }
}
