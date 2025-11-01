// app.js – Control de sesión, UI, Firestore realtime, dashboard, ledger, settings, PWA
import {
  auth, db, colUsers, googleLogin, logout, onAuth, setDoc, getDoc, addDoc, deleteDoc,
  onSnapshot, serverTimestamp, query, orderBy, doc, collection, uploadCompanyLogo, enqueue, flushQueue
} from "./firebase.js";
import { bindPayrollAutoCalc, exportPayrollPDF, exportLedgerPDF } from "./payroll.js";

/* ===== Utils ===== */
export function formatMoney(n){ return (Number(n)||0).toLocaleString("es-PR",{style:"currency",currency:"USD"}); }
const $ = (sel)=>document.querySelector(sel);
const byId = (id)=>document.getElementById(id);
function uid(){ return auth.currentUser?.uid || localStorage.getItem("local-uid"); }
function ensureLocalUid(){ if(!localStorage.getItem("local-uid")) localStorage.setItem("local-uid", crypto.randomUUID()); return localStorage.getItem("local-uid"); }
function monthKey(d){ const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`; }

/* ===== Estado ===== */
let state = {
  pin: null,
  attempts: 5,
  lockedUntil: 0,
  deferredPrompt: null,
  charts: { flow:null, cats:null },
  unsub: { payroll:null, ledger:null },
  data: { payroll:[], ledger:[], settings:{} }
};

/* ===== PWA: registro de Service Worker ===== */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async ()=>{
    try{
      const reg = await navigator.serviceWorker.register("/service-worker.js");
      console.log("[SW] registrado", reg);

      // actualización controlada
      reg.addEventListener("updatefound", ()=>{
        const newWorker = reg.installing;
        newWorker?.addEventListener("statechange", ()=>{
          if(newWorker.state === "installed" && navigator.serviceWorker.controller){
            $("#update-toast").classList.remove("hidden");
            byId("btn-refresh").onclick = ()=>{
              newWorker.postMessage({type:"SKIP_WAITING"});
            };
          }
        });
      });

      navigator.serviceWorker.addEventListener("controllerchange", ()=>{
        // recarga suave
        window.location.reload();
      });
    }catch(e){ console.warn("[SW] fallo registro", e); }
  });
}

/* SW: recibir mensaje de listo */
navigator.serviceWorker?.addEventListener?.("message", (evt)=>{
  if(evt.data?.type === "READY") console.log("[SW] listo");
});

/* PWA: Add to Home Screen */
window.addEventListener("beforeinstallprompt", (e)=>{
  e.preventDefault();
  state.deferredPrompt = e;
  const btn = byId("btn-install");
  btn.classList.remove("hidden");
  btn.onclick = async ()=>{
    btn.classList.add("hidden");
    await state.deferredPrompt.prompt();
    state.deferredPrompt = null;
  };
});

/* ===== UI inicial ===== */
bindPayrollAutoCalc();
setupTabs();
bindLogin();
bindSettings();
bindBackup();
bindLedger();
bindPayroll();

/* ===== Sesión Firebase/Auth ===== */
onAuth(async (user)=>{
  if(user){
    // cargar settings del usuario (o crear)
    await postLoginInit(user.uid, true);
  }else{
    // login por PIN local (respaldo)
    const pinned = localStorage.getItem("pin");
    if(pinned){
      state.pin = pinned;
    }
    showLogin();
  }
});

/* ===== Login ===== */
function bindLogin(){
  const btnPin = byId("btn-pin");
  const pinInput = byId("pin-input");
  const btnGoogle = byId("btn-google");

  // persistencia de intentos/bloqueo
  const lsAtt = Number(localStorage.getItem("attempts") || "5");
  const lockedUntil = Number(localStorage.getItem("lockedUntil") || "0");
  state.attempts = lsAtt;
  state.lockedUntil = lockedUntil;
  updateAttemptsUI();

  btnPin.addEventListener("click", ()=>{
    const now = Date.now();
    if(now < state.lockedUntil){
      byId("lock-msg").classList.remove("hidden");
      return;
    }
    const pin = pinInput.value.trim();
    if(!/^\d{4,6}$/.test(pin)){
      alert("PIN inválido (4–6 dígitos).");
      return;
    }
    // si no hay pin guardado, el primero que entra queda como pin local
    if(!localStorage.getItem("pin")){
      localStorage.setItem("pin", pin);
      state.pin = pin;
      state.attempts = 5; localStorage.setItem("attempts","5");
      enterApp();
      return;
    }

    if(pin === localStorage.getItem("pin")){
      state.attempts = 5; localStorage.setItem("attempts","5");
      enterApp();
    }else{
      state.attempts = Math.max(0, state.attempts - 1);
      localStorage.setItem("attempts", String(state.attempts));
      updateAttemptsUI();
      if(state.attempts === 0){
        const lockMs = 5 * 60 * 1000; // 5 minutos
        state.lockedUntil = Date.now() + lockMs;
        localStorage.setItem("lockedUntil", String(state.lockedUntil));
        byId("lock-msg").classList.remove("hidden");
      }
    }
  });

  btnGoogle.addEventListener("click", async ()=>{
    try{
      const user = await googleLogin();
      await postLoginInit(user.uid, true);
    }catch(e){
      alert("Error Google Auth: " + e.message);
    }
  });
}

async function postLoginInit(uid, viaGoogle){
  ensureLocalUid();
  hideLogin();
  await flushQueue().catch(()=>{});
  // settings
  const { settings } = colUsers(uid);
  const snap = await getDoc(settings);
  if(!snap.exists()){
    await setDoc(settings, {
      companyName: "Mi Empresa",
      pin: localStorage.getItem("pin") || "",
      logoUrl: "",
      updatedAt: serverTimestamp()
    }, { merge:true });
  }
  const s2 = await getDoc(settings);
  state.data.settings = s2.data() || {};
  if(state.data.settings.pin){
    localStorage.setItem("pin", state.data.settings.pin);
  }
  if(state.data.settings.companyName) byId("company-name").textContent = state.data.settings.companyName;
  if(state.data.settings.logoUrl){
    byId("company-logo").src = state.data.settings.logoUrl;
    byId("login-logo").src = state.data.settings.logoUrl;
  }

  subscribeCollections(uid);
  enterApp();
}

function subscribeCollections(uid){
  // payroll realtime
  state.unsub.payroll?.(); state.unsub.ledger?.();
  const { payroll, ledger } = colUsers(uid);

  const qPayroll = query(payroll, orderBy("date","desc"));
  state.unsub.payroll = onSnapshot(qPayroll, (snap)=>{
    state.data.payroll = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderPayrollTable();
    updateKPIsAndCharts();
  });

  const qLedger = query(ledger, orderBy("date","desc"));
  state.unsub.ledger = onSnapshot(qLedger, (snap)=>{
    state.data.ledger = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderLedgerTable();
    updateKPIsAndCharts();
  });
}

/* ===== Entrar/Salir & Tabs ===== */
function enterApp(){
  byId("app-header").classList.remove("hidden");
  byId("content").classList.remove("hidden");
}
function showLogin(){
  byId("login-view").classList.remove("hidden");
}
function hideLogin(){
  byId("login-view").classList.add("hidden");
}
byId("btn-logout").addEventListener("click", async ()=>{
  try{ await logout(); }catch{}
  // limpiar y volver al login
  state.unsub.payroll?.(); state.unsub.ledger?.();
  byId("app-header").classList.add("hidden");
  byId("content").classList.add("hidden");
  showLogin();
});
function setupTabs(){
  document.querySelectorAll("header nav .tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("header nav .tab").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tabview").forEach(v=>v.classList.remove("active"));
      byId(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

/* ===== Nómina ===== */
function bindPayroll(){
  const form = byId("payroll-form");
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const employee = byId("emp-name").value.trim();
    const date = byId("emp-date").value;
    const gross = Number(byId("emp-gross").value);
    const retentionPct = Number(byId("emp-ret").value);
    const deductionsPct = Number(byId("emp-deductions").value || 0);
    const net = Number(byId("emp-net").value.replace(/[^\d.-]/g,"") || 0);

    const u = uid();
    const path = ["users", u, "payroll", crypto.randomUUID()];
    const data = { employee, date, gross, retentionPct, deductionsPct, net, createdAt: serverTimestamp() };
    try{
      await setDoc(doc(db, path.join("/")), data);
    }catch(e){
      console.warn("offline, encolando", e);
      enqueue({ type:"add", path, data });
    }
    form.reset(); bindPayrollAutoCalc();
  });

  byId("payroll-export").addEventListener("click", ()=>{
    exportPayrollPDF(state.data.payroll);
  });
}

function renderPayrollTable(){
  const tbody = byId("payroll-table").querySelector("tbody");
  tbody.innerHTML = "";
  state.data.payroll.forEach(r=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.employee||""}</td>
      <td>${r.date||""}</td>
      <td>${formatMoney(r.gross||0)}</td>
      <td>${r.retentionPct||0}</td>
      <td>${r.deductionsPct||0}</td>
      <td>${formatMoney(r.net||0)}</td>
      <td><button class="btn danger" data-id="${r.id}" data-type="payroll">Eliminar</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("button[data-type='payroll']").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.id;
      const path = ["users", uid(), "payroll", id];
      try{ await deleteDoc(doc(db, path.join("/"))); }
      catch(e){ enqueue({ type:"delete", path }); }
    });
  });
}

/* ===== Ledger ===== */
function bindLedger(){
  const form = byId("ledger-form");
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const type = byId("mov-type").value;
    const desc = byId("mov-desc").value.trim();
    const category = byId("mov-category").value.trim();
    const amount = Number(byId("mov-amount").value);
    const date = byId("mov-date").value;
    const u = uid();
    const path = ["users", u, "ledger", crypto.randomUUID()];
    const data = { type, desc, category, amount, date, createdAt: serverTimestamp() };
    try{
      await setDoc(doc(db, path.join("/")), data);
    }catch(e){
      enqueue({ type:"add", path, data });
    }
    form.reset();
  });

  byId("ledger-export").addEventListener("click", ()=>{
    exportLedgerPDF(state.data.ledger);
  });
}

function renderLedgerTable(){
  const tbody = byId("ledger-table").querySelector("tbody");
  tbody.innerHTML = "";
  state.data.ledger.forEach(r=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.type}</td>
      <td>${r.desc}</td>
      <td>${r.category}</td>
      <td>${formatMoney(r.amount||0)}</td>
      <td>${r.date}</td>
      <td><button class="btn danger" data-id="${r.id}" data-type="ledger">Eliminar</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("button[data-type='ledger']").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.id;
      const path = ["users", uid(), "ledger", id];
      try{ await deleteDoc(doc(db, path.join("/"))); }
      catch(e){ enqueue({ type:"delete", path }); }
    });
  });
}

/* ===== Dashboard: KPIs + Charts ===== */
function sumMonth(list, fieldFilter){
  const now = new Date();
  const mk = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  return list
    .filter(x => (x.date || "").startsWith(mk))
    .reduce((acc, x)=>acc + (Number(fieldFilter(x))||0), 0);
}
function updateKPIsAndCharts(){
  const incomes = state.data.ledger.filter(x=>x.type==="ingreso");
  const expenses = state.data.ledger.filter(x=>x.type==="gasto");
  byId("kpi-income").textContent = formatMoney(sumMonth(incomes, x=>x.amount));
  byId("kpi-expense").textContent = formatMoney(sumMonth(expenses, x=>x.amount));
  byId("kpi-payroll").textContent = formatMoney(sumMonth(state.data.payroll, x=>x.net));

  // Flujo mensual de los últimos 6 meses
  const months = [];
  const now = new Date();
  for(let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  const dataIncome = months.map(m=> state.data.ledger.filter(x=>x.type==="ingreso" && (x.date||"").startsWith(m)).reduce((a,b)=>a+Number(b.amount||0),0) );
  const dataExpense = months.map(m=> state.data.ledger.filter(x=>x.type==="gasto" && (x.date||"").startsWith(m)).reduce((a,b)=>a+Number(b.amount||0),0) );

  // Chart line
  const ctx1 = byId("chart-flow");
  if(state.charts.flow){ state.charts.flow.destroy(); }
  state.charts.flow = new Chart(ctx1, {
    type: "line",
    data: {
      labels: months,
      datasets: [
        { label:"Ingresos", data: dataIncome },
        { label:"Gastos", data: dataExpense }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:"#e7eef7" } } },
      scales:{ x:{ ticks:{color:"#cdd6e3"} }, y:{ ticks:{color:"#cdd6e3"} } }
    }
  });

  // Categorías (top 6 por suma)
  const map = new Map();
  expenses.forEach(x=>{
    const key = x.category || "Otros";
    map.set(key, (map.get(key)||0) + Number(x.amount||0));
  });
  const sorted = [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
  const labels = sorted.map(x=>x[0]); const values = sorted.map(x=>x[1]);

  const ctx2 = byId("chart-categories");
  if(state.charts.cats){ state.charts.cats.destroy(); }
  state.charts.cats = new Chart(ctx2, {
    type: "bar",
    data: { labels, datasets: [{ label:"Gasto", data: values }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:"#e7eef7" } } },
      scales:{ x:{ ticks:{color:"#cdd6e3"} }, y:{ ticks:{color:"#cdd6e3"} } }
    }
  });
}

/* ===== Configuración ===== */
function bindSettings(){
  const form = byId("settings-form");
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const name = byId("cfg-name").value.trim();
    const newPin = byId("cfg-pin").value.trim();
    const file = byId("cfg-logo").files?.[0];
    const u = auth.currentUser?.uid;
    if(!u){
      // modo local
      if(name){ byId("company-name").textContent = name; }
      if(newPin && /^\d{4,6}$/.test(newPin)){ localStorage.setItem("pin", newPin); }
      if(file){
        const locUrl = URL.createObjectURL(file);
        byId("company-logo").src = locUrl; byId("login-logo").src = locUrl;
      }
      return;
    }
    const { settings } = colUsers(u);
    let logoUrl = state.data.settings.logoUrl || "";
    if(file){
      logoUrl = await uploadCompanyLogo(u, file);
      byId("company-logo").src = logoUrl;
      byId("login-logo").src = logoUrl;
    }
    await setDoc(settings, {
      ...(name?{companyName:name}:{ }),
      ...(newPin && /^\d{4,6}$/.test(newPin)?{pin:newPin}:{ }),
      ...(logoUrl?{logoUrl}:{ }),
      updatedAt: serverTimestamp()
    }, { merge:true });
    if(name) byId("company-name").textContent = name;
    if(newPin && /^\d{4,6}$/.test(newPin)) localStorage.setItem("pin", newPin);
    alert("Configuración guardada.");
  });
}

/* ===== Backup (export/import JSON) ===== */
function bindBackup(){
  byId("btn-export-json").addEventListener("click", ()=>{
    const blob = new Blob([JSON.stringify({
      payroll: state.data.payroll,
      ledger: state.data.ledger
    }, null, 2)], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  });

  byId("btn-import-json").addEventListener("click", async ()=>{
    const file = byId("import-file").files?.[0];
    if(!file) return alert("Selecciona un archivo JSON.");
    const text = await file.text();
    const json = JSON.parse(text);
    const u = uid();
    if(!u) return alert("Inicia sesión o define PIN local.");
    const { payroll, ledger } = colUsers(u);

    // Insertar en lote (con fallback a cola)
    const pushMany = async (colName, arr) => {
      for(const r of arr||[]){
        const id = crypto.randomUUID();
        const path = ["users", u, colName, id];
        try{ await setDoc(doc(db, path.join("/")), r); }
        catch{ enqueue({ type:"add", path, data:r }); }
      }
    };
    await pushMany("payroll", json.payroll);
    await pushMany("ledger", json.ledger);
    alert("Importación encolada/lista.");
  });
}

/* ===== Intentos/Bloqueo UI ===== */
function updateAttemptsUI(){
  byId("attempts").textContent = `Intentos restantes: ${state.attempts}`;
  if(Date.now() < state.lockedUntil) byId("lock-msg").classList.remove("hidden");
  else byId("lock-msg").classList.add("hidden");
}

/* ===== Inicial ===== */
window.addEventListener("online", ()=>flushQueue());
