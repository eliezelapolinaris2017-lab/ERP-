/* Utilidades */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const fmtMoney = (n=0)=> new Intl.NumberFormat('es-PR',{style:'currency',currency:'USD'}).format(Number(n)||0);
const sha256 = async (txt) => {
  const enc = new TextEncoder().encode(String(txt));
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
};

/* Estado */
let pinAttempts = 5;
let deferredPrompt = null;
let unsubPayroll = null;
let unsubLedger = null;
let flowChart, catsChart;

/* SW registro + actualización controlada */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('./service-worker.js');
    console.log('[SW] registrado', reg);
    let newWorker;
    if (reg.waiting) showUpdateBanner(reg);
    reg.addEventListener('updatefound', () => {
      newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(reg);
        }
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', ()=> {
      // recarga suave
      window.location.reload();
    });
  });
}
function showUpdateBanner(reg){
  $('#update-banner').classList.remove('hidden');
  $('#btn-refresh').onclick = ()=> reg.waiting.postMessage({type:'SKIP_WAITING'});
}

/* Instalación (A2HS) */
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  $('#btn-install').classList.remove('hidden');
});
$('#btn-install')?.addEventListener('click', async ()=>{
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#btn-install').classList.add('hidden');
});

/* Navegación SPA */
$$('.nav-link').forEach(b=>{
  b.addEventListener('click', ()=>{
    $$('.nav-link').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const t = b.dataset.target;
    $$('.view').forEach(v=>v.classList.add('hidden'));
    $(`#view-${t}`).classList.remove('hidden');
  });
});

/* LOGIN POR PIN */
const LS_PIN_HASH = 'oasis.pin.hash';
const LS_PIN_LOCK  = 'oasis.pin.lock';
function isLocked(){ return Number(localStorage.getItem(LS_PIN_LOCK)||'0')>=5; }
function updatePinAttemptsUI(){
  $('#pin-attempts').textContent = `Intentos restantes: ${Math.max(0, 5 - Number(localStorage.getItem(LS_PIN_LOCK)||'0'))}`;
}
async function checkPin(pin){
  const hash = await sha256(pin);
  const saved = localStorage.getItem(LS_PIN_HASH);
  return saved && saved === hash;
}
async function setPin(pin){
  const hash = await sha256(pin);
  localStorage.setItem(LS_PIN_HASH, hash);
  if (currentUser){
    await userDoc().set({ pinHash: hash }, { merge:true });
  }
}

/* GOOGLE AUTH + sesión */
async function onLogin(){
  $('#login-view').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  await loadSettingsAndLogo();
  bindRealtime();
  initCharts();
  refreshDashboard();
}
function logout(){
  if (unsubPayroll) unsubPayroll();
  if (unsubLedger) unsubLedger();
  auth.signOut();
  currentUser = null;
  $('#app-shell').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  updatePinAttemptsUI();
}

/* Eventos Login */
$('#btn-pin-login').addEventListener('click', async ()=>{
  if (isLocked()){
    $('#login-error').textContent = 'Bloqueado por intentos fallidos. Inicia con Google para resetear.';
    return;
  }
  const val = $('#pin-input').value.trim();
  if (val.length<4 || val.length>6){ $('#login-error').textContent='PIN inválido'; return; }
  if (await checkPin(val)){
    $('#login-error').textContent='';
    localStorage.setItem(LS_PIN_LOCK,'0');
    await onLogin();
  } else {
    const used = Number(localStorage.getItem(LS_PIN_LOCK)||'0') + 1;
    localStorage.setItem(LS_PIN_LOCK, String(used));
    updatePinAttemptsUI();
    $('#login-error').textContent = used>=5 ? 'Demasiados intentos. Bloqueado.' : 'PIN incorrecto';
  }
});
$('#btn-google').addEventListener('click', async ()=>{
  try{
    const provider = new firebase.auth.GoogleAuthProvider();
    const res = await auth.signInWithPopup(provider);
    currentUser = res.user;
    // Crea doc base si no existe
    await userDoc().set({ displayName: currentUser.displayName || '', createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
    // Si estaba bloqueado, desbloquea
    localStorage.setItem(LS_PIN_LOCK,'0');
    await onLogin();
  }catch(e){ $('#login-error').textContent = e.message; }
});

/* Observa cambios de auth (refresca currentUser si recarga) */
auth.onAuthStateChanged(async (u)=>{
  if (u){
    currentUser = u;
    $('#login-view').classList.add('hidden');
    $('#app-shell').classList.remove('hidden');
    await loadSettingsAndLogo();
    bindRealtime();
    initCharts();
    refreshDashboard();
  } else {
    $('#app-shell').classList.add('hidden');
    $('#login-view').classList.remove('hidden');
  }
});

/* Carga settings (nombre, PIN, logo) */
async function loadSettingsAndLogo(){
  if (!currentUser) return;
  const snap = await userDoc().get();
  const data = snap.exists? snap.data(): {};
  if (data?.companyName) $('#company-name').textContent = data.companyName;
  if (data?.pinHash && !localStorage.getItem(LS_PIN_HASH)){
    localStorage.setItem(LS_PIN_HASH, data.pinHash);
  }
  try{
    const url = await logoRef().getDownloadURL();
    $('#company-logo').src = url;
    $('#login-logo').src = url;
  }catch(e){ /* sin logo aún -> usa assets/logo.png */ }
}

/* Guardar ajustes */
$('#btn-save-company').addEventListener('click', async ()=>{
  const name = $('#set-company').value.trim();
  if (name){
    $('#company-name').textContent = name;
    if (currentUser) await userDoc().set({ companyName: name }, { merge:true });
  }
  const f = $('#set-logo').files?.[0];
  if (f && currentUser){
    await logoRef().put(f);
    const url = await logoRef().getDownloadURL();
    $('#company-logo').src = url;
    $('#login-logo').src = url;
  }
});
$('#btn-save-pin').addEventListener('click', async ()=>{
  const newPin = $('#set-pin').value.trim();
  if (newPin.length>=4 && newPin.length<=6){
    await setPin(newPin);
    alert('PIN actualizado.');
  } else {
    alert('PIN inválido (4–6).');
  }
});

/* Logout */
$('#btn-logout').addEventListener('click', logout);

/* ---- NÓMINA ---- */
const queueKeyPayroll = 'queue_payroll';
function queuePush(key, item){
  const arr = JSON.parse(localStorage.getItem(key)||'[]'); arr.push(item);
  localStorage.setItem(key, JSON.stringify(arr));
}
async function syncQueue(){
  if (!currentUser) return;
  const payQ = JSON.parse(localStorage.getItem(queueKeyPayroll)||'[]');
  for (const it of payQ){
    await colRef('payroll').add(it);
  }
  localStorage.removeItem(queueKeyPayroll);

  const ledQ = JSON.parse(localStorage.getItem('queue_ledger')||'[]');
  for (const it of ledQ) await colRef('ledger').add(it);
  localStorage.removeItem('queue_ledger');
}

window.addEventListener('online', syncQueue);

$('#payroll-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const employee = $('#pr-employee').value.trim();
  const date = $('#pr-date').value;
  const gross = Number($('#pr-gross').value||0);
  const ret = Number($('#pr-ret').value||0);
  const dedu = Number($('#pr-dedu1').value||0);
  if (!employee || !date || gross<=0) return;

  const net = gross * (1 - (ret/100) - (dedu/100));
  const doc = { employee, date, gross, ret, dedu, net, createdAt: firebase.firestore.FieldValue.serverTimestamp() };

  try{
    if (navigator.onLine && currentUser) await colRef('payroll').add(doc);
    else queuePush(queueKeyPayroll, doc);
    e.target.reset();
  }catch(err){ alert('Error al guardar nómina: '+err.message); }
});

function renderPayrollRow(id, d){
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${d.employee}</td>
    <td>${d.date}</td>
    <td>${fmtMoney(d.gross)}</td>
    <td>${(d.ret??0).toFixed(2)}</td>
    <td>${(d.dedu??0).toFixed(2)}</td>
    <td>${fmtMoney(d.net)}</td>
    <td><button class="btn danger btn-sm" data-del-pay="${id}">Eliminar</button></td>
  `;
  return tr;
}
function bindPayrollDeletes(){
  $$('#payroll-tbody [data-del-pay]').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.getAttribute('data-del-pay');
      if (confirm('Eliminar registro de nómina?')){
        await colRef('payroll').doc(id).delete();
      }
    };
  });
}

/* Export payroll PDF */
$('#btn-payroll-export').addEventListener('click', async ()=>{
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'pt', format:'a4'});
  doc.setFontSize(14);
  doc.text('Reporte de Nómina', 40, 40);
  let y = 70;
  doc.setFontSize(10);
  doc.text('Empleado',40,y); doc.text('Fecha',160,y); doc.text('Bruto',240,y); doc.text('Ret %',320,y); doc.text('Ded %',370,y); doc.text('Neto',430,y);
  y+=12; doc.line(40,y,540,y); y+=14;

  $$('#payroll-tbody tr').forEach(tr=>{
    const tds = tr.querySelectorAll('td');
    const vals = [...tds].slice(0,6).map(td=>td.textContent);
    doc.text(String(vals[0]),40,y);
    doc.text(String(vals[1]),160,y);
    doc.text(String(vals[2]),240,y);
    doc.text(String(vals[3]),320,y);
    doc.text(String(vals[4]),370,y);
    doc.text(String(vals[5]),430,y);
    y+=14; if (y>760){ doc.addPage(); y=60; }
  });

  doc.save('nomina.pdf');
});

/* Backup / Restore payroll */
$('#btn-payroll-backup').addEventListener('click', async ()=>{
  const out = [];
  $$('#payroll-tbody tr').forEach(tr=>{
    const tds = tr.querySelectorAll('td');
    out.push({
      employee: tds[0].textContent,
      date: tds[1].textContent,
      gross: tds[2].textContent,
      ret: tds[3].textContent,
      dedu: tds[4].textContent,
      net: tds[5].textContent
    });
  });
  downloadJSON(out, 'payroll-backup.json');
});
$('#payroll-restore').addEventListener('change', async (e)=>{
  const f = e.target.files?.[0]; if (!f) return;
  const txt = await f.text(); const arr = JSON.parse(txt);
  for (const r of arr){
    const doc = {
      employee: r.employee, date: r.date,
      gross: numFromMoney(r.gross), ret: Number(r.ret)||0, dedu: Number(r.dedu)||0,
      net: numFromMoney(r.net), createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (navigator.onLine && currentUser) await colRef('payroll').add(doc);
    else queuePush(queueKeyPayroll, doc);
  }
});

/* ---- LIBRO MAYOR ---- */
$('#ledger-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const type = $('#lg-type').value;
  const desc = $('#lg-desc').value.trim();
  const amount = Number($('#lg-amount').value||0);
  const date = $('#lg-date').value;
  const category = $('#lg-category').value.trim();
  if (!desc || !date || amount<=0) return;

  const doc = { type, desc, amount, date, category, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
  try{
    if (navigator.onLine && currentUser) await colRef('ledger').add(doc);
    else queuePush('queue_ledger', doc);
    e.target.reset();
  }catch(err){ alert('Error al guardar en libro: '+err.message); }
});

function renderLedgerRow(id, d){
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${d.type}</td>
    <td>${d.desc}</td>
    <td>${fmtMoney(d.amount)}</td>
    <td>${d.date}</td>
    <td>${d.category||''}</td>
    <td><button class="btn danger btn-sm" data-del-led="${id}">Eliminar</button></td>
  `;
  return tr;
}
function bindLedgerDeletes(){
  $$('#ledger-tbody [data-del-led]').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.getAttribute('data-del-led');
      if (confirm('Eliminar movimiento?')){
        await colRef('ledger').doc(id).delete();
      }
    };
  });
}

/* PDF ledger */
$('#btn-ledger-export').addEventListener('click', async ()=>{
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'pt', format:'a4'});
  doc.setFontSize(14); doc.text('Libro Mayor (Simple)', 40, 40);
  let y = 70;
  doc.setFontSize(10);
  doc.text('Tipo',40,y); doc.text('Descripción',100,y); doc.text('Monto',360,y); doc.text('Fecha',440,y); doc.text('Categoría',510,y);
  y+=12; doc.line(40,y,560,y); y+=14;

  $$('#ledger-tbody tr').forEach(tr=>{
    const tds = tr.querySelectorAll('td');
    const vals = [...tds].slice(0,5).map(td=>td.textContent);
    doc.text(String(vals[0]),40,y);
    doc.text(String(vals[1]).slice(0,46),100,y);
    doc.text(String(vals[2]),360,y);
    doc.text(String(vals[3]),440,y);
    doc.text(String(vals[4]).slice(0,14),510,y);
    y+=14; if (y>760){ doc.addPage(); y=60; }
  });

  doc.save('libro-mayor.pdf');
});

/* Backup / Restore ledger */
$('#btn-ledger-backup').addEventListener('click', async ()=>{
  const out = [];
  $$('#ledger-tbody tr').forEach(tr=>{
    const tds = tr.querySelectorAll('td');
    out.push({
      type: tds[0].textContent, desc: tds[1].textContent,
      amount: tds[2].textContent, date: tds[3].textContent, category: tds[4].textContent
    });
  });
  downloadJSON(out,'ledger-backup.json');
});
$('#ledger-restore').addEventListener('change', async (e)=>{
  const f = e.target.files?.[0]; if (!f) return;
  const txt = await f.text(); const arr = JSON.parse(txt);
  for (const r of arr){
    const doc = {
      type: r.type, desc: r.desc, amount: numFromMoney(r.amount),
      date: r.date, category: r.category||'',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (navigator.onLine && currentUser) await colRef('ledger').add(doc);
    else queuePush('queue_ledger', doc);
  }
});

/* Realtime listeners */
function bindRealtime(){
  if (!currentUser) return;
  if (unsubPayroll) unsubPayroll();
  if (unsubLedger) unsubLedger();

  unsubPayroll = colRef('payroll').orderBy('date','desc').onSnapshot((qs)=>{
    const tbody = $('#payroll-tbody'); tbody.innerHTML='';
    qs.forEach(doc=>{
      const d = doc.data(); tbody.appendChild(renderPayrollRow(doc.id, d));
    });
    bindPayrollDeletes();
    refreshDashboard();
  });

  unsubLedger = colRef('ledger').orderBy('date','desc').onSnapshot((qs)=>{
    const tbody = $('#ledger-tbody'); tbody.innerHTML='';
    qs.forEach(doc=>{
      const d = doc.data(); tbody.appendChild(renderLedgerRow(doc.id, d));
    });
    bindLedgerDeletes();
    refreshDashboard();
  });

  syncQueue(); // intenta enviar lo pendiente
}

/* Dashboard + Charts */
function initCharts(){
  const ctx1 = document.getElementById('chart-flow');
  const ctx2 = document.getElementById('chart-cats');
  flowChart = new Chart(ctx1, {
    type: 'line',
    data: { labels:[], datasets:[
      { label:'Ingresos', data:[] },
      { label:'Gastos', data:[] }
    ]},
    options:{ responsive:true, maintainAspectRatio:false }
  });
  catsChart = new Chart(ctx2, {
    type: 'bar',
    data: { labels:[], datasets:[ { label:'Gastos por categoría', data:[] } ] },
    options:{ responsive:true, maintainAspectRatio:false }
  });
}

async function refreshDashboard(){
  if (!currentUser) return;

  // período del mes actual
  const now = new Date();
  const y = now.getFullYear(); const m = String(now.getMonth()+1).padStart(2,'0');
  const monthPrefix = `${y}-${m}`; // YYYY-MM

  const paySnap = await colRef('payroll').where('date','>=',`${monthPrefix}-01`).where('date','<=',`${monthPrefix}-31`).get();
  let totalPayroll = 0;
  paySnap.forEach(d => totalPayroll += Number(d.data().net||0));

  // ledger
  const ledSnap = await colRef('ledger').where('date','>=',`${monthPrefix}-01`).where('date','<=',`${monthPrefix}-31`).get();
  let income=0, expenses=0;
  const catAgg = {};
  ledSnap.forEach(x=>{
    const d = x.data();
    if (d.type==='ingreso') income += Number(d.amount||0);
    else expenses += Number(d.amount||0);

    if (d.type==='gasto'){
      const c = (d.category||'Otros');
      catAgg[c] = (catAgg[c]||0) + Number(d.amount||0);
    }
  });

  $('#kpi-income').textContent = fmtMoney(income);
  $('#kpi-expenses').textContent = fmtMoney(expenses);
  $('#kpi-payroll').textContent = fmtMoney(totalPayroll);

  // flow: 6 últimos meses
  const months = []; const incSeries=[]; const expSeries=[];
  for (let i=5;i>=0;i--){
    const dt = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    months.push(ym);
    incSeries.push(await sumByMonth('ingreso', ym));
    expSeries.push(await sumByMonth('gasto', ym));
  }
  flowChart.data.labels = months;
  flowChart.data.datasets[0].data = incSeries;
  flowChart.data.datasets[1].data = expSeries;
  flowChart.update();

  // cats top 6
  const sorted = Object.entries(catAgg).sort((a,b)=>b[1]-a[1]).slice(0,6);
  catsChart.data.labels = sorted.map(([k])=>k);
  catsChart.data.datasets[0].data = sorted.map(([,v])=>v);
  catsChart.update();
}
async function sumByMonth(type, ym){
  const snap = await colRef('ledger')
    .where('type','==', type)
    .where('date','>=',`${ym}-01`)
    .where('date','<=',`${ym}-31`).get();
  let s=0; snap.forEach(d=> s+= Number(d.data().amount||0)); return s;
}

/* Helpers descarga JSON y parseo dinero */
function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function numFromMoney(txt){
  return Number(String(txt).replace(/[^\d.-]+/g,''))||0;
}

/* Vista inicial */
updatePinAttemptsUI();
