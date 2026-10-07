"""
Anomaly-detection layer: engineers numeric features from an invoice +
its GST validation report, then scores it with a pre-trained
Isolation Forest to produce an explainable fraud risk score.
"""
import os
import joblib
import numpy as np
import pandas as pd
from datetime import datetime

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "models")
MODEL_PATH = os.path.join(MODEL_DIR, "isolation_forest.joblib")
SCALER_PATH = os.path.join(MODEL_DIR, "scaler.joblib")

FEATURE_NAMES = [
    "tax_diff", "gst_rate", "amount_log", "is_round_amount",
    "mandatory_missing_count", "gstin_invalid_flag", "tax_calc_invalid_flag",
    "is_duplicate", "invoice_no_numeric_len", "weekend_flag",
]

_model = None
_scaler = None


def _load():
    global _model, _scaler
    if _model is None:
        _model = joblib.load(MODEL_PATH)
        _scaler = joblib.load(SCALER_PATH)
    return _model, _scaler


def engineer_features(invoice: dict, validation_report: dict) -> dict:
    taxable_value = float(invoice.get("taxable_value") or 0)
    cgst = float(invoice.get("cgst") or 0)
    sgst = float(invoice.get("sgst") or 0)
    igst = float(invoice.get("igst") or 0)
    total = float(invoice.get("total_amount") or 0)

    tax_diff = validation_report.get("tax_diff")
    if tax_diff is None:
        tax_diff = abs((taxable_value + cgst + sgst + igst) - total)

    gst_rate = round(((cgst + sgst + igst) / taxable_value) * 100, 2) if taxable_value > 0 else 0

    amount_log = np.log1p(max(total, 0))
    is_round_amount = 1 if total > 0 and total % 1000 == 0 else 0

    checks = {c["rule"]: c["passed"] for c in validation_report.get("checks", [])}
    mandatory_missing_count = 0 if checks.get("Mandatory field check", True) else 1
    gstin_invalid_flag = 0 if (checks.get("Vendor GSTIN format check", True) and
                                checks.get("Buyer GSTIN format check", True)) else 1
    tax_calc_invalid_flag = 0 if checks.get("Tax calculation check", True) else 1
    is_duplicate = 1 if validation_report.get("is_duplicate") else 0

    invoice_no = str(invoice.get("invoice_no", "") or "")
    invoice_no_numeric_len = sum(c.isdigit() for c in invoice_no)

    weekend_flag = 0
    date_str = invoice.get("invoice_date")
    if date_str:
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
            try:
                dt = datetime.strptime(str(date_str), fmt)
                weekend_flag = 1 if dt.weekday() >= 5 else 0
                break
            except ValueError:
                continue

    return {
        "tax_diff": tax_diff,
        "gst_rate": gst_rate,
        "amount_log": amount_log,
        "is_round_amount": is_round_amount,
        "mandatory_missing_count": mandatory_missing_count,
        "gstin_invalid_flag": gstin_invalid_flag,
        "tax_calc_invalid_flag": tax_calc_invalid_flag,
        "is_duplicate": is_duplicate,
        "invoice_no_numeric_len": invoice_no_numeric_len,
        "weekend_flag": weekend_flag,
    }


def score_invoice(invoice: dict, validation_report: dict) -> dict:
    """Returns fraud score (0-100, higher = riskier), risk category, and top contributing factors."""
    model, scaler = _load()
    features = engineer_features(invoice, validation_report)
    X = pd.DataFrame([features])[FEATURE_NAMES]
    X_scaled = scaler.transform(X)

    raw_score = model.decision_function(X_scaled)[0]  # higher = more normal
    is_outlier = model.predict(X_scaled)[0] == -1

    # Map decision_function (~ -0.5..0.5) to a 0-100 risk score, higher = riskier
    risk_score = float(np.clip((0.5 - raw_score) * 100, 0, 100))

    # Rule violations always push risk up regardless of model, for explainability/safety
    if not validation_report.get("passed", True):
        risk_score = max(risk_score, 65)
    if validation_report.get("is_duplicate"):
        risk_score = max(risk_score, 90)

    if risk_score >= 70:
        category = "High"
    elif risk_score >= 40:
        category = "Medium"
    else:
        category = "Low"

    reasons = []
    if features["is_duplicate"]:
        reasons.append("Duplicate invoice detected")
    if features["tax_calc_invalid_flag"]:
        reasons.append("Tax calculation inconsistent with declared total")
    if features["gstin_invalid_flag"]:
        reasons.append("Invalid GSTIN format")
    if features["mandatory_missing_count"]:
        reasons.append("Missing mandatory invoice fields")
    if features["is_round_amount"]:
        reasons.append("Suspiciously round total amount")
    if features["gst_rate"] not in (0, 5, 12, 18, 28):
        reasons.append(f"Unusual effective GST rate ({features['gst_rate']}%)")
    if is_outlier and not reasons:
        reasons.append("Statistical anomaly vs. typical invoice patterns")
    if not reasons:
        reasons.append("No significant risk factors detected")

    return {
        "fraud_score": round(risk_score, 2),
        "risk_category": category,
        "is_outlier": bool(is_outlier),
        "reasons": reasons,
        "features": features,
    }
