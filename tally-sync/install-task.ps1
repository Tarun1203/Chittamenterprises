<#
  Runs tally-balances-sync.ps1 every 30 minutes (hidden) while you are
  logged in on this PC. Run once from this folder:

    powershell -ExecutionPolicy Bypass -File .\install-task.ps1

  Remove later with:
    schtasks /Delete /TN "Chittam Tally Balance Sync" /F
#>
param([int]$EveryMinutes = 30)

$script = Join-Path $PSScriptRoot 'tally-balances-sync.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $script) `
  -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'Chittam Tally Balance Sync' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Sends Tally customer balances (both companies) to the Chittam app every 30 minutes.' -Force | Out-Null

Write-Host "Scheduled 'Chittam Tally Balance Sync' every $EveryMinutes minutes. Log: $(Join-Path $PSScriptRoot 'tally-sync.log')"
