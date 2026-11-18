<#
  Installs the built app for this Windows user: copies .\dist to
  %LOCALAPPDATA%\Programs\Chittam Enterprises and adds Start menu and
  Desktop shortcuts. Run from this folder after build.ps1:

    powershell -ExecutionPolicy Bypass -File .\install.ps1

  To uninstall: delete that folder and the two shortcuts.
#>
$ErrorActionPreference = 'Stop'
$dist = Join-Path $PSScriptRoot 'dist'
if (-not (Test-Path (Join-Path $dist 'Chittam Enterprises.exe'))) { throw 'Build first: .\build.ps1' }

$target = Join-Path $env:LOCALAPPDATA 'Programs\Chittam Enterprises'
$running = Get-Process -Name 'Chittam Enterprises' -ErrorAction SilentlyContinue
if ($running) { throw 'Close Chittam Enterprises first (tray icon -> Exit), then run this again.' }

New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item (Join-Path $dist '*') $target -Force
$exe = Join-Path $target 'Chittam Enterprises.exe'

$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
  $lnk = $shell.CreateShortcut((Join-Path $folder 'Chittam Enterprises.lnk'))
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = $target
  $lnk.IconLocation = "$exe,0"
  $lnk.Description = 'Chittam Enterprises - orders, messages and Tally sync'
  $lnk.Save()
}
Write-Host "Installed to $target with Start menu and Desktop shortcuts."
