// payroll.js
export const formatMoney = (n=0) =>
  (new Intl.NumberFormat("es-PR", { style:"currency", currency:"USD" })).format(Number(n)||0);

export function recalcKPIs(){
  const payrollRows = [...document.querySelectorAll("#tbl-payroll tbody tr")].map(tr=>{
    const t = tr.querySelectorAll("td");
    return { net: parseCurrency(t[4].textContent || "0"), gross: parseCurrency(t[2].textContent||"0") };
  });
  const ledgerRows  = [...document.querySelectorAll("#tbl-ledger tbody tr")].map(tr=>{
    const t = tr.querySelectorAll("td");
    const amount = parseCurrency(t[3].textContent || "0");
    return { type: t[1].textContent, amount };
  });

  const kpiPayroll = payrollRows.reduce((a,b)=>a + b.net, 0);
  const expenses = ledgerRows.filter(x=>x.type==="gasto").reduce((a,b)=>a+b.amount, 0);
  const income   = ledgerRows.filter(x=>x.type==="ingreso").reduce((a,b)=>a+b.amount, 0);

  document.getElementById("kpi-expenses").textContent = formatMoney(expenses);
  document.getElementById("kpi-income").textContent   = formatMoney(income);
  document.getElementById("kpi-payroll").textContent  = formatMoney(kpiPayroll);
}

function parseCurrency(txt){
  // convierte "$1,234.56" a 1234.56
  const n = String(txt).replace(/[^\d.-]/g,"");
  return parseFloat(n||"0");
}

/* ---------- Gráficas ---------- */
let chart1, chart2;
export function makeCharts(){
  const ctx1 = document.getElementById("chart-cashflow");
  const ctx2 = document.getElementById("chart-expenses");
  if(!ctx1 || !ctx2) return;

  const ledgerRows  = [...document.querySelectorAll("#tbl-ledger tbody tr")].map(tr=>{
    const t = tr.querySelectorAll("td");
    return { date: t[0].textContent, type: t[1].textContent, amount: parseCurrency(t[3].textContent) };
  });

  // Agregación por mes
  const byMonth = {};
  for(const r of ledgerRows){
    const m = (r.date||"").slice(0,7); // YYYY-MM
    if(!byMonth[m]) byMonth[m] = { ingreso:0, gasto:0 };
    byMonth[m][r.type] += r.amount;
  }
  const labels = Object.keys(byMonth).sort();
  const ingresos = labels.map(m=>byMonth[m].ingreso||0);
  const gastos   = labels.map(m=>byMonth[m].gasto||0);

  if(chart1) chart1.destroy();
  chart1 = new Chart(ctx1, {
    type: "line",
    data: { labels, datasets: [
      { label: "Ingresos", data: ingresos, tension: .3 },
      { label: "Gastos", data: gastos, tension: .3 }
    ]},
    options: { responsive:true }
  });

  // Top categorías de gastos (simples por descripción)
  const byDesc = {};
  ledgerRows.filter(x=>x.type==="gasto").forEach(x=>{
    const k = (x.desc || "Otro").slice(0,24);
    byDesc[k] = (byDesc[k]||0) + x.amount;
  });
  const labels2 = Object.keys(byDesc).sort((a,b)=>byDesc[b]-byDesc[a]).slice(0,6);
  const data2 = labels2.map(k=>byDesc[k]);

  if(chart2) chart2.destroy();
  chart2 = new Chart(ctx2, {
    type: "bar",
    data: { labels: labels2, datasets: [{ label:"Gastos por categoría", data: data2 }]},
    options: { responsive:true }
  });
}

/* ---------- PDF ---------- */
export function makePDFLedger(rows, filename="documento.pdf", { title="Libro mayor" } = {}){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });
  const margin = 40;
  let y = margin;

  doc.setFont("helvetica","bold"); doc.setFontSize(16);
  doc.text(title, margin, y); y += 24;
  doc.setFont("helvetica","normal"); doc.setFontSize(10);
  doc.text(new Date().toLocaleString(), margin, y); y += 16;

  const headers = Object.keys(rows[0]||{});
  // Header
  doc.setFont(undefined,"bold");
  let x = margin;
  headers.forEach(h=>{
    doc.text(String(h).toUpperCase(), x, y);
    x += 120;
  });
  y += 14; doc.setLineWidth(.5); doc.line(margin, y, 555, y); y += 10;
  doc.setFont(undefined,"normal");

  rows.forEach(r=>{
    let xx = margin;
    headers.forEach(h=>{
      doc.text(String(r[h] ?? ""), xx, y, { maxWidth: 110 });
      xx += 120;
    });
    y += 16;
    if(y > 780){ doc.addPage(); y = margin; }
  });

  doc.save(filename);
}
