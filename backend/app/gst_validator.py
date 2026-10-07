"""
GST compliance validation rules:
- GSTIN format & checksum verification
- Tax calculation validation (CGST+SGST+IGST vs total)
- Duplicate invoice detection
- Mandatory field validation
- Valid GST rate check
"""
import re
from datetime import datetime

GSTIN_REGEX = re.compile(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[A-Z0-9]{1}$')
VALID_GST_RATES = [0, 0.25, 3, 5, 12, 18, 28]
MANDATORY_FIELDS = ["invoice_no", "invoice_date", "vendor_gstin", "buyer_gstin",
                     "taxable_value", "total_amount"]

STATE_CODES = {
    "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
    "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
    "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
    "24": "Gujarat", "25": "Daman & Diu", "26": "Dadra & Nagar Haveli", "27": "Maharashtra",
    "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
    "34": "Puducherry", "35": "Andaman & Nicobar", "36": "Telangana", "37": "Andhra Pradesh",
}


def validate_gstin(gstin: str):
    """Validate GSTIN structure & state code. Returns (is_valid, reason)."""
    if not gstin:
        return False, "GSTIN missing"
    gstin = gstin.strip().upper()
    if len(gstin) != 15:
        return False, f"GSTIN length is {len(gstin)}, expected 15"
    if not GSTIN_REGEX.match(gstin):
        return False, "GSTIN does not match required format"
    state_code = gstin[:2]
    if state_code not in STATE_CODES:
        return False, f"Unknown state code '{state_code}' in GSTIN"
    return True, "Valid"


def validate_tax_calculation(taxable_value, cgst, sgst, igst, total_amount, tolerance=1.0):
    """Check total = taxable_value + cgst + sgst + igst (within tolerance ₹1)."""
    try:
        taxable_value, cgst, sgst, igst, total_amount = [
            float(x or 0) for x in (taxable_value, cgst, sgst, igst, total_amount)
        ]
    except (TypeError, ValueError):
        return False, "Non-numeric tax fields", None

    computed_total = taxable_value + cgst + sgst + igst
    diff = abs(computed_total - total_amount)
    if diff > tolerance:
        return False, f"Computed total ({computed_total:.2f}) != stated total ({total_amount:.2f})", diff

    # Intra-state invoices should use CGST+SGST, not IGST, and vice versa
    if igst > 0 and (cgst > 0 or sgst > 0):
        return False, "Invoice mixes IGST with CGST/SGST (invalid for a single supply)", diff

    if taxable_value > 0:
        effective_rate = round(((cgst + sgst + igst) / taxable_value) * 100, 2)
        closest = min(VALID_GST_RATES, key=lambda r: abs(r - effective_rate))
        if abs(closest - effective_rate) > 0.5:
            return False, f"Effective GST rate {effective_rate}% doesn't match any standard slab", diff

    return True, "Tax calculation consistent", diff


def check_mandatory_fields(invoice: dict):
    missing = [f for f in MANDATORY_FIELDS if not invoice.get(f)]
    return (len(missing) == 0), missing


def check_duplicate(invoice: dict, existing_invoices: list):
    """existing_invoices: list of dicts with invoice_no & vendor_gstin already stored."""
    inv_no = str(invoice.get("invoice_no", "")).strip().lower()
    vendor = str(invoice.get("vendor_gstin", "")).strip().upper()
    for e in existing_invoices:
        if str(e.get("invoice_no", "")).strip().lower() == inv_no and \
           str(e.get("vendor_gstin", "")).strip().upper() == vendor:
            return True, e.get("id")
    return False, None


def validate_date(date_str):
    if not date_str:
        return False, "Invoice date missing"
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d %b %Y", "%d %B %Y"):
        try:
            dt = datetime.strptime(str(date_str).strip(), fmt)
            if dt > datetime.now():
                return False, "Invoice date is in the future"
            return True, dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return False, "Unrecognized date format"


def run_full_validation(invoice: dict, existing_invoices: list):
    """Runs every GST compliance rule and returns a structured report."""
    report = {"checks": [], "passed": True}

    ok, missing = check_mandatory_fields(invoice)
    report["checks"].append({
        "rule": "Mandatory field check",
        "passed": ok,
        "detail": "All mandatory fields present" if ok else f"Missing: {', '.join(missing)}"
    })
    report["passed"] &= ok

    for field, label in [("vendor_gstin", "Vendor GSTIN"), ("buyer_gstin", "Buyer GSTIN")]:
        ok, reason = validate_gstin(invoice.get(field, ""))
        report["checks"].append({"rule": f"{label} format check", "passed": ok, "detail": reason})
        report["passed"] &= ok

    ok, reason, diff = validate_tax_calculation(
        invoice.get("taxable_value"), invoice.get("cgst", 0), invoice.get("sgst", 0),
        invoice.get("igst", 0), invoice.get("total_amount")
    )
    report["checks"].append({"rule": "Tax calculation check", "passed": ok, "detail": reason})
    report["passed"] &= ok
    report["tax_diff"] = diff

    ok, reason = validate_date(invoice.get("invoice_date"))
    report["checks"].append({"rule": "Invoice date check", "passed": ok, "detail": reason})
    report["passed"] &= ok

    is_dup, dup_id = check_duplicate(invoice, existing_invoices)
    report["checks"].append({
        "rule": "Duplicate invoice check",
        "passed": not is_dup,
        "detail": "No duplicate found" if not is_dup else f"Duplicate of invoice id {dup_id}"
    })
    report["passed"] &= (not is_dup)
    report["is_duplicate"] = is_dup

    report["passed"] = bool(report["passed"])
    return report
