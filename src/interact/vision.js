// One webcam, one MediaPipe pipeline, feeding both hand tracking and iris gaze.
// Bundle, wasm and models are vendored so a lab machine can run offline.
const BASE = new URL('../../vendor/mediapipe/', import.meta.url).href;

export class Vision {
  constructor(video) { this.video = video; this.hands = null; this.face = null; this.lastT = -1; this.handResult = null; this.faceResult = null; this.ready = false; }
  // test double: no camera, results injected with window.__fakeHands(result) / window.__fakeFace(result)
  static fake() { const v = new Vision({ videoWidth: 1280, videoHeight: 720, readyState: 0 }); v.poll = () => false; v.frameT = 0; return v; }
  // faceEvery: run the face model on every n-th new video frame (head pose is slow; hands get the rest)
  async start({ hands = false, face = false, faceEvery = 1 } = {}) {
    this.faceEvery = faceEvery; this._n = 0;
    const mp = await import(BASE + 'vision_bundle.mjs');
    const fileset = await mp.FilesetResolver.forVisionTasks(BASE + 'wasm');
    // GPU inference where available, CPU otherwise (some browsers / drivers refuse the GPU delegate)
    const make = async (Cls, model, opts) => {
      for (const delegate of ['GPU', 'CPU']) {
        try { const m = await Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath: BASE + model, delegate }, runningMode: 'VIDEO', ...opts }); this.delegate = delegate; return m; }
        catch (e) { console.warn(`MediaPipe ${delegate} delegate failed`, e); }
      }
      throw new Error('could not start MediaPipe');
    };
    if (hands) this.hands = await make(mp.HandLandmarker, 'models/hand_landmarker.task', { numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    if (face) this.face = await make(mp.FaceLandmarker, 'models/face_landmarker.task', { numFaces: 1, outputFacialTransformationMatrixes: true });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }, audio: false });
    this.video.srcObject = stream; await this.video.play();
    this.ready = true;
    const s = stream.getVideoTracks()[0].getSettings();
    return { width: s.width, height: s.height, frameRate: s.frameRate, delegate: this.delegate };
  }
  // call once per render frame; runs models only on new video frames
  poll(tMs) {
    if (!this.ready || this.video.readyState < 2) return false;
    const vt = this.video.currentTime; if (vt === this.lastT) return false; this.lastT = vt;
    if (this.hands) this.handResult = this.hands.detectForVideo(this.video, tMs);
    if (this.face && (this._n++ % this.faceEvery === 0)) this.faceResult = this.face.detectForVideo(this.video, tMs);
    this.frameT = tMs / 1000;
    return true;
  }
}
