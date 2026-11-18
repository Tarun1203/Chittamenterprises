# Tally → Daily Transactions bridge

Tally only listens on the PC it runs on (`http://localhost:9000`), so phones
and other laptops can't talk to it directly. This bridge runs on the Tally
PC, reads the Day Book every 15 minutes, and uploads the vouchers to your
Google Sheet. The app's **Daily Transactions** page then reads them from the
Sheet, from any device, anywhere (e.g. https://tarun1203.github.io/Chittamenterprises/).

```
Tally (localhost:9000) → tally-sync.ps1 → Google Sheet "Transactions" tab → app
```

## One-time setup

1. **Turn on Tally's XML server.** TallyPrime: `F1 Help → Settings → Connectivity
   → Client/Server configuration` → *TallyPrime acts as* **Both**, port **9000**.
   (Tally.ERP 9: `F12 → Advanced Configuration`.) Restart Tally.
2. **Update the Apps Script.** Paste the new `google-apps-script/Code.gs` into your
   Sheet's Apps Script, add the `ACCESS_KEY` script property (steps 7–8 at the top
   of `Code.gs`), and deploy a **New version**. The `/exec` URL does not change.
3. **Configure the bridge.** Copy `tally-sync.config.example.json` to
   `tally-sync.config.json` and fill in:
   - `company` — the exact company names as shown in Tally's company list
     (one name, a list, or `""` for whichever company is open). Each company must
     be loaded in Tally when the sync runs; one that isn't is skipped and its rows
     in the Sheet are left alone.
   - `sheetUrl` — your Apps Script `/exec` URL.
   - `accessKey` — the same `ACCESS_KEY`.
   - `daysBack` — also re-send this many earlier days on every run (default 1, so
     late edits to yesterday's vouchers are picked up).
4. **Test it** (reads Tally, uploads nothing):
   ```
   powershell -ExecutionPolicy Bypass -File .\tally-sync.ps1 -DryRun
   ```
   Then run without `-DryRun` once and check the **Transactions** tab in the Sheet.
5. **Schedule it** every 15 minutes:
   ```
   powershell -ExecutionPolicy Bypass -File .\install-task.ps1
   ```
6. **In the app** (on every device): Settings → Cloud Sync → paste the Web App URL
   and the Access Key. Open **Daily Transactions**.

## Other commands

- One day: `.\tally-sync.ps1 -Date 2026-11-17`
- Backfill: `.\tally-sync.ps1 -Days 30`
- Log: `tally-sync.log` in this folder.
- Remove the schedule: `schtasks /Delete /TN "Chittam Tally Sync" /F`

`tally-sync.config.json` holds your access key and is git-ignored — don't commit it.
