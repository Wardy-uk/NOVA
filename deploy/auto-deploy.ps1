<#
.SYNOPSIS
    Auto-deploy watcher — polls git for changes and deploys if new commits found.

.DESCRIPTION
    Checks if the remote branch has new commits. If so, runs deploy.ps1 to pull,
    build, and restart the service. Designed to run via Windows Task Scheduler
    every 2-5 minutes.

.PARAMETER Branch
    Git branch to watch. Default: nova-codex

.PARAMETER ServiceName
    NSSM service name. Default: NOVA

.PARAMETER AppDir
    Application directory (git clone). Default: C:\Nurtur\NOVA

.EXAMPLE
    # Manual run:
    .\auto-deploy.ps1

    # Task Scheduler setup (run as Administrator):
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-ExecutionPolicy Bypass -File C:\Nurtur\NOVA\deploy\auto-deploy.ps1"
    $trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 3) `
        -RepetitionDuration (New-TimeSpan -Days 365) -At "00:00"
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
    Register-ScheduledTask -TaskName "NOVA Auto-Deploy" -Action $action `
        -Trigger $trigger -Principal $principal -Description "Auto-deploy NOVA on git push"
#>

param(
    [string]$Branch = "nova-codex",
    [string]$ServiceName = "NOVA",
    [string]$AppDir = "C:\Nurtur\NOVA"
)

$LogDir = "C:\ProgramData\NOVA\logs"
$LogFile = Join-Path $LogDir "auto-deploy.log"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $Message"
    Write-Host $line
    if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    Add-Content -Path $LogFile -Value $line
}

# Rotate log if > 1 MB
if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 1MB)) {
    $rotated = "$LogFile.old"
    if (Test-Path $rotated) { Remove-Item $rotated -Force }
    Rename-Item $LogFile $rotated
}

Push-Location $AppDir

try {
    # Fetch latest from remote
    git fetch origin $Branch 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Log "ERROR: git fetch failed (exit code $LASTEXITCODE)"
        exit 1
    }

    # Compare local HEAD vs remote HEAD
    $localHead = git rev-parse HEAD
    $remoteHead = git rev-parse "origin/$Branch"

    if ($localHead -eq $remoteHead) {
        # No changes — exit silently (don't log every poll to avoid noise)
        exit 0
    }

    # New commits found — deploy
    $localShort = $localHead.Substring(0, 7)
    $remoteShort = $remoteHead.Substring(0, 7)
    Write-Log "New commits detected: $localShort -> $remoteShort"

    # Get commit messages for the log
    $commits = git log --oneline "$localHead..$remoteHead" 2>&1
    Write-Log "Commits: $commits"

    # Run deploy script
    $deployScript = Join-Path $AppDir "deploy\deploy.ps1"
    Write-Log "Starting deployment..."
    & $deployScript -Branch $Branch -ServiceName $ServiceName -AppDir $AppDir

    if ($LASTEXITCODE -eq 0) {
        Write-Log "Deployment completed successfully"
    } else {
        Write-Log "ERROR: Deployment failed (exit code $LASTEXITCODE)"
    }
}
catch {
    Write-Log "ERROR: $_"
    exit 1
}
finally {
    Pop-Location
}
