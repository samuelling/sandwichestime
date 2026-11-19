"""Synthetic participants for vetting the analysis before real data exist.

`simulate_gaze` produces GazeData with a known generating attention model, so we
can check parameter recovery and model recovery (does the right model win?).
`perturb_plan` produces sub-optimal action sequences to check the optimality
metrics respond the way they should.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from scipy.special import logsumexp
from .gaze import GazeData
from .models import FEATURES, MODELS

TASK = ["bread_bag", "slice", "plate", "pb_jar", "jelly_jar", "knife", "towel", "bell"]
# a canonical manual sequence (groups contacted, in order) — the optimal plan mapped to objects
SEQ = ["bread_bag", "counter", "bread_bag", "plate", "bread_bag", "plate", "pb_jar", "counter", "knife", "pb_jar", "slice",
       "jelly_jar", "counter", "jelly_jar", "slice", "towel", "slice", "slice", "bell"]


def scene(rng, n_distractors=24):
    """Static candidate set: area fraction, saliency, screen centroid."""
    C = {}
    for g in TASK:
        C[g] = (rng.uniform(0.004, 0.03), rng.uniform(0.1, 0.4), rng.uniform(0.15, 0.85), rng.uniform(0.45, 0.85))
    for i in range(n_distractors):
        C[f"distractor_{i:02d}"] = (rng.uniform(0.002, 0.03), rng.uniform(0.05, 0.6), rng.uniform(0.05, 0.95), rng.uniform(0.3, 0.9))
    for g, a in (("counter", 0.3), ("wall", 0.25), ("cabinet", 0.1)):
        C[g] = (a, rng.uniform(0.05, 0.15), 0.5, {"counter": 0.65, "wall": 0.25, "cabinet": 0.95}[g])
    return C


def simulate_gaze(weights: dict, seed=0, n_reps=1, mean_fix=0.35, step_mean=1.3):
    """Generate fixations from a conditional-logit attention model with `weights` (raw, unstandardised features)."""
    rng = np.random.default_rng(seed)
    C = scene(rng)
    # manual timeline
    t, rows = 0.5, []
    for _ in range(n_reps):
        for g in SEQ:
            t += rng.gamma(4, step_mean / 4); rows.append((t, "R", g, "grasp"))
    targets = pd.DataFrame(rows, columns=["t", "hand", "group", "kind"])
    T_end = t + 1
    held_iv = [(targets.t[i], targets.t[i + 1], targets.group[i]) for i in range(len(targets) - 1) if targets.group[i] in ("knife",)]
    held = lambda tt: {g for a, b, g in held_iv if a <= tt < b}
    task = set(TASK)
    gd = GazeData(pd.DataFrame(columns=["t0", "t1", "group", "sx", "sy"]), targets, task, lambda tt: C, held, (80.0, 56.0), f"sim{seed}")
    feats = list(weights); w = np.array([weights[f] for f in feats]); idx = [FEATURES.index(f) for f in feats]
    # sequential sampling (features depend on fixation history)
    from .models import design
    fix, tt = [], 0.0
    while tt < T_end:
        dur = rng.gamma(4, mean_fix / 4)
        gd.fix = pd.DataFrame(fix + [{"t0": tt, "t1": tt + dur, "group": "counter", "sx": 0.5, "sy": 0.6}])
        X, _, labels = design(gd)[-1]
        u = X[:, idx] @ w; p = np.exp(u - logsumexp(u))
        g = labels[rng.choice(len(labels), p=p)]
        cx, cy = C[g][2], C[g][3]
        fix.append({"t0": tt, "t1": tt + dur, "group": g, "sx": cx + rng.normal(0, 0.01), "sy": cy + rng.normal(0, 0.01)})
        tt += dur + rng.gamma(2, 0.02)
    gd.fix = pd.DataFrame(fix)
    return gd


# generating weights for each model (raw feature units)
TRUE = {
    "null": {"area": 0.8, "ecc": -0.6},
    "saliency": {"area": 0.6, "ecc": -0.5, "sal": 4.0},
    "jit": {"area": 0.5, "ecc": -0.4, "task": 0.8, "cur": 3.0},
    "plan": {"area": 0.5, "ecc": -0.4, "task": 0.8, "cur": 2.6, "next1": 1.6, "next2": 0.8, "prev": 1.0, "held": 1.0},
    "uncertainty": {"area": 0.5, "ecc": -0.4, "task": 0.4, "cur": 2.4, "next1": 1.4, "next2": 0.6, "prev": 0.8, "held": 0.8, "unc": 0.9},
}


def perturb_plan(plan_actions: list[tuple[str, str]], rng, p_swap=0.2, p_extra=0.15, p_hand=0.2):
    """Make a plausible sub-optimal sequence: swap neighbours, insert extraneous grasps, switch hands."""
    seq = list(plan_actions)
    for i in range(len(seq) - 1):
        if rng.random() < p_swap: seq[i], seq[i + 1] = seq[i + 1], seq[i]
    out = []
    for a, h in seq:
        if rng.random() < p_extra: out.append(("extraneous:distractor", "L" if rng.random() < 0.5 else "R"))
        out.append((a, ("L" if h == "R" else "R") if rng.random() < p_hand else h))
    return out
