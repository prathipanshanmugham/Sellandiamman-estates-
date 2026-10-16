# Sellandiamman Estates — Website + ERP

One FastAPI backend + one MongoDB database serve both the public website (`/`) and the login-protected ERP (`/erp`).
Frontend: React (CRA + Tailwind + shadcn/ui). The brief suggested Next.js/PostgreSQL; the existing React/FastAPI/MongoDB
environment was kept (as the brief allows) to avoid replacing working infrastructure.

## Architecture
- `backend/core.py` – DB, sessions, RBAC (`PERMS`, `OWN_SCOPE`, `require()`, `scope()`), audit, notifications, uploads.
- `backend/logic.py` – pure business rules (commission, invoice/GST, short-stay split, owner statement, workflows). Unit-tested.
- `routes_public.py` (search, detail, enquiry, owner submission, sitemap) · `routes_crm.py` · `routes_props.py` ·
  `routes_deals.py` · `routes_finance.py` · `routes_ops.py` (leases, statements, maintenance, short-stay) ·
  `routes_admin.py` (dashboard, reports, documents, tasks, notifications, approvals, settings, audit).
- API docs (OpenAPI): `/api/docs`.

## Setup (development)
1. `cp backend/.env.example backend/.env` and fill in values. Set `frontend/.env` `REACT_APP_BACKEND_URL`.
2. `pip install -r backend/requirements.txt`, `cd frontend && yarn install`.
3. Start backend `uvicorn server:app --port 8001` and frontend `yarn start`. Indexes and the first Super Admin are created on startup.
4. Tests: `cd backend && python -m pytest tests -q`.
5. Docker: `docker-compose.yml` (Mongo + backend + static frontend). Put an HTTPS reverse proxy in front routing `/api` to the backend.

## Admin account setup (production)
No default password exists in code. Set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` in the environment before first start,
sign in, change the password (Settings → Change password), then remove `ADMIN_PASSWORD` from the environment.
Create all other staff from **Users & Roles**; without an initial password a one-time activation link is generated.
Keep `SEED_DEMO="false"` in production.

## Roles (server-enforced; r=read w=write a=approve e=export p=publish)
| Role | Key access |
|---|---|
| Super Administrator | Everything incl. users, settings, audit |
| Owner / Director | All business modules incl. approvals and finance; users/settings read |
| Branch / Operations Manager | Leads, properties (verify/publish), deals, leases, maintenance, short-stay, CMS; finance read; branch-scoped |
| Sales / Brokerage Agent | Own assigned leads, deals, properties only; no finance |
| Property Manager | Own leases, maintenance, documents; properties read |
| Finance / Accountant | Finance rwe, reports; no documents module |
| Marketing | Publish listings, CMS, campaigns; internal address/notes/owner hidden |
| Short-Stay Operations | Bookings, cleaning tasks, maintenance; sees check-in instructions |
| Read-Only Auditor | Read + export of reports and audit log, no writes |

Records outside a user's scope return 404; disallowed actions return 403 and are audit-logged.
Approvals (commission change after first set, refunds/credit notes, ledger reversals) need approve rights and a different user.

## Financial separation
Ledgers: `company`, `owner_funds`, `deposits`, `commission_payable`, `shortstay_owner`. Only invoice receipts, settled
management fees and short-stay fees post to company revenue. Entries are immutable; corrections are reversal entries.
Payments/rent use idempotency keys (unique index) so retries cannot duplicate transactions. Owner payouts are never
automatic — staff record the bank transfer reference. GST is off by default; the accountant sets the rate in Settings.

## Backup & restore (tested)
- Backup: `mongodump --uri "$MONGO_URL" --db "$DB_NAME" --archive=backup-$(date +%F).gz --gzip` and `tar czf uploads.tgz $UPLOAD_DIR`. Schedule daily; keep 30 days off-site.
- Restore: `mongorestore --uri "$MONGO_URL" --archive=backup-YYYY-MM-DD.gz --gzip --drop`, then extract uploads to `UPLOAD_DIR`.
- Verification drill: restore into a scratch DB with `--nsFrom "$DB_NAME.*" --nsTo "restore_check.*"`, compare collection counts, drop it.

## Data retention
Leads/enquiries: delete or anonymise on request or 3 years after last activity. Financial records: retain 8 years
(confirm with your CA). KYC documents: store only when legitimately required; delete when no longer needed.

## Integrations needing credentials (not configured)
- Email provider — activation/reset links and notification emails are **logged to the server log (dev mode)**.
- WhatsApp Business API — **click-to-chat links only (manual)**; set the number in Settings. No automated messages.
- Maps provider — detail page uses an OpenStreetMap embed only when approved coordinates are entered.
- Booking platforms (Airbnb etc.) — **manual entry only**, no live sync.
- Accounting / GST filing — not integrated; export CSVs.
- Object storage — files stored on server disk at `UPLOAD_DIR` (private; served only via 5-minute signed links).

## Known limitations
MFA not implemented · no blog/market-updates CMS · no catalogue map view · leave/attendance not enabled ·
CAPTCHA not added (honeypot + rate limiting) · in-memory rate limiter (use Redis for multi-instance) ·
money stored as 2-decimal floats · legal page texts are templates for legal review.
