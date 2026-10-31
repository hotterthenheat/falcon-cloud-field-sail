# What the SlayerTheta and SlayerSite tasks run (theta\install-autostart.ps1 registers them). It keeps one program
# running forever: when it exits for any reason, clean or not, it is started again ten seconds later (Task Scheduler's
# own restart only covers a failure, and at most 255 times).
#   -What theta   the supervised ThetaData terminal (npm run theta)
#   -What site    the site and its data server (npm run serve). Before each start it rebuilds the site when the code
#                 changed since the last build (a git pull, a checkout), and reinstalls packages first when
#                 package-lock.json changed, so "git pull" plus a task restart is enough to update.
param([Parameter(Mandatory = $true)][ValidateSet('theta', 'site')][string]$What)

$ErrorActionPreference = 'Continue'
$app = Split-Path -Parent $PSScriptRoot
Set-Location $app
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
$logDir = Join-Path $app 'theta\run'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "autostart-$What.log"
function Say($m) { Add-Content -Encoding utf8 -Path $log -Value ("{0} {1}" -f (Get-Date -Format 's'), $m) }

function Stamp($p) { if (Test-Path $p) { (Get-Item $p).LastWriteTimeUtc } else { [datetime]::MinValue } }

function Update-Site {
  # the last time HEAD moved (pull, checkout, commit): git's own log of it
  $headLog = (& git -C $app rev-parse --git-path logs/HEAD 2>$null)
  if ($headLog -and -not [System.IO.Path]::IsPathRooted($headLog)) { $headLog = Join-Path $app $headLog }
  $moved = if ($headLog) { Stamp $headLog } else { [datetime]::MinValue }
  $lock = Stamp (Join-Path $app 'package-lock.json')
  $installed = Stamp (Join-Path $app 'node_modules\.package-lock.json')
  if ($lock -gt $installed) {
    Say 'package-lock.json changed: npm ci'
    & $npm ci 2>&1 | Out-File -Append -Encoding utf8 $log
  }
  $built = Stamp (Join-Path $app 'dist\index.html')
  if ($built -lt $moved -or $built -eq [datetime]::MinValue) {
    Say 'the code changed since the last build: npm run build'
    & $npm run build 2>&1 | Out-File -Append -Encoding utf8 $log
    if ($LASTEXITCODE -ne 0) { Say 'npm run build failed; serving the previous build' }
  }
}

# A site server this folder started that outlived its runner (the task was stopped, the runner killed) still holds the
# port: stop it so the new one can listen. Only node processes running this folder's server.ts are touched.
function Stop-LeftoverSite {
  $mine = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$app*" -and $_.CommandLine -like '*server.ts*' }
  foreach ($p in $mine) {
    Say "stopping a leftover site server (pid $($p.ProcessId))"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

while ($true) {
  if ($What -eq 'site') { Update-Site; Stop-LeftoverSite }
  Say "starting npm run $(if ($What -eq 'site') { 'serve' } else { 'theta' })"
  if ($What -eq 'site') { & $npm run serve } else { & $npm run theta }
  Say "exited ($LASTEXITCODE); starting again in 10 s"
  Start-Sleep -Seconds 10
}
