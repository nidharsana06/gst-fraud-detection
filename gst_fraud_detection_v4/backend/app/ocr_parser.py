"""
Document parsing layer.
Extracts raw text from PDF / image invoices (OCR), and reads structured
rows directly from Excel / CSV. Then parses common invoice fields out of
the raw text using regex heuristics.
"""
import re
import io
import pandas as pd

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

try:
    import pytesseract
    from PIL import Image
except ImportError:
    pytesseract = None
    Image = None

GSTIN_RE = re.compile(r'\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[A-Z0-9]{1}\b')
INVOICE_NO_RE = re.compile(r'(?:invoice\s*(?:no|number|#)?\s*[:\-]?\s*)([A-Za-z0-9\-\/]+)', re.I)
DATE_RE = re.compile(r'(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})')
AMOUNT_RE = re.compile(r'([\d,]+\.\d{2})')


def extract_text_from_pdf(path: str) -> str:
    """Try native text extraction first; if empty (scanned PDF), fall back to OCR of rendered pages."""
    text = ""
    if pdfplumber:
        try:
            with pdfplumber.open(path) as pdf:
                text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        except Exception:
            text = ""
    if len(text.strip()) < 20 and pytesseract:
        # Scanned PDF fallback: render pages to images with pdfplumber then OCR
        try:
            with pdfplumber.open(path) as pdf:
                pages_text = []
                for page in pdf.pages:
                    im = page.to_image(resolution=200).original
                    pages_text.append(pytesseract.image_to_string(im))
                text = "\n".join(pages_text)
        except Exception:
            pass
    return text


def extract_text_from_image(path: str) -> str:
    if not pytesseract or not Image:
        return ""
    try:
        img = Image.open(path)
        return pytesseract.image_to_string(img)
    except Exception:
        return ""


def parse_fields_from_text(text: str) -> dict:
    """Heuristic regex extraction of invoice fields from raw OCR/PDF text."""
    fields = {}
    gstins = GSTIN_RE.findall(text.upper())
    if gstins:
        fields["vendor_gstin"] = gstins[0]
        if len(gstins) > 1:
            fields["buyer_gstin"] = gstins[1]

    m = INVOICE_NO_RE.search(text)
    if m:
        fields["invoice_no"] = m.group(1).strip()

    m = DATE_RE.search(text)
    if m:
        fields["invoice_date"] = m.group(1)

    amounts = [float(a.replace(",", "")) for a in AMOUNT_RE.findall(text)]
    if amounts:
        # Heuristic: largest amount = total, rest approximate taxable/tax split
        amounts_sorted = sorted(amounts, reverse=True)
        fields["total_amount"] = amounts_sorted[0]
        if len(amounts_sorted) > 1:
            fields["taxable_value"] = amounts_sorted[-1]

    # vendor / buyer name: first non-empty line often the vendor name
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if lines:
        fields["vendor_name"] = lines[0][:100]

    fields["raw_text"] = text[:2000]
    return fields


def parse_pdf_or_image(path: str, kind: str) -> dict:
    text = extract_text_from_pdf(path) if kind == "pdf" else extract_text_from_image(path)
    fields = parse_fields_from_text(text)
    fields.setdefault("cgst", 0)
    fields.setdefault("sgst", 0)
    fields.setdefault("igst", 0)
    return fields


COLUMN_ALIASES = {
    "invoice_no": ["invoice_no", "invoice number", "invoice no", "inv_no", "invoiceno"],
    "invoice_date": ["invoice_date", "date", "invoice date", "inv_date"],
    "vendor_gstin": ["vendor_gstin", "vendor gstin", "supplier_gstin", "seller_gstin", "gstin"],
    "buyer_gstin": ["buyer_gstin", "buyer gstin", "customer_gstin", "recipient_gstin"],
    "vendor_name": ["vendor_name", "vendor", "supplier", "seller", "seller_name"],
    "taxable_value": ["taxable_value", "taxable value", "taxable_amount", "sub_total", "amount"],
    "cgst": ["cgst", "cgst_amount"],
    "sgst": ["sgst", "sgst_amount"],
    "igst": ["igst", "igst_amount"],
    "total_amount": ["total_amount", "total", "grand_total", "invoice_value", "invoice value"],
}


def _map_columns(df: pd.DataFrame) -> pd.DataFrame:
    lower_cols = {c.lower().strip(): c for c in df.columns}
    rename = {}
    for target, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in lower_cols:
                rename[lower_cols[alias]] = target
                break
    return df.rename(columns=rename)


def parse_excel_or_csv(path: str, kind: str) -> list:
    """Returns a list of invoice dicts, one row = one invoice."""
    if kind == "csv":
        df = pd.read_csv(path)
    else:
        df = pd.read_excel(path)
    df = _map_columns(df)
    records = df.to_dict(orient="records")
    cleaned = []
    for r in records:
        row = {k: (v if pd.notna(v) else None) for k, v in r.items()}
        for f in ("cgst", "sgst", "igst"):
            row.setdefault(f, 0)
        cleaned.append(row)
    return cleaned


def parse_invoice_file(path: str, filename: str) -> list:
    """Entry point: dispatches by extension, always returns a LIST of invoice dicts."""
    ext = filename.lower().rsplit(".", 1)[-1]
    if ext == "pdf":
        return [parse_pdf_or_image(path, "pdf")]
    elif ext in ("png", "jpg", "jpeg"):
        return [parse_pdf_or_image(path, "image")]
    elif ext == "csv":
        return parse_excel_or_csv(path, "csv")
    elif ext in ("xlsx", "xls"):
        return parse_excel_or_csv(path, "excel")
    else:
        raise ValueError(f"Unsupported file type: .{ext}")
