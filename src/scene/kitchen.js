// The kitchen shell: room, counters, cabinets (one working drawer, one working
// cupboard door), sink, cooktop, fridge (working door), shelves, window, lights.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Entity } from '../core/world.js';

export const K = {
  counterY: 0.91, counterFront: 0.0, counterBack: -0.62, xMin: -1.9, xMax: 1.7,
  sink: { x0: 0.80, x1: 1.36, z0: -0.50, z1: -0.11 },
  cooktop: { x0: -1.78, x1: -1.18 },
  drawer: { x0: -0.3, x1: 0.3 },
  shelves: [1.50, 1.86], shelfX: [-0.44, 0.60], shelfDepth: 0.27,
  cupboard: { x0: -1.06, x1: -0.52, y0: 1.45, y1: 2.15, depth: 0.34 },
  fridge: { x0: -2.66, x1: -1.94, h: 1.9, front: 0.08 },
  window: { x0: 0.72, x1: 1.46, y0: 1.15, y1: 2.05 },
  roomZ1: 3.0, roomX0: -2.72, roomX1: 1.72, ceiling: 2.6,
};

// Project UVs in world space (metres) so textures keep a constant physical scale across pieces.
export function worldUV(geo, scale = 1, offset = new THREE.Vector3()) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + offset.x, y = p.getY(i) + offset.y, z = p.getZ(i) + offset.z;
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, x * scale, z * scale);
    else if (ax >= az) uv.setXY(i, z * scale, y * scale);
    else uv.setXY(i, x * scale, y * scale);
  }
  uv.needsUpdate = true; return geo;
}

function box(w, h, d, mat, x, y, z, { uvScale = null, rounded = 0 } = {}) {
  const g = rounded ? new RoundedBoxGeometry(w, h, d, 2, rounded) : new THREE.BoxGeometry(w, h, d);
  if (uvScale) worldUV(g, uvScale, new THREE.Vector3(x, y, z));
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m;
}
const boxSpan = (x0, x1, y0, y1, z0, z1, mat, o) => box(x1 - x0, y1 - y0, z1 - z0, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, o);

// Shaker-style door: recessed centre panel inside a frame of stiles and rails.
export function shaker(x0, x1, y0, y1, z0, z1, mat, rail = 0.058) {
  const g = new THREE.Group(), zp = z1 - 0.007;
  g.add(boxSpan(x0 + rail - 0.002, x1 - rail + 0.002, y0 + rail - 0.002, y1 - rail + 0.002, z0, zp, mat));
  g.add(boxSpan(x0, x0 + rail, y0, y1, z0, z1, mat, { rounded: 0.0025 }), boxSpan(x1 - rail, x1, y0, y1, z0, z1, mat, { rounded: 0.0025 }));
  g.add(boxSpan(x0 + rail, x1 - rail, y0, y0 + rail, z0, z1, mat, { rounded: 0.0025 }), boxSpan(x0 + rail, x1 - rail, y1 - rail, y1, z0, z1, mat, { rounded: 0.0025 }));
  // small bevel strip around the panel so the recess catches light
  return g;
}

function barHandle(M, len = 0.16, vertical = false) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 16), M.brass);
  if (!vertical) bar.rotation.z = Math.PI / 2;
  bar.position.z = 0.03; g.add(bar);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 12), M.brass);
    post.rotation.x = Math.PI / 2; post.position.set(vertical ? 0 : s * len * 0.42, vertical ? s * len * 0.42 : 0, 0.015); g.add(post);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------- articulated parts ----------
class Drawer {
  constructor(entity, group, closedZ, travel) { Object.assign(this, { entity, group, closedZ, travel }); this.value = 0; }
  set(v) { this.value = THREE.MathUtils.clamp(v, 0, 1); this.group.position.z = this.closedZ + this.value * this.travel; }
}
class Door {
  constructor(entity, pivot, sign, maxAngle) { Object.assign(this, { entity, pivot, sign, maxAngle }); this.value = 0; }
  set(v) { this.value = THREE.MathUtils.clamp(v, 0, 1); this.pivot.rotation.y = this.sign * this.value * this.maxAngle; this.onChange?.(this.value); }
}

export function buildKitchen(world, M) {
  const scene = world.scene;
  const room = new THREE.Group(); room.name = 'kitchen'; scene.add(room);
  const fixture = (mesh, aoi, support = false) => { room.add(mesh); world.addFixture(mesh, aoi, { support }); return mesh; };
  const Y = K.counterY;

  // ---- floor, ceiling, walls ----
  const floorGeo = new THREE.PlaneGeometry(K.roomX1 - K.roomX0, K.roomZ1 - K.counterBack);
  floorGeo.rotateX(-Math.PI / 2); floorGeo.translate((K.roomX0 + K.roomX1) / 2, 0, (K.roomZ1 + K.counterBack) / 2);
  worldUV(floorGeo, 0.5);
  const floor = fixture(new THREE.Mesh(floorGeo, M.parquet), 'floor', true);
  floor.receiveShadow = true;
  const ceilGeo = new THREE.PlaneGeometry(K.roomX1 - K.roomX0, K.roomZ1 - K.counterBack);
  ceilGeo.rotateX(Math.PI / 2); ceilGeo.translate((K.roomX0 + K.roomX1) / 2, K.ceiling, (K.roomZ1 + K.counterBack) / 2);
  const ceilMesh = new THREE.Mesh(ceilGeo, M.ceiling); ceilMesh.castShadow = true; fixture(ceilMesh, 'ceiling');

  // back wall with window opening
  const W = K.window;
  const wallShape = new THREE.Shape([new THREE.Vector2(K.roomX0, 0), new THREE.Vector2(K.roomX1, 0), new THREE.Vector2(K.roomX1, K.ceiling), new THREE.Vector2(K.roomX0, K.ceiling)]);
  wallShape.holes.push(new THREE.Path([new THREE.Vector2(W.x0, W.y0), new THREE.Vector2(W.x1, W.y0), new THREE.Vector2(W.x1, W.y1), new THREE.Vector2(W.x0, W.y1)].reverse()));
  const backGeo = new THREE.ShapeGeometry(wallShape); worldUV(backGeo, 0.7);
  const back = new THREE.Mesh(backGeo, M.plaster); back.position.z = K.counterBack - 0.002; back.castShadow = true;
  fixture(back, 'wall');
  // reveals + sill
  room.add(boxSpan(W.x0 - 0.0, W.x1, W.y0 - 0.03, W.y0, K.counterBack - 0.16, K.counterBack + 0.04, M.windowFrame));
  room.add(boxSpan(W.x0 - 0.01, W.x0, W.y0, W.y1, K.counterBack - 0.16, K.counterBack, M.plaster));
  room.add(boxSpan(W.x1, W.x1 + 0.01, W.y0, W.y1, K.counterBack - 0.16, K.counterBack, M.plaster));
  room.add(boxSpan(W.x0, W.x1, W.y1, W.y1 + 0.01, K.counterBack - 0.16, K.counterBack, M.plaster));
  // frame + mullion + view
  const fz = K.counterBack - 0.11;
  for (const [x0, x1, y0, y1] of [[W.x0, W.x1, W.y0, W.y0 + 0.045], [W.x0, W.x1, W.y1 - 0.045, W.y1], [W.x0, W.x0 + 0.045, W.y0, W.y1], [W.x1 - 0.045, W.x1, W.y0, W.y1], [(W.x0 + W.x1) / 2 - 0.02, (W.x0 + W.x1) / 2 + 0.02, W.y0, W.y1], [W.x0, W.x1, (W.y0 + W.y1) / 2 - 0.015, (W.y0 + W.y1) / 2 + 0.015]])
    room.add(boxSpan(x0, x1, y0, y1, fz - 0.02, fz + 0.02, M.windowFrame));
  const view = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), M.windowView);
  view.position.set((W.x0 + W.x1) / 2, (W.y0 + W.y1) / 2 + 0.1, K.counterBack - 0.9); room.add(view); world.addFixture(view, 'window');
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(W.x1 - W.x0, W.y1 - W.y0), new THREE.MeshPhysicalMaterial({ transmission: 1, roughness: 0.02, thickness: 0.004, color: 0xffffff }));
  pane.position.set((W.x0 + W.x1) / 2, (W.y0 + W.y1) / 2, fz); pane.castShadow = false; room.add(pane); world.addFixture(pane, 'window');

  // side and rear walls
  const sideGeo = new THREE.PlaneGeometry(K.roomZ1 - K.counterBack, K.ceiling);
  const left = new THREE.Mesh(sideGeo, M.plaster); left.rotation.y = Math.PI / 2; left.position.set(K.roomX0, K.ceiling / 2, (K.roomZ1 + K.counterBack) / 2); fixture(left, 'wall');
  const right = new THREE.Mesh(sideGeo, M.plaster); right.rotation.y = -Math.PI / 2; right.position.set(K.roomX1, K.ceiling / 2, (K.roomZ1 + K.counterBack) / 2); fixture(right, 'wall');
  const rear = new THREE.Mesh(new THREE.PlaneGeometry(K.roomX1 - K.roomX0, K.ceiling), M.plaster); rear.rotation.y = Math.PI; rear.position.set((K.roomX0 + K.roomX1) / 2, K.ceiling / 2, K.roomZ1); fixture(rear, 'wall');
  const doorway = boxSpan(-0.2, 0.7, 0, 2.1, K.roomZ1 - 0.02, K.roomZ1, new THREE.MeshStandardMaterial({ color: 0x3b332b, roughness: 0.8 })); fixture(doorway, 'wall');
  // skirting
  room.add(boxSpan(K.roomX0, K.roomX1, 0, 0.09, K.roomZ1 - 0.015, K.roomZ1, M.windowFrame));

  // ---- tile backsplash (wraps under the window) ----
  const bs = new THREE.Shape([[K.xMin, Y], [K.xMax, Y], [K.xMax, 1.45], [W.x1, 1.45], [W.x1, W.y0], [W.x0, W.y0], [W.x0, 1.45], [K.xMin, 1.45]].map(p => new THREE.Vector2(...p)));
  const bsGeo = new THREE.ShapeGeometry(bs); worldUV(bsGeo, 1 / 0.6);
  const splash = new THREE.Mesh(bsGeo, M.tiles); splash.position.z = K.counterBack + 0.004; fixture(splash, 'backsplash');
  // behind the cooktop the tiles run up to the hood
  const bs2 = boxSpan(K.cooktop.x0 - 0.06, K.cooktop.x1 + 0.06, 1.45, 1.95, K.counterBack, K.counterBack + 0.006, M.tiles, { uvScale: 1 / 0.6 }); fixture(bs2, 'backsplash');

  // ---- base cabinets ----
  const zf = -0.02; // cabinet face plane
  room.add(boxSpan(K.xMin, K.xMax, 0, 0.1, K.counterBack, zf - 0.06, M.rubber)); // toe kick
  room.add(boxSpan(K.xMin, K.xMax, 0.1, 0.11, K.counterBack, zf - 0.02, M.cabinetInner)); // floor of carcass
  room.add(boxSpan(K.xMin, K.xMin + 0.018, 0.1, Y - 0.03, K.counterBack, zf, M.cabinet));
  room.add(boxSpan(K.xMax - 0.018, K.xMax, 0.1, Y - 0.03, K.counterBack, zf, M.cabinet));
  const bays = [[K.xMin + 0.018, K.cooktop.x1 + 0.03], [K.cooktop.x1 + 0.03, K.drawer.x0], [K.drawer.x0, K.drawer.x1], [K.drawer.x1, K.sink.x0 - 0.02], [K.sink.x0 - 0.02, K.sink.x1 + 0.02], [K.sink.x1 + 0.02, K.xMax - 0.018]];
  const gap = 0.003, dTop = Y - 0.035, dBot = 0.72, front = (x0, x1, y0, y1) => boxSpan(x0 + gap, x1 - gap, y0 + gap, y1 - gap, zf - 0.019, zf, M.cabinet, { rounded: 0.003 });
  let drawerEntity = null;
  bays.forEach(([x0, x1], i) => {
    if (i !== 2) {
      const df = front(x0, x1, dBot, dTop); fixture(df, 'cabinet');
      const h = barHandle(M, Math.min(0.22, (x1 - x0) * 0.4)); h.position.set((x0 + x1) / 2, (dBot + dTop) / 2, zf); room.add(h);
    }
    const nDoors = (x1 - x0) > 0.62 ? 2 : 1;
    for (let k = 0; k < nDoors; k++) {
      const a = x0 + (x1 - x0) * k / nDoors, b = x0 + (x1 - x0) * (k + 1) / nDoors;
      fixture(shaker(a + gap, b - gap, 0.11 + gap, dBot - gap, zf - 0.019, zf, M.cabinet), 'cabinet');
      const h = barHandle(M, 0.14, true); h.position.set(nDoors === 2 ? (k === 0 ? b - 0.04 : a + 0.04) : b - 0.04, dBot - 0.1, zf); room.add(h);
    }
  });
  // the working drawer (knife drawer)
  {
    const { x0, x1 } = K.drawer, depth = 0.5, g = new THREE.Group();
    g.name = 'drawer';
    const inner = M.cabinetInner, t = 0.012, h = dTop - dBot - 0.03, bz = -depth;
    g.add(boxSpan(x0 + gap, x1 - gap, dBot + gap, dTop - gap, -0.019, 0, M.cabinet, { rounded: 0.003 }));
    const bottom = boxSpan(x0 + 0.02, x1 - 0.02, dBot + 0.01, dBot + 0.01 + t, bz, -0.02, inner); g.add(bottom);
    g.add(boxSpan(x0 + 0.02, x0 + 0.02 + t, dBot + 0.01, dBot + h, bz, -0.02, inner));
    g.add(boxSpan(x1 - 0.02 - t, x1 - 0.02, dBot + 0.01, dBot + h, bz, -0.02, inner));
    g.add(boxSpan(x0 + 0.02, x1 - 0.02, dBot + 0.01, dBot + h, bz, bz + t, inner));
    g.add(boxSpan(x0 + 0.02, x1 - 0.02, dBot + 0.01, dBot + h, -0.02 - t, -0.02, inner));
    const handle = barHandle(M, 0.2); handle.position.set((x0 + x1) / 2, (dBot + dTop) / 2, 0); g.add(handle);
    g.position.z = zf;
    const ent = new Entity('drawer', g, { kind: 'drawer', role: 'fixture', aoi: 'drawer', settle: 'none' });
    world.add(ent, room);
    const d = new Drawer(ent, g, zf, 0.42);
    ent.constraint = { type: 'prismatic', axis: new THREE.Vector3(0, 0, 1), length: 0.42, joint: d };
    ent.state.open = 0;
    world.addSupport(bottom, ent);
    bottom.userData.supportOwner = ent;
    world.articulated.push(d);
    drawerEntity = ent;
    ent.interiorY = dBot + 0.01 + t;
  }

  // ---- countertop with sink cut-out ----
  const S = K.sink, top0 = Y - 0.03, zb = K.counterBack, zfr = 0.02;
  const slabs = [[K.xMin, S.x0, zb, zfr], [S.x1, K.xMax, zb, zfr], [S.x0, S.x1, S.z1, zfr], [S.x0, S.x1, zb, S.z0]];
  for (const [x0, x1, z0, z1] of slabs) fixture(boxSpan(x0, x1, top0, Y, z0, z1, M.marble, { uvScale: 1.0 }), 'counter', true);
  // sink basin
  const basin = new THREE.Group(), sd = 0.2, sy = Y - sd;
  basin.add(boxSpan(S.x0, S.x1, sy, sy + 0.004, S.z0, S.z1, M.brushed));
  basin.add(boxSpan(S.x0, S.x0 + 0.004, sy, Y - 0.002, S.z0, S.z1, M.brushed));
  basin.add(boxSpan(S.x1 - 0.004, S.x1, sy, Y - 0.002, S.z0, S.z1, M.brushed));
  basin.add(boxSpan(S.x0, S.x1, sy, Y - 0.002, S.z0, S.z0 + 0.004, M.brushed));
  basin.add(boxSpan(S.x0, S.x1, sy, Y - 0.002, S.z1 - 0.004, S.z1, M.brushed));
  const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.003, 32), M.steel); drain.position.set((S.x0 + S.x1) / 2, sy + 0.005, (S.z0 + S.z1) / 2); basin.add(drain);
  fixture(basin, 'sink', true);
  // faucet
  const faucet = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.28, 0), new THREE.Vector3(0, 0.36, 0.06), new THREE.Vector3(0, 0.33, 0.17), new THREE.Vector3(0, 0.27, 0.2)]);
  faucet.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.012, 16), M.steel));
  const fbase = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.04, 32), M.steel); fbase.position.y = 0.02; faucet.add(fbase);
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 12), M.steel); lever.position.set(0.04, 0.09, 0); lever.rotation.z = -1.0; faucet.add(lever);
  faucet.position.set((S.x0 + S.x1) / 2, Y, S.z0 - 0.05);
  fixture(faucet, 'faucet');

  // ---- cooktop + hood ----
  const C = K.cooktop;
  const ctCanvas = document.createElement('canvas'); ctCanvas.width = 512; ctCanvas.height = 384;
  { const g = ctCanvas.getContext('2d'); g.fillStyle = '#060606'; g.fillRect(0, 0, 512, 384); g.strokeStyle = 'rgba(200,200,200,0.35)'; g.lineWidth = 3;
    for (const [x, y, r] of [[140, 120, 85], [370, 120, 70], [140, 290, 70], [370, 280, 90]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x, y, r * 0.55, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = 'rgba(220,220,220,0.5)'; g.font = '18px sans-serif'; g.fillText('–  1  2  3  4  5  6  +', 150, 372); }
  const ctTex = new THREE.CanvasTexture(ctCanvas); ctTex.colorSpace = THREE.SRGBColorSpace;
  const glassMat = M.blackGlass.clone(); glassMat.map = ctTex;
  const ct = new THREE.Mesh(new THREE.BoxGeometry(C.x1 - C.x0, 0.006, 0.5), glassMat); ct.position.set((C.x0 + C.x1) / 2, Y + 0.003, -0.31);
  fixture(ct, 'cooktop', true);
  const hood = new THREE.Group();
  const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.42, 0.28, 4, 1, false, Math.PI / 4), M.brushed); hb.scale.set(1, 1, 0.62); hb.position.y = 0.14; hood.add(hb);
  const chimney = boxSpan(-0.13, 0.13, 0.28, K.ceiling - 1.68, -0.15, 0.1, M.brushed); hood.add(chimney);
  hood.position.set((C.x0 + C.x1) / 2, 1.68, K.counterBack + 0.28); fixture(hood, 'hood');

  // ---- open oak shelves ----
  const shelfMeshes = [];
  for (const y of K.shelves) {
    const s = boxSpan(K.shelfX[0], K.shelfX[1], y - 0.03, y, K.counterBack, K.counterBack + K.shelfDepth, M.oakShelf);
    fixture(s, 'shelf', true); shelfMeshes.push(s);
    for (const x of [K.shelfX[0] + 0.12, K.shelfX[1] - 0.12]) {   // slim brass L-brackets
      room.add(boxSpan(x - 0.009, x + 0.009, y - 0.17, y - 0.03, K.counterBack + 0.004, K.counterBack + 0.010, M.brass));
      room.add(boxSpan(x - 0.009, x + 0.009, y - 0.036, y - 0.03, K.counterBack + 0.004, K.counterBack + K.shelfDepth - 0.03, M.brass));
      const brace = boxSpan(-0.004, 0.004, -0.085, 0.085, -0.003, 0.003, M.brass); brace.position.set(x, y - 0.095, K.counterBack + 0.068); brace.rotation.x = -Math.PI / 4; room.add(brace);
    }
  }
  // under-shelf light strip (warm)
  const strip = new THREE.Mesh(new THREE.BoxGeometry(K.shelfX[1] - K.shelfX[0] - 0.1, 0.004, 0.012), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2b8).multiplyScalar(6) }));
  strip.position.set((K.shelfX[0] + K.shelfX[1]) / 2, K.shelves[0] - 0.032, K.counterBack + 0.2); strip.userData.noAOI = true; room.add(strip);

  // ---- upper cupboard with working door ----
  let cupboardEntity = null;
  {
    const U = K.cupboard, zc = K.counterBack + U.depth, t = 0.018;
    const cab = new THREE.Group();
    cab.add(boxSpan(U.x0, U.x0 + t, U.y0, U.y1, K.counterBack, zc - 0.02, M.cabinet));
    cab.add(boxSpan(U.x1 - t, U.x1, U.y0, U.y1, K.counterBack, zc - 0.02, M.cabinet));
    cab.add(boxSpan(U.x0, U.x1, U.y1 - t, U.y1, K.counterBack, zc - 0.02, M.cabinet));
    const cbottom = boxSpan(U.x0, U.x1, U.y0, U.y0 + t, K.counterBack, zc - 0.02, M.cabinetInner); cab.add(cbottom);
    const cshelf = boxSpan(U.x0 + t, U.x1 - t, 1.80, 1.80 + t, K.counterBack, zc - 0.04, M.cabinetInner); cab.add(cshelf);
    cab.add(boxSpan(U.x0, U.x1, U.y0, U.y1, K.counterBack, K.counterBack + 0.006, M.cabinetInner));
    fixture(cab, 'cupboard');
    world.addSupport(cbottom, null); world.addSupport(cshelf, null);
    const pivot = new THREE.Group(); pivot.position.set(U.x0, 0, zc - 0.02);
    const door = shaker(0.003, U.x1 - U.x0 - 0.003, U.y0 + 0.003, U.y1 - 0.003, 0, 0.019, M.cabinet);
    pivot.add(door);
    const h = barHandle(M, 0.14, true); h.position.set(U.x1 - U.x0 - 0.04, U.y0 + 0.1, 0.019); pivot.add(h);
    const ent = new Entity('cupboard_door', pivot, { kind: 'door', role: 'fixture', aoi: 'cupboard', settle: 'none' });
    world.add(ent, room);
    const d = new Door(ent, pivot, -1, THREE.MathUtils.degToRad(105));
    ent.constraint = { type: 'hinge', pivot: pivot.position.clone(), radius: U.x1 - U.x0 - 0.04, sign: -1, maxAngle: d.maxAngle, joint: d };
    world.articulated.push(d); cupboardEntity = ent;
    ent.interior = { y: U.y0 + t, x0: U.x0 + 0.03, x1: U.x1 - 0.03, z0: K.counterBack + 0.04, z1: zc - 0.06 };
  }

  // ---- fridge ----
  let fridgeEntity = null, fridgeLight;
  {
    const F = K.fridge, zb2 = K.counterBack, zf2 = F.front, t = 0.03;
    const shell = new THREE.Group();
    shell.add(boxSpan(F.x0, F.x0 + t, 0, F.h, zb2, zf2, M.fridge));
    shell.add(boxSpan(F.x1 - t, F.x1, 0, F.h, zb2, zf2, M.fridge));
    shell.add(boxSpan(F.x0, F.x1, F.h - t, F.h, zb2, zf2, M.fridge));
    shell.add(boxSpan(F.x0, F.x1, 0, 0.06, zb2, zf2, M.fridge));
    shell.add(boxSpan(F.x0, F.x1, 0, F.h, zb2, zb2 + t, M.fridgeInner));
    const inner = new THREE.Mesh(new THREE.BoxGeometry(F.x1 - F.x0 - 2 * t - 0.002, F.h - 0.06 - t, zf2 - zb2 - t), M.fridgeInner.clone());
    inner.material.side = THREE.BackSide; inner.position.set((F.x0 + F.x1) / 2, (F.h + 0.06 - t) / 2, (zb2 + t + zf2) / 2); shell.add(inner);
    fixture(shell, 'fridge');
    const fshelves = [];
    for (const y of [0.55, 0.9, 1.22]) {
      const s = boxSpan(F.x0 + t, F.x1 - t, y, y + 0.008, zb2 + t, zf2 - 0.05, M.glassShelf); fixture(s, 'fridge', true); fshelves.push(s);
    }
    const drawerF = boxSpan(F.x0 + t + 0.01, F.x1 - t - 0.01, 0.08, 0.3, zb2 + t + 0.02, zf2 - 0.04, new THREE.MeshPhysicalMaterial({ color: 0xeef4f6, transmission: 0.6, roughness: 0.2, thickness: 0.01 })); fixture(drawerF, 'fridge');
    fridgeLight = new THREE.PointLight(0xf2f6ff, 0, 1.4, 2); fridgeLight.position.set((F.x0 + F.x1) / 2, F.h - 0.15, -0.2); room.add(fridgeLight);
    const pivot = new THREE.Group(); pivot.position.set(F.x0, 0, zf2);
    const doorMesh = boxSpan(0.002, F.x1 - F.x0 - 0.002, 0.02, F.h - 0.005, 0, 0.065, M.fridge, { rounded: 0.012 }); pivot.add(doorMesh);
    const gasket = boxSpan(0.02, F.x1 - F.x0 - 0.02, 0.05, F.h - 0.03, -0.004, 0.0, new THREE.MeshStandardMaterial({ color: 0xdadada, roughness: 0.9 })); pivot.add(gasket);
    // door bins
    const binMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.7, roughness: 0.15, thickness: 0.005 });
    for (const y of [0.45, 0.85, 1.25]) pivot.add(boxSpan(0.06, F.x1 - F.x0 - 0.06, y, y + 0.07, -0.11, -0.005, binMat));
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.6, 20), M.brushed);
    handle.position.set(F.x1 - F.x0 - 0.05, 1.15, 0.11); pivot.add(handle);
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 12), M.brushed); p.rotation.x = Math.PI / 2; p.position.set(F.x1 - F.x0 - 0.05, 1.15 + s * 0.26, 0.085); pivot.add(p); }
    const ent = new Entity('fridge_door', pivot, { kind: 'door', role: 'fixture', aoi: 'fridge', settle: 'none' });
    world.add(ent, room);
    const d = new Door(ent, pivot, -1, THREE.MathUtils.degToRad(110));
    d.onChange = v => { fridgeLight.intensity = v > 0.05 ? 1.2 : 0; };
    ent.constraint = { type: 'hinge', pivot: pivot.position.clone(), radius: F.x1 - F.x0 - 0.05, sign: -1, maxAngle: d.maxAngle, joint: d };
    world.articulated.push(d); fridgeEntity = ent;
    ent.shelves = [0.55 + 0.008, 0.9 + 0.008, 1.22 + 0.008];
    ent.interior = { x0: F.x0 + 0.08, x1: F.x1 - 0.08, z0: zb2 + 0.08, z1: zf2 - 0.1 };
  }

  // ---- lights ----
  const lights = new THREE.Group(); scene.add(lights);
  // Sun: enters only through the window (walls and ceiling cast shadows) and lays a patch of light across the counter.
  const sun = new THREE.DirectionalLight(0xfff0d8, 4.2);
  sun.position.set(3.05, 4.36, -2.3); sun.target.position.set(0.6, Y, -0.3);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -2.4, right: 2.4, top: 2.4, bottom: -2.4, near: 0.5, far: 10 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.015; sun.shadow.radius = 3;
  lights.add(sun, sun.target);
  const spots = [];
  for (const x of [-1.0, 0.0, 1.0]) {
    const s = new THREE.SpotLight(0xffeccf, 13, 4.2, 0.78, 0.7, 2);
    s.position.set(x, K.ceiling - 0.02, -0.05); s.target.position.set(x, 0, -0.32);
    s.castShadow = true; s.shadow.mapSize.set(1024, 1024); s.shadow.bias = -0.0004; s.shadow.normalBias = 0.01; s.shadow.radius = 5; s.shadow.camera.near = 0.3; s.shadow.camera.far = 4.5;
    lights.add(s, s.target); spots.push(s);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff7e8).multiplyScalar(10) }));
    can.position.set(x, K.ceiling - 0.004, -0.05); can.userData.noAOI = true; room.add(can);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 8, 32), M.windowFrame); trim.rotation.x = Math.PI / 2; trim.position.copy(can.position); trim.userData.noAOI = true; room.add(trim);
  }
  const fill = new THREE.HemisphereLight(0xfbf7f0, 0x9a8a76, 0.55); lights.add(fill);   // bounce light: keeps the upper walls from going muddy
  const underShelf = new THREE.PointLight(0xffd9a8, 0.9, 1.6, 2); underShelf.position.set(0.08, K.shelves[0] - 0.06, K.counterBack + 0.18); lights.add(underShelf);

  return { room, lights: { sun, spots, fill }, drawer: drawerEntity, cupboard: cupboardEntity, fridge: fridgeEntity, shelfMeshes };
}
