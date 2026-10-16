import os
import asyncio
import logging
from urllib.parse import urlparse
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from core import client, logger
import routes_auth
import routes_public
import routes_crm
import routes_props
import routes_deals
import routes_finance
import routes_ops
import routes_admin
from seed import seed

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
app = FastAPI(title="Sellandiamman Estates API", docs_url="/api/docs", openapi_url="/api/openapi.json")

for r in (routes_auth, routes_public, routes_crm, routes_props, routes_deals, routes_finance, routes_ops, routes_admin):
    app.include_router(r.router, prefix="/api")

ALLOWED_ORIGINS = [o.strip() for o in os.environ["CORS_ORIGINS"].split(",") if o.strip()]


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
    if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/public"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=ALLOWED_ORIGINS, allow_methods=["*"],
                   allow_headers=["*"])


async def _automation_loop():
    while True:
        await asyncio.sleep(3600)
        try:
            await routes_admin.run_automations()
        except Exception:
            logger.exception("Automation run failed")


@app.on_event("startup")
async def startup():
    await seed()
    asyncio.create_task(_automation_loop())


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.on_event("shutdown")
async def shutdown():
    client.close()
