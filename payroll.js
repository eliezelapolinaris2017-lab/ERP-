// payroll.js – lógica del módulo de nómina (exportación PDF y helpers UI)
import { formatMoney } from "./app.js";

export function computeNet(gross, retentionPct, extraDeductionsPct = 0){
  const ret = (Number(retentionPct) || 0) / 100;
  const ded = (Number(extraDeductionsPct) || 0) / 100;
  const net = Number(gross) * (1 - ret) * (1 - ded);
  return isFinite(net) ? net : 0;
}

export function bindPayrollAutoCalc(){
  const gross = document.getElementById("emp-gross");
  const ret = document.getElementById("emp-ret");
  const ded = document.getElementById("emp-deductions");
  const net = document.getElementById("emp-net");
  const recalc = () => {
    const value = computeNet(gross.value, ret.value, ded.value);
    net.value = formatMoney(value);
  };
  [gross, ret, ded].forEach(el=>el.addEventListener("input", recalc));
  recalc();
}

export async function exportPayrollPDF(rows){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = 48;
  doc.setFontSize(16);
  doc.text("Reporte Nómina", 40, y);
  y += 20;
  doc.setFontSize(10);
  doc.text("Empleado     Fecha        Bruto        Ret%   Ded%    Neto", 40, y);
  y += 10;
  doc.setLineWidth(.2); doc.line(40, y, 555, y); y += 12;

  rows.forEach(r=>{
    const line = [
      (r.employee||"").padEnd(12).slice(0,12),
      (r.date||"").padEnd(10).slice(0,10),
      formatMoney(r.gross).padStart(10),
      String(r.retentionPct||0).padStart(5),
      String(r.deductionsPct||0).padStart(5),
      formatMoney(r.net).padStart(10),
    ].join("   ");
    doc.text(line, 40, y);
    y+=16;
    if(y>780){ doc.addPage(); y=48; }
  });

  doc.save(`nomina_${new Date().toISOString().slice(0,10)}.pdf`);
}

export async function exportLedgerPDF(rows){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });
  let y=48;
  doc.setFontSize(16); doc.text("Libro Mayor", 40, y); y+=20;
  doc.setFontSize(10);
  doc.text("Tipo    Descripción                 Cat        Monto       Fecha", 40, y); y+=10;
  doc.setLineWidth(.2); doc.line(40,y,555,y); y+=12;

  rows.forEach(r=>{
    const line = [
      (r.type||"").padEnd(6).slice(0,6),
      (r.desc||"").padEnd(24).slice(0,24),
      (r.category||"").padEnd(8).slice(0,8),
      formatMoney(r.amount||0).padStart(10),
      (r.date||"").padEnd(10).slice(0,10)
    ].join("   ");
    doc.text(line, 40, y); y+=16;
    if(y>780){ doc.addPage(); y=48; }
  });

  doc.save(`libro_${new Date().toISOString().slice(0,10)}.pdf`);
}
