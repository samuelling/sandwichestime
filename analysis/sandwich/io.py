"""Load a sandwichestime session log into convenient numpy / pandas structures."""
from __future__ import annotations
import json
from dataclasses import dataclass, field
from pathlib import Path
import numpy as np
import pandas as pd

TASK_GROUPS = {"bread_clip": "bread_bag", "pb_lid": "pb_jar", "jelly_lid": "jelly_jar"}
FIXTURES = {"counter", "wall", "backsplash", "floor", "ceiling", "cabinet", "shelf", "window", "sink", "faucet",
            "cooktop", "hood", "fridge", "cupboard", "drawer"}


def group_of(aoi: str | None) -> str | None:
    """Collapse object parts into task-level AOIs (lid -> jar, clip -> bag, slice_07 -> slice)."""
    if not isinstance(aoi, str):
        return None
    if aoi.startswith("slice_"):
        return "slice"
    return TASK_GROUPS.get(aoi, aoi)


@dataclass
class Session:
    path: Path
    meta: dict
    task: dict
    layout: dict
    events: pd.DataFrame
    frames: dict
    objects: dict
    aoi_frames: dict
    summary: dict
    raw: dict = field(repr=False, default_factory=dict)

    # ---- convenience views ----
    @property
    def t(self) -> np.ndarray:
        return np.asarray(self.frames["t"], float)

    def ev(self, *types) -> pd.DataFrame:
        return self.events[self.events.type.isin(types)].reset_index(drop=True)

    def hand(self, side: str) -> dict:
        H = self.frames["hands"][side]
        return {"grip": np.asarray(H["grip"], float).reshape(-1, 3), "wrist": np.asarray(H["wrist"], float).reshape(-1, 3),
                "pinch": np.asarray(H["pinch"], float), "tracked": np.asarray(H["tracked"], float),
                "holding": np.asarray(H["holding"], object)}

    def head(self) -> np.ndarray:
        return np.asarray(self.frames["head"], float).reshape(-1, 7)

    def gaze(self) -> dict:
        G = self.frames["gaze"]
        ray = np.array([np.nan if v is None else v for v in G["ray"]], float).reshape(-1, 6)
        scr = np.array([np.nan if v is None else v for v in G["screen"]], float).reshape(-1, 2)
        return {"valid": np.asarray(G["valid"], bool), "origin": ray[:, :3], "dir": ray[:, 3:], "screen": scr,
                "aoi": np.asarray(G["aoi"], object), "label": np.asarray(G["label"], object),
                "near": np.asarray(G["near"], object),
                "near_deg": np.array([np.nan if v is None else v for v in G["nearDeg"]], float)}

    def home(self) -> dict[str, np.ndarray]:
        """Initial world position of every placed entity."""
        return {p["id"]: np.asarray(p["pos"], float) for p in self.layout.get("placements", []) if "pos" in p}

    def object_pos(self, oid: str, t: float) -> np.ndarray | None:
        o = self.objects.get(oid)
        if not o:
            return self.home().get(oid)
        ts = np.asarray(o["t"]); P = np.asarray(o["p"]).reshape(-1, 3)
        i = max(0, np.searchsorted(ts, t, side="right") - 1)
        return P[i]

    @property
    def task_objects(self) -> set[str]:
        return set(self.task["task_objects"].keys()) | {"slice"}

    @property
    def duration(self) -> float:
        return float(self.summary.get("duration") or (self.t[-1] if len(self.t) else 0))


def load(path: str | Path) -> Session:
    path = Path(path)
    d = json.loads(path.read_text())
    ev = pd.DataFrame(d["events"])
    if "obj" not in ev:
        ev["obj"] = None
    return Session(path=path, meta=d["meta"], task=d["task"], layout=d.get("layout") or {}, events=ev, frames=d["frames"],
                   objects=d.get("objects") or {}, aoi_frames=d.get("aoiFrames") or {"t": [], "stats": []},
                   summary=d.get("summary") or {}, raw=d)
