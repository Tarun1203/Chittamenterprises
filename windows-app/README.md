# Chittam Enterprises for Windows (2.6)

The Chittam app in its own window, with **Tally sync built in**.

- **App window:** the new app (`/next/`) fills the whole window — no menu
  bar — using the Edge engine (WebView2) that comes with Windows 11. Sharp at
  any display scaling (125%, 150%…): `app.manifest` tells Windows the app
  handles scaling itself, which also fixes the second mouse cursor that showed
  in version 1.0. You stay signed in, it works offline, and it updates itself
  with the website. WhatsApp links open the WhatsApp app / browser. F5
  reloads; Ctrl + / Ctrl − zoom.
- **Tally sync:** every 30 minutes it reads both companies' **Sundry Debtors**
  balances, **stock quantities** (both companies; the app adds them up), **open
  invoices with due dates** (bill-wise outstanding) and, if ticked, the **last 90
  days of transactions** that involve a customer (receipts, sales, credit notes,
  journals). Stock fills in “Available now” on orders; open invoices fill in
  Payment Reminder. Balances fill in on
  Payment Updated, Payment Reminder and Balance Confirmation; transactions feed
  the app's **Tally Match** page (payments vs Tally, possible duplicates).
  Uploads happen only when something changed, and each shows in History.
- **Customers and products:** a new customer ledger in Tally (Sundry Debtors)
  is added to Customers with its mobile; a customer without a mobile gets
  Tally's. New stock items you sell (in stock, or with a selling price; not
  Asset/Dummy groups) are added to Products. Prices follow Tally only where it
  has a selling price (its item rate is the purchase cost). Near-identical
  spellings are not added twice; the log lists them.
- **Posting receipts:** in Tally Match, a payment recorded in the app but not in
  Tally has **Post to Tally** (only inside this app, on the Tally PC). It creates
  a Receipt voucher (customer's Tally ledger, received into the Cash or bank
  ledger you pick, On Account) after a confirmation showing the whole voucher.
- **In the app:** Tally Match shows this PC's sync status with **Sync now**
  and **Sync settings** buttons.
- **Tray:** closing the window keeps the sync running near the clock.
  Double-click the icon to open the app again; right-click → **Exit** to stop.

## Install
Download **ChittamEnterprisesSetup.exe** from
`https://tarun1203.github.io/Chittamenterprises/desktop/ChittamEnterprisesSetup.exe`
and run it. It installs for the current Windows user (no administrator
needed) in `%LOCALAPPDATA%\Programs\Chittam Enterprises`, adds Start menu and
Desktop shortcuts, can start with Windows, and appears in **Settings → Apps**
(Uninstall from there; uninstalling can keep or remove this PC's settings).
`ChittamEnterprisesSetup.exe /S` installs silently.

The program isn't code-signed yet, so Windows may show "Windows protected your
PC" the first time: click **More info → Run anyway**. Signing needs a
code-signing certificate bought in the business's name.

For development: `build.ps1` builds `dist\` (the app and the setup);
`install.ps1` copies `dist\` in place directly.

## Set up Tally sync (once)
1. **Tally:** keep both companies open, with Tally's server on port 9000
   (*F1 Help → Settings → Connectivity → TallyPrime acts as Both / Server*).
2. **A login for this PC:** in the
   [Firebase console → Authentication → Users](https://console.firebase.google.com/project/chittam-enterprises/authentication/users)
   click **Add user**. Use any email (e.g. `tally-sync@chittamenterprises.in`)
   and a strong password.
3. Right-click the tray icon → **Tally Sync settings…** (or Tally Match →
   **Sync settings** in the app)
   - Enter that **email / password**. The password is stored encrypted for your
     Windows account.
   - Click **Load company names from Tally** and pick **Business**
     (*Chittam Enterprises - 2026*) and **Cash** (*Cash*).
   - Tick **Start with Windows** so the sync starts in the tray after a
     restart, and keep **Also send transactions** ticked for Tally Match.
   - Click **Save**. It syncs straight away.

**Every year:** nothing to do. When the new year's company (e.g. *Chittam
Enterprises - 2027*) is open in Tally and has customer balances, the sync moves to
it by itself (shown in History and as a tray notice).

## Updates
The app updates itself: it checks `desktop/version.json` on the site at start-up
and every 6 hours, downloads changed files (SHA-256 checked) and installs them
when it next starts (or tray → **Restart to update**). To release a new version:
```
powershell -ExecutionPolicy Bypass -File .\build.ps1
powershell -ExecutionPolicy Bypass -File .\publish.ps1
```
then commit and push (the `desktop/` folder).

## Files
- `ChittamEnterprises.cs`: the program (C# 5 / .NET Framework 4.x)
- `app.manifest`, `app.config`: display-scaling settings built into / copied next to the program
- `Setup.cs`: the installer / uninstaller (the program files are packed inside it)
- `publish.ps1`: copies a build to `desktop/` for automatic updates and downloads
- `build.ps1`: builds it with the C# compiler that comes with Windows
- `lib\`: Microsoft WebView2 SDK files (from NuGet `Microsoft.Web.WebView2`
  1.0.4314.35, signed by Microsoft; see `WebView2-LICENSE.txt`)
- Settings and the sync log: `%APPDATA%\ChittamEnterprises\`. The app's
  sign-in and offline data are in `%LOCALAPPDATA%\ChittamEnterprises\WebView2`.
