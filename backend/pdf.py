from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


def inr(v):
    v = float(v or 0)
    neg = v < 0
    s = f"{abs(v):.2f}"
    whole, frac = s.split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts) + "," + tail
    return f"{'-' if neg else ''}Rs. {whole}.{frac}"


def make_pdf(title, company, meta_rows, table_header, table_rows, totals, notes=""):
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm,
                            bottomMargin=16 * mm, title=title)
    ss = getSampleStyleSheet()
    els = [Paragraph(f"<b>{company.get('name', 'Sellandiamman Estates')}</b>", ss["Title"]),
           Paragraph(f"{company.get('address', '')} | {company.get('phone', '')} | {company.get('email', '')}",
                     ss["Normal"])]
    if company.get("gstin"):
        els.append(Paragraph(f"GSTIN: {company['gstin']}", ss["Normal"]))
    els += [Spacer(1, 8), Paragraph(f"<b>{title}</b>", ss["Heading2"])]
    if meta_rows:
        t = Table([[k, str(v)] for k, v in meta_rows], colWidths=[50 * mm, 120 * mm])
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (0, 0), (0, -1), colors.grey)]))
        els += [t, Spacer(1, 10)]
    if table_rows:
        t = Table([table_header] + table_rows, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
            ("ALIGN", (-1, 1), (-1, -1), "RIGHT"),
        ]))
        els += [t, Spacer(1, 10)]
    if totals:
        t = Table([[k, v] for k, v in totals], colWidths=[120 * mm, 50 * mm])
        t.setStyle(TableStyle([("ALIGN", (1, 0), (1, -1), "RIGHT"), ("FONTSIZE", (0, 0), (-1, -1), 10),
                               ("LINEABOVE", (0, -1), (-1, -1), 0.5, colors.black)]))
        els.append(t)
    if notes:
        els += [Spacer(1, 12), Paragraph(notes, ss["Italic"])]
    els += [Spacer(1, 16), Paragraph("This is a computer-generated document.", ss["Normal"])]
    doc.build(els)
    return buf.getvalue()
