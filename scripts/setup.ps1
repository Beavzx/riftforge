# Native Windows setup (best effort — WSL2 + scripts/setup.sh is the supported, tested route; see TRAINING.md).
# Needs: Node 22+ (https://nodejs.org), Python 3.10+ (https://python.org, "Add to PATH"), NVIDIA driver.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$root = Get-Location
$torchIndex = if ($env:TORCH_INDEX) { $env:TORCH_INDEX } else { "https://download.pytorch.org/whl/cu128" }
Write-Host "== Riftforge training setup (native Windows) in $root"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node not found: install Node 22+ from https://nodejs.org" }
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) { throw "node $(node -v) is too old; need >= 22" }
Write-Host "  OK   node $(node -v)"
npm install --no-audit --no-fund | Out-Null
if (-not (Test-Path "node_modules\tsx")) { throw "npm install did not install tsx" }
Write-Host "  OK   npm dependencies"

$py = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }
if (-not (Test-Path ".venv\Scripts\python.exe")) { & $py -m venv .venv }
$vpy = Join-Path $root ".venv\Scripts\python.exe"
& $vpy -m pip install --upgrade pip | Out-Null
& $vpy -c "import torch" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "== installing PyTorch from $torchIndex (large download)"
  & $vpy -m pip install torch --index-url $torchIndex
}
& $vpy -m pip install -r python\requirements.txt | Out-Null
& $vpy -c "import torch; print('  OK   torch', torch.__version__, '| CUDA', torch.cuda.is_available(), '|', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no GPU')"
$env:PYTHONPATH = Join-Path $root "python"
& $vpy -c "import riftzero.launch"
Write-Host "  OK   riftzero package imports"
Write-Host "== setup done. Next: scripts\smoke.ps1, then scripts\start.ps1"
