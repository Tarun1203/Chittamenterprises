<#
  Registers a Windows scheduled task that runs tally-sync.ps1 every
  15 minutes while you're logged in, so the Sheet stays up to date
  through the day. Run once, from this folder:

    powershell -ExecutionPolicy Bypass -File .\install-task.ps1

  To remove it later:
    schtasks /Delete /TN "Chittam Tally Sync" /F
#>
param([int]$EveryMinutes = 15)

$script = Join-Path $PSScriptRoot 'tally-sync.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $script) `
  -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'Chittam Tally Sync' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Uploads today''s Tally Day Book to the Chittam Google Sheet.' -Force | Out-Null

Write-Host "Scheduled 'Chittam Tally Sync' every $EveryMinutes minutes. Log: $(Join-Path $PSScriptRoot 'tally-sync.log')"
