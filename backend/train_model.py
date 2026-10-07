"""
Trains the Isolation Forest on REAL invoice behaviour (UCI Online Retail mapped
to GST schema) and evaluates it on a held-out set containing labelled injected
GST-fraud typologies. Writes models/*.joblib and models/metrics.json.

  python data_pipeline.py     # one-time download (needs internet)
  python train_model.py
"""
import os, sys, json, copy, random
from datetime import datetime
import numpy as np, pandas as pd, joblib
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score, average_precision_score, confusion_matrix
from data_pipeline import find_file, build_invoices
from app.gst_validator import run_full_validation
from app.fraud_model import engineer_features, FEATURE_NAMES

MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(os.path.dirname(__file__), "..", "models"))
os.makedirs(MODEL_DIR, exist_ok=True)
random.seed(42); np.random.seed(42)


def feats(inv, dup=False):
    rep = run_full_validation(inv, [{"invoice_no": inv["invoice_no"], "vendor_gstin": inv["vendor_gstin"]}] if dup else [])
    f = engineer_features(inv, rep)
    return [f[k] for k in FEATURE_NAMES], not rep["passed"]


def inject(inv):
    """Returns (tampered invoice, typology, is_dup)."""
    x, kind = copy.deepcopy(inv), random.choice(
        ["tax_mismatch", "bad_gstin", "missing_field", "duplicate", "off_slab_rate", "mixed_igst_cgst", "round_amount"])
    if kind == "tax_mismatch": x["total_amount"] = round(x["total_amount"] * random.uniform(0.7, 0.9), 2)
    elif kind == "bad_gstin": x["vendor_gstin"] = x["vendor_gstin"][:12] + "XX"
    elif kind == "missing_field": x["taxable_value"] = None
    elif kind == "off_slab_rate":
        t = round(x["taxable_value"] * random.uniform(.07, .4), 2)
        x.update(cgst=0, sgst=0, igst=t, total_amount=round(x["taxable_value"] + t, 2))
    elif kind == "mixed_igst_cgst": x["igst"] = x["taxable_value"] * .18; x["total_amount"] += x["igst"]
    elif kind == "round_amount":
        x["total_amount"] = float(random.choice([5000, 10000, 25000, 50000, 100000]))
    return x, kind, kind == "duplicate"


def main():
    path = find_file()
    if not path:
        sys.exit("No real dataset found in ../data. Run `python data_pipeline.py` (needs internet) "
                 "or place the UCI Online Retail .xlsx/.csv in the data/ folder.")
    invs = build_invoices(path, limit=30000)
    random.shuffle(invs)
    cut = int(len(invs) * .7)
    train_inv, test_inv = invs[:cut], invs[cut:]

    Xtr = np.array([feats(i)[0] for i in train_inv])
    scaler = StandardScaler().fit(Xtr)
    model = IsolationForest(n_estimators=300, contamination=0.02, random_state=42).fit(scaler.transform(Xtr))

    rows, y, kinds, rule_hit = [], [], [], []
    half = len(test_inv) // 2
    for i, inv in enumerate(test_inv):
        if i < half:
            f, r = feats(inv); rows.append(f); y.append(0); kinds.append("clean"); rule_hit.append(r)
        else:
            x, k, d = inject(inv); f, r = feats(x, d)
            rows.append(f); y.append(1); kinds.append(k); rule_hit.append(r or d)
    Xte, y = np.array(rows), np.array(y)
    s = -model.decision_function(scaler.transform(Xte))
    pred = (model.predict(scaler.transform(Xte)) == -1)
    hybrid = pred | np.array(rule_hit)
    tn, fp, fn, tp = confusion_matrix(y, pred).ravel()
    per = {k: round(float(pred[(np.array(kinds) == k)].mean()), 3) for k in sorted(set(kinds) - {"clean"})}
    metrics = dict(
        source="UCI Online Retail (real invoices) -> GST schema", trained_at=datetime.utcnow().isoformat(),
        train_invoices=len(train_inv), test_invoices=len(y), injected_frauds=int(y.sum()),
        roc_auc=round(roc_auc_score(y, s), 4), pr_auc=round(average_precision_score(y, s), 4),
        ml_only=dict(precision=round(tp / max(tp + fp, 1), 3), recall=round(tp / max(tp + fn, 1), 3),
                     false_positive_rate=round(fp / max(fp + tn, 1), 4), tp=int(tp), fp=int(fp), tn=int(tn), fn=int(fn)),
        hybrid_recall=round(float(hybrid[y == 1].mean()), 3),
        hybrid_false_positive_rate=round(float(hybrid[y == 0].mean()), 4),
        recall_by_typology_ml_only=per, features=FEATURE_NAMES)
    joblib.dump(model, os.path.join(MODEL_DIR, "isolation_forest.joblib"))
    joblib.dump(scaler, os.path.join(MODEL_DIR, "scaler.joblib"))
    json.dump(metrics, open(os.path.join(MODEL_DIR, "metrics.json"), "w"), indent=2)
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
