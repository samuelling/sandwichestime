# Design notes

## Why a virtual sandwich

Hayhoe, Shrivastava, Mruczek & Pelz (2003, *JoV* 3:6) recorded eye and hand
movements while people made a peanut-butter-and-jelly sandwich at a real table.
Together with Land, Mennie & Rusted's (1999) tea-making study and Land & Hayhoe
(2001), it established that in natural tasks:

* almost all fixations land on task-relevant objects; salient irrelevant ones are
  rarely fixated;
* gaze usually arrives at an object about 0.5–1 s before the hand (*just-in-time*);
* there are *look-ahead* fixations on objects used several seconds later,
  interleaved with the current subtask;
* fixations play distinct roles: locating, directing, guiding, checking.

A virtual version keeps the task, but every object's state is known at every
frame and the layout is under experimental control. That makes two things
measurable that were hard to measure with the real thing:

1. **Optimality of execution.** With exact object positions and a formal task
   model, a planner computes the minimum-effort way to make *this* sandwich in
   *this* layout, and each observed step can be scored against it.
2. **Formal models of attention.** Each fixation can be treated as a choice among
   the visible objects, with competing theories expressed as nested feature
   sets and compared by cross-validated likelihood.

## Task model

`task/sandwich_task.json` is shared by the browser and the analysis. It holds the
instructions, the task objects, the sub-goal partial order, the thresholds
(grasp radius, spread coverage, fixation I-VT) and the action time costs.

The planner state (`analysis/sandwich/planner.py`) tracks:

* whether the bag and jars are open, and where the lids are;
* the number of slices on the plate;
* where the knife is (home, held left or right, or put down);
* what is on the knife, and its residue;
* which spreads are on which slice (A or B);
* whether the sandwich is closed, cut and finished;
* which containers are open and which objects have been fetched (stored layout);
* where each hand is.

Action cost is a Fitts-like reach (`reach_base + reach_s_per_m × distance`
between the hand's current node and the action's node, from the session's real
layout), plus a fixed manipulation time, plus walking when a node is more than
0.8 m lateral to the standing position. Dijkstra gives the optimum.

* **Efficiency** is optimal cost ÷ observed cost, where the observed sequence is
  replayed through the same cost model.
* **Step-wise regret** is `c(s,a) + V*(s') − V*(s)`: how many seconds of extra
  effort each observed choice committed the participant to. It is 0 for an
  optimal step.
* Extraneous actions (touching a distractor, re-grasping, setting the heel
  aside) cost a reach, a grasp and a release, and leave the state unchanged.

Cost is summed over both hands (minimum effort). How much of the work overlapped
between the hands is reported separately as `parallelism`. A makespan-optimal
bimanual scheduler would be a natural extension.

The optimal plan for the default layout is not always the "obvious" sequence.
For example, it may stack both spreads on one slice and use the other as a lid,
which avoids a flip. That is a feature: the planner tells you what an efficient
strategy *is* for each layout, so strategy choice can be studied directly.

## Gaze

**Sources.**

* *Headset*: the head ray, since WebXR exposes no standard eye gaze.
* *Webcam iris* (untested on a person): MediaPipe FaceLandmarker. Features are iris offsets plus head
  pose, mapped to the screen by a 2nd-order polynomial ridge regression, with
  9-point calibration and 5-point validation (median error is logged).
* *External tracker*: EyeLink, Tobii or Pupil, streamed over WebSocket.
* *Mouse*: debug only.

**AOIs.** Every frame, the gaze ray is ray-cast against all object meshes, and
the nearest object within the angular tolerance (default 1.5°) is also recorded.
On desktop, a 160×90 ID buffer plus a saliency map are rendered at 5 Hz, giving
the projected area, centroid and bottom-up salience of every visible AOI.

**Saliency** is Itti–Koch style: centre–surround on intensity and R–G / B–Y
opponency at two scale pairs, plus edge energy as an orientation proxy. It is
computed on the actual rendered frame, so it is the salience of what the
participant saw.

**Fixations.** I-VT (40°/s, 80 ms minimum) runs online in the browser, and again
offline in `sandwich.gaze.fixations` with adjustable thresholds.

**Roles** (`sandwich.gaze.roles`):

* *directing*: on the next manual target, less than 1 s before contact;
* *look-ahead*: on a target that is contacted more than 1 s later, with other
  contacts in between;
* *guiding*: on the object being manipulated or its destination;
* *checking*: on an object already acted on;
* *irrelevant*: on a distractor;
* *surface*: on a fixture such as the counter or wall.

## Attention models

At each fixation onset, `P(fixate a) = softmax_a(w · x_a)` over the visible AOIs.
The candidate features are:

| feature | meaning |
|---|---|
| `area` | log projected area |
| `ecc` | distance from the previous fixation (deg / 10) |
| `sal` | mean saliency |
| `task` | a is a task object |
| `cur` | a is the next manual target (within 2.5 s) |
| `next1`, `next2` | the following targets (look-ahead) |
| `prev` | the last target (checking) |
| `held` | a is in a hand (monitoring) |
| `unc` | log time since a was last fixated, for task objects (uncertainty growth) |

Each model uses a subset of these features:

| model | features | account |
|---|---|---|
| null | area, ecc | geometry only |
| saliency | + sal | bottom-up |
| relevance | + task | static relevance |
| jit | + task, cur | just-in-time |
| plan | + next1, next2, prev, held | look-ahead and checking |
| uncertainty | + unc | Sprague, Ballard & Robinson (2007) |
| full | everything | |

Models are compared by leave-one-session-out cross-validated log-likelihood per
fixation, plus BIC and top-1 accuracy. `sandwich.simulate` generates
participants from known weights, and the tests check both parameter recovery
and model recovery before any real data are trusted.

## Layout control

* `counter`: everything is out on the counter, as in the original study.
* `stored`: the plate is in a cupboard, the knife in a drawer and the jelly in
  the fridge, which adds search, locomotion and container actions.
* Distractor density can be `full`, `sparse` or `none`. Several distractors are
  deliberately sandwich-adjacent (hamburger buns, croissant) to test task
  specificity.
* Every placement comes from a seed and is written to the log.

## Hands

Every input source produces the same thing: 21 hand landmarks in world space, a
grip point, a pinch state and a hand frame. `HandRig` turns the landmarks into a
skinned hand (the 25-bone WebXR generic-hand mesh). Landmarks carry positions
only, so each bone's orientation is built from the bone direction plus a palm
reference axis, and that construction is calibrated once against the mesh's
bind pose. In a headset the runtime's own joint poses are copied directly.

## Webcam control

A single webcam measures the image plane well and depth poorly, and the task
lives on a horizontal counter. So the precise axes go where precision matters.

| what the participant does | what happens |
|---|---|
| moves a hand in the image | the virtual hand goes to whatever a ray through that screen position lands on: left/right and near/far on the counter, or up onto shelves and handles |
| pinches thumb and index | grasps what the hand is on (the ray is refined to the smallest graspable thing there: the clip on the bag, the lid on the jar) |
| moves the hand toward the camera | lowers what it holds. Objects are carried 7 cm up; they touch down at 60% of the participant's own comfortable push (about 15% closer without calibration), and pulling back lifts higher |
| rotates the hand in the image | turns the held object; unscrews a lid, with a 2.5× gain so two strokes open it |
| turns the hand over | flips a slice |
| holds a hand at the screen edge | steps sideways |

Put another way, the participant's hands act on a copy of the counter that
stands upright in front of the webcam: up is away from the body, and toward the
camera is down. Hand shape comes from MediaPipe's metric landmarks, rotated by
that same tilt.

Details that matter in practice:

* **Depth** is the ratio of image size to metric size pooled over all bones, so
  it does not change when the fingers curl or the palm tilts.
* **Left and right** are kept apart by position continuity, because MediaPipe's
  handedness label flickers.
* **Dropouts** shorter than 0.6 s freeze the hand and keep its grasp; longer
  ones release.
* **Occlusion**: a hand can only go to what the participant can see. Something
  hidden behind a taller object has to be approached from a visible part. The
  layout generator keeps the knife out of such blind spots.
* The first slice out of the bag is the heel, as in a real loaf.

### Calibration

People differ in exactly the quantities this mapping depends on: how close their
fingertips come when they pinch (and how MediaPipe reads it), how far they push,
where their hands sit in the picture, and how noisy their camera is. Fixed
numbers fit an average hand and feel fiddly on everyone else, so the first
webcam session for a participant starts with four poses on a large mirrored
camera view. Each is accepted by itself once it has been held, and each sets one
part of the mapping:

| pose | measured | sets |
|---|---|---|
| open hands, held still (1.2 s) | open thumb-index gap, neutral distance, frame-to-frame jitter of the palm | the "open" end of the pinch scale; the smoothing of the pointer at rest (just enough to bring this camera's jitter down to about 0.1% of the screen, within 0.7 to 2.2 Hz) |
| pinch (0.9 s) | closed gap and its wobble | per-hand thresholds: grasp at 20% of the way from closed to open (more if the closed gap wobbles, up to 40%), release at 45% (up to 75% when the range is small) |
| pinch and push toward the screen (0.8 s) | comfortable push, as a change in log image size | the height gain: a held object touches down at 60% of that push |
| sweep the reachable area | where the palms go in the picture | the box that maps onto the screen (1.5th to 98.5th percentile, 2% inside) |

Each pose is acted out first by a pair of cartoon hands, drawn from the same
canonical hand shape the tracker is tested with and seen as in the mirrored
picture (palms toward the screen, fingers up, thumbs inward). The cartoon plays
once over a dimmed camera view, with nothing measured, then "Your turn", then
keeps looping small in a corner while the participant copies it. Clicking the
picture cuts the demo short. The cartoon pinch is drawn as it looks from the
front (index curling over to meet the thumb, other fingers up) rather than as
the tracker's pinch shape, which curls the fingers toward the camera and reads
as a fist when seen head-on.

Anything that cannot be measured (a pose skipped or timed out) keeps its
standard value, and a hand that never appears borrows the other hand's values.
While the poses are being measured the virtual hands are parked, so pinching
cannot grab or drop anything. The result is stored in the browser under the
participant ID; later sessions for that ID only do a one-second open-hand check
and re-measure if the hand looks more than 40% different. K recalibrates at any
time (with empty hands), and `calib=full|quick|off` in the URL forces a mode.
Every calibration is logged with its raw measurements, the derived settings and
which poses fell back to standard values, so sessions can be compared or
excluded on that basis.

Three changes that do not depend on calibration came with it. A pressed object
stays down until it is lifted clear by 2 cm (before, it chattered at the contact
height). The reference distance keeps adapting for 0.35 s after a grasp, so the
change in apparent hand size caused by the pinch itself no longer moves the
object. And the pointer holds still for the two frames in which a pinch or
release is being confirmed.

`tools/test_controls.py calibration` walks synthetic hands through all four
poses (including a loose pinch that the standard threshold misses), a saved
calibration, a one-handed participant and skipping.
`tools/test_controls.py synthetic` drives this whole path with generated
landmarks and checks grasping, carrying, pressing, flipping, dropouts,
unscrewing and stepping.

## Touch control

The mouse model re-cut for one finger. A tap sends the active hand to that spot
and, once it arrives, grabs what is there (or puts down what it holds). A drag
moves the hand, which rides a little above the finger so the finger does not
cover it. With a lid grabbed, dragging in a circle around it turns it. Buttons
cover what a finger cannot express: Press (lower the held object to dip, spread
or cut), Flip, Let go, switch hands, and step sideways.

Narrow screens widen the vertical field of view so that about 66° of the
counter stays visible left to right; the actual value is logged in
`meta.fovY`.

## Grasp aids

A ring on the surface under each hand: small when idle (it grows with the hand's
height), wrapped around the base of the object about to be grasped, and marking
the landing spot while carrying. These are extra visual cues that the original
task did not have, so they are optional and recorded in `meta.aids`. Turn them
off for sessions where gaze is the measure of interest, or treat them as a
factor.

## Known limitations (v0.4)

* Physics is light. Objects settle onto the highest support under their
  footprint, but nothing collides while it is held, and an object set down on
  top of a non-support object (a spoon) interpenetrates it.
* In mouse and webcam modes, held objects stay upright (yaw follows the hand,
  and turning the hand over flips slices). Only WebXR gives full 6-DoF holding.
* Webcam control and its calibration are tested with synthetic landmarks. The
  fractions that turn measurements into settings (grasp at 20% and release at
  45% of the pinch range, touch down at 60% of the push; `deriveCal` in
  `src/interact/webcam.js`) are reasoned choices, not yet tuned on people.
* The reach step ends when the box has stopped growing for 2.5 s, so a long
  pause in the middle of the sweep ends it early. The box is drawn live and
  K redoes it.
* The headset path (direct joint poses onto the hand mesh) is untested on a
  device.
* WebXR has no standard eye gaze, so headset sessions use the head ray. Eye gaze
  in a headset needs a vendor bridge, or an external tracker streaming into the
  socket source.
* Hands are not gaze AOIs: gaze passes through them to the object behind.
* The planner minimises summed effort, not makespan.
* Cutting is detected only as a stroke across a stacked sandwich; it is not
  rendered as a split.
* Touch control has been tested with emulated touch events in a desktop
  browser and loads in Safari's engine with an iPhone profile, not yet on a
  physical phone. Memory on older phones is the open question.
* Layouts changed in v0.2 (more props) and v0.3 (the knife is never placed
  hidden behind another object), so a seed gives a different arrangement than
  in earlier versions. Each log records its own layout.

## References

Ballard, Hayhoe & Pelz (1995) *J Cog Neurosci*. Hayhoe, Shrivastava, Mruczek &
Pelz (2003) *JoV*. Land & Hayhoe (2001) *Vision Res*. Land, Mennie & Rusted
(1999) *Perception*. Pelz & Canosa (2001) *Vision Res*. Sprague, Ballard &
Robinson (2007) *ACM TAP*. Itti & Koch (2001) *Nat Rev Neurosci*. Casiez,
Roussel & Vogel (2012) *CHI* (One-Euro filter).
