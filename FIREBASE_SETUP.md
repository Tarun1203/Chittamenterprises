# Firebase database setup

The app uses the Firebase project **chittam-enterprises**:
**Authentication** (Email/Password) for sign-in and **Cloud Firestore** for data.
Every customer, product and settings change is saved there and appears on
every signed-in phone and laptop within seconds. Every generated message and
every change is kept in **History**. Nothing can be deleted, by the app or by the
database rules.

The free Spark plan is enough (1 GB storage, 50,000 reads and 20,000 writes per day).

## Already done
- Web app **Chittam Enterprises Web** registered; its config is in
  [`js/firebase-config.js`](js/firebase-config.js).
- Firestore database `(default)` created in `asia-south1` (Mumbai).
- [`firestore.rules`](firestore.rules) deployed: signed-in users only, no deletes,
  and history entries can only be added.
- Email/Password sign-in enabled ([`firebase.json`](firebase.json)).

## Left to do in the Firebase console (2 minutes)
Open https://console.firebase.google.com/project/chittam-enterprises/authentication
1. **Users** tab → **Add user** for yourself and anyone else who should use the
   app (email + password).
2. **Settings** tab → **User actions** → untick **Enable create (sign-up)**,
   so only the users you add can get in.
3. **Settings** tab → **Authorized domains** → **Add domain** → `tarun1203.github.io`.

Then open https://tarun1203.github.io/Chittamenterprises/ and sign in.

## Bring in your existing data
Open the app on the device that has your customers and products and sign in.
Anything on that device that isn't in the database yet (matched by name) is
uploaded automatically the first time. You can repeat that later from
**Settings → Database → Upload this device's data**.

## Changing rules later
Edit `firestore.rules`, then from this folder run:
```
firebase deploy --only firestore:rules --account tarunchettam@gmail.com
```

## Good to know
- Works offline: changes are saved on the device and upload when the
  connection returns.
- **Customers / Products** can be added and edited, not deleted. Rename a
  duplicate (e.g. add the town) to tell it apart.
- **History** shows who generated which message and who changed what, with
  the old and new values.
- Product photos in the Catalog stay on each device. They are not stored in
  the database.
