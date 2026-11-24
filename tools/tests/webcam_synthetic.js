// Drives the webcam control path with synthetic MediaPipe results (no camera).
// Run in the page (see tools/test_controls.py) at ?input=webcam&fakecam=1.
(async () => {
  const S = window.__sandwich, { POSE } = await import('/src/interact/hand.js');
  // all waits are in simulation time (world.t), so the test is independent of the frame rate
  const raf = () => new Promise(r => requestAnimationFrame(r));
  const now = () => S.world.t * 1000;
  const sleep = async ms => { const t0 = now(); while (now() - t0 < ms) await raf(); };
  while (!S.logger?.recording) await raf();
  const V3 = S.camera.position.constructor, T = S.L.task, cam = S.camera, BOX = { u0: 0.12, u1: 0.88, v0: 0.14, v1: 0.9 }, aspect = 1280 / 720;
  const pos = e => e.root.getWorldPosition(new V3());
  // one synthetic hand: palm facing the camera, fingers up; `aim` world point, k = image scale, pinch 0..1, phi = in-plane rotation
  const state = { L: { aim: new V3(-0.45, 0.93, -0.12), k: 1.6, pinch: 0, phi: 0, on: true }, R: { aim: new V3(0.45, 0.93, -0.12), k: 1.6, pinch: 0, phi: 0, roll: 0, on: true } };
  function synth(side, st) {
    const ndc = st.aim.clone().project(cam), sx = (ndc.x + 1) / 2, sy = (1 - ndc.y) / 2;
    const u = BOX.u0 + sx * (BOX.u1 - BOX.u0), v = BOX.v0 + sy * (BOX.v1 - BOX.v0), cx = 1 - u, cy = v;
    const m = side === 'R' ? -1 : 1, c = Math.cos(st.phi), s = Math.sin(st.phi);
    const wl = POSE.OPEN.map((a, i) => { const b = POSE.PINCH[i], x = (a[0] + (b[0] - a[0]) * st.pinch) * m, y = a[1] + (b[1] - a[1]) * st.pinch, z = a[2] + (b[2] - a[2]) * st.pinch;
      const cr = Math.cos(st.roll || 0), sr = Math.sin(st.roll || 0), xr = -x * cr + z * sr, yc = -y, zc = x * sr + z * cr;   // roll = turning the hand over (about the fingers)
      return { x: xr * c - yc * s, y: xr * s + yc * c, z: zc }; });
    const pc = [0, 5, 17].reduce((p, i) => ({ x: p.x + wl[i].x / 3, y: p.y + wl[i].y / 3 }), { x: 0, y: 0 });
    const lm = wl.map(p => ({ x: cx + st.k * (p.x - pc.x) / aspect, y: cy + st.k * (p.y - pc.y), z: 0 }));
    // MediaPipe labels as if the image were mirrored: the user's right hand is reported as "Left"
    return { lm, wl, label: side === 'R' ? 'Left' : 'Right' };
  }
  let run = true;
  (function pump() { if (!run) return; const hs = ['L', 'R'].filter(s => state[s].on).map(s => synth(s, state[s]));
    window.__fakeHands({ landmarks: hs.map(h => h.lm), worldLandmarks: hs.map(h => h.wl), handednesses: hs.map(h => [{ categoryName: h.label }]) }); requestAnimationFrame(pump); })();
  const move = async (side, to, ms = 700) => { const st = state[side], from = st.aim.clone(), t0 = now(); for (;;) { const u = Math.min(1, (now() - t0) / ms); st.aim.lerpVectors(from, to, u * u * (3 - 2 * u)); if (u >= 1) break; await raf(); } await sleep(350); };
  const ramp = async (obj, key, to, ms = 350) => { const from = obj[key], t0 = now(); for (;;) { const u = Math.min(1, (now() - t0) / ms); obj[key] = from + (to - from) * u; if (u >= 1) break; await raf(); } await sleep(250); };
  const ev = type => S.logger.events.filter(e => e.type === type);
  const dbg = {}; const R = S.hands[1], Lh = S.hands[0], out = {}, check = (name, ok, extra) => { out[name] = { ok: !!ok, ...(extra !== undefined ? { info: extra } : {}) }; };

  await sleep(600);
  check('both hands tracked, correct sides', R.tracked && Lh.tracked && R.grip.x > Lh.grip.x, [Lh.grip.x.toFixed(2), R.grip.x.toFixed(2)]);
  const back = new V3(0, 0, 1).applyQuaternion(R.quat), thumbR = R.joints[4].x - R.joints[17].x, thumbL = Lh.joints[4].x - Lh.joints[17].x;
  check('palm down, thumbs point inward', back.y > 0.7 && thumbR < 0 && thumbL > 0, [back.y.toFixed(2), thumbR.toFixed(3), thumbL.toFixed(3)]);
  check('fingers point away from the body', R.joints[12].z < R.joints[0].z - 0.05);

  // 1) clip off the bag
  await move('R', pos(T.bag.clip));
  check('hover finds the clip', R.hover?.id === 'bread_clip', R.hover?.id);
  await ramp(state.R, 'pinch', 1);
  check('pinch grabs the clip and opens the bag', R.holding?.id === 'bread_clip' && ev('bag_open').length === 1, R.holding?.id);
  const liftH = R.grip.y - 0.91;
  await move('R', new V3(0.42, 0.91, -0.1));
  await ramp(state.R, 'pinch', 0);
  check('release sets it down', !R.holding && ev('release').length === 1);

  // 2) a slice from the bag to the plate, lowered by pushing toward the camera
  const top = T.bag.state.slices.reduce((a, b) => (b.state.index > a.state.index ? b : a));
  await move('R', pos(top).add(new V3(0, 0.068, 0)));   // top of the loaf at the open end
  await ramp(state.R, 'pinch', 1);
  const sl = R.holding;
  check('pinch on the open end takes a slice', sl?.kind === 'slice' && ev('slice_out').length === 1, sl?.id);
  await move('R', pos(T.plate).add(new V3(0, 0.02, 0)), 900);
  const yCarry = sl.root.getWorldPosition(new V3()).y;
  await ramp(state.R, 'k', 1.6 * 1.22, 500);
  const yPress = sl.root.getWorldPosition(new V3()).y;
  const sb = S.world.supportBelow(sl.root.getWorldPosition(new V3()).add(new V3(0, 0.12, 0)), sl, 1.5); dbg.pressSupport = [sb?.owner?.id || sb?.fixture, sb?.y, pos(T.plate).toArray(), sl.root.getWorldPosition(new V3()).toArray(), S.webcamHands.st[1].lift];
  check('carried above the plate, lowered by pushing toward the camera', yCarry - yPress > 0.04 && R.press, [yCarry.toFixed(3), yPress.toFixed(3)]);
  await ramp(state.R, 'k', 1.6, 300);
  const up0 = new V3(0, 1, 0).applyQuaternion(sl.root.getWorldQuaternion(R.quat.clone())).y;
  await ramp(state.R, 'roll', Math.PI * 0.85, 700); await sleep(400);
  const up1 = new V3(0, 1, 0).applyQuaternion(sl.root.getWorldQuaternion(R.quat.clone())).y;
  check('turning the hand over flips the slice', up0 * up1 < -0.5 && ev('flip').length === 1, [up0.toFixed(2), up1.toFixed(2)]);
  await ramp(state.R, 'roll', 0, 500); await sleep(300);
  await ramp(state.R, 'k', 1.6 * 1.22, 400);
  await ramp(state.R, 'pinch', 0); await ramp(state.R, 'k', 1.6, 300); await sleep(500);
  check('slice ends on the plate', sl.restingOn === 'plate' && S.monitor.done.slice_a !== undefined, sl.restingOn);

  // 3) brief dropout keeps the grasp; long dropout lets go
  await move('L', pos(T.towel).add(new V3(0, 0.02, 0)));
  await ramp(state.L, 'pinch', 1);
  const heldL = Lh.holding?.id;
  state.L.on = false; await sleep(300); const kept = Lh.holding?.id; state.L.on = true; await sleep(300);
  check('250 ms tracking dropout keeps the grasp', heldL === 'towel' && kept === 'towel' && Lh.holding?.id === 'towel', [heldL, kept]);
  state.L.on = false; await sleep(1100);
  check('long dropout releases', !Lh.holding && !Lh.tracked);
  state.L.pinch = 0; state.L.on = true; await sleep(400);
  check('hand re-acquired as the same hand', Lh.tracked && R.tracked && Math.abs(S.webcamHands.st[0].ndc.x - Math.max(-1, Math.min(1, state.L.aim.clone().project(cam).x))) < 0.06, S.webcamHands.st[0].ndc.x.toFixed(2));

  // 4) unscrew the peanut butter lid by rotating the hand in the image plane (two strokes)
  const lidTop = pos(T.pb).add(new V3(0, T.pb.geom.rimY + 0.005, 0));
  await move('L', lidTop);
  let dir = 1, opened = false;
  for (let stroke = 0; stroke < 4 && !opened; stroke++) {
    state.L.phi = -dir * 0.9; await sleep(250);
    await ramp(state.L, 'pinch', 1);
    if (stroke === 0) { check('pinch on the lid starts a twist', Lh.hold?.mode === 'twist', Lh.hold?.mode); dbg.lid = [Lh.pickHint?.id, Lh.hover?.id, Lh.pinch, Lh.grip.toArray(), lidTop.toArray(), S.webcamHands.st[0].pinchD]; }
    const o0 = T.pb.lid.state.openness || 0;
    await ramp(state.L, 'phi', dir * 0.9, 700);
    const o1 = T.pb.lid.state.openness || 0;
    opened = ev('lid_off').length > 0;
    if (!opened && o1 <= o0 + 0.05 && stroke === 0) dir = -1;      // wrong way: try the other direction
    if (!opened) await ramp(state.L, 'pinch', 0);
  }
  check('lid comes off within four wrist strokes', opened, { direction: dir > 0 ? 'counter-clockwise on screen' : 'clockwise on screen', openness: T.pb.lid.state.openness });
  if (opened) { await move('L', pos(T.pb).add(new V3(-0.16, 0, 0.1))); await ramp(state.L, 'pinch', 0); await sleep(400); check('jar is open, lid set down', T.pb.state.open && !Lh.holding && S.monitor.done.pb_open !== undefined); }

  // 5) edge of the view steps sideways
  const x0 = S.body.targetX; state.R.aim = new V3(3, 1.0, -0.2); await sleep(1800);
  check('holding a hand at the screen edge steps sideways', S.body.targetX > x0, [x0, S.body.targetX]);
  run = false;
  return JSON.stringify({ pass: Object.values(out).every(o => o.ok), out, liftH, errors: window.__errors || null, trace: S.logger.events.filter(e => ['grasp', 'grasp_miss', 'release', 'settled', 'lid_twist', 'lid_off'].includes(e.type)).map(e => [e.t, e.type, e.hand || '', e.obj || e.near || '', e.on || e.constraint || '']), dbg }, null, 1);
})()
