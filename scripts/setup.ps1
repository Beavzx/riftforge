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
$vpy = Join-Path $root ".venv\Scripts\python.exe"
$venvOk = $false
if (Test-Path $vpy) { & $vpy -m pip --version *> $null; $venvOk = ($LASTEXITCODE -eq 0) }
if (-not $venvOk) {
  if (Test-Path ".venv") { Write-Host "  WARN existing .venv is broken; recreating it"; Remove-Item -Recurse -Force ".venv" }
  & $py -m venv .venv
}
& $vpy -m pip install --upgrade pip | Out-Null
$torchSpec = (Select-String -Path "python\requirements.txt" -Pattern '^torch[<>=!~ ]' | Select-Object -First 1).Line -replace '\s*#.*', ''
if (-not $torchSpec) { $torchSpec = "torch>=2.7.1" }
& $vpy python\riftzero\torch_check.py $torchSpec *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "== installing '$torchSpec' (CUDA 12.8+) from $torchIndex (large download)"
  & $vpy -m pip install --upgrade --force-reinstall $torchSpec --index-url $torchIndex
  & $vpy python\riftzero\torch_check.py $torchSpec
  if ($LASTEXITCODE -ne 0) { throw "torch is still not a CUDA 12.8+ build in '$torchSpec'" }
}
Get-Content python\requirements.txt | Where-Object { $_ -notmatch '^torch[<>=!~ ]' } | Set-Content .venv\requirements-rest.txt
& $vpy -m pip install -r .venv\requirements-rest.txt | Out-Null
& $vpy python\riftzero\torch_check.py --gpu
if ($LASTEXITCODE -ne 0) { throw "GPU check failed (see above)" }
$env:PYTHONPATH = Join-Path $root "python"
& $vpy -c "import riftzero.launch"
Write-Host "  OK   riftzero package imports"
Write-Host "== setup done. Next: scripts\smoke.ps1, then scripts\start.ps1"
