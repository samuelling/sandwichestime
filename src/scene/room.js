// The rest of the room: everything except the counter wall (kitchen.js). The participant can turn round with head
// tracking or a headset, so the room is finished on all sides:
//   right wall   a second window with a breakfast table in the sun, a picture
//   rear wall    a panelled door standing open on a hall, a dresser, a radiator, a picture
//   left wall    a peg rail with an apron and a tea towel, a stool, a broom, a floor plant
//   all round    cornice, skirting, switch and sockets, blinds, pendant and hall lights
// Modelled parts (door, windows, trim, radiator, dresser, cloth) come from the Blender-built room kit
// (tools/blender/build_room_kit.py -> assets/models/room_kit); furniture and plants are Poly Haven scans.
// Nothing here is part of the task or within reach; every piece is a labelled gaze target (AOI).
// `detail`: 'full' (furnished) or 'plain' (the same architecture and lighting, no furniture or decoration).
import * as THREE from 'three';
import { K, worldUV } from './kitchen.js';
import { loadModel, loadPath } from './layout.js';

export const R = {      // keep in step with tools/blender/build_room_kit.py
  door: { cx: 0.2, w: 0.9, h: 2.1, wall: 0.14, open: THREE.MathUtils.degToRad(78) },
  hall: { x0: -0.7, x1: 0.75, z1: 5.2, ceil: 2.4 },
  win: { z: 1.75, w: 1.0, y0: 0.95, h: 1.2, reveal: 0.16 },
  table: { x: 1.35, z: 1.75 },
  dresser: { x: -1.55 },
};
const KIT = 'assets/models/room_kit/room_kit.gltf';

// ---- small builders: geometry is made in world coordinates so plaster and parquet keep one texture scale everywhere ----
function sheet(shape, matrix, mat, uv = 0.7) {
  const g = new THREE.ShapeGeometry(shape); g.applyMatrix4(matrix); worldUV(g, uv);
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m;
}
function quad(pts, mat, uv = 0.7) {      // four corners, anticlockwise seen from the front
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(8).fill(0), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); worldUV(g, uv);
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m;
}
function slab(x0, x1, y0, y1, z0, z1, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.castShadow = m.receiveShadow = true; return m;
}
const poly = pts => new THREE.Shape(pts.map(p => new THREE.Vector2(...p)));

function stripeTexture() {      // tea towel: off-white with a band of red stripes near each end
  const c = document.createElement('canvas'); c.width = 64; c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#ece7dc'; g.fillRect(0, 0, 64, 512);
  g.fillStyle = '#b3372f'; for (const [y, h] of [[58, 5], [68, 22], [95, 5], [104, 3]]) g.fillRect(0, 512 - y - h, 64, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

function botanicalPrint() {      // the print in the tall frame: a lemon branch, drawn here (the scan ships with a placeholder card)
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d');
  g.scale(1024 / 724, 1);                                            // the sheet is 724 x 1024 units, stretched over the square texture
  g.fillStyle = '#f4f0e6'; g.fillRect(0, 0, 724, 1024);
  g.fillStyle = '#e7dfc9'; g.fillRect(96, 112, 532, 760); g.strokeStyle = 'rgba(70,66,50,0.4)'; g.lineWidth = 1.5; g.strokeRect(96, 112, 532, 760);
  let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const bez = (p, t) => [0, 1].map(i => (1 - t) ** 3 * p[0][i] + 3 * (1 - t) ** 2 * t * p[1][i] + 3 * (1 - t) * t * t * p[2][i] + t ** 3 * p[3][i]);
  const tan = (p, t) => { const a = bez(p, Math.max(0, t - 0.01)), b = bez(p, Math.min(1, t + 0.01)); return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  const stem = (p, w) => { g.strokeStyle = '#4e4a2c'; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(...p[0]); g.bezierCurveTo(...p[1], ...p[2], ...p[3]); g.stroke(); };
  const leaf = (x, y, a, len) => {
    g.save(); g.translate(x, y); g.rotate(a);
    g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(len * 0.3, -len * 0.3, len * 0.75, -len * 0.2, len, 0); g.bezierCurveTo(len * 0.75, len * 0.2, len * 0.3, len * 0.3, 0, 0);
    g.fillStyle = ['#587046', '#66804f', '#4d653d'][Math.floor(rnd() * 3)]; g.fill();
    g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(len * 0.3, -len * 0.3, len * 0.75, -len * 0.2, len, 0); g.lineTo(0, 0); g.fillStyle = 'rgba(255,255,235,0.13)'; g.fill();
    g.strokeStyle = 'rgba(48,60,36,0.6)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.93, 0); g.stroke(); g.restore();
  };
  const lemon = (x, y, a, r) => {
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = '#d9a21f'; g.beginPath(); g.ellipse(0, 0, r * 1.3, r, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(r * 1.27, 0, r * 0.24, r * 0.17, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(170,122,26,0.38)'; g.beginPath(); g.ellipse(r * 0.12, r * 0.48, r * 0.95, r * 0.34, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(250,230,150,0.75)'; g.beginPath(); g.ellipse(-r * 0.28, -r * 0.34, r * 0.62, r * 0.27, -0.25, 0, 7); g.fill(); g.restore();
  };
  const main = [[236, 846], [336, 640], [286, 420], [486, 196]];
  const twigs = [[bez(main, 0.3), [372, 640], [420, 600], [436, 560]], [bez(main, 0.55), [262, 480], [226, 470], [206, 430]], [bez(main, 0.8), [470, 330], [520, 330], [548, 372]]];
  stem(main, 7); for (const t of twigs) stem(t, 4);
  for (let i = 0; i < 11; i++) { const t = 0.1 + i * 0.085, [x, y] = bez(main, t), side = i % 2 ? 1 : -1; leaf(x, y, tan(main, t) + side * (0.75 + rnd() * 0.5), 96 + rnd() * 56); }
  lemon(444, 614, 1.2, 46); lemon(196, 480, 1.9, 42); lemon(556, 424, 1.45, 38);
  for (const [i, t] of twigs.entries()) { const [x, y] = bez(t, 0.75); leaf(x, y, tan(t, 0.75) + (i % 2 ? 1 : -1) * 0.9, 84); leaf(...bez(t, 0.4), tan(t, 0.4) - (i % 2 ? 1 : -1) * 1.0, 70); }
  leaf(486, 196, tan(main, 1) - 0.25, 120); leaf(486, 196, tan(main, 1) + 0.7, 90);
  g.fillStyle = 'rgba(60,56,44,0.85)'; g.font = 'italic 24px Georgia, "Times New Roman", serif'; g.textAlign = 'center'; g.fillText('Citrus limon', 362, 934);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 8; return t;
}

function kitMaterials(M) {
  const cloth = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, normalMap: M.linen.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), side: THREE.DoubleSide, shadowSide: THREE.DoubleSide, ...extra });
  const apron = M.linen.clone(); apron.side = THREE.DoubleSide; apron.shadowSide = THREE.DoubleSide; apron.color.set(0x8fa0b4);
  return {
    paint_white: new THREE.MeshPhysicalMaterial({ color: 0xf2efe8, roughness: 0.42, clearcoat: 0.2, clearcoatRoughness: 0.5 }),
    paint_sage: M.cabinet, oak: M.oak, brass: M.brass, chrome: M.steel,
    glass: new THREE.MeshPhysicalMaterial({ transmission: 1, roughness: 0.02, thickness: 0.004, color: 0xffffff }),
    glass_opal: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.92, 0.78).multiplyScalar(3.2) }),
    enamel_white: new THREE.MeshPhysicalMaterial({ color: 0xf3f1ea, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    plastic_white: new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.45 }),
    slot_dark: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 }),
    stoneware_cream: new THREE.MeshPhysicalMaterial({ color: 0xe9e1cf, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15 }),
    stoneware_blue: new THREE.MeshPhysicalMaterial({ color: 0x35557a, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
    cork: new THREE.MeshStandardMaterial({ color: 0xa9825a, roughness: 0.95 }),
    linen_blind: cloth(0xe6dfcf), linen_runner: cloth(0xb7a98c), linen_apron: apron,
    towel_stripe: cloth(0xffffff, { map: stripeTexture() }),
    picture_glass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, transparent: true, opacity: 0.1, depthWrite: false }),
  };
}

// Fit the sun's shadow camera to a set of boxes (the whole room and the hall), so no surface is lit through a wall for
// want of a shadow, and the sun can come in through the side window too.
function fitSun(sun, corners, margin = 0.25) {
  const dir = sun.target.position.clone().sub(sun.position).normalize();
  sun.position.copy(sun.target.position).addScaledVector(dir, -12); sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
  const inv = new THREE.Matrix4().lookAt(sun.position, sun.target.position, new THREE.Vector3(0, 1, 0)).setPosition(sun.position).invert();
  const b = new THREE.Box3(); for (const c of corners) b.expandByPoint(c.clone().applyMatrix4(inv));
  Object.assign(sun.shadow.camera, { left: b.min.x - margin, right: b.max.x + margin, bottom: b.min.y - margin, top: b.max.y + margin, near: Math.max(0.1, -b.max.z - margin), far: -b.min.z + margin });
  sun.shadow.camera.updateProjectionMatrix();
}
const boxCorners = (x0, x1, y0, y1, z0, z1) => [x0, x1].flatMap(x => [y0, y1].flatMap(y => [z0, z1].map(z => new THREE.Vector3(x, y, z))));

export async function buildRoom(world, kitchen, M, manifest, cfg = {}) {
  const full = (cfg.room || 'full') !== 'plain';
  const room = new THREE.Group(); room.name = 'room'; world.scene.add(room);
  const placements = [];
  const fix = (obj, aoi, parent = room) => { parent.add(obj); world.addFixture(obj, aoi); return obj; };
  const { door: D, hall: H, win: W } = R, X0 = K.roomX0, X1 = K.roomX1, Z0 = K.counterBack, Z1 = K.roomZ1, C = K.ceiling;
  const kitLoad = loadPath(KIT);      // start the downloads now; the walls below do not wait for them
  const ids = full ? ['wooden_table_02', 'painted_wooden_chair_01', 'modern_ceiling_lamp_01', 'hanging_picture_frame_01', 'hanging_picture_frame_02', 'standing_picture_frame_01', 'potted_plant_01', 'potted_plant_02',
    'potted_plant_04', 'wicker_basket_02', 'wooden_broom', 'book_encyclopedia_set_01', 'ceramic_vase_02', 'ceramic_vase_04', 'wooden_bowl_01', 'food_apple_01', 'lemon', 'bar_chair_round_01'] : ['modern_ceiling_lamp_01'];
  const scans = Promise.all(ids.map(id => loadModel(manifest, id)));

  // ---------------------------------------------------------------- walls ----
  fix(quad([[X0, 0, Z1], [X0, 0, Z0], [X0, C, Z0], [X0, C, Z1]], M.plaster), 'wall');                                                  // left
  const wz0 = W.z - W.w / 2, wz1 = W.z + W.w / 2, wy1 = W.y0 + W.h;
  const right = poly([[Z0, 0], [Z1, 0], [Z1, C], [Z0, C]]); right.holes.push(new THREE.Path([[wz0, W.y0], [wz0, wy1], [wz1, wy1], [wz1, W.y0]].map(p => new THREE.Vector2(...p))));
  fix(sheet(right, new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(X1, 0, 0), M.plaster), 'wall');                         // right, with the window opening
  for (const [y0, y1, z0, z1] of [[W.y0, wy1, wz0 - 0.012, wz0], [W.y0, wy1, wz1, wz1 + 0.012], [wy1, wy1 + 0.012, wz0 - 0.012, wz1 + 0.012]]) fix(slab(X1, X1 + W.reveal, y0, y1, z0, z1, M.plaster), 'wall');   // reveals
  const view = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.6), M.windowView); view.rotation.y = -Math.PI / 2; view.position.set(X1 + 1.0, W.y0 + W.h / 2 + 0.15, W.z); fix(view, 'window_side');
  const dx0 = D.cx - D.w / 2, dx1 = D.cx + D.w / 2;
  fix(sheet(poly([[-X1, 0], [-dx1, 0], [-dx1, D.h], [-dx0, D.h], [-dx0, 0], [-X0, 0], [-X0, C], [-X1, C]]), new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0, Z1), M.plaster), 'wall');   // rear, with the doorway
  // ---- hall ----
  const hz0 = Z1 + D.wall;
  fix(sheet(poly([[H.x0, 0], [dx0, 0], [dx0, D.h], [dx1, D.h], [dx1, 0], [H.x1, 0], [H.x1, H.ceil], [H.x0, H.ceil]]), new THREE.Matrix4().makeTranslation(0, 0, hz0), M.plaster), 'hall');
  fix(quad([[H.x0, 0, H.z1], [H.x0, 0, Z1], [H.x0, H.ceil, Z1], [H.x0, H.ceil, H.z1]], M.plaster), 'hall');
  fix(quad([[H.x1, 0, Z1], [H.x1, 0, H.z1], [H.x1, H.ceil, H.z1], [H.x1, H.ceil, Z1]], M.plaster), 'hall');
  fix(quad([[H.x1, 0, H.z1], [H.x0, 0, H.z1], [H.x0, H.ceil, H.z1], [H.x1, H.ceil, H.z1]], M.plaster), 'hall');
  fix(quad([[H.x0, H.ceil, Z1], [H.x1, H.ceil, Z1], [H.x1, H.ceil, H.z1], [H.x0, H.ceil, H.z1]], M.ceiling), 'hall');
  fix(quad([[H.x0, 0, Z1], [H.x0, 0, H.z1], [H.x1, 0, H.z1], [H.x1, 0, Z1]], M.parquet, 0.5), 'floor');

  // ---------------------------------------------------------------- the kit ----
  const kit = await kitLoad, mats = kitMaterials(M);
  const part = (name, { at = [0, 0, 0], ry = 0, parent = room, aoi = name, cast = true } = {}) => {
    const src = kit.getObjectByName(name); if (!src) { console.warn('room kit: no part', name); return new THREE.Group(); }
    const o = new THREE.Group(); o.name = name; o.add(src.clone(true)); o.position.set(...at); o.rotation.y = ry;      // (the node keeps its own transform: compressed geometry is de-quantized there)
    o.traverse(m => { if (!m.isMesh) return; m.material = mats[m.material.name] || m.material; m.castShadow = cast && !/^glass/.test(m.material.name || '') && m.material !== mats.glass && m.material !== mats.glass_opal; });
    fix(o, aoi, parent); placements.push({ id: name, kind: 'room', role: 'room', region: 'room', aoi, pos: o.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(3)), yaw: +ry.toFixed(3) });
    return o;
  };
  const L = Math.PI / 2;                                   // facing: parts face +z; ry turns them to face into the room
  part('cornice', { aoi: 'ceiling' }); part('skirting', { aoi: 'wall' }); part('hall_trim', { aoi: 'hall' });
  const frame = part('door_frame', { at: [D.cx, 0, Z1], ry: Math.PI, aoi: 'door' });
  const leaf = part('door_leaf', { at: [-D.w / 2 + 0.03, 0, -D.wall], parent: frame, aoi: 'door' }); leaf.rotation.y = D.open;      // open into the hall
  part('window_side', { at: [X1, W.y0 + W.h / 2, W.z], ry: -L, aoi: 'window_side' });
  const WB = K.window; part('window_back', { at: [(WB.x0 + WB.x1) / 2, (WB.y0 + WB.y1) / 2, Z0], aoi: 'window' });
  part('radiator', { at: [1.23, 0, Z1], ry: Math.PI });
  part('switch_plate', { at: [dx1 + 0.2, 1.18, Z1], ry: Math.PI, aoi: 'switch' });
  for (const x of [-0.84, 0.5]) part('outlet_plate', { at: [x, 1.13, Z0 + 0.005], aoi: 'socket' });
  part('outlet_plate', { at: [X1, 0.32, 0.55], ry: -L, aoi: 'socket' });
  part('hall_light', { at: [(H.x0 + H.x1) / 2, H.ceil, 4.15], aoi: 'hall', cast: false });

  // ---------------------------------------------------------------- lights ----
  const lights = new THREE.Group(); room.add(lights);
  const sun = kitchen.lights.sun;
  fitSun(sun, [...boxCorners(X0, X1 + W.reveal, 0, C, Z0 - 0.2, Z1), ...boxCorners(H.x0, H.x1, 0, H.ceil, Z1, H.z1)]);
  sun.shadow.mapSize.set(cfg.quality === false ? 2048 : 4096, cfg.quality === false ? 2048 : 4096);
  const T = R.table;
  const lamp = (await scans)[ids.indexOf('modern_ceiling_lamp_01')].clone(true);                // pendant over the table: in both versions of the room, so the light is the same
  lamp.position.set(T.x, C - 1.173, T.z);
  lamp.traverse(m => { if (m.isMesh) { m.castShadow = false; if (/globe/.test(m.material.name)) m.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.74).multiplyScalar(3.4) }); } });
  fix(lamp, 'pendant'); placements.push({ id: 'pendant', kind: 'room', role: 'room', region: 'room', aoi: 'pendant', pos: lamp.position.toArray(), yaw: 0 });
  const down = new THREE.SpotLight(0xffe2b8, 9, 4.5, 1.1, 0.9, 2); down.position.set(T.x, C - 0.82, T.z); down.target.position.set(T.x, 0, T.z);
  down.castShadow = true; down.shadow.mapSize.set(1024, 1024); down.shadow.bias = -0.0005; down.shadow.normalBias = 0.012; down.shadow.radius = 6; down.shadow.camera.near = 0.2; down.shadow.camera.far = 4;
  const glow = new THREE.PointLight(0xffe2b8, 1.6, 3.2, 2); glow.position.set(T.x, C - 0.75, T.z);
  const hall = new THREE.SpotLight(0xffdcae, 7, 3.6, 0.85, 0.9, 2); hall.position.set((H.x0 + H.x1) / 2, H.ceil - 0.12, 4.15); hall.target.position.set((H.x0 + H.x1) / 2, 0, 4.15);
  // The sun again, through the side window only: a narrow beam along the sun's own direction, so the table and the floor
  // get a proper patch of sunlight without making the counter (lit through the back window) any brighter.
  const toSun = sun.position.clone().sub(sun.target.position).normalize(), wc = new THREE.Vector3(X1 + W.reveal / 2, W.y0 + W.h / 2, W.z);
  const sunIn = new THREE.SpotLight(0xffe6bf, 6.5, 0, 0.15, 0.25, 0); sunIn.position.copy(wc).addScaledVector(toSun, 6); sunIn.target.position.copy(wc).addScaledVector(toSun, -1);
  sunIn.castShadow = true; sunIn.shadow.mapSize.set(2048, 2048); sunIn.shadow.bias = -0.0002; sunIn.shadow.normalBias = 0.01; sunIn.shadow.radius = 2.5; sunIn.shadow.camera.near = 4.5; sunIn.shadow.camera.far = 12;
  lights.add(down, down.target, glow, hall, hall.target, sunIn, sunIn.target);
  // nothing these two lights reach ever moves, so their shadows are drawn once and kept
  const bake = () => { for (const l of [down, sunIn]) { l.shadow.autoUpdate = false; l.shadow.needsUpdate = true; } };

  if (!full) { bake(); return { room, placements, lights: { down, glow, hall, sunIn }, bake, detail: 'plain' }; }

  // ---------------------------------------------------------------- furnishing ----
  const S = Object.fromEntries((await scans).map((s, i) => [ids[i], s]));
  const scan = (id, name, { at = [0, 0, 0], ry = 0, scale = 1, parent = room, aoi = name, node = null, rx = 0, rz = 0, cast = true } = {}) => {
    const src = node ? S[id].getObjectByName(node) : S[id]; const o = src.clone(true); if (node) o.position.set(0, 0, 0);
    const g = new THREE.Group(); g.add(o); g.position.set(...at); g.rotation.set(rx, ry, rz); g.scale.setScalar(scale);
    g.traverse(m => { if (!m.isMesh) return; if (/_glass$/.test(m.material.name)) m.material = mats.picture_glass; m.castShadow = cast && !m.material.transparent; });      // (the scans' glazing is exported opaque)
    fix(g, aoi, parent); placements.push({ id: name, kind: id, role: 'room', region: 'room', aoi, pos: g.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(3)), yaw: +ry.toFixed(3) });
    return g;
  };
  part('blind_side', { at: [X1, wy1 + 0.07, W.z], ry: -L, aoi: 'blind' }); part('blind_side_rail', { at: [X1, wy1 + 0.07, W.z], ry: -L, aoi: 'blind' });
  part('blind_back', { at: [(WB.x0 + WB.x1) / 2, WB.y1 + 0.06, Z0], aoi: 'blind' }); part('blind_back_rail', { at: [(WB.x0 + WB.x1) / 2, WB.y1 + 0.06, Z0], aoi: 'blind' });

  // breakfast table by the side window
  const table = scan('wooden_table_02', 'table', { at: [T.x, 0, T.z], ry: L });
  part('table_runner', { parent: table, aoi: 'table' });
  scan('painted_wooden_chair_01', 'chair_1', { at: [T.x - 0.03, 0, T.z - 0.75], ry: 0.06, aoi: 'chair' });
  scan('painted_wooden_chair_01', 'chair_2', { at: [T.x + 0.02, 0, T.z + 0.71], ry: Math.PI - 0.1, aoi: 'chair' });
  scan('painted_wooden_chair_01', 'chair_3', { at: [T.x - 0.66, 0, T.z + 0.1], ry: L + 0.35, aoi: 'chair' });
  const bowl = scan('wooden_bowl_01', 'fruit_bowl', { at: [-0.22, 0.81, 0.02], ry: 0.6, parent: table });
  for (const [id, x, y, z, ry, rz] of [['food_apple_01', 0.045, 0.022, 0.03, 0.4, 0.15], ['food_apple_01', -0.055, 0.02, -0.02, 2.2, -0.2], ['lemon', 0.0, 0.065, -0.065, 1.0, 1.3], ['lemon', -0.02, 0.07, 0.075, 2.6, 1.5]])
    scan(id, 'fruit', { at: [x, y, z], ry, rz, parent: bowl, aoi: 'fruit_bowl' });
  scan('ceramic_vase_04', 'jug', { at: [0.3, 0.81, -0.06], ry: 2.2, parent: table, aoi: 'table' });
  scan('potted_plant_04', 'sill_plant', { at: [X1 + 0.07, W.y0, W.z - 0.3], ry: 1.1, aoi: 'plant' });
  const print = new THREE.MeshStandardMaterial({ map: botanicalPrint(), roughness: 0.9 });
  scan('hanging_picture_frame_01', 'picture_1', { at: [X1, 1.56, 0.62], ry: -L, aoi: 'picture' }).traverse(m => { if (m.isMesh && /_artwork$/.test(m.material.name)) m.material = print; });

  // rear wall: dresser, radiator with a picture over it
  const dz = part('dresser', { at: [R.dresser.x, 0, Z1], ry: Math.PI });
  part('dresser_ware', { parent: dz, aoi: 'dresser' });
  scan('book_encyclopedia_set_01', 'books', { at: [-0.67, 0.9, 0.17], parent: dz, aoi: 'dresser' });
  scan('ceramic_vase_02', 'vase', { at: [0.13, 0.9, 0.25], parent: dz, aoi: 'dresser' });
  scan('standing_picture_frame_01', 'photo', { at: [-0.02, 0.9, 0.3], ry: -L + 0.25, parent: dz, aoi: 'dresser' });
  scan('hanging_picture_frame_02', 'picture_2', { at: [1.23, 1.6, Z1], ry: Math.PI, aoi: 'picture' });
  scan('potted_plant_01', 'floor_plant', { at: [-2.5, 0, 2.6], ry: 2.0, aoi: 'plant' });

  // left wall: peg rail with apron and tea towel, a stool under it, a broom
  const rail = part('peg_rail', { at: [X0, 1.62, 1.36], ry: L });
  for (const n of ['apron', 'apron_straps', 'tea_towel', 'tea_towel_loop']) part(n, { parent: rail, aoi: n.startsWith('apron') ? 'apron' : 'tea_towel' });
  scan('bar_chair_round_01', 'stool', { at: [-2.36, 0, 1.1], ry: 0.7 });
  const broom = scan('wooden_broom', 'broom', { at: [X0 + 0.27, 0.122, 2.12] }); broom.children[0].rotation.y = L; broom.rotation.z = 0.19;      // leaning on the wall
  // hall: a basket and a plant at the far end
  scan('wicker_basket_02', 'basket', { at: [-0.33, 0, 4.9], ry: 0.5, aoi: 'hall' });
  scan('potted_plant_02', 'hall_plant', { at: [0.32, 0, 4.82], ry: 2.4, aoi: 'hall' });

  bake();
  return { room, placements, lights: { down, glow, hall, sunIn }, bake, detail: 'full' };
}
