// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, collection, onSnapshot, query, orderBy, deleteDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBt9G1cE4iB9fRBeWfw9HjXYGUOsjLGClI",
  authDomain: "nexus-erp-86bf6.firebaseapp.com",
  projectId: "nexus-erp-86bf6",
  storageBucket: "nexus-erp-86bf6.firebasestorage.app",
  messagingSenderId: "61036292897",
  appId: "1:61036292897:web:1a92796e0892fb2c23ac60"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export const provider = new GoogleAuthProvider();

// Helpers de datos
export const userDoc = (uid) => doc(db, "users", uid);
export const payrollCol = (uid) => collection(db, "users", uid, "payroll");
export const ledgerCol  = (uid) => collection(db, "users", uid, "ledger");
export const settingsDoc = (uid) => doc(db, "users", uid, "meta", "settings");

// Exponer funciones Auth para uso en app.js
export const signInGoogle = () => signInWithPopup(auth, provider);
export const watchAuth = (cb) => onAuthStateChanged(auth, cb);
export const logOut = () => signOut(auth);

// Firestore helpers
export {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, uploadBytes, ref, getDownloadURL
};
