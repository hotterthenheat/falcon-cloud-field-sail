# Keeps Slayer running on this PC around the clock. It registers two tasks that start at log-in (and at boot, when this
# is run from an Administrator PowerShell) and never stay down:
#   SlayerTheta  the supervised ThetaData terminal (npm run theta)
#   SlayerSite   the site and its data server (npm run serve): the Unusual Whales and ThetaData proxies, the shared
#                data hub and the Compass engine, on http://localhost:8080 (PORT in .env.local moves it)
# Each task runs theta\autostart-run.ps1, which starts its program again ten seconds after any exit (clean or not);
# Task Scheduler restarts the runner itself if it ever fails (every minute, up to 255 times: the schema's limit).
# SlayerSite rebuilds the site before it starts whenever the code changed since the last build (a git pull), and runs
# npm ci first when package-lock.json changed. Logs: theta\run\autostart-theta.log and autostart-site.log.
#
# Run once from the slayer folder in PowerShell:   powershell -ExecutionPolicy Bypass -File theta\install-autostart.ps1
# Update after pulling new code:                   git pull, then
#                                                  Stop-ScheduledTask SlayerSite; Start-ScheduledTask SlayerSite
#                                                  (the site rebuilds itself; docs/theta-terminal.md, "Updating")
# Remove them with:   Unregister-ScheduledTask -TaskName SlayerTheta -Confirm:$false
#                     Unregister-ScheduledTask -TaskName SlayerSite -Confirm:$false
# The keys are read from slayer\.env.local (THETADATA_API_KEY=..., UNUSUAL_WHALES_API_KEY=...), never stored in a task.

$ErrorActionPreference = 'Stop'
$app = Split-Path -Parent $PSScriptRoot
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $npm -or -not $node) { throw 'Node was not found on PATH. Install Node 22 or 24 (https://nodejs.org, the LTS installer), then open a new PowerShell.' }
$major = [int]((& $node -p 'process.versions.node.split(".")[0]').Trim())
if ($major -ne 22 -and $major -ne 24) { throw "Node $major is installed; Slayer needs Node 22 or 24 (https://nodejs.org)." }
if (-not (Get-Command java.exe -ErrorAction SilentlyContinue) -and -not $env:JAVA_HOME) {
  Write-Warning 'Java was not found on PATH: the ThetaData terminal needs Java 21 or newer (https://adoptium.net).'
}

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

Push-Location $app
try {
  if (-not (Test-Path (Join-Path $app 'node_modules'))) {
    Write-Host 'Installing packages once (npm ci)...'
    & $npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
  }
  Write-Host 'Building the site (npm run build)...'
  & $npm run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build failed.' }
} finally {
  Pop-Location
}

$elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$triggers = @(New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
if ($elevated) {
  # at boot too, before anyone logs in: the task then runs as this user without a password (S4U)
  $triggers += New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
} else {
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Write-Host 'Not an Administrator PowerShell: the tasks start at log-in only. Run this again as Administrator to also start them at boot.'
}
# Task Scheduler's own restart (on a failure of the runner): every minute, 255 times (the most its schema allows); never
# stopped for running long or on battery; one copy at a time
$settings = New-ScheduledTaskSettingsSet -RestartCount 255 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew

$runner = Join-Path $PSScriptRoot 'autostart-run.ps1'
$ps = (Get-Command powershell.exe).Source
foreach ($t in @(@{ Name = 'SlayerTheta'; What = 'theta'; About = 'supervised ThetaData terminal (npm run theta)' },
                 @{ Name = 'SlayerSite'; What = 'site'; About = 'site, data proxies and Compass engine (npm run serve)' })) {
  $action = New-ScheduledTaskAction -Execute $ps -WorkingDirectory $app `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -What $($t.What)"
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $triggers -Settings $settings -Principal $principal `
    -Description "Slayer: $($t.About)" -Force | Out-Null
}

Start-ScheduledTask -TaskName 'SlayerTheta'
Start-ScheduledTask -TaskName 'SlayerSite'
Write-Host 'SlayerTheta and SlayerSite are installed and running. They start again after any exit.'
Write-Host 'Open http://localhost:8080 . Check ThetaData with "npm run theta:check"; logs are in theta\run\.'
Write-Host 'To update: git pull, then Stop-ScheduledTask SlayerSite; Start-ScheduledTask SlayerSite (it rebuilds itself).'
Write-Host 'Keep the PC awake: Settings > System > Power > Screen and sleep > "When plugged in, put my device to sleep after" = Never.'
Write-Host 'Do not also run "npm run dev" or "npm run serve" by hand while SlayerSite runs: one Compass engine per record folder.'
