# Tally → app balance sync

Runs on the PC where Tally is open. Every 30 minutes it reads both companies'
**Sundry Debtors** closing balances from Tally and saves them to the app's
database. Payment Updated, Payment Reminder and Balance Confirmation then fill
balances in on every phone, so there's no manual import.

- **Business company** (Chittam Enterprises) → business balance
- **Cash company** (Cash Bill) → cash balance
- Uploads only when balances changed; each upload shows in the app's History
- A company not open in Tally is skipped, and its last balances stay

## One-time setup

1. **Tally:** both companies must be open (loaded) when the PC is on, with
   Tally's server on port 9000 (*F1 Help → Settings → Connectivity → Client/Server
   configuration → TallyPrime acts as Both / Server*).
2. **Login for the helper:** in the [Firebase console → Authentication → Users](https://console.firebase.google.com/project/chittam-enterprises/authentication/users)
   click **Add user**. Use any email, e.g. `tally-sync@chittamenterprises.in`, and
   a strong password.
3. **Settings file:** copy `tally-sync.config.example.json` to
   `tally-sync.config.json` and fill in that **email** and **password**. Check
   the two company names match Tally exactly (*Chittam Enterprises - 2026*,
   *Cash*). This file is git-ignored, so it is never uploaded.
4. **Test:** in this folder run
   ```
   powershell -ExecutionPolicy Bypass -File .\tally-balances-sync.ps1 -DryRun
   ```
   then without `-DryRun` once, and open the app → Settings → Customer
   Balances from Tally to see the new time.
5. **Schedule it:**
   ```
   powershell -ExecutionPolicy Bypass -File .\install-task.ps1
   ```

## Every year
When you start the new financial year company in Tally (e.g. *Chittam
Enterprises - 2027*), change `businessCompany` in `tally-sync.config.json`.

Log: `tally-sync.log` in this folder.
