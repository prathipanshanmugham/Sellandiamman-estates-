"""Branded PDF documents (invoices, receipts, statements, deal summaries, brochures) using reportlab."""
from io import BytesIO
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, KeepTogether
from brand import MARK_W, MARK_H, MARK_GREY, MARK_RED, COLORS, LOCKUP, S_POLYS, A_POLYS, WORD_POLYS, SUB_POLYS, mark_polygons

INK = colors.HexColor("#0F172A")
MUTED = colors.HexColor("#64748B")
RULE = colors.HexColor("#CBD5E1")
HEAD = colors.HexColor("#1E293B")
GREY = colors.HexColor(MARK_GREY)
RED = colors.HexColor(MARK_RED)
PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
HEADER_H = 30 * mm


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


def inr_short(v):
    """₹85 L / ₹1.25 Cr / ₹16,000 – the way prices are quoted in India."""
    v = float(v or 0)
    if v >= 1e7:
        return f"₹{v / 1e7:.2f}".rstrip("0").rstrip(".") + " Cr"
    if v >= 1e5:
        return f"₹{v / 1e5:.2f}".rstrip("0").rstrip(".") + " L"
    return inr(v).replace("Rs. ", "₹").removesuffix(".00")


def _fill(c, polys, color, x, y, s, ox=0.0, oy=0.0, k=1.0, h=MARK_H):
    """Fills polygons given in brand units (y down) with the even-odd rule. (x, y) is the bottom-left of a box of height h."""
    c.setFillColor(color)
    p = c.beginPath()
    for poly in polys:
        (x0, y0), rest = poly[0], poly[1:]
        p.moveTo(x + (ox + x0 * k) * s, y + (h - (oy + y0 * k)) * s)
        for px, py in rest:
            p.lineTo(x + (ox + px * k) * s, y + (h - (oy + py * k)) * s)
        p.close()
    c.drawPath(p, stroke=0, fill=1, fillMode=0)  # 0 = even-odd


def draw_mark(c, x, y, height, color=None, tone="light"):
    """Draws the SA mark (grey S, red A) with its bottom-left corner at (x, y) in PDF points. color= makes it one colour."""
    s = height / MARK_H
    t = COLORS[tone]
    c.saveState()
    _fill(c, S_POLYS, color or colors.HexColor(t["s"]), x, y, s)
    _fill(c, A_POLYS, color or colors.HexColor(t["a"]), x, y, s)
    c.restoreState()


def draw_logo(c, x, y, height, tone="light"):
    """Horizontal lockup (mark, SELLANDIAMMAN, ESTATES) with its bottom-left corner at (x, y); returns its width."""
    s = height / LOCKUP["h"]
    t = COLORS[tone]
    c.saveState()
    _fill(c, S_POLYS, colors.HexColor(t["s"]), x, y, s, h=LOCKUP["h"])
    _fill(c, A_POLYS, colors.HexColor(t["a"]), x, y, s, h=LOCKUP["h"])
    tx, ty, tk = LOCKUP["text_x"], LOCKUP["text_y"], LOCKUP["text_k"]
    _fill(c, WORD_POLYS, colors.HexColor(t["word"]), x, y, s, tx, ty, tk, LOCKUP["h"])
    _fill(c, SUB_POLYS, colors.HexColor(t["sub"]), x, y, s, tx, ty, tk, LOCKUP["h"])
    c.restoreState()
    return LOCKUP["w"] * s


def _letterspaced(c, text, x, y, font, size, spacing):
    c.setFont(font, size)
    for ch in text:
        c.drawString(x, y, ch)
        x += c.stringWidth(ch, font, size) + spacing
    return x


def _page(company, title):
    def draw(c, doc):
        c.saveState()
        top = PAGE_H - 12 * mm
        room = PAGE_W - 2 * MARGIN - draw_logo(c, MARGIN, top - 10.5 * mm, 10.5 * mm) - 6 * mm
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 7.5)
        lines = [company.get("legal_name") or company.get("name") or "Sellandiamman Estates",
                 company.get("address") or "",
                 " · ".join(v for v in (company.get("phone"), company.get("email")) if v)]
        if company.get("gstin"):
            lines.append(f"GSTIN {company['gstin']}")
        if company.get("rera_no"):
            lines.append(f"TNRERA Agent Reg. {company['rera_no']}")
        for i, ln in enumerate([ln for ln in lines if ln][:5]):
            while len(ln) > 8 and c.stringWidth(ln, "Helvetica", 7.5) > room:
                ln = ln[:-2].rstrip(" ,·") + "…"
            c.drawRightString(PAGE_W - MARGIN, top - 2.4 * mm - i * 3.0 * mm, ln)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.line(MARGIN, PAGE_H - HEADER_H + 2 * mm, PAGE_W - MARGIN, PAGE_H - HEADER_H + 2 * mm)
        c.setFont("Helvetica", 7)
        c.setFillColor(MUTED)
        c.drawString(MARGIN, 10 * mm, f"{title} · computer-generated document")
        c.drawRightString(PAGE_W - MARGIN, 10 * mm, f"Page {doc.page}")
        c.restoreState()
    return draw


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle("DocTitle", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=16, leading=20,
                          textColor=INK, spaceAfter=2))
    ss.add(ParagraphStyle("Small", parent=ss["Normal"], fontSize=8.5, leading=11, textColor=MUTED))
    ss.add(ParagraphStyle("Body", parent=ss["Normal"], fontSize=9.5, leading=13.5, textColor=INK))
    ss.add(ParagraphStyle("H3", parent=ss["Heading3"], fontName="Helvetica-Bold", fontSize=11, textColor=INK,
                          spaceBefore=8, spaceAfter=4))
    return ss


def _doc(buf, title):
    return SimpleDocTemplate(buf, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=HEADER_H + 2 * mm,
                             bottomMargin=18 * mm, title=title, author="Sellandiamman Estates")


def make_pdf(title, company, meta_rows, table_header, table_rows, totals, notes=""):
    buf = BytesIO()
    doc = _doc(buf, title)
    ss = _styles()
    cell = ParagraphStyle("Cell", parent=ss["Normal"], fontSize=8.8, leading=11)
    els = [Paragraph(escape(title), ss["DocTitle"]), Spacer(1, 4)]
    if meta_rows:
        t = Table([[k, Paragraph(escape(str(v)), cell)] for k, v in meta_rows], colWidths=[45 * mm, 129 * mm])
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8.8), ("TEXTCOLOR", (0, 0), (0, -1), MUTED),
                               ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]))
        els += [t, Spacer(1, 10)]
    if table_rows:
        data = [table_header] + [[Paragraph(escape(str(c)), cell) if i == 0 or (isinstance(c, str) and len(c) > 28)
                                  else c for i, c in enumerate(r)] for r in table_rows]
        t = Table(data, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), HEAD), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 8.8),
            ("GRID", (0, 0), (-1, -1), 0.25, RULE), ("ALIGN", (-1, 1), (-1, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ]))
        els += [t, Spacer(1, 10)]
    if totals:
        t = Table([[k, v] for k, v in totals], colWidths=[124 * mm, 50 * mm])
        t.setStyle(TableStyle([("ALIGN", (1, 0), (1, -1), "RIGHT"), ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                               ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                               ("LINEABOVE", (0, -1), (-1, -1), 0.6, INK)]))
        els.append(KeepTogether(t))
    if notes:
        els += [Spacer(1, 12), Paragraph(escape(notes), ss["Small"])]
    doc.build(els, onFirstPage=_page(company, title), onLaterPages=_page(company, title))
    return buf.getvalue()


def make_brochure(p, company, url, image_path=None, facts=(), price_text=""):
    """One-page listing brochure with photo (when available), key facts, description and a QR code link."""
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing
    title = f"{p.get('title')} · {p.get('listing_id')}"
    buf = BytesIO()
    doc = _doc(buf, title)
    ss = _styles()
    els = [Paragraph(escape(p.get("title") or ""), ss["DocTitle"]),
           Paragraph(escape(f"{p.get('locality')}, {p.get('city')} · Listing {p.get('listing_id')}"), ss["Small"]),
           Spacer(1, 6), Paragraph(f"<b>{escape(price_text)}</b>", ParagraphStyle("Price", parent=ss["Body"], fontSize=15, leading=19)),
           Spacer(1, 8)]
    if image_path:
        try:
            img = Image(str(image_path))
            ratio = img.imageHeight / float(img.imageWidth)
            w = PAGE_W - 2 * MARGIN
            img.drawWidth, img.drawHeight = w, min(w * ratio, 82 * mm)
            els += [img, Spacer(1, 8)]
        except Exception:
            pass
    rows = [[k, str(v)] for k, v in facts if v not in (None, "", 0)]
    if rows:
        half = (len(rows) + 1) // 2
        left, right = rows[:half], rows[half:] + [["", ""]] * (half - len(rows[half:]))
        grid = [[a[0], a[1], b[0], b[1]] for a, b in zip(left, right)]
        t = Table(grid, colWidths=[30 * mm, 57 * mm, 30 * mm, 57 * mm])
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8.8), ("TEXTCOLOR", (0, 0), (0, -1), MUTED),
                               ("TEXTCOLOR", (2, 0), (2, -1), MUTED), ("LINEBELOW", (0, 0), (-1, -1), 0.25, RULE),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
        els += [Paragraph("Key details", ss["H3"]), t]
    if p.get("description_public"):
        els += [Paragraph("About this property", ss["H3"]),
                Paragraph(escape(p["description_public"]).replace("\n", "<br/>"), ss["Body"])]
    if p.get("amenities"):
        els += [Paragraph("Features", ss["H3"]), Paragraph(escape(" · ".join(p["amenities"])), ss["Body"])]
    qr = QrCodeWidget(url or "")
    b = qr.getBounds()
    size = 26 * mm
    d = Drawing(size, size, transform=[size / (b[2] - b[0]), 0, 0, size / (b[3] - b[1]), 0, 0])
    d.add(qr)
    contact = Paragraph(
        f"<b>Enquire</b><br/>{escape(company.get('phone') or '')}<br/>{escape(company.get('email') or '')}<br/>"
        f"<font color='#64748B'>Scan to view this listing online, share it or book a site visit.</font>", ss["Body"])
    t = Table([[d, contact]], colWidths=[32 * mm, 142 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BOX", (0, 0), (-1, -1), 0.4, RULE),
                           ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    els += [Spacer(1, 12), KeepTogether(t), Spacer(1, 8),
            Paragraph("Details are provided by the owner and are subject to verification by the buyer or tenant. "
                      "Areas are approximate. This brochure is not an offer or a contract.", ss["Small"])]
    doc.build(els, onFirstPage=_page(company, "Property brochure"), onLaterPages=_page(company, "Property brochure"))
    return buf.getvalue()
