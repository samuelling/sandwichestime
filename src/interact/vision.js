// One webcam, one MediaPipe pipeline, feeding both hand tracking and iris gaze.
// Bundle, wasm and models are vendored so a lab machine can run offline.
const BASE = new URL('../../vendor/mediapipe/', import.meta.url).href;

export class Vision {
  constructor(video) { this.video = video; this.hands = null; this.face = null; this.lastT = -1; this.handResult = null; this.faceResult = null; this.ready = false; }
  async start({ hands = false, face = false } = {}) {
    const mp = await import(BASE + 'vision_bundle.mjs');
    const fileset = await mp.FilesetResolver.forVisionTasks(BASE + 'wasm');
    const delegate = 'GPU';
    if (hands) this.hands = await mp.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: BASE + 'models/hand_landmarker.task', delegate },
      runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    if (face) this.face = await mp.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: BASE + 'models/face_landmarker.task', delegate },
      runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true,
    });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }, audio: false });
    this.video.srcObject = stream; await this.video.play();
    this.ready = true;
    const s = stream.getVideoTracks()[0].getSettings();
    return { width: s.width, height: s.height, frameRate: s.frameRate, deviceId: s.deviceId };
  }
  // call once per render frame; runs models only on new video frames
  poll(tMs) {
    if (!this.ready || this.video.readyState < 2) return false;
    const vt = this.video.currentTime; if (vt === this.lastT) return false; this.lastT = vt;
    if (this.hands) this.handResult = this.hands.detectForVideo(this.video, tMs);
    if (this.face) this.faceResult = this.face.detectForVideo(this.video, tMs);
    this.frameT = tMs / 1000;
    return true;
  }
}
