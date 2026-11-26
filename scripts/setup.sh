#!/usr/bin/env bash
# One-time (idempotent) setup for training: Node deps, Python venv with CUDA PyTorch, GPU check.
# Linux / WSL2 (recommended on Windows). Native Windows: scripts\setup.ps1.
#   scripts/setup.sh            # normal
#   TORCH_INDEX=https://download.pytorch.org/whl/cu128 scripts/setup.sh   # override the PyTorch wheel index
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
TORCH_INDEX="${TORCH_INDEX:-https://download.pytorch.org/whl/cu128}"
ok()   { printf '  \033[32mOK\033[0m   %s\n' "$*"; }
warn() { printf '  \033[33mWARN\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; exit 1; }

echo "== Riftforge training setup in $ROOT"

# ---- WSL checks
if grep -qi microsoft /proc/version 2>/dev/null; then
  echo "== WSL2 detected"
  case "$ROOT" in
    /mnt/*) warn "the repo is on the Windows drive ($ROOT). npm, shards and checkpoints are MUCH slower there. Move it into the WSL filesystem, e.g. ~/riftforge (see TRAINING.md).";;
    *) ok "repo is inside the WSL filesystem";;
  esac
  if command -v nvidia-smi >/dev/null 2>&1; then ok "nvidia-smi works inside WSL (provided by the Windows NVIDIA driver)"
  else warn "nvidia-smi not found. Install/update the NVIDIA driver on WINDOWS (never a Linux driver inside WSL), then 'wsl --shutdown' and reopen."; fi
  MEM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo); NPROC=$(nproc)
  ok "WSL sees $NPROC CPU threads and $((MEM_KB/1024/1024)) GB RAM (raise in %UserProfile%\\.wslconfig: [wsl2] memory=24GB processors=16)"
  [ "$NPROC" -lt 8 ] && warn "few CPU threads visible to WSL: set processors= in .wslconfig"
fi

# ---- Node
if ! command -v node >/dev/null 2>&1; then
  fail "node not found. Install Node 22+: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || fail "node $(node -v) is too old; need >= 22"
ok "node $(node -v)"
if [ -L node_modules ]; then rm node_modules; fi   # a dev-environment symlink; use a real install
npm install --no-audit --no-fund >/dev/null
[ -d node_modules/tsx ] || fail "npm install did not install tsx"
ok "npm dependencies"

# ---- Python venv (recreated if broken, e.g. created before python3-venv was installed: no pip inside)
PY=${PYTHON:-python3}
command -v "$PY" >/dev/null 2>&1 || fail "python3 not found (sudo apt-get install -y python3 python3-venv)"
"$PY" -c 'import sys; assert sys.version_info >= (3, 10), sys.version' || fail "Python 3.10+ required"
if [ ! -x .venv/bin/python ] || ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
  [ -e .venv ] && warn "existing .venv is broken (no working pip); recreating it"
  rm -rf .venv
  "$PY" -m venv .venv || { rm -rf .venv; fail "could not create .venv (sudo apt-get install -y python3-venv)"; }
fi
VPY="$ROOT/.venv/bin/python"
"$VPY" -m pip install --upgrade pip >/dev/null || fail "pip upgrade failed inside .venv"

# ---- PyTorch: a CUDA 12.8+ build in the pinned range (python/requirements.txt); a CPU or older CUDA build is replaced
TORCH_SPEC=$(grep -E '^torch[<>=!~ ]' python/requirements.txt | head -1 | sed 's/[[:space:]]*#.*//')
TORCH_SPEC=${TORCH_SPEC:-torch>=2.7.1}
torch_ok() { "$VPY" python/riftzero/torch_check.py "$TORCH_SPEC" >/dev/null 2>&1; }
if ! torch_ok; then
  if "$VPY" -c 'import torch' >/dev/null 2>&1; then
    warn "installed torch ($("$VPY" python/riftzero/torch_check.py "$TORCH_SPEC" 2>&1 | tail -1)) is not a CUDA 12.8+ build in '$TORCH_SPEC'; replacing it"
  fi
  echo "== installing '$TORCH_SPEC' from $TORCH_INDEX (large download)"
  "$VPY" -m pip install --upgrade --force-reinstall "$TORCH_SPEC" --index-url "$TORCH_INDEX" || fail "torch install failed"
  torch_ok || fail "torch from $TORCH_INDEX is still not a CUDA 12.8+ build in '$TORCH_SPEC': $("$VPY" python/riftzero/torch_check.py "$TORCH_SPEC" 2>&1 | tail -1)"
fi
grep -vE '^torch[<>=!~ ]' python/requirements.txt > .venv/requirements-rest.txt
"$VPY" -m pip install -r .venv/requirements-rest.txt >/dev/null || fail "pip install -r python/requirements.txt failed"
ok "python venv (.venv) with $("$VPY" -c 'import torch; print("torch", torch.__version__, "cuda", torch.version.cuda)')"

# ---- GPU check: CUDA visible, kernels for this GPU's architecture present (checked BEFORE running anything), bf16 matmul
"$VPY" python/riftzero/torch_check.py --gpu || fail "GPU check failed (see above). Training refuses to run on CPU unless train.allowCpu / inference.allowCpu are set."

PYTHONPATH="$ROOT/python" "$VPY" -c 'import riftzero.launch' && ok "riftzero package imports"
echo "== setup done. Next: scripts/smoke.sh   (2-minute end-to-end check), then scripts/start.sh"
