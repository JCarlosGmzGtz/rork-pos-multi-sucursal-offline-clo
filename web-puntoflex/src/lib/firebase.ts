import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  enableIndexedDbPersistence,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";
import {
  getAuth,
  connectAuthEmulator,
  type Auth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let persistenceEnabled = false;

/** Firestore database ID — empty string = default database. */
const firestoreDatabaseId: string = import.meta.env.VITE_FIREBASE_DATABASE_ID ?? "";

async function initFirebase(): Promise<void> {
  if (!isConfigured) return;
  if (app) return;

  app = initializeApp(firebaseConfig);
  const dbName = firestoreDatabaseId || "(default)";
  console.log(`[Firebase] Initializing — project: ${firebaseConfig.projectId}, database: ${dbName}`);
  db = firestoreDatabaseId ? getFirestore(app, firestoreDatabaseId) : getFirestore(app);
  auth = getAuth(app);

  if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_USE_EMULATOR === "true") {
    connectFirestoreEmulator(db, "localhost", 8080);
    connectAuthEmulator(auth, "http://localhost:9099");
  }

  try {
    await enableIndexedDbPersistence(db);
    persistenceEnabled = true;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "failed-precondition") {
      console.warn("Firestore persistence: multiple tabs open, using memory-only cache.");
    } else if (code === "unimplemented") {
      console.warn("Firestore persistence: not supported in this browser.");
    } else {
      console.error("Firestore persistence init error:", err);
    }
  }
}

const firebasePromise = initFirebase();

export {
  firebasePromise,
  isConfigured as isFirebaseEnabled,
  persistenceEnabled,
};

export function getDB(): Firestore | null {
  return db;
}

export function getFB(): FirebaseApp | null {
  return app;
}

export function getFBLAuth(): Auth | null {
  return auth;
}
