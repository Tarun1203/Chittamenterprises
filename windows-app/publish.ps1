<#
  Publishes the built app for automatic updates: copies dist\ to ..\desktop\
  (served by the site at /Chittamenterprises/desktop/) and writes
  desktop\version.json with each file's SHA-256. Installed copies check that
  file at start-up and every 6 hours, download what changed, check it, and
  install it when they restart.

  Run after build.ps1, then commit and push:
    powershell -ExecutionPolicy Bypass -File .\publish.ps1
#>
$ErrorActionPreference = 'Stop'
$dist = Join-Path $PSScriptRoot 'dist'
$out = Join-Path (Split-Path $PSScriptRoot) 'desktop'
$src = Get-Content (Join-Path $PSScriptRoot 'ChittamEnterprises.cs') -Raw
if ($src -notmatch 'DesktopVersion = "([0-9.]+)"') { throw 'DesktopVersion not found in ChittamEnterprises.cs' }
$version = $Matches[1]
$names = 'Chittam Enterprises.exe', 'Chittam Enterprises.exe.config', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll'
New-Item -ItemType Directory -Force $out | Out-Null
$files = foreach ($n in $names) {
  $p = Join-Path $dist $n
  if (-not (Test-Path $p)) { throw "Build first: $n is missing from dist" }
  Copy-Item $p (Join-Path $out $n) -Force
  [ordered]@{ name = $n; sha256 = (Get-FileHash $p -Algorithm SHA256).Hash.ToLower() }
}
# the installer, for new PCs (not part of the update itself)
Copy-Item (Join-Path $dist 'ChittamEnterprisesSetup.exe') (Join-Path $out 'ChittamEnterprisesSetup.exe') -Force
$json = [ordered]@{ version = $version; published = (Get-Date).ToString('yyyy-MM-dd HH:mm'); files = @($files) } | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText((Join-Path $out 'version.json'), $json, (New-Object Text.UTF8Encoding $false))
Write-Host "Published version $version to $out ($($files.Count) files). Commit and push to make it live."
