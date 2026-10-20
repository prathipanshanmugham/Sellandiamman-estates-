"""Idempotent seeding: indexes, first admin, branches, settings and (only when SEED_DEMO=true) sample data.

Sample data goes through the same functions the API uses, so ledgers, statements and approvals add up.
Never set SEED_DEMO=true on the live server.
"""
import os
import random
from datetime import timedelta, datetime
from core import db, now_iso, new_id, next_code, hash_password, verify_password, today_ist, logger, IST, ROLES

DEMO_DOMAIN = "demo.sellandiamman.test"


async def ensure_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.users.create_index("owner_id", sparse=True)
    await db.sessions.create_index("sid", unique=True)
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.login_attempts.create_index("identifier")
    await db.notifications.create_index("dedupe_key", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.payments.create_index("idempotency_key", unique=True)
    await db.rent_payments.create_index("idempotency_key", unique=True)
    await db.rent_payments.create_index([("owner_id", 1), ("period", 1)])
    await db.deposit_movements.create_index("idempotency_key", unique=True)
    await db.owner_statements.create_index([("owner_id", 1), ("month", 1)], unique=True)
    for c in ("properties", "leads", "deals", "owners", "leases", "bookings", "invoices", "work_orders", "documents",
              "ledger_entries", "tasks", "approvals", "expenses", "vendors", "posts", "site_visits"):
        await db[c].create_index("id", unique=True)
    await db.properties.create_index("listing_id", sparse=True)
    await db.invoices.create_index("deal_id", unique=True, partialFilterExpression={"deal_id": {"$type": "string"}})
    await db.properties.create_index([("status", 1), ("city", 1), ("transaction", 1)])
    await db.properties.create_index("owner_id")
    await db.leads.create_index("phone")
    await db.leads.create_index([("stage", 1), ("assigned_to", 1)])
    await db.ledger_entries.create_index([("ledger", 1), ("posted_at", -1)])
    await db.audit_logs.create_index([("entity", 1), ("at", -1)])
    await db.bookings.create_index([("property_id", 1), ("check_in", 1)])
    await db.booking_nights.create_index([("property_id", 1), ("night", 1)], unique=True)
    await db.booking_nights.create_index("booking_id")
    await db.site_visits.create_index([("status", 1), ("scheduled_at", 1)])
    await db.posts.create_index("slug")
    await db.posts.create_index([("status", 1), ("published_at", -1)])
    for c in ("branches", "customers", "locations", "stay_channels", "stay_blocks", "investors", "inv_projects", "investments",
              "distributions", "agreements", "site_versions"):
        await db[c].create_index("id", unique=True)
    await db.customers.create_index("phone")
    await db.customers.create_index([("branch_id", 1), ("created_at", -1)])
    await db.locations.create_index([("kind", 1), ("city", 1), ("name", 1)])
    await db.stay_channels.create_index("export_token", unique=True)
    await db.stay_channels.create_index("property_id")
    await db.stay_blocks.create_index([("property_id", 1), ("start", 1)])
    await db.bookings.create_index([("channel_id", 1), ("channel_uid", 1)])
    await db.investments.create_index([("investor_id", 1), ("project_id", 1)])
    await db.distributions.create_index([("investor_id", 1), ("date", -1)])
    await db.agreements.create_index([("entity_type", 1), ("entity_id", 1)])
    await db.site_content.create_index("id", unique=True)
    await db.migrations.create_index("id", unique=True)
    for c in ("leads", "properties", "leases", "bookings", "invoices", "ledger_entries", "expenses", "deals", "work_orders"):
        await db[c].create_index("branch_id")


async def seed_core():
    email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
    pw = os.environ.get("ADMIN_PASSWORD") or ""
    if email:
        u = await db.users.find_one({"email": email})
        if not u:
            if len(pw) < 10:
                logger.warning("ADMIN_PASSWORD missing or shorter than 10 characters: first admin not created")
            else:
                await db.users.insert_one({"id": new_id(), "email": email, "name": "Super Administrator",
                                           "role": "super_admin", "active": True, "branch_ids": [],
                                           "password_hash": hash_password(pw), "created_at": now_iso()})
                logger.info("First Super Administrator created for %s", email)
        elif os.environ.get("ADMIN_RESET_PASSWORD") == "true" and pw and not verify_password(pw, u.get("password_hash") or ""):
            # Emergency only: set ADMIN_RESET_PASSWORD=true for one restart, then remove it again.
            await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(pw), "active": True}})
            await db.sessions.update_many({"user_id": u["id"]}, {"$set": {"revoked": True}})
            logger.warning("Admin password reset from environment for %s", email)
    await seed_branches()
    await db.settings.update_one({"id": "company"}, {"$setOnInsert": {
        "id": "company", "name": "Sellandiamman Estates", "legal_name": "Sellandiamman Estates (Sellandiamman Group)",
        "phone": "+91 00000 00000", "whatsapp": "", "email": "info@example.com",
        "address": "[Head office address], Perundurai, Tamil Nadu", "gstin": "", "gst_enabled": False, "gst_rate": 0,
        "rera_no": "", "social": {}, "cities": [b["city"] for b in BRANCHES], "localities": [], "invoice_due_days": 15,
        "approvals": {"commission_change": True, "refunds": True, "write_offs": True},
        "demo_mode": os.environ.get("SEED_DEMO") == "true", "office_hours": "Mon–Sat, 9:30 AM – 6:30 PM",
        "hero_title": "Property services for Erode & Perundurai",
        "hero_subtitle": "Buy, sell, rent, lease and professionally managed homes, land and industrial spaces.",
        "announcement": "", "testimonials": [], "mfa_required_roles": [], "email_notifications": False,
        "map_center": {"lat": 11.36, "lng": 77.68, "zoom": 9}, "agreement_signatory": "", "targets": {}}}, upsert=True)
    # settings added after the first release
    await db.settings.update_one({"id": "company", "map_center": {"$exists": False}},
                                 {"$set": {"map_center": {"lat": 11.31, "lng": 77.65, "zoom": 11}, "social": {},
                                           "rera_no": "", "announcement": "", "mfa_required_roles": [],
                                           "email_notifications": False}})


# The five branches. Perundurai is the head office. Addresses and phone numbers are placeholders for the team to fill in
# (Settings → Branches); map points are town centres and can be moved to the exact office.
BRANCHES = [
    {"id": "br-perundurai", "code": "PDR", "name": "Perundurai", "city": "Perundurai", "district": "Erode", "pincode": "638052",
     "lat": 11.2750, "lng": 77.5874, "is_head_office": True, "order": 1},
    {"id": "br-erode", "code": "ERD", "name": "Erode", "city": "Erode", "district": "Erode", "pincode": "638001",
     "lat": 11.3410, "lng": 77.7172, "is_head_office": False, "order": 2},
    {"id": "br-kadambur", "code": "KDB", "name": "Kadambur", "city": "Kadambur", "district": "Erode", "pincode": None,
     "lat": None, "lng": None, "is_head_office": False, "order": 3},
    {"id": "br-sathyamangalam", "code": "STY", "name": "Sathyamangalam", "city": "Sathyamangalam", "district": "Erode",
     "pincode": "638401", "lat": 11.5048, "lng": 77.2384, "is_head_office": False, "order": 4},
    {"id": "br-namakkal", "code": "NMK", "name": "Namakkal", "city": "Namakkal", "district": "Namakkal", "pincode": "637001",
     "lat": 11.2189, "lng": 78.1677, "is_head_office": False, "order": 5},
]
CITY_BRANCH = {b["city"]: b["id"] for b in BRANCHES}


async def seed_branches():
    for b in BRANCHES:
        doc = {**b, "address": f"[Office address], {b['city']}, Tamil Nadu", "phone": None, "whatsapp": None, "email": None,
               "office_hours": None, "manager_id": None, "active": True, "gbp_url": None, "created_at": now_iso()}
        await db.branches.update_one({"id": b["id"]}, {"$setOnInsert": doc}, upsert=True)
        # branches made by the first release only had a name and town
        await db.branches.update_one({"id": b["id"], "code": {"$exists": False}},
                                     {"$set": {k: v for k, v in doc.items() if k not in ("id", "name", "city", "created_at", "is_head_office")}})
    if not await db.branches.find_one({"is_head_office": True}):
        await db.branches.update_one({"id": "br-perundurai"}, {"$set": {"is_head_office": True}})


async def _once(key, fn):
    if await db.migrations.find_one({"id": key}):
        return
    res = await fn()
    await db.migrations.insert_one({"id": key, "at": now_iso(), "result": str(res)[:300]})
    logger.info("Migration %s done: %s", key, res)


async def _locations():
    """Town and locality list (used for search, location pages and branch routing) from the branches and every property."""
    from routes_branches import ensure_place
    from core import branch_for_place
    import re as _re
    for b in await db.branches.find({}, {"_id": 0}).to_list(100):
        c = await ensure_place(b["city"], branch_id=b["id"])
        if c and (not c.get("branch_id") or not c.get("district")):
            await db.locations.update_one({"id": c["id"]}, {"$set": {"branch_id": c.get("branch_id") or b["id"], "district": c.get("district") or b.get("district")}})
        if b.get("lat") and c and not c.get("lat"):
            await db.locations.update_one({"id": c["id"]}, {"$set": {"lat": b["lat"], "lng": b["lng"], "pincode": b.get("pincode")}})
    n = 0
    for p in await db.properties.find({"deleted": {"$ne": True}}, {"_id": 0, "city": 1, "locality": 1, "pincode": 1, "branch_id": 1}).to_list(50000):
        if p.get("city"):
            await ensure_place(p["city"], p.get("locality"), p.get("pincode"), branch_id=p.get("branch_id") or await branch_for_place(p["city"]))
            n += 1
    s = await db.settings.find_one({"id": "company"}, {"_id": 0, "localities": 1}) or {}
    for loc in s.get("localities") or []:
        if isinstance(loc, dict) and loc.get("city") and loc.get("name"):
            await ensure_place(loc["city"], loc["name"], branch_id=await branch_for_place(loc["city"]))
    return {"from_properties": n, "places": await db.locations.count_documents({})}


async def _branch_ids():
    """Records made before branches existed get the branch of their property (or the head office)."""
    from core import head_office_id, branch_for_place
    from routes_crm import branch_from_text
    ho = await head_office_id()
    missing = {"$or": [{"branch_id": {"$exists": False}}, {"branch_id": None}]}
    n = 0
    for p in await db.properties.find(missing, {"_id": 0, "id": 1, "city": 1, "locality": 1}).to_list(50000):
        await db.properties.update_one({"id": p["id"]}, {"$set": {"branch_id": await branch_for_place(p.get("city"), p.get("locality"))}})
        n += 1
    pb = {p["id"]: p.get("branch_id") for p in await db.properties.find({}, {"_id": 0, "id": 1, "branch_id": 1}).to_list(50000)}
    for coll in ("leases", "bookings", "work_orders", "site_visits", "deals", "stay_channels"):
        for r in await db[coll].find(missing, {"_id": 0, "id": 1, "property_id": 1}).to_list(50000):
            await db[coll].update_one({"id": r["id"]}, {"$set": {"branch_id": pb.get(r.get("property_id")) or ho}})
            n += 1
    for ld in await db.leads.find(missing, {"_id": 0, "id": 1, "property_id": 1, "preferred_locations": 1}).to_list(50000):
        await db.leads.update_one({"id": ld["id"]}, {"$set": {"branch_id": pb.get(ld.get("property_id")) or await branch_from_text(ld.get("preferred_locations"))}})
        n += 1
    db_ = {d["id"]: d.get("branch_id") for d in await db.deals.find({}, {"_id": 0, "id": 1, "branch_id": 1}).to_list(50000)}
    for i in await db.invoices.find(missing, {"_id": 0, "id": 1, "deal_id": 1}).to_list(50000):
        await db.invoices.update_one({"id": i["id"]}, {"$set": {"branch_id": db_.get(i.get("deal_id")) or ho}})
        n += 1
    await db.expenses.update_many(missing, {"$set": {"branch_id": ho}})
    # ledger lines follow the record they came from
    ref = {}
    for coll in ("invoices", "leases", "bookings", "work_orders", "deals", "expenses"):
        for r in await db[coll].find({}, {"_id": 0, "id": 1, "branch_id": 1}).to_list(100000):
            ref[r["id"]] = r.get("branch_id")
    for r in await db.payments.find({}, {"_id": 0, "id": 1, "invoice_id": 1}).to_list(100000):
        ref[r["id"]] = ref.get(r.get("invoice_id"))
    for coll in ("rent_payments", "deposit_movements"):
        for r in await db[coll].find({}, {"_id": 0, "id": 1, "lease_id": 1}).to_list(100000):
            ref[r["id"]] = ref.get(r.get("lease_id"))
    for e in await db.ledger_entries.find(missing, {"_id": 0, "id": 1, "ref_id": 1}).to_list(200000):
        await db.ledger_entries.update_one({"id": e["id"]}, {"$set": {"branch_id": ref.get(e.get("ref_id")) or ho}})
        n += 1
    return {"updated": n}


async def _settings_r3():
    await db.settings.update_one({"id": "company", "map_center.zoom": 11}, {"$set": {"map_center": {"lat": 11.36, "lng": 77.68, "zoom": 9}}})
    await db.settings.update_one({"id": "company", "cities": ["Erode", "Perundurai"]}, {"$set": {"cities": [b["city"] for b in BRANCHES]}})
    return "ok"


async def migrate():
    from routes_customers import backfill_customers
    from routes_cms import seed_site
    await _once("r3_settings", _settings_r3)
    await _once("r3_locations", _locations)
    await _once("r3_branch_ids", _branch_ids)
    await _once("r3_customers", backfill_customers)
    await seed_site()


# ----------------------------------------------------------------------------------------------------------------
# Sample data (SEED_DEMO=true only)
# ----------------------------------------------------------------------------------------------------------------
DEMO_USERS = [("director", "Karthik Raman"), ("branch_manager", "Priya Sundaram"), ("sales_agent", "Vignesh Kumar"),
              ("property_manager", "Deepa Natarajan"), ("accountant", "Senthil Murugan"), ("marketing", "Divya Prakash"),
              ("shortstay_ops", "Arun Balaji"), ("auditor", "Lakshmi Iyer")]
# role -> (designation, department, branches ([] = all), reports to (role or extra key))
DEMO_PROFILE = {
    "director": ("Managing Director", "Management", [], None),
    "branch_manager": ("Branch Manager – Erode", "Branches", ["br-erode"], "director"),
    "sales_agent": ("Sales Executive", "Sales", ["br-erode"], "branch_manager"),
    "property_manager": ("Property Manager", "Property management", ["br-erode"], "branch_manager"),
    "accountant": ("Accounts Manager", "Finance", [], "director"),
    "marketing": ("Marketing Lead", "Marketing", [], "director"),
    "shortstay_ops": ("Short-Stay Operations Lead", "Short stays", [], "director"),
    "auditor": ("Internal Auditor", "Finance", [], "director"),
}
# key, role, name, email, designation, department, branch, reports to
EXTRA_STAFF = [
    ("bm_pdr", "branch_manager", "Ganesh Palanisamy", "perundurai.manager", "Branch Manager – Perundurai (Head Office)", "Branches",
     "br-perundurai", "director"),
    ("agent_pdr", "sales_agent", "Dinesh Kumar", "perundurai.sales", "Sales Executive – Industrial & SIPCOT", "Sales", "br-perundurai", "bm_pdr"),
    ("bm_sty", "branch_manager", "Revathi Kumar", "sathy.manager", "Branch Manager – Sathyamangalam", "Branches", "br-sathyamangalam", "director"),
    ("bm_kdb", "branch_manager", "Muthusamy K", "kadambur.manager", "Branch In-charge – Kadambur", "Branches", "br-kadambur", "bm_sty"),
    ("bm_nmk", "branch_manager", "Saravanan Muthu", "namakkal.manager", "Branch Manager – Namakkal", "Branches", "br-namakkal", "director"),
    ("agent_nmk", "sales_agent", "Keerthi Vasan", "namakkal.sales", "Sales Executive", "Sales", "br-namakkal", "bm_nmk"),
]


def demo_email(role):
    return f"{role.replace('_', '.')}@{DEMO_DOMAIN}"


def _iso(d, hh=10, mm=0):
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=IST).isoformat()


def _month_shift(d, n):
    y, m = d.year, d.month + n
    while m <= 0:
        m += 12
        y -= 1
    while m > 12:
        m -= 12
        y += 1
    return d.replace(year=y, month=m, day=1)


PROPS = [
    # code, title, category, transaction, city, locality, pin, lat, lng, price, unit, images, extra
    ("3 BHK Independent Villa", "villa", "sale", "Erode", "Thindal", "638009", 11.3236, 77.6831, 8500000, "total",
     ["/images/villa.jpg", "/images/interior.jpg", "/images/estate.jpg"],
     dict(bedrooms=3, bathrooms=3, built_area=2100, plot_area=2400, furnishing="semi_furnished", featured=True,
          amenities=["Car parking", "Borewell", "Gated community", "East facing"], survey_no="SF 101/2A",
          description_public="A well-ventilated 3 BHK villa in a quiet gated layout at Thindal. East-facing entrance, "
                             "covered car parking, landscaped garden and borewell with corporation water. 5 minutes "
                             "to Thindal Murugan temple and 10 minutes to the Perundurai Road schools.")),
    ("2 BHK Furnished Apartment", "apartment", "rent", "Erode", "Perundurai Road", "638011", 11.3301, 77.6952, 16000,
     "per_month", ["/images/apartment.jpg", "/images/interior.jpg"],
     dict(bedrooms=2, bathrooms=2, built_area=1050, furnishing="furnished", featured=True, service_type="management",
          mgmt_fee_pct=8, amenities=["Lift", "Power backup", "Security", "Covered parking"],
          description_public="Furnished 2 BHK on the 3rd floor with lift, 24x7 power backup and covered parking. "
                             "Wardrobes, modular kitchen and two air-conditioned bedrooms.")),
    ("DTCP Approved Residential Plot", "land", "sale", "Perundurai", "Vijayamangalam", "638056", 11.2369, 77.5009,
     1450000, "total", ["/images/land.jpg"],
     dict(plot_area=1800, amenities=["DTCP approved", "Corner plot", "Tar road"],
          description_public="1,800 sq.ft corner residential plot in a DTCP-approved layout with 30 ft tar road, "
                             "street lights and EB line at the plot.")),
    ("Industrial Shed near SIPCOT", "factory_shed", "lease", "Perundurai", "SIPCOT", "638052", 11.2581, 77.5562,
     180000, "per_month", ["/images/shed.jpg", "/images/warehouse.jpg"],
     dict(built_area=12000, plot_area=20000, featured=True, power_supply="150 HP sanctioned (as provided by owner)",
          loading_access="40 ft container access", parking="Truck parking for 4 vehicles",
          amenities=["3-phase power", "Container access", "Crane-ready columns", "Borewell"],
          description_public="12,000 sq.ft pre-engineered shed with crane-ready columns on a 20,000 sq.ft plot, "
                             "2 km from the SIPCOT Perundurai gate. Suitable for textiles, engineering or storage.")),
    ("Warehouse with Loading Dock", "warehouse", "lease", "Erode", "Chithode", "638102", 11.3934, 77.6652, 95000,
     "per_month", ["/images/warehouse.jpg"],
     dict(built_area=8000, loading_access="2 loading docks", parking="Space for 3 trucks",
          amenities=["3-phase power", "Container access", "Fire hydrant line"],
          description_public="8,000 sq.ft warehouse with two loading docks on the Erode–Bhavani road. 20 ft clear "
                             "height, fire hydrant line and watchman room.")),
    ("Ground-floor Showroom", "shop", "rent", "Erode", "Brough Road", "638001", 11.3441, 77.7201, 65000, "per_month",
     ["/images/commercial.jpg"],
     dict(built_area=1600, service_type="management", mgmt_fee_pct=6,
          amenities=["Main road frontage", "Glass facade", "Washroom"],
          description_public="1,600 sq.ft ground-floor showroom with 32 ft main-road frontage on Brough Road.")),
    ("Serviced Guest House – 2 Bedrooms", "residential", "short_stay", "Erode", "Thindal", "638009", 11.3212, 77.6870,
     3200, "per_night", ["/images/contemporary.jpg", "/images/interior.jpg"],
     dict(bedrooms=2, bathrooms=2, max_guests=5, nightly_rate=3200, mgmt_fee_pct=20, furnishing="furnished",
          service_type="short_stay", featured=True, amenities=["Wi-Fi", "AC", "Kitchen", "Car parking"],
          checkin_instructions="Key box code is shared on the morning of check-in.",
          description_public="Fully furnished short-stay home for families and business travellers. Two AC bedrooms, "
                             "kitchen, Wi-Fi and parking. 15 minutes to Erode Junction.")),
    ("4 BHK Premium House", "residential", "sale", "Erode", "Nasiyanur", "638107", 11.3403, 77.6499, 12500000, "total",
     ["/images/house.jpg", "/images/estate.jpg"],
     dict(bedrooms=4, bathrooms=4, built_area=3200, plot_area=3600, furnishing="unfurnished",
          amenities=["Solar water heater", "Garden", "Car parking", "Rainwater harvesting"],
          description_public="Spacious 4 BHK house on a 3,600 sq.ft plot with solar water heating, a front garden and "
                             "parking for two cars. Close to Nasiyanur Road schools and hospitals.")),
    ("Agricultural Land – 2.5 Acres", "agricultural", "sale", "Perundurai", "Kanjikoil", "638116", 11.3634, 77.5852,
     4500000, "total", ["/images/land2.jpg"],
     dict(plot_area=2.5, area_unit="acres", status="verification_pending", source="owner_submission",
          description_public="2.5 acres with borewell and road access.")),
    ("3 BHK Apartment near Bus Stand", "apartment", "sale", "Erode", "Periyar Nagar", "638001", 11.3521, 77.7272,
     6800000, "total", ["/images/apartment2.jpg", "/images/interior.jpg"],
     dict(bedrooms=3, bathrooms=2, built_area=1450, furnishing="semi_furnished", featured=True,
          amenities=["Lift", "Power backup", "Covered parking", "CCTV"],
          description_public="3 BHK apartment on the 2nd floor, 1,450 sq.ft, five minutes from the Erode central bus "
                             "stand. Covered parking, lift, CCTV and power backup for common areas.")),
    ("Office Space – 1,200 sq.ft", "office", "rent", "Erode", "Surampatti", "638009", 11.3501, 77.7098, 38000,
     "per_month", ["/images/commercial.jpg"],
     dict(built_area=1200, furnishing="semi_furnished", amenities=["Lift", "Power backup", "Car parking"],
          description_public="Semi-furnished office on the first floor with a reception, two cabins and a work area "
                             "for 15. Lift, power backup and car parking.")),
    ("Commercial Plot on Highway", "commercial", "sale", "Perundurai", "Ingur", "638058", 11.2671, 77.6172, 9500000,
     "total", ["/images/land2.jpg"],
     dict(plot_area=10, area_unit="cents", amenities=["Highway frontage", "Corner plot"],
          description_public="10-cent commercial plot with 66 ft frontage on the Erode–Perundurai highway. Suits a "
                             "showroom, hotel or service centre.")),
    ("2 BHK Independent House", "residential", "rent", "Erode", "Villarasampatti", "638107", 11.3121, 77.6602, 14000,
     "per_month", ["/images/house.jpg"],
     dict(bedrooms=2, bathrooms=2, built_area=950, furnishing="unfurnished", service_type="management",
          mgmt_fee_pct=8, amenities=["Car parking", "Borewell"],
          description_public="Independent 2 BHK ground-floor house with a car porch and borewell water.")),
    ("Studio Apartment – Short Stay", "apartment", "short_stay", "Erode", "Karungalpalayam", "638003", 11.3482,
     77.7381, 1800, "per_night", ["/images/interior.jpg"],
     dict(bedrooms=1, bathrooms=1, max_guests=2, nightly_rate=1800, mgmt_fee_pct=18, furnishing="furnished",
          service_type="short_stay", amenities=["Wi-Fi", "AC", "Kitchenette"],
          description_public="Compact studio for solo travellers and couples, with a kitchenette, AC and fast Wi-Fi.")),
    ("3 BHK Villa – Solar", "villa", "sale", "Erode", "Solar", "638002", 11.3101, 77.7252, 7200000, "total",
     ["/images/villa.jpg"],
     dict(bedrooms=3, bathrooms=3, built_area=1900, plot_area=2200, status="closed", closed_as="sold",
          description_public="3 BHK villa near Solar bus stop.")),
    ("Duplex Villa – Moolapalayam", "villa", "sale", "Erode", "Moolapalayam", "638002", 11.3201, 77.7203, 9800000,
     "total", ["/images/estate.jpg"],
     dict(bedrooms=4, bathrooms=4, built_area=2600, plot_area=2400, status="draft",
          description_public="")),
    # branches added in 2026 (map points are approximate)
    ("Riverside Farm Stay – 3 Bedrooms", "residential", "short_stay", "Sathyamangalam", "Bhavanisagar Road", "638401", 11.5101,
     77.2602, 5500, "per_night", ["/images/estate.jpg", "/images/contemporary.jpg", "/images/interior.jpg"],
     dict(bedrooms=3, bathrooms=3, max_guests=8, nightly_rate=5500, mgmt_fee_pct=20, furnishing="furnished",
          service_type="short_stay", featured=True, amenities=["Wi-Fi", "Kitchen", "Garden", "Car parking", "Bonfire area"],
          checkin_instructions="The caretaker meets you at the gate; call 30 minutes before you arrive.",
          description_public="A three-bedroom farm stay among coconut trees on the Bhavanisagar road, for families and groups "
                             "of up to eight. Full kitchen, garden, bonfire area and parking. A good base for the Bhavanisagar "
                             "dam and the Sathyamangalam hills.")),
    ("Farmland with Coconut Grove – 4 Acres", "agricultural", "sale", "Kadambur", "Kadambur", None, None, None, 6400000, "total",
     ["/images/land2.jpg"],
     dict(plot_area=4, area_unit="acres", amenities=["Borewell", "Coconut trees", "EB connection", "Road access"],
          description_public="Four acres of farmland with a coconut grove, a borewell with EB connection and road access. "
                             "Patta in the owner's name; documents available for review.")),
    ("2 BHK House near Namakkal Bus Stand", "residential", "sale", "Namakkal", "Mohanur Road", "637001", 11.2150, 78.1690,
     4200000, "total", ["/images/house.jpg"],
     dict(bedrooms=2, bathrooms=2, built_area=1100, plot_area=1500, furnishing="unfurnished",
          amenities=["Car parking", "Corporation water", "East facing"],
          description_public="Independent 2 BHK house on a 1,500 sq.ft plot off Mohanur Road, ten minutes from the Namakkal "
                             "bus stand. East facing, with car parking and corporation water.")),
    ("Shop on Paramathi Road", "shop", "rent", "Namakkal", "Paramathi Road", "637001", 11.2230, 78.1580, 28000, "per_month",
     ["/images/commercial.jpg"],
     dict(built_area=600, amenities=["Main road frontage", "Rolling shutter", "Washroom"],
          description_public="600 sq.ft ground-floor shop with main-road frontage on Paramathi Road. Suits a pharmacy, mobile "
                             "store or showroom.")),
    ("Residential Plot – Mettupalayam Road", "land", "sale", "Sathyamangalam", "Mettupalayam Road", "638401", 11.4950, 77.2300,
     1250000, "total", ["/images/land.jpg"],
     dict(plot_area=2000, amenities=["DTCP approved", "Tar road", "Street lights"],
          description_public="2,000 sq.ft plot in a DTCP-approved layout on the Sathyamangalam–Mettupalayam road, with tar "
                             "roads and street lights.")),
    ("2 BHK House for Rent – Perundurai", "residential", "rent", "Perundurai", "Perundurai Town", "638052", 11.2760, 77.5880,
     11000, "per_month", ["/images/house.jpg", "/images/interior.jpg"],
     dict(bedrooms=2, bathrooms=1, built_area=900, furnishing="semi_furnished", service_type="management", mgmt_fee_pct=8,
          amenities=["Two-wheeler parking", "Borewell", "Near schools"],
          description_public="Semi-furnished 2 BHK on the first floor, walking distance from Perundurai bus stand and schools. "
                             "Suits a family or staff of SIPCOT units.")),
]

OWNERS = [("R. Shanmugam", False, "individual"), ("Meena Krishnan", False, "individual"),
          ("S. Ravichandran (Dubai)", True, "individual"), ("Kongu Textiles LLP", False, "company"),
          ("Anitha Velusamy", False, "individual"), ("P. Sengottaiyan", False, "individual"),
          ("Lakshmi Agencies", False, "company")]
OWNER_OF = [0, 1, 0, 3, 3, 1, 2, 2, 0, 4, 4, 0, 1, 2, 4, 4, 5, 5, 6, 6, 5, 0]
LEADS = [  # name, source, stage, interest, budget_min, budget_max, locations, requirements, days_ago, followup_days
    ("Ravi Chandran", "website", "new", "buy", 5000000, 9000000, "Thindal, Nasiyanur", "3 BHK villa, east facing", 1, None),
    ("Priya Mohan", "whatsapp", "contacted", "rent", 12000, 18000, "Perundurai Road", "2 BHK furnished near schools", 6, -1),
    ("Kongu Weaves Pvt Ltd", "broker", "qualified", "lease", 100000, 200000, "SIPCOT, Perundurai", "Factory shed 10,000+ sq.ft with 100 HP", 14, 2),
    ("Arvind Subramanian", "referral", "site_visit", "buy", 6000000, 13000000, "Nasiyanur, Thindal", "4 BHK house with garden", 21, 1),
    ("Saranya Devi", "portal", "requirements", "buy", 1000000, 2000000, "Vijayamangalam, Perundurai", "Residential plot DTCP approved", 9, 3),
    ("Mohammed Irfan", "phone", "matched", "rent", 30000, 45000, "Surampatti, Brough Road", "Office space for 15 people", 12, 0),
    ("Gokul Logistics", "campaign", "negotiation", "lease", 80000, 120000, "Chithode, Erode", "Warehouse with loading dock", 30, 2),
    ("Bharathi Ganesan", "walk_in", "won", "buy", 6500000, 7500000, "Solar", "3 BHK villa", 80, None),
    ("Hari Prasad", "social", "lost", "buy", 3000000, 4500000, "Erode", "2 BHK apartment", 40, None),
    ("Nandhini Rajesh", "website", "new", "short_stay", None, None, "Thindal", "Stay for 4 nights in November", 0, None),
    ("Sathish Kumar", "existing_customer", "contacted", "sell", None, None, "Moolapalayam", "Wants to sell duplex villa", 4, -2),
    ("Janani Venkatesh", "website", "qualified", "buy", 5000000, 7000000, "Periyar Nagar, Surampatti", "3 BHK apartment near bus stand", 7, 1),
    ("Sri Murugan Traders", "phone", "won", "rent", 50000, 70000, "Brough Road", "Showroom on main road", 55, None),
    ("Kavitha Arun", "referral", "won", "rent", 30000, 40000, "Surampatti", "Office space", 70, None),
    ("Manikandan S", "website", "qualified", "buy", 3500000, 4500000, "Namakkal, Mohanur Road", "2 BHK house near the bus stand", 5, 1),
    ("Deepika Ramesh", "whatsapp", "new", "short_stay", None, None, "Sathyamangalam", "Weekend farm stay for 8 people", 1, None),
    ("Velan Agro Foods", "phone", "contacted", "buy", 2000000, 7000000, "Kadambur", "Farmland with a water source", 3, 2),
    ("Prakash Medicals", "walk_in", "won", "rent", 25000, 30000, "Namakkal, Paramathi Road", "Shop on the main road", 35, None),
]
LEAD_BRANCH = {"Perundurai": "br-perundurai", "SIPCOT": "br-perundurai", "Vijayamangalam": "br-perundurai",
               "Namakkal": "br-namakkal", "Sathyamangalam": "br-sathyamangalam", "Kadambur": "br-kadambur"}

POSTS = [
    ("Erode property market: what changed in 2026", "market_update", 18,
     "Prices along the Perundurai Road and Thindal belt held steady this year, while plot enquiries around Vijayamangalam rose.",
     "## The short version\n\nResidential prices in the Thindal, Nasiyanur and Perundurai Road belt held steady through 2026. "
     "Demand for ready villas stayed healthy, and well-priced plots in approved layouts around Vijayamangalam and "
     "Ingur moved faster than last year.\n\n## What buyers are asking for\n\n- East-facing 3 BHK villas between ₹70 lakh and ₹1 crore\n"
     "- DTCP or RERA-approved plots under ₹20 lakh\n- Covered parking and reliable borewell water\n\n"
     "## Rentals\n\nFurnished 2 BHK flats near schools on Perundurai Road rent within two to three weeks when priced "
     "realistically. Industrial sheds near SIPCOT continue to see enquiries from textile and engineering units.\n\n"
     "## Our advice\n\nPrice to the market from day one. Listings that start 10–15% above comparable homes usually "
     "sit for months and end up selling for less."),
    ("A buyer's checklist before you pay an advance", "buying_guide", 35,
     "Ten documents and checks to complete before you pay a token advance for a plot or house in Tamil Nadu.",
     "## Before any advance\n\nAn advance creates obligations. Complete these checks first, with your lawyer:\n\n"
     "- **Parent documents** for at least 30 years, and the latest sale deed\n- **Encumbrance certificate** (EC) from the "
     "TNREGINET portal for the full period\n- **Patta, chitta and adangal** matching the seller's name and survey number\n"
     "- **Approval** – DTCP or local-body approved layout and building plan\n- **Property tax and EB receipts** up to date\n\n"
     "## On the site\n\nWalk the boundaries with the survey sketch. Check road width, water source and drainage. Ask "
     "neighbours about any disputes.\n\n## Costs to budget\n\nAdd stamp duty, registration fees, legal fees and our "
     "brokerage to the price. Our team can give you an estimate of these costs before you commit."),
    ("Renting out your home: how property management works", "owner_guide", 52,
     "From finding a tenant to monthly statements, here is what our management service covers for owners.",
     "## What we take care of\n\nWe advertise the property, screen tenants, arrange the rental agreement and handover, "
     "collect rent and coordinate repairs. Every month you receive a statement showing rent collected, our fee, any "
     "maintenance costs and the amount transferred to you.\n\n## Owner funds are kept separate\n\nRent and deposits are "
     "held in a separate owner-funds account and are never counted as our income. Payouts are made by bank transfer "
     "and the reference is recorded on your statement.\n\n## Owner portal\n\nOwners can sign in to see rent status, "
     "statements, maintenance requests and documents at any time – useful if you live outside Erode or abroad."),
    ("Industrial sheds near SIPCOT Perundurai: a quick guide", "area_guide", 70,
     "Power, access and lease terms to check when you lease a factory shed near SIPCOT.",
     "## Power first\n\nConfirm the sanctioned load in HP or kVA with the latest EB bill, and whether the transformer "
     "is shared.\n\n## Access\n\nCheck road width for 40 ft containers, turning space and truck parking.\n\n## Lease terms\n\n"
     "Typical terms are 3–9 years with 5% escalation every year or 15% every three years, and a security deposit of "
     "6–10 months' rent. Agree in writing who pays for repairs to the roof, flooring and electrical panels."),
    ("Draft: Guideline values and what they mean for you", "legal_tax", 0,
     "How guideline values affect stamp duty in Tamil Nadu.", "Draft notes – to be completed."),
]


async def seed_demo():
    if os.environ.get("SEED_DEMO") != "true" or await db.properties.count_documents({}) > 0:
        return
    import routes_crm as crm
    import routes_deals as deals
    import routes_finance as fin
    import routes_ops as ops
    import routes_content as content
    import routes_channels as chan
    import routes_investors as invr
    import routes_agreements as agr
    from routes_branches import ensure_place
    rnd = random.Random(7)
    pw = os.environ["DEMO_PASSWORD"]
    t = today_ist()
    users = {}
    staff = [(role, role, name, demo_email(role), *DEMO_PROFILE[role][:2], DEMO_PROFILE[role][2], DEMO_PROFILE[role][3])
             for role, name in DEMO_USERS]
    staff += [(k, role, name, f"{mail}@{DEMO_DOMAIN}", des, dept, [br], rep) for k, role, name, mail, des, dept, br, rep in EXTRA_STAFF]
    for k, role, name, email, des, dept, brs, _ in staff:
        u = {"id": new_id(), "email": email, "name": name, "role": role, "active": True, "branch_ids": brs,
             "password_hash": hash_password(pw), "created_at": _iso(t - timedelta(days=120)), "phone": f"+9190000010{len(users):02d}",
             "whatsapp": f"+9190000010{len(users):02d}", "designation": des, "department": dept, "show_in_directory": True,
             "joined_on": (t - timedelta(days=400 + 90 * len(users))).isoformat()}
        await db.users.update_one({"email": u["email"]}, {"$setOnInsert": u}, upsert=True)
        users[k] = await db.users.find_one({"email": u["email"]}, {"_id": 0, "password_hash": 0})
    for k, *_, rep in staff:
        if rep:
            await db.users.update_one({"id": users[k]["id"]}, {"$set": {"reports_to": users[rep]["id"]}})
    admin = await db.users.find_one({"role": "super_admin"}, {"_id": 0, "password_hash": 0}) or users["director"]
    if admin["id"] != users["director"]["id"]:
        await db.users.update_one({"id": admin["id"]}, {"$set": {"designation": "System administrator", "show_in_directory": False}})
    ag, pm, acc, bm, ss = (users[r] for r in ("sales_agent", "property_manager", "accountant", "branch_manager",
                                              "shortstay_ops"))
    director = users["director"]
    BM = {"br-erode": bm, "br-perundurai": users["bm_pdr"], "br-sathyamangalam": users["bm_sty"], "br-kadambur": users["bm_kdb"],
          "br-namakkal": users["bm_nmk"]}
    AGENT = {"br-erode": ag, "br-perundurai": users["agent_pdr"], "br-namakkal": users["agent_nmk"],
             "br-sathyamangalam": users["bm_sty"], "br-kadambur": users["bm_kdb"]}
    for bid, m in BM.items():
        await db.branches.update_one({"id": bid}, {"$set": {"manager_id": m["id"]}})
    owners = []
    for i, (n, nri, kind) in enumerate(OWNERS):
        o = {"id": new_id(), "code": await next_code("owner", "SE-O-"), "name": n, "phone": f"+9190000000{i:02d}",
             "email": f"owner{i}@example.com", "kind": kind, "is_nri": nri, "preferred_contact": "whatsapp",
             "created_at": _iso(t - timedelta(days=150 - i * 7)), "deleted": False}
        owners.append(o)
        await db.owners.insert_one(dict(o))
    # owner portal login for Meena Krishnan (two managed rentals)
    await db.users.update_one({"email": f"owner@{DEMO_DOMAIN}"}, {"$setOnInsert": {
        "id": new_id(), "email": f"owner@{DEMO_DOMAIN}", "name": owners[1]["name"], "role": "owner",
        "owner_id": owners[1]["id"], "active": True, "branch_ids": [], "password_hash": hash_password(pw),
        "created_at": _iso(t - timedelta(days=60))}}, upsert=True)

    props = []
    for i, (title, cat, tx, city, loc, pin, lat, lng, price, unit, imgs, extra) in enumerate(PROPS):
        extra = dict(extra)
        status = extra.pop("status", "published")
        pub = status in ("published", "under_offer", "closed")
        created = t - timedelta(days=140 - i * 6) if i < 16 else t - timedelta(days=70 - (i - 16) * 9)
        br = CITY_BRANCH[city]
        p = {"id": new_id(), "code": await next_code("property", "SE-P-"), "title": title, "category": cat,
             "transaction": tx, "ownership_type": "third_party", "city": city, "locality": loc, "pincode": pin,
             "public_lat": round(lat, 3) if lat else None, "public_lng": round(lng, 3) if lng else None,
             "geo": {"lat": lat, "lng": lng, "accuracy_m": 500, "source": "map_pin", "at": _iso(created)} if lat else None,
             "location_public": "approximate", "price": price, "price_unit": unit,
             "price_on_request": False, "images": imgs, "amenities": extra.pop("amenities", []),
             "area_unit": extra.pop("area_unit", "sq.ft"), "availability": "Immediate", "occupancy": "vacant",
             "status": status, "service_type": extra.pop("service_type", "brokerage"),
             "source": extra.pop("source", "direct"), "owner_id": owners[OWNER_OF[i]]["id"],
             "branch_id": br,
             "assigned_agent": AGENT[br]["id"] if tx in ("sale", "rent", "lease") else None,
             "assigned_manager": (pm if br == "br-erode" else BM[br])["id"] if tx in ("rent", "lease") else (ss["id"] if tx == "short_stay" else None),
             "verification": {"status": "verified", "by": BM[br]["name"], "at": _iso(created + timedelta(days=2))} if status not in (
                 "verification_pending", "draft") else {"status": "pending" if status == "verification_pending" else "not_started"},
             "authorization": {"signed": True, "marketing_authorized": True,
                               "expiry": (t + timedelta(days=25 if i == 4 else 180)).isoformat()} if pub else {},
             "publication_history": [{"at": _iso(created + timedelta(days=3)), "by": BM[br]["name"], "action": "published"}] if pub else [],
             "featured": extra.pop("featured", False), "listing_id": await next_code("listing", "SEL-", 5) if pub else None,
             "published_at": _iso(created + timedelta(days=3)) if pub else None,
             "created_at": _iso(created), "updated_at": _iso(created + timedelta(days=3)), "deleted": False,
             "created_by": BM[br]["id"], **extra}
        props.append(p)
        await db.properties.insert_one(dict(p))
        await ensure_place(city, loc, pin, lat, lng, br, "seed")

    # ---------- leads, activities and visits ----------
    leads = []
    for i, (n, src, st, it, bmin, bmax, locs, req, ago, fu) in enumerate(LEADS):
        created = t - timedelta(days=ago)
        lid = new_id()
        lbr = next((b for k, b in LEAD_BRANCH.items() if k in locs), "br-erode")
        lag = AGENT[lbr]
        lead = {"id": lid, "code": await next_code("lead", "SE-LD-", 5), "name": n, "phone": f"+919000000{101 + i}",
                "email": f"lead{i}@example.com" if i % 3 == 0 else None, "source": src, "stage": st, "interest": it,
                "customer_type": "business" if any(w in n for w in ("Ltd", "Logistics", "Traders", "Weaves")) else (
                    "seller" if it == "sell" else "tenant" if it in ("rent", "lease") else "buyer"),
                "budget_min": bmin, "budget_max": bmax, "preferred_locations": locs, "requirements": req,
                "assigned_to": lag["id"] if st != "new" else None, "branch_id": lbr,
                "next_follow_up": _iso(t + timedelta(days=fu), 11)[:16] if fu is not None else None,
                "lost_reason": "budget_mismatch" if st == "lost" else None, "preferred_contact": "whatsapp",
                "consent": {"marketing": i % 2 == 0, "recorded_at": _iso(created)}, "contacts": [], "deleted": False,
                "created_at": _iso(created, 9 + i % 8), "updated_at": _iso(created + timedelta(days=1)),
                "created_by": None if src == "website" else ag["id"]}
        leads.append(lead)
        await db.leads.insert_one(dict(lead))
        acts = [("created", "Website enquiry" if src == "website" else f"Lead added ({src.replace('_', ' ')})", 0)]
        if st not in ("new",):
            acts += [("call", "Spoke to the customer; shared requirement summary on WhatsApp.", 1)]
        if st in ("qualified", "requirements", "matched", "site_visit", "negotiation", "won"):
            acts += [("whatsapp", "Sent 3 matching listings.", 2), ("stage_change", f"Stage: contacted → {st}", 3)]
        for k, (kind, note, d) in enumerate(acts):
            await db.lead_activities.insert_one({"id": new_id(), "lead_id": lid, "kind": kind, "notes": note,
                                                 "user_id": None if kind == "created" else lag["id"],
                                                 "user_name": "System" if kind == "created" else lag["name"],
                                                 "created_at": _iso(created + timedelta(days=d), 10 + k)})
    L = leads

    async def visit(lead, prop, when, status, feedback=None, source=None):
        v = {"id": new_id(), "lead_id": lead["id"], "lead_name": lead["name"], "property_id": prop["id"],
             "property_title": prop["title"], "property_code": prop["code"], "scheduled_at": when, "status": status,
             "feedback": feedback, "agent_id": AGENT[prop["branch_id"]]["id"] if status != "requested" else prop.get("assigned_agent"),
             "source": source, "created_at": _iso(t - timedelta(days=2)), "notes": None, "branch_id": prop["branch_id"]}
        await db.site_visits.insert_one(dict(v))
    await visit(L[3], props[7], _iso(t - timedelta(days=5), 11)[:16], "completed", "Liked the garden; wants a price revision.")
    await visit(L[3], props[0], _iso(t + timedelta(days=1), 16)[:16], "scheduled")
    await visit(L[2], props[3], _iso(t + timedelta(days=2), 11)[:16], "scheduled")
    await visit(L[11], props[9], _iso(t + timedelta(days=3), 10)[:16], "requested", source="website")
    await visit(L[0], props[0], _iso(t + timedelta(days=4), 17)[:16], "requested", source="website")
    await visit(L[5], props[10], _iso(t - timedelta(days=3), 15)[:16], "completed", "Needs 2 more cabins; considering.")
    await visit(L[14], props[18], _iso(t + timedelta(days=2), 11)[:16], "scheduled")

    # ---------- deals ----------
    async def make_deal(lead, prop, kind, offer, com, signed=True, close=False, splits=None, days_ago=0):
        a_, m_ = AGENT[prop["branch_id"]], BM[prop["branch_id"]]
        d = await deals.create_deal(deals.DealIn(title=f"{lead['name']} – {prop['title']}", deal_type=kind,
                                                 property_id=prop["id"], lead_id=lead["id"], buyer_name=lead["name"],
                                                 buyer_phone=lead["phone"], seller_name=next(
                                                     o["name"] for o in owners if o["id"] == prop["owner_id"])), a_)
        if offer:
            o = await deals.add_offer(d["id"], deals.OfferIn(amount=offer, party=lead["name"]), a_)
            await deals.offer_status(d["id"], o["id"], {"status": "accepted"}, a_)
        if com:
            await deals.set_commission(d["id"], deals.CommissionIn(**com, agreement_signed=signed, splits=splits or []), m_)
        if close:
            await deals.close_deal(d["id"], m_)
            when = _iso(t - timedelta(days=days_ago), 15)
            await db.deals.update_one({"id": d["id"]}, {"$set": {"closed_at": when, "created_at": _iso(t - timedelta(days=days_ago + 20))}})
        return d
    d1 = await make_deal(L[7], props[14], "sale", 7000000, {"type": "percent", "value": 2, "payer": "R. Shanmugam"},
                         close=True, splits=[{"party": "Erode Realty Partners", "kind": "co_broker", "percent": 20}], days_ago=62)
    d2 = await make_deal(L[13], props[10], "rent", 38000, {"type": "months_rent", "value": 1, "payer": "Anitha Velusamy"},
                         close=True, days_ago=40)
    d3 = await make_deal(L[12], props[5], "rent", 65000, {"type": "months_rent", "value": 1, "payer": "Sri Murugan Traders"},
                         close=True, days_ago=8)
    d6 = await make_deal(L[17], props[19], "rent", 28000, {"type": "months_rent", "value": 1, "payer": "Prakash Medicals"},
                         close=True, days_ago=30)
    await db.properties.update_one({"id": props[19]["id"]}, {"$set": {"status": "closed", "closed_as": "rented", "occupancy": "occupied"}})
    d4 = await make_deal(L[3], props[7], "sale", 11800000, {"type": "percent", "value": 1.5, "payer": "S. Ravichandran (Dubai)"})
    await db.properties.update_one({"id": props[7]["id"]}, {"$set": {"status": "under_offer"}})
    d5 = await make_deal(L[6], props[4], "lease", None, None)
    await deals.add_offer(d5["id"], deals.OfferIn(amount=88000, party="Gokul Logistics", terms="3-year lease, 5% yearly escalation"), ag)
    # closed deals took the villa, the office and the showroom off the market
    await db.properties.update_one({"id": props[10]["id"]}, {"$set": {"occupancy": "occupied"}})
    # sales agent asks for a commission change on the open sale -> needs a director's approval
    await deals.set_commission(d4["id"], deals.CommissionIn(type="percent", value=1.25, payer="S. Ravichandran (Dubai)",
                                                             agreement_signed=True, reason="Owner asked for a lower rate after the price revision"), ag)

    # invoices & payments for closed deals
    def key():
        return new_id()
    inv1 = await deals.deal_invoice(d1["id"], acc)
    inv2 = await deals.deal_invoice(d2["id"], acc)
    inv3 = await deals.deal_invoice(d3["id"], acc)
    inv6 = await deals.deal_invoice(d6["id"], acc)
    p6 = await fin.record_payment(inv6["id"], fin.PaymentIn(amount=inv6["total"], method="upi", reference="UPI-77120",
                                                             date=(t - timedelta(days=26)).isoformat(), idempotency_key=key()), acc)
    p1 = await fin.record_payment(inv1["id"], fin.PaymentIn(amount=inv1["total"], method="bank_transfer", reference="UTR4421980",
                                                             date=(t - timedelta(days=50)).isoformat(), idempotency_key=key()), acc)
    p2 = await fin.record_payment(inv2["id"], fin.PaymentIn(amount=20000, method="upi", reference="UPI-88231",
                                                             date=(t - timedelta(days=30)).isoformat(), idempotency_key=key()), acc)
    for inv, days in ((inv1, 62), (inv2, 40), (inv3, 8), (inv6, 30)):
        issued = t - timedelta(days=days)
        await db.invoices.update_one({"id": inv["id"]}, {"$set": {"issue_date": issued.isoformat(),
                                                                   "due_date": (issued + timedelta(days=15)).isoformat(),
                                                                   "created_at": _iso(issued, 16)}})
    for pay, days in ((p1, 50), (p2, 30), (p6, 26)):
        await db.ledger_entries.update_many({"ref_id": pay["invoice_id"], "account": {"$regex": "^revenue:"}},
                                            {"$set": {"posted_at": _iso(t - timedelta(days=days), 12)}})
    mk = await fin.new_invoice(fin.InvoiceIn(type="marketing", customer_name="Kongu Textiles LLP",
                                             lines=[fin.LineIn(description="Professional photography & walkthrough video – industrial shed", qty=1, rate=12000)]), acc)
    pmk = await fin.record_payment(mk["id"], fin.PaymentIn(amount=12000, method="upi", date=(t - timedelta(days=20)).isoformat(),
                                                           reference="UPI-90012", idempotency_key=key()), acc)
    await db.ledger_entries.update_many({"ref_id": mk["id"]}, {"$set": {"posted_at": _iso(t - timedelta(days=20), 12)}})
    await db.invoices.update_one({"id": mk["id"]}, {"$set": {"issue_date": (t - timedelta(days=24)).isoformat(),
                                                             "due_date": (t - timedelta(days=9)).isoformat()}})

    # ---------- leases, rent, deposits ----------
    async def make_lease(prop, tenant, phone, rent, deposit, fee, months_ago, kind="residential", tkind="individual",
                         unpaid_last=1):
        start = _month_shift(t, -months_ago)
        end = (_month_shift(start, 11) + timedelta(days=27))
        ls = await ops.create_lease(ops.LeaseIn(property_id=prop["id"], tenant_name=tenant, tenant_phone=phone,
                                                tenant_kind=tkind, lease_type=kind, start_date=start.isoformat(),
                                                end_date=end.isoformat(), rent=rent, due_day=5, deposit=deposit,
                                                escalation_pct=5, escalation_every_months=12, mgmt_fee_pct=fee,
                                                manager_id=pm["id"]), pm)
        await db.leases.update_one({"id": ls["id"]}, {"$set": {"created_at": _iso(start - timedelta(days=5))}})
        await ops.deposit(ls["id"], ops.DepositIn(amount=deposit, direction="in", reason="Security deposit",
                                                  idempotency_key=key()), pm)
        await db.ledger_entries.update_many({"ref_id": ls["id"], "ledger": "deposits"},
                                            {"$set": {"posted_at": _iso(start - timedelta(days=3), 12)}})
        for s in ls["schedule"][: months_ago + 1 - unpaid_last]:
            due = datetime.fromisoformat(s["due_date"]).date()
            paid_on = min(due + timedelta(days=rnd.randint(-2, 4)), t)
            rp = await ops.record_rent(ls["id"], ops.RentIn(period=s["period"], amount=s["amount"], method="upi",
                                                            reference=f"UPI-{rnd.randint(10000, 99999)}",
                                                            date=paid_on.isoformat(), idempotency_key=key()), pm)
            await db.rent_payments.update_one({"id": rp["id"]}, {"$set": {"created_at": _iso(paid_on, 13)}})
            await db.ledger_entries.update_many({"ref_id": rp["id"]}, {"$set": {"posted_at": _iso(paid_on, 13)}})
        return ls
    ls1 = await make_lease(props[1], "Ramesh & Anu Kannan", "+919000000050", 16000, 50000, 8, 4, unpaid_last=0)
    ls2 = await make_lease(props[5], "Sri Murugan Traders", "+919000000113", 65000, 300000, 6, 2, kind="commercial",
                           tkind="business", unpaid_last=1)
    # the managed flat is let, so it comes off the public catalogue
    await db.properties.update_one({"id": props[1]["id"]}, {"$set": {"status": "closed", "closed_as": "rented"}})
    await ops.handover(ls1["id"], ops.HandoverIn(kind="move_in", date=ls1["start_date"], meter_readings="EB 4521 · Water 118",
                                                 notes="Freshly painted. 2 ACs, wardrobes and kitchen fittings in working order."), pm)
    await ops.handover(ls2["id"], ops.HandoverIn(kind="move_in", date=ls2["start_date"], meter_readings="EB 10422",
                                                 notes="Glass façade cleaned, shutter serviced."), pm)

    # sample documents (generated PDFs), two of them shared with the owner portal
    from pdf import make_pdf
    from core import UPLOAD_DIR, get_settings
    company = await get_settings()
    docs = [
        (props[1], "property", props[1]["id"], "inspection_report", "Move-in inspection – 2 BHK Furnished Apartment.pdf", True,
         make_pdf("Move-in Inspection Report", company, [("Property", props[1]["title"]), ("Lease", ls1["code"]), ("Tenant", "Ramesh & Anu Kannan"), ("Inspected on", ls1["start_date"]), ("Inspected by", pm["name"])],
                  ["Area", "Condition", "Notes"], [["Living room", "Good", "Freshly painted, 1 AC working"], ["Kitchen", "Good", "Modular fittings, chimney serviced"], ["Bedroom 1", "Good", "Wardrobe locks working"], ["Bedroom 2", "Good", "AC serviced"], ["Bathrooms", "Good", "No leaks"], ["Meters", "-", "EB 4521 · Water 118"]], [],
                  "Signed copies are kept on file. Photos are attached to the property record.")),
        (props[0], "property", props[0]["id"], "owner_authorization", "Marketing authorisation – 3 BHK Villa Thindal.pdf", False,
         make_pdf("Owner Marketing Authorisation", company, [("Property", props[0]["title"]), ("Owner", owners[0]["name"]), ("Valid until", props[0]["authorization"].get("expiry", "-")), ("Commission", "As per brokerage agreement")], [], [], [],
                  "The owner authorises Sellandiamman Estates to advertise this property on its website and partner portals.")),
        (owners[1], "owner", owners[1]["id"], "management_agreement", "Property management agreement – Meena Krishnan.pdf", True,
         make_pdf("Property Management Agreement (summary)", company, [("Owner", owners[1]["name"]), ("Properties", "2 BHK Furnished Apartment; Ground-floor Showroom"), ("Management fee", "8% (residential), 6% (commercial) of rent collected"), ("Statements", "Monthly, by the 5th"), ("Payouts", "Bank transfer after settlement")], [], [], [],
                  "Summary for the owner portal. The signed agreement is held at the Erode office.")),
    ]
    for ent, etype, eid, dtype, fname, shared, pdf_bytes in docs:
        stored = new_id()
        (UPLOAD_DIR / stored).write_bytes(pdf_bytes)
        await db.documents.insert_one({"id": new_id(), "stored_name": stored, "size": len(pdf_bytes), "content_type": "application/pdf",
                                       "original_name": fname, "entity_type": etype, "entity_id": eid, "doc_type": dtype,
                                       "expiry_date": ent.get("authorization", {}).get("expiry") if dtype == "owner_authorization" else None,
                                       "notes": None, "version": 1, "is_latest": True, "previous_id": None, "public_approved": False,
                                       "share_with_owner": shared, "uploaded_by": pm["id"], "uploaded_by_name": pm["name"],
                                       "created_at": _iso(t - timedelta(days=20))})

    # maintenance
    v1 = await ops.new_vendor(ops.VendorIn(name="Velu Plumbing Services", phone="+919000000201", trade="Plumbing"), pm)
    v2 = await ops.new_vendor(ops.VendorIn(name="Sakthi Electricals", phone="+919000000202", trade="Electrical", gstin="33ABCDE1234F1Z5"), pm)
    await ops.new_vendor(ops.VendorIn(name="Clean Nest Housekeeping", phone="+919000000203", trade="Cleaning"), pm)
    w1 = await ops.create_wo(ops.WorkOrderIn(property_id=props[1]["id"], title="Kitchen sink leak", category="plumbing",
                                             priority="high", vendor_id=v1["id"], quote_amount=1800, charge_to="owner",
                                             reported_by="Tenant (Ramesh)"), pm)
    last_month = _month_shift(t, -1)
    await ops.update_wo(w1["id"], {"status": "in_progress"}, pm)
    await ops.update_wo(w1["id"], {"status": "completed", "actual_cost": 1650, "note": "Replaced waste coupling"}, pm)
    await db.work_orders.update_one({"id": w1["id"]}, {"$set": {"completed_at": _iso(last_month.replace(day=18), 12),
                                                                "created_at": _iso(last_month.replace(day=16), 10)}})
    await db.ledger_entries.update_many({"ref_id": w1["id"]}, {"$set": {"posted_at": _iso(last_month.replace(day=18), 12)}})
    await ops.create_wo(ops.WorkOrderIn(property_id=props[5]["id"], title="Shutter motor making noise", category="electrical",
                                        priority="medium", vendor_id=v2["id"], quote_amount=4500, charge_to="owner",
                                        due_date=(t + timedelta(days=3)).isoformat()), pm)
    await ops.create_wo(ops.WorkOrderIn(property_id=props[6]["id"], title="AC service before festival bookings",
                                        category="appliance", priority="medium", charge_to="owner",
                                        due_date=(t - timedelta(days=1)).isoformat()), pm)
    await ops.create_wo(ops.WorkOrderIn(property_id=props[12]["id"], title="Repaint before listing", category="painting",
                                        priority="low", charge_to="owner", quote_amount=22000), pm)

    # owner statements: last month settled & paid, the month before settled awaiting transfer
    for m_off, pay_ref in ((-2, "NEFT N2810234"), (-1, None)):
        month = _month_shift(t, m_off).strftime("%Y-%m")
        try:
            st = await ops.settle_statement(owners[1]["id"], {"month": month}, pm)
        except Exception:
            continue
        settle_day = _month_shift(t, m_off + 1).replace(day=3)
        await db.owner_statements.update_one({"id": st["id"]}, {"$set": {"created_at": _iso(settle_day, 11)}})
        await db.ledger_entries.update_many({"ref_id": st["id"]}, {"$set": {"posted_at": _iso(settle_day, 11)}})
        if pay_ref:
            await ops.mark_paid(st["id"], {"reference": pay_ref}, acc)
            await db.owner_statements.update_one({"id": st["id"]}, {"$set": {"paid_at": _iso(settle_day + timedelta(days=1), 15)}})
            await db.ledger_entries.update_many({"ref_id": st["id"], "account": "owner_payout"},
                                                {"$set": {"posted_at": _iso(settle_day + timedelta(days=1), 15)}})

    # ---------- short stays ----------
    async def stay(prop, guest, phone, ci_days, nights, platform="direct", pfee_pct=0, status="confirmed", settle=False,
                   guests=2, rate=None):
        ci = t + timedelta(days=ci_days)
        rate = rate or prop["nightly_rate"]
        gross = rate * nights + 600
        b = await ops.create_booking(ops.BookingIn(property_id=prop["id"], guest_name=guest, guest_phone=phone, guests=guests,
                                                   check_in=ci.isoformat(), check_out=(ci + timedelta(days=nights)).isoformat(),
                                                   nightly_rate=rate, cleaning_fee=600, platform=platform,
                                                   platform_fee=round(gross * pfee_pct / 100), operating_costs=400 * nights,
                                                   source_ref="HM-" + str(rnd.randint(1000, 9999)) if platform != "direct" else None), ss)
        await db.bookings.update_one({"id": b["id"]}, {"$set": {"created_at": _iso(ci - timedelta(days=10), 14)}})
        if status in ("checked_in", "completed"):
            await ops.booking_status(b["id"], {"status": "checked_in"}, ss)
        if status == "completed":
            await ops.booking_status(b["id"], {"status": "completed"}, ss)
            if settle:
                await ops.settle_booking(b["id"], ss)
                await db.ledger_entries.update_many({"ref_id": b["id"]}, {"$set": {"posted_at": _iso(ci + timedelta(days=nights + 1), 12)}})
        return b
    await stay(props[6], "Rahul Mehta", "+919000000301", -58, 3, "airbnb", 15, "completed", True, 4)
    await stay(props[6], "Sowmya & family", "+919000000302", -33, 4, "direct", 0, "completed", True, 5)
    await stay(props[13], "Ajay Singh", "+919000000303", -26, 5, "booking_com", 17, "completed", True, 1)
    await stay(props[6], "Thomas Mathew", "+919000000304", -12, 2, "makemytrip", 18, "completed", False, 3)
    await stay(props[13], "Keerthana R", "+919000000305", -1, 3, "airbnb", 15, "checked_in", False, 2)
    await stay(props[6], "Vivek Anand", "+919000000306", 6, 3, "direct", 0, "confirmed", False, 4)
    await stay(props[6], "Neha Kapoor", "+919000000307", 14, 2, "airbnb", 15, "confirmed", False, 2)
    b_c = await stay(props[13], "Imran Khan", "+919000000308", 20, 2, "direct", 0, "confirmed", False, 2)
    await ops.cancel_booking(b_c["id"], ops.CancelBookingIn(reason="Guest changed travel plans", refund_amount=1500), ss)
    await stay(props[16], "Harish & friends", "+919000000309", -20, 2, "airbnb", 15, "completed", True, 7, 6500)
    await stay(props[16], "Meenakshi Sundar", "+919000000310", -9, 3, "direct", 0, "completed", True, 6)
    await stay(props[16], "Rohit Varma", "+919000000311", 9, 2, "agoda", 18, "confirmed", False, 5)

    # one calendar per home, shared with the booking platforms (iCal links); pricing with weekend and festival rates
    def season(name, m1, d1, m2, d2, rate):
        y = t.year
        s_, e_ = datetime(y, m1, d1).date(), datetime(y + (1 if m2 < m1 else 0), m2, d2).date()
        if e_ < t:
            s_, e_ = s_.replace(year=s_.year + 1), e_.replace(year=e_.year + 1)
        return chan.Season(name=name, start=s_.isoformat(), end=e_.isoformat(), rate=rate)
    await chan.set_pricing(props[6]["id"], chan.PricingIn(base_rate=3200, weekend_rate=3800, cleaning_fee=600, min_nights=1,
                                                          weekly_discount_pct=10, included_guests=4, extra_guest_fee=300,
                                                          seasons=[season("Christmas & New Year", 12, 24, 1, 1, 4200),
                                                                   season("Pongal", 1, 13, 1, 17, 4500)]), ss)
    await chan.set_pricing(props[13]["id"], chan.PricingIn(base_rate=1800, weekend_rate=2100, cleaning_fee=300, min_nights=1,
                                                           weekly_discount_pct=12, monthly_discount_pct=30, included_guests=2), ss)
    await chan.set_pricing(props[16]["id"], chan.PricingIn(base_rate=5500, weekend_rate=6500, cleaning_fee=1000, min_nights=1,
                                                           included_guests=6, extra_guest_fee=500,
                                                           seasons=[season("Christmas & New Year", 12, 24, 1, 1, 7500)]), ss)
    channels = {}
    for prop, plats in ((props[6], ("airbnb", "booking_com", "makemytrip")), (props[13], ("airbnb", "booking_com")),
                        (props[16], ("airbnb", "agoda"))):
        for pl in plats:
            channels[(prop["id"], pl)] = await chan.add_channel(chan.ChannelIn(property_id=prop["id"], platform=pl), ss)

    def ics(events):
        out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sample platform//EN"]
        for uid, a_, b_, summary in events:
            out += ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTART;VALUE=DATE:{(t + timedelta(days=a_)).strftime('%Y%m%d')}",
                    f"DTEND;VALUE=DATE:{(t + timedelta(days=b_)).strftime('%Y%m%d')}", f"SUMMARY:{summary}", "END:VEVENT"]
        return "\r\n".join(out + ["END:VCALENDAR"])
    # Airbnb: a new reservation (guest details to be added) and owner-closed dates; Booking.com: a clash with a direct booking
    await chan.sync_channel(channels[(props[6]["id"], "airbnb")],
                            ics([("HMABC123@airbnb.com", 20, 23, "Reserved"), ("blk-1@airbnb.com", 30, 32, "Airbnb (Not available)")]))
    await chan.sync_channel(channels[(props[6]["id"], "booking_com")], ics([("bk-5512@booking.com", 45, 47, "CLOSED - Not available")]))
    await chan.sync_channel(channels[(props[6]["id"], "makemytrip")], ics([("mmt-88412@makemytrip.com", 7, 9, "Reserved")]))
    await chan.sync_channel(channels[(props[16]["id"], "airbnb")], ics([("HMXYZ789@airbnb.com", 16, 18, "Reserved")]))
    await chan.add_block(chan.BlockIn(property_id=props[16]["id"], start=(t + timedelta(days=40)).isoformat(),
                                      end=(t + timedelta(days=43)).isoformat(), reason="owner_stay", note="Owner's family visit"), ss)
    # a guest asked for dates on the website and is waiting for a call back
    req = await ops.make_booking(ops.BookingIn(property_id=props[16]["id"], guest_name="Deepika Ramesh", guest_phone=L[15]["phone"],
                                               guests=8, check_in=(t + timedelta(days=24)).isoformat(),
                                               check_out=(t + timedelta(days=26)).isoformat(), nightly_rate=6000, cleaning_fee=1000,
                                               platform="website", platform_fee=0, notes="Weekend trip with cousins; vegetarian cook if possible"),
                                 None, "requested", "website", {"lead_id": L[15]["id"], "quote_total": 14000})
    await db.bookings.update_one({"id": req["id"]}, {"$set": {"created_at": _iso(t - timedelta(days=1), 19)}})

    # ---------- company expenses (last six months) ----------
    branch_costs = [("br-erode", 18000, 12000, 6000), ("br-perundurai", 20000, 12000, 5000), ("br-sathyamangalam", 8000, 6000, 2000),
                    ("br-namakkal", 9000, 6000, 2500), ("br-kadambur", 5000, 3000, 1000)]
    for m in range(5, -1, -1):
        mday = _month_shift(t, -m)
        for br, rent, staff_cost, ads in branch_costs:
            town = next(b["name"] for b in BRANCHES if b["id"] == br)
            for cat, desc, amt in (("office_rent", f"{town} office rent", rent), ("salaries", f"{town} field staff incentives", staff_cost + m * 500),
                                   ("marketing", f"{town} listing ads (Facebook & Instagram)", ads + (m % 3) * 500),
                                   ("software", f"{town} phone & internet", 2400 if br != "br-kadambur" else 1200)):
                day = min(mday.replace(day=7 if cat != "marketing" else 15), t)
                e = await fin.new_expense(fin.ExpenseIn(date=day.isoformat(), category=cat, description=desc, amount=amt, branch_id=br,
                                                        vendor="Meta Platforms" if cat == "marketing" else None), acc)
                await db.ledger_entries.update_many({"ref_id": e["id"]}, {"$set": {"posted_at": _iso(day, 18)}})
    # older brokerage income for a fuller 6-month trend
    for m, amt, who, br in ((5, 45000, "Ravi Textiles", "br-perundurai"), (4, 62000, "Sundar & Co", "br-erode"),
                            (3, 38000, "Velmurugan K", "br-sathyamangalam"), (2, 54000, "Sri Kumaran Spinning Mills", "br-perundurai"),
                            (1, 26000, "Gowtham R", "br-namakkal"), (2, 18000, "Selvi Farms", "br-kadambur"),
                            (1, 72000, "Arun Engineering Works", "br-perundurai"), (0, 31000, "Malar Textiles", "br-erode"),
                            (3, 24000, "Kumar Agencies", "br-namakkal"), (4, 41000, "Ganga Weaving Mills", "br-perundurai")):
        inv = await fin.new_invoice(fin.InvoiceIn(type="brokerage", customer_name=who, branch_id=br,
                                                  lines=[fin.LineIn(description="Brokerage commission", qty=1, rate=amt)]), acc)
        day = min(_month_shift(t, -m).replace(day=20), t)
        pay = await fin.record_payment(inv["id"], fin.PaymentIn(amount=amt, method="bank_transfer", date=day.isoformat(),
                                                                reference=f"UTR{rnd.randint(100000, 999999)}", idempotency_key=key()), acc)
        await db.invoices.update_one({"id": inv["id"]}, {"$set": {"issue_date": (day - timedelta(days=6)).isoformat(),
                                                                   "due_date": (day + timedelta(days=9)).isoformat()}})
        await db.ledger_entries.update_many({"ref_id": inv["id"]}, {"$set": {"posted_at": _iso(day, 12)}})
    # a refund request waiting for approval (raised by the accountant, who cannot approve their own)
    await fin.credit_note(inv2["id"], fin.CreditIn(amount=3000, reason="Discount agreed for early payment"),
                          {**acc, "role": "accountant"})

    # ---------- tasks ----------
    for title, who, days, pr, kind in (("Collect signed authorisation – Duplex villa", ag, 2, "high", "documentation"),
                                       ("Shoot photos: 3 BHK Apartment near Bus Stand", users["marketing"], 1, "medium", "general"),
                                       ("Quarterly inspection – 2 BHK Furnished Apartment", pm, 5, "medium", "inspection"),
                                       ("Call back Sathish Kumar about the sale price", ag, -1, "high", "follow_up"),
                                       ("Renew listing authorisation – Warehouse", bm, 10, "medium", "documentation")):
        await db.tasks.insert_one({"id": new_id(), "title": title, "assigned_to": who["id"], "due_date": (t + timedelta(days=days)).isoformat(),
                                   "priority": pr, "status": "open", "kind": kind, "created_by": bm["id"],
                                   "created_at": now_iso(), "comments": []})

    # ---------- insights ----------
    for title, cat, ago, excerpt, body in POSTS:
        p = await content.create_post(content.PostIn(title=title, excerpt=excerpt, body=body, category=cat,
                                                     tags=[cat.replace("_", " ")]), users["marketing"])
        if ago:
            await content.update_post(p["id"], {"status": "published"}, users["director"])
            await db.posts.update_one({"id": p["id"]}, {"$set": {"published_at": _iso(t - timedelta(days=ago), 9),
                                                                 "created_at": _iso(t - timedelta(days=ago + 2), 9)}})
    covers = ["/images/estate.jpg", "/images/interior.jpg", "/images/apartment.jpg", "/images/shed.jpg", None]
    async for i_p in db.posts.find({}, {"_id": 0, "id": 1, "title": 1}):
        idx = next(i for i, x in enumerate(POSTS) if x[0] == i_p["title"])
        await db.posts.update_one({"id": i_p["id"]}, {"$set": {"cover_image": covers[idx]}})

    # an investor-only project update and an article scheduled for later
    p_inv = await content.create_post(content.PostIn(
        title="SIPCOT shed: tenant renews for three more years", category="project_update", audience="investors",
        excerpt="The textile unit leasing the SIPCOT shed has signed a three-year renewal with a 5% yearly increase.",
        body="## What changed\n\nThe tenant in the SIPCOT industrial shed has renewed for three more years, with rent going up 5% "
             "each year. The security deposit was topped up to match the new rent.\n\n## What it means for you\n\n"
             "Quarterly payouts continue as before. The new rent applies from next quarter's payout.\n\n"
             "Questions? Call your relationship manager or reply from your dashboard.", tags=["sipcot", "renewal"]), users["marketing"])
    await content.update_post(p_inv["id"], {"status": "published"}, director)
    await db.posts.update_one({"id": p_inv["id"]}, {"$set": {"published_at": _iso(t - timedelta(days=12), 10), "cover_image": "/images/shed.jpg"}})
    p_sch = await content.create_post(content.PostIn(
        title="Namakkal property guide: localities, prices and rentals", category="area_guide",
        excerpt="Where people are buying and renting in Namakkal, and what to check before you do.",
        body="## Localities\n\nMohanur Road, Paramathi Road and Trichy Road see the most enquiries for homes and shops.\n\n"
             "## Before you buy\n\nCheck the patta, the encumbrance certificate and the approved plan, and walk the boundaries "
             "with the survey sketch.\n\n## Renting\n\nShops on main roads near the bus stand let quickly when priced right.",
        tags=["namakkal"], cover_image="/images/house.jpg"), users["marketing"])
    await content.update_post(p_sch["id"], {"status": "scheduled", "publish_at": _iso(t + timedelta(days=3), 9)}, director)

    await db.campaigns.insert_many([
        {"id": new_id(), "name": "Diwali 2026 – homes", "code": "diwali", "channel": "social", "budget": 15000,
         "start_date": (t - timedelta(days=20)).isoformat(), "created_at": now_iso()},
        {"id": new_id(), "name": "Google Ads – industrial sheds", "code": "gads-sheds", "channel": "search_ads",
         "budget": 25000, "start_date": (t - timedelta(days=45)).isoformat(), "created_at": now_iso()}])
    camp = await db.campaigns.find_one({"code": "gads-sheds"})
    await db.leads.update_one({"id": L[6]["id"]}, {"$set": {"campaign_id": camp["id"]}})
    await db.settings.update_one({"id": "company"}, {"$set": {"testimonials": [
        {"quote": "Sample review: They found a tenant for our flat in two weeks and send a clear statement every month.",
         "name": "Sample owner, Perundurai Road"},
        {"quote": "Sample review: Straightforward about brokerage from the first call. The site visits were well organised.",
         "name": "Sample buyer, Thindal"}]}})
    # ---------- co-investors ----------
    projects = []
    for name, kind, city, loc, prop, br, raise_, mn, irr, yld, months, horizon, status, desc, cover in (
            ("SIPCOT Industrial Shed – Rental Pool", "commercial_lease", "Perundurai", "SIPCOT", props[3], "br-perundurai", 12000000, 1000000,
             11, 8.5, 15, 60, "operating", "Co-ownership of a leased 12,000 sq.ft industrial shed near the SIPCOT Perundurai gate. "
             "Income comes from monthly rent; payouts are made every quarter after maintenance and fees.", "/images/shed.jpg"),
            ("Sathyamangalam Land Bank 2026", "land_bank", "Sathyamangalam", "Mettupalayam Road", None, "br-sathyamangalam", 8000000, 500000,
             14, None, 8, 36, "funded", "Agricultural and residential-conversion land bought in stages along the Mettupalayam road. "
             "Returns come from resale; there are no regular payouts.", "/images/land.jpg"),
            ("Namakkal Retail Units", "commercial_lease", "Namakkal", "Paramathi Road", None, "br-namakkal", 6000000, 500000,
             10, 8, 1, 60, "open", "Two ground-floor shops on Paramathi Road to be bought and let to retail tenants.", "/images/commercial.jpg")):
        pr = await invr.new_project(invr.ProjectIn(name=name, kind=kind, city=city, locality=loc, property_ids=[prop["id"]] if prop else [],
                                                   branch_id=br, target_raise=raise_, min_ticket=mn, target_irr_pct=irr, expected_yield_pct=yld,
                                                   start_date=(_month_shift(t, -months) + timedelta(days=2)).isoformat(), horizon_months=horizon,
                                                   description=desc, cover_image=cover, status=status), director)
        projects.append(pr)
    P1, P2, P3 = projects
    investors = []
    for name, phone, email, kind, city, pan in (("Suresh Palanisamy", "+919000000401", f"investor@{DEMO_DOMAIN}", "individual", "Erode", "4F2K"),
                                                ("Dr. Kavya Raghunathan", "+919000000402", "kavya@example.com", "nri", "Singapore", "8H1M"),
                                                ("Kumaravel HUF", "+919000000403", "kumaravel@example.com", "huf", "Perundurai", "2Q7P")):
        investors.append(await invr.new_investor(invr.InvestorIn(name=name, phone=phone, email=email, kind=kind, city=city, pan_last4=pan,
                                                                 rm_id=director["id"]), director))
    I1, I2, I3 = investors
    invs = {}
    for inv_, prj, amt, months, days, ref in ((I1, P1, 4000000, 15, 5, "NEFT-SP-0001"), (I2, P1, 5000000, 14, 10, "SWIFT-KR-2210"),
                                              (I3, P1, 3000000, 13, 3, "RTGS-KH-1182"), (I1, P2, 2000000, 8, 4, "NEFT-SP-0002"),
                                              (I3, P2, 2500000, 7, 12, "RTGS-KH-1190"), (I2, P2, 1500000, 6, 6, "SWIFT-KR-2291")):
        d_ = (_month_shift(t, -months) + timedelta(days=days)).isoformat()
        m_ = await invr.add_investment(invr.InvestmentIn(investor_id=inv_["id"], project_id=prj["id"], amount=amt, date=d_,
                                                         method="bank_transfer", reference=ref), acc)
        await db.ledger_entries.update_many({"ref_id": m_["id"]}, {"$set": {"posted_at": _iso(datetime.fromisoformat(d_).date(), 12)}})
        invs[(inv_["id"], prj["id"])] = m_
    for prj, months, value, method, note in ((P1, 9, 12600000, "valuer", "Annual valuation by an empanelled valuer"),
                                             (P1, 1, 13400000, "valuer", "Valuation after the lease renewal"),
                                             (P2, 2, 6600000, "guideline", "Guideline value plus recent sales nearby")):
        await invr.add_valuation(prj["id"], invr.ValuationIn(date=(_month_shift(t, -months) + timedelta(days=14)).isoformat(), value=value,
                                                             method=method, note=note), director)
    for q in (12, 9, 6, 3):
        d_ = _month_shift(t, -q) + timedelta(days=9)
        period = f"{_month_shift(d_, -3).strftime('%b')}–{_month_shift(d_, -1).strftime('%b %Y')}"
        res = await invr.distribute(P1["id"], invr.DistributeIn(date=d_.isoformat(), kind="rental_income", amount=255000, tds_pct=10,
                                                                period=period, reference=f"NEFT-BATCH-{q:02d}"), acc)
        for r in res["rows"]:
            await db.ledger_entries.update_many({"ref_id": r["id"]}, {"$set": {"posted_at": _iso(d_, 15)}})
    for prj, days, title, body in ((P1, 40, "Rent received for the quarter", "All three months' rent was received on time. The payout "
                                                                                "will be made on the 10th."),
                                   (P1, 12, "Tenant renewal signed", "The tenant renewed for three more years with a 5% yearly increase."),
                                   (P2, 25, "Survey and fencing done", "The land was re-surveyed and fenced. Patta transfer for the "
                                                                      "second parcel is in progress.")):
        await db.inv_projects.update_one({"id": prj["id"]}, {"$push": {"updates": {
            "id": new_id(), "title": title, "body": body, "by": director["name"], "at": _iso(t - timedelta(days=days), 11)}}})
    # investor dashboard login for Suresh Palanisamy
    await db.users.update_one({"email": f"investor@{DEMO_DOMAIN}"}, {"$setOnInsert": {
        "id": new_id(), "email": f"investor@{DEMO_DOMAIN}", "name": I1["name"], "role": "investor", "investor_id": I1["id"],
        "active": True, "branch_ids": [], "password_hash": hash_password(pw), "created_at": _iso(t - timedelta(days=400))}}, upsert=True)
    rep_pdf = make_pdf("Quarterly Project Report – SIPCOT Industrial Shed", company,
                       [("Project", P1["name"]), ("Period", "Last quarter"), ("Occupancy", "100% (one tenant)"),
                        ("Rent collected", "3 of 3 months"), ("Next payout", "10th of next month")],
                       ["Item", "Amount (Rs.)"], [["Rent received", "5,40,000"], ["Maintenance & insurance", "(18,000)"],
                                                  ["Management fee", "(27,000)"], ["Set aside for repairs", "(2,40,000)"],
                                                  ["Paid out to investors", "2,55,000"]], [],
                       "Sample report for the demo. Figures are illustrative.")
    stored = new_id()
    (UPLOAD_DIR / stored).write_bytes(rep_pdf)
    await db.documents.insert_one({"id": new_id(), "stored_name": stored, "size": len(rep_pdf), "content_type": "application/pdf",
                                   "original_name": "Quarterly report – SIPCOT shed.pdf", "entity_type": "inv_project", "entity_id": P1["id"],
                                   "doc_type": "report", "expiry_date": None, "notes": None, "version": 1, "is_latest": True,
                                   "previous_id": None, "public_approved": False, "share_with_investor": True, "uploaded_by": director["id"],
                                   "uploaded_by_name": director["name"], "created_at": _iso(t - timedelta(days=40))})

    # ---------- agreements (stamp-paper layout, Word / PDF) ----------
    await db.settings.update_one({"id": "company"}, {"$set": {"agreement_signatory": director["name"],
                                                              "agreement_signatory_designation": "Managing Director"}})
    from core import clear_settings_cache
    clear_settings_cache()

    async def agreement(tpl, etype, eid, who, extra=None, final=False, share=False, estamp=None):
        data, _ = await agr.prefill(tpl, etype, eid, who)
        a = await agr.create(agr.AgreementIn(template=tpl, entity_type=etype, entity_id=eid, data={**data, **(extra or {})},
                                             estamp_no=estamp, estamp_date=t.isoformat() if estamp else None), who)
        if final:
            await agr.finalise(a["id"], {"share": share}, who)
        return a
    await agreement("rental_residential", "lease", ls1["id"], pm, {"lessor_address": "12, Gandhi Street, Erode 638011",
                                                                 "lessee_address": "Flat 3B, Perundurai Road, Erode 638011",
                                                                 "lessee_age": 38, "lessor_age": 52}, final=True, share=True,
                    estamp="IN-TN00000000000000X")
    await agreement("lease_commercial", "lease", ls2["id"], pm, {"lessor_address": "12, Gandhi Street, Erode 638011"})
    await agreement("brokerage_authorisation", "property", props[0]["id"], bm)
    await agreement("investor_coinvestment", "investment", invs[(I1["id"], P1["id"])]["id"], director,
                    {"investor_address": "45, Teachers Colony, Erode 638011"}, final=True, share=True)
    await customers_demo(owners)
    await db.settings.update_one({"id": "company"}, {"$set": {"targets": {"monthly_revenue": {
        "br-erode": 150000, "br-perundurai": 120000, "br-namakkal": 50000, "br-sathyamangalam": 40000, "br-kadambur": 20000}}}})

    # leave a couple of fresh notifications for the director
    from core import notify
    await notify([users["director"]["id"], admin["id"]], "Approval needed: commission change",
                 f"{d4['code']}: commission → 1.25%", "/erp/approvals", dedupe="seed-ap")
    logger.info("Demo data seeded")


async def customers_demo(owners):
    from routes_customers import backfill_customers
    await backfill_customers()
    for o, tags in ((owners[2], ["nri", "priority"]), (owners[3], ["corporate"]), (owners[1], ["owner-portal"])):
        oc = await db.owners.find_one({"id": o["id"]}, {"_id": 0, "customer_id": 1})
        if oc and oc.get("customer_id"):
            await db.customers.update_one({"id": oc["customer_id"]}, {"$addToSet": {"tags": {"$each": tags}}})
    for i in await db.investors.find({}, {"_id": 0, "customer_id": 1, "kind": 1}).to_list(100):
        if i.get("customer_id"):
            await db.customers.update_one({"id": i["customer_id"]}, {"$addToSet": {"tags": {"$each": ["investor"] + (["nri"] if i["kind"] == "nri" else [])}}})


async def seed():
    await ensure_indexes()
    await seed_core()
    await seed_demo()
    await migrate()
