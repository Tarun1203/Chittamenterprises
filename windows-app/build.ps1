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
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
  /r:System.Xml.dll /r:System.Security.dll /r:System.Web.Extensions.dll `
  "/r:$(Join-Path $lib 'Microsoft.Web.WebView2.Core.dll')" `
  "/r:$(Join-Path $lib 'Microsoft.Web.WebView2.WinForms.dll')" `
  (Join-Path $PSScriptRoot 'ChittamEnterprises.cs')
if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }

foreach ($f in 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll') {
  Copy-Item (Join-Path $lib $f) $dist -Force
}
Write-Host "Built: $out"
