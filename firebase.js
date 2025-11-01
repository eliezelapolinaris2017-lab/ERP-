// Inserta aquí tu firebaseConfig (README explica cómo obtenerlo)
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_DOMINIO.firebaseapp.com",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_BUCKET.appspot.com",
  messagingSenderId: "TU_SENDER",
  appId: "TU_APP_ID"
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
