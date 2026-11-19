// Seeded layouts: where task objects and distractors go. The full placement is
// written to the log, so analysis never has to regenerate it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Entity } from '../core/world.js';
import { rng } from '../util/util.js';
import { K } from './kitchen.js';
import { makeBreadBag, makeJar, makeKnife, makePlate, makeTowel, makeBell, makeCutlery } from './props.js';

const gltf = new GLTFLoader();
const cache = new Map();
async function loadModel(manifest, id) {
  if (!cache.has(id)) cache.set(id, gltf.loadAsync('assets/' + manifest.models[id].file).then(g => g.scene));
  return cache.get(id);
}

// Distractor catalogue: model id (+ optional sub-node), where it naturally lives.
const D = [
  // food, kitchenware: counter
  { m: 'food_apple_01', zone: 'counter' }, { m: 'bananas', zone: 'counter', node: 'bananas_bunch' }, { m: 'lemon', zone: 'counter' },
  { m: 'yellow_onion', zone: 'counter' }, { m: 'food_avocado_01', zone: 'counter' }, { m: 'croissant', zone: 'counter' },
  { m: 'hamburger_buns', zone: 'counter', node: 'hamburger_buns_01' }, { m: 'food_kiwi_01', zone: 'counter' },
  { m: 'food_lime_01', zone: 'counter' }, { m: 'food_pomegranate_01', zone: 'counter' }, { m: 'sweet_potato', zone: 'counter' },
  { m: 'wooden_cutting_board', zone: 'counter' }, { m: 'wooden_spoon', zone: 'counter' }, { m: 'jug_01', zone: 'counter' },
  { m: 'wicker_basket_01', zone: 'counter' },
  // appliance-adjacent
  { m: 'vintage_electric_kettle', zone: 'cooktop', scale: 0.85 }, { m: 'pot_enamel_01', zone: 'cooktop' }, { m: 'brass_pan_01', zone: 'counterBack' },
  { m: 'multi_cleaner_bottle', zone: 'sinkRight' },
  // shelves
  { m: 'ceramic_vase_01', zone: 'shelf1' }, { m: 'potted_plant_04', zone: 'shelf1' }, { m: 'wooden_bowl_01', zone: 'shelf0' },
  { m: 'tea_set_01', node: 'tea_set_01_teapot_01', zone: 'shelf0' }, { m: 'tea_set_01', node: 'tea_set_01_cup_small_01', zone: 'shelf0' },
  { m: 'tea_set_01', node: 'tea_set_01_sugar_cup_01', zone: 'shelf0' },
  { m: 'wine_bottles_01', node: 'wine_bottles_01_bordeaux', zone: 'shelf1' }, { m: 'wine_bottles_01', node: 'wine_bottles_01_alsace', zone: 'shelf1' },
  // fridge contents
  { m: 'wine_bottles_01', node: 'wine_bottles_01_champagne', zone: 'fridge0', tag: 'fridge' }, { m: 'lemon', zone: 'fridge1', tag: 'fridge' },
  { m: 'food_lime_01', zone: 'fridge2', tag: 'fridge' }, { m: 'food_kiwi_01', zone: 'fridge2', tag: 'fridge' },
];
const SPARSE = new Set(['food_apple_01', 'bananas', 'croissant', 'hamburger_buns', 'wooden_cutting_board', 'jug_01', 'vintage_electric_kettle', 'multi_cleaner_bottle', 'ceramic_vase_01', 'potted_plant_04']);

function regions(kitchen) {
  const Y = K.counterY, cb = K.counterBack;
  const R = {
    counter: { x0: -1.08, x1: 0.70, z0: cb + 0.07, z1: -0.07, y: Y },
    counterBack: { x0: -1.1, x1: 0.7, z0: cb + 0.03, z1: cb + 0.3, y: Y },
    cooktop: { x0: K.cooktop.x0 + 0.12, x1: K.cooktop.x1 - 0.12, z0: -0.48, z1: -0.16, y: Y + 0.006 },
    sinkRight: { x0: K.sink.x1 + 0.08, x1: K.xMax - 0.06, z0: cb + 0.08, z1: -0.1, y: Y },
    shelf0: { x0: K.shelfX[0] + 0.05, x1: K.shelfX[1] - 0.05, z0: cb + 0.05, z1: cb + K.shelfDepth - 0.05, y: K.shelves[0] },
    shelf1: { x0: K.shelfX[0] + 0.05, x1: K.shelfX[1] - 0.05, z0: cb + 0.05, z1: cb + K.shelfDepth - 0.05, y: K.shelves[1] },
  };
  const f = kitchen.fridge;
  f.shelves.forEach((y, i) => { R[`fridge${i}`] = { ...f.interior, y }; });
  R.cupboard = { ...kitchen.cupboard.interior };
  R.drawer = { x0: K.drawer.x0 + 0.05, x1: K.drawer.x1 - 0.05, z0: -0.45, z1: -0.08, y: kitchen.drawer.interiorY, parent: 'drawer' };
  return R;
}

function footprintCircles(fp, x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return fp.map(([dx, dz, r]) => [x + c * dx + s * dz, z - s * dx + c * dz, r]);
}

function pack(r, region, fp, taken, { tries = 300, yaw = null, margin = 0.012 } = {}) {
  let best = null;
  for (let k = 0; k < tries; k++) {
    const ya = yaw ?? r() * Math.PI * 2;
    const maxR = Math.max(...fp.map(f => Math.hypot(f[0], f[1]) + f[2]));
    const x = r.range(region.x0 + maxR * 0.6, region.x1 - maxR * 0.6), z = r.range(region.z0 + maxR * 0.6, region.z1 - maxR * 0.6);
    const circ = footprintCircles(fp, x, z, ya);
    const inside = circ.every(([cx, cz, cr]) => cx - cr * 0.7 > region.x0 && cx + cr * 0.7 < region.x1 && cz - cr * 0.7 > region.z0 && cz + cr * 0.7 < region.z1);
    if (!inside) continue;
    const ok = circ.every(([cx, cz, cr]) => taken.every(([tx, tz, tr]) => Math.hypot(cx - tx, cz - tz) > cr + tr + margin));
    if (ok) { best = { x, z, yaw: ya, circ }; break; }
  }
  if (best) taken.push(...best.circ);
  return best;
}

// Auto-footprint for a scanned model from its bounding box.
function bboxFootprint(obj) {
  const b = new THREE.Box3().setFromObject(obj), sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
  const cx = (b.max.x + b.min.x) / 2, cz = (b.max.z + b.min.z) / 2;
  if (Math.max(sx, sz) / Math.min(sx, sz) < 1.6) return [[cx, cz, Math.max(sx, sz) / 2]];
  const n = Math.min(4, Math.ceil(Math.max(sx, sz) / Math.min(sx, sz))), along = sx > sz;
  const len = Math.max(sx, sz), r = Math.min(sx, sz) / 2;
  return Array.from({ length: n }, (_, i) => { const t = -len / 2 + r + (len - 2 * r) * (i / Math.max(1, n - 1)); return along ? [cx + t, cz, r] : [cx, cz + t, r]; });
}

export async function buildLayout(world, kitchen, M, manifest, cfg) {
  const r = rng(cfg.seed * 7919 + (cfg.layout === 'stored' ? 101 : 0));
  const R = regions(kitchen);
  // regions on the same physical surface share one collision list
  const surf = {}, taken = {};
  for (const k in R) { const key = `${R[k].y.toFixed(3)}|${R[k].parent || ''}|${k.startsWith('fridge') ? k : ''}`; taken[k] = surf[key] || (surf[key] = []); }
  const placements = [];
  const scene = world.scene;
  const place = (ent, regionName, p) => {
    const reg = R[regionName];
    if (!world.entities.has(ent.id)) world.add(ent, scene); else scene.add(ent.root);
    ent.root.position.set(p.x, reg.y + ent.restOffset, p.z);
    ent.root.rotation.set(0, p.yaw, 0);
    ent.restingOn = reg.parent === 'drawer' ? 'drawer' : regionName.replace(/\d$/, '');
    if (reg.parent === 'drawer') kitchen.drawer.root.attach(ent.root);
    placements.push({ id: ent.id, kind: ent.kind, role: ent.role, region: regionName, pos: ent.root.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(4)), yaw: +p.yaw.toFixed(4) });
  };
  const fixed = (ent, region, x, z, yaw = 0) => { const fp = ent.footprint || [[0, 0, 0.05]]; taken[region].push(...footprintCircles(fp, x, z, yaw)); place(ent, region, { x, z, yaw }); };
  const packed = (ent, region, opts) => {
    const p = pack(r, R[region], ent.footprint || [[0, 0, 0.05]], taken[region], opts);
    if (!p) { console.warn('could not place', ent.id, 'in', region); return false; }
    place(ent, region, p); return true;
  };

  // ---- task objects ----
  const plate = makePlate(M), bag = makeBreadBag(M, world), pb = makeJar(M, world, 'pb'), jelly = makeJar(M, world, 'jelly');
  const knife = makeKnife(M), towel = makeTowel(M), bell = makeBell(M);
  world.addSupport(plate.supportMesh, plate); world.addSupport(towel.supportMesh, towel);
  // slices are supports too (for sandwich closing)
  for (const s of bag.state.slices) world.addSupport(s.root.children[0], s);

  fixed(bell, 'counter', 0.6, -0.12, -0.3);
  if (cfg.layout === 'stored') {
    const C = R.cupboard; fixed(plate, 'cupboard', (C.x0 + C.x1) / 2, (C.z0 + C.z1) / 2);
    fixed(jelly, 'fridge1', -2.38, -0.3, 0.4);
    fixed(knife, 'drawer', -0.05, -0.2, 0.05);
  } else {
    fixed(plate, 'counter', 0.0, -0.25);
  }
  const yaw0 = () => (r() - 0.5) * 0.6;
  packed(bag, 'counter', { yaw: yaw0() + (r() < 0.5 ? 0 : Math.PI) });
  packed(pb, 'counter');
  if (cfg.layout !== 'stored') { packed(jelly, 'counter'); packed(knife, 'counter', { yaw: yaw0() }); }
  packed(towel, 'counter', { yaw: yaw0() });

  // drawer cutlery distractors (always)
  const cut = [['fork', 'fork'], ['spoon', 'spoon'], ['chef', 'chef_knife']];
  cut.forEach(([kind, id], i) => { const e = makeCutlery(M, kind, id); fixed(e, 'drawer', -0.2 + i * 0.1 + (cfg.layout === 'stored' ? 0.12 : 0), -0.22, 0.04); });

  // ---- distractors ----
  if (cfg.distractors !== 'none') {
    const pool = D.filter(d => cfg.distractors === 'full' || SPARSE.has(d.m) || d.tag === 'fridge');
    // big things first (random positions, deterministic order by size then shuffle within ties)
    const order = r.shuffle(pool);
    const counts = {};
    for (const d of order) {
      let src = (await loadModel(manifest, d.m));
      if (d.node) src = src.getObjectByName(d.node);
      if (!src) continue;
      const obj = src.clone(true);
      // re-centre the clone on its own footprint (sub-nodes carry offsets)
      obj.position.set(0, 0, 0); obj.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(obj);
      const wrap = new THREE.Group(); wrap.add(obj);
      obj.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      obj.traverse(o => { if (o.isMesh) { o.material.envMapIntensity = 1.0; } });
      counts[d.m] = (counts[d.m] || 0) + 1;
      const id = d.node ? d.node : (counts[d.m] > 1 ? `${d.m}_${counts[d.m]}` : d.m);
      if (d.scale) wrap.scale.setScalar(d.scale);
      const ent = new Entity(id, wrap, { kind: d.m, role: 'distractor', aoi: id, footprint: bboxFootprint(wrap) });
      ent.restOffset = 0;
      if (!packed(ent, d.zone) && !packed(ent, 'counterBack') && !packed(ent, 'counter')) { placements.push({ id, kind: d.m, role: 'distractor', region: 'unplaced' }); }
    }
  }
  // decor that is always present
  const clock = (await loadModel(manifest, 'wall_clock')).clone(true);
  const clockEnt = new Entity('wall_clock', clock, { kind: 'wall_clock', role: 'distractor', grabbable: false, settle: 'none' });
  clock.position.set(0.08, 2.22, K.counterBack + 0.002); world.add(clockEnt, scene);
  placements.push({ id: 'wall_clock', kind: 'wall_clock', role: 'distractor', region: 'wall', pos: clock.position.toArray(), yaw: 0 });
  const plant = (await loadModel(manifest, 'potted_plant_01')).clone(true);
  const plantEnt = new Entity('potted_plant_01', plant, { kind: 'potted_plant_01', role: 'distractor', grabbable: false, settle: 'none' });
  plant.position.set(1.32, 0, 0.55); world.add(plantEnt, scene);
  for (const [i, x] of [[1, -1.4], [2, -0.9]]) {
    const ch = (await loadModel(manifest, 'bar_chair_round_01')).clone(true);
    const e = new Entity(`bar_chair_${i}`, ch, { kind: 'bar_chair', role: 'distractor', grabbable: false, settle: 'none' });
    ch.position.set(x, 0, 2.45); ch.rotation.y = r() * 6; world.add(e, scene);
  }

  // record homes
  for (const e of world.entities.values()) { if (e.root.parent) { e.home = e.root.getWorldPosition(new THREE.Vector3()); } }
  return { placements, task: { plate, bag, pb, jelly, knife, towel, bell }, regions: R };
}
