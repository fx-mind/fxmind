# Start FXServer inside the Cursor terminal with interactive console I/O.
# Do NOT pipe stdout here — piping breaks stdin echo (typed chars hidden until Enter).
# Agent logs: RCON -> .fxmind/fivem-console.log; optional .fxmind/server-debug.log.
# Generated/updated by: fxmind fivem install
$ErrorActionPreference = 'Continue'

if (-not $PSScriptRoot) {
  Write-Error 'PSScriptRoot is empty'
  exit 1
}

$root = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..'))
$fx = [System.IO.Path]::Combine($root, 'artifacts', 'FXServer.exe')
$logDir = [System.IO.Path]::Combine($root, '.fxmind')
$log = [System.IO.Path]::Combine($logDir, 'fivem-console.log')

if (-not [System.IO.File]::Exists($fx)) {
  Write-Error ('FXServer not found: {0}' -f $fx)
  exit 1
}

[System.IO.Directory]::CreateDirectory($logDir) | Out-Null
$header = '==== fivem-start {0} ====' -f (Get-Date -Format o)
[System.IO.File]::WriteAllText($log, $header + [Environment]::NewLine)

Write-Host ('FXServer -> {0}' -f $fx)
Write-Host ('RCON log -> {0}' -f $log)
Write-Host ('cwd -> {0}' -f $root)
Write-Host ''

Set-Location -LiteralPath $root

$argsList = @('+set', 'onesync', 'on', '+exec', '__FXMIND_EXEC_CFG__')
& $fx @argsList
if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
