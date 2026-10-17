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
