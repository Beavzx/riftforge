"""The "press start" launcher: runs a whole training run from one config file. Cross-platform (Linux, WSL2, Windows).

    python -m riftzero.launch --config config/train.yaml [--name my-run] [--duration 3600] [--backend mock]
                              [--workers 8] [--set train.lr=1e-4 --set search.fullSims=32]

Starts, in order: schema export (node tools/train-schema.ts) → trainer (python -m riftzero.train; writes the first
checkpoint) → inference server(s) (python -m riftzero.infer_server, one per GPU × inference.serversPerGpu) → self-play
workers (node src/ai/selfplay/worker.ts). Then it supervises: restarts crashed workers, runs evaluation matches every
eval.everyCheckpoints checkpoints (node tools/train-eval.ts → elo.csv), writes runs/<name>/status.json.
Stop: Ctrl-C here, or `python -m riftzero.stop --run runs/<name>` from another terminal (creates runs/<name>/STOP; every
process finishes cleanly and the trainer saves a final checkpoint). Starting again with the same run name resumes.
Logs: runs/<name>/logs/*.log.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import yaml

from .checkpoints import list_steps, pin_eval
from .config import REPO_ROOT, load_config, write_resolved
from .elo import record_eval


def _scalar(v: str):
    """--set values: YAML parsing, plus numbers YAML 1.1 leaves as strings (1e-4, 2e3, .5e1)."""
    x = yaml.safe_load(v)
    if isinstance(x, str):
        for conv in (int, float):
            try:
                return conv(x)
            except ValueError:
                pass
    return x


def parse_set(items: list[str]) -> dict:
    out: dict = {}
    for it in items or []:
        k, _, v = it.partition("=")
        cur = out
        parts = k.split(".")
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = _scalar(v)
    return out


class Child:
    def __init__(self, name: str, cmd: list[str], log: Path, env: dict):
        self.name, self.cmd, self.log_path, self.env = name, cmd, log, env
        self.proc: subprocess.Popen | None = None
        self.restarts: list[float] = []
        self.started = 0.0
        self.log = None

    def start(self):
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.log = open(self.log_path, "a", encoding="utf-8", errors="replace")
        self.log.write(f"\n===== start {time.strftime('%Y-%m-%d %H:%M:%S')}: {' '.join(self.cmd)}\n"); self.log.flush()
        # own process group: Ctrl-C reaches only the launcher, which then stops everything in order (STOP file)
        kw = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
        self.proc = subprocess.Popen(self.cmd, cwd=str(REPO_ROOT), stdout=self.log, stderr=subprocess.STDOUT, env=self.env, **kw)
        self.started = time.time()

    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def code(self):
        return None if self.proc is None else self.proc.poll()

    def terminate(self):
        if self.alive():
            try:
                self.proc.terminate()
            except OSError:
                pass

    def kill(self):
        if self.alive():
            try:
                self.proc.kill()
            except OSError:
                pass

    def tail(self, n: int = 25) -> str:
        try:
            lines = self.log_path.read_text(encoding="utf-8", errors="replace").splitlines()
            return "\n".join(lines[-n:])
        except OSError:
            return ""


def port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def servers_serving(run_dir: Path, ports: list[int], slot: int, step: int) -> bool:
    """Every inference server's stats file reports `slot` loaded with the weights of `step`."""
    for port in ports:
        try:
            st = json.loads((Path(run_dir) / "servers" / f"s{port}.json").read_text())
        except (OSError, ValueError):
            return False
        if int(st.get("slotSteps", {}).get(str(slot), -1)) != step:
            return False
    return True


def find_node() -> str:
    node = shutil.which("node") or shutil.which("node.exe")
    if not node:
        raise SystemExit("node not found on PATH. Run scripts/setup.sh (or setup.ps1) first.")
    if not (REPO_ROOT / "node_modules" / "tsx").exists():
        raise SystemExit("node_modules/tsx missing. Run `npm install` (scripts/setup.sh does it).")
    return node


class Launcher:
    def __init__(self, cfg: dict, args):
        self.cfg, self.args = cfg, args
        self.r = write_resolved(cfg)
        self.rd = Path(self.r["runDir"])
        self.logs = self.rd / "logs"
        self.node = find_node()
        self.py = sys.executable
        self.env = dict(os.environ, PYTHONPATH=str(REPO_ROOT / "python") + os.pathsep + os.environ.get("PYTHONPATH", ""),
                        RIFTFORGE_ROOT=str(REPO_ROOT), PYTHONUNBUFFERED="1")
        self.backend = cfg["inference"]["backend"]
        self.trainer: Child | None = None
        self.servers: list[Child] = []
        self.workers: list[Child] = []
        self.eval: Child | None = None
        self.eval_step = None
        self.last_eval_step = -1
        self.eval_pending: dict | None = None   # {"step", "since"}: eval.pt pinned, waiting for the servers to load it
        self.server_restarts: list[float] = []
        self.stopping = False
        self.reason = ""
        self.t0 = time.time()
        self.prev_games = (time.time(), 0)
        self.rate = 0.0

    def node_cmd(self, script: str, *a) -> list[str]:
        return [self.node, "--import", "tsx", str(REPO_ROOT / script), *[str(x) for x in a]]

    def say(self, msg: str):
        line = f"[launch {time.strftime('%H:%M:%S')}] {msg}"
        print(line, flush=True)
        with open(self.logs / "launch.log", "a", encoding="utf-8") as f:
            f.write(line + "\n")

    def abort(self, why: str, child: Child | None = None):
        self.say(f"ABORT: {why}")
        if child:
            print(f"----- last lines of {child.log_path} -----\n{child.tail()}\n-----", flush=True)
        self.reason = f"ABORT: {why}"
        self.stopping = True

    # ------------------------------------------------------------------ startup
    def start(self):
        self.logs.mkdir(parents=True, exist_ok=True)
        stop_file = self.rd / "STOP"
        if stop_file.exists():
            stop_file.unlink()
        (self.rd / "run.pid").write_text(json.dumps({"pid": os.getpid(), "started": time.time(), "config": str(self.args.config)}))
        self.say(f"run {self.r['runName']} in {self.rd}")
        self.say(f"{self.r['workers']['count']} workers x {self.r['workers']['concurrentGames']} games, env {self.r['env']['kind']}, "
                 f"backend {self.backend}, servers on ports {self.r['servers']['ports']}")
        out = subprocess.run(self.node_cmd("tools/train-schema.ts", "--out", self.rd), cwd=str(REPO_ROOT), env=self.env,
                             capture_output=True, text=True)
        if out.returncode != 0:
            raise SystemExit(f"schema export failed:\n{out.stdout}\n{out.stderr}")
        self.say(f"encoder schema {out.stdout.strip()}")
        host = self.r["servers"]["host"]
        for p in self.r["servers"]["ports"]:
            if not port_free(host, p):
                raise SystemExit(f"port {p} is in use (another run still active? `python -m riftzero.status`), or set inference.basePort")

        if self.backend != "mock":
            self.trainer = Child("trainer", [self.py, "-m", "riftzero.train", "--run", str(self.rd)], self.logs / "trainer.log", self.env)
            self.trainer.start()
            self.say("trainer started; waiting for the first checkpoint")
            t = time.time()
            while not (self.rd / "ckpt" / "latest.pt").exists():
                if not self.trainer.alive():
                    self.abort("trainer exited during startup", self.trainer); return
                if time.time() - t > 900:
                    self.abort("no checkpoint after 15 minutes", self.trainer); return
                time.sleep(1)

        gpus = self.cfg["inference"]["gpus"] or [0]
        per = int(self.cfg["inference"].get("serversPerGpu", 1))
        for i, port in enumerate(self.r["servers"]["ports"]):
            gpu = gpus[(i // per) % len(gpus)]
            cmd = [self.py, "-m", "riftzero.infer_server", "--run", str(self.rd), "--port", str(port), "--gpu", str(gpu), "--backend", self.backend]
            c = Child(f"server-{port}", cmd, self.logs / f"server-{port}.log", self.env)
            c.start()
            self.servers.append(c)
        t = time.time()
        for c, port in zip(self.servers, self.r["servers"]["ports"]):
            while not port_open(host, port):
                if not c.alive():
                    self.abort(f"inference server on {port} exited during startup", c); return
                if time.time() - t > 600:
                    self.abort(f"inference server on {port} not listening after 10 minutes", c); return
                time.sleep(0.5)
        self.say(f"{len(self.servers)} inference server(s) up")

        for i in range(self.r["workers"]["count"]):
            port = self.r["servers"]["ports"][i % len(self.r["servers"]["ports"])]
            c = Child(f"worker-{i}", self.node_cmd("src/ai/selfplay/worker.ts", "--run", self.rd, "--id", i, "--port", port),
                      self.logs / f"worker-{i:03d}.log", self.env)
            c.start()
            self.workers.append(c)
        self.say(f"{len(self.workers)} self-play workers started. Stop with Ctrl-C or `python -m riftzero.stop --run {self.rd}`")

    # ------------------------------------------------------------------ supervision
    def supervise(self):
        last_status = 0.0
        while not self.stopping:
            time.sleep(2)
            if (self.rd / "STOP").exists():
                self.reason = "STOP file"; break
            if self.args.duration and time.time() - self.t0 > self.args.duration:
                self.reason = f"duration {self.args.duration}s reached"; break
            if self.trainer and not self.trainer.alive():
                if self.trainer.code() == 0:
                    self.reason = "trainer finished"; break
                self.abort(f"trainer exited with code {self.trainer.code()}", self.trainer); break
            for s in self.servers:
                if s.alive():
                    continue
                now = time.time()
                self.server_restarts = [t for t in self.server_restarts if now - t < 600] + [now]
                limit = int(self.cfg["inference"].get("maxServerRestarts", 5))
                if len(self.server_restarts) > limit:
                    self.abort(f"{s.name} exited with code {s.code()} ({limit}+ server restarts in 10 minutes)", s); break
                self.say(f"{s.name} exited with code {s.code()}; restarting it (workers reconnect on their own). Last log lines:\n{s.tail(8)}")
                time.sleep(1)
                s.start()
            if self.stopping:
                break
            for w in self.workers:
                if w.alive():
                    continue
                now = time.time()
                w.restarts = [t for t in w.restarts if now - t < 600] + [now]
                if len(w.restarts) > 10:
                    self.abort(f"{w.name} crashed more than 10 times in 10 minutes", w); break
                self.say(f"{w.name} exited ({w.code()}); restarting")
                time.sleep(1)
                w.start()
            self.maybe_eval()
            if time.time() - last_status > 5:
                self.write_status("running"); last_status = time.time()

    def maybe_eval(self):
        ev = self.cfg["eval"]
        every = int(ev.get("everyCheckpoints", 0))
        if every <= 0 or not self.cfg["eval"]["opponents"]:
            return
        if self.eval is not None:
            if self.eval.alive():
                return
            code = self.eval.code()
            res = self.rd / "eval" / f"step-{self.eval_step}.json"
            if code == 0 and res.exists():
                rows = record_eval(self.rd, res, ev.get("gating", {}))
                summary = ", ".join(f"{r['opponent']} {r['score']} ({r['elo_diff']:+} Elo)" for r in rows)
                self.say(f"eval step {self.eval_step}: {summary}")
            else:
                self.say(f"eval for step {self.eval_step} failed (code {code}); see {self.eval.log_path}")
            self.last_eval_step = self.eval_step
            self.eval = None
            return
        if self.eval_pending is not None:
            p = self.eval_pending
            if self.servers_serving_eval(p["step"]):
                self.start_eval(p["step"])
                self.eval_pending = None
            elif time.time() - p["since"] > 3 * float(self.cfg["inference"]["reloadEverySec"]) + 30:
                self.say(f"inference servers did not load eval.pt (step {p['step']}) in time; skipping this eval")
                self.last_eval_step = p["step"]
                self.eval_pending = None
            return
        if self.backend == "mock":  # no trainer: evaluate the (uniform) network once, as a plumbing check
            step = 0 if self.last_eval_step < 0 and time.time() - self.t0 > 60 else None
        else:
            steps = list_steps(self.rd)
            newest = steps[-1] if steps else 0
            k = int(self.cfg["train"]["ckptEverySteps"])
            step = newest if newest > 0 and newest >= max(0, self.last_eval_step) + every * k else None
        if step is None or step == self.last_eval_step:
            return
        if self.backend == "mock":
            self.start_eval(step)
            return
        # pin exactly these weights (slot 2) so the whole eval plays step N even while latest.pt moves on
        try:
            pin_eval(self.rd, step)
        except OSError as e:
            self.say(f"could not pin step {step} for eval ({e}); skipping")
            self.last_eval_step = step
            return
        self.eval_pending = {"step": step, "since": time.time()}

    def servers_serving_eval(self, step: int) -> bool:
        return servers_serving(self.rd, self.r["servers"]["ports"], 2, step)

    def start_eval(self, step: int):
        ev = self.cfg["eval"]
        self.eval_step = step
        self.eval = Child("eval", self.node_cmd("tools/train-eval.ts", "--run", self.rd, "--step", step, "--port", self.r["servers"]["ports"][0]),
                          self.logs / "eval.log", self.env)
        self.eval.start()
        self.say(f"evaluating step {step} vs {', '.join(ev['opponents'])} ({ev['gamesPerOpponent']} games each)")

    def worker_stats(self) -> dict:
        tot = {"games": 0, "ok": 0, "timeouts": 0, "errors": 0, "positions": 0, "decisions": 0, "sims": 0, "evals": 0, "rollbacks": 0}
        d = self.rd / "workers"
        for p in d.glob("w*.json") if d.exists() else []:
            try:
                s = json.loads(p.read_text())
            except (OSError, ValueError):
                continue
            for k in tot:
                tot[k] += int(s.get(k, 0))
        return tot

    def write_status(self, state: str):
        ws = self.worker_stats()
        now = time.time()
        t_prev, g_prev = self.prev_games
        if now - t_prev > 60:
            self.rate = (ws["games"] - g_prev) / (now - t_prev) if ws["games"] >= g_prev else self.rate
            self.prev_games = (now, ws["games"])
        steps = list_steps(self.rd)
        st = {"state": state, "reason": self.reason, "updated": now, "started": self.t0, "uptimeSec": now - self.t0,
              "run": self.r["runName"], "backend": self.backend,
              "workersAlive": sum(w.alive() for w in self.workers), "workers": len(self.workers),
              "workerRestarts": sum(len(w.restarts) for w in self.workers),
              "gamesPerSec": self.rate, "selfplay": ws, "latestStep": steps[-1] if steps else 0,
              "evalRunning": self.eval is not None, "lastEvalStep": self.last_eval_step}
        tmp = self.rd / "status.json.tmp"
        tmp.write_text(json.dumps(st, indent=1))
        os.replace(tmp, self.rd / "status.json")

    # ------------------------------------------------------------------ shutdown
    def shutdown(self):
        self.say(f"stopping ({self.reason or 'requested'})...")
        (self.rd / "STOP").write_text(self.reason or "stop")
        t = time.time()
        while any(w.alive() for w in self.workers) and time.time() - t < 90:
            time.sleep(0.5)
        for w in self.workers:
            w.terminate()
        if self.eval:
            self.eval.terminate()
        if self.trainer:
            t = time.time()
            while self.trainer.alive() and time.time() - t < 300:
                time.sleep(0.5)
            if self.trainer.alive():
                self.say("trainer did not stop within 5 minutes; terminating")
                self.trainer.terminate()
        for s in self.servers:
            s.terminate()
        time.sleep(1)
        for c in [*self.workers, *self.servers, *( [self.trainer] if self.trainer else [] ), *( [self.eval] if self.eval else [] )]:
            c.kill()
        self.write_status("stopped")
        try:
            (self.rd / "run.pid").unlink()
        except OSError:
            pass
        self.say("stopped. Start again with the same config/name to resume.")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Start (or resume) a Riftforge self-play training run.")
    ap.add_argument("--config", default=str(REPO_ROOT / "config" / "train.yaml"))
    ap.add_argument("--name", default=None, help="run name (default: run.name in the config)")
    ap.add_argument("--duration", type=float, default=None, help="stop after this many seconds")
    ap.add_argument("--backend", choices=["torch", "mock"], default=None, help="mock = no torch/GPU plumbing test")
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--set", action="append", default=[], help="override a config value, e.g. --set search.fullSims=32")
    args = ap.parse_args(argv)
    over = parse_set(args.set)
    if args.name:
        over.setdefault("run", {})["name"] = args.name
    if args.backend:
        over.setdefault("inference", {})["backend"] = args.backend
    if args.workers:
        over.setdefault("selfplay", {})["workers"] = args.workers
    cfg = load_config(args.config, over)
    L = Launcher(cfg, args)

    def on_signal(*_):
        L.reason = L.reason or "interrupted"
        L.stopping = True
    signal.signal(signal.SIGINT, on_signal)
    try:
        signal.signal(signal.SIGTERM, on_signal)
    except (AttributeError, ValueError):
        pass
    try:
        L.start()
        if not L.stopping:
            L.supervise()
    finally:
        L.shutdown()
    return 1 if L.reason.startswith("ABORT") else 0


if __name__ == "__main__":
    sys.exit(main())
