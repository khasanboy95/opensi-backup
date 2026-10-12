$ErrorActionPreference = 'Stop'
$cfg = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'launch.json') -Raw | ConvertFrom-Json
$runtime = Join-Path $PSScriptRoot 'runtime'
$node = Join-Path $runtime 'node.exe'
$entry = Join-Path $runtime 'opensi-connector.mjs'
$log = Join-Path $PSScriptRoot 'connector.log'
$errors = Join-Path $PSScriptRoot 'connector-error.log'
$env:PATH = $runtime + ';' + $env:PATH

# The connector is a long-lived local bridge. An interrupted network request or
# unexpected Node exit must not leave every subsequent browser task offline.
while ($true) {
  try {
    & $node $entry --server $cfg.server --workspace $cfg.workspace --state-dir $cfg.stateDir 1>> $log 2>> $errors
    $exitCode = $LASTEXITCODE
  } catch {
    $exitCode = 1
  }
  Add-Content -LiteralPath $errors -Value ((Get-Date -Format o) + " Connector stopped (exit $exitCode); restarting in 10 seconds.")
  Start-Sleep -Seconds 10
}
