# Sellandiamman Estates — Website, Staff Workspace & Owner Portal

Real-estate services for Erode and Perundurai: a public website, a private staff workspace at `/erp` and an owner
portal at `/owner`, served from one FastAPI backend and one MongoDB database. React (Create React App, Tailwind,
shadcn/ui) on the front end. **To put it on a server, follow [DEPLOYMENT.md](DEPLOYMENT.md).** What changed in this
round: [WHATS_NEW.md](WHATS_NEW.md).

## What's in it

**Website** – home with search, catalogue (grid, list and map views, filters), property pages (gallery, enquiry,
site-visit booking, WhatsApp, share with link previews, PDF brochure, EMI estimate), saved properties with side-by-side
comparison, calculators (home-loan EMI, affordability, Tamil Nadu stamp duty & registration, area converter, rental
yield, lease escalation, short-stay income), Insights articles, "post your requirement", list-your-property with photos,
8 service pages, about/contact/FAQ/legal pages, structured data and sitemap for search engines.

**Staff workspace** – dashboard (quoted / expected / earned commission kept separate from invoiced and collected cash),
calendar, CRM with pipeline, matching listings and WhatsApp sharing, website visit requests, property register with
verification and marketing-authorisation workflow, owners, deals and commission splits with approvals, invoices,
receipts, credit notes, five separate ledgers with reversals, expenses, leases with rent schedules, deposits and
receipts, owner statements and payouts, maintenance work orders and vendors, short-stay bookings and settlements,
private documents with signed links and versions, tasks, Insights editor, reports (CSV), users and roles, settings with
a go-live checklist, audit log, notifications and hourly reminders, 2-step sign-in.

**Owner portal** – each owner sees only their own properties, rent and receipts, monthly statements (PDF), maintenance
requests, short-stay payouts and the documents shared with them.

**Brand** – the SA mark is built in as vector artwork (`frontend/src/components/brand`, `backend/brand.py`) and used on
the website, staff app, owner portal, PDFs, favicons, app icons and the social share image (`frontend/public/brand`).

## Layout

- `backend/core.py` – database, sessions, roles and permissions (`PERMS`, `OWN_SCOPE`, `require()`, `scope()`), audit, notifications, email, uploads.
- `backend/logic.py` – pure business rules (commission, invoice/GST, short-stay split, owner statement, workflows). Unit-tested.
- `backend/routes_*.py` – `auth` (sign-in, 2-step, users), `public` (website, enquiries, brochures, link previews, sitemap), `crm`, `props`, `deals`, `finance`, `ops` (leases, statements, maintenance, short stays), `admin` (dashboard, calendar, reports, documents, tasks, approvals, settings, audit), `content` (Insights), `portal` (owner portal).
- `backend/pdf.py` – branded PDFs (invoices, receipts, rent receipts, statements, deal summaries, brochures).
- `frontend/src/pages/public`, `pages/erp`, `pages/owner` – screens; `lib/` – API client, sign-in, dialogs, calculators, Markdown.
- `deploy/` – Caddy (HTTPS, security headers) and the web image; `docker-compose.yml`; `scripts/` – backup and restore.
- API docs (OpenAPI): `/api/docs`.

## Roles (enforced on the server; r=read w=write a=approve e=export p=publish)

| Role | Key access |
|---|---|
| Super Administrator | Everything incl. users, settings, audit |
| Owner / Director | All business modules incl. approvals and finance; users/settings read |
| Branch / Operations Manager | Leads, properties (verify/publish), deals, leases, maintenance, short-stay, CMS; finance read; branch-scoped |
| Sales / Brokerage Agent | Own assigned leads, deals, properties only; no finance |
| Property Manager | Own leases, maintenance, documents; properties read |
| Finance / Accountant | Finance read/write/export, reports |
| Marketing | Publish listings, CMS and Insights, campaigns; internal address/notes/owner hidden |
| Short-Stay Operations | Bookings, cleaning tasks, maintenance; sees check-in instructions |
| Read-Only Auditor | Read and export reports and audit log, no writes |
| Property Owner (portal) | Only their own records, through `/api/portal/*` |

Records outside a user's scope return 404; refused actions return 403 and are audit-logged. Approvals (commission change
after it is first set, refunds/credit notes, ledger reversals) need approve rights and a different person.
2-step sign-in (authenticator app + recovery codes) can be required per role in Settings.

## Money rules

Ledgers: `company`, `owner_funds`, `deposits`, `commission_payable`, `shortstay_owner`. Only invoice receipts, settled
management fees and short-stay fees post to company revenue. Entries are never edited; corrections are reversals.
Payments and rent use idempotency keys so retries cannot duplicate them. Owner payouts are never automatic – staff
record the bank transfer reference. GST is off until the accountant sets the rate. Short-stay nights are reserved one
row per night with a unique index, so two people cannot book the same dates at once.

## Development and tests

```bash
cd backend && pip install -r requirements-dev.txt && cp .env.example .env   # MONGO_URL=mongomock://local for an in-memory DB
uvicorn server:app --port 8001 --reload        # SEED_DEMO=true loads sample data
cd frontend && yarn install && yarn start      # proxies /api to :8001
cd backend && python -m pytest tests -q        # 47 API and unit tests against the running backend
```

Sample logins when `SEED_DEMO=true` (never on the live server): `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `.env`, and
`director@`, `branch.manager@`, `sales.agent@`, `property.manager@`, `accountant@`, `marketing@`, `shortstay.ops@`,
`auditor@`, `owner@demo.sellandiamman.test` with `DEMO_PASSWORD`.

## Data retention

Leads/enquiries: delete or anonymise on request (lead page → Remove personal data) or 3 years after last activity.
Financial records: retain 8 years (confirm with your CA). KYC documents: store only when needed; never shared with owners.

## Integrations that need your accounts

- **Email** (SMTP) – password links and staff alerts. Without it, links are shown on screen for an admin to share.
- **WhatsApp** – click-to-chat links with the number from Settings. No automated WhatsApp Business messages.
- **Cloudflare Turnstile** – optional "I am human" check on public forms (honeypot and rate limits always apply).
- **Maps** – OpenStreetMap tiles; set a provider key for heavy traffic.
- **Booking platforms** (Airbnb etc.) – bookings are entered by hand; no live sync.
- **Accounting / GST filing** – export CSVs for your accountant.

## Known limits

Money is stored as 2-decimal numbers (rounded at every step). The rate limiter is in memory (one backend process).
Legal page texts are templates for your lawyer to review. Listing coordinates are approximate by design.
