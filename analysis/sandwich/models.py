"""Attention models as nested conditional-logit (softmax) choice models over AOIs.

At each fixation onset the participant "chooses" one AOI among those visible.
Each candidate a has features x_a(t); P(a) = exp(w·x_a) / Σ_b exp(w·x_b).
Classical accounts of gaze in natural tasks are feature subsets:

    null         area, ecc                      geometry only (big + near things get looked at)
    saliency     + sal                          bottom-up (Itti & Koch)
    relevance    + task                         static task relevance (any task object)
    jit          + task, cur                    just-in-time (Ballard, Hayhoe & Pelz 1995)
    plan         + next1, next2, prev, held     look-ahead / checking / monitoring (Land & Hayhoe 2001; Pelz & Canosa 2001)
    uncertainty  + unc                          uncertainty-driven re-fixation (Sprague, Ballard & Robinson 2007)
    full         plan + unc + sal
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import logsumexp
from .gaze import GazeData

FEATURES = ["area", "ecc", "sal", "task", "cur", "next1", "next2", "prev", "held", "unc", "refix"]
MODELS = {
    "null": ["area", "ecc"],
    "saliency": ["area", "ecc", "sal"],
    "relevance": ["area", "ecc", "task"],
    "jit": ["area", "ecc", "task", "cur"],
    "plan": ["area", "ecc", "task", "cur", "next1", "next2", "prev", "held"],
    "uncertainty": ["area", "ecc", "task", "cur", "next1", "next2", "prev", "held", "unc"],
    "full": ["area", "ecc", "sal", "task", "cur", "next1", "next2", "prev", "held", "unc"],
}


def design(gd: GazeData, horizon=2.5):
    """Build per-fixation candidate feature matrices. Returns list of (X[n_cand, F], chosen_idx, labels)."""
    T = gd.targets; F = gd.fix
    trials, last_fix_t, prev = [], {}, None
    for f in F.itertuples():
        C = gd.candidates(f.t0)
        if not C:
            continue
        if f.group not in C:
            C = dict(C); C[f.group] = (0.002, 0.0, f.sx if np.isfinite(f.sx) else 0.5, f.sy if np.isfinite(f.sy) else 0.5)
        nxt = T[T.t >= f.t0]; prv = T[T.t < f.t0]
        seq = []
        for g in nxt.group:
            if g is not None and (not seq or seq[-1] != g): seq.append(g)
        cur = seq[0] if seq and nxt.iloc[0].t - f.t0 <= horizon else None
        nx1 = seq[1] if len(seq) > 1 else None; nx2 = seq[2] if len(seq) > 2 else None
        pv = prv.iloc[-1].group if len(prv) else None
        held = gd.held(f.t0)
        labels = list(C.keys()); X = np.zeros((len(labels), len(FEATURES)))
        px, py = (prev.sx, prev.sy) if prev is not None and np.isfinite(prev.sx) else (0.5, 0.5)
        for i, g in enumerate(labels):
            area, sal, cx, cy = C[g]
            X[i] = [np.log(area + 1e-4), np.hypot((cx - px) * gd.fov[0], (cy - py) * gd.fov[1]) / 10.0, sal,
                    g in gd.task_groups, g == cur, g == nx1 and g != cur, g == nx2 and g not in (cur, nx1), g == pv and g != cur,
                    g in held, (g in gd.task_groups) * np.log1p(f.t0 - last_fix_t.get(g, 0.0)), prev is not None and g == prev.group]
        trials.append((X, labels.index(f.group), labels))
        last_fix_t[f.group] = f.t1; prev = f
    return trials


def standardise(trials):
    """z-score continuous features across all candidates (binary ones left alone)."""
    allX = np.vstack([X for X, _, _ in trials])
    mu, sd = allX.mean(0), allX.std(0) + 1e-9
    cont = [FEATURES.index(k) for k in ("area", "ecc", "sal", "unc")]
    out = []
    for X, c, l in trials:
        Z = X.copy(); Z[:, cont] = (X[:, cont] - mu[cont]) / sd[cont]; out.append((Z, c, l))
    return out, (mu, sd)


def _nll(w, trials, idx, lam):
    ll, g = 0.0, np.zeros_like(w)
    for X, c, _ in trials:
        Xs = X[:, idx]; u = Xs @ w; lse = logsumexp(u); p = np.exp(u - lse)
        ll += u[c] - lse; g += Xs[c] - p @ Xs
    return -ll + lam * w @ w, -g + 2 * lam * w


def fit(trials, model="full", lam=1e-3):
    feats = MODELS[model] if isinstance(model, str) else list(model)
    idx = [FEATURES.index(f) for f in feats]
    res = minimize(_nll, np.zeros(len(idx)), args=(trials, idx, lam), jac=True, method="L-BFGS-B")
    w = res.x
    # analytic Hessian of the conditional logit -> standard errors
    H = np.zeros((len(idx), len(idx)))
    for X, c, _ in trials:
        Xs = X[:, idx]; u = Xs @ w; p = np.exp(u - logsumexp(u)); mu = p @ Xs
        H += (Xs * p[:, None]).T @ Xs - np.outer(mu, mu)
    try: se = np.sqrt(np.diag(np.linalg.inv(H + 2 * lam * np.eye(len(idx)))))
    except np.linalg.LinAlgError: se = np.full(len(idx), np.nan)
    ll = -res.fun + lam * w @ w
    n = len(trials); k = len(idx)
    acc = np.mean([np.argmax(X[:, idx] @ w) == c for X, c, _ in trials])
    chance = np.mean([1 / len(X) for X, _, _ in trials])
    return {"model": model if isinstance(model, str) else "custom", "features": feats, "w": dict(zip(feats, w)), "se": dict(zip(feats, se)),
            "ll": ll, "ll_per_fix": ll / n, "bic": -2 * ll + k * np.log(n), "aic": -2 * ll + 2 * k, "n": n, "top1": acc, "chance": chance}


def loglik(trials, feats, w):
    idx = [FEATURES.index(f) for f in feats]; ww = np.array([w[f] for f in feats])
    return sum((X[:, idx] @ ww)[c] - logsumexp(X[:, idx] @ ww) for X, c, _ in trials)


def compare(trials_by_session: dict[str, list], models=None, k=5, seed=0):
    """Cross-validated log-likelihood per fixation. Leave-one-session-out if >1 session, else k-fold."""
    models = models or list(MODELS)
    names = list(trials_by_session)
    allT = [(s, t) for s in names for t in trials_by_session[s]]
    if len(names) > 1:
        folds = [[i for i, (s, _) in enumerate(allT) if s == n] for n in names]
    else:
        rng = np.random.default_rng(seed); perm = rng.permutation(len(allT)); folds = [list(perm[i::k]) for i in range(k)]
    rows = []
    full = [t for _, t in allT]
    for m in models:
        cv = 0.0
        for test in folds:
            ts = set(test); train = [t for i, (_, t) in enumerate(allT) if i not in ts]
            r = fit(train, m); cv += loglik([allT[i][1] for i in test], r["features"], r["w"])
        r = fit(full, m)
        rows.append({"model": m, "k": len(r["features"]), "cv_ll_per_fix": cv / len(allT), "ll_per_fix": r["ll_per_fix"], "bic": r["bic"],
                     "top1": r["top1"], "chance": r["chance"], **{f"w_{f}": v for f, v in r["w"].items()}})
    df = pd.DataFrame(rows)
    df["delta_cv"] = df.cv_ll_per_fix - df.cv_ll_per_fix.max()
    return df.sort_values("cv_ll_per_fix", ascending=False).reset_index(drop=True)
