"""Descriptive and optimality metrics for one session."""
from __future__ import annotations
import numpy as np
import pandas as pd
from .io import Session
from .segment import segment
from .planner import evaluate
from . import gaze as G


def kinematics(sess: Session) -> dict:
    t = sess.t; out = {}
    for side in ("L", "R"):
        g = sess.hand(side)["grip"]; tr = sess.hand(side)["tracked"] > 0
        if len(g) < 3:
            continue
        d = np.linalg.norm(np.diff(g, axis=0), axis=1); d[(d > 0.25) | ~tr[1:]] = 0
        v = d / np.maximum(np.diff(t), 1e-3)
        out[side] = {"path_m": float(d.sum()), "peak_speed": float(np.percentile(v, 99)), "active_frac": float((v > 0.05).mean())}
    HL, HR = sess.hand("L")["holding"], sess.hand("R")["holding"]
    busy = np.array([bool(a) for a in HL]) & np.array([bool(b) for b in HR])
    out["both_holding_frac"] = float(busy.mean()) if len(busy) else 0.0
    return out


def action_table(sess: Session, acts=None) -> pd.DataFrame:
    acts = acts or segment(sess)
    return pd.DataFrame([{"t": a.t, "t_start": a.t_start, "t_end": a.t_end, "hand": a.hand, "action": a.name, "obj": a.obj, **a.detail} for a in acts])


def parallelism(acts) -> float:
    """Fraction of task time in which both hands were engaged in actions (reach-onset .. end)."""
    if not acts:
        return 0.0
    T0 = min(a.t_start for a in acts); T1 = max(a.t_end for a in acts)
    grid = np.linspace(T0, T1, 2000)
    busy = {h: np.zeros_like(grid, bool) for h in "LR"}
    for a in acts:
        busy[a.hand] |= (grid >= a.t_start) & (grid <= max(a.t_end, a.t))
    return float((busy["L"] & busy["R"]).mean())


def order_deviation(observed: list[str], optimal: list[str]) -> dict:
    """Kendall-style discordance between the order of shared task actions, and edit distance."""
    obs = [a for a in observed if not a.startswith("extraneous")]
    common = [a for a in dict.fromkeys(obs) if a in optimal]
    pos_o = {a: obs.index(a) for a in common}; pos_p = {a: optimal.index(a) for a in common}
    disc = sum(1 for i, a in enumerate(common) for b in common[i + 1:] if (pos_o[a] - pos_o[b]) * (pos_p[a] - pos_p[b]) < 0)
    pairs = len(common) * (len(common) - 1) / 2
    # Levenshtein on action names
    n, m = len(obs), len(optimal); D = np.zeros((n + 1, m + 1), int); D[:, 0] = range(n + 1); D[0, :] = range(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = min(D[i - 1, j] + 1, D[i, j - 1] + 1, D[i - 1, j - 1] + (obs[i - 1] != optimal[j - 1]))
    return {"discordant_pairs": disc, "discordance": disc / pairs if pairs else 0.0, "edit_distance": int(D[n, m]),
            "n_observed": len(obs), "n_optimal": len(optimal)}


def session_metrics(sess: Session) -> dict:
    acts = segment(sess)
    opt = evaluate(sess, acts)
    fx = G.fixations(sess)
    gd = G.gaze_data(sess, fx)
    roles = G.roles(gd) if len(gd.fix) else pd.DataFrame(columns=["role"])
    eh = G.eye_hand(gd) if len(gd.fix) else pd.DataFrame(columns=["lead"])
    S = sess.summary
    plan_names = [a for a, _, _ in opt.optimal_plan]
    obs_names = [s["action"] for s in opt.steps]
    reg = np.array([float(s["regret"]) for s in opt.steps]) if opt.steps else np.zeros(0)
    return {
        "session": sess.path.name, "participant": sess.meta.get("participant"), "condition": sess.meta.get("condition"),
        "layout": sess.meta.get("layout"), "seed": sess.meta.get("seed"), "input": sess.meta.get("input"), "gaze": sess.meta.get("gaze"),
        "duration_s": sess.duration, "completed": S.get("completed"), "sandwich_valid": (S.get("sandwich") or {}).get("valid"),
        "n_actions": len(acts), "n_extraneous": opt.n_extraneous, "n_invalid": opt.n_invalid,
        "optimal_cost_s": opt.optimal_cost, "observed_cost_s": opt.observed_cost, "efficiency": opt.efficiency,
        "time_efficiency": opt.optimal_cost / sess.duration if sess.duration else np.nan,
        "total_regret_s": float(reg.sum()), "max_step_regret_s": float(reg.max()) if len(reg) else 0.0,
        "parallelism": parallelism(acts), **{f"order_{k}": v for k, v in order_deviation(obs_names, plan_names).items()},
        "contaminations": (S.get("counts") or {}).get("contamination"), "drops": (S.get("counts") or {}).get("drops"),
        "grasp_misses": (S.get("counts") or {}).get("misses"),
        "pb_coverage": ((S.get("sandwich") or {}).get("inner") or {}).get("pb"), "jelly_coverage": ((S.get("sandwich") or {}).get("inner") or {}).get("jelly"),
        "n_fixations": len(fx), "pct_task_fixations": float(100 * fx.group.isin(gd.task_groups).mean()) if len(fx) else np.nan,
        "mean_fix_ms": float(1000 * fx.dur.mean()) if len(fx) else np.nan,
        **{f"role_{k}": int(v) for k, v in roles.role.value_counts().items()},
        "eye_hand_lead_median_s": float(eh.lead.median()) if len(eh) else np.nan,
        "kinematics": kinematics(sess),
        "_actions": acts, "_opt": opt, "_fix": fx, "_gd": gd, "_roles": roles,
    }
