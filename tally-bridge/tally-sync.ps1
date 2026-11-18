<#
  Chittam Tally Bridge - sends each day's Tally vouchers to the Google Sheet
  so the Daily Transactions page works from any phone or laptop.

  Runs on the PC where Tally (TallyPrime or Tally.ERP 9) is open. It asks
  Tally's built-in XML server (http://localhost:9000) for the Day Book, then
  uploads the vouchers to the same Apps Script URL the app uses for Cloud
  Sync. Re-running it for the same day replaces that day's rows, so it is
  safe to schedule every 15 minutes (see install-task.ps1).

  Usage:
    .\tally-sync.ps1                    # today + the days set in daysBack
    .\tally-sync.ps1 -Date 2026-11-17   # one specific day
    .\tally-sync.ps1 -Days 30           # backfill the last 30 days
    .\tally-sync.ps1 -DryRun            # read Tally, print, upload nothing
#>
param(
  [string]$Date,
  [int]$Days = -1,
  [switch]$DryRun,
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'tally-sync.config.json'),
  [string]$SampleXml   # read vouchers from a saved Tally XML file instead of Tally (for testing)
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$LogPath = Join-Path $PSScriptRoot 'tally-sync.log'

function Write-Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  if ((Test-Path $LogPath) -and (Get-Item $LogPath).Length -gt 1MB) { Remove-Item $LogPath }
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Get-Text($node, [string]$xpath) {
  $n = $node.SelectSingleNode($xpath)
  if ($n) { return $n.InnerText.Trim() } else { return '' }
}

function Get-Number([string]$s) {
  # Tally amounts look like "-1250.00" or "1,250.00"; quantities like " 2 Nos"
  $m = [regex]::Match(($s -replace ',', ''), '-?\d+(\.\d+)?')
  if ($m.Success) { return [double]$m.Value } else { return 0 }
}

# ---------------- config ----------------
if (-not (Test-Path $ConfigPath)) {
  throw "Config not found: $ConfigPath - copy tally-sync.config.example.json to tally-sync.config.json and fill it in."
}
$cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$tallyUrl = if ($cfg.tallyUrl) { $cfg.tallyUrl } else { 'http://localhost:9000' }
if (-not $DryRun -and (-not $cfg.sheetUrl -or -not $cfg.accessKey)) {
  throw 'sheetUrl and accessKey must be set in tally-sync.config.json'
}

$dates = @()
if ($Date) {
  $dates = @([datetime]::ParseExact($Date, 'yyyy-MM-dd', $null))
} else {
  $back = if ($Days -ge 0) { $Days } elseif ($cfg.daysBack -ne $null) { [int]$cfg.daysBack } else { 1 }
  for ($i = $back; $i -ge 0; $i--) { $dates += (Get-Date).Date.AddDays(-$i) }
}

# ---------------- ask Tally for the Day Book ----------------
function Get-DayBookXml([datetime]$from, [datetime]$to, [string]$companyName) {
  $company = ''
  if ($companyName) { $company = '<SVCURRENTCOMPANY>' + [Security.SecurityElement]::Escape($companyName) + '</SVCURRENTCOMPANY>' }
  $req = @"
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>Day Book</REPORTNAME>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT>
      <SVFROMDATE TYPE="Date">$($from.ToString('yyyyMMdd'))</SVFROMDATE>
      <SVTODATE TYPE="Date">$($to.ToString('yyyyMMdd'))</SVTODATE>
      $company
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>
"@
  $wc = New-Object System.Net.WebClient
  $wc.Headers['Content-Type'] = 'text/xml; charset=utf-8'
  try {
    $bytes = $wc.UploadData($tallyUrl, 'POST', [Text.Encoding]::UTF8.GetBytes($req))
  } catch {
    throw "Could not reach Tally at $tallyUrl. Is Tally open with a company loaded, and is F1 Help > Settings > Connectivity > 'TallyPrime acts as' set to Server (or Both) on port 9000? ($($_.Exception.Message))"
  }
  return Convert-TallyBytes $bytes
}

function Convert-TallyBytes([byte[]]$bytes) {
  # Tally answers in UTF-8 or UTF-16 depending on version/settings
  if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or $bytes[1] -eq 0)) {
    $text = [Text.Encoding]::Unicode.GetString($bytes)
  } else {
    $text = [Text.Encoding]::UTF8.GetString($bytes)
  }
  $text = $text.TrimStart([char]0xFEFF)
  # Tally sometimes emits control characters that are illegal in XML
  $text = [regex]::Replace($text, '&#(x0*[0-8bBcCeEfF]|x0*1[0-9a-fA-F]|0*[0-8]|0*1[1-2]|0*1[4-9]|0*2[0-9]|0*3[01]);', '')
  $text = [regex]::Replace($text, '[\x00-\x08\x0B\x0C\x0E-\x1F]', '')
  return $text
}

# ---------------- turn vouchers into plain rows ----------------
function Convert-Vouchers([string]$xmlText, [string]$companyName) {
  $doc = New-Object System.Xml.XmlDocument
  $doc.LoadXml($xmlText)
  $list = New-Object System.Collections.ArrayList
  foreach ($v in $doc.SelectNodes('//VOUCHER')) {
    if ((Get-Text $v 'ISCANCELLED') -eq 'Yes' -or (Get-Text $v 'ISOPTIONAL') -eq 'Yes' -or (Get-Text $v 'ISDELETED') -eq 'Yes') { continue }

    $rawDate = Get-Text $v 'DATE'
    if ($rawDate -notmatch '^\d{8}$') { continue }
    $iso = '{0}-{1}-{2}' -f $rawDate.Substring(0, 4), $rawDate.Substring(4, 2), $rawDate.Substring(6, 2)

    $vtype = Get-Text $v 'VOUCHERTYPENAME'
    if (-not $vtype) { $vtype = $v.GetAttribute('VCHTYPE') }
    $party = Get-Text $v 'PARTYLEDGERNAME'
    if (-not $party) { $party = Get-Text $v 'PARTYNAME' }

    # voucher value: the party's ledger line if there is one, otherwise half
    # the sum of all ledger lines (a balanced voucher's debit side)
    $amount = 0; $sumAbs = 0
    foreach ($le in $v.SelectNodes('ALLLEDGERENTRIES.LIST|LEDGERENTRIES.LIST')) {
      $a = Get-Number (Get-Text $le 'AMOUNT')
      $sumAbs += [math]::Abs($a)
      if ($party -and (Get-Text $le 'LEDGERNAME') -eq $party) { $amount = [math]::Abs($a) }
    }
    if ($amount -eq 0) { $amount = $sumAbs / 2 }

    $items = New-Object System.Collections.ArrayList
    $invTotal = 0
    foreach ($ie in $v.SelectNodes('ALLINVENTORYENTRIES.LIST|INVENTORYENTRIES.LIST|INVENTORYENTRIESIN.LIST|INVENTORYENTRIESOUT.LIST')) {
      $name = Get-Text $ie 'STOCKITEMNAME'
      if (-not $name) { continue }
      $qty = Get-Text $ie 'BILLEDQTY'
      if (-not $qty) { $qty = Get-Text $ie 'ACTUALQTY' }
      $ia = [math]::Abs((Get-Number (Get-Text $ie 'AMOUNT')))
      $invTotal += $ia
      [void]$items.Add(@{ name = $name; qty = $qty; rate = (Get-Text $ie 'RATE'); amount = $ia })
    }
    if ($amount -eq 0) { $amount = $invTotal }

    [void]$list.Add(@{
      company     = $companyName
      date        = $iso
      voucherType = $vtype
      voucherNo   = (Get-Text $v 'VOUCHERNUMBER')
      party       = $party
      amount      = [math]::Round($amount, 2)
      narration   = (Get-Text $v 'NARRATION')
      items       = $items
      guid        = (Get-Text $v 'GUID')
    })
  }
  return $list
}

# ---------------- run ----------------
try {
  $from = ($dates | Measure-Object -Minimum).Minimum
  $to = ($dates | Measure-Object -Maximum).Maximum
  $isoDates = @($dates | ForEach-Object { $_.ToString('yyyy-MM-dd') })

  # "company" may be one name, a list, or empty (= whichever company is open in Tally)
  $companies = @($cfg.company | Where-Object { $_ })
  if ($companies.Count -eq 0) { $companies = @('') }

  $txs = New-Object System.Collections.ArrayList
  $synced = @()
  foreach ($co in $companies) {
    try {
      if ($SampleXml) {
        $xml = Convert-TallyBytes ([IO.File]::ReadAllBytes((Resolve-Path $SampleXml)))
      } else {
        $xml = Get-DayBookXml $from $to $co
      }
      if ($xml -match '<LINEERROR>(.*?)</LINEERROR>') { throw ("Tally returned an error: " + [Net.WebUtility]::HtmlDecode($Matches[1])) }
      $name = $co
      if (-not $name -and $xml -match '<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>') { $name = $Matches[1].Trim() }
      # keep only vouchers inside the requested days (Day Book can spill over)
      $found = @(Convert-Vouchers $xml $name | Where-Object { $isoDates -contains $_.date })
      foreach ($t in $found) { [void]$txs.Add($t) }
      $synced += $name
      Write-Log ("[{0}] read {1} voucher(s) for {2} to {3}" -f $name, $found.Count, $isoDates[0], $isoDates[-1])
    } catch {
      # one company failing (e.g. not loaded in Tally) must not wipe its rows in the Sheet
      Write-Log ("[{0}] skipped: {1}" -f $co, $_.Exception.Message)
    }
  }
  if ($synced.Count -eq 0) { throw 'No company could be read from Tally.' }

  if ($DryRun) {
    $txs | ForEach-Object { '{0}  {1,-10} {2,-14} {3,-12} {4,-35} {5,12:N2}' -f $_.date, $_.company, $_.voucherType, $_.voucherNo, $_.party, $_.amount } | Write-Host
    Write-Log 'Dry run - nothing uploaded.'
    exit 0
  }

  $payload = @{
    action       = 'tallyTransactions'
    key          = $cfg.accessKey
    companies    = $synced
    dates        = $isoDates
    transactions = $txs
  } | ConvertTo-Json -Depth 8 -Compress

  $res = Invoke-RestMethod -Uri $cfg.sheetUrl -Method Post -ContentType 'text/plain; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 120
  if ($res.ok) { Write-Log ("Uploaded {0} voucher(s) to the Sheet." -f $res.written) }
  else { throw "Sheet rejected the upload: $($res.error)" }
} catch {
  Write-Log ("ERROR: " + $_.Exception.Message)
  exit 1
}
