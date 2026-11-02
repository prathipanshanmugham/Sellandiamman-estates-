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
    "investor_funds": "Investor capital & payouts",
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


def calc_owner_statement(rent_items, expense_items, charge_items=()):
    """Rent less our fee (on rent only) less repairs, plus bills we collected from tenants for the owner (EB, water…)."""
    rent = r2(sum(float(i["amount"]) for i in rent_items))
    fee = r2(sum(float(i["amount"]) * float(i.get("fee_pct") or 0) / 100 for i in rent_items))
    exp = r2(sum(float(e["amount"]) for e in expense_items))
    chg = r2(sum(float(c["amount"]) for c in charge_items))
    return {"rent_collected": rent, "management_fee": fee, "expenses": exp, "charges_collected": chg,
            "net_payable": r2(rent - fee - exp + chg)}


def can_transition(current, target):
    return target in PROPERTY_FLOW.get(current, [])


def ranges_overlap(a_start, a_end, b_start, b_end):
    return a_start < b_end and b_start < a_end


# ---------------- Short-stay platforms ----------------
# key: (label, typical commission % charged to the host). Starting points only - set each channel's real rate.
PLATFORMS = {
    "direct": ("Direct (phone / walk-in)", 0),
    "website": ("Our website", 0),
    "airbnb": ("Airbnb", 15),
    "booking_com": ("Booking.com", 18),
    "agoda": ("Agoda", 18),
    "makemytrip": ("MakeMyTrip", 20),
    "goibibo": ("Goibibo", 20),
    "vrbo": ("Vrbo", 8),
    "expedia": ("Expedia", 18),
    "other": ("Other", 0),
}


def stay_quote(check_in: date, check_out: date, pricing: dict, guests=1):
    """Nightly price for each night from the property's pricing: seasons override weekends override the base rate;
    weekly (7+) and monthly (28+) discounts; extra-guest fee above the included guests."""
    from datetime import timedelta
    nights = (check_out - check_in).days
    if nights <= 0:
        raise ValueError("Check-out must be after check-in")
    base = float(pricing.get("base_rate") or 0)
    if base <= 0:
        raise ValueError("Set a nightly rate for this property first")
    min_n = int(pricing.get("min_nights") or 1)
    if nights < min_n:
        raise ValueError(f"Minimum stay is {min_n} nights")
    weekend = float(pricing.get("weekend_rate") or 0) or base
    seasons = pricing.get("seasons") or []
    rows, d = [], check_in
    for _ in range(nights):
        iso = d.isoformat()
        rate, label = (weekend, "weekend") if d.weekday() in (4, 5) else (base, "base")
        for s in seasons:
            if s.get("start") and s.get("end") and s["start"] <= iso <= s["end"] and float(s.get("rate") or 0) > 0:
                rate, label = float(s["rate"]), s.get("name") or "season"
        rows.append({"night": iso, "rate": r2(rate), "label": label})
        d += timedelta(days=1)
    room = r2(sum(r["rate"] for r in rows))
    disc_pct = float(pricing.get("monthly_discount_pct") or 0) if nights >= 28 else (
        float(pricing.get("weekly_discount_pct") or 0) if nights >= 7 else 0)
    discount = r2(room * disc_pct / 100)
    included = int(pricing.get("included_guests") or 2)
    extra = r2(max(0, int(guests) - included) * float(pricing.get("extra_guest_fee") or 0) * nights)
    cleaning = r2(pricing.get("cleaning_fee") or 0)
    return {"nights": nights, "rows": rows, "room": room, "discount": discount, "discount_pct": disc_pct, "extra_guests": extra,
            "cleaning_fee": cleaning, "total": r2(room - discount + extra + cleaning),
            "avg_rate": r2((room - discount + extra) / nights)}


# ---------------- Investments ----------------
def xirr(flows, guess=0.1):
    """Annualised return for dated cash flows [(date, amount)], money paid in negative, received positive.
    Returns a percentage, or None when it cannot be worked out (no sign change / no convergence)."""
    flows = sorted([(d, float(a)) for d, a in flows if a], key=lambda x: x[0])
    if len(flows) < 2 or not (any(a < 0 for _, a in flows) and any(a > 0 for _, a in flows)):
        return None
    t0 = flows[0][0]
    yrs = [((d - t0).days / 365.0, a) for d, a in flows]
    if max(t for t, _ in yrs) < 1 / 365:
        return None

    def npv(r):
        return sum(a / (1 + r) ** t for t, a in yrs)

    def dnpv(r):
        return sum(-t * a / (1 + r) ** (t + 1) for t, a in yrs)
    r = guess
    for _ in range(100):
        try:
            f, df = npv(r), dnpv(r)
        except (OverflowError, ZeroDivisionError):
            break
        if abs(df) < 1e-12:
            break
        nr = r - f / df
        if nr <= -0.9999:
            nr = (r - 0.9999) / 2
        if abs(nr - r) < 1e-9:
            return round(nr * 100, 2)
        r = nr
    lo, hi = -0.99, 10.0  # bisection fallback
    try:
        if npv(lo) * npv(hi) > 0:
            return None
        for _ in range(200):
            mid = (lo + hi) / 2
            if npv(lo) * npv(mid) <= 0:
                hi = mid
            else:
                lo = mid
        return round((lo + hi) / 2 * 100, 2)
    except (OverflowError, ZeroDivisionError):
        return None


# ---------------- Amounts in words (Indian system) ----------------
_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
         "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two(n):
    return _ONES[n] if n < 20 else (_TENS[n // 10] + (f" {_ONES[n % 10]}" if n % 10 else ""))


def _three(n):
    h, rest = divmod(n, 100)
    return " ".join(x for x in [f"{_ONES[h]} Hundred" if h else "", _two(rest) if rest else ""] if x)


def amount_in_words(v):
    """12,34,567.50 -> 'Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Fifty Paise only'."""
    v = round(float(v or 0), 2)
    rupees, paise = int(v), int(round((v - int(v)) * 100))
    if rupees == 0 and paise == 0:
        return "Rupees Zero only"
    parts = []
    crore, rest = divmod(rupees, 10_000_000)
    lakh, rest = divmod(rest, 100_000)
    thousand, rest = divmod(rest, 1000)
    if crore:
        parts.append(f"{_three(crore) if crore < 1000 else amount_in_words(crore).replace('Rupees ', '').replace(' only', '')} Crore")
    if lakh:
        parts.append(f"{_two(lakh)} Lakh")
    if thousand:
        parts.append(f"{_two(thousand)} Thousand")
    if rest:
        parts.append(_three(rest))
    words = "Rupees " + " ".join(parts) if parts else "Rupees Zero"
    if paise:
        words += f" and {_two(paise)} Paise"
    return words + " only"


# ---------------- Company health score ----------------
def score_linear(value, bad, good):
    """0 at 'bad', 100 at 'good' (either direction), clipped. None stays None (no data)."""
    if value is None:
        return None
    if good == bad:
        return 100.0 if value >= good else 0.0
    s = (value - bad) / (good - bad) * 100
    return round(max(0.0, min(100.0, s)), 1)


def status_for(score):
    if score is None:
        return "no_data"
    return "healthy" if score >= 75 else "attention" if score >= 50 else "critical"


def grade_for(score):
    if score is None:
        return "-"
    return "A" if score >= 85 else "B" if score >= 70 else "C" if score >= 55 else "D"


def combine(pillars):
    """pillars: [{'weight': w, 'metrics': [{'score': s}, ...]}] -> (overall score, pillars with their score).
    Metrics without data are left out and their pillar's weight shared among pillars that have data."""
    out, total, wsum = [], 0.0, 0.0
    for p in pillars:
        scores = [m["score"] for m in p["metrics"] if m.get("score") is not None]
        ps = round(sum(scores) / len(scores), 1) if scores else None
        out.append({**p, "score": ps, "status": status_for(ps)})
        if ps is not None:
            total += ps * p["weight"]
            wsum += p["weight"]
    overall = round(total / wsum, 1) if wsum else None
    return overall, out
