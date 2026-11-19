<#
  Builds "Chittam Enterprises.exe" with the C# compiler that ships with
  Windows (.NET Framework 4.x) and puts the WebView2 files next to it.
  Nothing to install. Run from this folder:

    powershell -ExecutionPolicy Bypass -File .\build.ps1

  Output goes to .\dist - copy that whole folder anywhere (e.g. C:\Chittam).
#>
$ErrorActionPreference = 'Stop'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw 'The 64-bit .NET Framework 4 C# compiler was not found on this PC.' }

$lib = Join-Path $PSScriptRoot 'lib'
$dist = Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$out = Join-Path $dist 'Chittam Enterprises.exe'

& $csc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 "/out:$out" `
  "/win32icon:$(Join-Path $PSScriptRoot 'app.ico')" `
  "/win32manifest:$(Join-Path $PSScriptRoot 'app.manifest')" `
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
  /r:System.Xml.dll /r:System.Security.dll /r:System.Web.Extensions.dll `
  "/r:$(Join-Path $lib 'Microsoft.Web.WebView2.Core.dll')" `
  "/r:$(Join-Path $lib 'Microsoft.Web.WebView2.WinForms.dll')" `
  (Join-Path $PSScriptRoot 'ChittamEnterprises.cs')
if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }

foreach ($f in 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll') {
  Copy-Item (Join-Path $lib $f) $dist -Force
}
$src = Get-Content (Join-Path $PSScriptRoot 'ChittamEnterprises.cs') -Raw
if ($src -match 'DesktopVersion = "([0-9.]+)"') { $v = $Matches[1] } else { throw 'DesktopVersion not found' }
if ($src -notmatch ('AssemblyFileVersion\("' + [regex]::Escape($v) + '"\)')) { throw "AssemblyFileVersion must be $v (same as DesktopVersion)" }

# Windows Forms settings (sharp text at any display scaling)
Copy-Item (Join-Path $PSScriptRoot 'app.config') "$out.config" -Force
Write-Host "Built: $out"

# the one-file installer: the program files packed inside Setup.exe
$setup = Join-Path $dist 'ChittamEnterprisesSetup.exe'
$res = foreach ($f in 'Chittam Enterprises.exe', 'Chittam Enterprises.exe.config', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll') {
  "/resource:$(Join-Path $dist $f),$f"
}
& $csc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 "/out:$setup" `
  "/win32icon:$(Join-Path $PSScriptRoot 'app.ico')" "/win32manifest:$(Join-Path $PSScriptRoot 'app.manifest')" `
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll @res `
  (Join-Path $PSScriptRoot 'Setup.cs')
if ($LASTEXITCODE -ne 0) { throw "Setup build failed (exit $LASTEXITCODE)" }
Write-Host "Built: $setup"
