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
    # Force reinstall if devDeps are missing (e.g. previous deploy used --production)
    $tscExists = Test-Path "node_modules\.bin\tsc.cmd"
    if ($lockHash -ne $cachedHash -or -not $tscExists) {
        # Say WHICH condition fired. This line used to claim "lockfile changed" whatever
        # the reason, and on 4 Sep that sent a five minute install - triggered by a missing
        # tsc after the old prune step - looking like a lockfile problem for a good while.
        $why = if ($lockHash -ne $cachedHash) { "lockfile changed" } else { "devDependencies missing" }
        Write-Host "[2/4] Installing dependencies ($why)..." -ForegroundColor Yellow
        # --include=dev: build needs vite/tsc even if npm is configured production
        npm install --include=dev
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
            npm install --include=dev
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
    $buildStart = Get-Date
    npm run build
    # Don't trust the exit code: tsc returns non-zero on the harmless pre-existing
    # sql.js type errors (noEmitOnError:false still emits). And don't trust mere
    # existence: a failed `vite build` leaves the PREVIOUS dist in place, so a stale
    # bundle gets shipped while the deploy reports success (this happened 2026-06-12,
    # stranding prod on an old build for hours). Instead, require BOTH outputs to be
    # freshly written AFTER this build started - that catches a failed vite (stale
    # dist/client) and a failed tsc emit (stale dist/server) without false-failing on
    # harmless type errors.
    $outputs = @(
        (Join-Path $AppDir "dist\server\server\index.js"),
        (Join-Path $AppDir "dist\client\index.html")
    )
    foreach ($out in $outputs) {
        if (-not (Test-Path $out)) { throw "Build failed: $out not found" }
        $written = (Get-Item $out).LastWriteTime
        if ($written -lt $buildStart) {
            throw "Build failed: $out is stale (last written $written, before build started $buildStart). The build errored without producing fresh output - check the npm run build log above."
        }
    }
    Write-Host "Build output verified (fresh): client + server" -ForegroundColor Green

    # NOTE: there is deliberately no "npm prune --omit=dev" here. Do not add one back.
    #
    # It used to sit on this line and on 2026-09-04 it hung, with the service already
    # stopped at [0/4] and the restart not until [4/4]. NOVA was down for about twenty
    # minutes. The catch block below would have recovered it, but a process that never
    # returns throws nothing, so ErrorActionPreference never fired and the recovery never
    # ran. An unbounded operation inside the downtime window has no safety net here.
    #
    # It was also self-defeating. Pruning deletes node_modules\.bin\tsc.cmd, so the
    # $tscExists check in step [2/4] is false on the NEXT deploy and forces a full
    # "npm install --include=dev" every time, whether the lockfile moved or not. The
    # 4 Sep run measured it: 467 top-level packages pruned down to 249, then reinstalled
    # straight back to 467 on the following deploy. It freed disk until the next deploy
    # and bought a slow install every deploy.
    #
    # If disk on this box ever genuinely gets tight, prune AFTER the restart below and
    # give it a timeout, so a hang costs a slow deploy rather than an outage.

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
    # The service was stopped at step [0/4]. Never leave NOVA down after a failed deploy -
    # bring it back on the PREVIOUS build so triage/assignment keep running while you
    # investigate. (A failed build leaves the old dist in place, so this is safe.)
    Write-Host "Restarting $ServiceName so it isn't left stopped..." -ForegroundColor Yellow
    nssm start $ServiceName 2>$null
    Start-Sleep -Seconds 3
    $recovery = nssm status $ServiceName
    if ($recovery -match "RUNNING") {
        Write-Host "$ServiceName recovered on the previous build." -ForegroundColor Green
    } else {
        Write-Host "$ServiceName is $recovery - NEEDS MANUAL ATTENTION." -ForegroundColor Red
    }
    exit 1
}
finally {
    Pop-Location
}
