// Webcam head tracking with synthetic face poses: MediaPipe-style facial transformation matrices (column-major 4x4,
// camera at the origin looking down -z, x to the right of the unmirrored picture, y up, cm), plus synthetic hands
// for the counter mapping. Run at ?input=webcam&webcammap=counter&fakecam=1&calib=off.
(async () => {
  const S = window.__sandwich, THREE = await import('three'), { POSE } = await import('/src/interact/hand.js');
  const raf = () => new Promise(r => requestAnimationFrame(r)), ms = () => performance.now();
  const sleep = async t => { const t0 = ms(); while (ms() - t0 < t) await raf(); };
  const until = async (f, t = 20000) => { const t0 = ms(); while (!f()) { if (ms() - t0 > t) return false; await raf(); } return true; };
  const out = {}, check = (name, ok, info) => { out[name] = { ok: !!ok, ...(info !== undefined ? { info } : {}) }; };
  const r3 = x => (x == null ? x : +(+x).toFixed(3));
  // the participant's head: yaw > 0 turned to their left, pitch > 0 looking up; x > 0 moved to their left (cm)
  const head = { yaw: 0, pitch: 0, x: 0, y: 0, z: -55, on: true };
  const M = new THREE.Matrix4(), E = new THREE.Euler();
  const faceResult = () => {
    if (!head.on) return { faceLandmarks: [], facialTransformationMatrixes: [] };
    // unmirrored picture: the participant's left is the picture's right (+x)
    M.makeRotationFromEuler(E.set(-head.pitch, head.yaw, 0, 'YXZ')).setPosition(head.x, head.y, head.z);
    return { faceLandmarks: [[]], facialTransformationMatrixes: [{ rows: 4, columns: 4, data: Array.from(M.elements) }] };
  };
  // hands at rest, palm down (as in the counter test)
  const F = 1.2, ASP = 1280 / 720;
  const synth = (side, X) => { const m = side === 'R' ? -1 : 1;
    const wl = POSE.OPEN.map(a => ({ x: -a[0] * m, y: -a[2], z: -a[1] }));
    const pc = [0, 5, 17].reduce((q, i) => ({ x: q.x + wl[i].x / 3, y: q.y + wl[i].y / 3, z: q.z + wl[i].z / 3 }), { x: 0, y: 0, z: 0 });
    const lm = wl.map(p => { const W = { x: -X + p.x - pc.x, y: 0.06 + p.y - pc.y, z: 0.55 + p.z - pc.z }; return { x: 0.5 + F * W.x / (W.z * ASP), y: 0.5 + F * W.y / W.z, z: 0 }; });
    return { lm, wl, label: side === 'R' ? 'Left' : 'Right' }; };
  let run = true;
  (function pump() { if (!run) return; const hs = [synth('L', -0.13), synth('R', 0.13)];
    window.__fakeHands({ landmarks: hs.map(h => h.lm), worldLandmarks: hs.map(h => h.wl), handednesses: hs.map(h => [{ categoryName: h.label }]) });
    window.__fakeFace(faceResult()); requestAnimationFrame(pump); })();
  const ev = t => S.logger.events.filter(e => e.type === t);
  const view = () => { const e = new THREE.Euler().setFromQuaternion(S.camera.quaternion, 'YXZ'); return { yaw: e.y, pitch: e.x, x: S.camera.position.x, z: S.camera.position.z }; };
  // wait until the view stops moving
  const settle = async () => { let a = view(); for (let n = 0; n < 40; n++) { await sleep(150); const b = view(); if (Math.abs(b.yaw - a.yaw) + Math.abs(b.pitch - a.pitch) + Math.abs(b.x - a.x) + Math.abs(b.z - a.z) < 0.002) return; a = b; } };
  const ramp = async (key, to, t = 300) => { const from = head[key], a = ms(); for (;;) { const u = Math.min(1, (ms() - a) / t); head[key] = from + (to - from) * u; if (u >= 1) break; await raf(); } await sleep(200); await settle(); };

  check('head tracking is on with webcam hands', !!S.headTracker || !!S.body.head, S.cfg.head);
  await until(() => S.logger?.recording, 30000);
  check('straight ahead is taken from the first second of looking', await until(() => ev('head_neutral').length > 0, 6000), ev('head_neutral')[0]);
  await sleep(400);
  const base = view(), P0 = S.webcamHands.st[1].P.clone();
  check('looking at the screen: the view is the body\'s own', Math.abs(base.yaw) < 0.01 && Math.abs(base.pitch - S.body.pitch) < 0.01, [r3(base.yaw), r3(base.pitch)]);
  await ramp('yaw', 0.02);
  check('small head movements inside the dead zone leave the view still', Math.abs(view().yaw) < 0.01, r3(view().yaw));
  await ramp('yaw', 0.2);
  const v1 = view(), fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(S.camera.quaternion);
  check('turning the head 11° to the left turns the view left by more (about 25°)', v1.yaw > 0.36 && v1.yaw < 0.5 && fwd.x < -0.3, [r3(v1.yaw * 57.3) + '°', r3(fwd.x)]);
  check('the hands stay where they are over the counter', S.webcamHands.st[1].P.distanceTo(P0) < 0.005, S.webcamHands.st[1].P.toArray().map(r3));
  await ramp('yaw', 0.5);
  check('a 29° turn looks round to the side (about 90°)', view().yaw > 1.4 && view().yaw <= 2.0, r3(view().yaw * 57.3) + '°');
  await ramp('yaw', -0.35);
  check('turning right looks right', view().yaw < -0.6, r3(view().yaw * 57.3) + '°');
  await ramp('yaw', 0); await ramp('pitch', 0.15);
  check('tilting the head up looks up', view().pitch - S.body.pitch > 0.18 && Math.abs(view().yaw) < 0.01, r3((view().pitch - S.body.pitch) * 57.3) + '°');
  await ramp('pitch', -0.2);
  check('tilting it down looks down', view().pitch - S.body.pitch < -0.25, r3((view().pitch - S.body.pitch) * 57.3) + '°');
  await ramp('pitch', 0); await ramp('x', 5);
  check('leaning 5 cm to the left moves the viewpoint 5 cm left', Math.abs(view().x - (S.body.x - 0.05)) < 0.008, r3(view().x - S.body.x));
  await ramp('x', 0); await ramp('z', -45);
  check('leaning in moves the viewpoint forward', S.body.z - view().z > 0.08, r3(S.body.z - view().z));
  await ramp('z', -55);
  // lost face: eases back
  await ramp('yaw', 0.4); head.on = false; const lt = []; for (let n = 0; n < 6; n++) { await sleep(150); lt.push([r3(S.headTracker.lost), r3(view().yaw)]); } await settle();      /* past the 0.5 s hold */
  check('when the face is lost the view eases back to straight ahead', Math.abs(view().yaw) < 0.05, [r3(view().yaw), lt]);
  head.on = true; await sleep(300); await settle();
  check('and follows again when it is found', view().yaw > 1.0, r3(view().yaw));
  // recentre: hold the head turned, press R
  await ramp('yaw', 0.15); dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' })); await until(() => ev('head_neutral').length === 2, 8000); await sleep(200); await settle();
  check('R makes the current head position straight ahead', Math.abs(view().yaw) < 0.02 && ev('head_neutral').length === 2, r3(view().yaw));
  await ramp('yaw', 0.15 + 0.3);
  check('and turning from there works as before', view().yaw > 0.6, r3(view().yaw));
  // H: off and on
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH' })); await sleep(300); await settle();
  check('H turns head tracking off: the view returns and stays still', Math.abs(view().yaw) < 0.05 && ev('head_tracking').at(-1)?.on === false, r3(view().yaw));
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH' })); await sleep(300); await settle();
  check('and on again', view().yaw > 0.6, r3(view().yaw));
  const Fm = S.logger.frames;
  check('the view offsets are logged with every frame, and the camera pose with them', Fm.headtrack && Fm.headtrack.length === 5 * Fm.t.length && Fm.head.length === 7 * Fm.t.length, [Fm.headtrack?.length / 5, Fm.t.length]);
  run = false;
  return JSON.stringify({ pass: Object.values(out).every(o => o.ok), out, errors: window.__errors || null });
})()
