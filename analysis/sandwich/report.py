"""Command-line report for one or more sessions.

    python -m sandwich.report examples/*.json --out reports/

Writes, per run: metrics.csv (one row per session), models.csv (attention-model
comparison across all sessions), and per-session figures: timeline (observed vs
optimal plan, hands, gaze roles) and step-wise regret.
"""
from __future__ import annotations
import argparse, json
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from .io import load, group_of
from .metrics import session_metrics
from . import models as M

ROLE_COL = {"directing": "#d0743c", "guiding": "#3c78a8", "look-ahead": "#7a4ea3", "checking": "#5b9b4e",
            "irrelevant": "#b9b2a6", "surface": "#ded7cb", "other-task": "#c8a43a"}
plt.rcParams.update({"font.family": "sans-serif", "font.size": 9, "axes.spines.top": False, "axes.spines.right": False})


def timeline(m: dict, path: Path):
    acts, opt, roles = m["_actions"], m["_opt"], m["_roles"]
    fig, ax = plt.subplots(figsize=(11, 3.6))
    y = {"optimal": 4, "L": 3, "R": 2, "gaze": 1}
    names = sorted({a.name.split(":")[0] for a in acts} | {a.split(":")[0] for a, _, _ in opt.optimal_plan})
    cmap = plt.get_cmap("tab20"); col = {n: cmap(i % 20) for i, n in enumerate(names)}
    for a in acts:
        ax.barh(y[a.hand], max(0.15, a.t_end - a.t_start), left=a.t_start, height=0.6, color=col[a.name.split(":")[0]], edgecolor="white", lw=0.5)
        ax.text(a.t_start + 0.05, y[a.hand] + 0.38, a.name.replace("extraneous:", "x:"), fontsize=6, rotation=35, ha="left", va="bottom")
    t = 0.0
    for a, h, c in opt.optimal_plan:
        ax.barh(y["optimal"], c, left=t, height=0.6, color=col[a.split(":")[0]], edgecolor="white", lw=0.5)
        ax.text(t + 0.05, y["optimal"] + 0.38, f"{h}:{a}", fontsize=6, rotation=35, ha="left", va="bottom"); t += c
    for r in roles.itertuples():
        ax.barh(y["gaze"], r.t1 - r.t0, left=r.t0, height=0.6, color=ROLE_COL.get(r.role, "#999"))
    ax.set_yticks(list(y.values()), ["optimal plan\n(sequential effort)", "left hand", "right hand", "gaze role"])
    ax.set_xlabel("time (s)"); ax.set_ylim(0.4, 5.6)
    handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in ROLE_COL.values()]
    ax.legend(handles, ROLE_COL.keys(), ncol=7, fontsize=7, frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.2))
    ax.set_title(f"{m['session']}  ·  efficiency {m['efficiency']:.2f}  ·  {m['duration_s']:.1f} s observed vs {m['optimal_cost_s']:.1f} s optimal effort", fontsize=9)
    fig.tight_layout(); fig.savefig(path, dpi=160); plt.close(fig)


def regret_plot(m: dict, path: Path):
    st = m["_opt"].steps
    if not st: return
    fig, ax = plt.subplots(figsize=(8, 2.8))
    r = [float(s["regret"]) for s in st]
    ax.bar(range(len(st)), r, color=["#b9b2a6" if s["extraneous"] else "#d0743c" if x > 0.5 else "#3c78a8" for s, x in zip(st, r)])
    ax.set_xticks(range(len(st)), [f"{s['hand']}:{s['action']}" for s in st], rotation=60, ha="right", fontsize=7)
    ax.set_ylabel("regret (s)"); ax.axhline(0, color="k", lw=0.5)
    ax.set_title("step-wise regret: c(s,a) + V*(s') − V*(s)", fontsize=9)
    fig.tight_layout(); fig.savefig(path, dpi=160); plt.close(fig)


def model_plot(df: pd.DataFrame, path: Path):
    fig, ax = plt.subplots(figsize=(5.5, 2.8))
    d = df.sort_values("cv_ll_per_fix")
    ax.barh(d.model, d.cv_ll_per_fix - d.cv_ll_per_fix.min(), color="#3c78a8")
    ax.set_xlabel("cross-validated log-lik per fixation\n(relative to worst model)")
    ax.set_title("attention models", fontsize=9)
    fig.tight_layout(); fig.savefig(path, dpi=160); plt.close(fig)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+"); ap.add_argument("--out", default="reports"); ap.add_argument("--no-models", action="store_true")
    a = ap.parse_args(argv)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    rows, trials = [], {}
    for f in a.files:
        s = load(f); m = session_metrics(s)
        stem = Path(f).stem
        timeline(m, out / f"{stem}_timeline.png"); regret_plot(m, out / f"{stem}_regret.png")
        pd.DataFrame(m["_opt"].steps).to_csv(out / f"{stem}_steps.csv", index=False)
        if not a.no_models and len(m["_gd"].fix):
            trials[stem] = M.design(m["_gd"])
        flat = {k: v for k, v in m.items() if not k.startswith("_") and k != "kinematics"}
        for side, kv in m["kinematics"].items():
            if isinstance(kv, dict): flat.update({f"{side}_{k}": v for k, v in kv.items()})
            else: flat[side] = kv
        rows.append(flat)
        print(f"{stem}: {m['duration_s']:.1f}s  efficiency {m['efficiency']:.2f}  regret {m['total_regret_s']:.2f}s  "
              f"extraneous {m['n_extraneous']}  parallel {m['parallelism']:.2f}  fixations {m['n_fixations']} ({m['pct_task_fixations']:.0f}% task)")
    pd.DataFrame(rows).to_csv(out / "metrics.csv", index=False)
    if trials and sum(len(v) for v in trials.values()) >= 20:
        df = M.compare(trials)
        df.to_csv(out / "models.csv", index=False); model_plot(df, out / "models.png")
        print("\nattention models (cross-validated log-likelihood per fixation):")
        print(df[["model", "k", "cv_ll_per_fix", "delta_cv", "top1", "chance"]].to_string(index=False, float_format=lambda x: f"{x:.3f}"))
    print(f"\nwrote {out}/")


if __name__ == "__main__":
    main()
