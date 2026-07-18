# Start FXServer inside the Cursor terminal; mirror stdout/stderr to
# .fxmind/fivem-console.log for fxmind MCP / `fxmind fivem tail`.
# Avoid Join-Path/Test-Path wildcards on [bracket] paths — use [IO.Path].
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
Write-Host ('Console log -> {0}' -f $log)
Write-Host ('cwd -> {0}' -f $root)

Set-Location -LiteralPath $root

$argsList = @('+set', 'onesync', 'on', '+exec', '__FXMIND_EXEC_CFG__')
& $fx @argsList 2>&1 | ForEach-Object {
  $line = [string]$_
  [System.IO.File]::AppendAllText($log, $line + [Environment]::NewLine)
  Write-Host $line
}
