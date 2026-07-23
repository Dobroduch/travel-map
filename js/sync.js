const FIREBASE_SDK_VERSION = "10.14.1";
const APP_SDK_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`;
const FIRESTORE_SDK_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`;
const CONFIG_KEY = "travel-map-sync-config-v1";
const COLLECTION = "travelMapSync";

let firestoreApi = null;
let unsubscribe = null;

export function getSyncConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearSyncConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

/**
 * Loads the Firebase SDK from Google's CDN (only when sync is actually used,
 * so the app stays fully offline-capable otherwise) and opens a handle on the
 * one Firestore document this device's sync code points to.
 */
export async function connect({ firebaseConfig, syncCode }) {
  const [{ initializeApp }, firestoreMod] = await Promise.all([import(APP_SDK_URL), import(FIRESTORE_SDK_URL)]);
  const { getFirestore, doc, getDoc, setDoc, onSnapshot } = firestoreMod;
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const ref = doc(db, COLLECTION, syncCode);
  firestoreApi = { getDoc, setDoc, onSnapshot, ref };
  return firestoreApi;
}

export async function pullRemote() {
  if (!firestoreApi) throw new Error("Sync not connected");
  const snap = await firestoreApi.getDoc(firestoreApi.ref);
  return snap.exists() ? snap.data() : null;
}

export async function pushRemote(data) {
  if (!firestoreApi) throw new Error("Sync not connected");
  const payload = { ...data, updatedAt: Date.now() };
  await firestoreApi.setDoc(firestoreApi.ref, payload);
  return payload.updatedAt;
}

/** Live-updates from whatever the OTHER device most recently pushed, while this one is open. */
export function watchRemote(callback) {
  if (!firestoreApi) return () => {};
  if (unsubscribe) unsubscribe();
  unsubscribe = firestoreApi.onSnapshot(
    firestoreApi.ref,
    (snap) => {
      if (snap.exists()) callback(snap.data());
    },
    () => {
      // permission errors / connectivity drops surface here; the caller already
      // has its own copy of the data, so there's nothing to do but stay silent
    }
  );
  return unsubscribe;
}

export function disconnect() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  firestoreApi = null;
  clearSyncConfig();
}
