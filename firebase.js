// Inserta aquí tu firebaseConfig (README explica cómo obtenerlo)
const firebaseConfig = {
 apiKey: "AIzaSyBt9G1cE4iB9fRBeWfw9HjXYGUOsjLGClI",
  authDomain: "nexus-erp-86bf6.firebaseapp.com",
  projectId: "nexus-erp-86bf6",
  storageBucket: "nexus-erp-86bf6.firebasestorage.app",
  messagingSenderId: "61036292897",
  appId: "1:61036292897:web:1a92796e0892fb2c23ac60"
};


firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Habilitar persistencia offline de Firestore (si es viable)
db.enablePersistence({ synchronizeTabs: true }).catch(() => {
  console.log("Persistencia offline no disponible (modo incógnito o conflicto de tabs).");
});

// Referencias helpers (por usuario)
let currentUser = null;
const colRef = (name) => db.collection("users").doc(currentUser.uid).collection(name);
const userDoc = () => db.collection("users").doc(currentUser.uid);

// Storage refs
const logoRef = () => storage.ref().child(`users/${currentUser.uid}/logo.png`);
