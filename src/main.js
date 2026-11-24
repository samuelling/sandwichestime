// sandwichestime — bootstrap: renderer, kitchen, layout, inputs, gaze, logging.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './core/world.js';
import { buildMaterials, setMaxAnisotropy, setAssetDetail } from './scene/materials.js';
import { buildKitchen } from './scene/kitchen.js';
import { buildLayout, modelManager } from './scene/layout.js';
import { Hand, HandRig } from './interact/hand.js';
import { Manipulator } from './interact/manip.js';
import { MouseInput, Body } from './interact/mouse.js';
import { TouchInput } from './interact/touch.js';
import { Vision } from './interact/vision.js';
import { WebcamHands } from './interact/webcam.js';
import { Reacher } from './interact/reach.js';
import { CamPreview } from './ui/campreview.js';
import { CalibrationUI } from './ui/calibration.js';
import { GraspAids } from './ui/aids.js';
import { XRHands } from './interact/xr.js';
import { Autopilot } from './interact/autopilot.js';
import { Gaze, MouseGaze, SocketGaze, WebcamGaze } from './gaze/gaze.js';
import { AOIBuffer } from './gaze/aoibuffer.js';
import { Logger } from './log/logger.js';
import { TaskMonitor } from './task/task.js';
import { renderReport, quickMetrics } from './ui/report.js';
import { toast } from './util/util.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const form = $('#setup');
// Phones and tablets: touch controls, the low-memory asset set and no post-processing by default (URL parameters still override).
const coarse = matchMedia('(pointer: coarse)').matches, small = Math.min(screen.width, screen.height) < 700;
if (coarse) { form.elements.input.value = 'touch'; form.elements.quality.checked = false; form.elements.saliency.checked = false; if (small) form.elements.distractors.value = 'sparse'; }
for (const [k, v] of params) { const el = form.elements[k]; if (el) { if (el.type === 'checkbox') el.checked = v !== '0'; else { if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === v)) el.add(new Option(v, v)); el.value = v; } } }
// ---- loading screen and visible errors: nothing should ever fail as a silent black screen ----
const loadEl = $('#loading');
const loading = {
  show(title) { loadEl.hidden = false; loadEl.classList.remove('err'); loadEl.querySelector('.t').textContent = title; },
  progress(done, total, note) { loadEl.querySelector('.bar i').style.width = `${total ? Math.round(100 * done / total) : 0}%`; loadEl.querySelector('.s').textContent = note ?? `${done} of ${total} files`; },
  hide() { if (!loadEl.classList.contains('err')) loadEl.hidden = true; },
  fatal(msg) { loadEl.hidden = false; loadEl.classList.add('err'); loadEl.querySelector('.t').textContent = 'Could not start the kitchen'; loadEl.querySelector('.s').textContent = `${msg}\n\nReload to try again. If it keeps happening, send this message along.`; },
};
const problems = [];
function report(msg) {       // non-fatal: keep running, but say so on screen
  msg = String(msg).slice(0, 400); if (problems.includes(msg) || problems.length >= 4) return; problems.push(msg); console.error('[sandwichestime]', msg);
  let el = $('#diag'); if (!el) { el = document.createElement('div'); el.id = 'diag'; document.body.appendChild(el); }
  el.textContent = problems.join('\n'); window.__problems = problems;
}
addEventListener('error', e => report(`${e.message} (${String(e.filename || '').split('/').pop()}:${e.lineno})`));
addEventListener('unhandledrejection', e => report(e.reason?.message || e.reason));
const launch = () => start(readConfig()).catch(err => { console.error(err); window.__error = String(err.stack || err); loading.fatal(err.message || String(err)); });
form.addEventListener('submit', e => { e.preventDefault(); launch(); });
if (params.get('auto') === '1') queueMicrotask(launch);

function readConfig() {
  const f = new FormData(form), c = Object.fromEntries(f.entries());
  c.seed = +c.seed || 1; c.session = +c.session || 1; c.saliency = form.elements.saliency.checked; c.quality = form.elements.quality.checked;
  c.speed = +(params.get('speed') || 1);
  return c;
}

async function start(cfg) {
  $('#landing').hidden = true;
  loading.show('Setting up the kitchen…'); loading.progress(0, 1, 'Starting…');
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));      // let the loading screen paint before the heavy work
  const counts = new Map(), tick = m => (url, done, total) => { counts.set(m, [done, total]); let d = 0, t = 0; for (const [a, b] of counts.values()) { d += a; t += b; } loading.progress(d, t); };
  THREE.DefaultLoadingManager.onProgress = tick('default'); modelManager.onProgress = tick('models');
  const slow = setTimeout(() => { const el = loadEl.querySelector('.t'); if (!loadEl.hidden && !loadEl.classList.contains('err')) el.textContent = 'Still loading… (slow connection?)'; }, 25000);
  const canvas = $('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(+params.get('pr') || (params.get('fast') ? 0.5 : Math.min(devicePixelRatio, 2))); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.xr.enabled = cfg.input === 'xr';
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); loading.fatal('The browser dropped the graphics context, usually because it ran out of memory. Try fewer distractors, standard texture detail, or switching off high-quality rendering.'); });
  renderer.debug.onShaderError = (gl, program, vs, fs) => { const log = gl.getProgramInfoLog(program) || gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || 'unknown'; report('Shader failed to compile: ' + log); };
  setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xd9d2c6);
  const camera = new THREE.PerspectiveCamera(56, innerWidth / innerHeight, 0.03, 30);
  // Wide screens: 56° vertical. Narrow / portrait screens: widen so about 66° of the counter is still visible left to right.
  const fitCamera = () => { const a = innerWidth / innerHeight; camera.aspect = a; camera.fov = a >= 1.3 ? 56 : Math.min(98, 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(33)) / a))); camera.updateProjectionMatrix(); };
  fitCamera(); setAssetDetail(cfg.detail);
  const world = new World(scene);
  window.__sandwich = { world, scene, camera, renderer, cfg };

  const [manifest, taskDef] = await Promise.all([fetch('assets/manifest.json').then(r => r.json()), fetch('task/sandwich_task.json').then(r => r.json())]);
  const M = buildMaterials(manifest); world.M = M;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const hdr = await new HDRLoader().loadAsync('assets/' + manifest.hdri.lythwood_room);
  scene.environment = pmrem.fromEquirectangular(hdr).texture; scene.environmentIntensity = 0.45; hdr.dispose();
  const kitchen = buildKitchen(world, M);
  const L = await buildLayout(world, kitchen, M, manifest, cfg);
  // Reflections of this room, not of the HDRI's: capture the lit kitchen from the work area and use that as the environment.
  if (params.get('roomenv') !== '0') {
    scene.updateMatrixWorld(true);
    const roomEnv = pmrem.fromScene(scene, 0, 0.05, 14, { size: 256, position: new THREE.Vector3(0, 1.3, -0.12) });
    scene.environment = roomEnv.texture; scene.environmentIntensity = 0.9;
  }
  pmrem.dispose();
  clearTimeout(slow);

  // hands
  const hands = [new Hand('L'), new Hand('R')];
  const rigs = hands.map(h => new HandRig(scene, h.side, { tone: cfg.handtone }));
  const manip = new Manipulator(world, L.task, cfg, taskDef);
  const body = new Body(); body.applyToCamera(camera);

  const meta = { participant: cfg.participant, session: cfg.session, condition: cfg.condition, layout: cfg.layout, seed: cfg.seed, distractors: cfg.distractors,
    input: cfg.input, gaze: cfg.gaze, detail: cfg.detail || 'standard', endpoint: cfg.endpoint || null, userAgent: navigator.userAgent, screen: [innerWidth, innerHeight, devicePixelRatio], fovY: camera.fov, app: 'sandwichestime 0.4.0' };
  const logger = new Logger(meta);
  logger.layout = { placements: L.placements, counterY: 0.91 };
  logger.task = taskDef;
  const monitor = new TaskMonitor(world, L.task, taskDef, cfg);

  // ---- inputs ----
  let input = null, vision = null, xrHands = null, autopilot = null, webcamHands = null;
  if (cfg.input === 'mouse') input = new MouseInput(canvas, camera, world, hands, manip, body);
  if (cfg.input === 'touch') { input = new TouchInput(canvas, camera, world, hands, manip, body); toast('Tap to grab or put down · drag to move', 5000); setTimeout(() => $('#instruction').classList.add('dim'), 9000); }
  if (cfg.input === 'autopilot') { autopilot = new Autopilot(world, L.task, hands, manip, body, camera, cfg.seed); autopilot.speed = cfg.speed; }
  if (cfg.input === 'webcam' || cfg.gaze === 'webcam') {
    if (params.get('fakecam') === '1') { vision = Vision.fake(); window.__fakeHands = r => { vision.handResult = r; vision.frameT = performance.now() / 1000; }; }
    else {
      vision = new Vision($('#cam'));
      toast('Starting camera…', 6000);
      meta.camera = await vision.start({ hands: cfg.input === 'webcam', face: cfg.gaze === 'webcam' });
    }
  }
  let preview = null;
  if (cfg.input === 'webcam') {
    webcamHands = new WebcamHands(vision, hands, body, world.bus, new Reacher(camera, world, manip, body), { participant: cfg.participant });
    webcamHands.reacher.onLimit = () => toast('Out of reach: step sideways or use the other hand', 2600);
    if (params.get('preview') !== '0') preview = new CamPreview(vision, webcamHands);
  }
  if (input?.reacher) input.reacher.onLimit = () => toast('Out of reach: step sideways or use the other hand', 2600);
  if (cfg.input === 'xr') xrHands = new XRHands(renderer, scene, hands, world.bus);
  const aids = cfg.aids !== 'off' && cfg.input !== 'autopilot' ? new GraspAids(scene, world, hands, manip, camera) : null;
  meta.aids = !!aids; meta.handtone = cfg.handtone || 'neutral';

  // ---- gaze ----
  const gaze = new Gaze(world, camera, cfg, taskDef.thresholds);
  let webcamGaze = null;
  if (cfg.gaze === 'mouse' && input) gaze.setProvider(new MouseGaze(input));
  if (cfg.gaze === 'socket') gaze.setProvider(new SocketGaze(cfg.socket, world.bus));
  if (cfg.gaze === 'webcam') { webcamGaze = new WebcamGaze(vision, world.bus); gaze.setProvider(webcamGaze); }
  if (cfg.gaze === 'autopilot' && autopilot) gaze.setProvider(autopilot.gazeProvider());
  const aoiBuf = cfg.saliency && cfg.input !== 'xr' ? new AOIBuffer(renderer, scene, camera, world) : null;

  // ---- bus -> log ----
  const NOLOG = new Set(['settled']);
  const clean = p => JSON.parse(JSON.stringify(p, (k, v) => (v && v.isVector3 ? v.toArray() : v && typeof v === 'object' && v.root ? v.id : v)));
  world.bus.on('*', (type, p) => {
    if (!logger.recording && type !== 'calibration') return;
    if (type === 'settled') { logger.event('settled', { obj: p.entity.id, on: p.on, y: +p.y.toFixed(4), t: world.clockT }); return; }
    if (NOLOG.has(type)) return;
    logger.event(type, { ...clean(p), t: p.t ?? world.clockT });
  });

  // ---- rendering ----
  let composer = null;
  if (cfg.quality && cfg.input !== 'xr' && !params.get('fast')) {
    // multisampled HDR target: without it the post-processing chain loses antialiasing
    const pr = renderer.getPixelRatio();
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, innerWidth, innerHeight); ao.blendIntensity = 0.85; ao.updateGtaoMaterial({ radius: 0.12, distanceFallOff: 1, thickness: 1 }); composer.addPass(ao);
    composer.addPass(new OutputPass());
  }
  addEventListener('resize', () => { fitCamera(); renderer.setSize(innerWidth, innerHeight); composer?.setSize(innerWidth, innerHeight); });

  // ---- HUD ----
  $('#hud').hidden = false;
  const instruction = taskDef.instructions[cfg.condition] || taskDef.instructions.standard;
  $('#instruction').textContent = instruction;

  let tTrial = null, ended = false, lastAOI = -1, lastFrame = -1, fpsN = 0, fpsT = 0, lastBackup = 0;
  const begin = () => { logger.start(performance.now() / 1000); tTrial = 0; world.clockT = 0; logger.event('trial_start', { t: 0, instruction }); };

  world.bus.on('bell', () => { if (tTrial !== null && tTrial > 3 && !ended) endTrial(); });
  function endTrial() {
    ended = true;
    logger.event('trial_end', { t: tTrial });
    logger.stop();
    const summary = monitor.summary(tTrial);
    logger.summary = { ...summary, handPath: { L: hands[0].path, R: hands[1].path } };
    logger.summary.quick = quickMetrics(logger, Object.keys(taskDef.task_objects));
    logger.backup();
    window.__log = logger;
    if (renderer.xr.isPresenting) renderer.xr.getSession()?.end();
    if (params.get('noreport') !== '1') setTimeout(() => renderReport($('#report'), logger, summary, hands, Object.keys(taskDef.task_objects), {
      onDownload: () => logger.download(),
      onUpload: () => logger.upload(cfg.endpoint),
      onAgain: () => { const u = new URL(location.href); for (const [k, v] of Object.entries({ ...cfg, session: cfg.session + 1, seed: cfg.seed + 1 })) u.searchParams.set(k, v); u.searchParams.delete('auto'); location.href = u.toString(); },
    }), 600);
    document.getElementById('touchbar')?.remove(); document.getElementById('campip')?.remove();
    window.__done = true;
  }

  const taskEntities = [...world.entities.values()].filter(e => e.role !== 'fixture' || e.constraint);
  // ?fast=N runs N fixed 1/60 s simulation steps per rendered frame (autopilot / headless tests)
  const simSteps = +(params.get('fast') || 0);
  let lastT = performance.now(), frameNo = 0, shown = false;
  function step(dt, tms, simulated) {
    const tAbs = performance.now() / 1000;
    if (tTrial !== null && !ended) { tTrial = simulated ? tTrial + dt : logger.rel(tAbs); world.clockT = tTrial; }
    const tt = world.clockT ?? 0;
    if (vision) vision.poll(tms);
    if (input) input.update(dt);
    if (autopilot && tTrial !== null) autopilot.update(dt * (autopilot.speed || 1));
    if (webcamHands) { body.update(dt); webcamHands.update(dt, tAbs); }
    if (xrHands) xrHands.update(dt);
    if (cfg.input !== 'xr') body.applyToCamera(camera);
    manip.update(dt, hands, tt);
    input?.postUpdate();
    world.update(dt);
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    gaze.camera = cam;
    gaze.update(tt, renderer.xr.isPresenting);
    if (logger.recording) {
      if (tt - lastFrame >= 1 / 90 - 1e-6) { lastFrame = tt; logger.frame(tt, { camera: cam, body, gaze, hands, joints: cfg.input !== 'mouse' && cfg.input !== 'touch' }); logger.objectPoses(tt, taskEntities); }
      if (aoiBuf && tt - lastAOI >= 0.2) { lastAOI = tt; logger.aoi(tt, aoiBuf.capture()); }
      if (tt - lastBackup > 15) { lastBackup = tt; logger.backup(); }
    }
    if (autopilot && autopilot.done && !ended && tTrial > 3) endTrial();
  }
  renderer.setAnimationLoop((tms) => {
    const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    try {
      if (simSteps) { for (let k = 0; k < simSteps && !ended; k++) step(1 / 60, tms, true); }
      else step(dt, tms, false);
    } catch (err) { window.__errors = (window.__errors || []); if (window.__errors.length < 5) { window.__errors.push(String(err.stack || err)); console.error(err); } }
    rigs.forEach((r, i) => r.update(hands[i], renderer.xr.isPresenting ? null : body.shoulder(hands[i].side)));
    aids?.update(); preview?.update(now);
    fpsN++; fpsT += dt; if (fpsT > 0.5) { $('#fps').textContent = `${Math.round(fpsN / fpsT)} fps`; fpsN = 0; fpsT = 0; }
    if (input && !ended) { const h = hands[input.active]; $('#hand-ind').textContent = `${h.side === 'L' ? 'left' : 'right'} hand${h.holding ? ` · holding ${h.holding.id}` : h.hover ? ` · ${h.hover.id}` : ''}`; }
    frameNo++;
    if (simSteps && frameNo % 20 !== 1 && !ended) return; // fast mode: simulate, render occasionally
    try { if (composer && !renderer.xr.isPresenting) composer.render(); else renderer.render(scene, camera); }
    catch (err) { if (composer) { composer = null; report('High-quality rendering failed and was switched off: ' + err.message); } else { report('Rendering failed: ' + err.message); } }
    if (!shown) { shown = true; loading.hide(); }
  });
  // ---- calibration (with the scene already live), then start the trial ----
  (async () => {
    if (webcamHands) {
      // calib = auto (full the first time for this participant, then a quick check), full, quick, or off. Scripted runs (fakecam) default to off.
      const mode = params.get('calib') || (params.get('fakecam') === '1' ? 'off' : 'auto'), calUI = new CalibrationUI(vision, webcamHands), speed = +params.get('calibspeed') || 1;
      const run = m => webcamHands.calibrate(calUI, { mode: m === 'full' ? 'full' : m === 'quick' || webcamHands.savedCal() ? 'quick' : 'full', speed });
      if (mode !== 'off') { $('#instruction').textContent = 'Calibrating hand tracking…'; await run(mode); }
      else webcamHands.bus.emit('calibration', { type: 'webcam_hands', ok: false, mode: 'off', source: 'default', box: webcamHands.cal.box, liftGain: webcamHands.cal.liftGain, pOn: webcamHands.cal.pOn, pOff: webcamHands.cal.pOff, cutoff: webcamHands.cal.cutoff });
      webcamHands.onRecalibrate = () => { if (hands.some(h => h.holding)) toast('Put things down first, then press K to calibrate', 2600); else if (!ended) run('full'); };
    }
    if (webcamGaze) {
      try { const r = await webcamGaze.calibrate($('#calib'), $('#calib-dot'), $('#calib-msg')); toast(`Gaze calibrated: ~${r.approxDeg}° median error`, 3500); }
      catch (e) { toast('Gaze calibration failed: ' + e.message, 5000); }
    }
    if (cfg.input === 'xr') {
      const b = document.createElement('button'); b.textContent = 'Enter headset'; Object.assign(b.style, { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 30 });
      document.body.appendChild(b);
      await new Promise(res => b.onclick = async () => { try { await XRHands.enter(renderer); b.remove(); res(); } catch (e) { alert(e.message); } });
    }
    $('#instruction').textContent = instruction;
    setTimeout(begin, cfg.input === 'autopilot' ? 300 : 800);
  })();
  window.__sandwich = { ...window.__sandwich, webcamHands, vision, hands, manip, logger, monitor, L, kitchen, autopilot, gaze, body, endTrial };
}
