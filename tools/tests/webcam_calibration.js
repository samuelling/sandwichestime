// Walks synthetic hands through the guided webcam calibration and checks what it derives.
// Run in the page (see tools/test_controls.py calibration) at ?input=webcam&fakecam=1&calib=auto.
// PHASE: 'full' (first visit: all four poses, then use the result), 'quick' (saved calibration: one check),
//        'onehand' (only the right hand ever shows up), 'skip' (Skip calibration -> standard settings).
(async () => {
  const PHASE = '__PHASE__';
  const S = window.__sandwich, THREE = await import('three'), WH = S.webcamHands, { POSE, curlOf } = await import('/src/interact/hand.js'), { WEBCAM_DEFAULTS: D } = await import('/src/interact/webcam.js');
  const raf = () => new Promise(r => requestAnimationFrame(r)), ms = () => performance.now();
  const sleep = async t => { const t0 = ms(); while (ms() - t0 < t) await raf(); };
  const until = async (f, t = 60000) => { const t0 = ms(); while (!f()) { if (ms() - t0 > t) return false; await raf(); } return true; };
  const aspect = 1280 / 720, out = {}, check = (name, ok, info) => { out[name] = { ok: !!ok, ...(info !== undefined ? { info } : {}) }; };
  const r3 = x => (x == null ? x : +x.toFixed(3));
  // seeded noise: the whole hand jitters together in the image, like a real tracker at rest
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(6.2832 * rnd());
  const NOISE = 0.0015, K0 = 1.5, PUSH = Math.log(1.3);
  // hands given directly in the camera picture as displayed: (u, v) palm centre, k = image scale, pinch 0..1
  const state = { L: { u: 0.36, v: 0.55, k: K0, pinch: 0, fist: 0, on: PHASE !== 'onehand' }, R: { u: 0.64, v: 0.55, k: K0, pinch: 0, fist: 0, on: true } };
  const shape = (side, pinch, fist = 0) => POSE.OPEN.map((a, i) => { const b = POSE.PINCH[i], f = POSE.FIST[i], m = side === 'R' ? -1 : 1, q = [0, 1, 2].map(j => a[j] + (b[j] - a[j]) * pinch + (f[j] - a[j] - (b[j] - a[j]) * pinch) * fist); return { x: -q[0] * m, y: -q[1], z: q[2] }; });
  const gap = wl => Math.hypot(wl[4].x - wl[8].x, wl[4].y - wl[8].y, wl[4].z - wl[8].z) / Math.hypot(wl[9].x - wl[0].x, wl[9].y - wl[0].y, wl[9].z - wl[0].z);
  function synth(side, st) {
    const wl = shape(side, st.pinch, st.fist), nx = NOISE * gauss(), ny = NOISE * gauss();
    const pc = [0, 5, 17].reduce((p, i) => ({ x: p.x + wl[i].x / 3, y: p.y + wl[i].y / 3 }), { x: 0, y: 0 });
    const lm = wl.map(p => ({ x: 1 - st.u + nx + st.k * (p.x - pc.x) / aspect, y: st.v + ny + st.k * (p.y - pc.y), z: 0 }));
    return { lm, wl, label: side === 'R' ? 'Left' : 'Right' };       /* MediaPipe labels as if the image were mirrored */
  }
  let run = true;
  (function pump() { if (!run) return; const hs = ['L', 'R'].filter(s => state[s].on).map(s => synth(s, state[s]));
    window.__fakeHands({ landmarks: hs.map(h => h.lm), worldLandmarks: hs.map(h => h.wl), handednesses: hs.map(h => [{ categoryName: h.label }]) }); requestAnimationFrame(pump); })();
  const both = f => { f(state.L); f(state.R); };
  // this "participant" pinches loosely: fingertips stop short, at a gap the standard threshold (0.3) does not count as a pinch
  let PINCH = 1; for (let p = 1; p > 0; p -= 0.01) if (gap(shape('R', p)) >= 0.36) { PINCH = p; break; }
  const gOpen = gap(shape('R', 0)), gPinch = gap(shape('R', PINCH));
  const step = id => until(() => WH.calView?.id === id, 70000);
  const parked = () => S.hands.every(h => !h.tracked && !h.pinch && !h.holding);
  const stored = () => { try { return JSON.parse(localStorage.getItem(WH.calKey)); } catch { return null; } };

  if (PHASE === 'skip') {
    check('calibration screen is up', await until(() => WH.calibrating && !document.querySelector('#handcal').hidden, 20000));
    document.querySelector('#handcal .skipall').click();
    await until(() => !WH.calibrating, 8000);
    check('Skip calibration: standard settings, nothing saved', WH.cal.source === 'default' && WH.cal.pOn[0] === D.pOn[0] && WH.cal.box.u0 === D.box.u0 && !stored() && document.querySelector('#handcal').hidden, WH.cal.source);
    check('the trial still starts', await until(() => S.logger?.recording, 20000));
  } else if (PHASE === 'quick') {
    const saved = stored();
    check('a saved calibration exists for this participant', !!saved && saved.source === 'calibrated');
    check('quick check: one step', await step('check') && WH.calView.n === 1 && WH.calView.quick, WH.calView && [WH.calView.id, WH.calView.n]);
    await until(() => !WH.calibrating, 30000);
    check('saved calibration is reused', WH.cal.source === 'saved' && saved && WH.cal.pOn[1] === saved.pOn[1] && WH.cal.box.u0 === saved.box.u0 && WH.cal.liftGain[0] === saved.liftGain[0], WH.cal.source);
    const c = S.logger.calibration.filter(e => e.calType === 'webcam_hands' || e.type === 'webcam_hands' || e.data?.type === 'webcam_hands');
    check('logged as a quick calibration', JSON.stringify(S.logger.calibration).includes('"mode":"quick"'), c.length);
  } else if (PHASE === 'wobbly') {
    // a less tidy participant: hands that twitch every 0.8 s while "still", and a left hand that never quite pinches
    const t0 = ms();
    await until(() => WH.calView?.id === 'open' && WH.calView.phase === 'do', 30000);
    let twitch = true; (async () => { while (twitch) { await sleep(650); for (const s of [state.L, state.R]) s.u += 0.05; await sleep(150); for (const s of [state.L, state.R]) s.u -= 0.05; } })();
    await until(() => WH.calView?.id === 'pinch', 30000);
    const tOpen = (ms() - t0) / 1000; twitch = false;
    check('twitchy hands still get through "open hands"', WH.calView?.id === 'pinch', tOpen.toFixed(1) + ' s');
    await until(() => WH.calView?.phase === 'do', 20000);
    const tp = ms(); state.R.pinch = PINCH; state.L.pinch = 0.12;      /* the left hand barely closes */
    await until(() => WH.calView?.id !== 'pinch', 40000);
    const tPinch = (ms() - tp) / 1000;
    check('one hand that never pinches does not hold up the other (about 6 s, not the 25 s timeout)', WH.calView?.id === 'grab' && tPinch < 12, tPinch.toFixed(1) + ' s');
    document.querySelector('#handcal .skipall').click();
    await until(() => !WH.calibrating, 8000);
    const c = WH.cal, ev = S.logger.calibration.filter(e => JSON.stringify(e).includes('webcam_hands')).at(-1), steps = ev?.steps || ev?.data?.steps || {};
    check('the left hand borrows the right hand\'s pinch', c.pOn[0] === c.pOn[1] && c.fallback.pinch[0] && !c.fallback.pinch[1] && steps.open === 'ok' && steps.pinch === 'ok', [c.pOn.map(r3), c.fallback.pinch, steps]);
  } else {
    // ---- the four poses ----
    // record, per step, which phases were shown and whether anything was measured during the demo
    const phases = {}; let rec = true;
    (async () => { while (rec) { const v = WH.calView; if (v && v.id) { const p = phases[v.id] ??= { seq: [], progInDemo: 0 }; if (p.seq.at(-1) !== v.phase) p.seq.push(v.phase); if (v.phase !== 'do') p.progInDemo = Math.max(p.progInDemo, ...v.prog); } await raf(); } })();
    const t0 = ms(), seen = {};
    check('1 open: screen is up, hands parked', await step('open') && !document.querySelector('#handcal').hidden && WH.calibrating && parked());
    seen.open = await step('pinch'); both(s => (s.pinch = PINCH)); await sleep(150);
    check('2 pinch reached; pinching grabs nothing while calibrating', seen.open && parked());
    seen.pinch = await step('grab'); both(s => { s.pinch = 0; s.fist = 1; });
    check('2b grab reached; a fist grabs nothing while calibrating', seen.pinch && (await sleep(200), parked()));
    seen.grab = await step('push'); both(s => { s.fist = 0; s.pinch = PINCH; s.k = K0 * Math.exp(PUSH); });
    check('3 push reached', seen.pinch, WH.calView?.id);
    seen.push = await step('range'); both(s => { s.pinch = 0; s.k = K0; }); await until(() => WH.calView?.phase === 'do', 20000);     /* watch the demo, then sweep */
    check('4 reach reached', seen.push, WH.calView?.id);
    // sweep the reachable area the way a person does: out to each corner, pausing there
    const tr = ms(), U = [0.18, 0.82], V = [0.22, 0.84], mid = PHASE === 'onehand' ? U[0] : (U[0] + U[1]) / 2;     /* one hand alone covers the whole width */
    const path = [[0, 0], [0, 1], [1, 1], [1, 0]], LEG = 1700;       /* corners as fractions (outer -> inner, top -> bottom); half of each leg is travel, half is a pause */
    const from = { L: [state.L.u, state.L.v], R: [state.R.u, state.R.v] };
    while (WH.calView?.id === 'range' && ms() - tr < 30000) {
      const t = (ms() - tr) / LEG, n = Math.floor(t), f = Math.min(1, (t - n) * 2), e = f * f * (3 - 2 * f), c1 = path[n % 4], c0 = n ? path[(n - 1) % 4] : null;
      for (const side of ['L', 'R']) {
        const pt = c => (c ? [side === 'L' ? U[0] + (mid - U[0]) * c[0] : U[1] - (U[1] - mid) * c[0], V[0] + (V[1] - V[0]) * c[1]] : from[side]), p0 = pt(c0), p1 = pt(c1);
        state[side].u = p0[0] + (p1[0] - p0[0]) * e; state[side].v = p0[1] + (p1[1] - p0[1]) * e;
      }
      await raf();
    }
    both(s => (s.v = 0.55)); state.L.u = 0.36; state.R.u = 0.64;
    await until(() => !WH.calibrating, 20000);
    rec = false;
    check('every pose is demonstrated first, then "your turn"', WH.demosShown.join() === 'open,pinch,grab,push,range' && ['pinch', 'grab', 'push', 'range'].every(id => phases[id]?.seq.join('>').startsWith('demo>go>do')), [WH.demosShown.join(), Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, v.seq.join('>')]))]);
    check('nothing is measured while the demo plays', Object.values(phases).every(p => p.progInDemo === 0));
    const cal = WH.cal, me = cal.measured || {}, fb = cal.fallback || {}, dur = (ms() - t0) / 1000;
    const hs = PHASE === 'onehand' ? [1] : [0, 1];
    check('finished, screen closed', !WH.calibrating && document.querySelector('#handcal').hidden && cal.source === 'calibrated', [cal.source, dur.toFixed(1) + ' s']);
    check('every pose was measured', fb.pinch && !fb.pinch[1] && !fb.grab[1] && !fb.push[1] && !fb.range && (PHASE === 'onehand' || (!fb.pinch[0] && !fb.grab[0] && !fb.push[0])), fb);
    const cFist = curlOf(shape('R', 0, 1)), cOpen = curlOf(shape('R', 0, 0)), cLoose = curlOf(shape('R', PINCH, 0));
    check('grab threshold sits between this hand\'s fist and open hand, clear of a pinch', [0, 1].every(i => cal.gOn[i] > cFist + 0.05 && cal.gOn[i] < cal.gOff[i] - 0.05 && cal.gOff[i] < cOpen - 0.2) && cal.gOn[1] < cLoose - 0.05, [cal.gOn.map(r3), cal.gOff.map(r3), r3(cFist), r3(cLoose), r3(cOpen)]);
    check('open and closed gaps match the hand shown', hs.every(i => Math.abs(me.open[i] - gOpen) < 0.02 && Math.abs(me.closed[i] - gPinch) < 0.02), [me.open.map(r3), me.closed.map(r3), r3(gOpen), r3(gPinch)]);
    check('pinch threshold sits between this hand\'s closed and open gap', [0, 1].every(i => cal.pOn[i] > gPinch + 0.03 && cal.pOn[i] < cal.pOff[i] - 0.05 && cal.pOff[i] < gOpen - 0.1), [cal.pOn.map(r3), cal.pOff.map(r3)]);
    check('this loose pinch is one the standard threshold would miss', gPinch > D.pOn[1] && gPinch < cal.pOn[1], [r3(gPinch), D.pOn[1]]);
    const gain = 0.07 / (0.6 * PUSH);
    check('push depth sets the height gain (touch down at 60% of the push)', hs.every(i => Math.abs(me.push[i] - PUSH) < 0.03) && [0, 1].every(i => Math.abs(cal.liftGain[i] / gain - 1) < 0.12), [me.push.map(r3), cal.liftGain.map(r3), r3(gain)]);
    const bx = { u0: U[0] + 0.02 * (U[1] - U[0]), u1: U[1] - 0.02 * (U[1] - U[0]), v0: V[0] + 0.02 * (V[1] - V[0]), v1: V[1] - 0.02 * (V[1] - V[0]) };
    check('reach box matches the swept area', Object.keys(bx).every(k => Math.abs(cal.box[k] - bx[k]) < 0.035), [Object.values(cal.box).map(r3), Object.values(bx).map(r3)]);
    check('tracker jitter measured, smoothing set from it', hs.every(i => me.jitter[i] > NOISE / 2 && me.jitter[i] < NOISE * 2) && cal.cutoff >= 0.7 && cal.cutoff <= 2.2 && WH.st[0].fu.minCutoff === cal.cutoff, [me.jitter.map(x => x && +x.toFixed(5)), r3(cal.cutoff)]);
    if (PHASE === 'onehand') check('with one hand shown, the other borrows its settings', WH.calView === null && cal.pOn[0] === cal.pOn[1] && cal.liftGain[0] === cal.liftGain[1] && fb.pinch[0] && me.open[0] === null, [cal.pOn.map(r3)]);
    const sv = stored();
    check('saved for this participant', !!sv && sv.pOn[1] === cal.pOn[1] && sv.box.u0 === cal.box.u0 && WH.calKey.endsWith(':' + S.cfg.participant), WH.calKey);
    const ev = S.logger.calibration.find(e => JSON.stringify(e).includes('webcam_hands'));
    check('calibration is in the log', !!ev && JSON.stringify(ev).includes('"mode":"full"') && JSON.stringify(ev).includes('"pOn"'));

    // ---- and then it is used ----
    check('trial starts', await until(() => S.logger?.recording, 20000));
    if (PHASE === 'full') {
      const V3 = S.camera.position.constructor, T = S.L.task, R = S.hands[1], B = cal.box, pos = e => e.root.getWorldPosition(new V3());
      const now = () => S.world.t * 1000, wait = async t => { const a = now(); while (now() - a < t) await raf(); };
      const aim = async p => {      // glide there, as a hand does (a hand that jumps across the picture can swap identities with the other)
        const n = p.clone().project(S.camera), u = B.u0 + (n.x + 1) / 2 * (B.u1 - B.u0), v = B.v0 + (1 - n.y) / 2 * (B.v1 - B.v0), u0 = state.R.u, v0 = state.R.v, a = now();
        for (;;) { const f = Math.min(1, (now() - a) / 500); state.R.u = u0 + (u - u0) * f; state.R.v = v0 + (v - v0) * f; if (f >= 1) break; await raf(); }
      };
      const ramp = async (key, to, t = 350) => { const from = state.R[key], a = now(); for (;;) { const u = Math.min(1, (now() - a) / t); state.R[key] = from + (to - from) * u; if (u >= 1) break; await raf(); } await wait(300); };
      const arrive = async p => { const n = p.clone().project(S.camera); await until(() => Math.hypot(WH.st[1].ndc.x - n.x, WH.st[1].ndc.y - n.y) < 0.015, 8000); await wait(300); };
      { const a = now(); while (now() - a < 500) { const f = (now() - a) / 500; state.L.u = 0.36 - 0.1 * f; state.L.v = 0.55 + 0.31 * f; await raf(); } state.L.u = 0.26; state.L.v = 0.86; await wait(300); }      // the left hand moves out of the way, low in the picture (hands that overlap can swap identities; one held at the side edge steps)
      const clipMid = new THREE.Box3().setFromObject(T.bag.clip.root).getCenter(new V3());      /* the middle of the clip, not its origin (which sits at an edge) */
      await aim(clipMid); await arrive(clipMid);
      { const n = pos(T.bag.clip).project(S.camera); check('with the calibrated box, the hand lands on the clip', R.tracked && R.hover?.id === 'bread_clip', [R.hover?.id, r3(S.body.x), [r3(n.x), r3(n.y)], WH.st[1].ndc.toArray().map(r3), [r3(state.R.u), r3(state.R.v)], R.tracked, R.pinch, WH.st[1].pin, WH.st[1].grb, r3(WH.st[1].curl), r3(WH.st[1].pinchD), WH.cal.gOn.map(r3), WH.cal.pOn.map(r3)]); }
      const ptr = []; let pw = true; (async () => { while (pw) { ptr.push([R.pickHint?.id ?? '-', R.hover?.id ?? '-', WH.st[1].ndc.toArray().map(r3), r3(WH.st[1].pinchD), R.pinch, R.holding?.id ?? '-', r3(S.body.x), r3(S.camera.rotation.y)]); await raf(); } })();
      await ramp('pinch', PINCH); pw = false;
      check('the loose pinch now grabs it', R.holding?.id === 'bread_clip', [R.holding?.id, r3(WH.st[1].pinchD), ptr.filter((x, k, a) => !k || JSON.stringify(x.slice(0, 2).concat(x[4], x[5])) !== JSON.stringify(a[k - 1].slice(0, 2).concat(a[k - 1][4], a[k - 1][5])))]);
      await aim(new V3(0.42, 0.91, -0.1)); await arrive(new V3(0.42, 0.91, -0.1));
      const push = async f => { await ramp('k', K0 * Math.exp(f * PUSH), 400); await wait(500); return [R.press, r3(WH.st[1].lift)]; };
      const a = await push(0.42), b = await push(0.75), c = await push(0.5), d = await push(0.25);
      check('touches down past 60% of the calibrated push, not before', !a[0] && b[0], [a, b]);
      check('stays down when easing off a little, lifts when pulled clear', c[0] && !d[0], [c, d]);
      await ramp('pinch', 0);
      check('opening the hand lets go', !R.holding);
      const before = S.logger.events.filter(e => e.type === 'grasp').length;
      await ramp('fist', 1);
      await wait(400);
      const g = S.logger.events.filter(e => e.type === 'grip').slice(-1)[0], p0 = S.logger.events.filter(e => e.type === 'grip').slice(-2)[0];
      check('a fist grabs it too, logged as a grab (the earlier pinch as a pinch)', R.holding?.id === 'bread_clip' && g?.how === 'grab' && p0?.how === 'pinch', [R.holding?.id, p0?.how, g?.how, g?.curl]);
      await ramp('fist', 0);
      check('opening the fist lets go', !R.holding);
    }
  }
  run = false;
  return JSON.stringify({ pass: Object.values(out).every(o => o.ok), out, errors: window.__errors || null, cal: WH.cal });
})()
