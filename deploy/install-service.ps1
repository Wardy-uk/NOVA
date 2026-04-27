#Requires -RunAsAdministrator
<#
.SYNOPSIS
    One-time setup: installs N.O.V.A as a Windows Service via NSSM.

.DESCRIPTION
    Creates a Windows Service called "NOVA" that runs the Node.js Express server.
    The service auto-starts on boot and auto-restarts on crash.

.NOTES
    Prerequisites:
      - Node.js 20+ installed and on PATH
      - NSSM installed and on PATH (https://nssm.cc)
      - Application code cloned to $AppDir and built (npm install && npm run build)

    Run this script ONCE as Administrator. After that, use deploy.ps1 for updates.
#>

param(
    [string]$ServiceName = "NOVA",
    [string]$AppDir = "C:\Nurtur\NOVA",
    [string]$DataDir = "C:\ProgramData\NOVA",
    [int]$Port = 3069
)

$ErrorActionPreference = "Stop"

# ── Validate prerequisites ──────────────────────────────────────────────────

if (-not (Get-Command "nssm" -ErrorAction SilentlyContinue)) {
    Write-Error "NSSM not found on PATH. Download from https://nssm.cc and add to PATH."
    exit 1
}

$NodeExe = (Get-Command "node" -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) {
    Write-Error "Node.js not found on PATH. Install from https://nodejs.org"
    exit 1
}

$EntryPoint = Join-Path $AppDir "dist\server\server\index.js"
if (-not (Test-Path $EntryPoint)) {
    Write-Error "Entry point not found: $EntryPoint`nRun 'npm run build' in $AppDir first."
    exit 1
}

# ── Create data and log directories ─────────────────────────────────────────

$LogDir = Join-Path $DataDir "logs"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir  | Out-Null

Write-Host "App directory : $AppDir"
Write-Host "Data directory: $DataDir"
Write-Host "Log directory : $LogDir"
Write-Host "Node.exe      : $NodeExe"
Write-Host "Entry point   : $EntryPoint"
Write-Host ""

# ── Remove existing service if present ──────────────────────────────────────

$ErrorActionPreference = "SilentlyContinue"
$existing = nssm status $ServiceName 2>&1
$ErrorActionPreference = "Stop"
if ($LASTEXITCODE -eq 0) {
    Write-Host "Stopping existing $ServiceName service..."
    nssm stop $ServiceName confirm 2>$null
    nssm remove $ServiceName confirm
    Write-Host "Removed existing service."
} else {
    Write-Host "No existing $ServiceName service found. Installing fresh."
}

# ── Install the service ─────────────────────────────────────────────────────

Write-Host "Installing $ServiceName service..."

nssm install $ServiceName $NodeExe "dist\server\server\index.js"
nssm set $ServiceName AppDirectory $AppDir
nssm set $ServiceName Description "N.O.V.A DayPilot - Personal Productivity Aggregator"
nssm set $ServiceName DisplayName "N.O.V.A DayPilot"

# Environment variables
nssm set $ServiceName AppEnvironmentExtra `
    "NODE_ENV=production" `
    "PORT=$Port" `
    "DATA_DIR=$DataDir"

# Logging (append mode with rotation)
nssm set $ServiceName AppStdout (Join-Path $LogDir "nova-stdout.log")
nssm set $ServiceName AppStderr (Join-Path $LogDir "nova-stderr.log")
nssm set $ServiceName AppStdoutCreationDisposition 4   # FILE_OPEN_ALWAYS (append)
nssm set $ServiceName AppStderrCreationDisposition 4
nssm set $ServiceName AppRotateFiles 1
nssm set $ServiceName AppRotateBytes 10485760           # Rotate at 10 MB

# Startup and shutdown behaviour
nssm set $ServiceName Start SERVICE_AUTO_START
nssm set $ServiceName AppStopMethodSkip 0
nssm set $ServiceName AppStopMethodConsole 5000         # Send Ctrl+C, wait 5s
nssm set $ServiceName AppStopMethodWindow 5000
nssm set $ServiceName AppStopMethodThreads 5000

# ── Start the service ────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Starting $ServiceName service..."
nssm start $ServiceName

Start-Sleep -Seconds 2
$status = nssm status $ServiceName
Write-Host ""
Write-Host "Service status: $status"

if ($status -match "RUNNING") {
    Write-Host ""
    Write-Host "NOVA is running on http://localhost:$Port"
    Write-Host "Data directory: $DataDir"
    Write-Host "Logs: $LogDir"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. Configure IIS reverse proxy (see docs/deployment.md)"
    Write-Host "  2. Open http://localhost:$Port in a browser to verify"
    Write-Host "  3. Register the first user (gets admin role)"
    Write-Host "  4. Configure integrations in Admin > Integrations"
} else {
    Write-Host ""
    Write-Host "Service may not have started correctly. Check logs:"
    Write-Host "  Get-Content '$LogDir\nova-stderr.log' -Tail 50"
}
