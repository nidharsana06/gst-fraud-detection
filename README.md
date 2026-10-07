# GST Fraud Detection System

An AI-powered GST fraud detection system that analyzes invoice and transaction data to identify potentially fraudulent and high-risk transactions.

## 🚀 Project Overview

GST fraud can involve suspicious invoices, unusual transaction patterns, incorrect tax values, and other irregularities.

This project uses **Machine Learning and data analytics** to analyze transaction behaviour and generate a **fraud risk score** for invoices.

The system provides a dashboard where users can:

* Upload transaction/invoice data
* Analyze invoices automatically
* Identify high-risk transactions
* View fraud risk scores
* Monitor vendor risk
* Visualize transaction relationships
* View overall fraud and compliance insights

## 🧠 Machine Learning

The project uses an **Isolation Forest-based anomaly detection approach** to identify unusual transaction patterns.

The model analyzes transaction characteristics and assigns a risk score to help identify potentially suspicious invoices.

### Dataset

The project uses the **UCI Online Retail Dataset**, a real-world transactional dataset containing online retail invoice information.

> Note: The UCI dataset is not a labeled GST-fraud dataset. It is used as real-world transaction data for anomaly and fraud-risk detection in a GST-oriented application.

## 🏗️ Project Structure

```text
gst_fraud_app/
│
├── backend/
│   ├── app/
│   ├── main.py
│   ├── data_pipeline.py
│   ├── train_model.py
│   └── requirements.txt
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── script.js
│
├── data/
│   └── Online Retail.xlsx
│
├── models/
│
├── sample_data/
│
└── README.md
```

## ⚙️ Technologies Used

* Python
* FastAPI
* Machine Learning
* Scikit-learn
* Pandas
* NumPy
* HTML
* CSS
* JavaScript
* Data Visualization
* UCI Online Retail Dataset

## 🔄 System Workflow

```text
Transaction Data
       ↓
Data Preprocessing
       ↓
Feature Engineering
       ↓
Machine Learning Model
       ↓
Anomaly / Fraud Risk Detection
       ↓
Risk Score
       ↓
Dashboard
       ↓
Fraud & Compliance Insights
```

## ▶️ How to Run

### 1. Clone the repository

```bash
git clone https://github.com/YOUR-USERNAME/gst-fraud-detection.git
cd gst-fraud-detection
```

### 2. Create a virtual environment

```bash
python -m venv venv
```

### 3. Activate it

**Windows PowerShell:**

```powershell
.\venv\Scripts\Activate.ps1
```

### 4. Install dependencies

```powershell
pip install -r backend\requirements.txt
```

### 5. Place the dataset

Place the UCI Online Retail dataset at:

```text
data/Online Retail.xlsx
```

### 6. Run the data pipeline

```powershell
python backend\data_pipeline.py
```

### 7. Train the model

```powershell
python backend\train_model.py
```

### 8. Start the FastAPI server

```powershell
$env:PYTHONPATH="backend"
python -m uvicorn backend.main:app --reload --port 8000
```

Then open:

```text
http://127.0.0.1:8000
```

## 📊 Dashboard Features

The dashboard provides:

* Invoice audit statistics
* Average fraud score
* High-risk invoice detection
* Flagged transaction value
* GST compliance indicators
* Vendor risk analysis
* Transaction/network visualization
* Invoice-level risk information

## 🎯 Objective

The main objective of this project is to demonstrate how **machine learning and anomaly detection can be applied to transaction data to support GST fraud-risk identification and compliance monitoring**.

## ⚠️ Disclaimer

This project is an academic/prototype fraud-risk detection system. Its predictions should not be treated as definitive proof of GST fraud. High-risk transactions require further investigation and verification.

## 👩‍💻 Author

Nidharsana KS
Nithisri K A

B.Tech Artificial Intelligence and Machine Learning
