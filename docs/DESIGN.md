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
* *Webcam iris*: MediaPipe FaceLandmarker. Features are iris offsets plus head
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

## Known limitations (v0.1)

* Physics is light. Objects settle onto the highest support under their
  footprint, but nothing collides while it is held, and an object set down on
  top of a non-support object (a spoon) interpenetrates it.
* In mouse and webcam modes, held objects stay upright (yaw follows the hand,
  and a wrist roll or F flips slices). Only WebXR gives full 6-DoF holding.
* Webcam hand depth comes from apparent hand size, after a near/far calibration.
  It is fine for piloting but noisier than a headset.
* WebXR has no standard eye gaze, so headset sessions use the head ray. Eye gaze
  in a headset needs a vendor bridge, or an external tracker streaming into the
  socket source.
* The planner minimises summed effort, not makespan.
* Cutting is detected only as a stroke across a stacked sandwich; it is not
  rendered as a split.

## References

Ballard, Hayhoe & Pelz (1995) *J Cog Neurosci*. Hayhoe, Shrivastava, Mruczek &
Pelz (2003) *JoV*. Land & Hayhoe (2001) *Vision Res*. Land, Mennie & Rusted
(1999) *Perception*. Pelz & Canosa (2001) *Vision Res*. Sprague, Ballard &
Robinson (2007) *ACM TAP*. Itti & Koch (2001) *Nat Rev Neurosci*. Casiez,
Roussel & Vogel (2012) *CHI* (One-Euro filter).
