"""Builds the data for the hosted preview from the real backend.

Runs the FastAPI app in-process on an in-memory database with the sample data, records the PDFs the server
produces (invoices, receipts, rent receipts, owner statements, deal summaries, brochures) as page images, and
writes a JSON snapshot of the collections. The preview's in-browser API (frontend/src/demo) starts from it.

    python demo/export.py            # writes frontend/src/demo/snapshot.json and demo/build/pdf/*.webp
"""
import asyncio
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = ROOT / "frontend/src/demo/snapshot.json"
OUT_PDF = ROOT / "demo/build/pdf"
TMP = Path(tempfile.mkdtemp(prefix="estates-demo-"))

os.environ.update({
    "MONGO_URL": "mongomock://demo", "DB_NAME": "estates_demo", "JWT_SECRET": "demo-export-" + "x" * 40,
    "SEED_DEMO": "true", "DEMO_PASSWORD": "Demo@12345", "ADMIN_EMAIL": "admin@demo.sellandiamman.test",
    "ADMIN_PASSWORD": "Demo@12345", "BCRYPT_ROUNDS": "4", "DISABLE_AUTOMATIONS": "true", "COOKIE_SECURE": "false",
    "SITE_URL": "https://estates.sellandiamman.example", "CORS_ORIGINS": "*", "UPLOAD_DIR": str(TMP / "uploads"),
})
sys.path.insert(0, str(ROOT / "backend"))

import httpx  # noqa: E402
import pyotp  # noqa: E402
from PIL import Image  # noqa: E402
import server  # noqa: E402
import routes_admin  # noqa: E402
from core import db, today_ist, now_iso  # noqa: E402
from routes_auth import _qr_svg  # noqa: E402

DROP = {"sessions", "login_attempts", "password_reset_tokens", "booking_nights"}
SECRET_FIELDS = ("password_hash", "mfa_secret", "mfa_pending_secret", "mfa_recovery")


def rasterise(pdf_bytes, name):
    """PDF -> one WebP per page (A4 at ~150 dpi), returns the file names."""
    src = TMP / f"{name}.pdf"
    src.write_bytes(pdf_bytes)
    subprocess.run(["pdftoppm", "-r", "150", "-png", str(src), str(TMP / name)], check=True)
    pages = sorted(TMP.glob(f"{name}-*.png")) or sorted(TMP.glob(f"{name}.png"))
    out = []
    for i, p in enumerate(pages, 1):
        fn = f"{name}-{i}.webp"
        Image.open(p).convert("RGB").save(OUT_PDF / fn, "WEBP", quality=72, method=6)
        out.append(fn)
        p.unlink()
    return out


async def main():
    if OUT_PDF.exists():
        shutil.rmtree(OUT_PDF)
    OUT_PDF.mkdir(parents=True)
    await server.startup()
    await routes_admin.run_automations()
    transport = httpx.ASGITransport(app=server.app)
    pdfs = {}
    async with httpx.AsyncClient(transport=transport, base_url="http://demo") as c:
        r = await c.post("/api/auth/login", json={"email": "admin@demo.sellandiamman.test", "password": "Demo@12345"},
                         headers={"x-forwarded-for": "10.9.9.9"})
        assert r.status_code == 200, r.text
        n = 0

        async def grab(path, name, also=()):
            nonlocal n
            res = await c.get(f"/api{path}")
            if res.status_code != 200 or not res.content.startswith(b"%PDF"):
                print("skip", path, res.status_code)
                return
            files = rasterise(res.content, name)
            for pth in (path, *also):
                pdfs[pth] = files
            n += 1

        for i, inv in enumerate(await db.invoices.find({}, {"_id": 0}).to_list(500)):
            await grab(f"/invoices/{inv['id']}/pdf", f"invoice-{i}")
        for i, p in enumerate(await db.payments.find({}, {"_id": 0}).to_list(500)):
            await grab(f"/payments/{p['id']}/receipt.pdf", f"receipt-{i}")
        for i, d in enumerate(await db.deals.find({}, {"_id": 0}).to_list(500)):
            await grab(f"/deals/{d['id']}/summary.pdf", f"deal-{i}")
        for i, p in enumerate(await db.rent_payments.find({}, {"_id": 0}).to_list(500)):
            await grab(f"/rent-payments/{p['id']}/receipt.pdf", f"rent-{i}", (f"/portal/rent-receipts/{p['id']}/pdf",))
        owner_user = await db.users.find_one({"role": "owner"}, {"_id": 0})
        for i, o in enumerate(await db.owners.find({}, {"_id": 0}).to_list(100)):
            months = sorted({r["period"] for r in await db.rent_payments.find({"owner_id": o["id"]}, {"_id": 0}).to_list(500)})
            for m in months:
                also = (f"/portal/statements/{m}/pdf",) if owner_user and owner_user["owner_id"] == o["id"] else ()
                await grab(f"/owners/{o['id']}/statement.pdf?month={m}", f"statement-{i}-{m}", also)
        for p in await db.properties.find({"listing_id": {"$ne": None}, "status": {"$in": ["published", "under_offer"]}},
                                          {"_id": 0}).to_list(200):
            await grab(f"/public/properties/{p['listing_id']}/brochure.pdf", f"brochure-{p['listing_id']}")
        for i, d in enumerate(await db.documents.find({"content_type": "application/pdf"}, {"_id": 0}).to_list(200)):
            link = (await c.post(f"/api/documents/{d['id']}/link")).json()["url"]
            res = await c.get(link)
            if res.status_code == 200:
                pdfs[f"doc:{d['id']}"] = rasterise(res.content, f"doc-{i}")
                n += 1
        print(f"recorded {n} PDFs")

    snap = {}
    for name in sorted(await db.list_collection_names()):
        if name in DROP:
            continue
        rows = await db[name].find({}, {} if name == "counters" else {"_id": 0}).to_list(100000)
        if name == "users":
            for u in rows:
                for k in SECRET_FIELDS:
                    u.pop(k, None)
        if name == "audit_logs":
            rows = sorted(rows, key=lambda r: r.get("at") or "", reverse=True)[:400]
        snap[name] = rows
    secret = "JBSWY3DPEHPK3PXPSELLANDIAM"[:32]
    uri = pyotp.TOTP(secret).provisioning_uri(name="you@sellandiamman.example", issuer_name="Sellandiamman Estates")
    meta = {"exported_at": now_iso(), "today": today_ist().isoformat(), "pdfs": pdfs,
            "mfa_demo": {"secret": secret, "otpauth_uri": uri, "qr_svg": _qr_svg(uri)}}
    OUT_JSON.write_text(json.dumps({"meta": meta, "db": snap}, default=str, separators=(",", ":")))
    size = OUT_JSON.stat().st_size
    print(f"snapshot: {len(snap)} collections, {size / 1024:.0f} KB; pdf images: {len(list(OUT_PDF.iterdir()))}")
    shutil.rmtree(TMP, ignore_errors=True)


asyncio.run(main())
