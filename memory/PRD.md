# PRD — Sellandiamman Estates Website + ERP

## Original problem statement
"PROJECT: SELLANDIAMMAN ESTATES — COMPLETE REAL ESTATE WEBSITE AND ERP" — full brief supplied by customer (asset-light real estate business in Erode & Perundurai: brokerage, rental brokerage, property management, short-stay management, commercial/industrial leasing, marketing/inspections). Two integrated parts sharing one backend/DB: (A) public website — home with search, catalogue with filters, property detail with enquiry/WhatsApp, 8 service pages, owner submission (pending verification, never auto-public), management enquiry & callback, about/contact/FAQ/privacy/terms/disclaimer/cookies, SEO, spam protection; (B) private ERP at /erp with 9 roles and server-side permissions, executive dashboard (quoted/expected/earned/invoiced/collected/receivables distinct; commission ≠ property value), CRM pipeline, property register with verification/authorisation workflow, deals & configurable commission, PDF quotations/invoices/receipts, approvals, property management (leases, rent, deposits, owner statements, maintenance), short-stay (bookings, fees, owner settlement), documents (private, expiring links, versions, audit), finance with separate ledgers and non-destructive reversals, configurable GST, tasks, CMS, reports (CSV/PDF), notifications/automations, security hardening, synthetic sample data, backups, deployment docs, automated tests, acceptance workflows 1–16.

## User choices
Scope: secure working core (public site + ERP auth/roles + CRM + properties + deals/commission/invoices + leases/rent/owner statements + maintenance + short-stay + dashboard). Auth: email+password, HTTP-only cookie sessions, admin-created accounts only. Email: defaults (dev-logged). Logo: text wordmark, admin upload. Contact details: not provided → placeholders.

## Architecture
React (CRA, Tailwind, shadcn) + FastAPI + MongoDB (existing environment kept instead of Next.js/PostgreSQL). Backend modules: core.py (RBAC, sessions, audit, notify, uploads), logic.py (pure business rules), routes_auth/public/crm/props/deals/finance/ops/admin, seed.py, pdf.py (reportlab). JWT in httpOnly cookie bound to a server-side session (revocable). Files on private disk with 5-min signed links.

## User personas
Public visitors (buyers, tenants, businesses), property owners (incl. NRI), and staff in 9 roles: super admin, director, branch manager, sales agent, property manager, accountant, marketing, short-stay ops, auditor.

## Implemented (2026-10-16)
- Public site: all pages, filters/sort/grid-list, enquiry → CRM lead with duplicate detection, owner submission → verification_pending, cookie banner, sitemap/robots, demo-data banner, WhatsApp link (hidden until number set).
- ERP: dashboard with revenue distinctions, CRM (table + pipeline, activities, site visits, assignment, lost reason, CSV import/export, consent), property register + workflow + verification + publication history + featured, owners + statements, deals (offers, commission rules/splits, approval for changes, close, invoice, PDF), finance (invoices, payments w/ idempotency, receipts, credit notes/refunds via approval, 5 ledgers, reversals, expenses, owner payouts manual), leases (schedule w/ escalation, rent → owner funds, deposits liability, handovers, arrears), maintenance (work orders, vendors), short-stay (overlap check, fee/settlement split, cancel/refund approval, cleaning task), documents, tasks, approvals, reports CSV, users/roles (activation/reset links, session revocation), settings/CMS/campaigns/logo, audit log, hourly reminder automations with dedupe.
- Tests: backend/tests/test_logic.py (9 unit) + test_erp_e2e.py (17 E2E) all passing. Backup/restore drill verified. README with setup, deployment, roles, backup, retention, integrations, limitations; docker-compose + .env.example.

## Prioritized backlog
- P0: Configure real contact details, WhatsApp number, GST settings; email provider for activation/reset links.
- P1: MFA (TOTP); catalogue map view (maps key); blog/market updates CMS; CAPTCHA; atomic booking-overlap guard; Decimal money storage.
- P2: Booking-platform integrations, accounting export formats, leave/attendance (optional), multi-instance rate limiter.

## Next tasks
Add real business details and logo; decide on email provider; MFA for admins.
