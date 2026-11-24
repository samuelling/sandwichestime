// Grasp aids (optional; logged in meta.aids because they are extra visual cues):
// a ring on the surface under each hand. Idle: small, grows with the hand's
// height. Over something graspable: wraps the object's base. Holding: marks
// where the object would land.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _box = new THREE.Box3(), _s = new THREE.Vector3();
const COLORS = { idle: 0xffffff, target: 0xffc466, land: 0xffffff };

export class GraspAids {
  constructor(scene, world, hands, manip, camera) {
    Object.assign(this, { world, hands, manip, camera });
    const geo = new THREE.RingGeometry(0.93, 1, 64); geo.rotateX(-Math.PI / 2);
    this.rings = hands.map(() => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      m.userData.noAOI = true; m.renderOrder = 5; m.visible = false; scene.add(m); return m;
    });
  }
  update() {
    this.hands.forEach((h, i) => {
      const ring = this.rings[i];
      if (!h.tracked) { ring.visible = false; return; }
      ring.quaternion.identity();
      const held = h.holding, hov = !held ? h.hover : null;
      if (held && h.hold?.mode !== 'free') { ring.visible = false; return; }
      if (hov && hov.constraint) {              // drawer / door handle: ring faces the viewer at the hand
        ring.position.copy(h.grip); ring.quaternion.copy(this.camera.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(_v.set(1, 0, 0), Math.PI / 2));
        ring.scale.setScalar(0.035); ring.material.color.setHex(COLORS.target); ring.material.opacity = 0.8; ring.visible = true; return;
      }
      const subject = held || hov;
      let r = 0.014, y = null, x = h.grip.x, z = h.grip.z;
      if (subject) {
        _box.setFromObject(subject.root); _box.getSize(_s); _box.getCenter(_v);
        r = Math.min(0.17, Math.max(0.02, Math.max(_s.x, _s.z) * 0.5 + 0.012)); x = _v.x; z = _v.z;
        if (hov) y = _box.min.y + Math.min(0.6 * _s.y, 0.015);   // just above the base, so the ring hugs flared things like the plate
      }
      if (y === null) { const s = this.world.supportBelow(_v.set(x, h.grip.y + 0.05, z), held, 2.5); if (!s || h.grip.y - s.y > 0.45) { ring.visible = false; return; } /* nothing useful to mark far above the floor */ y = s.y; if (!subject) r += 0.22 * Math.max(0, h.grip.y - y - 0.02); }
      ring.position.set(x, y + 0.0025, z); ring.scale.setScalar(r);
      ring.material.color.setHex(hov ? COLORS.target : COLORS.idle); ring.material.opacity = hov ? 0.75 : held ? 0.5 : 0.4;
      ring.visible = true;
    });
  }
}
