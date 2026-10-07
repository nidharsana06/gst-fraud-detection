const API = "/api";
let currentRiskFilter = "";
let allInvoices = [];
let donutChart, trendChart;

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

async function loadSummary() {
  try {
    const res = await fetch(`${API}/dashboard/summary`);
    const s = await res.json();
    document.getElementById("statTotal").textContent = s.total_invoices;
    document.getElementById("statTotalSub").textContent =
      s.total_invoices ? `${fmtMoney(s.total_taxable_value)} total taxable value` : "—";
    document.getElementById("statAvg").textContent = s.avg_fraud_score;
    document.getElementById("statHigh").textContent = s.by_risk_category.High || 0;
    document.getElementById("statHighSub").textContent = `${fmtMoney(s.total_high_risk_amount)} flagged`;
    document.getElementById("statFail").textContent = s.failed_validation_count;

    document.getElementById("legLow").textContent = s.by_risk_category.Low || 0;
    document.getElementById("legMed").textContent = s.by_risk_category.Medium || 0;
    document.getElementById("legHigh").textContent = s.by_risk_category.High || 0;

    renderDonut(s.by_risk_category);
    renderTrend(s.trend);
  } catch (e) {
    console.error(e);
  }
}

async function loadInvoices() {
  try {
    const url = currentRiskFilter ? `${API}/invoices?risk=${currentRiskFilter}` : `${API}/invoices`;
    const res = await fetch(url);
    allInvoices = await res.json();
    renderLedger(allInvoices);
  } catch (e) {
    console.error(e);
  }
}

// ---------- rendering ----------
function renderLedger(rows) {
  const body = document.getElementById("ledgerBody");
  const empty = document.getElementById("emptyState");
  body.innerHTML = "";
  if (!rows.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="inv-no">${r.invoice_no || "—"}</td>
      <td class="gstin-cell">${r.vendor_gstin || "—"}</td>
      <td>${r.invoice_date || "—"}</td>
      <td class="amount-cell">${fmtMoney(r.total_amount)}</td>
      <td><span class="stamp ${riskClass(r.risk_category)}">${r.risk_category}</span></td>
    `;
    tr.addEventListener("click", () => openModal(r));
    body.appendChild(tr);
  }
}

function renderDonut(byRisk) {
  const ctx = document.getElementById("riskDonut");
  const data = [byRisk.Low || 0, byRisk.Medium || 0, byRisk.High || 0];
  if (donutChart) { donutChart.data.datasets[0].data = data; donutChart.update(); return; }
  donutChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Low", "Medium", "High"],
      datasets: [{ data, backgroundColor: ["#2f6e52", "#b3811f", "#ad3628"], borderWidth: 0 }],
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
        data, borderColor: "#1f3a5f", backgroundColor: "rgba(31,58,95,0.08)",
        fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, grid: { color: "#eceef2" }, ticks: { font: { size: 10 } } },
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
  btn.classList.add("active");
  currentRiskFilter = btn.dataset.risk;
  loadInvoices();
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

// ---------- init ----------
refreshAll();

// ---------- intelligence panels ----------
let typChart, netAnim;
const riskColor = (s) => (s >= 70 ? "#ad3628" : s >= 40 ? "#b3811f" : "#2f6e52");

async function loadIntel() {
  try {
    const [m, v, n] = await Promise.all(["model/metrics", "vendors/risk", "network"].map((p) => fetch(`${API}/${p}`).then((r) => r.json())));
    renderMetrics(m); renderVendors(v); renderNetwork(n);
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
    data: { labels: labels.map((l) => l.replace(/_/g, " ")), datasets: [{ data, backgroundColor: "#1f3a5f", borderRadius: 4 }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, title: { display: true, text: "ML-only recall by fraud typology (%)", font: { size: 11 } } },
      scales: { x: { min: 0, max: 100, grid: { color: "#eceef2" } }, y: { grid: { display: false } } } },
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
    Chart.defaults.color = root.dataset.theme === "dark" ? "#8d9ab8" : "#5b6472";
  };
  if (root.dataset.theme === "dark") Chart.defaults.color = "#8d9ab8";

  // animated count-up whenever a stat value changes
  document.querySelectorAll(".stat-value").forEach((el) => {
    let busy = false;
    new MutationObserver(() => {
      if (busy) return; const to = parseFloat(el.textContent); if (isNaN(to)) return;
      busy = true; const t0 = performance.now(), dec = String(el.textContent).includes(".") ? 1 : 0;
      (function f(t) { const p = Math.min((t - t0) / 700, 1); el.textContent = (to * (1 - Math.pow(1 - p, 3))).toFixed(dec);
        if (p < 1) requestAnimationFrame(f); else { el.textContent = to.toFixed(dec); busy = false; } })(t0);
    }).observe(el, { childList: true });
  });

  // circular risk gauge inside the invoice modal
  const _open = openModal;
  openModal = function (inv) {
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
