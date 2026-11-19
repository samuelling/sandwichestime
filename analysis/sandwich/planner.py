"""Optimal bimanual plans for the sandwich task, and step-wise regret of observed behaviour.

The task is modelled as a deterministic shortest-path problem over abstract
states (what is open, where the knife is, what each hand holds, where each hand
is). Action costs are seconds: a Fitts-like reach (base + s/m x distance between
the hand's current location and the action's location, using the session's real
layout) plus a fixed manipulation time (task json `action_costs_s`), plus
walking when a location is out of reach of the standing position.

Cost is summed over both hands (total manual effort), so the optimum is the
minimum-effort plan; how much of it ran in parallel is measured separately.

    V*(s)   = optimal cost-to-go from s
    regret  = c(s, a) + V*(s') - V*(s)     (0 for an optimal step)
"""
from __future__ import annotations
import heapq
from dataclasses import dataclass, replace, field
from functools import lru_cache
import numpy as np
from .io import Session


@dataclass(frozen=True)
class State:
    bag: int = 0                    # 0 closed, 1 open, 2 re-closed (tidy)
    n: int = 0                      # slices on the plate
    pb: int = 0                     # jar open?
    jelly: int = 0
    lid_pb: str = "on"              # 'on' | 'L' | 'R' | 'down'
    lid_jelly: str = "on"
    knife: str = "home"             # 'home' | 'L' | 'R' | 'down'
    load: str = ""                  # '' | 'pb' | 'jelly'
    residue: frozenset = frozenset()
    spreads: frozenset = frozenset()  # {('pb','A'), ('jelly','B')}
    closed: int = 0
    cut: int = 0
    done: int = 0
    opened: frozenset = frozenset()   # containers opened (stored layout)
    fetched: frozenset = frozenset()  # 'plate', 'jelly' brought to the work area
    pL: str = "restL"
    pR: str = "restR"

    def holds(self, h):
        if self.knife == h: return "knife"
        if self.lid_pb == h: return "lid_pb"
        if self.lid_jelly == h: return "lid_jelly"
        return None


class Domain:
    def __init__(self, nodes: dict[str, np.ndarray], costs: dict, condition="standard", stored=None,
                 contamination_penalty=0.0, body_x=0.0, reach_m=0.8, walk_s_per_m=1.0):
        self.P = nodes; self.c = costs; self.cond = condition
        self.stored = stored or {}          # e.g. {'plate': 'cupboard', 'knife': 'drawer', 'jelly': 'fridge'}
        self.pen = contamination_penalty; self.bx = body_x; self.reach_m = reach_m; self.walk = walk_s_per_m

    # ---- costs ----
    def dist(self, a, b):
        return float(np.linalg.norm(self.P[a] - self.P[b]))

    def reach(self, frm, to):
        c = self.c["reach_base"] + self.c["reach_s_per_m"] * self.dist(frm, to)
        dx = abs(self.P[to][0] - self.bx)
        if dx > self.reach_m:  # step over and back
            c += 2 * (dx - self.reach_m + 0.2) * self.walk
        return c

    def node(self, s: State, what):
        """Where an object is, given the state."""
        if what == "plate": return "work" if (self.stored.get("plate") and "plate" in s.fetched) else ("cupboard" if self.stored.get("plate") else "plate")
        if what == "jelly": return "jelly_work" if (self.stored.get("jelly") and "jelly" in s.fetched) else ("fridge" if self.stored.get("jelly") else "jelly")
        if what == "knife": return {"home": "drawer" if self.stored.get("knife") else "knife", "down": "down"}.get(s.knife, s.knife)
        return what

    # ---- successor function ----
    def successors(self, s: State):
        C = self.c
        plate_ok = (not self.stored.get("plate")) or "plate" in s.fetched
        for h in ("L", "R"):
            pos = s.pL if h == "L" else s.pR
            held = s.holds(h)
            free = held is None
            mv = (lambda node, st, hh=h: replace(st, pL=node) if hh == "L" else replace(st, pR=node))
            # containers (stored layout)
            for cont in set(self.stored.values()):
                if free and cont not in s.opened:
                    yield f"open:{cont}", h, mv(cont, replace(s, opened=s.opened | {cont})), self.reach(pos, cont) + 0.8
            if free and self.stored.get("plate") and "plate" not in s.fetched and "cupboard" in s.opened:
                yield "fetch:plate", h, mv("work", replace(s, fetched=s.fetched | {"plate"})), self.reach(pos, "cupboard") + C["grasp"] + self.reach("cupboard", "work") + C["release"]
            if free and self.stored.get("jelly") and "jelly" not in s.fetched and "fridge" in s.opened:
                yield "fetch:jelly", h, mv("jelly_work", replace(s, fetched=s.fetched | {"jelly"})), self.reach(pos, "fridge") + C["grasp"] + self.reach("fridge", "jelly_work") + C["release"]
            # bread
            if free and s.bag == 0:
                yield "open_bag", h, mv("bag", replace(s, bag=1)), self.reach(pos, "bag") + C["open_clip"] + C["release"]
            if free and s.bag == 1 and s.n < 2 and plate_ok:
                pn = self.node(s, "plate")
                yield "slice_to_plate", h, mv(pn, replace(s, n=s.n + 1)), self.reach(pos, "bag") + C["grasp"] + self.reach("bag", pn) + C["release"]
            if self.cond == "tidy" and free and s.bag == 1 and s.n == 2:
                yield "close_bag", h, mv("bag", replace(s, bag=2)), self.reach(pos, "bag") + C["open_clip"]
            # jars
            for J in ("pb", "jelly"):
                jn = self.node(s, J)
                if J == "jelly" and self.stored.get("jelly") and "jelly" not in s.fetched:
                    continue
                isopen = getattr(s, J); lid = getattr(s, f"lid_{J}")
                if free and not isopen and lid == "on":
                    yield f"open_jar:{J}", h, mv(jn, replace(s, **{J: 1, f"lid_{J}": h})), self.reach(pos, jn) + C["grasp"] + C["twist_off"]
                spreadJ = any(x[0] == J for x in s.spreads)
                if lid == h:
                    yield f"put_lid:{J}", h, mv(f"{J}_lidspot", replace(s, **{f"lid_{J}": "down"})), self.reach(pos, f"{J}_lidspot") + C["release"]
                    if self.cond == "tidy" and spreadJ:
                        yield f"close_jar:{J}", h, mv(jn, replace(s, **{J: 0, f"lid_{J}": "on"})), self.reach(pos, jn) + C["twist_on"]
                if self.cond == "tidy" and free and lid == "down" and spreadJ:
                    yield f"close_jar:{J}", h, mv(jn, replace(s, **{J: 0, f"lid_{J}": "on"})), self.reach(pos, f"{J}_lidspot") + C["grasp"] + self.reach(f"{J}_lidspot", jn) + C["twist_on"]
            # knife
            kn = self.node(s, "knife")
            if free and s.knife in ("home", "down") and (s.knife == "down" or not self.stored.get("knife") or "drawer" in s.opened):
                yield "take_knife", h, mv(kn, replace(s, knife=h)), self.reach(pos, kn) + C["grasp"]
            if held == "knife":
                for J in ("pb", "jelly"):
                    if getattr(s, J) and s.load != J and not any(x[0] == J for x in s.spreads):
                        jn = self.node(s, J)
                        pen = self.pen if (s.residue - {J}) else 0.0
                        yield f"dip:{J}", h, mv(jn, replace(s, load=J, residue=s.residue | {J})), self.reach(pos, jn) + C["dip"] + pen
                if s.load and s.n >= 1:
                    pn = self.node(s, "plate")
                    for letter in ("A", "B"):
                        if letter == "B" and s.n < 2: continue
                        if letter == "A" and s.spreads and all(x[1] == "B" for x in s.spreads): continue
                        if letter == "B" and not s.spreads: continue    # first spread goes on A by convention
                        yield f"spread:{s.load}:{letter}", h, mv(pn, replace(s, load="", spreads=s.spreads | {(s.load, letter)})), self.reach(pos, pn) + C["spread"]
                if s.residue and not s.load:
                    yield "wipe", h, mv("towel", replace(s, residue=frozenset())), self.reach(pos, "towel") + 1.0
                yield "put_knife", h, mv("down", replace(s, knife="down")), self.reach(pos, "down") + C["release"]
                if self.cond == "cut" and s.closed and not s.cut:
                    yield "cut", h, mv(self.node(s, "plate"), replace(s, cut=1)), self.reach(pos, self.node(s, "plate")) + C["cut"]
            # close the sandwich
            subs = {x[0] for x in s.spreads}
            if free and s.n == 2 and subs == {"pb", "jelly"} and not s.closed:
                flip = len({x[1] for x in s.spreads}) == 2
                pn = self.node(s, "plate")
                yield "close", h, mv(pn, replace(s, closed=1)), self.reach(pos, pn) + C["grasp"] + (C["flip_place"] if flip else C["release"])
            # finish
            if s.closed and not s.done and self.goal_ready(s):
                yield "bell", h, mv("bell", replace(s, done=1)), self.reach(pos, "bell") + C["press"]

    def goal_ready(self, s):
        if s.lid_pb in ("L", "R") or s.lid_jelly in ("L", "R"): return False   # finish with lids put down
        if self.cond == "cut" and not s.cut: return False
        if self.cond == "tidy" and not (s.pb == 0 and s.jelly == 0 and s.lid_pb == "on" and s.lid_jelly == "on" and s.bag == 2): return False
        return True

    # ---- search ----
    def solve(self, s0: State, max_expand=400_000):
        """Dijkstra to the goal (done). Returns (cost, [(action, hand, state_after, step_cost), ...])."""
        dist = {s0: 0.0}; prev = {}
        pq = [(0.0, 0, s0)]; k = 0; n = 0
        while pq:
            d, _, s = heapq.heappop(pq)
            if d > dist.get(s, np.inf) + 1e-12: continue
            if s.done:
                path = []
                while s in prev:
                    p, a, h, c = prev[s]; path.append((a, h, s, c)); s = p
                return d, path[::-1]
            n += 1
            if n > max_expand: break
            for a, h, s2, c in self.successors(s):
                nd = d + c
                if nd < dist.get(s2, np.inf) - 1e-12:
                    dist[s2] = nd; prev[s2] = (s, a, h, c); k += 1
                    heapq.heappush(pq, (nd, k, s2))
        return np.inf, []

    def value(self, s: State) -> float:
        return self._value(s)

    @lru_cache(maxsize=4096)
    def _value(self, s):
        return self.solve(s)[0]

    def step(self, s: State, action: str, hand: str):
        """Apply an observed action. Returns (state', cost, valid)."""
        for a, h, s2, c in self.successors(s):
            if a == action and h == hand:
                return s2, c, True
        # an observed action the model doesn't allow from here (or extraneous): pay a reach + grasp + release, state unchanged
        pos = s.pL if hand == "L" else s.pR
        tgt = action.split(":", 1)[-1] if ":" in action else None
        node = tgt if tgt in self.P else pos
        c = self.reach(pos, node) + self.c["grasp"] + self.c["release"]
        s2 = replace(s, pL=node) if hand == "L" else replace(s, pR=node)
        # re-spreading the same substance (touch-ups) costs time but leaves the state
        return s2, c, False


def domain_from_session(sess: Session, contamination_penalty=0.0) -> tuple[Domain, State]:
    """Build location nodes from the session's actual layout."""
    H = sess.home(); C = dict(sess.task["action_costs_s"]); C.pop("_comment", None)
    y = sess.layout.get("counterY", 0.91)
    P = {}
    body_x = 0.0
    P["restL"] = np.array([body_x - 0.22, 1.02, 0.2]); P["restR"] = np.array([body_x + 0.22, 1.02, 0.2])
    clip = H.get("bread_bag"); P["bag"] = H["bread_bag"] + np.array([0.0, 0.1, 0.0])
    plate = H["plate"]; P["plate"] = plate + np.array([0, 0.03, 0])
    P["work"] = np.array([body_x, y + 0.03, -0.25])
    for J in ("pb", "jelly"):
        P[J] = H[f"{J}_jar"] + np.array([0, 0.13, 0])
        P[f"{J}_lidspot"] = H[f"{J}_jar"] + np.array([0, 0.02, 0.12])
    P["jelly_work"] = P["work"] + np.array([-0.3, 0.1, -0.05])
    P["jelly_lidspot"] = P["jelly_lidspot"] if sess.meta.get("layout") != "stored" else P["jelly_work"] + np.array([0, -0.08, 0.1])
    P["knife"] = H["knife"] + np.array([0, 0.02, 0])
    work = P["work"] if sess.meta.get("layout") == "stored" else P["plate"]
    P["down"] = work + np.array([0.2, -0.01, 0.03])
    P["towel"] = H["towel"] + np.array([0, 0.03, 0]); P["bell"] = H["bell"] + np.array([0, 0.07, 0])
    stored = {}
    if sess.meta.get("layout") == "stored":
        stored = {"plate": "cupboard", "knife": "drawer", "jelly": "fridge"}
        P["cupboard"] = plate + np.array([0.2, 0.05, 0.25]); P["drawer"] = np.array([0.0, 0.79, 0.0])
        P["fridge"] = H["jelly_jar"] + np.array([0.3, 0.0, 0.35])
        P["knife"] = H["knife"] + np.array([0, 0.03, 0.4])
    D = Domain(P, C, condition=sess.meta.get("condition", "standard"), stored=stored, contamination_penalty=contamination_penalty, body_x=body_x)
    return D, State()


@dataclass
class OptimalityResult:
    optimal_cost: float
    optimal_plan: list
    observed_cost: float
    efficiency: float
    steps: list = field(default_factory=list)   # per observed action: dict(action, hand, t, cost, regret, valid, V_before)
    n_extraneous: int = 0
    n_invalid: int = 0


def evaluate(sess: Session, actions, contamination_penalty=0.0) -> OptimalityResult:
    D, s = domain_from_session(sess, contamination_penalty)
    c_opt, plan = D.solve(s)
    steps, total, nx, ninv = [], 0.0, 0, 0
    for a in actions:
        V0 = D.value(s)
        name = a.name
        if name.startswith("spread:") and name.count(":") == 2:
            pass
        s2, c, ok = D.step(s, name, a.hand)
        if not ok and name.startswith("spread:"):
            # touch-up or slice-letter mismatch: try the other letter
            alt = name[:-1] + ("A" if name.endswith("B") else "B")
            s3, c3, ok3 = D.step(s, alt, a.hand)
            if ok3: s2, c, ok, name = s3, c3, True, alt
        V1 = D.value(s2)
        reg = c + V1 - V0
        steps.append({"action": a.name, "hand": a.hand, "t": a.t, "cost": round(c, 3), "regret": round(reg, 3), "valid": ok,
                      "V_before": round(V0, 3), "extraneous": a.name.startswith("extraneous")})
        nx += a.name.startswith("extraneous"); ninv += (not ok and not a.name.startswith("extraneous"))
        total += c; s = s2
    # unfinished: add the remaining optimal cost so efficiency compares like with like
    rem = D.value(s) if not s.done else 0.0
    obs = total + (rem if np.isfinite(rem) else 0)
    return OptimalityResult(c_opt, [(a, h, round(cc, 3)) for a, h, _, cc in plan], obs, c_opt / obs if obs > 0 else np.nan, steps, nx, ninv)
