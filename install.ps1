# Ask Q installer for Windows. Ask Q runs inside WSL2 (Linux inside Windows), so this script:
#   1. installs WSL2 with Ubuntu if it is missing (needs a restart the first time),
#   2. turns on systemd inside Ubuntu (so Ask Q can run in the background),
#   3. keeps WSL running while you are logged in (a hidden scheduled task),
#   4. runs the normal Linux installer inside Ubuntu.
# Run in PowerShell as Administrator:
#   irm https://raw.githubusercontent.com/quircedelafuente/askq/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$Distro = 'Ubuntu'
$Installer = 'https://raw.githubusercontent.com/quircedelafuente/askq/main/install.sh'

function Step($t) { Write-Host "`n-> $t" -ForegroundColor Cyan }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host 'Open PowerShell as Administrator (right click > Run as administrator) and run this again.' -ForegroundColor Red; exit 1 }

# 1. WSL2 + Ubuntu
$distros = (wsl.exe --list --quiet 2>$null) -replace "`0", '' | Where-Object { $_.Trim() -ne '' }
if (-not ($distros -match "^$Distro")) {
  Step "Installing WSL2 with $Distro"
  wsl.exe --install -d $Distro
  Write-Host "`nRestart Windows, open '$Distro' from the Start menu once to create your Linux user, then run this script again." -ForegroundColor Yellow
  exit 0
}
wsl.exe --set-version $Distro 2 2>$null | Out-Null

# 2. systemd inside Ubuntu
Step 'Turning on systemd in WSL'
wsl.exe -d $Distro -u root -- bash -c "grep -q '^systemd=true' /etc/wsl.conf 2>/dev/null || printf '[boot]\nsystemd=true\n' >> /etc/wsl.conf"
wsl.exe --shutdown
Start-Sleep -Seconds 3

# 3. Keep WSL (and Ask Q) running while you are logged in
Step 'Keeping WSL running in the background'
$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "-d $Distro --exec sleep infinity"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -Hidden
Register-ScheduledTask -TaskName 'AskQ-KeepWSL' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'AskQ-KeepWSL'

# 4. Linux installer
Step 'Installing Ask Q inside Ubuntu'
wsl.exe -d $Distro -- bash -lc "curl -fsSL $Installer | bash"

Write-Host "`nTip: in Windows power settings, stop the PC from sleeping if you want Ask Q always available." -ForegroundColor Yellow
