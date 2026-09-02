#Requires -Version 5.1
<#
  Uninstaller for Claude Sessions Manager (csm) on Windows. Mirrors
  uninstall.sh: remove the binary, leave saved sessions in place.

  Run:  irm https://raw.githubusercontent.com/AbdelzaherAbdelgwad/claude-sessions-manager-tui/master/uninstall.ps1 | iex
#>

$ErrorActionPreference = 'Stop'

$BinDir   = Join-Path $env:LOCALAPPDATA 'Programs\csm'
$BinPath  = Join-Path $BinDir 'csm.exe'
$StateDir = Join-Path $env:USERPROFILE '.claude-sessions-manager'

Write-Host "-> Removing launcher..."
if (Test-Path $BinPath) {
  try {
    Remove-Item -Force $BinPath
  } catch {
    # Windows locks a running executable, so say so rather than failing quietly.
    Write-Host "X Could not remove $BinPath - is csm still running?" -ForegroundColor Red
    Write-Host "  Close it and run this again."
    exit 1
  }
}
# Only drop the directory if nothing else ended up in it.
if ((Test-Path $BinDir) -and -not (Get-ChildItem -Force $BinDir)) {
  Remove-Item -Force $BinDir
}

# Take the install dir back out of the persisted user PATH.
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -like "*$BinDir*") {
  $cleaned = ($userPath -split ';' | Where-Object { $_ -and $_ -ne $BinDir }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $cleaned, 'User')
  Write-Host "-> Removed $BinDir from your user PATH"
}

Write-Host ""
Write-Host "OK Claude Sessions Manager TUI uninstalled." -ForegroundColor Green
Write-Host ""
Write-Host "  Saved sessions were kept in $StateDir"
Write-Host "  Delete that folder to remove saved state:"
Write-Host "      Remove-Item -Recurse -Force `"$StateDir`""
Write-Host ""
