"""Minimal Python client for tools/gym-server.ts: a random agent (seat 0) vs the built-in bot (seat 1)."""
import json, random, subprocess, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Riftforge:
    def __init__(self):
        self.p = subprocess.Popen(["node", "--import", "tsx", "tools/gym-server.ts"], cwd=ROOT,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
    def call(self, **req):
        self.p.stdin.write(json.dumps(req) + "\n"); self.p.stdin.flush()
        return json.loads(self.p.stdout.readline())

def play(seed=1, decks=("01-azir.json", "02-vex.json")):
    env = Riftforge()
    obs = env.call(cmd="reset", seed=seed, decks=list(decks), view=False)
    while not obs["done"]:
        if obs["toAct"] == 0:
            obs = env.call(cmd="step", index=random.randrange(len(obs["legal"])), view=False)
        else:
            obs = env.call(cmd="bot", view=False)
        if "error" in obs:
            sys.exit(obs["error"])
    print(f"seed {seed}: winner seat {obs['winner']}, points {obs['points']}, turn {obs['turn']}")

if __name__ == "__main__":
    play(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
