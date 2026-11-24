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
const CARRY = 0.07, LIFT_MAX = 0.4, PRESS_OFF = 0.02, SETTLE = 0.35;
// Standard settings, used until (or instead of) a calibration. `box` is the part of the camera image that maps onto the
// full screen; pOn / pOff are the pinch and release thresholds (thumb-index distance in palm lengths), per hand;
// liftGain converts a change in log image size into height; cutoff is the smoothing of the pointer at rest (Hz).
export const WEBCAM_DEFAULTS = { box: { u0: 0.12, u1: 0.88, v0: 0.14, v1: 0.9 }, pOn: [0.3, 0.3], pOff: [0.5, 0.5], liftGain: [0.47, 0.47], cutoff: 1.2 };
const CAL_KEY = 'sandwichestime.webcamCal.v1';
const PRESS_AT = 0.6;           // an object touches down at this fraction of the participant's comfortable push
const MIN_BOX = { w: 0.3, h: 0.25 };

const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };
const pct = (a, q) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.max(0, Math.round(q * (b.length - 1))))] : null; };
// noise of a slowly drifting signal: robust spread of the frame-to-frame differences
const jitterOf = a => { if (a.length < 8) return null; const d = a.slice(1).map((x, i) => x - a[i]), m = median(d); return 1.4826 * median(d.map(x => Math.abs(x - m))) / Math.SQRT2; };
const validCal = c => !!c && c.v === 1 && c.box && [c.box.u0, c.box.u1, c.box.v0, c.box.v1].every(Number.isFinite) && c.box.u1 - c.box.u0 >= MIN_BOX.w * 0.85 && c.box.v1 - c.box.v0 >= MIN_BOX.h * 0.85
  && [c.pOn, c.pOff, c.liftGain].every(a => Array.isArray(a) && a.length === 2 && a.every(Number.isFinite)) && c.pOn.every((x, i) => x < c.pOff[i]) && Number.isFinite(c.cutoff);

export class WebcamHands {
  constructor(vision, hands, body, bus, reacher, { mirrored = false, participant = '' } = {}) {
    Object.assign(this, { vision, hands, body, bus, reacher, mirrored, participant });
    this.st = hands.map((h, i) => ({
      fu: new OneEuro(1.2, 10), fv: new OneEuro(1.2, 10), fk: new OneEuro(0.8, 3),
      pts: Array.from({ length: 21 }, () => new OneEuro3(2.0, 20)),
      T: new THREE.Vector3(body.x + (i ? 0.22 : -0.22), 1.02, 0.18), smooth: new THREE.Vector3(body.x + (i ? 0.22 : -0.22), 1.02, 0.18),
      ndc: new THREE.Vector2(i ? 0.3 : -0.3, -0.3), lost: Infinity, lnk: 0, lnkRef: 0, lnk0: null, lift: CARRY, pinchN: 0, pinchD: 1, img: null, u: 0.5, v: 0.5, ru: 0.5, rv: 0.5, edge: 0, seen: false, pressed: false, holdT: 0,
    }));
    for (const h of hands) h.twistGain = 2.5;      // ~180° of real rotation opens a lid instead of ~450°
    this.rate = 0; this._n = 0; this._t = 0; this._frameT = -1; this.space = false; this.frames = 0;
    this.calibrating = false; this.calView = null; this.onRecalibrate = null;
    this.applyCal({ ...structuredClone(WEBCAM_DEFAULTS), v: 1, source: 'default' });
    addEventListener('keydown', e => { if (e.target?.tagName === 'INPUT') return;
      if (e.code === 'Space') { this.space = true; e.preventDefault(); } if (e.code === 'KeyF') for (const h of hands) if (h.holding) h.flip = !h.flip;   // keyboard fallback for turning the hand over
      if (e.code === 'KeyK') this.onRecalibrate?.();
      if (this.calibrating) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') body.step(-0.35, bus); if (e.code === 'ArrowRight' || e.code === 'KeyD') body.step(0.35, bus); });
    addEventListener('keyup', e => { if (e.code === 'Space') this.space = false; });
  }

  // ---- calibration storage: one saved calibration per participant ID on this browser ----
  get calKey() { return `${CAL_KEY}:${this.participant || '_'}`; }
  applyCal(cal) { this.cal = cal; for (const S of this.st) S.fu.minCutoff = S.fv.minCutoff = cal.cutoff; }
  savedCal() { try { const c = JSON.parse(localStorage.getItem(this.calKey) || 'null'); return validCal(c) ? c : null; } catch { return null; } }
  saveCal(cal) { try { localStorage.setItem(this.calKey, JSON.stringify(cal)); return true; } catch { return false; } }
  forgetCal() { try { localStorage.removeItem(this.calKey); } catch { /* storage unavailable */ } }

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

  // ---- guided calibration ------------------------------------------------
  // Four short poses, each accepted automatically once it has been held:
  //   1 open   -> neutral distance, open thumb-index gap, tracker noise
  //   2 pinch  -> closed gap                      => this person's pinch / release thresholds
  //   3 push   -> comfortable push toward screen  => height gain (objects touch down at PRESS_AT of it)
  //   4 range  -> comfortable reach in the image  => the box that maps onto the screen
  // Anything that cannot be measured keeps its standard value. While it runs the hands are parked
  // (untracked, unpinched), so nothing in the kitchen can be grabbed or dropped by the poses.
  // `mode`: 'full', or 'quick' (a saved calibration exists: one open-hand check, then reuse it).
  // `speed` shortens the holds (testing). `ui` is a view: ui.show(view, actions) / ui.hide().
  async calibrate(ui, { mode = 'full', speed = 1 } = {}) {
    if (this.calibrating) return null;
    this.calibrating = true; this.demosShown = [];
    const st = this.st, D = WEBCAM_DEFAULTS, T = s => s / speed, saved = this.savedCal();
    let quick = mode === 'quick' && !!saved;
    this.bus.emit('calibration_start', { what: 'webcam_hands', mode: quick ? 'quick' : 'full' });
    const res = { lnk0: [null, null], open: [null, null], closed: [null, null], closedHi: [null, null], lnkPinch: [null, null], push: [null, null], jitter: [null, null], box: null }, steps = {};
    const view = this.calView = { step: 0, n: quick ? 1 : 4, id: '', title: '', hint: '', warn: '', prog: [0, 0], need: [true, true], box: null, trail: [], done: false, quick, skip: false, redo: false, meter: null, phase: 'do', demoId: '', demoT0: 0, demoLen: 1, skipDemo: false, speed };
    let skipAll = false;
    ui?.show(view, { skip: () => (view.skip = true), skipAll: () => (skipAll = true), redo: () => { view.redo = true; view.skip = true; }, skipDemo: () => (view.skipDemo = true) });
    const frame = () => new Promise(r => requestAnimationFrame(r)), ms = () => performance.now();
    const pause = async s => { const t0 = ms(); while (ms() - t0 < s * 1000 && !skipAll) await frame(); };
    // per-hand motion (rates on tracker frames, lightly smoothed) and time out of sight
    const mo = st.map(() => ({ u: null, v: 0, lnk: 0, pd: 0, t: 0, sp: 0, dl: 0, dp: 0, unseen: 0 }));
    let lastFrames = this.frames, lastT = ms();
    const tick = () => {
      const now = ms(), dt = Math.min(0.1, (now - lastT) / 1000), fresh = this.frames !== lastFrames; lastT = now; lastFrames = this.frames;
      st.forEach((S, i) => {
        const m = mo[i];
        if (!S.seen) { m.unseen += dt; m.u = null; return; }
        m.unseen = 0;
        if (!fresh) return;
        if (m.u !== null) { const d = Math.max(1e-3, (now - m.t) / 1000), a = 0.5;
          m.pd += 0.5 * (S.pinchD - m.pd);
          m.sp += a * (Math.hypot(S.u - m.u, S.v - m.v) / d - m.sp); m.dl += a * ((S.lnk - m.lnk) / d - m.dl); m.dp += a * ((m.pd - m.pdPrev) / d - m.dp);
        } else { m.pd = S.pinchD; m.sp = 1; m.dl = 0; m.dp = 0; }
        Object.assign(m, { u: S.u, v: S.v, lnk: S.lnk, t: now, pdPrev: m.pd });
      });
      return { dt, fresh };
    };
    // Before each pose, cartoon hands act it out (`secs` long, or until the participant clicks), then "Your turn".
    // Nothing is measured until then; afterwards the demo keeps looping small in a corner of the picture.
    const demo = async (id, secs) => {
      if (skipAll || !secs) { view.phase = 'do'; return; }
      Object.assign(view, { phase: 'demo', demoId: id, demoT0: ms(), demoLen: T(secs), skipDemo: false }); this.demosShown.push(view.id);
      while (ms() - view.demoT0 < T(secs) * 1000 && !skipAll && !view.skip && !view.skipDemo) { await frame(); tick(); }
      view.phase = 'go'; view.goT0 = ms();
      while (ms() - view.goT0 < T(0.7) * 1000 && !skipAll && !view.skip) { await frame(); tick(); }
      view.phase = 'do';
    };
    // One pose: `ok(i, S, m)` says whether hand i is doing it; samples are taken while it is. Done when every hand
    // that is needed has held for `hold` s. A hand that never shows up is dropped once the other has finished.
    const runStep = async ({ id, title, hint, hold, timeout, ok, sample, warn, meter, show = id, showFor = 0 }) => {
      Object.assign(view, { step: view.step + 1, id, title, hint, warn: '', prog: [0, 0], skip: false, done: false, meter: null });
      await demo(show, showFor);
      const t0 = ms(), held = [0, 0], bad = [0, 0], buf = [[], []];
      for (;;) {
        await frame();
        const { dt, fresh } = tick();
        if (skipAll || view.skip) return (steps[id] = 'skipped', null);
        if (ms() - t0 > timeout * 1000) return (steps[id] = 'timeout', null);
        st.forEach((S, i) => {
          if (!view.need[i]) return;
          if (S.seen && ok(i, S, mo[i])) { held[i] += dt; bad[i] = 0; if (fresh) buf[i].push(sample(i, S)); }
          else if ((bad[i] += dt) > 0.25 && held[i] < T(hold)) { held[i] = 0; buf[i].length = 0; }     /* a single dropped frame does not restart the hold */
          view.prog[i] = clamp(held[i] / T(hold), 0, 1);
        });
        for (const i of [0, 1]) if (view.need[i] && mo[i].unseen > 4 && view.need[1 - i] && held[1 - i] >= T(hold)) { view.need[i] = false; view.prog[i] = 0; }
        view.warn = !st[0].seen && !st[1].seen && Math.min(mo[0].unseen, mo[1].unseen) > 1.2 ? 'I can’t see your hands. Check the light and hold them up inside the picture.' : (warn?.() || '');
        if (meter) view.meter = meter();
        if ([0, 1].every(i => !view.need[i] || (held[i] >= T(hold) && buf[i].length >= 3)) && view.need.some(Boolean)) break;
      }
      steps[id] = 'ok'; view.done = true; view.prog = view.need.map(n => (n ? 1 : 0));
      await pause(T(0.45));
      return buf.map((b, i) => (view.need[i] ? b : null));
    };
    const framing = () => {
      for (const S of st) if (S.seen) {
        const k = Math.exp(S.lnk);
        if (k > 3.2) return 'A little too close: move back so your whole hand fits easily.';
        if (k < 0.7) return 'A little too far: move closer to the camera.';
        if (S.u < 0.04 || S.u > 0.96 || S.v < 0.05 || S.v > 0.97) return 'Bring your hands toward the middle of the picture.';
      }
      return st[0].seen !== st[1].seen ? 'Show both hands (or keep one up: it will carry on with one).' : '';
    };
    const openOk = (i, S, m) => m.sp < 0.15 && Math.exp(S.lnk) < 3.2 && Math.exp(S.lnk) > 0.7;      /* no test on the gap itself: whatever this person's relaxed hand reads as IS "open" */
    const openStep = (id, title, hint, timeout, showFor) => runStep({ id, title, hint, hold: 1.2, timeout, show: 'open', showFor, ok: openOk, sample: (i, S) => ({ lnk: S.rlnk, pd: S.pinchD, u: S.ru, v: S.rv }), warn: framing });
    const takeOpen = b => b.forEach((a, i) => { if (!a) return; res.lnk0[i] = median(a.map(x => x.lnk)); res.open[i] = median(a.map(x => x.pd));
      const ju = jitterOf(a.map(x => x.u)), jv = jitterOf(a.map(x => x.v)); res.jitter[i] = ju === null ? null : Math.hypot(ju, jv) / Math.SQRT2; });

    let cal = null;
    if (quick) {
      const b = await openStep('check', 'Welcome back', 'Hold your hands up, palms to the screen, for a moment. Your saved calibration will be used.', 20, 1.6);
      if (b) {
        takeOpen(b);
        const off = [0, 1].some(i => res.open[i] !== null && saved.measured?.open?.[i] && Math.abs(res.open[i] / saved.measured.open[i] - 1) > 0.4);
        if (off) { view.redo = true; view.note = 'Your hands look different from last time, so let’s measure again.'; }
      }
      if (view.redo && !skipAll) { quick = false; Object.assign(view, { step: 0, n: 4, quick: false, redo: false, need: [true, true] }); delete steps.check; }
      else cal = { ...saved, source: 'saved' };
    }
    if (!quick) {
      // 1 open
      const b1 = await openStep('open', 'Open hands', 'Sit about an arm’s length from the camera. Hold both hands up where you would comfortably work: palms toward the screen, fingers up, relaxed. Keep them still.', 45, 2.6);
      if (b1) takeOpen(b1);
      // 2 pinch
      const drop = i => { const o = res.open[i] ?? res.open[1 - i] ?? 0.8; return Math.max(0.1, 0.25 * o) / o; };      /* how far the gap must close (as a fraction of open) to count as an attempt at a pinch */
      const opn = i => res.open[i] ?? res.open[1 - i] ?? 0.8;
      const b2 = skipAll ? null : await runStep({ id: 'pinch', title: 'Pinch', hint: 'Keep your palms toward the screen and touch the tip of your thumb to the tip of your index finger on each hand. This is how you will pick things up. Hold it.', hold: 0.9, timeout: 25, showFor: 2.9,
        ok: (i, S, m) => S.pinchD < opn(i) * (1 - drop(i)) && Math.abs(m.dp) < 0.8, sample: (i, S) => ({ pd: S.pinchD, lnk: S.rlnk }), warn: framing,
        meter: () => st.map((S, i) => ({ value: clamp(1 - S.pinchD / opn(i), 0, 1), mark: drop(i) })) });
      b2?.forEach((a, i) => { if (!a) return; res.closed[i] = median(a.map(x => x.pd)); res.closedHi[i] = pct(a.map(x => x.pd), 0.9); res.lnkPinch[i] = median(a.map(x => x.lnk)); });
      // 3 push (while still pinching, as when pressing something down)
      const base = st.map((S, i) => res.lnkPinch[i] ?? res.lnk0[i] ?? S.lnk);
      const b3 = skipAll ? null : await runStep({ id: 'push', title: 'Push', hint: 'Keep pinching and move your hands toward the screen, as far as is comfortable. This is how you will press things down. Hold it there.', hold: 0.8, timeout: 25, showFor: 3.1,
        ok: (i, S, m) => S.lnk - base[i] > 0.05 && Math.abs(m.dl) < 0.12, sample: (i, S) => S.rlnk,
        meter: () => st.map((S, i) => ({ value: clamp((S.lnk - base[i]) / 0.4, 0, 1), mark: 0.05 / 0.4 })) });
      b3?.forEach((a, i) => { if (a) res.push[i] = median(a) - base[i]; });
      // 4 range
      if (!skipAll) res.box = await (async () => {
        Object.assign(view, { step: view.step + 1, id: 'range', title: 'Reach', hint: 'Open your hands and pull back. Now sweep them slowly around the whole area you can reach comfortably: far left, far right, up high, down low. The box shows what you have covered; it finishes when the box stops growing.', warn: '', prog: [0, 0], skip: false, done: false, meter: null, box: null, trail: [] });
        await demo('range', 4.4);
        const us = [], vs = []; let t0 = null, grew = ms(), bx = null, ref = null;
        const big = b => !!b && b.u1 - b.u0 >= MIN_BOX.w && b.v1 - b.v0 >= MIN_BOX.h;
        for (;;) {
          await frame();
          const { fresh } = tick();
          if (skipAll) return (steps.range = 'skipped', null);
          if (view.skip) { if (big(bx)) break; return (steps.range = 'skipped', null); }     /* the button reads Done here: it accepts the box so far */
          if (fresh) st.forEach((S, i) => { if (!S.seen || !view.need[i]) return; if (t0 === null) t0 = ms(); us.push(S.u); vs.push(S.v); view.trail.push(S.u, S.v); if (view.trail.length > 1600) view.trail.splice(0, 2); });
          if (fresh && us.length >= 16) {
            const b = { u0: pct(us, 0.015), u1: pct(us, 0.985), v0: pct(vs, 0.015), v1: pct(vs, 0.985) };
            if (!ref || b.u0 < ref.u0 - 0.012 || b.u1 > ref.u1 + 0.012 || b.v0 < ref.v0 - 0.012 || b.v1 > ref.v1 + 0.012) { grew = ms(); ref = b; }     /* still expanding */
            bx = view.box = b;
          }
          const el = t0 === null ? 0 : (ms() - t0) / 1000;
          view.prog = view.need.map(n => (n ? clamp(Math.min(el / T(6), big(bx) ? 1 : 0.6), 0, 1) : 0));
          view.warn = el > 7 && !big(bx) ? 'Reach farther out: the box should cover the space you want to use.' : '';
          if (el > T(6) && us.length >= 40 && big(bx) && ms() - grew > T(2.5) * 1000) break;
          if (el > 20 || (t0 === null && ms() - grew > 25000)) break;
        }
        if (!big(bx)) return (steps.range = 'timeout', null);
        steps.range = 'ok'; view.done = true; await pause(T(0.45));
        const mu = 0.02 * (bx.u1 - bx.u0), mv = 0.02 * (bx.v1 - bx.v0);     /* a little inside the extremes, so the screen edges are reached without straining */
        return { u0: clamp(bx.u0 + mu, 0.02, 0.98), u1: clamp(bx.u1 - mu, 0.02, 0.98), v0: clamp(bx.v0 + mv, 0.02, 0.98), v1: clamp(bx.v1 - mv, 0.02, 0.98) };
      })();
      for (const id of ['open', 'pinch', 'push', 'range']) steps[id] ??= 'skipped';
      cal = this.deriveCal(res);
    }
    st.forEach((S, i) => { S.lnk0 = res.lnk0[i] ?? res.lnk0[1 - i] ?? S.lnk0; S.lnkRef = S.lnk; });
    this.applyCal(cal);
    const stored = cal.source === 'calibrated' ? this.saveCal(cal) : false;
    const cam = this.vision.video, fb = cal.fallback || {};
    const missing = [fb.pinch?.some(Boolean) && 'pinch', fb.push?.some(Boolean) && 'push depth', fb.range && 'reach'].filter(Boolean);
    const ok = cal.source !== 'default' && !missing.length;
    this.bus.emit('calibration', { type: 'webcam_hands', ok, mode: cal.source === 'saved' ? 'quick' : 'full', source: cal.source, steps, lnk0: st.map(S => S.lnk0), box: cal.box, carry: CARRY, pressAt: PRESS_AT,
      liftGain: cal.liftGain, pOn: cal.pOn, pOff: cal.pOff, cutoff: cal.cutoff, measured: cal.measured || null, fallback: cal.fallback || null, hands: view.need, stored, rate: +this.rate.toFixed(1), video: [cam?.videoWidth || null, cam?.videoHeight || null] });
    Object.assign(view, { step: view.n + 1, id: 'done', phase: 'do', demoId: '', done: true, warn: '', meter: null, prog: [0, 0], title: cal.source === 'default' ? 'Using standard settings' : 'All set',
      hint: cal.source === 'saved' ? 'Using your saved calibration. Press K at any time to measure again.'
        : cal.source === 'default' ? 'Nothing was measured. Press K at any time to calibrate.'
        : missing.length ? `Could not measure ${missing.join(' and ')}, so standard settings are used for that. Press K to try again.` : 'Pinch, press depth and reach are now tuned to your hands. Press K at any time to redo this.' });
    await pause(skipAll ? 0 : cal.source === 'saved' ? T(0.9) : T(2.2));
    ui?.hide(); this.calView = null; this.calibrating = false;
    return { ok, cal, steps };
  }

  // measurements -> settings (see calibrate). Whatever was not measured this time keeps the value in use now:
  // an earlier calibration if there is one (so a cancelled or partial redo never throws good values away), else the standard.
  deriveCal(res, prev = this.cal) {
    const P = prev?.fallback ? prev : { ...structuredClone(WEBCAM_DEFAULTS), fallback: { pinch: [true, true], push: [true, true], range: true }, measured: {} };
    const keep = k => res[k].map((x, i) => x ?? P.measured?.[k]?.[i] ?? null);
    const cal = { v: 1, t: Date.now(), source: 'calibrated', box: { ...P.box }, pOn: [...P.pOn], pOff: [...P.pOff], liftGain: [...P.liftGain], cutoff: P.cutoff,
      fallback: { pinch: [...P.fallback.pinch], push: [...P.fallback.push], range: P.fallback.range },
      measured: { open: keep('open'), closed: keep('closed'), closedHi: keep('closedHi'), push: keep('push'), jitter: keep('jitter'), pinchBias: res.lnkPinch.map((x, i) => (x === null || res.lnk0[i] === null ? P.measured?.pinchBias?.[i] ?? null : x - res.lnk0[i])) } };
    const fresh = { pinch: [false, false], push: [false, false] };
    for (const i of [0, 1]) {
      // pinch: thresholds sit between this hand's own closed and open gaps; "on" also clears the wobble seen while closed
      const o = res.open[i], c = res.closed[i], r = o !== null && c !== null ? o - c : 0;
      if (r >= 0.12) {
        const on = clamp(Math.max(0.2 * r, (res.closedHi[i] ?? c) - c + 0.03), 0.2 * r, 0.4 * r), off = Math.min(0.75 * r, Math.max(0.45 * r, on + 0.06));
        cal.pOn[i] = c + on; cal.pOff[i] = c + off; cal.fallback.pinch[i] = false; fresh.pinch[i] = true;
      }
      // height: the object touches down at PRESS_AT of the comfortable push
      if (res.push[i] !== null && res.push[i] >= 0.05) { cal.liftGain[i] = clamp(CARRY / (PRESS_AT * res.push[i]), 0.25, 1.4); cal.fallback.push[i] = false; fresh.push[i] = true; }
    }
    for (const k of ['pinch', 'push']) for (const i of [0, 1]) if (cal.fallback[k][i] && fresh[k][1 - i]) {     /* one hand measured, the other never: it borrows */
      if (k === 'pinch') { cal.pOn[i] = cal.pOn[1 - i]; cal.pOff[i] = cal.pOff[1 - i]; } else cal.liftGain[i] = cal.liftGain[1 - i];
    }
    if (res.box && res.box.u1 - res.box.u0 >= MIN_BOX.w * 0.9 && res.box.v1 - res.box.v0 >= MIN_BOX.h * 0.9) { cal.box = res.box; cal.fallback.range = false; }
    // smoothing: just enough to bring this camera's jitter, as it lands on the screen, down to ~0.1% of the screen
    const js = res.jitter.filter(x => x !== null);
    if (js.length) {
      const sigma = js.reduce((a, b) => a + b, 0) / js.length / Math.min(cal.box.u1 - cal.box.u0, cal.box.v1 - cal.box.v0), fs = clamp(this.rate || 30, 10, 60);
      const a = 0.001 / Math.max(sigma, 1e-6), al = a >= 1 ? 0.999 : 2 * a * a / (1 + a * a);
      cal.cutoff = clamp(al * fs / (2 * Math.PI * (1 - al)), 0.7, 2.2); cal.measured.sigmaScreen = sigma;
    }
    if (Object.values(cal.fallback).flat().every(Boolean)) cal.source = 'default';
    return cal;
  }

  update(dt, t) {
    const fresh = this.vision.frameT !== this._frameT; this._frameT = this.vision.frameT;
    if (fresh) { this._n++; this.frames++; }
    if (this._w0 === undefined) this._w0 = t;
    if (t - this._w0 > 1) { this.rate = this._n / (t - this._w0); this._n = 0; this._w0 = t; }   // tracker frames per wall-clock second
    const slots = this.assign(this.measure(this.vision.handResult));
    const C = this.cal, B = C.box;
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
      S.lost = 0; S.img = det.lm; S.ru = det.u; S.rv = det.v; S.rlnk = det.lnk;
      S.u = S.fu.filter(det.u, t); S.v = S.fv.filter(det.v, t); S.lnk = S.fk.filter(det.lnk, t);
      S.pinchD = det.pinchD;
      if (this.calibrating) { h.tracked = false; h.pinch = false; S.pinchN = 0; S.lnkRef = S.lnk; S.pressed = false; S.edge = 0; return; }   // hands are parked while the poses are measured
      // pinch: hysteresis + 2-frame debounce, with this hand's own thresholds
      const want = h.pinch ? det.pinchD < C.pOff[i] : det.pinchD < C.pOn[i], pending = want !== h.pinch;
      if (pending) { if (fresh) S.pinchN++; if (S.pinchN >= 2) { h.pinch = want; S.pinchN = 0; } } else S.pinchN = 0;
      // pointer: the calibrated part of the image maps onto the screen. It holds still while a pinch or release is being confirmed.
      if (!pending) S.ndc.set(clamp((S.u - B.u0) / (B.u1 - B.u0), 0, 1) * 2 - 1, 1 - 2 * clamp((S.v - B.v0) / (B.v1 - B.v0), 0, 1));
      // height: free-held objects carry at CARRY; toward the camera lowers, away lifts. The reference distance keeps
      // adapting for a moment after the grasp, so the apparent size change of the pinch itself does not move the object.
      const free = h.holding && h.hold?.mode === 'free';
      S.holdT = h.holding ? S.holdT + dt : 0;
      if (free && S.holdT > SETTLE) {
        const raw = clamp(CARRY - C.liftGain[i] * (S.lnk - S.lnkRef), 0, LIFT_MAX);
        S.pressed = S.pressed ? raw < PRESS_OFF : raw < 0.006;      /* once down, it stays down until lifted clear by 2 cm */
        S.lift = S.pressed ? 0 : raw;
      } else { S.lnkRef += (S.lnk - S.lnkRef) * (1 - Math.exp(-dt * (free ? 12 : 6))); S.lift = CARRY; S.pressed = false; }
      if (free && this.space) S.lift = 0;
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
      dist: S.lnk0 === null ? 0 : S.lnk - S.lnk0, u: S.u, v: S.v, pOn: this.cal.pOn[i], pOff: this.cal.pOff[i] }));
  }
}
