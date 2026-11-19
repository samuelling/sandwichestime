// World: scene graph + entity registry + "physics-lite" (support finding and settling).
//
// Conventions: metres, +y up, participant stands at +z looking toward -z.
// Every movable entity's root origin is at the bottom-centre of its rest pose,
// so "resting on a surface at height h" means root.position.y = h.
import * as THREE from 'three';
import { Bus } from '../util/util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _box = new THREE.Box3();
const DOWN = new THREE.Vector3(0, -1, 0);

export class Entity {
  constructor(id, root, opts = {}) {
    this.id = id;
    this.root = root;
    this.kind = opts.kind || id;              // e.g. 'slice', 'pb_jar'
    this.role = opts.role || 'distractor';    // 'task' | 'distractor' | 'fixture'
    this.aoi = opts.aoi || id;                // AOI label used for gaze
    this.grabbable = opts.grabbable ?? true;
    this.settle = opts.settle || 'upright';   // 'upright' | 'flat2' (either face) | 'none'
    this.footprint = opts.footprint || null;  // [[dx,dz,r],...] for layout packing
    this.state = opts.state || {};
    this.heldBy = null;                       // Hand or null
    this.restingOn = null;                    // Entity or fixture id
    this.home = null;                         // initial world pose (for analysis)
    this.restOffset = opts.restOffset || 0;   // origin height above the support when resting
    this.constraint = opts.constraint || null; // drawers/doors: {type, ...}
    root.userData.entity = this;
    root.traverse(o => { if (o.isMesh) { o.userData.entityId = id; o.castShadow = opts.castShadow ?? true; o.receiveShadow = true; } });
  }
  worldPos(out = new THREE.Vector3()) { return this.root.getWorldPosition(out); }
  worldBox(out = _box) { return out.setFromObject(this.root, true); }
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.bus = new Bus();
    this.entities = new Map();
    this.supportMeshes = [];   // meshes whose top faces things can rest on
    this.aoiMeshes = [];       // meshes considered for gaze hit-testing
    this.fixtureAOI = new Map(); // mesh.uuid -> aoi label for fixtures
    this.articulated = [];     // drawers / doors
    this.falling = [];         // settling animations
    this.raycaster = new THREE.Raycaster();
    this.t = 0;
  }

  add(entity, parent = this.scene) {
    this.entities.set(entity.id, entity);
    parent.add(entity.root);
    entity.root.traverse(o => { if (o.isMesh && !o.userData.noAOI) this.aoiMeshes.push(o); });
    return entity;
  }
  get(id) { return this.entities.get(id); }

  addFixture(mesh, aoi, { support = false } = {}) {
    mesh.traverse(o => {
      if (!o.isMesh) return;
      o.userData.fixture = aoi; o.receiveShadow = true;
      if (!o.userData.noAOI) { this.aoiMeshes.push(o); this.fixtureAOI.set(o.uuid, aoi); }
    });
    if (support) this.addSupport(mesh, null);
    return mesh;
  }
  // A support mesh: something's top surface. owner = Entity that should carry things placed on it.
  addSupport(mesh, owner) {
    mesh.traverse(o => { if (o.isMesh) { o.userData.supportOwner = owner; this.supportMeshes.push(o); } });
  }
  removeSupport(mesh) { this.supportMeshes = this.supportMeshes.filter(m => m !== mesh && !mesh.children.includes(m)); }

  aoiOf(mesh) {
    if (!mesh) return null;
    if (mesh.userData.entityId) return this.entities.get(mesh.userData.entityId)?.aoi || mesh.userData.entityId;
    return mesh.userData.fixture || this.fixtureAOI.get(mesh.uuid) || null;
  }
  entityOf(mesh) {
    let o = mesh;
    while (o) { if (o.userData.entity) return o.userData.entity; o = o.parent; }
    return null;
  }

  // Highest support surface beneath world point p (excluding the entity itself and its descendants).
  supportBelow(p, exclude, maxDrop = 3) {
    this.raycaster.set(_v.set(p.x, p.y + 0.02, p.z), DOWN);
    this.raycaster.far = maxDrop;
    const hits = this.raycaster.intersectObjects(this.supportMeshes, false);
    for (const h of hits) {
      if (exclude && isDescendant(h.object, exclude.root)) continue;
      const owner = h.object.userData.supportOwner;
      if (owner && (owner.heldBy || owner.state?.inBag)) continue;
      return { y: h.point.y, owner, mesh: h.object, fixture: h.object.userData.fixture || null };
    }
    return null;
  }

  // Release an entity: find what it lands on, animate a short fall, re-parent onto carrying owner.
  drop(entity, { yaw } = {}) {
    const root = entity.root;
    this.scene.attach(root);
    root.getWorldPosition(_v);
    // footprint probes: centre + four points scaled to footprint radius
    const r = entity.footprint ? Math.min(0.06, entity.footprint[0][2] * 0.6) : 0.02;
    let best = null;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const s = this.supportBelow(_v2.set(_v.x + dx, _v.y + 0.04, _v.z + dz), entity);
      if (s && (!best || s.y > best.y)) best = s;
    }
    // orientation to settle into
    const targetQ = settleQuat(root.quaternion, entity.settle, yaw);
    const fromY = _v.y, toY = (best ? best.y : 0) + entity.restOffset;
    this.falling.push({ entity, t0: this.t, fromY, toY, fromQ: root.quaternion.clone(), toQ: targetQ, best });
    return best;
  }

  update(dt) {
    this.t += dt;
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i], root = f.entity.root;
      if (f.entity.heldBy) { this.falling.splice(i, 1); continue; }
      const h = Math.max(0, f.fromY - f.toY); f.h = h;
      const T = Math.max(0.08, Math.sqrt(2 * h / 9.81));
      const u = Math.min(1, (this.t - f.t0) / T);
      root.position.y = f.fromY - (f.fromY - f.toY) * u * u;
      root.quaternion.slerpQuaternions(f.fromQ, f.toQ, Math.min(1, u * 1.6));
      if (u >= 1) {
        this.falling.splice(i, 1);
        root.position.y = f.toY; root.quaternion.copy(f.toQ);
        const owner = f.best?.owner || null;
        f.entity.restingOn = owner ? owner.id : (f.best?.fixture || (f.best ? 'surface' : 'floor'));
        if (owner) owner.root.attach(root);
        this.bus.emit('settled', { entity: f.entity, on: f.entity.restingOn, y: f.toY, dropHeight: h });
      }
    }
    for (const a of this.articulated) a.update?.(dt);
  }
}

export function isDescendant(o, root) { while (o) { if (o === root) return true; o = o.parent; } return false; }

// Snap orientation to a stable resting pose: keep yaw, zero pitch/roll (or flip for 2-sided things).
const _e = new THREE.Euler();
export function settleQuat(q, mode, yaw) {
  if (mode === 'none') return q.clone();
  const up = _v.set(0, 1, 0).applyQuaternion(q);
  const flipped = (mode === 'flat2') && up.y < 0;
  // yaw from projected local x-axis
  const fx = _v2.set(1, 0, 0).applyQuaternion(q);
  let psi = yaw ?? Math.atan2(-fx.z, fx.x);
  const out = new THREE.Quaternion().setFromEuler(_e.set(0, psi, 0, 'YXZ'));
  if (flipped) out.multiply(_q.setFromAxisAngle(_v.set(1, 0, 0), Math.PI));
  return out;
}
