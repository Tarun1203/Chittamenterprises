# Chittam Enterprises for Windows (2.3)

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
- **In the app:** Tally Match shows this PC's sync status with **Sync now**
  and **Sync settings** buttons.
- **Tray:** closing the window keeps the sync running near the clock.
  Double-click the icon to open the app again; right-click → **Exit** to stop.

## Install
```
powershell -ExecutionPolicy Bypass -File .\build.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1
```
This puts the app in `%LOCALAPPDATA%\Programs\Chittam Enterprises` with Start
menu and Desktop shortcuts. (`dist\Chittam Enterprises.exe` also runs straight
from the build folder.)

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

**Every year:** when you start the new year's company in Tally (e.g. *Chittam
Enterprises - 2027*), pick it under **Business** and click **Save**.

## Files
- `ChittamEnterprises.cs`: the program (C# 5 / .NET Framework 4.x)
- `app.manifest`, `app.config`: display-scaling settings built into / copied next to the program
- `build.ps1`: builds it with the C# compiler that comes with Windows
- `lib\`: Microsoft WebView2 SDK files (from NuGet `Microsoft.Web.WebView2`
  1.0.4314.35, signed by Microsoft; see `WebView2-LICENSE.txt`)
- Settings and the sync log: `%APPDATA%\ChittamEnterprises\`. The app's
  sign-in and offline data are in `%LOCALAPPDATA%\ChittamEnterprises\WebView2`.
