// Guided calibration screen for webcam hand tracking: a large mirrored camera
// view with the tracked skeletons, the pose to hold, and a ring around each hand
// that fills while the pose is being held. The logic lives in
// WebcamHands.calibrate(); this is only its view.
import { drawVideo, drawHands, HAND_COL } from './campreview.js';

export class CalibrationUI {
  constructor(vision, webcamHands) {
    Object.assign(this, { vision, wh: webcamHands, view: null, actions: null });
    const el = this.el = document.createElement('div'); el.id = 'handcal'; el.hidden = true;
    el.innerHTML = `<div class="card">
      <div class="top"><div class="dots"></div><span class="count"></span></div>
      <h2></h2><p class="hint"></p>
      <div class="stage"><canvas width="960" height="540"></canvas><div class="warn"></div></div>
      <div class="row"><span class="note">Each step moves on by itself once the pose is held.</span>
        <span><button type="button" class="redo" hidden>Measure again</button><button type="button" class="skip">Skip this step</button><button type="button" class="skipall">Skip calibration</button></span></div>
    </div>`;
    document.body.appendChild(el);
    this.cv = el.querySelector('canvas'); this.g = this.cv.getContext('2d');
    const q = s => el.querySelector(s);
    Object.assign(this, { dots: q('.dots'), count: q('.count'), h2: q('h2'), hint: q('.hint'), warn: q('.warn'), bRedo: q('.redo'), bSkip: q('.skip'), bAll: q('.skipall') });
    this.bSkip.onclick = () => this.actions?.skip(); this.bAll.onclick = () => this.actions?.skipAll(); this.bRedo.onclick = () => this.actions?.redo();
    addEventListener('keydown', e => { if (this.view && e.code === 'Escape') this.actions?.skipAll(); });
  }
  show(view, actions) {
    this.view = view; this.actions = actions; this.el.hidden = false;
    const loop = () => { if (!this.view) return; this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  hide() { this.view = null; this.actions = null; this.el.hidden = true; }

  draw() {
    const w = this.view, g = this.g, W = this.cv.width, H = this.cv.height, v = this.vision.video;
    // text
    const fin = w.id === 'done';
    if (this._n !== w.n) { this._n = w.n; this.dots.innerHTML = '<i></i>'.repeat(w.n); }
    [...this.dots.children].forEach((d, k) => { d.className = k + 1 < w.step || (k + 1 === w.step && w.done) ? 'ok' : k + 1 === w.step ? 'on' : ''; });
    this.count.textContent = fin ? '' : w.quick ? 'Quick check' : `Step ${Math.min(w.step, w.n)} of ${w.n}`;
    if (this.h2.textContent !== w.title) this.h2.textContent = w.title;
    if (this.hint.textContent !== w.hint) this.hint.textContent = w.hint;
    const warn = w.warn || (w.step <= 1 && w.note) || '';
    if (this.warn.textContent !== warn) this.warn.textContent = warn;
    this.warn.classList.toggle('show', !!warn);
    this.bRedo.hidden = !w.quick || fin; this.bSkip.hidden = fin || w.quick; this.bAll.hidden = fin;
    this.bAll.textContent = w.quick ? 'Continue' : 'Skip calibration';
    this.bSkip.textContent = w.id === 'range' ? 'Done' : 'Skip this step';
    // picture
    if (v?.videoWidth && Math.abs(W / H - v.videoWidth / v.videoHeight) > 0.01) { this.cv.height = Math.round(W * v.videoHeight / v.videoWidth); return; }
    drawVideo(g, W, H, v, 0.9);
    const S = this.wh.status(), B = w.box || (w.id === 'range' ? null : this.wh.cal.box);
    if (w.id === 'range') {
      g.fillStyle = 'rgba(255,255,255,.5)';
      for (let k = 0; k < w.trail.length; k += 2) g.fillRect(w.trail[k] * W - 1.5, w.trail[k + 1] * H - 1.5, 3, 3);
    }
    if (B && (w.id === 'range' || fin)) {
      g.strokeStyle = w.done ? '#8fd18a' : '#fff'; g.lineWidth = 3; g.setLineDash(w.done ? [] : [10, 8]);
      g.strokeRect(B.u0 * W, B.v0 * H, (B.u1 - B.u0) * W, (B.v1 - B.v0) * H); g.setLineDash([]);
    }
    drawHands(g, W, H, S, 2.2);
    S.forEach((s, i) => {
      if (!s.seen || !s.img) return;
      const c = HAND_COL[s.side], cx = (1 - (s.img[0].x + s.img[5].x + s.img[17].x) / 3) * W, cy = (s.img[0].y + s.img[5].y + s.img[17].y) / 3 * H, p = w.prog[i] || 0, R = 46;
      if (!w.need[i] && !fin) return;
      // hold ring around the palm
      g.lineWidth = 7; g.strokeStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.stroke();
      if (p > 0) { g.strokeStyle = p >= 1 ? '#8fd18a' : c; g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + p * 6.2832); g.stroke(); }
      if (p >= 1) { g.strokeStyle = '#8fd18a'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - 14, cy + 1); g.lineTo(cx - 3, cy + 12); g.lineTo(cx + 16, cy - 11); g.stroke(); }
      // live meter beside the hand (how far the pinch has closed / how far the push has gone), with the mark it must pass
      const m = w.meter?.[i];
      if (m) {
        const x = cx + (i ? 1 : -1) * (R + 22) - 5, y0 = cy - 50, h = 100;
        g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x - 2, y0 - 2, 14, h + 4);
        g.fillStyle = m.value >= m.mark ? '#8fd18a' : c; g.fillRect(x, y0 + h * (1 - m.value), 10, h * m.value);
        g.fillStyle = '#fff'; g.fillRect(x - 4, y0 + h * (1 - m.mark) - 1, 18, 2);
      }
    });
  }
}
