// firebase.js (v9 modular) – Inicialización + utilidades
// Pega tu configuración en firebaseConfig:
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, addDoc, deleteDoc, onSnapshot, serverTimestamp,
  query, where, orderBy, enableIndexedDbPersistence, writeBatch
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  getStorage, ref as sref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

export const firebaseConfig = {
  // ==== RELLENA ESTO ====
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence);
export const db = getFirestore(app);
export const storage = getStorage(app);

try {
  await enableIndexedDbPersistence(db);
  console.log("[Firestore] Persistencia offline habilitada");
} catch (e) {
  console.warn("[Firestore] Persistencia no disponible, se usará cola local:", e);
}

export const providers = {
  google: new GoogleAuthProvider()
};

// Helpers de datos
export const colUsers = (uid) => ({
  settings: doc(db, "users", uid),
  payroll: collection(db, "users", uid, "payroll"),
  ledger: collection(db, "users", uid, "ledger")
});

export async function googleLogin(){
  const result = await signInWithPopup(auth, providers.google);
  return result.user;
}
export async function logout(){ return await signOut(auth); }
export function onAuth(cb){ return onAuthStateChanged(auth, cb); }

// Storage
export async function uploadCompanyLogo(uid, file){
  const r = sref(storage, `users/${uid}/company-logo.png`);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);
  return url;
}

// Cola local (fallback si no hay conexión) – simple en localStorage
const LS_QUEUE_KEY = "offline-queue-v1";
export function enqueue(action){ // {type:'add'|'delete', path:string[], data?:object}
  const q = JSON.parse(localStorage.getItem(LS_QUEUE_KEY) || "[]");
  q.push({ ...action, ts: Date.now() });
  localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(q));
}
export async function flushQueue(){
  const q = JSON.parse(localStorage.getItem(LS_QUEUE_KEY) || "[]");
  if(!q.length) return;
  const batch = writeBatch(db);
  for(const item of q){
    const [collectionPath, ...rest] = item.path;
    if(item.type === "add"){
      // path like ["users", uid, "payroll"] with provided id
      const d = doc(db, item.path.join("/"));
      batch.set(d, item.data, { merge: true });
    }else if(item.type === "delete"){
      const d = doc(db, item.path.join("/"));
      batch.delete(d);
    }
  }
  await batch.commit();
  localStorage.removeItem(LS_QUEUE_KEY);
  console.log("[Queue] Sincronizada");
}

export {
  setDoc, getDoc, addDoc, deleteDoc, onSnapshot, serverTimestamp,
  query, where, orderBy, doc, collection
};
