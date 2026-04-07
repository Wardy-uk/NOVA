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

    # ── Pull latest code ─────────────────────────────────────────────────────
    Write-Host "[1/4] Pulling latest from origin/$Branch..." -ForegroundColor Yellow
    git checkout -- package-lock.json 2>$null
    git pull origin $Branch
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

    # ── Run data migrations ─────────────────────────────────────────────────
    Write-Host "[4/5] Running data migrations..." -ForegroundColor Yellow

    # Training Matrix import (idempotent — clears and re-imports from xlsx)
    $trainingXlsx = "C:\Users\NickW\Downloads\Training Matrix - 2026.xlsx"
    $trainingScript = Join-Path $AppDir "scripts\import-training-matrix.mjs"
    if ((Test-Path $trainingScript) -and (Test-Path $trainingXlsx)) {
        Write-Host "  Importing training matrix from $trainingXlsx..."
        # Service must be stopped so sql.js doesn't overwrite our DB changes
        nssm stop $ServiceName 2>$null
        Start-Sleep -Seconds 2
        node $trainingScript $trainingXlsx
        if ($LASTEXITCODE -ne 0) { Write-Host "  WARNING: Training import failed (non-fatal)" -ForegroundColor Yellow }
        else { Write-Host "  Training matrix imported successfully" -ForegroundColor Green }
    } else {
        Write-Host "  Skipping training import (xlsx or script not found)" -ForegroundColor DarkGray
    }
    Write-Host ""

    # ── Restart service ──────────────────────────────────────────────────────
    Write-Host "[5/5] Restarting $ServiceName service..." -ForegroundColor Yellow
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
