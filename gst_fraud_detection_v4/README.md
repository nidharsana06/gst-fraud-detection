# Ledger AI — GST Invoice Risk & Compliance Workbench

A student mini-project combining GST-style rule checks with an Isolation Forest anomaly detector. The browser dashboard includes an invoice ledger, risk distribution, audit priority queue, GST rule-failure analysis, amount-at-risk reporting, vendor risk ranking, and invoice-level PDF audit reports.

## Dataset and scientific limitations

This project uses the **UCI Machine Learning Repository — Online Retail** dataset as the real-world transaction source. The source contains retail transaction lines (invoice number/date, customer identifier, quantity and unit price); it is **not** a GST invoice dataset and does **not** contain confirmed GST fraud labels.

The pipeline maps real transaction patterns into a GST-like invoice schema for a student experiment. The GBP-to-INR conversion is a fixed illustrative rate, and GSTIN-shaped identifiers, buyer GSTIN, tax slabs and GST amounts are synthetic. Fraud typologies are injected only into a held-out evaluation set so the project can demonstrate evaluation metrics. Therefore, displayed metrics measure detection of the planted test anomalies—not real-world GST fraud performance. Do not describe these results as validated GST fraud accuracy.

Dataset source: UCI Online Retail, https://archive.ics.uci.edu/dataset/352/online+retail (CC BY 4.0). The raw dataset is downloaded on first training and is not bundled in this ZIP.

## Project structure

```text
gst_fraud_app/
  backend/
    main.py                  FastAPI application and API routes
    data_pipeline.py         Downloads and maps UCI Online Retail transactions
    train_model.py           Trains/evaluates Isolation Forest and writes metrics
    requirements.txt
    app/                     GST rules, feature engineering, OCR, PDF reports, SQLite
  frontend/                  HTML, CSS and JavaScript dashboard
  models/                    Current model/scaler; retraining overwrites these
  sample_data/               Small intentionally imperfect demo invoices
  data/                      Created automatically for the downloaded UCI dataset
```

## Windows setup (recommended: Python 3.11 64-bit)

The pinned ML dependencies are intended for Python 3.11. Python 3.14 is too new for several pinned versions in this project; do not try to compile pandas locally to work around that. The easiest path after installing Python 3.11 is to double-click `TRAIN_REAL_UCI_DATA.bat` from this project folder. It creates `.venv311`, installs dependencies, downloads/checks the UCI dataset, and trains/evaluates the model. After it finishes, double-click `START_APP.bat`.

1. Install Python 3.11 (64-bit) from https://www.python.org/downloads/release/python-3119/.
2. Open PowerShell in the extracted `gst_fraud_app` folder.
3. Create and activate an isolated environment:

```powershell
py -3.11 -m venv .venv311
.\.venv311\Scripts\Activate.ps1
python --version
```

The last command should show `Python 3.11.x`.

4. Install dependencies from the backend folder:

```powershell
cd backend
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

5. Download and validate the real UCI dataset, then train the model (or double-click `TRAIN_REAL_UCI_DATA.bat` from the project root):

```powershell
python data_pipeline.py
python train_model.py
```

`data_pipeline.py` downloads the official UCI archive into `gst_fraud_app/data/` if the dataset is not already present. `train_model.py` also attempts the download automatically if needed. Training can take several minutes. It writes `models/isolation_forest.joblib`, `models/scaler.joblib`, and `models/metrics.json`.

6. Start the web application from the same `backend` folder:

```powershell
python -m uvicorn main:app --reload --port 8000
```

7. Open http://localhost:8000. Interactive API documentation is at http://localhost:8000/docs. To launch later without retraining, double-click `START_APP.bat` from the project root.

### If `py -3.11` is not recognized

Run `py -0p` to list installed Python versions. Install the Python 3.11 Windows x86-64 installer linked above, then open a new PowerShell window. Keep Python 3.14 installed if other projects use it.

## Quick demo

- Click **Try sample batch** to inspect known demo exceptions.
- Upload CSV/XLSX invoice batches or individual PDF/image invoices (Tesseract is additionally required for scanned documents).
- Click a ledger row to inspect the audit trail and download a PDF report.
- Use risk filters, search, sorting, pagination and CSV export.

The sample batch is for a quick UI demonstration; it is not the UCI training dataset. Training on UCI transactions is a separate step from uploading invoice records into the dashboard.

## Main API routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/upload` | Process invoice PDF/image/CSV/XLSX |
| GET | `/api/invoices` | List stored invoices, optionally filter by risk |
| GET | `/api/invoices/{id}` | Invoice details |
| DELETE | `/api/invoices` | Clear the local demo ledger |
| GET | `/api/invoices/{id}/report` | Download PDF audit report |
| GET | `/api/dashboard/summary` | Dashboard aggregates |
| GET | `/api/model/metrics` | Training/evaluation metrics |
| GET | `/api/vendors/risk` | Vendor risk leaderboard |

## Responsible interpretation

A high score is a screening signal, not proof of fraud. GSTIN-shaped IDs and tax fields derived by the UCI mapping are synthetic. Use authentic GST invoices and independently confirmed outcomes for any serious performance claims. The project is an academic prototype and is not connected to GSTN or any live tax portal.


## Version 4.1 UI and reporting updates

- Fixed KPI count-up animation so it no longer observes and re-triggers its own DOM updates.
- Added live report rollups for portfolio value, high-risk exposure, rule-failure rate, and vendor concentration.
- Added tax composition, average invoice value by risk category, and model/rule explanation frequency charts.
- Added an **Export report pack** CSV with portfolio totals, risk distribution, tax totals, vendor ranking, and explanation counts.
- Increased the frontend ledger fetch limit to 5,000 records so reports cover larger demo batches.
- Improved responsive report layouts and keyboard focus visibility.

The dashboard's scores and synthetic GST mappings are decision-support demonstrations. UCI Online Retail is not a verified GST invoice dataset and does not contain confirmed GST-fraud labels; do not present these results as validated real-world fraud detection performance.
