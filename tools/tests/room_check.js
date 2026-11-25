// The room around the kitchen: is it closed in every direction, is each thing where a look in its direction should
// find it, and does sunlight come in through the windows only. Run at ?input=mouse (room=full, the default).
(async () => {
  const S = window.__sandwich, THREE = await import('three');
  const out = {}, check = (name, ok, info) => { out[name] = { ok: !!ok, ...(info !== undefined ? { info } : {}) }; };
  const raf = () => new Promise(r => requestAnimationFrame(r)); for (let i = 0; i < 4; i++) await raf();
  S.scene.updateMatrixWorld(true);
  const V = (x, y, z) => new THREE.Vector3(x, y, z), rc = new THREE.Raycaster();
  const meshes = []; S.scene.traverse(o => { if (o.isMesh && o.visible && !o.isSkinnedMesh) meshes.push(o); });
  const eye = V(0, 1.6, 0.5);

  const m = S.logger.meta, room = S.logger.layout.room || [];
  check('the log says which room was shown and lists what is in it', m.room === 'full' && room.length >= 40, [m.room, room.length]);

  // 1. closed: from the middle of the room and from the participant's eye, every direction ends on a surface
  const far = (from, n) => { let miss = 0, worst = 0; const dirs = [];
    for (let i = 0; i < n; i++) { const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963; const d = V(Math.cos(a) * r, y, Math.sin(a) * r);
      rc.set(from, d); rc.far = 30; const h = rc.intersectObjects(meshes, false)[0]; if (!h) { miss++; dirs.push(d.toArray().map(v => +v.toFixed(2))); } else worst = Math.max(worst, h.distance); }
    return { miss, worst: +worst.toFixed(2), dirs: dirs.slice(0, 4) }; };
  const c1 = far(V(-0.3, 1.4, 1.4), 1500), c2 = far(eye, 1500);
  check('from the middle of the room, nothing is open to the void', c1.miss === 0, c1);
  check('nor from where the participant stands', c2.miss === 0, c2);

  // 2. what you find when you look
  const look = (to, names) => { rc.set(eye, to.clone().sub(eye).normalize()); rc.far = 30; const h = rc.intersectObjects(S.world.aoiMeshes, false)[0]; const a = h ? S.world.aoiOf(h.object) : null; return [names.includes(a), a]; };
  for (const [what, to, names] of [
    ['behind you, the door and the hall beyond it', V(0.2, 1.2, 3.07), ['door', 'hall']],
    ['the dresser to the rear left', V(-1.55, 0.5, 2.6), ['dresser']],
    ['the plates on its rack', V(-1.55, 1.75, 2.9), ['dresser']],
    ['the breakfast table to the right', V(1.2, 0.72, 1.3), ['table']],
    ['a chair at it', V(1.32, 0.42, 1.0), ['chair']],
    ['the side window', V(1.75, 1.3, 1.75), ['window_side']],
    ['the pendant over the table', V(1.35, 1.8, 1.75), ['pendant']],
    ['the print on the right wall', V(1.71, 1.56, 0.62), ['picture']],
    ['the radiator', V(1.23, 0.4, 2.93), ['radiator', 'chair']],
    ['the apron and towel on the peg rail', V(-2.68, 1.2, 1.2), ['apron', 'tea_towel', 'peg_rail']],
    ['the ceiling', V(-0.5, 2.6, 1.5), ['ceiling']],
  ]) { const [ok, a] = look(to, names); check('looking round finds ' + what, ok, a); }

  // 3. sunlight: only through the windows
  let sun, beam; S.scene.traverse(o => { if (o.isDirectionalLight) sun = o; if (o.isSpotLight && o.decay === 0) beam = o; });
  const toSun = sun.position.clone().sub(sun.target.position).normalize();
  const shaded = p => { rc.set(p, toSun); rc.far = 30; return rc.intersectObjects(meshes, false).some(h => h.object.castShadow); };
  const dark = [['the floor by the dresser', V(-1.6, 0.02, 2.0)], ['the hall floor', V(0, 0.02, 4.4)], ['the left wall', V(-2.7, 1.5, 1.5)], ['the rear wall above the door', V(0.2, 2.3, 2.98)]].filter(([, p]) => !shaded(p)).map(([n]) => n);
  check('no sunlight where a wall or the ceiling is in the way', dark.length === 0, dark);
  check('sunlight reaches the breakfast table through the side window', !shaded(V(1.35, 0.83, 2.0)));
  check('a beam along the sun lights that window only, with its shadows drawn once', beam && beam.castShadow && beam.shadow.autoUpdate === false && beam.angle < 0.25, beam && [+beam.angle.toFixed(2), beam.shadow.autoUpdate]);
  const fitted = (() => { const c = sun.shadow.camera, inv = c.matrixWorldInverse; return [V(-2.72, 0, -0.62), V(1.72, 0, 3), V(-0.7, 0, 5.2), V(1.72, 2.6, -0.62)].every(p => { const q = p.clone().applyMatrix4(inv); return q.x >= c.left && q.x <= c.right && q.y >= c.bottom && q.y <= c.top && -q.z >= c.near && -q.z <= c.far; }); })();
  check('the sun\'s shadow covers the whole room and the hall', fitted);

  return JSON.stringify({ pass: Object.values(out).every(o => o.ok), out, errors: window.__errors || null });
})()
