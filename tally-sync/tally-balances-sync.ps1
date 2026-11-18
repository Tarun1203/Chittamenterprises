<#
  Chittam Tally balance sync - runs on the PC where Tally is open.

  Reads each company's Sundry Debtors closing balances from Tally's built-in
  server (http://localhost:9000) and saves them to the app's Firebase
  database, so Payment Updated / Payment Reminder / Balance Confirmation
  fill balances in on every phone without a manual import.

  - business company -> the business balance, cash company -> the cash balance
  - uploads only when the balances changed since the last run
  - a company that is not open in Tally is skipped (its saved balances stay)
  - every upload is written to the app's activity log (History)

  Usage:
    .\tally-balances-sync.ps1            # sync now
    .\tally-balances-sync.ps1 -DryRun    # read Tally and show totals, upload nothing
    .\tally-balances-sync.ps1 -Force     # upload even if nothing changed
#>
param(
  [switch]$DryRun,
  [switch]$Force,
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'tally-sync.config.json')
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$LogPath = Join-Path $PSScriptRoot 'tally-sync.log'
$StatePath = Join-Path $PSScriptRoot 'tally-sync.state.json'

function Write-Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  if ((Test-Path $LogPath) -and (Get-Item $LogPath).Length -gt 1MB) { Remove-Item $LogPath }
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

# same rule as the app's normalizeName(): trim, lower case, single spaces
function Normalize([string]$s) { return (($s.Trim().ToLowerInvariant()) -replace '\s+', ' ') }

function To-Number([string]$s) {
  if (-not $s) { return 0.0 }
  $m = [regex]::Match(($s -replace ',', ''), '-?\d+(\.\d+)?')
  if ($m.Success) { return [double]$m.Value } else { return 0.0 }
}

# ---------------- config ----------------
if (-not (Test-Path $ConfigPath)) {
  throw "Config not found: $ConfigPath - copy tally-sync.config.example.json to tally-sync.config.json and fill it in."
}
$cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$tallyUrl = if ($cfg.tallyUrl) { $cfg.tallyUrl } else { 'http://localhost:9000' }

# ---------------- Tally ----------------
function Get-TallyBalances([string]$company) {
  $co = [Security.SecurityElement]::Escape($company)
  $req = "<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC>" +
         "<REPORTNAME>Group Summary</REPORTNAME><STATICVARIABLES>" +
         "<SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>$co</SVCURRENTCOMPANY>" +
         "<GROUPNAME>Sundry Debtors</GROUPNAME><EXPLODEFLAG>Yes</EXPLODEFLAG>" +
         "</STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>"
  $wc = New-Object System.Net.WebClient
  $wc.Headers['Content-Type'] = 'text/xml; charset=utf-8'
  try {
    $bytes = $wc.UploadData($tallyUrl, 'POST', [Text.Encoding]::UTF8.GetBytes($req))
  } catch {
    throw "Tally is not reachable at $tallyUrl (is Tally open?)"
  }
  if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or $bytes[1] -eq 0)) {
    $text = [Text.Encoding]::Unicode.GetString($bytes)
  } else {
    $text = [Text.Encoding]::UTF8.GetString($bytes)
  }
  $text = $text.TrimStart([char]0xFEFF)
  $text = [regex]::Replace($text, '&#(0*[0-8]|0*1[1-2]|0*1[4-9]|0*2[0-9]|0*3[01]);', '')
  $text = [regex]::Replace($text, '[\x00-\x08\x0B\x0C\x0E-\x1F]', '')
  if ($text -match '<LINEERROR>(.*?)</LINEERROR>') {
    throw ("Tally: " + [Net.WebUtility]::HtmlDecode($Matches[1]) + " (open this company in Tally)")
  }

  $doc = New-Object System.Xml.XmlDocument
  $doc.LoadXml($text)
  $balances = @{}; $names = @{}
  foreach ($n in $doc.SelectNodes('//DSPACCNAME')) {
    $info = $n.NextSibling
    while ($info -and $info.Name -ne 'DSPACCINFO' -and $info.Name -ne 'DSPACCNAME') { $info = $info.NextSibling }
    if (-not $info -or $info.Name -ne 'DSPACCINFO') { continue }
    $name = $n.SelectSingleNode('DSPDISPNAME').InnerText.Trim()
    if (-not $name) { continue }
    $dr = To-Number ($info.SelectSingleNode('DSPCLDRAMT/DSPCLDRAMTA').InnerText)
    $cr = To-Number ($info.SelectSingleNode('DSPCLCRAMT/DSPCLCRAMTA').InnerText)
    # Tally shows debit as negative: receivable = -(debit) - credit
    $k = Normalize $name
    $balances[$k] = [math]::Round((-$dr - $cr), 2)
    $names[$k] = $name
  }
  return @{ balances = $balances; names = $names }
}

# ---------------- Firebase (REST) ----------------
function Get-IdToken {
  $body = @{ email = $cfg.email; password = $cfg.password; returnSecureToken = $true } | ConvertTo-Json
  $r = Invoke-RestMethod -Method Post -ContentType 'application/json' -Body $body `
    -Uri ("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + $cfg.apiKey)
  return $r.idToken
}

function FsString([string]$s) { return @{ stringValue = $s } }
function FsMapOfNumbers($h) {
  $f = @{}
  foreach ($k in $h.Keys) { $f[$k] = @{ doubleValue = [double]$h[$k] } }
  return @{ mapValue = @{ fields = $f } }
}
function FsMapOfStrings($h) {
  $f = @{}
  foreach ($k in $h.Keys) { $f[$k] = @{ stringValue = [string]$h[$k] } }
  return @{ mapValue = @{ fields = $f } }
}

function Save-Doc([string]$token, [string]$path, $fields, [string]$method) {
  $base = "https://firestore.googleapis.com/v1/projects/$($cfg.projectId)/databases/(default)/documents/"
  $json = @{ fields = $fields } | ConvertTo-Json -Depth 20 -Compress
  Invoke-RestMethod -Method $method -Uri ($base + $path) -ContentType 'application/json; charset=utf-8' `
    -Headers @{ Authorization = "Bearer $token" } -Body ([Text.Encoding]::UTF8.GetBytes($json)) | Out-Null
}

# ---------------- run ----------------
try {
  $state = @{}
  if (Test-Path $StatePath) {
    $o = Get-Content $StatePath -Raw | ConvertFrom-Json
    foreach ($p in $o.PSObject.Properties) { $state[$p.Name] = $p.Value }
  }
  $companies = [ordered]@{ business = $cfg.businessCompany; cash = $cfg.cashCompany }
  $labels = @{ business = $cfg.businessLabel; cash = $cfg.cashLabel }
  $token = $null

  foreach ($key in $companies.Keys) {
    $company = $companies[$key]
    if (-not $company) { continue }
    try {
      $data = Get-TallyBalances $company
    } catch {
      Write-Log ("[{0}] skipped: {1}" -f $company, $_.Exception.Message)
      continue
    }
    $count = $data.balances.Count
    $total = 0.0; foreach ($v in $data.balances.Values) { $total += $v }
    # fingerprint of the balances, to upload only when something changed
    $sig = ($data.balances.Keys | Sort-Object | ForEach-Object { $_ + '=' + $data.balances[$_] }) -join '|'
    $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($sig))) -replace '-', ''

    if ($DryRun) { Write-Log ("[{0}] read {1} names (dry run, nothing uploaded)" -f $company, $count); continue }
    if (-not $Force -and $state[$key] -eq $sha) { Write-Log ("[{0}] no change since last sync" -f $company); continue }

    if (-not $token) { $token = Get-IdToken }
    $now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $fields = @{
      company    = FsString $key
      label      = FsString $labels[$key]
      file       = FsString ('Auto from Tally: ' + $company)
      importedAt = FsString $now
      importedBy = FsString $cfg.email
      matched    = @{ integerValue = [string]$count }
      unmatched  = @{ arrayValue = @{ values = @() } }
      balances   = FsMapOfNumbers $data.balances
      names      = FsMapOfStrings $data.names
      at         = @{ timestampValue = $now }
      by         = FsString $cfg.email
    }
    Save-Doc $token ("balances/" + $key) $fields 'Patch'

    # one line in the app's History for each upload
    $log = @{
      collection = FsString 'app'
      action     = FsString 'balances-synced'
      name       = FsString $labels[$key]
      details    = @{ mapValue = @{ fields = @{
        name    = FsString $labels[$key]
        company = FsString $company
        names   = @{ integerValue = [string]$count }
      } } }
      at         = @{ timestampValue = $now }
      by         = FsString $cfg.email
    }
    Save-Doc $token 'activity' $log 'Post'

    $state[$key] = $sha
    Write-Log ("[{0}] uploaded {1} balances" -f $company, $count)
  }

  if (-not $DryRun) { $state | ConvertTo-Json | Set-Content -Path $StatePath -Encoding UTF8 }
} catch {
  Write-Log ("ERROR: " + $_.Exception.Message)
  exit 1
}
