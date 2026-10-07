import os
import json
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Float, Text, DateTime, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "invoices.db")
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    invoice_no = Column(String, index=True)
    invoice_date = Column(String)
    vendor_name = Column(String)
    vendor_gstin = Column(String, index=True)
    buyer_gstin = Column(String)
    taxable_value = Column(Float, default=0)
    cgst = Column(Float, default=0)
    sgst = Column(Float, default=0)
    igst = Column(Float, default=0)
    total_amount = Column(Float, default=0)

    validation_passed = Column(Boolean, default=False)
    validation_report_json = Column(Text)
    fraud_score = Column(Float, default=0)
    risk_category = Column(String, default="Low")
    reasons_json = Column(Text)

    uploaded_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "filename": self.filename,
            "invoice_no": self.invoice_no,
            "invoice_date": self.invoice_date,
            "vendor_name": self.vendor_name,
            "vendor_gstin": self.vendor_gstin,
            "buyer_gstin": self.buyer_gstin,
            "taxable_value": self.taxable_value,
            "cgst": self.cgst,
            "sgst": self.sgst,
            "igst": self.igst,
            "total_amount": self.total_amount,
            "validation_passed": self.validation_passed,
            "validation_report": json.loads(self.validation_report_json or "{}"),
            "fraud_score": self.fraud_score,
            "risk_category": self.risk_category,
            "reasons": json.loads(self.reasons_json or "[]"),
            "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None,
        }


def init_db():
    Base.metadata.create_all(bind=engine)


def get_session():
    return SessionLocal()
