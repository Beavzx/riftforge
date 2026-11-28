"""Load config/*.yaml, apply defaults, resolve `auto` values, write runs/<name>/resolved.json (read by Node)."""
from __future__ import annotations

import copy
import json
import math
import os
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULTS: dict = {
    "run": {"name": "home-1", "seed": 1, "runsDir": "runs"},
    "decks": {"mode": "pool", "pool": ["01-azir.json", "02-vex.json"], "allowMirror": True, "me": None, "opponents": []},
    "caps": {"maxTurns": 60, "maxTurnsAnneal": None, "timeoutShaping": 0.2, "maxActions": 1500, "maxMainPerTurn": 40},
    "selfplay": {"workers": "auto", "reserveThreads": 2, "concurrentGames": 4, "gamesPerShard": 4, "statsEverySec": 10,
                 # fixed opponents mixed into self-play; weights None = pure self-play (see opponent_weights)
                 "opponents": {"weights": None, "searchAiOptions": {}}},
    "search": {"algorithm": "gumbel", "fullSims": 64, "fastSims": 16, "fullProb": 0.25, "maxConsidered": 16, "cVisit": 50,
               "cScale": 1.0, "cPuct": 1.5, "dirichletAlpha": 0.3, "dirichletFrac": 0.25, "temperatureMoves": 12, "forcedStepCap": 64},
    "evalSearch": {"fullSims": 64},
    "env": {"kind": "factored"},
    "target": {"pointsShaping": 0.0},
    "inference": {"backend": "torch", "host": "127.0.0.1", "basePort": 47000, "gpus": [0], "serversPerGpu": 1, "maxBatch": 256, "batchTimeoutMs": 2.0,
                  "dtype": "bf16", "reloadEverySec": 20, "memoryFraction": 0.3,
                  "allowCpu": False, "maxServerRestarts": 5},
    "model": {"size": "small"},
    "train": {"gpu": 0, "batchSize": 256, "lr": 3e-4, "warmupSteps": 500, "schedule": "cosine", "totalSteps": 200000,
              "minLrFrac": 0.1, "weightDecay": 1e-4, "valueWeight": 1.0, "gradClip": 1.0, "minPositions": 20000,
              "replayPositions": 400000, "maxSampleReuse": 4.0, "ckptEverySteps": 1000, "keepCheckpoints": 20,
              "logEverySteps": 50, "ampDtype": "bf16", "compile": False, "keepShardFiles": 2000, "holdoutEvery": 50, "valueTargetQ": 0.0,
              "allowCpu": False, "maxBadSteps": 10},
    "eval": {"everyCheckpoints": 5, "gamesPerOpponent": 20, "opponents": ["best", "searchai", "bot"], "concurrentGames": 4,
             "gating": {"enabled": False, "threshold": 0.55}, "searchAi": {}},
}


def deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config(path: str | Path, overrides: dict | None = None) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        user = yaml.safe_load(f) or {}
    cfg = deep_merge(DEFAULTS, user)
    if overrides:
        cfg = deep_merge(cfg, overrides)
    return cfg


def resolve_deck(p: str) -> str:
    """Deck file: absolute, relative to repo root, or a bare name in data/meta-decks/."""
    cands = [Path(p), REPO_ROOT / p, REPO_ROOT / "data" / "meta-decks" / p]
    for c in cands:
        if c.is_file():
            return str(c.resolve())
    raise FileNotFoundError(f"deck not found: {p} (looked in repo root and data/meta-decks/)")


OPPONENT_KINDS = ("self", "best", "bot", "searchai")


def opponent_weights(w: dict | None) -> dict:
    """selfplay.opponents.weights → normalised {self, best, bot, searchai}. None / {} = pure self-play. A missing `self`
    takes what the others leave of 1.0 (so `{bot: 0.1}` = 90% self-play, 10% vs the rules bot); missing others are 0.
    Same rules as src/ai/selfplay/config.ts opponentWeights."""
    w = dict(w or {})
    for k, v in w.items():
        if k not in OPPONENT_KINDS:
            raise ValueError(f"selfplay.opponents.weights: unknown opponent {k!r} (use {', '.join(OPPONENT_KINDS)})")
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
            raise ValueError(f"selfplay.opponents.weights.{k} must be a number >= 0 (got {v!r})")
    out = {k: float(w.get(k, 0.0)) for k in OPPONENT_KINDS}
    if not w:
        out["self"] = 1.0
    elif "self" not in w:
        others = out["best"] + out["bot"] + out["searchai"]
        if others > 1 + 1e-9:
            raise ValueError(f"selfplay.opponents.weights: best + bot + searchai = {others:g} > 1 with no 'self' weight given")
        out["self"] = max(0.0, 1.0 - others)
    total = sum(out.values())
    if total <= 0:
        raise ValueError("selfplay.opponents.weights: all weights are 0")
    return {k: v / total for k, v in out.items()}


def threads() -> int:
    return os.cpu_count() or 4


def run_dir(cfg: dict) -> Path:
    d = Path(cfg["run"]["runsDir"])
    if not d.is_absolute():
        d = REPO_ROOT / d
    return (d / cfg["run"]["name"]).resolve()


def resolve(cfg: dict) -> dict:
    """The JSON the Node side reads (src/ai/selfplay/config.ts ResolvedConfig)."""
    sp, inf = cfg["selfplay"], cfg["inference"]
    opp = sp.get("opponents") or {}
    n_servers = max(1, len(inf["gpus"] or [0])) * max(1, int(inf.get("serversPerGpu", 1))) if inf["backend"] != "mock" else 1
    workers = sp["workers"]
    if workers == "auto":
        workers = max(1, threads() - int(sp["reserveThreads"]))
    decks = cfg["decks"]
    rd = run_dir(cfg)
    search = dict(cfg["search"])
    eval_search = {**search, "fullProb": 1.0, **cfg.get("evalSearch", {})}
    eval_search["fastSims"] = eval_search["fullSims"]
    return {
        "runName": cfg["run"]["name"], "runDir": str(rd), "repoRoot": str(REPO_ROOT), "seed": int(cfg["run"]["seed"]),
        "decks": {
            "mode": decks["mode"], "allowMirror": bool(decks.get("allowMirror", True)),
            "pool": [resolve_deck(p) for p in decks.get("pool") or []],
            "me": resolve_deck(decks["me"]) if decks.get("me") else None,
            "opponents": [resolve_deck(p) for p in decks.get("opponents") or []],
        },
        "caps": cfg["caps"], "search": search, "evalSearch": eval_search,
        "workers": {"count": int(workers), "concurrentGames": int(sp["concurrentGames"]), "gamesPerShard": int(sp["gamesPerShard"]),
                    "statsEverySec": int(sp["statsEverySec"])},
        "servers": {"host": inf["host"], "ports": [int(inf["basePort"]) + i for i in range(n_servers)]},
        "env": cfg["env"], "target": cfg["target"],
        "eval": {"gamesPerOpponent": int(cfg["eval"]["gamesPerOpponent"]), "opponents": list(cfg["eval"]["opponents"]),
                 "concurrentGames": int(cfg["eval"]["concurrentGames"]), "searchAiOptions": cfg["eval"].get("searchAi") or {}},
        "opponents": {"weights": opponent_weights(opp.get("weights")), "searchAiOptions": opp.get("searchAiOptions") or {}},
    }


def write_resolved(cfg: dict) -> dict:
    r = resolve(cfg)
    rd = Path(r["runDir"])
    rd.mkdir(parents=True, exist_ok=True)
    (rd / "resolved.json").write_text(json.dumps(r, indent=1))
    (rd / "config.json").write_text(json.dumps(cfg, indent=1))
    return r
