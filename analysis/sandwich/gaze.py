"""Gaze: offline fixation detection, Land & Hayhoe fixation roles, eye–hand timing,
and the GazeData container shared by real sessions and simulations."""
from __future__ import annotations
from dataclasses import dataclass, field
from collections import Counter
import numpy as np
import pandas as pd
from .io import Session, group_of, FIXTURES


def fixations(sess: Session, v_thresh=None, min_dur=None, merge_gap=0.075, merge_deg=1.0) -> pd.DataFrame:
    """I-VT on the logged gaze rays (same thresholds as the browser by default)."""
    th = sess.task["thresholds"]
    v_thresh = v_thresh or th["fixation_velocity_deg_s"]; min_dur = (min_dur or th["fixation_min_ms"]) / 1000
    G = sess.gaze(); t = sess.t
    d = G["dir"]; ok = G["valid"] & np.isfinite(d).all(1)
    ang = np.full(len(t), np.inf)
    dots = np.clip((d[1:] * d[:-1]).sum(1), -1, 1)
    ang[1:] = np.degrees(np.arccos(dots)) / np.maximum(np.diff(t), 1e-3)
    slow = ok & (ang < v_thresh)
    slow[0] = ok[0]
    fx, i, n = [], 0, len(t)
    while i < n:
        if not slow[i]: i += 1; continue
        j = i
        while j + 1 < n and slow[j + 1]: j += 1
        fx.append([i, j]); i = j + 1
    # merge short gaps between fixations on nearly the same spot
    merged = []
    for a, b in fx:
        if merged and t[a] - t[merged[-1][1]] < merge_gap:
            pa = np.nanmean(d[merged[-1][0]:merged[-1][1] + 1], 0); pb = np.nanmean(d[a:b + 1], 0)
            if np.degrees(np.arccos(np.clip(pa @ pb / np.linalg.norm(pa) / np.linalg.norm(pb), -1, 1))) < merge_deg:
                merged[-1][1] = b; continue
        merged.append([a, b])
    rows = []
    for a, b in merged:
        if t[b] - t[a] < min_dur: continue
        labs = [l for l in G["label"][a:b + 1] if l is not None]
        lab = Counter(labs).most_common(1)[0][0] if labs else None
        scr = np.nanmean(G["screen"][a:b + 1], 0)
        rows.append({"t0": t[a], "t1": t[b], "dur": t[b] - t[a], "aoi": lab, "group": group_of(lab),
                     "sx": scr[0], "sy": scr[1], "dir": np.nanmean(d[a:b + 1], 0)})
    return pd.DataFrame(rows)


def manual_targets(sess: Session) -> pd.DataFrame:
    """Time-stamped manual contacts: the object each hand is about to act on."""
    rows = []
    for e in sess.events.to_dict("records"):
        ty = e["type"]
        if ty == "grasp": rows.append((e["t"], e.get("hand"), group_of(e.get("obj")), "grasp"))
        elif ty == "release": rows.append((e["t"], e.get("hand"), group_of(e.get("on")), "place"))
        elif ty == "knife_load": rows.append((e["t"], e.get("hand"), group_of(e.get("jar")), "dip"))
        elif ty == "spread": rows.append((e["t"], e.get("hand"), group_of(e.get("obj")), "spread"))
        elif ty == "bell": rows.append((e["t"], e.get("hand"), "bell", "press"))
        elif ty == "cut": rows.append((e["t"], e.get("hand"), "slice", "cut"))
    df = pd.DataFrame(rows, columns=["t", "hand", "group", "kind"]).sort_values("t").reset_index(drop=True)
    # collapse runs (a spread episode is one contact)
    keep = [0] + [i for i in range(1, len(df)) if not (df.group[i] == df.group[i - 1] and df.kind[i] == df.kind[i - 1] and df.t[i] - df.t[i - 1] < 1.0)]
    return df.iloc[keep].reset_index(drop=True) if len(df) else df


@dataclass
class GazeData:
    """What the attention models need, independent of where it came from."""
    fix: pd.DataFrame                     # t0, t1, group, sx, sy
    targets: pd.DataFrame                 # t, hand, group, kind
    task_groups: set
    candidates: callable                  # t -> {group: (area, sal, cx, cy)}
    held: callable                        # t -> set of groups held
    fov: tuple = (80.0, 56.0)             # deg across the screen (x, y)
    session: str = ""
    meta: dict = field(default_factory=dict)


def gaze_data(sess: Session, fix: pd.DataFrame | None = None) -> GazeData:
    fix = fixations(sess) if fix is None else fix
    A = sess.aoi_frames; at = np.asarray(A.get("t", []), float); st = A.get("stats", [])

    def cands(t):
        if not len(at):
            return {}
        k = int(np.clip(np.searchsorted(at, t), 0, len(at) - 1))
        out = {}
        for lab, (area, sal, mx, cx, cy) in st[k].items():
            g = group_of(lab)
            if g in ("ceiling",): continue
            if g in out:
                a0, s0, x0, y0 = out[g]; a = a0 + area
                out[g] = (a, max(s0, sal), (x0 * a0 + cx * area) / a, (y0 * a0 + cy * area) / a)
            else:
                out[g] = (area, sal, cx, cy)
        return out

    hold_t = sess.t
    HL, HR = sess.hand("L")["holding"], sess.hand("R")["holding"]
    def held(t):
        i = int(np.clip(np.searchsorted(hold_t, t), 0, len(hold_t) - 1))
        return {group_of(x) for x in (HL[i], HR[i]) if x}
    asp = (sess.meta.get("screen") or [16, 9])[0] / (sess.meta.get("screen") or [16, 9])[1]
    fy = sess.meta.get("fovY", 56); fx = np.degrees(2 * np.arctan(np.tan(np.radians(fy) / 2) * asp))
    task = {group_of(k) for k in sess.task["task_objects"]} | {"slice"}
    return GazeData(fix[fix.group.notna()].reset_index(drop=True), manual_targets(sess), task, cands, held, (fx, fy), sess.path.name, sess.meta)


def roles(gd: GazeData, jit_window=1.0, ahead_min=1.0) -> pd.DataFrame:
    """Classify each fixation (after Land, Mennie & Rusted 1999; Hayhoe et al. 2003):
    directing (on the next manual target, < jit_window before contact),
    look-ahead (on a target acted on > ahead_min later, with something else intervening),
    guiding (on the object currently being manipulated / its destination),
    checking (on a target already acted on), irrelevant (not a task object)."""
    T = gd.targets; out = []
    for f in gd.fix.itertuples():
        g = f.group
        nxt = T[T.t >= f.t0]; prv = T[T.t < f.t0]
        role = "other-task"
        if g not in gd.task_groups and g not in ("plate", "counter"):
            role = "irrelevant" if g not in FIXTURES else "surface"
        elif len(nxt) and nxt.iloc[0].group == g and nxt.iloc[0].t - f.t0 <= jit_window:
            role = "directing"
        elif g in gd.held(f.t0) or (len(nxt) and nxt.iloc[0].group == g):
            role = "guiding"
        elif len(nxt) and (nxt.group == g).any():
            k = int(np.argmax((nxt.group == g).values))
            role = "look-ahead" if (nxt.iloc[k].t - f.t0 > ahead_min and k > 0) else "directing"
        elif len(prv) and (prv.group == g).any():
            role = "checking"
        out.append(role)
    df = gd.fix.copy(); df["role"] = out
    return df


def eye_hand(gd: GazeData, window=3.0) -> pd.DataFrame:
    """For each grasp: when did gaze first arrive on the object (within `window` s before), and leave?"""
    rows = []
    F = gd.fix
    for g in gd.targets[gd.targets.kind == "grasp"].itertuples():
        on = F[(F.group == g.group) & (F.t1 > g.t - window) & (F.t0 < g.t + 0.5)]
        if not len(on):
            rows.append({"t": g.t, "group": g.group, "hand": g.hand, "lead": np.nan, "gaze_left": np.nan}); continue
        rows.append({"t": g.t, "group": g.group, "hand": g.hand, "lead": g.t - on.t0.min(), "gaze_left": on.t1.max() - g.t})
    return pd.DataFrame(rows)
