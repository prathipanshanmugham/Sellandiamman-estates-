# What's new – 6 Nov 2026

## Home-screen app all white
- The installed web app (Add to Home Screen / Install app) is white throughout: the SA mark on a solid white icon with
  no see-through corners, a white top bar and a white start-up screen. The browser bar on Android phones is white too.
- Icon links carry `?v=3`, so Android picks up the new icon by itself within a day or so. On an iPhone, remove the
  saved icon and add it to the home screen again.

## Every screen fits every phone
- Checked every page of the website, staff app and the four portals at 320, 360, 375, 390 and 414 px wide, turned
  sideways (667 px), on a tablet (768 px) and at 1024 px: nothing scrolls sideways or gets cut off.
- Property list: sort and grid / list / map buttons fit on the smallest phones.
- Lists in the staff app show as cards up to tablet width, two across on tablets.
- Everything you tap is at least 36 px high on phones (small buttons, chips, "All bills"-style links, breadcrumbs,
  back links, copy / show buttons in the vault, editor toolbars).
- Portal tab bar labels fit five across on small phones; From / To dates sit side by side with labels.
- Text in fields is 16 px on every touch screen, so phones don't zoom in when a field is tapped (also sideways and
  on tablets). Small print raised to at least 10.5 px.

# What's new – Round 6 (5 Nov 2026)

## AI agents & MCP
- New screen **Team & admin → AI agents & MCP**. Make an agent for a job (business analyst, sales assistant, rent &
  collections, property care desk, short-stay desk, listings assistant, or your own), choose whose staff login it
  works as, and whether it may only read or also add and change records. Copy its key once, then add it to Claude as a
  custom connector (the screen shows the steps with the address and key filled in), or to Claude Code with one command.
- The agent sees exactly what that person sees: their role, their branches, their own leads or leases where the role
  is limited. It can search, list and open records, run reports, read the CEO view, calendar, owner statements and
  short-stay figures, and (read & write agents) add leads, log calls, book site visits, reply to service requests,
  raise work orders, add tenant bills, check guests in and add tasks.
- It never deletes, decides approvals, records money (rent, payments, invoices, expenses, payouts, prices), or touches
  logins, settings, the website or the password vault.
- Every call is listed under **Activity** (90 days, secrets masked); changes show in the audit log as
  "person (AI agent: name)". Pause, new key, end date and revoke on each agent. 240 calls a minute per agent.
- Ready-made requests in Claude: daily brief, lead follow-ups, rent collections list, service desk check, short stays
  this week. Details in `docs/AI_AGENTS.md`.

# What's new – Round 5 (5 Nov 2026)

## Cleaner on phones
- **Lists in the staff app** (leads, properties, customers, leases, invoices, service requests, deals, investors,
  users and the rest) show each record as a compact card: reference and status chip on top, the name or title in
  bold, then the other details two to a row. Less important columns are left out on phones.
- **Page headers**: shorter titles, one row of buttons that scrolls sideways with the main action first.
- **Filters** sit two to a row; type chips and tabs (Finance, Short stays, Website editor…) stay on one line and
  scroll sideways instead of wrapping into several rows.
- Smaller figure cards, dialogs with a margin and a larger close button, Cancel / Save side by side, a compact
  From – To date picker on the dashboard and reports, bigger tap targets for copy / show / call icons.
- **Customer portals** (tenant, owner, buyer, investor) have an app-style tab bar at the bottom of the screen
  (four sections plus "More" for owners).
- **Property pages** keep the price and an **Enquire** button (and WhatsApp) fixed at the bottom of the screen;
  share buttons sit on one line.
- **Website footer** is shorter: services and company links side by side, horizontal logo.
- Tenant bills line up the same way on every row; the map credit line is small again.

## Icons
- The browser-tab icon (favicon) is the SA mark on a **transparent** background (it switches to the brighter colours
  when the browser uses a dark theme).
- The **app icons** (iPhone / Android home screen, installed app) are the SA mark on **white**.
- Icon links carry `?v=2`, so browsers pick up the new icons straight away.

# What's new – Round 4 (21 Oct 2026)

## New logo, everywhere
- The supplied artwork rebuilt as clean vector: grey **S**, red **A** chevron, the **SELLANDIAMMAN** wordmark traced
  letter by letter, and **ESTATES** set between two fine rules in the same letters. Straight edges are exact, repeated
  letters match, the A has an even stroke.
- Horizontal lockup in the header, staff app and portals; stacked lockup (as in the artwork) in the footer and the
  social share image; two-tone mark on the favicon, app icons and the preview's loading screen; PDF headers (receipts,
  invoices, statements, the CEO report, the organisation chart) carry the same logo.
- `python scripts/brand/build_brand.py` regenerates every logo file from `scripts/brand/sellandiamman-logo-source.png`.

## Customer login (header) and staff sign-in (footer)
- **Customer login** in the website header opens `/login`: Tenant, Owner / lessor, Buyer, Investor, each with its own
  sign-in page and words. **Staff sign in** moved to the footer.
- Staff give logins from the customer record ("Customer logins"), the lease ("Give the tenant a login"), or **Users &
  Roles → Customer login**. The person gets a link to set a password (valid 7 days; shown on screen when email is off).

## Tenant portal (`/tenant`)
- Rent: next due, overdue, month-by-month schedule, receipts (PDF), deposit held and its movements, move-in records.
- **Bills**: electricity (EB) by meter reading (previous → current × rate + fixed), water, association maintenance,
  internet, parking and more, with receipts. Bills are either collected by us or paid by the tenant to the provider.
- **Pay**: the amount, a UPI QR code and an "Open UPI app" button with the amount and lease code filled in, plus bank
  details. **I have paid** sends the UPI reference; staff confirm it on the lease and the receipt appears.
- Documents shared with them (the rental agreement is shared automatically when finalised with sharing on).
- Lease ending within 60 days: a prompt to ask for renewal or give notice.

## Buyer portal (`/buyer`)
- The purchase step by step (price agreed → agreement → registration → done), checklist, agreed value, history,
  site visits, homes the relationship manager shared, documents, and one-tap requests for a visit, home-loan help or
  registration and legal help.

## Owner (lessor) portal
- **Bills** tab for tenant bills on their properties; statements now add bills collected for them (EB, water…) in full,
  with no fee taken on them. **Requests & repairs**: raise requests, follow repairs their tenants reported, see work
  order costs.

## Service requests (`/erp/tickets`)
- Every customer can raise requests with photos: repairs (plumbing, electrical, appliance…), cleaning, keys, internet,
  complaints, documents, rent or bill questions, renewal, move-out, payouts, listing and rent revision, EB or tax name
  transfer, site visits, home loans, registration.
- Staff desk: open / new / waiting for reply / past due / rating, filters, assignment, priority, reply-by and fix-by
  targets, internal notes the customer never sees, attachments, and **Raise a work order** with vendor and quote.
  When the work order is completed the request is resolved and the customer is asked to rate it; they can reopen it.
- Everyone involved is notified in the app (and by email when switched on).

## Lease bills and payment notices
- On each lease: add bills (EB readings remember the last reading), record payments with receipts, mark direct
  bills paid, waive, and confirm or reject the tenant's payment notices. Collected bills go to the owner-funds ledger and
  the owner's statement; bills for our own services go to company income.
- **Settings → Rent collection account**: UPI ID, account name, bank, account number, IFSC and a note for tenants.

## Password vault (`/erp/vault`)
- One place for the company's logins: Airbnb, Booking.com, Agoda, MakeMyTrip / Goibibo, Vrbo, Expedia, 99acres,
  MagicBricks, Housing.com, NoBroker, OLX, TNREGINET, TNRERA, TNPDCL / TANGEDCO, GST, Income Tax, TRACES, MCA, Google,
  Meta, WhatsApp Business, YouTube, LinkedIn, GoDaddy, Hostinger, Razorpay, PhonePe, Paytm, net banking, Wi-Fi and
  door codes – with the website filled in for you.
- Encrypted with AES-256-GCM using `VAULT_KEY` on the server. Unlock with your own password (and 2-step code) for 15
  minutes; show or copy one field at a time; 2-step codes for shared accounts without the key leaving the vault.
- Share each login with roles or named people; only the person who added it and administrators can change it; old
  passwords are kept (last 10); change reminders (e.g. every 90 days for GST and banking); a strong password generator;
  an activity tab of every view, copy, code and change. Auditors and customers never see the vault.

## To switch on after updating
1. Add `VAULT_KEY` to `backend/.env` and keep a copy off the server (DEPLOYMENT.md, "Updating").
2. Fill in **Settings → Rent collection account**.
3. Give tenants, owners and buyers their logins.

# What's new – Round 3 (21 Oct 2026)

## Five branches
- Perundurai (head office), Erode, Kadambur, Sathyamangalam and Namakkal. Every lead, customer, property, deal, lease,
  booking, work order, invoice, expense, ledger entry and agreement belongs to a branch.
- Branch managers and their teams see only their own branch; directors and admins see all and can pick one branch from
  the top bar (every list, total, report and the CEO dashboard follows the pick). Alerts go to the right branch only.
- New records land in the branch that covers the town (e.g. a lead asking for "Thindal" goes to Erode).
- **Branches & places** (`/erp/places`): add branches, set the head office, Google Business Profile links, and the towns
  and localities list. Localities are added automatically the first time a property is listed there (owners' suggestions
  wait for staff approval), so you are not limited to Perundurai, Erode and SIPCOT.

## CEO dashboard (`/erp/ceo`)
- Company health score out of 100 (grade A–D) from six weighted parts: growth, revenue & profit, cash & collections,
  sales effectiveness, portfolio & occupancy, service & compliance. Weights and monthly revenue targets per branch are
  set in Settings.
- Any dates (presets or custom), branch, town and locality; compared with the previous period; branch league table;
  6-month trend; "fix these first" with the next step for each weak measure.
- **Report** as a PDF or CSV for exactly the filters chosen.

## Investors
- Co-investor register, projects (rental pools, land banks, short-stay homes…), money received, valuations, payouts
  split pro rata with TDS, exits, returns (XIRR), project updates, and statements (PDF). Its own ledger keeps investor money
  apart from company revenue.
- **Investor dashboard** (`/investor`): investors sign in to see holdings, current value, a growth chart, payouts,
  returns, updates, statements and the documents you share.

## Customers (`/erp/customers`)
- One record per person or business across leads, owners, tenants, guests and investors, matched by mobile number,
  with a 360° timeline, tags, KYC status (only the last 4 characters of an ID are kept), marketing and WhatsApp
  consent with history, duplicate finder and merge, CSV import and export (filtered, e.g. "consented to WhatsApp"),
  and data-protection requests (download everything held, or erase) under the DPDP Act, 2023.

## Short stays on many platforms (`/erp/short-stay`)
- One calendar for Airbnb, Booking.com, Agoda, MakeMyTrip, Goibibo, Vrbo, Expedia, your website and direct bookings.
- Two-way **calendar sync** with iCal links every 15 minutes: a night sold anywhere closes everywhere; platform bookings
  arrive needing guest details; moved or cancelled bookings follow; double bookings are flagged at once.
- Closed dates (owner stays, maintenance), seasonal and weekend prices, weekly/monthly discounts, extra-guest fees,
  quotes with each platform's commission and the owner's payout, and performance by platform and by home.
- On the website, short-stay homes show free dates and take a request for dates; staff confirm on WhatsApp/phone.

## Agreement generator (`/erp/agreements`)
- Rental, commercial lease, leave & licence, sale agreement, token advance receipt, brokerage authorisation,
  property management, short-stay management and investor co-investment.
- Fills in from a lease, deal, property, owner or investment; edit any clause; Tamil Nadu stamp duty estimate.
- **Word (.docx) or PDF** laid out for Indian stamp paper (legal or A4, blank top band for the stamp paper / e-stamp,
  e-stamp certificate line, wide binding margin, initials and "page x of y" on every page). Finalised copies are saved
  with the record and can be shown in the owner's or investor's portal; upload the signed scan back.

## Website editor and Insights (`/erp/website`, `/erp/insights`)
- Edit the home page sections (show, hide, reorder), hero, services, FAQ, About, announcement, reviews and search text,
  with a draft, preview, publish and the last 15 versions to restore.
- Insights can be scheduled for a date and time, carry pictures inside the text, and be posted for investors only.

## Location capture
- Owners listing a property on the website and staff adding one can drop a pin or use the phone's GPS. The exact point
  stays private; the website shows it about 100 m away (or exactly, or not at all, per property).

## Team & organisation chart (`/erp/team`)
- Who reports to whom, with call, WhatsApp and email buttons, a directory and a by-branch view; printable chart (PDF).
  Staff can update their own phone, WhatsApp and photo.

## Search engines and AI assistants
- Every public page is served with its title, description, schema.org data (listings, place pages, articles, FAQ,
  breadcrumbs, the business and its branches) and the page text, so Google and AI assistants read it without running
  JavaScript.
- A page for each town and locality (e.g. `/properties-in/erode/thindal`) with live price ranges and questions answered.
- `sitemap.xml` with images, `robots.txt` that welcomes AI crawlers but keeps staff and portal areas out, and `llms.txt`.

## Tools are internal
- The calculators moved from the public website into the staff workspace (`/erp/tools`) and gained capital gains with
  indexation, TDS on property, commission with GST, and rent vs buy.

## Checks run
- 79 backend tests (permissions per branch, investor returns, iCal sync, agreements, CEO score, customers, SEO pages).
- The hosted preview now runs the same rules in the browser; its CEO scores, investor returns, short-stay figures,
  customer counts and agreement wording were compared with the server on the same data and match.
- Every screen for each role at phone and desktop width.

---

# What's new – Round 2 (17 Oct 2026)

## Your logo, everywhere
- The SA mark is rebuilt as sharp vector artwork from the logo you sent (same grey, #96979B) and used in the website
  header and footer, the staff workspace, the owner portal, sign-in screens, every PDF (invoices, receipts, statements,
  brochures), the browser tab icon, phone home-screen icons and the image WhatsApp/Facebook show when the site is shared.
- Logo files for print and social media: `frontend/public/brand/` (mark SVG, horizontal logo for light and dark backgrounds).
- An uploaded logo in Settings still overrides it; "Use built-in logo" switches back.

## Website
- **Calculators** (`/tools`): home-loan EMI with yearly schedule, how much you can afford, Tamil Nadu stamp duty &
  registration (7% + 2%, the 1% rate for women buyers up to ₹10 lakh, guideline value vs price), area converter
  (cents, grounds, acres, sq.ft), rental yield, commercial lease escalation, short-stay income vs a tenant.
- **Map view** of listings, plus a map on each property page (approximate location only).
- **Save and compare**: heart any listing, compare up to 12 side by side, send the list on WhatsApp.
- **Book a site visit** from a listing (date and time of day). Requests land on the staff dashboard to confirm.
- **Share** a listing on WhatsApp with a proper preview (photo, price, title), copy the link, or download a one-page **PDF brochure** with a QR code.
- **Insights** (`/insights`): market updates and guides, written and published by your team.
- **Post your requirement** (`/requirement`): budget, type and localities go straight into the CRM.
- Phone-friendly catalogue filters, home-loan estimate on sale listings, price per sq.ft, announcement bar, social links,
  TNRERA number in the footer, search-engine data for listings and articles, optional "I am human" check on forms.

## Staff workspace
- **2-step sign-in** with an authenticator app and recovery codes; can be required per role; admins can reset a lost phone.
- **Calendar**: visits, stays, rent due dates, lease ends, tasks and authorisation expiries.
- **Leads**: matching listings scored by budget, location and type, sent to the customer on WhatsApp in one tap;
  confirm or decline website visit requests; remove a person's data on request.
- **Insights editor** with live preview, cover photo, publish/unpublish.
- **Owner portal invites** from each owner, and "Owner can see" on property documents.
- **Settings**: go-live checklist, reviews, social links, TNRERA number, 2-step policy, email alerts, map centre.
- Rent receipts (PDF) on every rent payment; brochure and "view on website" on published properties.
- All pop-up boxes replaced with proper in-app dialogs; tables turn into cards on phones; staff screens load only after sign-in.

## Owner portal (`/owner`)
Owners sign in on the same page as staff and see only their own properties, rent and receipts, monthly statements with
PDF, maintenance requests (and can report a new one), short-stay payouts and documents you share.

## Production setup
- `docker compose up -d --build` runs MongoDB (with a password), the backend, Caddy (automatic HTTPS, security
  headers) and nightly backups kept for 30 days, plus a restore script. Step-by-step guide: `DEPLOYMENT.md`.
- Removed the Emergent and PostHog tracking scripts that were shipping to visitors, unused packages and test uploads.
- Fonts are served from your own server (no Google requests), which matches the "no trackers" cookie policy.

## Hosted preview
- `demo/` builds a click-through preview of the real frontend that runs entirely in the browser with sample data
  recorded from the real backend (`demo/export.py`), including real PDFs shown as page images. Every role can be tried
  from the "Preview" button; changes reset on reload. Steps: `python demo/export.py`, then
  `cd frontend && yarn build:preview`, then `python demo/package.py`. Production builds contain none of this code.

## Checks run
- 47 backend tests (sign-in, 2-step, permissions, money rules, owner portal, link previews, sitemap).
- Every public page and every staff screen for all 9 staff roles and the owner, at phone (390 px) and desktop width:
  no layout running off the side and no script errors after fixes.
- Click-through of the main journeys: search, save and compare, visit booking, requirement, calculators, confirming a
  visit, in-app dialogs, publishing an article, owner invite, 2-step setup and sign-in, owner statement and request.
- Fixed along the way: the owner statement crashed (expense list and total shared a name); the accountant's Deals and
  Short-stay screens asked for data the role cannot see; duplicate filter fields on phones.

## Before going live
Real contact details and WhatsApp number, SMTP email, TNRERA number, GST decision with your accountant, 2-step sign-in
for directors and admins, and an off-server copy of the backups. The go-live checklist in Settings tracks these.
