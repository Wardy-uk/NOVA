#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Deploy latest N.O.V.A code and restart the service.

.DESCRIPTION
    Pulls latest code from git, installs dependencies, builds the app,
    and restarts the NSSM service. Run this after pushing changes.

.PARAMETER Branch
    Git branch to pull from. Default: main

.EXAMPLE
    .\deploy.ps1
    .\deploy.ps1 -Branch nova-codex
#>

param(
    [string]$ServiceName = "NOVA",
    [string]$AppDir = "C:\Nurtur\NOVA",
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

Push-Location $AppDir

try {
    Write-Host "=== N.O.V.A Deployment ===" -ForegroundColor Cyan
    Write-Host ""

    # ── Stop service (so native .node binaries aren't locked) ─────────────────
    Write-Host "[0/4] Stopping $ServiceName service..." -ForegroundColor Yellow
    $ErrorActionPreference = "Continue"
    nssm stop $ServiceName 2>$null
    $ErrorActionPreference = "Stop"
    Start-Sleep -Seconds 2
    # Kill any lingering node processes holding the .node binary
    Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
        try { $_.MainModule.FileName -match 'Nurtur' } catch { $false }
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    # ── Pull latest code ─────────────────────────────────────────────────────
    Write-Host "[1/4] Pulling latest from azdo/$Branch..." -ForegroundColor Yellow
    git checkout -- package-lock.json 2>$null
    git pull azdo $Branch
    if ($LASTEXITCODE -ne 0) { throw "git pull failed" }
    Write-Host ""

    # ── Install dependencies ─────────────────────────────────────────────────
    Write-Host "[2/4] Installing dependencies..." -ForegroundColor Yellow
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Write-Host ""

    # ── Build ────────────────────────────────────────────────────────────────
    Write-Host "[3/4] Building client + server..." -ForegroundColor Yellow
    npm run build
    # TypeScript emits JS despite type errors (noEmitOnError: false)
    # so we check for the output file instead of the exit code
    $entry = Join-Path $AppDir "dist\server\server\index.js"
    if (-not (Test-Path $entry)) { throw "Build failed: $entry not found" }
    Write-Host "Build output verified: $entry" -ForegroundColor Green
    Write-Host ""

    # ── Restart service ──────────────────────────────────────────────────────
    Write-Host "[4/4] Restarting $ServiceName service..." -ForegroundColor Yellow
    nssm restart $ServiceName
    Start-Sleep -Seconds 3

    $status = nssm status $ServiceName
    if ($status -match "RUNNING") {
        Write-Host ""
        Write-Host "Deployment complete. $ServiceName is running." -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "WARNING: Service status is $status. Check logs." -ForegroundColor Red
    }
}
catch {
    Write-Host ""
    Write-Host "Deployment failed: $_" -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}
