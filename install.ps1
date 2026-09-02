#Requires -Version 5.1
<#
  Claude Sessions Manager (csm) installer for Windows.

  Mirrors install.sh: check for the `claude` runtime dependency, download the
  matching release binary, drop it somewhere on PATH, and add that directory to
  the user PATH if it isn't already there.

  Run:  irm https://raw.githubusercontent.com/AbdelzaherAbdelgwad/claude-sessions-manager-tui/master/install.ps1 | iex
#>

$ErrorActionPreference = 'Stop'

$Repo    = 'AbdelzaherAbdelgwad/claude-sessions-manager-tui'
$BinDir  = Join-Path $env:LOCALAPPDATA 'Programs\csm'
$BinPath = Join-Path $BinDir 'csm.exe'

# ── Runtime dependency ────────────────────────────────────────────────────────
# The binary embeds the Bun runtime, but the app spawns `claude` at runtime.
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host "X 'claude' not found. Install Claude Code: https://claude.ai/code" -ForegroundColor Red
  exit 1
}

# ── Detect platform -> release asset ──────────────────────────────────────────
# A 32-bit PowerShell on 64-bit Windows reports x86, with the real arch in
# PROCESSOR_ARCHITEW6432 — prefer that when it's set.
$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($arch -eq 'AMD64') {
  $asset = 'csm-windows-x64.exe'
} else {
  Write-Host "X No prebuilt binary for Windows $arch." -ForegroundColor Red
  Write-Host "  Supported: Windows x64 (ARM64 runs it through emulation only).
  Write-Host "  Build from source instead - see the Development section in the README."
  exit 1
}

# ── Download ──────────────────────────────────────────────────────────────────
$url = "https://github.com/$Repo/releases/latest/download/$asset"
Write-Host "-> Downloading $asset ..."
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
try {
  # Invoke-WebRequest is slow with the progress bar on large files.
  $prev = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $url -OutFile $BinPath -UseBasicParsing
  $ProgressPreference = $prev
} catch {
  Write-Host "X Download failed: $url" -ForegroundColor Red
  Write-Host "  Make sure a release has been published for this platform."
  exit 1
}

# ── Ensure the install dir is on PATH ─────────────────────────────────────────
# Edit the persisted *user* PATH, then mirror it into this session so `csm`
# works without reopening the terminal.
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$BinDir*") {
  $joined = if ([string]::IsNullOrEmpty($userPath)) { $BinDir } else { "$userPath;$BinDir" }
  [Environment]::SetEnvironmentVariable('Path', $joined, 'User')
  Write-Host "-> Added $BinDir to your user PATH"
}
if ($env:Path -notlike "*$BinDir*") { $env:Path = "$env:Path;$BinDir" }

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "OK Installed! Run the app with:" -ForegroundColor Green
Write-Host ""
Write-Host "    csm"
Write-Host ""
Write-Host "  Use Windows Terminal (not the legacy console) for truecolor and mouse support."
Write-Host ""
