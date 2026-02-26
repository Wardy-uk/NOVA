#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Creates the NOVA IIS site with HTTPS binding and SSL certificate.

.DESCRIPTION
    Creates an IIS website that reverse-proxies to the Node.js backend via URL Rewrite.
    Requires: IIS, URL Rewrite module, ARR with proxy enabled, SSL certificate installed.

.EXAMPLE
    .\setup-iis-site.ps1
    .\setup-iis-site.ps1 -Hostname "nova.example.com" -Thumbprint "abc123..."
#>

param(
    [string]$SiteName = "NOVA",
    [string]$PhysicalPath = "C:\Nurtur\NOVA",
    [string]$Hostname = "nova.nurtur.tech",
    [string]$Thumbprint = "fcaf525d3e1501517e69cf67c3fa9d7bb825cf77"
)

$ErrorActionPreference = "Stop"

Import-Module WebAdministration

# ── Remove existing site if present ──────────────────────────────────────────

if (Get-Website -Name $SiteName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing IIS site '$SiteName'..."
    Remove-Website -Name $SiteName
}

# ── Create the IIS site ─────────────────────────────────────────────────────

Write-Host "Creating IIS site '$SiteName'..."
Write-Host "  Physical path : $PhysicalPath"
Write-Host "  Hostname      : $Hostname"
Write-Host ""

New-Website -Name $SiteName `
    -PhysicalPath $PhysicalPath `
    -Port 443 `
    -HostHeader $Hostname `
    -Ssl `
    -Force

# ── Bind the SSL certificate ────────────────────────────────────────────────

$cert = Get-ChildItem -Path Cert:\LocalMachine\My\$Thumbprint -ErrorAction SilentlyContinue

if ($cert) {
    $binding = Get-WebBinding -Name $SiteName -Protocol https
    $binding.AddSslCertificate($Thumbprint, "My")
    Write-Host "SSL certificate bound: $($cert.Subject)" -ForegroundColor Green
} else {
    Write-Host "WARNING: Certificate with thumbprint $Thumbprint not found in LocalMachine\My store." -ForegroundColor Red
    Write-Host "You will need to bind the certificate manually in IIS Manager."
}

# ── Add HTTP binding (optional redirect) ────────────────────────────────────

New-WebBinding -Name $SiteName -Protocol http -Port 80 -HostHeader $Hostname
Write-Host "HTTP binding added on port 80 (for redirect)."

# ── Start the site ──────────────────────────────────────────────────────────

Start-Website -Name $SiteName
Write-Host ""
Write-Host "IIS site '$SiteName' created and started." -ForegroundColor Green
Write-Host ""
Write-Host "  HTTPS : https://$Hostname"
Write-Host "  HTTP  : http://$Hostname (configure redirect rule if needed)"
Write-Host "  Proxy : http://127.0.0.1:3069 (via web.config URL Rewrite)"
Write-Host ""
Write-Host "Test: open https://$Hostname in a browser."
