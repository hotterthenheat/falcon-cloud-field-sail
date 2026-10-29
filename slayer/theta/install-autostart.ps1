# Starts the supervised ThetaData terminal (npm run theta) whenever you log in to Windows, and keeps it running.
# Run once from the slayer folder in PowerShell:   powershell -ExecutionPolicy Bypass -File theta\install-autostart.ps1
# Remove it with:                                    Unregister-ScheduledTask -TaskName SlayerTheta -Confirm:$false
# The key is read from slayer\.env.local (THETADATA_API_KEY=...), never stored in the task.

$ErrorActionPreference = 'Stop'
$app = Split-Path -Parent $PSScriptRoot
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw 'npm was not found on PATH. Install Node 22 first.' }
if (-not (Test-Path (Join-Path $app '.env.local'))) {
  Write-Warning 'slayer\.env.local is missing: add THETADATA_API_KEY=td1_... to it, or the terminal cannot log in.'
}

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$npm`" run theta" -WorkingDirectory $app
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# restart within a minute if it ever stops, forever; never stop it for running long or on battery
$settings = New-ScheduledTaskSettingsSet -RestartCount 9999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'SlayerTheta' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Slayer: supervised ThetaData terminal (npm run theta)' -Force | Out-Null
Start-ScheduledTask -TaskName 'SlayerTheta'
Write-Host 'SlayerTheta is installed and running. It starts at every log-in and restarts if it stops.'
Write-Host 'Keep the PC awake: Settings > System > Power > Screen and sleep > "When plugged in, put my device to sleep after" = Never.'
Write-Host 'Run "npm run dev" with THETA_AUTOSTART=0 in slayer\.env.local so the dev server never starts a second terminal.'
