# Chittam Enterprises — new app (React + Aceternity UI)

The rebuild of the Chittam tool in React, Vite, Tailwind CSS 4 and Motion, with
[Aceternity UI](https://ui.aceternity.com) components and 3D icons from
[3dicons.co](https://3dicons.co) (CC0). It's published next to the current app at
**https://tarun1203.github.io/Chittamenterprises/next/** and uses the same
Firebase data, so both apps can be used side by side until this one replaces
the old one.

## Rules kept from the current app
- Nothing is ever deleted (`src/lib/data.ts` has no delete; Firestore rules refuse it).
- Every add or edit writes an entry to the activity log (History).
- Same collections and fields as the current app.
- Its own Firebase app name (`chittam-next`), so its offline data never touches
  the current app's. Sign in once on /next/.

## Milestones
1. Foundation: shell, sign-in, data layer, Dashboard, Customers, Products, Transports (done)
2. Messages: Payment Updated + payments report, Reminder, Balance Confirmation,
   Dispatch, Stock Update, Stock Return, Service Material, Tally balance fill-in (done)
3. Orders (with pick lists) and Service Jobs (done)
4. History, Settings, Catalog
5. Offline/installable app, version updates, switch-over

## Develop
```
npm install
npm run dev        # http://localhost:5173/Chittamenterprises/next/
                   # add ?demo to the address to see sample data without signing in
npm run build      # writes the published files to ../next
```
