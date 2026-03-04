$source = "C:\Users\NickW\Claude\windows automation\daypilot"
$dest = "C:\Users\NickW\OneDrive - Nurtur Limited\Desktop\NOVA-deploy.zip"

if (Test-Path $dest) { Remove-Item $dest }

$staging = Join-Path $env:TEMP "nova-deploy-staging"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path $staging | Out-Null

$items = @("src", "public", "deploy", "docs", "data", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.server.json", "vite.config.ts", "web.config", ".env.template", "OnboardingMatix.xlsx")

foreach ($item in $items) {
    $srcPath = Join-Path $source $item
    if (Test-Path $srcPath) {
        $destPath = Join-Path $staging $item
        if ((Get-Item $srcPath).PSIsContainer) {
            Copy-Item -Recurse -Path $srcPath -Destination $destPath
        } else {
            Copy-Item -Path $srcPath -Destination $destPath
        }
    } else {
        Write-Host "Skipping (not found): $item"
    }
}

Compress-Archive -Path "$staging\*" -DestinationPath $dest -Force

Remove-Item -Recurse -Force $staging

$size = [math]::Round((Get-Item $dest).Length / 1MB, 1)
Write-Host "Created: $dest ($size MB)"
