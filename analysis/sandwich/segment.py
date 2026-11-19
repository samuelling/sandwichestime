"""Segment the event stream into grasp-level actions in the planner's vocabulary.

Each manual episode (grasp ... release) and each in-hand operation (dip, spread,
wipe, cut) becomes an Action. Anything that doesn't advance the task (moving a
distractor, re-grasping, setting the heel aside) is kept as `extraneous:<obj>`.
"""
from __future__ import annotations
from dataclasses import dataclass, field
import numpy as np
from .io import Session


@dataclass
class Action:
    name: str                 # planner vocabulary, e.g. 'open_jar:pb', 'spread:jelly:B', 'extraneous:food_apple_01'
    hand: str                 # 'L' | 'R'
    t: float                  # time of the key event (grasp / load / end of spread ...)
    t_start: float            # reach onset (hand leaves rest), for timing analyses
    t_end: float              # release / end of operation
    obj: str | None = None
    detail: dict = field(default_factory=dict)


def reach_onset(sess: Session, side: str, t_event: float, lookback: float = 3.0, v_rest: float = 0.05) -> float:
    t = sess.t
    if len(t) < 3:
        return t_event
    g = sess.hand(side)["grip"]
    sp = np.r_[0, np.linalg.norm(np.diff(g, axis=0), axis=1) / np.maximum(np.diff(t), 1e-3)]
    i1 = np.searchsorted(t, t_event)
    i0 = np.searchsorted(t, t_event - lookback)
    for i in range(min(i1, len(t) - 1), i0, -1):
        if sp[i] < v_rest:
            return float(t[i])
    return float(t[i0])


def segment(sess: Session, coverage_done: float | None = None) -> list[Action]:
    cov_done = coverage_done or sess.task["thresholds"]["spread_coverage_done"]
    E = sess.events.sort_values("t", kind="stable").to_dict("records")
    acts: list[Action] = []
    open_rec: dict[str, dict] = {}
    plated: list[str] = []          # slice ids in the order they reached the plate
    spread_ep: dict[str, dict] = {}  # hand -> current spread episode
    wipe_ep: dict[str, dict] = {}
    settled_on: dict[tuple, str] = {}
    for e in E:
        if e["type"] == "settled":
            settled_on[(e.get("obj"), round(e["t"], 1))] = e.get("on")

    def close_spread(h, t):
        ep = spread_ep.pop(h, None)
        if ep:
            letter = "A" if plated and ep["slice"] == plated[0] else "B"
            acts.append(Action(f"spread:{ep['sub']}:{letter}", h, ep["t1"], ep["t0"], ep["t1"], ep["slice"],
                               {"coverage": ep["cov"], "complete": ep["cov"] >= cov_done, "face": ep["face"]}))

    def close_wipe(h):
        ep = wipe_ep.pop(h, None)
        if ep:
            acts.append(Action("wipe", h, ep["t1"], ep["t0"], ep["t1"], "towel"))

    for e in E:
        ty, h, t = e["type"], e.get("hand"), e["t"]
        if h in ("L", "R") and ty not in ("spread",):
            if h in spread_ep and ty in ("grasp", "release", "knife_load", "dip_start", "cut", "wipe"):
                close_spread(h, t)
            if h in wipe_ep and ty != "wipe":
                close_wipe(h)
        if ty == "grasp":
            rec = {"obj": e["obj"], "t": t, "from": e.get("from"), "ops": [], "constraint": e.get("constraint"), "v0": e.get("value", 0)}
            open_rec[h] = rec
            if e["obj"] == "knife":
                acts.append(Action("take_knife", h, t, reach_onset(sess, h, t), t, "knife", {"from": e.get("from")}))
        elif ty in ("lid_off", "bag_open", "slice_out", "flip"):
            hh = h if h in open_rec else next((k for k, r in open_rec.items() if r["obj"] == e.get("obj")), None)
            if hh:
                open_rec[hh]["ops"].append(ty)
        elif ty == "knife_load":
            acts.append(Action(f"dip:{e['substance']}", h, t, t, t, e.get("jar")))
        elif ty == "spread":
            ep = spread_ep.get(h)
            if ep and (ep["slice"] != e["obj"] or ep["sub"] != e["substance"] or t - ep["t1"] > 1.5):
                close_spread(h, t); ep = None
            if not ep:
                spread_ep[h] = ep = {"slice": e["obj"], "sub": e["substance"], "t0": t, "t1": t, "cov": 0, "face": e.get("face")}
            ep["t1"] = t; ep["cov"] = max(ep["cov"], e.get("coverage", 0))
        elif ty == "wipe":
            ep = wipe_ep.get(h)
            if not ep:
                wipe_ep[h] = ep = {"t0": t, "t1": t}
            ep["t1"] = t
        elif ty == "cut":
            acts.append(Action("cut", h, t, t, t, e.get("obj")))
        elif ty == "bell":
            acts.append(Action("bell", h, t, reach_onset(sess, h, t), t, "bell"))
        elif ty == "release":
            rec = open_rec.pop(h, None)
            if not rec:
                continue
            obj, on, t0 = rec["obj"], e.get("on"), reach_onset(sess, h, rec["t"])
            A = lambda name, **d: acts.append(Action(name, h, rec["t"], t0, t, obj, d))
            if obj.endswith("_lid") and "lid_off" in rec["ops"]:
                J = obj.replace("_lid", "")
                acts.append(Action(f"open_jar:{J}", h, rec["t"], t0, rec["t"], obj))
                acts.append(Action(f"close_jar:{J}" if on == f"{J}_jar" else f"put_lid:{J}", h, t, rec["t"], t, obj))
            elif rec["constraint"] in ("prismatic", "hinge"):
                v = e.get("value") or 0
                cont = {"cupboard_door": "cupboard", "fridge_door": "fridge"}.get(obj, obj)
                A(("open:" + cont) if v > rec["v0"] + 0.12 else ("close:" + cont) if v < rec["v0"] - 0.12 else "extraneous:" + obj, value=v)
            elif rec["constraint"] == "twist":
                A("extraneous:" + obj, note="twist without unscrewing")
            elif obj == "bread_clip":
                A("close_bag" if on == "bread_bag" else "open_bag")
            elif obj.endswith("_lid"):
                J = obj.replace("_lid", "")
                if "lid_off" in rec["ops"]:
                    acts.append(Action(f"open_jar:{J}", h, rec["t"], t0, rec["t"], obj))
                    acts.append(Action(f"close_jar:{J}" if on == f"{J}_jar" else f"put_lid:{J}", h, t, rec["t"], t, obj))
                else:
                    A(f"close_jar:{J}" if on == f"{J}_jar" else "extraneous:" + obj)
            elif obj.startswith("slice_"):
                if "slice_out" in rec["ops"]:
                    if on == "plate":
                        plated.append(obj); A("slice_to_plate")
                    else:
                        A("extraneous:" + obj, note=f"slice out of bag to {on}")
                elif on and on.startswith("slice_") and obj in plated:
                    A("close", flipped="flip" in rec["ops"])
                elif on == "plate" and obj not in plated:
                    plated.append(obj); A("slice_to_plate")
                else:
                    A("extraneous:" + obj)
            elif obj == "knife":
                acts.append(Action("put_knife", h, t, t, t, "knife", {"on": on}))
            elif obj == "plate" and rec.get("from") == "cupboard":
                A("fetch:plate")
            elif obj == "jelly_jar" and (rec.get("from") or "").startswith("fridge"):
                A("fetch:jelly")
            else:
                A("extraneous:" + obj, on=on)
    for h in list(spread_ep):
        close_spread(h, None)
    for h in list(wipe_ep):
        close_wipe(h)
    acts.sort(key=lambda a: (a.t, a.t_end))
    return acts
