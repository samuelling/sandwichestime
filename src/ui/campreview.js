// Camera preview: the mirrored webcam image with the tracked hand skeletons,
// pinch state and a height gauge per hand, so the participant (and the
// experimenter) can see what the tracker sees. Press C to hide/show.
import { BONES } from '../interact/hand.js';

export const HAND_COL = { L: '#3fb6c9', R: '#f08a3c' };
// mirrored camera image (as in a mirror: the participant's right hand is on the right)
export function drawVideo(g, W, H, video, alpha = 0.8) {
  g.save(); g.fillStyle = '#16130f'; g.fillRect(0, 0, W, H);
  if (video && video.readyState >= 2) { g.translate(W, 0); g.scale(-1, 1); g.globalAlpha = alpha; g.drawImage(video, 0, 0, W, H); }
  g.restore();
}
// hand skeletons with a pinch ring between thumb and index tip; `scale` thickens everything for the large calibration view
export function drawHands(g, W, H, status, scale = 1) {
  for (const s of status) {
    if (!s.img || !s.seen) continue;
    const X = p => (1 - p.x) * W, Y = p => p.y * H, c = HAND_COL[s.side];
    g.lineWidth = 2 * scale; g.strokeStyle = c; g.lineCap = 'round'; g.beginPath();
    for (const [a, b] of BONES) { g.moveTo(X(s.img[a]), Y(s.img[a])); g.lineTo(X(s.img[b]), Y(s.img[b])); }
    g.stroke();
    g.fillStyle = '#fff'; for (const p of s.img) { g.beginPath(); g.arc(X(p), Y(p), 1.6 * scale, 0, 6.3); g.fill(); }
    // the ring closes as the fingers approach this hand's pinch threshold, and fills when pinched
    const on = s.pOn ?? 0.3, px = (X(s.img[4]) + X(s.img[8])) / 2, py = (Y(s.img[4]) + Y(s.img[8])) / 2, r = (4 + 14 * Math.min(1, Math.max(0, (s.pinchD - on) / 0.7))) * Math.min(scale, 1.3);
    g.beginPath(); g.arc(px, py, r, 0, 6.3); g.lineWidth = 2 * scale; g.strokeStyle = c; g.stroke();
    if (s.pinch && s.gesture !== 'grab') { g.fillStyle = c; g.fill(); }
    if (s.gesture === 'grab') {      // a grab: filled disc on the palm
      const cx = (X(s.img[0]) + X(s.img[5]) + X(s.img[17])) / 3, cy = (Y(s.img[0]) + Y(s.img[5]) + Y(s.img[17])) / 3;
      g.beginPath(); g.arc(cx, cy, 9 * Math.min(scale, 1.3), 0, 6.3); g.fillStyle = c; g.fill();
    }
    g.fillStyle = c; g.font = `600 ${Math.round(11 * scale)}px ui-sans-serif, system-ui`; g.fillText(s.side, X(s.img[0]) - 3 * scale, Y(s.img[0]) + 14 * scale);
  }
}

export class CamPreview {
  constructor(vision, webcamHands, { width = 272 } = {}) {
    Object.assign(this, { vision, wh: webcamHands });
    const el = this.el = document.createElement('div'); el.id = 'campip';
    el.innerHTML = '<canvas></canvas><div class="row"><span class="st"></span><span class="hint">C: hide · K: calibrate · R: recentre view · H: head on/off</span></div>';
    document.body.appendChild(el);
    this.cv = el.querySelector('canvas'); this.cv.width = width; this.cv.height = Math.round(width * 9 / 16);
    this.ctx = this.cv.getContext('2d'); this.stEl = el.querySelector('.st'); this.last = 0;
    addEventListener('keydown', e => { if (e.code === 'KeyC' && e.target.tagName !== 'INPUT') el.classList.toggle('min'); });
  }
  update(now) {
    if (now - this.last < 33 || this.el.classList.contains('min')) return; this.last = now;
    const g = this.ctx, W = this.cv.width, H = this.cv.height, v = this.vision.video;
    drawVideo(g, W, H, v);
    const S = this.wh.status(), B = this.wh.cal.box;
    // the part of the picture that maps onto the screen (set by calibration)
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.strokeRect(B.u0 * W, B.v0 * H, (B.u1 - B.u0) * W, (B.v1 - B.v0) * H); g.setLineDash([]);
    drawHands(g, W, H, S);
    // height gauges (left edge for L, right edge for R): marker rises as the held object lifts; bottom = pressed
    S.forEach((s, i) => {
      const x = i ? W - 9 : 4, y0 = 8, h = H - 16;
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y0, 5, h);
      if (!s.seen) return;
      const f = s.holding ? Math.min(1, s.lift / 0.25) : 0.28;
      g.fillStyle = s.holding ? (s.lift === 0 ? '#fff' : HAND_COL[s.side]) : 'rgba(255,255,255,.5)';
      g.fillRect(x - 2, y0 + h * (1 - f) - 2, 9, 4);
    });
    const tag = s => `${s.side} ${s.seen ? (s.pinch ? '●' : '○') : '–'}`;
    const far = S.find(s => s.seen && Math.abs(s.dist) > 0.45);
    const hs = this.head?.status(), htag = hs ? (!hs.enabled ? 'head off  ·  ' : !hs.seen ? 'head: no face  ·  ' : `head ${hs.yawDeg > 0 ? '◀' : hs.yawDeg < 0 ? '▶' : '·'}${Math.abs(hs.yawDeg)}°  ·  `) : '';
    this.stEl.textContent = htag + `${tag(S[0])}  ${tag(S[1])}  ·  ${this.wh.rate < 9.5 ? this.wh.rate.toFixed(1) : Math.round(this.wh.rate)} Hz${far ? (far.dist > 0 ? '  ·  move back' : '  ·  move closer') : ''}`;
    this.el.classList.toggle('lost', !S[0].seen && !S[1].seen);
  }
}
