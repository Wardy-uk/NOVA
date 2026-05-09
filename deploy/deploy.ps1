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

    # -- Stop service (so native .node binaries aren't locked) -----------------
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

    # -- Pull latest code -----------------------------------------------------
    Write-Host "[1/4] Pulling latest from azdo/$Branch..." -ForegroundColor Yellow
    git checkout -- package-lock.json 2>$null
    git pull azdo $Branch
    if ($LASTEXITCODE -ne 0) { throw "git pull failed" }
    Write-Host ""

    # -- Install dependencies (skip if lockfile unchanged) ----------------------
    $env:NODE_OPTIONS = "--max-old-space-size=1536"
    $lockHash = Get-FileHash -Path "package-lock.json" -Algorithm MD5 | Select-Object -ExpandProperty Hash
    $cachedHash = if (Test-Path ".deploy-lock-hash") { Get-Content ".deploy-lock-hash" } else { "" }
    if ($lockHash -ne $cachedHash) {
        Write-Host "[2/4] Installing dependencies (lockfile changed)..." -ForegroundColor Yellow
        npm install --production
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        $lockHash | Set-Content ".deploy-lock-hash"
    } else {
        Write-Host "[2/4] Dependencies up to date (lockfile unchanged)" -ForegroundColor Green
    }
    Write-Host ""

    # -- Build nova-mcp --------------------------------------------------------
    $mcpDir = Join-Path $AppDir "nova-mcp"
    if (Test-Path $mcpDir) {
        Push-Location $mcpDir
        $mcpLockHash = Get-FileHash -Path "package-lock.json" -Algorithm MD5 | Select-Object -ExpandProperty Hash
        $mcpCachedHash = if (Test-Path ".deploy-lock-hash") { Get-Content ".deploy-lock-hash" } else { "" }
        if ($mcpLockHash -ne $mcpCachedHash) {
            Write-Host "[2.5/4] Installing nova-mcp dependencies..." -ForegroundColor Yellow
            npm install --production
            if ($LASTEXITCODE -ne 0) { throw "nova-mcp npm install failed" }
            $mcpLockHash | Set-Content ".deploy-lock-hash"
        } else {
            Write-Host "[2.5/4] nova-mcp dependencies up to date" -ForegroundColor Green
        }
        Write-Host "[2.5/4] Building nova-mcp..." -ForegroundColor Yellow
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "nova-mcp build failed" }
        Pop-Location
    } else {
        Write-Host "nova-mcp directory not found - skipping" -ForegroundColor DarkYellow
    }
    Write-Host ""

    # -- Build ----------------------------------------------------------------
    Write-Host "[3/4] Building client + server..." -ForegroundColor Yellow
    npm run build
    # TypeScript emits JS despite type errors (noEmitOnError: false)
    # so we check for the output file instead of the exit code
    $entry = Join-Path $AppDir "dist\server\server\index.js"
    if (-not (Test-Path $entry)) { throw "Build failed: $entry not found" }
    Write-Host "Build output verified: $entry" -ForegroundColor Green
    Write-Host ""

    # -- Restart service ------------------------------------------------------
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
