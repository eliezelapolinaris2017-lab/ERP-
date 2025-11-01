// app.js
import {
  auth, signInGoogle, watchAuth, logOut,
  db, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy,
  storage, ref, uploadBytes, getDownloadURL,
  payrollCol, ledgerCol, settingsDoc
} from "./firebase.js";

import { formatMoney, makePDFLedger, makeCharts, recalcKPIs } from "./payroll.js";

/* ---------- UI util ---------- */
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");

/* ---------- Tabs login ---------- */
const tabs = $$(".tab");
tabs.forEach(t=>{
  t.addEventListener("click", ()=>{
    tabs.forEach(x=>x.classList.remove("active"));
    t.classList.add("active");
    $("#pin-panel").classList.toggle("hidden", t.dataset.tab !== "pin");
    $("#google-panel").classList.toggle("hidden", t.dataset.tab !== "google");
  });
});

/* ---------- PIN con 5 intentos ---------- */
const PIN_KEY = "app_pin";            // se guarda en Firestore (por usuario) y en local como fallback
const PIN_TRIES_KEY = "pin_tries";    // en sessionStorage
const MAX_TRIES = 5;
const triesSpan = $("#pin-tries");

function getTries(){
  const n = Number(sessionStorage.getItem(PIN_TRIES_KEY) ?? MAX_TRIES);
  triesSpan.textContent = n;
  return n;
}
function setTries(n){
  sessionStorage.setItem(PIN_TRIES_KEY, n);
  triesSpan.textContent = n;
}

$("#btn-pin-login").addEventListener("click", async ()=>{
  let tries = getTries();
  if(tries <= 0){ alert("PIN bloqueado. Reinicia la sesión o usa Google."); return; }
  const pin = $("#pin-input").value.trim();
  const localPin = localStorage.getItem(PIN_KEY);
  if(!localPin){ alert("Configura el PIN en Ajustes o inicia con Google primero."); return; }
  if(pin && pin === localPin){
    sessionStorage.removeItem(PIN_TRIES_KEY);
    accessGranted({ localOnly:true });
  } else {
    setTries(tries - 1);
    alert("PIN incorrecto.");
  }
});

/* ---------- Google Auth ---------- */
$("#btn-google").addEventListener("click", async ()=>{
  try { await signInGoogle(); } catch(e){ alert("Error autenticando: " + e.message); }
});

watchAuth(async (user)=>{
  if(user){
    // Cargar settings (PIN/empresa/logo)
    const sDoc = await getDoc(settingsDoc(user.uid));
    if(sDoc.exists()){
      const s = sDoc.data();
      if(s.pin) localStorage.setItem(PIN_KEY, s.pin);
      if(s.companyName) $("#brand-name").textContent = s.companyName;
      if(s.logoUrl) $("#brand-logo").src = s.logoUrl;
    }
    accessGranted({ user });
    attachRealtime(user.uid); // sincronización automática
  } else {
    accessDenied();
  }
});

/* ---------- Cambio de vistas ---------- */
const navlinks = $$(".navlink");
navlinks.forEach(btn=>{
  btn.addEventListener("click", ()=>{
    navlinks.forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    $$(".view").forEach(v=>hide(v));
    show( $("#view-"+btn.dataset.view) );
  });
});

/* ---------- Logout ---------- */
$("#btn-logout").addEventListener("click", async ()=>{
  await logOut();
  accessDenied();
});

/* ---------- Subir logo (Storage) ---------- */
$("#input-logo").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if(!file || !auth.currentUser) return;
  try{
    const r = ref(storage, `users/${auth.currentUser.uid}/brandLogo`);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    $("#brand-logo").src = url;
    await setDoc(settingsDoc(auth.currentUser.uid), { logoUrl: url }, { merge: true });
    alert("Logo actualizado.");
  }catch(err){ alert("Error subiendo logo: "+err.message); }
});

/* ---------- Backup export/import ---------- */
$("#btn-backup-export").addEventListener("click", async ()=>{
  if(!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  // Descargar colecciones payroll + ledger
  const [payrollData, ledgerData] = await Promise.all([
    fetchCollection(payrollCol(uid)),
    fetchCollection(ledgerCol(uid))
  ]);
  const blob = new Blob([JSON.stringify({ payrollData, ledgerData }, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "backup-contabilidad.json"; a.click();
  URL.revokeObjectURL(url);
});

$("#input-backup").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if(!file || !auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const text = await file.text();
  try{
    const json = JSON.parse(text);
    if(Array.isArray(json.payrollData)){
      for(const p of json.payrollData){
        await addDoc(payrollCol(uid), p);
      }
    }
    if(Array.isArray(json.ledgerData)){
      for(const l of json.ledgerData){
        await addDoc(ledgerCol(uid), l);
      }
    }
    alert("Backup importado.");
  }catch(err){ alert("Backup inválido: "+err.message); }
});

/* ---------- Configuración (guardar PIN y nombre) ---------- */
$("#btn-save-settings").addEventListener("click", async ()=>{
  const name = $("#company-name").value.trim();
  const pin  = $("#company-pin").value.trim();
  if(name) $("#brand-name").textContent = name;
  if(pin) localStorage.setItem(PIN_KEY, pin);
  if(auth.currentUser){
    await setDoc(settingsDoc(auth.currentUser.uid), { companyName: name || null, pin: pin || null }, { merge:true });
  }
  alert("Ajustes guardados.");
});

/* ---------- Ledger (contabilidad simple) ---------- */
$("#acc-form").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const row = {
    type: fd.get("type"),
    desc: fd.get("desc"),
    amount: Number(fd.get("amount")),
    date: fd.get("date"),
    createdAt: Date.now()
  };
  if(auth.currentUser){
    await addDoc(ledgerCol(auth.currentUser.uid), row);
  } else {
    // modo local-only
    const local = JSON.parse(localStorage.getItem("ledger_local")||"[]");
    local.push(row); localStorage.setItem("ledger_local", JSON.stringify(local));
    renderLedger(local);
  }
  e.currentTarget.reset();
});

$("#btn-export-ledger").addEventListener("click", ()=>{
  const rows = [...$("#tbl-ledger tbody").children].map(tr=>{
    const tds = tr.querySelectorAll("td");
    return { date: tds[0].textContent, type: tds[1].textContent, desc: tds[2].textContent, amount: tds[3].textContent };
  });
  makePDFLedger(rows, "LibroMayor.pdf");
});

/* ---------- Nómina ---------- */
$("#btn-export-payroll").addEventListener("click", ()=>{
  const rows = [...$("#tbl-payroll tbody").children].map(tr=>{
    const tds = tr.querySelectorAll("td");
    return {
      employee: tds[0].textContent,
      date: tds[1].textContent,
      gross: tds[2].textContent,
      withhold: tds[3].textContent,
      net: tds[4].textContent
    };
  });
  makePDFLedger(rows, "Nomina.pdf", { title: "Nómina" });
});

$("#payroll-form").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const gross = Number(fd.get("gross"));
  const w = Number(fd.get("withhold"));
  const net = +(gross * (1 - w/100)).toFixed(2);

  const item = {
    employee: fd.get("employee"),
    date: fd.get("date"),
    gross, withhold: w, net,
    createdAt: Date.now()
  };

  if(auth.currentUser){
    await addDoc(payrollCol(auth.currentUser.uid), item);
  } else {
    const local = JSON.parse(localStorage.getItem("payroll_local")||"[]");
    local.push(item); localStorage.setItem("payroll_local", JSON.stringify(local));
    renderPayroll(local);
  }
  e.currentTarget.reset();
});

/* ---------- Realtime sync ---------- */
function attachRealtime(uid){
  // payroll
  const q1 = query(payrollCol(uid), orderBy("createdAt","desc"));
  onSnapshot(q1, snap=>{
    const items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderPayroll(items);
  });

  // ledger
  const q2 = query(ledgerCol(uid), orderBy("createdAt","desc"));
  onSnapshot(q2, snap=>{
    const items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderLedger(items);
  });
}

/* ---------- Render helpers ---------- */
function renderPayroll(items){
  const tbody = $("#tbl-payroll tbody");
  tbody.innerHTML = "";
  items.forEach(row=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.employee}</td>
      <td>${row.date}</td>
      <td>${formatMoney(row.gross)}</td>
      <td>${row.withhold}%</td>
      <td>${formatMoney(row.net)}</td>
      <td><button data-id="${row.id||""}" class="secondary btn-del-payroll">Borrar</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll(".btn-del-payroll").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.id;
      if(auth.currentUser && id){ await deleteDoc(doc(db, "users", auth.currentUser.uid, "payroll", id)); }
      btn.closest("tr").remove();
    });
  });

  recalcKPIs();
  makeCharts();
}

function renderLedger(items){
  const tbody = $("#tbl-ledger tbody");
  tbody.innerHTML = "";
  items.forEach(row=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.date}</td>
      <td>${row.type}</td>
      <td>${row.desc}</td>
      <td>${formatMoney(row.amount)}</td>
      <td><button data-id="${row.id||""}" class="secondary btn-del-ledger">Borrar</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll(".btn-del-ledger").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.id;
      if(auth.currentUser && id){ await deleteDoc(doc(db, "users", auth.currentUser.uid, "ledger", id)); }
      btn.closest("tr").remove();
    });
  });

  recalcKPIs();
  makeCharts();
}

async function fetchCollection(colRef){
  // pequeño fetcher para backup
  const q = query(colRef, orderBy("createdAt","asc"));
  return new Promise((resolve, reject)=>{
    const unsub = onSnapshot(q, snap=>{
      const arr = snap.docs.map(d=>d.data());
      resolve(arr);
      unsub();
    }, reject);
  });
}

/* ---------- Estado Auth UI ---------- */
function accessGranted({ user, localOnly=false }={}){
  hide($("#auth-view"));
  show($("#app-view"));

  if(localOnly){
    // Cargar datos locales si existen
    renderPayroll(JSON.parse(localStorage.getItem("payroll_local")||"[]"));
    renderLedger(JSON.parse(localStorage.getItem("ledger_local")||"[]"));
  }
}

function accessDenied(){
  show($("#auth-view"));
  hide($("#app-view"));
  sessionStorage.removeItem(PIN_TRIES_KEY);
}

/* ---------- Inicialización ---------- */
getTries(); // pinta contador
// vista por defecto: dashboard
$$(".navlink")[0]?.click();
