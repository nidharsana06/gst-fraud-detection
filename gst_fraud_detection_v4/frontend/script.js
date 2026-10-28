const API = "/api";
let currentRiskFilter = "";
let allInvoices = [];
let donutChart, trendChart, complianceChart, exposureChart, vendorChart, taxMixChart, dateRiskChart, reasonChart;
let currentPage = 1;
const PAGE_SIZE = 8;
let vendorRows = [];

// ---------- utils ----------
function fmtMoney(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function showToast(msg, isErr) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  setTimeout(() => { t.className = "toast"; }, 3200);
}
function riskClass(r) { return (r || "Low").toLowerCase(); }

function tickClock() {
  const el = document.getElementById("clock");
  el.textContent = new Date().toLocaleString("en-IN", {
    dateStyle: "medium", timeStyle: "short",
  });
}
setInterval(tickClock, 1000 * 30);
tickClock();

// ---------- data loading ----------
async function refreshAll() {
  await Promise.all([loadSummary(), loadInvoices()]);
}

function animateNumeric(el, target, options = {}) {
  if (!el) return;
  const prefix = options.prefix || "", suffix = options.suffix || "";
  const decimals = options.decimals ?? 0;
  const from = Number(el.dataset.numericValue ?? 0) || 0;
  const to = Number(target) || 0;
  el.dataset.numericValue = String(to);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = `${prefix}${to.toLocaleString("en-IN", {minimumFractionDigits:decimals, maximumFractionDigits:decimals})}${suffix}`;
    return;
  }
  const started = performance.now(), duration = 520;
  const step = now => {
    const p = Math.min(1, (now - started) / duration), eased = 1 - Math.pow(1-p, 3);
    const value = from + (to - from) * eased;
    el.textContent = `${prefix}${value.toLocaleString("en-IN", {minimumFractionDigits:decimals, maximumFractionDigits:decimals})}${suffix}`;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function loadSummary() {
  try {
    const res = await fetch(`${API}/dashboard/summary`);
    if (!res.ok) throw new Error(`Dashboard request failed (${res.status})`);
    const s = await res.json();
    const risk = s.by_risk_category || {};
    animateNumeric(document.getElementById("statTotal"), s.total_invoices || 0);
    document.getElementById("statTotalSub").textContent = s.total_invoices ? `${fmtMoney(s.total_taxable_value)} total taxable value` : "No invoices yet";
    animateNumeric(document.getElementById("statAvg"), s.avg_fraud_score || 0, {decimals:1});
    animateNumeric(document.getElementById("statHigh"), risk.High || 0);
    document.getElementById("statHighSub").textContent = `${fmtMoney(s.total_high_risk_amount)} flagged for review`;
    animateNumeric(document.getElementById("statFail"), s.failed_validation_count || 0);
    document.getElementById("legLow").textContent = risk.Low || 0;
    document.getElementById("legMed").textContent = risk.Medium || 0;
    document.getElementById("legHigh").textContent = risk.High || 0;
    renderDonut(risk);
    renderTrend(Array.isArray(s.trend) ? s.trend : []);
  } catch (e) {
    console.error("Could not load dashboard summary:", e);
    showToast("Dashboard totals could not load. Check that the backend is running.", true);
  }
}

async function loadInvoices() {
  try {
    const res = await fetch(`${API}/invoices?limit=5000`);
    allInvoices = await res.json();
    currentPage = 1;
    renderLedger();
    renderInsightReports();
  } catch (e) {
    console.error(e);
  }
}

// ---------- rendering ----------
function getVisibleInvoices() {
  const query = (document.getElementById("invoiceSearch")?.value || "").trim().toLowerCase();
  const sort = document.getElementById("invoiceSort")?.value || "recent";
  const rows = allInvoices.filter(r => {
    const riskOK = !currentRiskFilter || r.risk_category === currentRiskFilter;
    const haystack = [r.invoice_no, r.vendor_name, r.vendor_gstin, r.buyer_gstin, r.invoice_date].join(" ").toLowerCase();
    return riskOK && (!query || haystack.includes(query));
  });
  rows.sort((a,b) => sort === "score" ? (b.fraud_score||0)-(a.fraud_score||0) : sort === "amount" ? (b.total_amount||0)-(a.total_amount||0) : sort === "date" ? String(b.invoice_date||"").localeCompare(String(a.invoice_date||"")) : (b.id||0)-(a.id||0));
  return rows;
}
function renderLedger() {
  const body = document.getElementById("ledgerBody"), empty = document.getElementById("emptyState");
  const rows = getVisibleInvoices(), totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE, pageRows = rows.slice(start, start + PAGE_SIZE);
  body.innerHTML = "";
  document.getElementById("resultCount").textContent = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
  document.getElementById("pageInfo").textContent = rows.length ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} of ${rows.length}` : "Showing 0–0";
  document.getElementById("prevPage").disabled = currentPage <= 1;
  document.getElementById("nextPage").disabled = currentPage >= totalPages;
  empty.style.display = rows.length ? "none" : "block";
  for (const r of pageRows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><div class="inv-no">${escapeHTML(r.invoice_no || "—")}</div><div class="table-sub">${escapeHTML(r.vendor_name || "Invoice record")}</div></td><td class="gstin-cell">${escapeHTML(r.vendor_gstin || "—")}</td><td>${escapeHTML(r.invoice_date || "—")}</td><td class="amount-cell">${fmtMoney(r.total_amount)}</td><td><span class="stamp ${riskClass(r.risk_category)}">${escapeHTML(r.risk_category || "Unknown")}</span></td>`;
    tr.addEventListener("click", () => openModal(r)); body.appendChild(tr);
  }
}
function escapeHTML(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function renderDonut(byRisk) {
  const ctx = document.getElementById("riskDonut");
  const data = [byRisk.Low || 0, byRisk.Medium || 0, byRisk.High || 0];
  if (donutChart) { donutChart.data.datasets[0].data = data; donutChart.update(); return; }
  donutChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Low", "Medium", "High"],
      datasets: [{ data, backgroundColor: ["#187a54", "#b7791f", "#b93838"], borderWidth: 0 }],
    },
    options: {
      cutout: "68%",
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
    },
  });
}

function renderTrend(trend) {
  const ctx = document.getElementById("trendChart");
  const labels = trend.map((t) => t.invoice_no || "");
  const data = trend.map((t) => t.fraud_score);
  if (trendChart) { trendChart.data.labels = labels; trendChart.data.datasets[0].data = data; trendChart.update(); return; }
  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data, borderColor: "#236b57", backgroundColor: "rgba(35,107,87,0.10)",
        fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, grid: { color: "rgba(130,150,138,.20)" }, ticks: { font: { size: 10 } } },
        x: { display: false },
      },
    },
  });
}

// ---------- filters ----------
document.getElementById("filterPills").addEventListener("click", (e) => {
  const btn = e.target.closest(".pill");
  if (!btn) return;
  document.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active"); currentRiskFilter = btn.dataset.risk; currentPage = 1; renderLedger();
});

// ---------- upload ----------
const fileInput = document.getElementById("fileInput");
const dropzone = document.getElementById("dropzone");
const fileHint = document.getElementById("fileHint");

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) uploadFile(fileInput.files[0]);
});

["dragover", "dragenter"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); })
);
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) uploadFile(f);
});

async function uploadFile(file) {
  fileHint.textContent = file.name;
  const chooseBtn = document.getElementById("chooseBtn");
  const original = chooseBtn.textContent;
  chooseBtn.innerHTML = `<span class="spinner"></span>Processing…`;

  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch(`${API}/upload`, { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Upload failed");
    }
    const result = await res.json();
    showToast(`${result.count} invoice${result.count > 1 ? "s" : ""} processed and scored.`);
    await refreshAll();
  } catch (e) {
    showToast(e.message, true);
  } finally {
    chooseBtn.textContent = original;
    fileInput.value = "";
  }
}

document.getElementById("clearBtn").addEventListener("click", async () => {
  if (!allInvoices.length) { showToast("Ledger is already empty."); return; }
  if (!confirm(`Delete all ${allInvoices.length} invoice(s) from the ledger? This cannot be undone.`)) return;
  try {
    const res = await fetch(`${API}/invoices`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to clear ledger");
    const result = await res.json();
    showToast(`Cleared ${result.deleted} invoice(s).`);
    await refreshAll();
  } catch (e) {
    showToast(e.message, true);
  }
});

document.getElementById("sampleBtn").addEventListener("click", async () => {
  try {
    const res = await fetch("/sample_data/sample_invoices.csv");
    if (!res.ok) throw new Error("Sample file not found — see README for its location.");
    const blob = await res.blob();
    const file = new File([blob], "sample_invoices.csv", { type: "text/csv" });
    uploadFile(file);
  } catch (e) {
    showToast(e.message, true);
  }
});

// ---------- modal ----------
function openModal(inv) {
  document.getElementById("modalInvNo").textContent = inv.invoice_no || "Untitled invoice";
  document.getElementById("modalVendor").textContent = `${inv.vendor_name || "Unknown vendor"} · ${inv.vendor_gstin || "no GSTIN"}`;
  const stamp = document.getElementById("modalStamp");
  stamp.textContent = inv.risk_category + " RISK";
  stamp.className = `stamp stamp-lg ${riskClass(inv.risk_category)}`;

  document.getElementById("modalDetailGrid").innerHTML = [
    ["Fraud score", `${inv.fraud_score} / 100`],
    ["Invoice date", inv.invoice_date || "—"],
    ["Taxable value", fmtMoney(inv.taxable_value)],
    ["Total amount", fmtMoney(inv.total_amount)],
    ["CGST / SGST / IGST", `${fmtMoney(inv.cgst)} / ${fmtMoney(inv.sgst)} / ${fmtMoney(inv.igst)}`],
    ["Buyer GSTIN", inv.buyer_gstin || "—"],
  ].map(([k, v]) => `<div class="detail-item"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

  const checks = (inv.validation_report && inv.validation_report.checks) || [];
  document.getElementById("modalChecks").innerHTML = checks.map((c) => `
    <div class="check-row">
      <span class="check-badge ${c.passed ? "pass" : "fail"}">${c.passed ? "✓" : "✕"}</span>
      <div><div>${c.rule}</div><div class="check-detail">${c.detail}</div></div>
    </div>
  `).join("");

  document.getElementById("modalReasons").innerHTML =
    (inv.reasons || []).map((r) => `<li>${r}</li>`).join("");

  document.getElementById("modalDownload").onclick = () => {
    window.open(`${API}/invoices/${inv.id}/report`, "_blank");
  };

  document.getElementById("modalBackdrop").style.display = "flex";
}
function closeModal() { document.getElementById("modalBackdrop").style.display = "none"; }
document.getElementById("modalClose").addEventListener("click", closeModal);
document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
document.getElementById("modalBackdrop").addEventListener("click", (e) => {
  if (e.target.id === "modalBackdrop") closeModal();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// ---------- searchable ledger, exports and actionable reports ----------
document.getElementById("invoiceSearch").addEventListener("input", () => { currentPage = 1; renderLedger(); });
document.getElementById("invoiceSort").addEventListener("change", () => { currentPage = 1; renderLedger(); });
document.getElementById("prevPage").addEventListener("click", () => { currentPage = Math.max(1, currentPage - 1); renderLedger(); });
document.getElementById("nextPage").addEventListener("click", () => { currentPage += 1; renderLedger(); });
document.getElementById("exportBtn").addEventListener("click", () => {
  const rows = getVisibleInvoices(); if (!rows.length) { showToast("No invoices to export for these filters.", true); return; }
  const cols = ["invoice_no","invoice_date","vendor_name","vendor_gstin","buyer_gstin","taxable_value","cgst","sgst","igst","total_amount","fraud_score","risk_category","validation_passed","reasons"];
  const csvCell = v => `"${String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map(r => cols.map(c => csvCell(r[c])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], {type:"text/csv;charset=utf-8;"})); const a = document.createElement("a"); a.href = url; a.download = "ledger-ai-audit-export.csv"; a.click(); URL.revokeObjectURL(url); showToast(`Exported ${rows.length} invoice records.`);
});

document.getElementById("exportReportsBtn")?.addEventListener("click", () => {
  if (!allInvoices.length) { showToast("Upload or load invoices before exporting reports.", true); return; }
  const cell = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const out = [["Report","Metric","Value","Notes"]];
  const sum = key => allInvoices.reduce((n, r) => n + Number(r[key] || 0), 0);
  const riskCounts = {Low:0,Medium:0,High:0};
  allInvoices.forEach(r => { riskCounts[r.risk_category] = (riskCounts[r.risk_category] || 0) + 1; });
  const failed = allInvoices.filter(r => r.validation_passed === false).length;
  out.push(["Portfolio","Invoices audited",allInvoices.length,"Loaded invoice ledger"]);
  out.push(["Portfolio","Total invoice value",sum("total_amount"),"Sum of recorded invoice totals"]);
  out.push(["Portfolio","Total taxable value",sum("taxable_value"),"Sum of recorded taxable values"]);
  out.push(["Portfolio","Average risk score",(sum("fraud_score")/allInvoices.length).toFixed(2),"0–100 screening score"]);
  out.push(["Portfolio","Rule failure rate",`${(failed/allInvoices.length*100).toFixed(2)}%`,`${failed} invoices failed at least one rule`]);
  ["Low","Medium","High"].forEach(risk=>out.push(["Risk distribution",`${risk} risk invoices`,riskCounts[risk]||0,"Risk category is a screening classification"]));
  ["cgst","sgst","igst"].forEach(k=>out.push(["Tax composition",k.toUpperCase(),sum(k),"Recorded tax fields; verify against source documents"]));
  (vendorRows||[]).forEach(v=>out.push(["Vendor ranking",v.name||v.gstin,`Average score ${v.avg_score}; invoices ${v.invoices}; high-risk ${v.high}; value ${v.amount}`,"Not a legal finding of fraud"]));
  const reasons = {};
  allInvoices.forEach(r=>(Array.isArray(r.reasons)?r.reasons:[]).forEach(reason=>{reasons[reason]=(reasons[reason]||0)+1;}));
  Object.entries(reasons).sort((a,b)=>b[1]-a[1]).forEach(([reason,count])=>out.push(["Risk explanations",reason,count,"Occurrences in model-generated explanations"]));
  const csv = out.map(row=>row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"}));
  const a=document.createElement("a"); a.href=url; a.download="ledger-ai-report-pack.csv"; a.click(); URL.revokeObjectURL(url);
  showToast("Report pack exported.");
});

function renderInsightReports() {
  const rows = allInvoices || [];
  const riskOrder = ["Low", "Medium", "High"], riskColors = ["#10b981", "#f59e0b", "#f43f5e"];
  const totalAmount = rows.reduce((sum, x) => sum + Number(x.total_amount || 0), 0);
  const amounts = riskOrder.map(r => rows.filter(x => x.risk_category === r).reduce((sum,x) => sum + Number(x.total_amount || 0), 0));
  const highRows = rows.filter(x => x.risk_category === "High");
  const failedRows = rows.filter(x => x.validation_passed === false);
  const portfolioEl = document.getElementById("rollupPortfolio");
  if (portfolioEl) portfolioEl.textContent = fmtMoney(totalAmount);
  const exposureEl = document.getElementById("rollupExposure");
  if (exposureEl) exposureEl.textContent = fmtMoney(amounts[2]);
  const exposureSub = document.getElementById("rollupExposureSub");
  if (exposureSub) exposureSub.textContent = `${highRows.length} high-risk invoice(s) · screening signal only`;
  const failureRate = rows.length ? (failedRows.length / rows.length * 100) : 0;
  const failureRateEl = document.getElementById("rollupFailureRate");
  if (failureRateEl) failureRateEl.textContent = `${failureRate.toFixed(1)}%`;
  const failureSub = document.getElementById("rollupFailureSub");
  if (failureSub) failureSub.textContent = `${failedRows.length} of ${rows.length} invoices failed at least one rule`;

  const vendorAmounts = {};
  rows.forEach(inv => {
    const key = inv.vendor_name || inv.vendor_gstin || "Unknown vendor";
    vendorAmounts[key] = (vendorAmounts[key] || 0) + Number(inv.total_amount || 0);
  });
  const topVendor = Object.entries(vendorAmounts).sort((a,b)=>b[1]-a[1])[0];
  const topVendorEl = document.getElementById("rollupTopVendor");
  if (topVendorEl) topVendorEl.textContent = topVendor ? (topVendor[0].length > 18 ? topVendor[0].slice(0,17)+"…" : topVendor[0]) : "—";
  const topVendorSub = document.getElementById("rollupTopVendorSub");
  if (topVendorSub) topVendorSub.textContent = topVendor && totalAmount ? `${(topVendor[1]/totalAmount*100).toFixed(1)}% of recorded invoice value` : "Largest share of invoice value";

  const exposureInsight = document.getElementById("exposureInsight");
  if (exposureInsight) exposureInsight.textContent = rows.length ? `${fmtMoney(amounts[2])} across ${highRows.length} high-risk invoice(s). Risk scores prioritize review; they do not establish fraud.` : "Upload a batch to calculate exposure by risk category.";
  if (exposureChart) exposureChart.destroy();
  if (document.getElementById("exposureChart")) exposureChart = new Chart(document.getElementById("exposureChart"), {type:"bar",data:{labels:riskOrder,datasets:[{label:"Invoice amount",data:amounts,backgroundColor:riskColors,borderRadius:8,maxBarThickness:46}]},options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtMoney(c.raw)}}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v>=100000?`₹${(v/100000).toFixed(1)}L`:v>=1000?`₹${(v/1000).toFixed(0)}k`:`₹${v}`},grid:{color:"rgba(148,163,184,.15)"}},x:{grid:{display:false}}}}});

  const failures = {};
  rows.forEach(inv => ((inv.validation_report && inv.validation_report.checks) || []).forEach(c => { if (!c.passed) failures[c.rule || c.name || "Other check"] = (failures[c.rule || c.name || "Other check"] || 0) + 1; }));
  const failureRows = Object.entries(failures).sort((a,b)=>b[1]-a[1]).slice(0,7);
  const ci = document.getElementById("complianceInsight"); if (ci) ci.textContent = failureRows.length ? `Most frequent exception: ${failureRows[0][0]} (${failureRows[0][1]} failed check(s)).` : (rows.length ? "No failed rule checks recorded in the loaded ledger." : "Upload invoices to reveal the most common compliance exceptions.");
  if (complianceChart) complianceChart.destroy();
  if (document.getElementById("complianceChart")) complianceChart = new Chart(document.getElementById("complianceChart"), {type:"bar",data:{labels:failureRows.length?failureRows.map(x=>x[0]):[rows.length?"No failures":"No data"],datasets:[{data:failureRows.length?failureRows.map(x=>x[1]):[0],backgroundColor:"#818cf8",borderRadius:6,maxBarThickness:24}]},options:{indexAxis:"y",plugins:{legend:{display:false},tooltip:{enabled:!!failureRows.length}},scales:{x:{beginAtZero:true,ticks:{precision:0},grid:{color:"rgba(148,163,184,.15)"}},y:{grid:{display:false}}}}});

  const topVendors = (vendorRows || []).slice(0,6);
  if (vendorChart) vendorChart.destroy();
  if (document.getElementById("vendorChart")) vendorChart = new Chart(document.getElementById("vendorChart"), {type:"bar",data:{labels:topVendors.length?topVendors.map(v=>{const n=v.name || v.gstin || "Unknown";return n.length>18?n.slice(0,17)+"…":n;}):["No vendor data"],datasets:[{data:topVendors.length?topVendors.map(v=>Number(v.avg_score||0)):[0],backgroundColor:topVendors.map(v=>Number(v.avg_score)>=70?"#f43f5e":Number(v.avg_score)>=40?"#f59e0b":"#10b981"),borderRadius:6,maxBarThickness:26}]},options:{indexAxis:"y",plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`Average score: ${c.raw}/100`}}},scales:{x:{min:0,max:100,grid:{color:"rgba(148,163,184,.15)"}},y:{grid:{display:false}}}}});

  const queue = rows.filter(x=>Number(x.fraud_score)>=40 || x.validation_passed===false).sort((a,b)=>(Number(b.fraud_score||0)+(b.validation_passed===false?20:0))-(Number(a.fraud_score||0)+(a.validation_passed===false?20:0))).slice(0,5);
  const q = document.getElementById("priorityQueue"); if (q) q.innerHTML = queue.length ? queue.map((inv,i)=>`<button class="priority-item" data-id="${Number(inv.id)}"><span class="priority-rank">${i+1}</span><span class="priority-main"><b>${escapeHTML(inv.invoice_no || "Untitled invoice")}</b><small>${escapeHTML(inv.vendor_name || inv.vendor_gstin || "Unknown vendor")} · ${inv.validation_passed===false?"Compliance failed":"Risk signal detected"}</small></span><span class="stamp ${riskClass(inv.risk_category)}">${Math.round(inv.fraud_score||0)}</span></button>`).join("") : `<div class="empty-report">${rows.length ? "No invoices currently meet the priority threshold. Continue routine monitoring." : "Upload a batch to generate a prioritized review list."}</div>`;
  if (q) q.querySelectorAll(".priority-item").forEach(btn=>btn.addEventListener("click",()=>{const inv=rows.find(x=>Number(x.id)===Number(btn.dataset.id));if(inv)openModal(inv);}));

  const taxTotals = ["cgst","sgst","igst"].map(k => rows.reduce((sum, inv)=>sum+Number(inv[k]||0),0));
  const taxTotal = taxTotals.reduce((a,b)=>a+b,0);
  if (taxMixChart) taxMixChart.destroy();
  if (document.getElementById("taxMixChart")) taxMixChart = new Chart(document.getElementById("taxMixChart"), {type:"doughnut",data:{labels:["CGST","SGST","IGST"],datasets:[{data:taxTotals,backgroundColor:["#6366f1","#14b8a6","#f59e0b"],borderWidth:0}]},options:{cutout:"62%",plugins:{legend:{position:"bottom"},tooltip:{callbacks:{label:c=>`${c.label}: ${fmtMoney(c.raw)}`}}}}});
  const taxMixInsight = document.getElementById("taxMixInsight"); if(taxMixInsight) taxMixInsight.textContent = rows.length ? `Recorded tax total: ${fmtMoney(taxTotal)}. Values reflect parsed or mapped fields; verify against source invoices.` : "Tax totals update from the ledger.";

  const averageByRisk = riskOrder.map(r=>{const group=rows.filter(x=>x.risk_category===r);return group.length?group.reduce((sum,x)=>sum+Number(x.total_amount||0),0)/group.length:0;});
  if(dateRiskChart) dateRiskChart.destroy();
  if(document.getElementById("dateRiskChart")) dateRiskChart = new Chart(document.getElementById("dateRiskChart"), {type:"bar",data:{labels:riskOrder,datasets:[{label:"Average invoice value",data:averageByRisk,backgroundColor:riskColors,borderRadius:8,maxBarThickness:42}]},options:{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtMoney(c.raw)}}},scales:{y:{beginAtZero:true,ticks:{callback:v=>v>=100000?`₹${(v/100000).toFixed(1)}L`:v>=1000?`₹${(v/1000).toFixed(0)}k`:`₹${v}`},grid:{color:"rgba(148,163,184,.15)"}},x:{grid:{display:false}}}}});
  const valueRiskInsight = document.getElementById("valueRiskInsight"); if(valueRiskInsight) valueRiskInsight.textContent = rows.length ? `Average recorded invoice value: Low ${fmtMoney(averageByRisk[0])} · Medium ${fmtMoney(averageByRisk[1])} · High ${fmtMoney(averageByRisk[2])}.` : "Average invoice values update from the ledger.";

  const reasonCounts = {};
  rows.forEach(inv => (Array.isArray(inv.reasons)?inv.reasons:[]).forEach(reason=>{const label=String(reason||"Other signal").trim().split(/[.:;]/)[0].slice(0,64)||"Other signal";reasonCounts[label]=(reasonCounts[label]||0)+1;}));
  const reasonRows=Object.entries(reasonCounts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if(reasonChart) reasonChart.destroy();
  if(document.getElementById("reasonChart")) reasonChart = new Chart(document.getElementById("reasonChart"), {type:"bar",data:{labels:reasonRows.length?reasonRows.map(x=>x[0]):[rows.length?"No reasons returned":"No data"],datasets:[{data:reasonRows.length?reasonRows.map(x=>x[1]):[0],backgroundColor:"#0ea5e9",borderRadius:6,maxBarThickness:24}]},options:{indexAxis:"y",plugins:{legend:{display:false},tooltip:{enabled:!!reasonRows.length}},scales:{x:{beginAtZero:true,ticks:{precision:0},grid:{color:"rgba(148,163,184,.15)"}},y:{grid:{display:false}}}}});
  const reasonInsight=document.getElementById("reasonInsight"); if(reasonInsight) reasonInsight.textContent=reasonRows.length?`Most common explanation: ${reasonRows[0][0]} (${reasonRows[0][1]} occurrence(s)). These are model/rule signals for human review.`:(rows.length?"No reason strings were returned for these assessments.":"Reason frequencies update from invoice assessments.");
}

// ---------- init ----------
refreshAll();

// ---------- intelligence panels ----------
let typChart, netAnim;
const riskColor = (s) => (s >= 70 ? "#b93838" : s >= 40 ? "#b7791f" : "#187a54");

async function loadIntel() {
  try {
    const [m, v] = await Promise.all(["model/metrics", "vendors/risk"].map((p) => fetch(`${API}/${p}`).then((r) => r.json())));
    vendorRows = v; renderMetrics(m); renderVendors(v); renderInsightReports();
  } catch (e) { console.error(e); }
}

function renderMetrics(m) {
  const row = document.getElementById("metricRow");
  if (!m.available) {
    row.innerHTML = '<div class="note" style="grid-column:1/-1">No validation metrics yet. Run <code>python data_pipeline.py</code> then <code>python train_model.py</code> to train on the real dataset and populate this panel.</div>';
    return;
  }
  document.getElementById("mSrc").textContent = m.source;
  const pct = (x) => (x * 100).toFixed(1) + "%";
  row.innerHTML = [["ROC-AUC", m.roc_auc], ["PR-AUC", m.pr_auc], ["Hybrid recall", pct(m.hybrid_recall)], ["False-positive rate", pct(m.hybrid_false_positive_rate)]]
    .map(([k, v]) => `<div class="metric"><b>${v}</b><span>${k}</span></div>`).join("");
  const t = m.recall_by_typology_ml_only, labels = Object.keys(t);
  const data = labels.map((k) => t[k] * 100);
  if (typChart) typChart.destroy();
  typChart = new Chart(document.getElementById("typChart"), {
    type: "bar",
    data: { labels: labels.map((l) => l.replace(/_/g, " ")), datasets: [{ data, backgroundColor: "#236b57", borderRadius: 4 }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, title: { display: true, text: "ML-only recall by fraud typology (%)", font: { size: 11 } } },
      scales: { x: { min: 0, max: 100, grid: { color: "rgba(130,150,138,.20)" } }, y: { grid: { display: false } } } },
  });
}

function renderVendors(rows) {
  document.getElementById("vendorBody").innerHTML = rows.length ? rows.map((r) => `<tr>
    <td><div class="inv-no">${r.name || "—"}</div><div class="gstin-cell">${r.gstin}</div></td><td>${r.invoices}</td><td>${r.high}</td>
    <td class="amount-cell"><span class="stamp ${r.avg_score >= 70 ? "high" : r.avg_score >= 40 ? "medium" : "low"}">${r.avg_score}</span></td></tr>`).join("")
    : '<tr><td colspan="4" class="note">Upload invoices to rank vendors.</td></tr>';
}

function renderNetwork(g) {
  const cv = document.getElementById("netCanvas"), ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  cancelAnimationFrame(netAnim);
  if (!g.nodes.length) { ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#5b6472"; ctx.fillText("Upload invoices to build the network.", 20, 30); return; }
  const idx = {}; g.nodes.forEach((n, i) => { idx[n.id] = i; n.x = W / 2 + Math.cos(i) * 120; n.y = H / 2 + Math.sin(i) * 90; n.vx = n.vy = 0; });
  let tick = 0;
  (function step() {
    for (const a of g.nodes) { a.vx += (W / 2 - a.x) * 0.002; a.vy += (H / 2 - a.y) * 0.002;
      for (const b of g.nodes) if (a !== b) { const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 40; a.vx += (dx / d2) * 30; a.vy += (dy / d2) * 30; } }
    for (const e of g.edges) { const a = g.nodes[idx[e.source]], b = g.nodes[idx[e.target]], dx = b.x - a.x, dy = b.y - a.y;
      a.vx += dx * 0.004; a.vy += dy * 0.004; b.vx -= dx * 0.004; b.vy -= dy * 0.004; }
    for (const n of g.nodes) { n.x = Math.max(14, Math.min(W - 14, n.x + (n.vx *= 0.82))); n.y = Math.max(14, Math.min(H - 14, n.y + (n.vy *= 0.82))); }
    ctx.clearRect(0, 0, W, H); ctx.strokeStyle = "#c9cfd8";
    for (const e of g.edges) { const a = g.nodes[idx[e.source]], b = g.nodes[idx[e.target]]; ctx.lineWidth = Math.min(1 + e.n * 0.3, 4); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (const n of g.nodes) { ctx.fillStyle = riskColor(n.risk); ctx.beginPath(); ctx.arc(n.x, n.y, n.kind === "buyer" ? 11 : 6 + Math.min(n.count, 6), 0, 7); ctx.fill();
      if (n.kind === "buyer") { ctx.fillStyle = "#fff"; ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.fillText("BUYER", n.x, n.y + 3); } }
    if (++tick < 220) netAnim = requestAnimationFrame(step);
  })();
}

const _refresh = refreshAll;
refreshAll = async function () { await _refresh(); loadIntel(); };
loadIntel();

// ---------- v2.1 polish: theme, count-up, risk gauge ----------
(function () {
  const root = document.documentElement, saved = localStorage.getItem("theme");
  if (saved) root.dataset.theme = saved;
  document.getElementById("themeBtn").onclick = () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("theme", root.dataset.theme);
    Chart.defaults.color = root.dataset.theme === "dark" ? "#a1b0a7" : "#6d7a73";
  };
  if (root.dataset.theme === "dark") Chart.defaults.color = "#a1b0a7";

  // circular risk gauge inside the invoice modal
  const _open = openModal;
  openModal = function (inv) {
    document.querySelectorAll(".gauge").forEach(el => el.remove());
    _open(inv);
    const s = Math.max(0, Math.min(100, inv.fraud_score || 0)), c = riskColor(s), R = 34, C = 2 * Math.PI * R;
    const g = document.createElement("div"); g.className = "gauge";
    g.innerHTML = `<svg width="86" height="86" viewBox="0 0 86 86"><circle cx="43" cy="43" r="${R}" fill="none" stroke="var(--line)" stroke-width="8"/>
      <circle cx="43" cy="43" r="${R}" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round" transform="rotate(-90 43 43)"
      stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition:stroke-dashoffset 1s ease"/>
      <text x="43" y="48" text-anchor="middle" font-size="18" font-weight="700" fill="${c}">${Math.round(s)}</text></svg>
      <div class="g-txt"><b>${inv.risk_category} risk</b><span>${(inv.reasons || [])[0] || ""}</span></div>`;
    document.getElementById("modalDetailGrid").prepend(g);
    requestAnimationFrame(() => requestAnimationFrame(() => g.querySelectorAll("circle")[1].style.strokeDashoffset = C * (1 - s / 100)));
  };
})();
