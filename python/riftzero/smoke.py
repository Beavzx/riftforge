"""2-minute end-to-end check before a real run: tiny model, 2 workers, every component exercised.

    python -m riftzero.smoke [--backend torch|mock] [--duration 120]

Runs config/smoke.yaml in a throwaway run (runs/smoke), then checks: self-play games finished, shards were written
and read back, (torch) the trainer took steps and published checkpoints the servers loaded, an eval match ran.
Prints PASS/FAIL per check. Exit code 0 = everything works.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from .config import REPO_ROOT, load_config, run_dir
from .dataset import read_shard
from . import launch


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["torch", "mock"], default="torch")
    ap.add_argument("--duration", type=float, default=150)
    ap.add_argument("--config", default=str(REPO_ROOT / "config" / "smoke.yaml"))
    ap.add_argument("--keep", action="store_true", help="keep runs/smoke afterwards")
    a = ap.parse_args(argv)
    rd = run_dir(load_config(a.config))
    if rd.exists():
        shutil.rmtree(rd)
    print(f"[smoke] {a.backend} backend, {a.duration:.0f}s, run dir {rd}")
    code = launch.main(["--config", a.config, "--duration", str(a.duration), "--backend", a.backend])
    checks = []

    def check(name, ok, detail=""):
        checks.append(ok)
        print(f"[smoke] {'PASS' if ok else 'FAIL'}  {name}  {detail}")

    check("launcher exited cleanly", code == 0, f"(code {code})")
    st = json.loads((rd / "status.json").read_text()) if (rd / "status.json").exists() else {}
    games = st.get("selfplay", {}).get("games", 0)
    check("self-play games finished", games > 0, f"({games} games, {st.get('selfplay', {}).get('errors', '?')} errors)")
    shards = sorted((rd / "shards").glob("*.rfs"))
    n = 0
    try:
        for p in shards:
            n += len(read_shard(p, json.loads((rd / "schema.json").read_text())["schemaHash"]))
        check("shards written and readable", n > 0, f"({len(shards)} shards, {n} positions)")
    except Exception as e:
        check("shards written and readable", False, str(e))
    if a.backend == "torch":
        m = (rd / "metrics.jsonl")
        steps = 0
        if m.exists():
            lines = m.read_text().splitlines()
            steps = json.loads(lines[-1])["step"] if lines else 0
        check("trainer took steps", steps > 0, f"(step {steps})")
        ck = sorted((rd / "ckpt").glob("step_*.pt"))
        check("checkpoints published", len(ck) >= 2, f"({[p.name for p in ck]})")
        srv = sorted((rd / "servers").glob("*.json"))
        loaded = max((json.loads(p.read_text()).get("step", 0) for p in srv), default=0)
        check("inference server hot-reloaded a trained checkpoint", loaded > 0, f"(serving step {loaded})")
    ev = sorted((rd / "eval").glob("step-*.json")) if (rd / "eval").exists() else []
    check("eval match ran", bool(ev), f"({[p.name for p in ev]})")
    ok = all(checks)
    print(f"[smoke] {'ALL CHECKS PASSED — ready for a real run' if ok else 'SOME CHECKS FAILED — see ' + str(rd / 'logs')}")
    if ok and not a.keep:
        shutil.rmtree(rd, ignore_errors=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
