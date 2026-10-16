"""Pure business-logic functions (no I/O) so they can be unit tested."""
from datetime import date

COMMISSION_TYPES = ("percent", "fixed", "months_rent")
LEAD_STAGES = ["new", "contacted", "qualified", "requirements", "matched", "site_visit", "negotiation", "won", "lost"]
PROPERTY_FLOW = {
    "draft": ["verification_pending", "inactive"],
    "verification_pending": ["verified", "draft", "inactive"],
    "verified": ["ready_to_market", "inactive"],
    "ready_to_market": ["published", "inactive"],
    "published": ["under_offer", "ready_to_market", "inactive"],
    "under_offer": ["published", "closed", "inactive"],
    "closed": ["archived", "ready_to_market"],
    "inactive": ["draft", "archived"],
    "archived": [],
}
LEDGERS = {
    "company": "Company income & expenses",
    "owner_funds": "Client / owner funds held",
    "deposits": "Tenant deposits (liability)",
    "commission_payable": "Commissions payable",
    "shortstay_owner": "Short-stay owner settlements",
}


def r2(x):
    return round(float(x or 0) + 0.0, 2)


def calc_commission(base_value, rule, splits=None):
    rule = rule or {}
    t = rule.get("type")
    v = float(rule.get("value") or 0)
    base = float(base_value or 0)
    if t not in COMMISSION_TYPES:
        raise ValueError("Commission type must be percent, fixed or months_rent")
    if v < 0 or base < 0:
        raise ValueError("Commission values cannot be negative")
    if t == "percent":
        if v > 100:
            raise ValueError("Percentage cannot exceed 100")
        gross = base * v / 100
    elif t == "fixed":
        gross = v
    else:
        gross = base * v
    gross = r2(gross)
    rows, total = [], 0.0
    for s in splits or []:
        pct = float(s.get("percent") or 0)
        if pct < 0 or pct > 100:
            raise ValueError("Split percentage must be between 0 and 100")
        amt = r2(gross * pct / 100)
        rows.append({"party": str(s.get("party", ""))[:120], "kind": s.get("kind", "co_broker"), "percent": pct, "amount": amt})
        total += amt
    if r2(total) > gross:
        raise ValueError("Commission splits exceed the gross commission")
    return {"gross": gross, "splits": rows, "splits_total": r2(total), "company_net": r2(gross - total)}


def calc_invoice(lines, gst_rate=0, gst_enabled=False):
    out, sub = [], 0.0
    for ln in lines or []:
        qty = float(ln.get("qty") or 1)
        rate = float(ln.get("rate") or 0)
        if qty <= 0 or rate < 0:
            raise ValueError("Invoice lines need a positive quantity and non-negative rate")
        amt = r2(qty * rate)
        sub += amt
        out.append({"description": str(ln.get("description", ""))[:300], "qty": qty, "rate": rate, "amount": amt})
    if not out:
        raise ValueError("At least one invoice line is required")
    sub = r2(sub)
    rate = float(gst_rate or 0) if gst_enabled else 0.0
    tax = r2(sub * rate / 100)
    return {"lines": out, "subtotal": sub, "tax_rate": rate, "tax": tax, "total": r2(sub + tax)}


def calc_shortstay(check_in: date, check_out: date, nightly_rate, discount=0, cleaning_fee=0,
                   platform_fee=0, operating_costs=0, mgmt_fee_pct=0):
    nights = (check_out - check_in).days
    if nights <= 0:
        raise ValueError("Check-out must be after check-in")
    vals = [nightly_rate, discount, cleaning_fee, platform_fee, operating_costs, mgmt_fee_pct]
    if any(float(v or 0) < 0 for v in vals):
        raise ValueError("Amounts cannot be negative")
    if float(mgmt_fee_pct or 0) > 100:
        raise ValueError("Management fee cannot exceed 100%")
    room = r2(nights * float(nightly_rate))
    gross = r2(room - float(discount or 0) + float(cleaning_fee or 0))
    if gross < 0:
        raise ValueError("Discount exceeds booking value")
    net = r2(gross - float(platform_fee or 0))
    fee = r2(net * float(mgmt_fee_pct or 0) / 100)
    owner = r2(net - fee - float(operating_costs or 0))
    return {"nights": nights, "room_revenue": room, "gross": gross, "platform_fee": r2(platform_fee),
            "net_after_platform": net, "management_fee": fee, "operating_costs": r2(operating_costs),
            "owner_payout": owner, "adr": r2(room / nights)}


def calc_owner_statement(rent_items, expense_items):
    rent = r2(sum(float(i["amount"]) for i in rent_items))
    fee = r2(sum(float(i["amount"]) * float(i.get("fee_pct") or 0) / 100 for i in rent_items))
    exp = r2(sum(float(e["amount"]) for e in expense_items))
    return {"rent_collected": rent, "management_fee": fee, "expenses": exp, "net_payable": r2(rent - fee - exp)}


def can_transition(current, target):
    return target in PROPERTY_FLOW.get(current, [])


def ranges_overlap(a_start, a_end, b_start, b_end):
    return a_start < b_end and b_start < a_end
