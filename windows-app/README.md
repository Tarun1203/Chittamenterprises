# Chittam Enterprises for Windows

The whole Chittam app in its own window, just like the Android app, with
**Tally sync built in**.

- **App window:** orders, service jobs, messages, payments, history and
  everything else, using the Edge engine (WebView2) that comes with Windows 11.
  You stay signed in, it works offline, and it updates automatically whenever
  the website is updated. WhatsApp links open the WhatsApp app / browser as
  usual. Menu: **App** (reload, zoom), **Tally Sync**, **Help**.
- **Tally sync:** every 30 minutes it reads both companies' **Sundry Debtors**
  balances from Tally and saves them to the database, so Payment Updated,
  Payment Reminder and Balance Confirmation fill balances in on every phone.
  It uploads only when balances changed, and each upload shows in History.
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
3. In the app: **Tally Sync → Sync settings…**
   - Enter that **email / password**. The password is stored encrypted for your
     Windows account.
   - Click **Load company names from Tally** and pick **Business**
     (*Chittam Enterprises - 2026*) and **Cash** (*Cash*).
   - Tick **Start with Windows** so the sync starts in the tray after a
     restart.
   - Click **Save**. It syncs straight away.

**Every year:** when you start the new year's company in Tally (e.g. *Chittam
Enterprises - 2027*), pick it under **Business** and click **Save**.

## Files
- `ChittamEnterprises.cs`: the program (C# 5 / .NET Framework 4.x)
- `build.ps1`: builds it with the C# compiler that comes with Windows
- `lib\`: Microsoft WebView2 SDK files (from NuGet `Microsoft.Web.WebView2`
  1.0.4314.35, signed by Microsoft; see `WebView2-LICENSE.txt`)
- Settings and the sync log: `%APPDATA%\ChittamEnterprises\`. The app's
  sign-in and offline data are in `%LOCALAPPDATA%\ChittamEnterprises\WebView2`.
