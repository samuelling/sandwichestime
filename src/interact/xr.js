// WebXR: 1:1 scale kitchen, articulated hand tracking (Quest / Vision Pro),
// controller fallback (grip pose + squeeze). The head is the gaze proxy unless a
// gaze source streams real eye data.
import * as THREE from 'three';

const XR_TO_MP = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'];

export class XRHands {
  constructor(renderer, scene, hands, bus) {
    Object.assign(this, { renderer, hands, bus });
    this.inputs = [0, 1].map(i => ({ hand: renderer.xr.getHand(i), grip: renderer.xr.getControllerGrip(i), ctrl: renderer.xr.getController(i), handedness: null, squeeze: false }));
    for (const s of this.inputs) {
      scene.add(s.hand, s.grip, s.ctrl);
      s.ctrl.addEventListener('connected', e => { s.handedness = e.data.handedness; s.hasHand = !!e.data.hand; });
      s.ctrl.addEventListener('disconnected', () => { s.handedness = null; });
      s.ctrl.addEventListener('squeezestart', () => (s.squeeze = true));
      s.ctrl.addEventListener('squeezeend', () => (s.squeeze = false));
      s.ctrl.addEventListener('selectstart', () => (s.select = true));
      s.ctrl.addEventListener('selectend', () => (s.select = false));
    }
  }
  static async enter(renderer, { referenceSpace = 'local-floor' } = {}) {
    if (!navigator.xr) throw new Error('WebXR not available in this browser');
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: [referenceSpace], optionalFeatures: ['hand-tracking', 'eye-tracking', 'bounded-floor'] });
    renderer.xr.setReferenceSpaceType(referenceSpace);
    await renderer.xr.setSession(session);
    return session;
  }
  update(dt) {
    for (const s of this.inputs) {
      if (!s.handedness) continue;
      const h = this.hands[s.handedness === 'left' ? 0 : 1];
      const J = s.hand.joints;
      if (J && J['wrist'] && J['index-finger-tip'] && J['wrist'].visible !== false && Object.keys(J).length >= 25) {
        const pts = XR_TO_MP.map(n => J[n].getWorldPosition(new THREE.Vector3()));
        h.fromJoints(pts);
        const d = pts[4].distanceTo(pts[8]);
        if (!h.pinch && d < 0.018) h.pinch = true; else if (h.pinch && d > 0.035) h.pinch = false;
        h.tracked = true; h.xrJoints = J;
      } else if (s.grip.visible) {
        h.xrJoints = null;
        // controller: synthesise a hand at the grip pose
        const p = s.grip.getWorldPosition(new THREE.Vector3()), q = s.grip.getWorldQuaternion(new THREE.Quaternion());
        q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
        h.poseSynthetic(p, q, s.squeeze || s.select ? 1 : 0.1);
        h.pinch = s.squeeze || s.select; h.tracked = true;
      } else { h.tracked = false; h.pinch = false; }
      h.updateRoll(); h.track(dt);
    }
  }
}
