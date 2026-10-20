import os
import asyncio
import logging
from urllib.parse import urlparse
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from core import client, db, logger, SITE_URL
import routes_auth
import routes_public
import routes_crm
import routes_props
import routes_deals
import routes_finance
import routes_ops
import routes_admin
import routes_content
import routes_portal
import routes_branches
import routes_customers
import routes_channels
import routes_investors
import routes_agreements
import routes_cms
import routes_ceo
import routes_seo
from seed import seed

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
APP_VERSION = "2026.10.3"
app = FastAPI(title="Sellandiamman Estates API", version=APP_VERSION, docs_url="/api/docs",
              openapi_url="/api/openapi.json")

for r in (routes_auth, routes_public, routes_crm, routes_props, routes_deals, routes_finance, routes_ops, routes_admin,
          routes_content, routes_portal, routes_branches, routes_customers, routes_channels, routes_investors, routes_agreements,
          routes_cms, routes_ceo, routes_seo):
    app.include_router(r.router, prefix="/api")

ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", SITE_URL).split(",") if o.strip()]


@app.middleware("http")
async def security(request: Request, call_next):
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        origin = request.headers.get("origin")
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
        same_origin = origin and urlparse(origin).netloc == host.split(",")[0].strip()
        if origin and not same_origin and "*" not in ALLOWED_ORIGINS and origin not in ALLOWED_ORIGINS:
            return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
    try:
        resp = await call_next(request)
    except Exception:
        logger.exception("Unhandled error on %s", request.url.path)
        resp = JSONResponse({"detail": "Something went wrong. Please try again."}, status_code=500)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
    if request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https":
        resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/public"):
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=ALLOWED_ORIGINS, allow_methods=["*"],
                   allow_headers=["*"])


async def _automation_loop():
    while True:
        await asyncio.sleep(3600)
        try:
            await routes_admin.run_automations()
        except Exception:
            logger.exception("Automation run failed")


async def _frequent_loop():
    while True:
        await asyncio.sleep(900)
        try:
            await routes_admin.run_frequent()
        except Exception:
            logger.exception("Calendar sync / scheduled posts run failed")


@app.on_event("startup")
async def startup():
    await seed()
    if os.environ.get("DISABLE_AUTOMATIONS") != "true":
        asyncio.create_task(_automation_loop())
        asyncio.create_task(_frequent_loop())


@app.get("/api/health")
async def health():
    try:
        await db.command("ping")
        return {"ok": True, "db": "ok", "version": APP_VERSION}
    except Exception:
        return JSONResponse({"ok": False, "db": "unreachable", "version": APP_VERSION}, status_code=503)


@app.on_event("shutdown")
async def shutdown():
    client.close()
