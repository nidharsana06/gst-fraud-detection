"""
Real-data pipeline. Source: UCI "Online Retail" (real transactional invoices,
541,909 lines, CC BY 4.0). GST data itself is confidential (CGST Act s.158),
so no public labelled GSTIN dataset exists; this maps REAL invoice behaviour
(amounts, dates, counterparties, basket sizes) into the GST schema.
Disclosed mapping: GBP->INR at a fixed rate; GST slab per StockCode (hash);
GSTINs derived deterministically from CustomerID. Credit notes are excluded.
"""
import os, io, glob, hashlib, zipfile, urllib.request
import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
URL = "https://archive.ics.uci.edu/static/public/352/online+retail.zip"
GBP_INR, SLABS, BUYER = 105.0, [0, 5, 12, 18, 28], "33AAAPX5678D1Z2"
STATES = ["33", "29", "27", "36", "07", "24", "32", "09"]
L = "ABCDEFGHJKLMNPQRSTUVWXYZ"


def find_file():
    hits = glob.glob(os.path.join(DATA_DIR, "*.xlsx")) + glob.glob(os.path.join(DATA_DIR, "*.csv"))
    return hits[0] if hits else None


def download():
    os.makedirs(DATA_DIR, exist_ok=True)
    raw = urllib.request.urlopen(URL, timeout=180).read()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        name = next(n for n in z.namelist() if n.lower().endswith((".xlsx", ".csv")))
        dest = os.path.join(DATA_DIR, os.path.basename(name))
        open(dest, "wb").write(z.read(name))
    return dest


def _h(x):
    return int(hashlib.md5(str(x).encode()).hexdigest(), 16)


def gstin_for(cid):
    h = _h(cid)
    pan = "".join(L[(h >> (i * 5)) % 24] for i in range(5)) + f"{(h >> 30) % 10000:04d}" + L[(h >> 40) % 24]
    return f"{STATES[h % len(STATES)]}{pan}1Z{L[(h >> 50) % 24]}"


def build_invoices(path, limit=None):
    df = pd.read_csv(path, encoding="latin-1") if path.endswith(".csv") else pd.read_excel(path)
    df = df.dropna(subset=["CustomerID"])
    df = df[~df["InvoiceNo"].astype(str).str.startswith("C")]          # drop credit notes
    df = df[(df["Quantity"] > 0) & (df["UnitPrice"] > 0)].copy()
    df["line"] = df["Quantity"] * df["UnitPrice"] * GBP_INR
    df["rate"] = df["StockCode"].astype(str).map(lambda s: SLABS[_h(s) % 5])
    g = df.groupby("InvoiceNo").agg(date=("InvoiceDate", "first"), cid=("CustomerID", "first"),
                                    taxable=("line", "sum"), rate=("rate", "first")).reset_index()
    if limit:
        g = g.sample(min(limit, len(g)), random_state=42)
    out = []
    for r in g.itertuples():
        taxable = round(r.taxable, 2)
        tax = round(taxable * r.rate / 100, 2)
        v = gstin_for(int(r.cid))
        intra = v.startswith("33")
        out.append(dict(
            invoice_no=str(r.InvoiceNo), invoice_date=pd.Timestamp(r.date).strftime("%Y-%m-%d"),
            vendor_name=f"Vendor {int(r.cid)}", vendor_gstin=v, buyer_gstin=BUYER,
            taxable_value=taxable, cgst=round(tax / 2, 2) if intra else 0,
            sgst=round(tax / 2, 2) if intra else 0, igst=0 if intra else tax,
            total_amount=round(taxable + tax, 2)))
    return out


if __name__ == "__main__":
    print("Downloaded:", download())
