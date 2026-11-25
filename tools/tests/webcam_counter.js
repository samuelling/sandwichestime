// The counter mapping, end to end, with synthetic hands: palm-down hands at real 3D positions in front of a
// pinhole camera (at the top of a laptop screen, looking straight ahead), projected into MediaPipe-style results.
// Runs the five-pose calibration, then checks the mapping and does real work with it.
// Run in the page (see tools/test_controls.py counter) at ?input=webcam&fakecam=1&calib=full&webcammap=counter.
(async () => {
  const S = window.__sandwich, WH = S.webcamHands, { POSE } = await import('/src/interact/hand.js');
  const raf = () => new Promise(r => requestAnimationFrame(r)), ms = () => performance.now();
  const sleep = async t => { const t0 = ms(); while (ms() - t0 < t) await raf(); };
  const until = async (f, t = 60000) => { const t0 = ms(); while (!f()) { if (ms() - t0 > t) return false; await raf(); } return true; };
  const out = {}, check = (name, ok, info) => { out[name] = { ok: !!ok, ...(info !== undefined ? { info } : {}) }; };
  const r3 = x => (x == null ? x : +(+x).toFixed(3));
  // camera: focal length in image heights, 16:9 picture. Real hand state: X to the participant's right, Y down
  // from the camera, Z away from the camera (metres); yaw = turning the hand about the vertical.
  const F = 1.2, ASP = 1280 / 720, REST = { Y: 0.06, Z: 0.55 }, X0 = 0.13;
  const state = { L: { X: -X0, ...REST, pinch: 0, fist: 0, yaw: 0, on: true }, R: { X: X0, ...REST, pinch: 0, fist: 0, yaw: 0, on: true } };
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(6.2832 * rnd());
  function synth(side, st) {
    const m = side === 'R' ? -1 : 1, c = Math.cos(st.yaw), s = Math.sin(st.yaw);
    // palm down, fingers toward the camera, thumbs inward; axes as the (unmirrored) camera sees them: x = participant's left
    const wl = POSE.OPEN.map((a, i) => { const b = POSE.PINCH[i], f = POSE.FIST[i], p = [0, 1, 2].map(j => { const q = a[j] + (b[j] - a[j]) * st.pinch; return q + (f[j] - q) * st.fist; });
      const x = -p[0] * m, y = -p[2], z = -p[1]; return { x: x * c + z * s, y, z: -x * s + z * c }; });
    const pc = [0, 5, 17].reduce((q, i) => ({ x: q.x + wl[i].x / 3, y: q.y + wl[i].y / 3, z: q.z + wl[i].z / 3 }), { x: 0, y: 0, z: 0 });
    const nx = 0.0008 * gauss(), ny = 0.0008 * gauss();
    const lm = wl.map(p => { const W = { x: -st.X + p.x - pc.x, y: st.Y + p.y - pc.y, z: st.Z + p.z - pc.z }; return { x: 0.5 + F * W.x / (W.z * ASP) + nx, y: 0.5 + F * W.y / W.z + ny, z: 0 }; });
    return { lm, wl, label: side === 'R' ? 'Left' : 'Right' };
  }
  let run = true;
  (function pump() { if (!run) return; const hs = ['L', 'R'].filter(s => state[s].on).map(s => synth(s, state[s]));
    window.__fakeHands({ landmarks: hs.map(h => h.lm), worldLandmarks: hs.map(h => h.wl), handednesses: hs.map(h => [{ categoryName: h.label }]) }); requestAnimationFrame(pump); })();
  const both = f => { f(state.L, -1); f(state.R, 1); };
  const ramp = async (st, key, to, t = 400) => { const from = st[key], a = ms(); for (;;) { const u = Math.min(1, (ms() - a) / t); st[key] = from + (to - from) * u * u * (3 - 2 * u); if (u >= 1) break; await raf(); } await sleep(250); };
  const step = id => until(() => WH.calView?.id === id && WH.calView.phase === 'do', 70000);

  // ---- calibration: rest, pinch, reach forward, raise, sweep ----
  check('calibration starts with the counter poses', await until(() => WH.calView?.id === 'open', 30000) && WH.calView.n === 6 && WH.mapping === 'counter', WH.calView?.n);
  check('rest pose demonstrated over a counter', await until(() => WH.demosShown?.[0] === 'open') && WH.calView.demoId === 'c_open', WH.calView?.demoId);
  await step('pinch'); both(s => (s.pinch = 1));
  await step('grab'); both(s => { s.pinch = 0; s.fist = 1; });
  await step('far'); both(s => (s.fist = 0)); await sleep(300); await Promise.all([ramp(state.L, 'Z', 0.40, 600), ramp(state.R, 'Z', 0.40, 600)]);
  await step('up'); await Promise.all([ramp(state.L, 'Z', REST.Z, 500), ramp(state.R, 'Z', REST.Z, 500)]); await Promise.all([ramp(state.L, 'Y', -0.12, 600), ramp(state.R, 'Y', -0.12, 600)]);
  await step('range'); await Promise.all([ramp(state.L, 'Y', REST.Y, 500), ramp(state.R, 'Y', REST.Y, 500)]);
  { const tr = ms(), K_ = [[0, X0], [1.0, 0.30], [1.9, 0.30], [3.1, 0.02], [4.0, 0.02], [5.0, X0]];
    const at = x => { x %= 5; let i = 0; while (i < K_.length - 2 && x > K_[i + 1][0]) i++; const f = Math.min(1, Math.max(0, (x - K_[i][0]) / (K_[i + 1][0] - K_[i][0]))); return K_[i][1] + (K_[i + 1][1] - K_[i][1]) * f * f * (3 - 2 * f); };
    while (WH.calView?.id === 'range' && ms() - tr < 30000) { const q = at((ms() - tr) / 1000); state.L.X = -q; state.R.X = q; await raf(); }
    state.L.X = -X0; state.R.X = X0; }
  await until(() => !WH.calibrating, 20000);
  const cal = WH.cal, C = cal.counter, fbc = cal.fallback?.counter;
  check('calibrated: every counter pose measured', cal.source === 'calibrated' && fbc && !fbc.rest.some(Boolean) && !fbc.axes.some(Boolean) && !fbc.lat && !cal.fallback.pinch.some(Boolean) && !cal.fallback.grab.some(Boolean), [fbc, cal.fallback.grab]);
  check('forward = hand grows (and drops in the picture); up = hand rises in the picture', C.aF.every(a => a[1] > 0.2 && a[0] > 0) && C.aU.every(a => a[0] < -0.2 && Math.abs(a[1]) < 0.1), { aF: C.aF.map(a => a.map(r3)), aU: C.aU.map(a => a.map(r3)) });
  check('level hands measured as level', Math.abs(C.pitch) < 0.12, r3(C.pitch));
  check('saved for this participant, separately from the upright mapping', WH.calKey.includes(':counter:') && !!WH.savedCal());
  await until(() => S.logger?.recording, 20000); await sleep(800);

  // ---- the mapping ----
  const P = i => WH.st[i].P, R = S.hands[1], Lh = S.hands[0], body = S.body;
  const near = (a, b, tol) => Math.abs(a - b) < tol;
  check('rest pose: hands over the near edge of the counter, at hover height', near(P(1).z, -0.1, 0.03) && near(P(1).y, 0.91 + 0.12, 0.02) && near(P(0).z, -0.1, 0.03) && P(1).x - body.x > 0.12 && P(0).x - body.x < -0.12, [P(0).toArray().map(r3), P(1).toArray().map(r3)]);
  check('palm down, thumbs inward, fingers pointing away from the body', new S.camera.position.constructor(0, 0, 1).applyQuaternion(R.quat).y > 0.7 && R.joints[4].x < R.joints[17].x && Lh.joints[4].x > Lh.joints[17].x && R.joints[12].z < R.joints[0].z - 0.05,
    [r3(new S.camera.position.constructor(0, 0, 1).applyQuaternion(R.quat).y)]);
  await ramp(state.R, 'Z', 0.40, 600); await sleep(500);
  const farP = P(1).clone();
  check('reaching toward the screen goes to the back of the counter, at the same height', near(farP.z, -0.5, 0.04) && near(farP.y, 1.03, 0.03), farP.toArray().map(r3));
  await ramp(state.R, 'Z', 0.47, 400); await sleep(500);
  check('half way: the height stays put (forward and up do not leak into each other)', near(P(1).y, 1.03, 0.03) && P(1).z < -0.2 && P(1).z > -0.4, P(1).toArray().map(r3));
  await ramp(state.R, 'Z', REST.Z, 400); await ramp(state.R, 'Y', -0.12, 500); await sleep(500);
  check('raising the hand raises it to shelf height, without moving it forward', near(P(1).y, 1.58, 0.05) && near(P(1).z, -0.1, 0.05), P(1).toArray().map(r3));
  await ramp(state.R, 'Y', REST.Y, 400); await sleep(300);

  // drive a hand to a world point by adjusting the real hand (a few corrective steps, like a person looking at the screen)
  const goto = async (side, target, tol = 0.012) => {
    const i = side === 'L' ? 0 : 1, st = state[side];
    for (let n = 0; n < 60; n++) {
      await sleep(120); const e = target.clone().sub(P(i));
      if (e.length() < tol) return true;
      st.X += 0.8 * e.x / 2.2; st.Z += 0.8 * e.z / 2.67; st.Y -= 0.8 * e.y / 3.06;
    }
    return false;
  };
  const V3 = S.camera.position.constructor, T = S.L.task, pos = e => (e ? e.root.getWorldPosition(new V3()) : new V3(NaN, NaN, NaN)), ev = type => S.logger.events.filter(e => e.type === type);

  // the left hand works on the left of the counter, as a person would; the right one waits out of its way
  const L = state.L, Lh_ = Lh;
  state.R.X = 0.24; await sleep(300);
  // 1) the clip: hover over it, pinch, carry, lower to put it down
  await goto('L', pos(T.bag.clip).add(new V3(0, 0.08, 0)), 0.005);
  check('hovering a little above the clip offers it', Lh.hover?.id === 'bread_clip', Lh.hover?.id);
  const seenHint = []; let watch = true; (async () => { while (watch) { seenHint.push([Lh.pickHint?.id ?? '-', r3(WH.st[0].pinchD), Lh.pinch]); await raf(); } })();
  await ramp(L, 'pinch', 1); watch = false;
  check('pinch takes the clip and opens the bag', Lh.holding?.id === 'bread_clip' && ev('bag_open').length === 1, [Lh.holding?.id, seenHint.filter((x, k, a) => !k || x[0] !== a[k - 1][0] || x[2] !== a[k - 1][2])]);
  const spot = new V3(body.x - 0.6, 0, -0.12);
  await goto('L', spot.clone().setY(1.05), 0.02);
  check('carried away from the bag', Lh.holding?.id === 'bread_clip', [Lh.holding?.id, P(0).toArray().map(r3)]);
  const yCarry = pos(Lh.holding).y;
  await goto('L', spot.clone().setY(0.9), 0.02); await sleep(300);
  check('lowering the hand sets it down on the counter (pressed)', Lh.press && yCarry - pos(Lh.holding).y > 0.06, [r3(yCarry), r3(pos(Lh.holding).y)]);
  L.Y -= 0.01 / 3.06; await sleep(400);      // ~1 cm back up in the kitchen
  const stillDown = Lh.press;
  await goto('L', spot.clone().setY(0.99), 0.02); await sleep(200);
  check('stays down when easing up a little, lifts when raised clear', stillDown && !Lh.press, [stillDown, Lh.press, r3(P(0).y), r3(WH.st[0].lift), WH.st[0].pressed, r3(Lh.grip.y), r3(pos(Lh.holding).y)]);
  await goto('L', spot.clone().setY(0.9), 0.02); await ramp(L, 'pinch', 0); await sleep(400);
  check('opening the hand lets go; the clip is on the counter', !Lh.holding && T.bag.clip.restingOn === 'counter', T.bag.clip.restingOn);

  // 2) a slice from the open bag onto the plate
  const top = T.bag.state.slices.reduce((a, b) => (b.state.index > a.state.index ? b : a));
  await goto('L', pos(top).add(new V3(0, 0.1, 0)), 0.006);
  await ramp(L, 'pinch', 1);
  const sl = Lh.holding;
  check('reaching over the open end takes a slice', sl?.kind === 'slice' && ev('slice_out').length === 1, sl?.id ?? Lh.hover?.id);
  if (sl) {
    await goto('L', pos(T.plate).add(new V3(-0.02, 0.12, 0)), 0.02);
    await goto('L', pos(T.plate).add(new V3(-0.02, -0.02, 0)), 0.02); await sleep(300);
    await ramp(L, 'pinch', 0); await sleep(600);
    check('lowered onto the plate, it stays there', sl.restingOn === 'plate', sl.restingOn);
    await goto('L', pos(T.plate).add(new V3(-0.2, 0.15, 0.05)), 0.03);
  }

  // 3) unscrew the peanut butter lid by turning the palm-down hand (like a real lid)
  const lid = pos(T.pb).add(new V3(0, T.pb.geom.rimY + 0.03, 0));
  await goto('L', lid, 0.006);
  let dir = 1, opened = false; const strokes = [];
  for (let k = 0; k < 4 && !opened; k++) {
    await ramp(L, 'yaw', -dir * 0.8, 250);
    await goto('L', lid, 0.006);      // turning the hand moves it a little: aim again, as a person would
    await ramp(L, 'pinch', 1);
    strokes.push([Lh.hold?.mode, Lh.holding?.id]);
    if (k === 0) check('pinching the lid starts a twist', Lh.hold?.mode === 'twist', [Lh.hold?.mode, Lh.hover?.id, Lh.holding?.id]);
    const o0 = T.pb.lid.state.openness || 0;
    await ramp(L, 'yaw', dir * 0.8, 700);
    opened = ev('lid_off').length > 0;
    if (!opened && (T.pb.lid.state.openness || 0) <= o0 + 0.05 && k === 0) dir = -1;
    if (!opened) await ramp(L, 'pinch', 0);
  }
  check('turning the hand unscrews the lid', opened, { openness: r3(T.pb.lid.state.openness), dir, strokes });
  if (Lh.holding) { await goto('L', pos(T.pb).add(new V3(-0.2, 0.06, 0.1)), 0.03); await goto('L', pos(T.pb).add(new V3(-0.2, -0.06, 0.1)), 0.03); await ramp(L, 'pinch', 0); }
  L.yaw = 0; await goto('L', new V3(body.x - 0.3, 1.03, -0.1), 0.03);

  // 4) a fist on the jelly lid: a whole-hand grab, then turning the hand unscrews it
  const J = T.jelly, side = pos(J).x > body.x ? 'R' : 'L', Hs = side === 'R' ? R : Lh, Hst = state[side], other = state[side === 'R' ? 'L' : 'R'];
  other.X = side === 'R' ? -0.24 : 0.24; await sleep(300);
  const jlid = pos(J).add(new V3(0, J.geom.rimY + 0.03, 0));
  let jopen = false; const before = ev('grasp').length; let dir2 = 1;
  for (let k = 0; k < 5 && !jopen; k++) {
    await ramp(Hst, 'yaw', -dir2 * 0.8, 250);
    await goto(side, jlid, 0.006);
    await ramp(Hst, 'fist', 1);
    if (k === 0) { await until(() => ev('grip').some(e => e.obj === 'jelly_lid'), 3000); const gp = ev('grip').filter(e => e.obj === 'jelly_lid').at(-1); check('a fist on the jelly lid takes hold of it to twist, logged as a grab', Hs.hold?.mode === 'twist' && gp?.obj === 'jelly_lid' && gp?.how === 'grab', [Hs.hold?.mode, Hs.holding?.id, gp?.how, gp?.obj]); }
    const o0 = J.lid.state.openness || 0;
    await ramp(Hst, 'yaw', dir2 * 0.8, 700);
    jopen = ev('lid_off').some(e => e.obj === 'jelly_lid');
    if (!jopen && (J.lid.state.openness || 0) <= o0 + 0.05 && k === 0) dir2 = -1;
    if (!jopen) await ramp(Hst, 'fist', 0);
  }
  check('turning the fist unscrews it', jopen, r3(J.lid.state.openness));
  if (Hs.holding) { await goto(side, pos(J).add(new V3(side === 'R' ? 0.18 : -0.18, -0.06, 0.1)), 0.03); await ramp(Hst, 'fist', 0); }
  check('opening the fist lets go', !Hs.holding);
  Hst.yaw = 0; Hst.X = side === 'R' ? X0 : -X0; Hst.Y = REST.Y; Hst.Z = REST.Z; other.X = side === 'R' ? -X0 : X0; await sleep(500);

  // 5) reaching well past the end of the counter steps sideways
  const x0 = body.targetX; state.R.X = 0.38; await until(() => body.targetX !== x0, 6000);
  check('reaching far to the side steps that way', body.targetX > x0, [x0, body.targetX]);
  run = false;
  return JSON.stringify({ pass: Object.values(out).every(o => o.ok), out, errors: window.__errors || null });
})()
