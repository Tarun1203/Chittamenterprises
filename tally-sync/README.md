# Chittam Tally Sync (Windows app)

A small Windows program for the PC where Tally is open. Every 30 minutes (you
can change this) it reads both companies' **Sundry Debtors** closing balances
from Tally and saves them to the app's database. Payment Updated, Payment
Reminder and Balance Confirmation then fill balances in on every phone, so
there's no daily import.

- **Business company** (e.g. *Chittam Enterprises - 2026*) → business balance
- **Cash company** (*Cash*) → cash balance
- Uploads only when balances changed, and each upload shows in the app's History
- A company not open in Tally is skipped, and its last balances stay
- Runs in the system tray (near the clock). Closing the window keeps it
  syncing; right-click the icon → **Exit** to stop it.

## Setup

1. **Tally:** keep both companies open, with Tally's server on port 9000
   (*F1 Help → Settings → Connectivity → TallyPrime acts as Both / Server*).
2. **A login for this PC:** in the
   [Firebase console → Authentication → Users](https://console.firebase.google.com/project/chittam-enterprises/authentication/users)
   click **Add user**. Use any email (e.g. `tally-sync@chittamenterprises.in`)
   and a strong password.
3. **Open `Chittam Tally Sync.exe`** (in this folder) and fill in:
   - **Email / Password:** the login from step 2. The password is stored
     encrypted for your Windows account.
   - **Business / Cash:** click *Load company names from Tally* and pick
     them.
   - Tick **Start with Windows**.
4. Click **Save**. It syncs straight away; the status lines show the last
   upload, and the app's Settings → *Customer Balances from Tally* shows
   "Synced automatically from Tally".

## Every year
When you start the new year's company in Tally (e.g. *Chittam Enterprises -
2027*), open the program, pick the new company under **Business** and click
**Save**.

## Rebuilding the program
The `.exe` is built on this PC from `ChittamTallySync.cs` (it isn't stored in
git). To rebuild it, run from this folder:
```
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Settings and the log are kept in `%APPDATA%\ChittamTallySync\`.
