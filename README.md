# sandwichestime

A modern take on Mary Hayhoe's sandwich study (Hayhoe, Shrivastava, Mruczek & Pelz, 2003): make a peanut butter and jelly sandwich in a richly rendered virtual kitchen, with your hands tracked, while every reach, grasp, twist, dip, spread and fixation is logged. Each session is then scored against an optimal plan for that exact layout, and used to compare formal models of attention.

**Run it:** https://linglab.org/sandwichestime/ or serve the repo locally (`python3 -m http.server`) and open `index.html`.

## What's here

| | |
|---|---|
| **Kitchen** | Three.js with PBR materials, soft shadows, ambient occlusion and multisampled antialiasing. Reflections are captured from the room itself, and the sun comes in through the window. About 40 CC0 photoscanned props from Poly Haven (fruit, buns, croissant, cake, kettle, jug, tea set, tins, plants), including sandwich-adjacent lures such as a second, wooden plate. The cabinets have a working drawer and cupboard door, and the fridge has a working door. |
| **Task objects** | Built procedurally so every part is measurable. A bagged loaf of 12 slices with heels and a bread clip. Peanut butter and jelly jars with screw lids (about 1.25 turns to open). A butter knife that carries a measurable load of each substance, plus residue. Slices with paintable faces, so spread coverage is a number. A plate, a dish towel for wiping, and a service bell to finish. |
| **Hands** | A rigged, skinned hand mesh (neutral glove or five skin tones), driven the same way in every mode. **WebXR** hand tracking (Quest, Vision Pro) with a controller fallback. **Webcam** tracking of both hands (MediaPipe): hands palm-down as if over the counter (forward is farther, up is up), pinch or grab (close the hand) to grasp, lower to put down or press, turn to unscrew, turn the hand over to flip. An older upright mapping (palms to the screen) is an option. With the webcam, turning your head looks around the kitchen (the view turns further than your head; leaning gives parallax; R recentres). A guided calibration (open, pinch, push, reach: about 20 s, saved per participant, K to redo) fits the pinch thresholds, press depth, reach and smoothing to each person. A live camera preview shows the tracked skeletons, pinch state and height. **Touch screen** for phones and tablets (tap to grab or put down, drag to move, circle to unscrew, on-screen Press / Flip / Let go). **Mouse and keyboard** for piloting. Optional grasp aids (a ring under each hand that wraps the object you are about to take). |
| **Gaze** | Headset head ray; webcam iris tracking (MediaPipe face mesh, 9-point calibration, 5-point validation); any lab tracker over WebSocket (`tools/gaze_bridge_example.py`); mouse (debug only). AOIs are hit-tested per frame with an angular tolerance, and I-VT fixations are detected online. |
| **Saliency** | On desktop, a 160×90 AOI ID buffer plus an Itti–Koch-style saliency map of the *rendered* frame at 5 Hz. This gives each visible object's projected area, centroid and bottom-up salience. |
| **Logging** | One JSON per session (about 2 MB for a 30 s trial). Contains the layout (seeded), every event, 90 Hz head, gaze and hand streams, 30 Hz 21-joint hand skeletons (webcam and XR), object poses on change, AOI and saliency frames, calibration and a task summary. It is backed up to IndexedDB during the trial and can be downloaded or POSTed to an endpoint. |
| **Conditions** | Instructions: standard, *tidy* (close everything) or *cut* (cut in half). Layout: *counter* (everything out, as in the 2003 study) or *stored* (plate in the cupboard, knife in the drawer, jelly in the fridge). Distractors: full, sparse or none. The seed controls every placement. |
| **Autopilot** | A scripted participant (`?input=autopilot&gaze=autopilot`). It makes the sandwich through the same hand and manipulation code, with minimum-jerk reaches and task-driven gaze, which gives reference logs and end-to-end tests. |

## Analysis (`analysis/`, Python package `sandwich`)

```bash
cd analysis && pip install -e .
python -m sandwich.report ../examples/*.json --out ../reports
python -m pytest -q
```

* **Segmentation.** Events become grasp-level actions (`open_jar:pb`, `dip:jelly`, `spread:pb:A`, `close`, `extraneous:<obj>` …), with reach onsets taken from hand kinematics.
* **Optimal planning.** A shortest-path search over abstract task states (what's open, where the knife is, what each hand holds, where each hand is). Costs are Fitts-like reaches over the session's real object positions, plus manipulation times from `task/sandwich_task.json`, plus walking in the stored layout. It reports **efficiency** (optimal ÷ observed effort), **step-wise regret** (`c(s,a) + V*(s') − V*(s)`), order discordance, edit distance, extraneous actions and bimanual parallelism.
* **Gaze.** Offline fixations; Land & Hayhoe fixation roles (directing, guiding, look-ahead, checking, irrelevant); eye–hand lead times.
* **Attention models.** Nested conditional-logit choice models over visible AOIs: geometry → saliency → static relevance → just-in-time → plan / look-ahead → uncertainty-driven. Compared by leave-one-session-out cross-validated likelihood, BIC and top-1 accuracy.
* **Simulation.** `sandwich.simulate` generates participants with known attention weights and perturbed plans. The tests check parameter recovery, model recovery, zero regret for the optimal plan, and lower efficiency for perturbed plans.

On the four autopilot reference logs in `examples/`:

* Efficiency is 0.89–0.93 against the minimum-effort plan.
* 68–90% of fixations land on task objects.
* The plan-based attention models beat saliency and geometry by about 1.2 nats per fixation, as they should for the autopilot's gaze policy.

See `docs/DESIGN.md` for the task model, the feature definitions and the known limitations.

## Layout

```
index.html              landing page / setup
src/                    browser app (ES modules, no build step)
  core/world.js         entities, supports, settling
  scene/                kitchen shell, materials, procedural task props, seeded layouts
  interact/             Hand model, manipulation, mouse / webcam / WebXR / autopilot inputs
  gaze/                 gaze sources, AOI hit-testing, fixation detection, ID buffer + saliency
  task/, log/, ui/      task monitor, session logger, end-of-trial report
task/sandwich_task.json shared task definition (sub-goals, thresholds, action costs)
analysis/sandwich/      Python analysis package
tools/                  asset fetcher, headless autopilot runner, control tests, eye-tracker bridge template
assets/, vendor/        CC0 Poly Haven assets; three.js r187, MediaPipe tasks-vision, WebXR generic hand models (vendored, works offline)
examples/               autopilot reference sessions
```

## URL parameters

Any setup field can be prefilled in the URL, for example `?participant=p07&condition=tidy&layout=stored&seed=12&input=webcam&gaze=webcam`. Add `&auto=1` to skip the form. With webcam hands, `&calib=full` forces the full calibration, `&calib=quick` only the open-hand check, and `&calib=off` uses standard settings. `&fast=N` runs N fixed 1/60 s simulation steps per frame, for headless autopilot runs.

## Loading and texture detail

The default download is about 14 MB: meshopt-compressed geometry (5 MB) plus the standard texture set in `assets/lite/` (512 px props, 6 MB). "High" texture detail in the setup form uses the 1k originals instead (about 55 MB more). A loading screen shows progress, and start-up or graphics failures are reported on screen rather than as a blank canvas.

After changing assets: `python3 tools/fetch_assets.py --force`, then `sh tools/compress_models.sh` and `python3 tools/make_lite.py`. `sh tools/check_syntax.sh` parses every module.

## Phones and tablets

On a touch device the page picks touch controls and no post-processing by itself; on a phone it also thins the distractors. Portrait works (the view widens to keep the counter in frame), and landscape shows more.

## Testing the controls

```bash
python3 -m http.server 8811 &
python3 tools/test_controls.py synthetic   # the upright webcam mapping, driven by generated hand landmarks (no camera)
python3 tools/test_controls.py counter     # the counter mapping: generated palm-down hands in front of a pinhole camera
python3 tools/test_controls.py head        # webcam head tracking, with synthetic face poses
python3 tools/test_controls.py calibration # the guided webcam calibration, with generated hands (tidy, one-handed, twitchy)
python3 tools/test_controls.py mouse       # real mouse events
python3 tools/test_controls.py touch       # an emulated phone, real touch events
python3 tools/test_controls.py camera --video hands.y4m --shot out.png   # a video file as a fake webcam
```

Assets are CC0 from [Poly Haven](https://polyhaven.com). three.js is MIT, MediaPipe is Apache-2.0, and the hand models are from the MIT-licensed WebXR Input Profiles project.
