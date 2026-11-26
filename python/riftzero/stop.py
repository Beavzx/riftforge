"""Stop a running training run cleanly (from any terminal).

    python -m riftzero.stop [--run runs/<name> | --config config/train.yaml] [--no-wait]

Creates runs/<name>/STOP. Workers finish their current decision, the trainer saves a checkpoint, the launcher exits.
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

from .config import REPO_ROOT, load_config, run_dir


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default=None)
    ap.add_argument("--config", default=str(REPO_ROOT / "config" / "train.yaml"))
    ap.add_argument("--no-wait", action="store_true")
    a = ap.parse_args(argv)
    rd = Path(a.run).resolve() if a.run else run_dir(load_config(a.config))
    if not (rd / "run.pid").exists():
        print(f"no active run in {rd}")
        return 0
    (rd / "STOP").write_text("stop requested")
    print(f"stop requested for {rd.name}; waiting for a clean shutdown (final checkpoint)...")
    if a.no_wait:
        return 0
    t = time.time()
    while (rd / "run.pid").exists() and time.time() - t < 600:
        time.sleep(1)
    print("stopped." if not (rd / "run.pid").exists() else "still shutting down — check runs/<name>/logs/launch.log")
    return 0


if __name__ == "__main__":
    main()
