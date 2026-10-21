# Sellandiamman Estates — Website, Staff Workspace, Owner & Investor Portals

Real-estate services from five branches – Perundurai (head office), Erode, Kadambur, Sathyamangalam and Namakkal: a
public website, a private staff workspace at `/erp`, an owner portal at `/owner` and an investor dashboard at
`/investor`, served from one FastAPI backend and one MongoDB database. React (Create React App, Tailwind,
shadcn/ui) on the front end. **To put it on a server, follow [DEPLOYMENT.md](DEPLOYMENT.md).** What changed in this
round: [WHATS_NEW.md](WHATS_NEW.md).

## What's in it

**Website** – home (sections edited in the website editor) with search, catalogue (grid, list and map views, filters),
property pages (gallery, enquiry, site-visit booking, WhatsApp, share with link previews, PDF brochure, EMI estimate),
free dates and stay requests for short-stay homes, a page per town and locality, saved properties with comparison,
Insights articles, "post your requirement", list-your-property with photos and a map pin / GPS location, service pages,
about/contact/FAQ/legal pages. Pages are served with their text and schema.org data for search engines and AI
assistants (`sitemap.xml`, `robots.txt`, `llms.txt`).

**Staff workspace** – CEO dashboard (health score, branch league, report PDF/CSV for any dates, branch, town and
locality), dashboard (quoted / expected / earned commission kept separate from invoiced and collected cash), branch
picker, customers (one record per person, consent, KYC, merge, DPDP requests), co-investors and projects (payouts with
TDS, XIRR, statements), agreement generator (Word / PDF on stamp paper), short stays on many platforms with iCal
calendar sync, website editor, team and organisation chart, branches and places, internal calculators, calendar, CRM with pipeline, matching listings and WhatsApp sharing, website visit requests, property register with
verification and marketing-authorisation workflow, owners, deals and commission splits with approvals, invoices,
receipts, credit notes, five separate ledgers with reversals, expenses, leases with rent schedules, deposits and
receipts, owner statements and payouts, maintenance work orders and vendors, short-stay bookings and settlements,
private documents with signed links and versions, tasks, Insights editor, reports (CSV), users and roles, settings with
a go-live checklist, audit log, notifications and hourly reminders, 2-step sign-in.

**Owner portal** – each owner sees only their own properties, rent and receipts, monthly statements (PDF), maintenance
requests, short-stay payouts and the documents shared with them.

**Investor dashboard** – each co-investor sees their holdings, current value, payouts, returns (XIRR), project updates,
statements (PDF) and shared documents.

**Brand** – the SA mark is built in as vector artwork (`frontend/src/components/brand`, `backend/brand.py`) and used on
the website, staff app, owner portal, PDFs, favicons, app icons and the social share image (`frontend/public/brand`).

## Layout

- `backend/core.py` – database, sessions, roles and permissions (`PERMS`, `OWN_SCOPE`, `require()`, `scope()`), audit, notifications, email, uploads.
- `backend/logic.py` – pure business rules (commission, invoice/GST, short-stay split, owner statement, workflows). Unit-tested.
- `backend/routes_*.py` – `auth` (sign-in, 2-step, users), `public` (website, enquiries, brochures, link previews), `crm`, `props`, `deals`, `finance`, `ops` (leases, statements, maintenance, bookings), `admin` (dashboard, calendar, reports, documents, tasks, approvals, settings, audit), `content` (Insights), `portal` (owner portal), `branches` (branches, places, team chart), `customers`, `channels` (short-stay platforms, iCal sync, pricing, stay requests), `investors` (incl. investor dashboard), `agreements`, `cms` (website editor), `ceo` (health score and report), `seo` (server-rendered pages, sitemap, robots, llms.txt).
- `backend/agreements.py` – agreement templates and Word / PDF rendering in stamp-paper layout; `backend/ical.py` – calendar files.
- `backend/pdf.py` – branded PDFs (invoices, receipts, rent receipts, statements, deal summaries, brochures).
- `frontend/src/pages/public`, `pages/erp`, `pages/owner` – screens; `lib/` – API client, sign-in, dialogs, calculators, Markdown.
- `deploy/` – Caddy (HTTPS, security headers) and the web image; `docker-compose.yml`; `scripts/` – backup and restore.
- API docs (OpenAPI): `/api/docs`.

## Roles (enforced on the server; r=read w=write a=approve e=export p=publish)

| Role | Key access |
|---|---|
| Super Administrator | Everything incl. users, settings, audit |
| Owner / Director | All business modules incl. approvals and finance; users/settings read |
| Branch / Operations Manager | Leads, customers, properties (verify/publish), deals, leases, maintenance, short-stay, agreements, CMS, CEO dashboard; finance read; own branch only |
| Sales / Brokerage Agent | Own assigned leads, deals, properties only; no finance |
| Property Manager | Own leases, maintenance, documents; properties read |
| Finance / Accountant | Finance read/write/export, investors, CEO dashboard, reports |
| Marketing | Publish listings, CMS and Insights, campaigns; internal address/notes/owner hidden |
| Short-Stay Operations | Bookings, cleaning tasks, maintenance; sees check-in instructions |
| Read-Only Auditor | Read and export reports and audit log, no writes |
| Property Owner (portal) | Only their own records, through `/api/portal/*` |
| Investor (portal) | Only their own holdings, payouts and shared documents, through `/api/investor/*` |

Staff with branches on their account see only those branches' records; directors and super administrators see every
branch and can narrow the view with the branch picker (sent as the `X-Branch` header). Records outside a user's scope return 404; refused actions return 403 and are audit-logged. Approvals (commission change
after it is first set, refunds/credit notes, ledger reversals) need approve rights and a different person.
2-step sign-in (authenticator app + recovery codes) can be required per role in Settings.

## Money rules

Ledgers: `company`, `owner_funds`, `deposits`, `commission_payable`, `shortstay_owner`, `investor_funds`; every entry
carries its branch. Only invoice receipts, settled
management fees and short-stay fees post to company revenue. Entries are never edited; corrections are reversals.
Payments and rent use idempotency keys so retries cannot duplicate them. Owner payouts are never automatic – staff
record the bank transfer reference. GST is off until the accountant sets the rate. Short-stay nights are reserved one
row per night with a unique index, so two people cannot book the same dates at once.

## Development and tests

```bash
cd backend && pip install -r requirements-dev.txt && cp .env.example .env   # MONGO_URL=mongomock://local for an in-memory DB
uvicorn server:app --port 8001 --reload        # SEED_DEMO=true loads sample data
cd frontend && yarn install && yarn start      # proxies /api to :8001
cd backend && python -m pytest tests -q        # 79 API and unit tests against the running backend
```

Sample logins when `SEED_DEMO=true` (never on the live server): `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `.env`, and
`director@`, `branch.manager@`, `sales.agent@`, `property.manager@`, `accountant@`, `marketing@`, `shortstay.ops@`,
`auditor@`, `owner@`, `investor@demo.sellandiamman.test`, and branch staff `perundurai.manager@`, `perundurai.sales@`,
`sathy.manager@`, `kadambur.manager@`, `namakkal.manager@`, `namakkal.sales@` with `DEMO_PASSWORD`.

Hosted preview (runs in the browser with sample data, no server): `python demo/export.py`, then
`cd frontend && yarn build:preview`, then `python demo/package.py` (output in `demo/build/artifact`).

## Data retention

Customers and leads: download everything held, or erase on request (customer page → Data request (JSON) /
Forget this person), or 3 years after last activity. Consent for marketing and WhatsApp is recorded with its history.
Financial records: retain 8 years (confirm with your CA). KYC documents: store only when needed; never shared with owners.

## Integrations that need your accounts

- **Email** (SMTP) – password links and staff alerts. Without it, links are shown on screen for an admin to share.
- **WhatsApp** – click-to-chat links with the number from Settings. No automated WhatsApp Business messages.
- **Cloudflare Turnstile** – optional "I am human" check on public forms (honeypot and rate limits always apply).
- **Maps** – OpenStreetMap tiles; set a provider key for heavy traffic.
- **Booking platforms** – two-way calendar sync through each platform's iCal link (every 15 minutes). Guest names,
  phone numbers and amounts are not in calendar feeds, so platform bookings arrive marked "add guest details".
  No channel manager or payment integration.
- **Accounting / GST filing** – export CSVs for your accountant.

## Known limits

Money is stored as 2-decimal numbers (rounded at every step). The rate limiter is in memory (one backend process).
Legal page texts and agreement templates are drafts for your lawyer to review; stamp duty figures are estimates to
confirm with the sub-registrar. Public listing pins are about 100 m from the real point by default.
