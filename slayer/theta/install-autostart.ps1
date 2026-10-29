# Keeps Slayer running on this PC around the clock. It registers two tasks that start whenever you log in to Windows
# and restart within a minute if they ever stop:
#   SlayerTheta  the supervised ThetaData terminal (npm run theta)
#   SlayerSite   the site and its data server (npm run serve): the Unusual Whales and ThetaData proxies, the shared
#                data hub and the Compass engine, on http://localhost:8080 (PORT in .env.local moves it)
# Run once from the slayer folder in PowerShell:   powershell -ExecutionPolicy Bypass -File theta\install-autostart.ps1
# Remove them with:   Unregister-ScheduledTask -TaskName SlayerTheta -Confirm:$false
#                     Unregister-ScheduledTask -TaskName SlayerSite -Confirm:$false
# The keys are read from slayer\.env.local (THETADATA_API_KEY=..., UNUSUAL_WHALES_API_KEY=...), never stored in a task.
# After pulling new code, run "npm run build" and restart the site: Stop-ScheduledTask SlayerSite; Start-ScheduledTask SlayerSite

$ErrorActionPreference = 'Stop'
$app = Split-Path -Parent $PSScriptRoot
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw 'npm was not found on PATH. Install Node 22 first.' }
$envFile = Join-Path $app '.env.local'
if (-not (Test-Path $envFile)) {
  Write-Warning 'slayer\.env.local is missing: add THETADATA_API_KEY=td1_... and UNUSUAL_WHALES_API_KEY=... to it.'
} else {
  $envText = Get-Content $envFile -Raw
  if ($envText -notmatch '(?m)^\s*THETA_AUTOSTART\s*=\s*0') {
    Add-Content $envFile "`nTHETA_AUTOSTART=0"
    Write-Host 'Added THETA_AUTOSTART=0 to .env.local: the SlayerTheta task runs the terminal, so the site never starts a second one.'
  }
}
if (-not (Test-Path (Join-Path $app 'dist\index.html'))) {
  Write-Host 'Building the site once (npm run build)...'
  Push-Location $app
  & $npm run build
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm run build failed.' }
  Pop-Location
}

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# restart within a minute if it ever stops, forever; never stop it for running long or on battery
$settings = New-ScheduledTaskSettingsSet -RestartCount 9999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

$theta = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$npm`" run theta" -WorkingDirectory $app
Register-ScheduledTask -TaskName 'SlayerTheta' -Action $theta -Trigger $trigger -Settings $settings `
  -Description 'Slayer: supervised ThetaData terminal (npm run theta)' -Force | Out-Null

$site = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$npm`" run serve" -WorkingDirectory $app
Register-ScheduledTask -TaskName 'SlayerSite' -Action $site -Trigger $trigger -Settings $settings `
  -Description 'Slayer: site, data proxies and Compass engine (npm run serve)' -Force | Out-Null

Start-ScheduledTask -TaskName 'SlayerTheta'
Start-ScheduledTask -TaskName 'SlayerSite'
Write-Host 'SlayerTheta and SlayerSite are installed and running. They start at every log-in and restart if they stop.'
Write-Host 'Open http://localhost:8080 . Check ThetaData with "npm run theta:check".'
Write-Host 'Keep the PC awake: Settings > System > Power > Screen and sleep > "When plugged in, put my device to sleep after" = Never.'
Write-Host 'Do not also run "npm run dev" or "npm run serve" by hand while SlayerSite runs: one Compass engine per record folder.'
