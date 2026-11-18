<#
  Builds "Chittam Tally Sync.exe" with the C# compiler that ships with
  Windows (.NET Framework 4.x) - nothing to install. Run from this folder:

    powershell -ExecutionPolicy Bypass -File .\build.ps1
#>
$ErrorActionPreference = 'Stop'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'The .NET Framework 4 C# compiler was not found on this PC.' }

$out = Join-Path $PSScriptRoot 'Chittam Tally Sync.exe'
& $csc /nologo /target:winexe /optimize+ /codepage:65001 "/out:$out" `
  "/win32icon:$(Join-Path $PSScriptRoot 'app.ico')" `
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
  /r:System.Xml.dll /r:System.Security.dll /r:System.Web.Extensions.dll `
  (Join-Path $PSScriptRoot 'ChittamTallySync.cs')
if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }
Write-Host "Built: $out"
