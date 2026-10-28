"""Generates a one-page PDF audit report for a single invoice."""
import io
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

RISK_COLORS = {"Low": colors.HexColor("#1a7f37"), "Medium": colors.HexColor("#b58900"),
               "High": colors.HexColor("#c0392b")}


def generate_invoice_report(invoice: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=20 * mm, bottomMargin=20 * mm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("title", parent=styles["Title"], fontSize=18)
    story = []

    story.append(Paragraph("GST Invoice Audit Report", title_style))
    story.append(Spacer(1, 6))
    story.append(Paragraph(f"Invoice No: {invoice.get('invoice_no', 'N/A')}", styles["Normal"]))
    story.append(Paragraph(f"Generated: {invoice.get('uploaded_at', '')}", styles["Normal"]))
    story.append(Spacer(1, 12))

    risk = invoice.get("risk_category", "Low")
    risk_style = ParagraphStyle("risk", parent=styles["Heading2"], textColor=RISK_COLORS.get(risk, colors.black))
    story.append(Paragraph(f"Fraud Risk: {risk}  (score: {invoice.get('fraud_score', 0)}/100)", risk_style))
    story.append(Spacer(1, 12))

    details = [
        ["Field", "Value"],
        ["Vendor Name", invoice.get("vendor_name") or "-"],
        ["Vendor GSTIN", invoice.get("vendor_gstin") or "-"],
        ["Buyer GSTIN", invoice.get("buyer_gstin") or "-"],
        ["Invoice Date", invoice.get("invoice_date") or "-"],
        ["Taxable Value", f"₹{invoice.get('taxable_value', 0):,.2f}"],
        ["CGST", f"₹{invoice.get('cgst', 0):,.2f}"],
        ["SGST", f"₹{invoice.get('sgst', 0):,.2f}"],
        ["IGST", f"₹{invoice.get('igst', 0):,.2f}"],
        ["Total Amount", f"₹{invoice.get('total_amount', 0):,.2f}"],
    ]
    t = Table(details, colWidths=[150, 300])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2c3e50")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f6fa")]),
    ]))
    story.append(t)
    story.append(Spacer(1, 16))

    story.append(Paragraph("GST Compliance Checks", styles["Heading2"]))
    checks = invoice.get("validation_report", {}).get("checks", [])
    check_rows = [["Rule", "Result", "Detail"]]
    for c in checks:
        check_rows.append([c["rule"], "PASS" if c["passed"] else "FAIL", c["detail"]])
    ct = Table(check_rows, colWidths=[140, 60, 250])
    ct.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2c3e50")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(ct)
    story.append(Spacer(1, 16))

    story.append(Paragraph("Fraud Risk Factors", styles["Heading2"]))
    for r in invoice.get("reasons", []):
        story.append(Paragraph(f"• {r}", styles["Normal"]))

    doc.build(story)
    return buf.getvalue()
