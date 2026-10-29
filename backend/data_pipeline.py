"""Download and map the real UCI Online Retail transactions to invoice-shaped records.

Important: UCI Online Retail is a real retail transaction dataset, not a GST dataset.
GSTINs, tax slabs, buyer details and tax amounts are deterministic synthetic mappings
for experimentation. They must not be represented as real GST records.
"""
from __future__ import annotations

import glob
import hashlib
import io
import os
import tempfile
import urllib.request
import zipfile

import pandas as pd

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
URL = "https://archive.ics.uci.edu/static/public/352/online+retail.zip"
GBP_INR = 105.0  # fixed illustrative conversion; not a historical FX series
SLABS = [0, 5, 12, 18, 28]
BUYER = "33AAAPX5678D1Z2"  # synthetic example GSTIN
STATES = ["33", "29", "27", "36", "07", "24", "32", "09"]
L = "ABCDEFGHJKLMNPQRSTUVWXYZ"


def find_file() -> str | None:
    """Find the downloaded UCI workbook/CSV, prioritizing the official workbook name."""
    if not os.path.isdir(DATA_DIR):
        return None
    candidates = glob.glob(os.path.join(DATA_DIR, "*.xlsx")) + glob.glob(os.path.join(DATA_DIR, "*.csv"))
    candidates = [p for p in candidates if not os.path.basename(p).startswith("~$")]
    if not candidates:
        return None
    candidates.sort(key=lambda p: ("online retail" not in os.path.basename(p).lower(), os.path.basename(p).lower()))
    return candidates[0]


def download() -> str:
    """Download the official UCI archive and safely extract its data workbook."""
    os.makedirs(DATA_DIR, exist_ok=True)
    request = urllib.request.Request(URL, headers={"User-Agent": "LedgerAI student project/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response:
        raw = response.read()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = [n for n in archive.namelist() if n.lower().endswith((".xlsx", ".csv")) and not n.endswith("/")]
        if not members:
            raise RuntimeError("The UCI archive did not contain an .xlsx or .csv data file.")
        # Prefer the main workbook if the archive contains supporting files.
        members.sort(key=lambda n: ("online retail" not in os.path.basename(n).lower(), n.lower()))
        member = members[0]
        filename = os.path.basename(member)
        fd, temp_path = tempfile.mkstemp(prefix="uci_retail_", suffix=os.path.splitext(filename)[1], dir=DATA_DIR)
        try:
            with os.fdopen(fd, "wb") as out, archive.open(member) as src:
                out.write(src.read())
            dest = os.path.join(DATA_DIR, filename)
            os.replace(temp_path, dest)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
    return dest


def _h(value) -> int:
    return int(hashlib.md5(str(value).encode("utf-8")).hexdigest(), 16)


def gstin_for(customer_id) -> str:
    """Create a deterministic GSTIN-shaped identifier for a customer/vendor surrogate."""
    h = _h(customer_id)
    pan = "".join(L[(h >> (i * 5)) % len(L)] for i in range(5)) + f"{(h >> 30) % 10000:04d}" + L[(h >> 40) % len(L)]
    return f"{STATES[h % len(STATES)]}{pan}1Z{L[(h >> 50) % len(L)]}"


def build_invoices(path: str, limit: int | None = None) -> list[dict]:
    """Aggregate retail line items into invoice-level GST-shaped records.

    The real source contributes invoice numbers/dates, customers, quantities, prices
    and basket totals. One illustrative GST slab is deterministically assigned per
    invoice because the source has no Indian GST rate or tax fields.
    """
    if path.lower().endswith(".csv"):
        df = pd.read_csv(path, encoding="latin-1")
    else:
        df = pd.read_excel(path)

    required = {"InvoiceNo", "InvoiceDate", "CustomerID", "Quantity", "UnitPrice"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Dataset is missing expected UCI Online Retail columns: {', '.join(sorted(missing))}")

    df = df.dropna(subset=["CustomerID"]).copy()
    df["InvoiceNo"] = df["InvoiceNo"].astype(str).str.strip()
    df = df[~df["InvoiceNo"].str.startswith("C", na=False)]  # exclude credit notes/returns
    df["Quantity"] = pd.to_numeric(df["Quantity"], errors="coerce")
    df["UnitPrice"] = pd.to_numeric(df["UnitPrice"], errors="coerce")
    df = df[(df["Quantity"] > 0) & (df["UnitPrice"] > 0)].copy()
    df["line_value_inr"] = df["Quantity"] * df["UnitPrice"] * GBP_INR

    grouped = df.groupby("InvoiceNo", sort=False).agg(
        date=("InvoiceDate", "first"),
        customer_id=("CustomerID", "first"),
        taxable=("line_value_inr", "sum"),
        line_count=("InvoiceNo", "size"),
        quantity=("Quantity", "sum"),
    ).reset_index()
    if limit and limit > 0 and len(grouped) > limit:
        grouped = grouped.sample(n=limit, random_state=42).sort_index()

    out = []
    for row in grouped.itertuples(index=False):
        taxable = round(float(row.taxable), 2)
        # Synthetic, deterministic slab assignment; UCI does not provide GST rates.
        rate = SLABS[_h(row.InvoiceNo) % len(SLABS)]
        tax = round(taxable * rate / 100, 2)
        vendor_gstin = gstin_for(int(row.customer_id))
        intra_state = vendor_gstin[:2] == BUYER[:2]
        invoice_date = pd.to_datetime(row.date, errors="coerce")
        out.append({
            "invoice_no": str(row.InvoiceNo),
            "invoice_date": invoice_date.strftime("%Y-%m-%d") if not pd.isna(invoice_date) else "",
            "vendor_name": f"Retail customer {int(row.customer_id)}",
            "vendor_gstin": vendor_gstin,
            "buyer_gstin": BUYER,
            "taxable_value": taxable,
            "cgst": round(tax / 2, 2) if intra_state else 0.0,
            "sgst": round(tax / 2, 2) if intra_state else 0.0,
            "igst": 0.0 if intra_state else tax,
            "total_amount": round(taxable + tax, 2),
            "source_line_count": int(row.line_count),
            "source_quantity": float(row.quantity),
        })
    return out


if __name__ == "__main__":
    existing = find_file()
    if existing:
        print(f"UCI Online Retail dataset already present: {existing}")
    else:
        print(f"Downloading official UCI Online Retail archive from {URL}")
        existing = download()
        print(f"Downloaded dataset: {existing}")
    preview = build_invoices(existing, limit=5)
    print(f"Validated source columns and created {len(preview)} preview invoice records.")
    print("Reminder: source transactions are real; GST fields are synthetic mappings.")
