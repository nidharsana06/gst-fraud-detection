import os
import json
import shutil
import tempfile
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse, Response, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db, get_session, Invoice
from app.ocr_parser import parse_invoice_file
from app.gst_validator import run_full_validation
from app.fraud_model import score_invoice
from app.report_generator import generate_invoice_report

app = FastAPI(title="AI-Powered GST Invoice Fraud Detection System")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

init_db()

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")


@app.get("/")
def root():
    return RedirectResponse(url="/app/")


def _process_single_invoice(raw_fields: dict, filename: str, session):
    existing = [
        {"id": i.id, "invoice_no": i.invoice_no, "vendor_gstin": i.vendor_gstin}
        for i in session.query(Invoice).all()
    ]
    validation_report = run_full_validation(raw_fields, existing)
    fraud_result = score_invoice(raw_fields, validation_report)

    record = Invoice(
        filename=filename,
        invoice_no=str(raw_fields.get("invoice_no", "") or ""),
        invoice_date=str(raw_fields.get("invoice_date", "") or ""),
        vendor_name=str(raw_fields.get("vendor_name", "") or ""),
        vendor_gstin=str(raw_fields.get("vendor_gstin", "") or ""),
        buyer_gstin=str(raw_fields.get("buyer_gstin", "") or ""),
        taxable_value=float(raw_fields.get("taxable_value") or 0),
        cgst=float(raw_fields.get("cgst") or 0),
        sgst=float(raw_fields.get("sgst") or 0),
        igst=float(raw_fields.get("igst") or 0),
        total_amount=float(raw_fields.get("total_amount") or 0),
        validation_passed=validation_report["passed"],
        validation_report_json=json.dumps(validation_report),
        fraud_score=fraud_result["fraud_score"],
        risk_category=fraud_result["risk_category"],
        reasons_json=json.dumps(fraud_result["reasons"]),
        uploaded_at=datetime.utcnow(),
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return record.to_dict()


@app.post("/api/upload")
async def upload_invoice(file: UploadFile = File(...)):
    """Accepts PDF, PNG/JPG, XLSX/XLS, or CSV. Excel/CSV files may contain
    multiple invoice rows and will be processed as a batch."""
    suffix = "." + file.filename.rsplit(".", 1)[-1].lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        invoices_raw = parse_invoice_file(tmp_path, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        os.unlink(tmp_path)

    if not invoices_raw:
        raise HTTPException(status_code=400, detail="No invoice data could be extracted from the file.")

    session = get_session()
    try:
        results = [_process_single_invoice(row, file.filename, session) for row in invoices_raw]
    finally:
        session.close()

    return {"count": len(results), "invoices": results}


@app.get("/api/invoices")
def list_invoices(risk: str = None, limit: int = 200):
    session = get_session()
    try:
        q = session.query(Invoice).order_by(Invoice.uploaded_at.desc())
        if risk:
            q = q.filter(Invoice.risk_category == risk)
        rows = q.limit(limit).all()
        return [r.to_dict() for r in rows]
    finally:
        session.close()


@app.get("/api/invoices/{invoice_id}")
def get_invoice(invoice_id: int):
    session = get_session()
    try:
        row = session.query(Invoice).filter(Invoice.id == invoice_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Invoice not found")
        return row.to_dict()
    finally:
        session.close()


@app.delete("/api/invoices")
def delete_all_invoices():
    session = get_session()
    try:
        count = session.query(Invoice).delete()
        session.commit()
        return {"status": "cleared", "deleted": count}
    finally:
        session.close()


@app.delete("/api/invoices/{invoice_id}")
def delete_invoice(invoice_id: int):
    session = get_session()
    try:
        row = session.query(Invoice).filter(Invoice.id == invoice_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Invoice not found")
        session.delete(row)
        session.commit()
        return {"status": "deleted"}
    finally:
        session.close()


@app.get("/api/invoices/{invoice_id}/report")
def download_report(invoice_id: int):
    session = get_session()
    try:
        row = session.query(Invoice).filter(Invoice.id == invoice_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Invoice not found")
        pdf_bytes = generate_invoice_report(row.to_dict())
    finally:
        session.close()
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=audit_report_{invoice_id}.pdf"}
    )


@app.get("/api/dashboard/summary")
def dashboard_summary():
    session = get_session()
    try:
        rows = session.query(Invoice).all()
        total = len(rows)
        by_risk = {"Low": 0, "Medium": 0, "High": 0}
        total_taxable = 0.0
        total_flagged_amount = 0.0
        failed_validation = 0
        for r in rows:
            by_risk[r.risk_category] = by_risk.get(r.risk_category, 0) + 1
            total_taxable += r.taxable_value or 0
            if r.risk_category == "High":
                total_flagged_amount += r.total_amount or 0
            if not r.validation_passed:
                failed_validation += 1

        avg_score = sum(r.fraud_score for r in rows) / total if total else 0
        recent = sorted(rows, key=lambda r: r.uploaded_at or datetime.min)[-30:]
        trend = [{"invoice_no": r.invoice_no, "fraud_score": r.fraud_score,
                  "uploaded_at": r.uploaded_at.isoformat() if r.uploaded_at else None} for r in recent]

        return {
            "total_invoices": total,
            "by_risk_category": by_risk,
            "avg_fraud_score": round(avg_score, 2),
            "failed_validation_count": failed_validation,
            "total_taxable_value": round(total_taxable, 2),
            "total_high_risk_amount": round(total_flagged_amount, 2),
            "trend": trend,
        }
    finally:
        session.close()


@app.get("/api/model/metrics")
def model_metrics():
    path = os.path.join(os.path.dirname(__file__), "..", "models", "metrics.json")
    if not os.path.exists(path):
        return {"available": False}
    return {"available": True, **json.load(open(path))}


@app.get("/api/vendors/risk")
def vendors_risk(limit: int = 10):
    session = get_session()
    try:
        agg = {}
        for r in session.query(Invoice).all():
            v = agg.setdefault(r.vendor_gstin or "UNKNOWN", dict(
                gstin=r.vendor_gstin or "UNKNOWN", name=r.vendor_name, invoices=0, high=0, score=0.0, amount=0.0))
            v["invoices"] += 1; v["score"] += r.fraud_score; v["amount"] += r.total_amount or 0
            v["high"] += r.risk_category == "High"
        out = sorted(({**v, "avg_score": round(v["score"] / v["invoices"], 1)} for v in agg.values()),
                     key=lambda v: (v["avg_score"], v["high"]), reverse=True)
        return out[:limit]
    finally:
        session.close()


@app.get("/api/network")
def network(limit: int = 40):
    """Vendor -> buyer graph; node risk = worst invoice score. Surfaces clusters of risky counterparties."""
    session = get_session()
    try:
        nodes, edges = {}, {}
        for r in session.query(Invoice).all():
            for g, kind in ((r.vendor_gstin, "vendor"), (r.buyer_gstin, "buyer")):
                if g:
                    n = nodes.setdefault(g, dict(id=g, kind=kind, risk=0.0, count=0))
                    n["risk"] = max(n["risk"], r.fraud_score); n["count"] += 1
            if r.vendor_gstin and r.buyer_gstin:
                e = edges.setdefault((r.vendor_gstin, r.buyer_gstin), dict(source=r.vendor_gstin, target=r.buyer_gstin, n=0))
                e["n"] += 1
        keep = {n["id"] for n in sorted(nodes.values(), key=lambda n: -n["risk"])[:limit]}
        return {"nodes": [n for n in nodes.values() if n["id"] in keep],
                "edges": [e for e in edges.values() if e["source"] in keep and e["target"] in keep]}
    finally:
        session.close()


@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


SAMPLE_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "sample_data")
if os.path.isdir(SAMPLE_DATA_DIR):
    app.mount("/sample_data", StaticFiles(directory=SAMPLE_DATA_DIR), name="sample_data")

if os.path.isdir(FRONTEND_DIR):
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
