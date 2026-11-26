# Thin wrapper (native Windows, best effort; WSL2 is the supported route): python -m riftzero.stop with the repo's venv.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$py = Join-Path (Get-Location) ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
$env:PYTHONPATH = (Join-Path (Get-Location) "python")
& $py -m riftzero.stop @args
exit $LASTEXITCODE
