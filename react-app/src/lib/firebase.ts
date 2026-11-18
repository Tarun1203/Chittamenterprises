import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

// Same project as the current app (js/firebase-config.js).
const firebaseConfig = {
  apiKey: "AIzaSyCEk9hKMJzA05DdB0axSJ4k76-Jl9acmjc",
  authDomain: "chittam-enterprises.firebaseapp.com",
  projectId: "chittam-enterprises",
  storageBucket: "chittam-enterprises.firebasestorage.app",
  messagingSenderId: "989330036223",
  appId: "1:989330036223:web:6d044a0650d3a231d7c3ca",
};

// A named app keeps this app's offline data and sign-in separate from the
// current app on the same site (that one uses an older Firebase SDK, and
// sharing its offline database could upgrade it under it).
export const app = initializeApp(firebaseConfig, "chittam-next");
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
