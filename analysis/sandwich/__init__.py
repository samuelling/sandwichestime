"""sandwich — analysis of sandwichestime sessions: segmentation, optimal planning,
step-wise regret, gaze roles and attention-model comparison."""
from .io import load, group_of, Session
from .segment import segment, Action
from .planner import evaluate, domain_from_session, State, Domain
from .gaze import fixations, gaze_data, roles, eye_hand, GazeData
from . import models, simulate, metrics

__all__ = ["load", "group_of", "Session", "segment", "Action", "evaluate", "domain_from_session", "State", "Domain",
           "fixations", "gaze_data", "roles", "eye_hand", "GazeData", "models", "simulate", "metrics"]
__version__ = "0.1.0"
