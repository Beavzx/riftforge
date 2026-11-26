"""Load config/*.yaml, apply defaults, resolve `auto` values, write runs/<name>/resolved.json (read by Node)."""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULTS: dict = {
    "run": {"name": "home-1", "seed": 1, "runsDir": "runs"},
    "decks": {"mode": "pool", "pool": ["01-azir.json", "02-vex.json"], "allowMirror": True, "me": None, "opponents": []},
    "caps": {"maxTurns": 60, "maxTurnsAnneal": None, "timeoutShaping": 0.2, "maxActions": 1500, "maxMainPerTurn": 40},
    "selfplay": {"workers": "auto", "reserveThreads": 2, "concurrentGames": 4, "gamesPerShard": 4, "statsEverySec": 10},
    "search": {"algorithm": "gumbel", "fullSims": 64, "fastSims": 16, "fullProb": 0.25, "maxConsidered": 16, "cVisit": 50,
               "cScale": 1.0, "cPuct": 1.5, "dirichletAlpha": 0.3, "dirichletFrac": 0.25, "temperatureMoves": 12, "forcedStepCap": 64},
    "evalSearch": {"fullSims": 64},
    "env": {"kind": "factored"},
    "target": {"pointsShaping": 0.0},
    "inference": {"backend": "torch", "host": "127.0.0.1", "basePort": 47000, "gpus": [0], "serversPerGpu": 1, "maxBatch": 256, "batchTimeoutMs": 2.0,
                  "dtype": "bf16", "reloadEverySec": 20, "memoryFraction": 0.3},
    "model": {"size": "small"},
    "train": {"gpu": 0, "batchSize": 256, "lr": 3e-4, "warmupSteps": 500, "schedule": "cosine", "totalSteps": 200000,
              "minLrFrac": 0.1, "weightDecay": 1e-4, "valueWeight": 1.0, "gradClip": 1.0, "minPositions": 20000,
              "replayPositions": 400000, "maxSampleReuse": 4.0, "ckptEverySteps": 1000, "keepCheckpoints": 20,
              "logEverySteps": 50, "ampDtype": "bf16", "compile": False, "keepShardFiles": 2000},
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
    }


def write_resolved(cfg: dict) -> dict:
    r = resolve(cfg)
    rd = Path(r["runDir"])
    rd.mkdir(parents=True, exist_ok=True)
    (rd / "resolved.json").write_text(json.dumps(r, indent=1))
    (rd / "config.json").write_text(json.dumps(cfg, indent=1))
    return r
