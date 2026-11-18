# Firebase database setup (one time, ~10 minutes)

Once this is done, every customer, product and settings change is saved to
Firebase and appears on every signed-in phone and laptop within seconds.
Every generated message and every change is kept in **History**. Nothing can
be deleted, by the app or by the database rules.

The free Spark plan is enough (1 GB storage, 50,000 reads and 20,000 writes per day).

## 1. Create the project
1. Go to https://console.firebase.google.com → **Add project** → name it
   (e.g. `chittam-enterprises`). Google Analytics is not needed.
2. **Build → Firestore Database → Create database** → choose the location
   `asia-south1 (Mumbai)` → start in **production mode**.
3. **Rules** tab → replace everything with the contents of
   [`firestore.rules`](firestore.rules) → **Publish**.

## 2. Turn on sign-in and add users
1. **Build → Authentication → Get started → Email/Password** → Enable → Save.
2. **Users** tab → **Add user** for yourself and anyone else who should
   use the app (email + password).
3. **Settings** tab → **User actions** → untick **Enable create (sign-up)**,
   so only the users you add can get in.
4. **Settings** tab → **Authorized domains** → add `tarun1203.github.io`.

## 3. Connect the app
1. **Project settings** (gear icon) → **General** → **Your apps** → click
   the **</>** (Web) icon → register the app (no hosting needed).
2. Copy the `firebaseConfig = { ... }` values into
   [`js/firebase-config.js`](js/firebase-config.js), replacing `null`:
   ```js
   var FIREBASE_CONFIG = {
     apiKey: "…",
     authDomain: "….firebaseapp.com",
     projectId: "…",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "…"
   };
   ```
   These values are not secret, so the file can be committed.
3. Commit and push. Open https://tarun1203.github.io/Chittamenterprises/ and sign in.

## 4. Bring in your existing data
Open the app on the device that has your customers and products and sign in.
Anything on that device that isn't in the database yet (matched by name) is
uploaded automatically the first time. You can repeat that later from
**Settings → Database → Upload this device's data**.

## Good to know
- Works offline: changes are saved on the device and upload when the
  connection returns.
- **Customers / Products** can be added and edited, not deleted. Rename a
  duplicate (e.g. add the town) to tell it apart.
- **History** shows who generated which message and who changed what, with
  the old and new values.
- Product photos in the Catalog stay on each device. They are not stored in
  the database.
