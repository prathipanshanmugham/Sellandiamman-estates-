"""Search engines and AI assistants (SEO + GEO).

Crawlers and AI assistants mostly read the raw HTML and do not run the website's JavaScript. So every public page is
also served by the backend with its title, description, canonical address, social preview tags, schema.org data and
the page's main text and links already in the HTML. The browser app then takes over as usual. Also: sitemap.xml
(with images), robots.txt (search engines and AI crawlers welcome, private areas closed), /llms.txt and /llms-full.txt.

Caddy sends page requests to /api/seo/page with the original address in X-Original-URI, and falls back to the plain
index.html if the backend is down. The built index.html is shared with the backend through SITE_SHELL.
"""
import html
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from fastapi import APIRouter, Request
from fastapi.responses import Response, HTMLResponse
from core import db, get_settings, SITE_URL, today_ist
from pdf import inr_short

router = APIRouter()
ROOT = Path(__file__).resolve().parent
SHELL_PATHS = [os.environ.get("SITE_SHELL") or "/shell/index.html", str(ROOT.parent / "frontend" / "build" / "index.html")]
_shell = {"path": None, "mtime": 0.0, "text": None}
E = lambda v: html.escape(str(v if v is not None else ""), quote=True)  # noqa: E731
LIVE = {"status": {"$in": ["published", "under_offer"]}, "deleted": {"$ne": True}}
TX = {"sale": "for sale", "rent": "for rent", "lease": "for lease", "short_stay": "for short stays"}
PER = {"rent": " a month", "lease": " a month", "short_stay": " a night"}
CAT = {"residential": "house", "apartment": "apartment", "villa": "villa", "land": "plot", "agricultural": "agricultural land",
       "commercial": "commercial property", "shop": "shop", "office": "office space", "industrial": "industrial plot",
       "warehouse": "warehouse", "factory_shed": "factory shed", "other": "property"}
PRIVATE = ("/erp", "/owner", "/investor", "/shortlist")
AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai",
           "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "Bingbot", "CCBot", "meta-externalagent"]


def base_url(request: Request):
    return SITE_URL or str(request.base_url).rstrip("/")


def load_shell():
    for p in SHELL_PATHS:
        try:
            st = os.stat(p)
        except OSError:
            continue
        if _shell["path"] != p or _shell["mtime"] != st.st_mtime:
            _shell.update(path=p, mtime=st.st_mtime, text=Path(p).read_text())
        return _shell["text"]
    return None


def price_text(p):
    if p.get("price_on_request") or not p.get("price"):
        return "Price on request"
    unit = {"per_month": " per month", "per_night": " per night", "per_sqft": " per sq.ft", "per_acre": " per acre", "per_cent": " per cent"}.get(p.get("price_unit"), "")
    return f"{inr_short(p['price'])}{unit}"


def abs_url(u, base):
    if not u:
        return f"{base}/og-image.jpg"
    return u if u.startswith("http") else f"{base}{u}"


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


async def org_ld(base, s, branches, site):
    social = [v for v in (s.get("social") or {}).values() if v]
    ho = next((b for b in branches if b.get("is_head_office")), branches[0] if branches else {})
    towns = sorted({b["city"] for b in branches if b.get("city")})
    org = {"@type": "RealEstateAgent", "@id": f"{base}/#org", "name": s.get("name") or "Sellandiamman Estates",
           "legalName": s.get("legal_name"), "url": base, "logo": f"{base}/icon-512.png", "image": f"{base}/og-image.jpg",
           "description": site.get("footer_tagline"), "telephone": s.get("phone"), "email": s.get("email"),
           "address": {"@type": "PostalAddress", "streetAddress": ho.get("address") or s.get("address"), "addressLocality": ho.get("city"),
                       "postalCode": ho.get("pincode"), "addressRegion": "Tamil Nadu", "addressCountry": "IN"},
           "areaServed": [{"@type": "City", "name": t} for t in towns], "parentOrganization": {"@type": "Organization", "name": "Sellandiamman Group"},
           "knowsAbout": ["Residential property", "Commercial leasing", "Industrial sheds near SIPCOT Perundurai", "Property management",
                          "Short-stay holiday homes", "Real estate co-investment", "Tamil Nadu property registration"]}
    if social:
        org["sameAs"] = social
    if s.get("rera_no"):
        org["identifier"] = {"@type": "PropertyValue", "name": "TNRERA agent registration", "value": s["rera_no"]}
    if ho.get("lat") and ho.get("lng"):
        org["geo"] = {"@type": "GeoCoordinates", "latitude": ho["lat"], "longitude": ho["lng"]}
    depts = []
    for b in branches:
        d = {"@type": "RealEstateAgent", "@id": f"{base}/contact#{b['id']}", "name": f"{s.get('name') or 'Sellandiamman Estates'} – {b['name']}",
             "telephone": b.get("phone") or s.get("phone"), "email": b.get("email") or s.get("email"), "url": f"{base}/contact",
             "address": {"@type": "PostalAddress", "streetAddress": b.get("address"), "addressLocality": b.get("city"), "postalCode": b.get("pincode"),
                         "addressRegion": "Tamil Nadu", "addressCountry": "IN"}, "openingHours": "Mo-Sa 09:30-18:30"}
        if b.get("lat") and b.get("lng"):
            d["geo"] = {"@type": "GeoCoordinates", "latitude": b["lat"], "longitude": b["lng"]}
        if b.get("gbp_url"):
            d["hasMap"] = b["gbp_url"]
        depts.append(d)
    if depts:
        org["department"] = depts
    web = {"@type": "WebSite", "@id": f"{base}/#site", "url": base, "name": s.get("name") or "Sellandiamman Estates", "inLanguage": "en-IN",
           "publisher": {"@id": f"{base}/#org"},
           "potentialAction": {"@type": "SearchAction", "target": f"{base}/properties?q={{search_term_string}}", "query-input": "required name=search_term_string"}}
    return [org, web]


def crumbs(base, items):
    return {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": f"{base}{u}"}
                                                          for i, (n, u) in enumerate(items)]}


def card(p):
    area = p.get("built_area") or p.get("plot_area")
    bits = [price_text(p), f"{p.get('locality')}, {p.get('city')}"]
    if p.get("bedrooms"):
        bits.append(f"{p['bedrooms']} bedrooms")
    if area:
        bits.append(f"{area:,.0f} {p.get('area_unit') or 'sq.ft'}")
    return (f'<li><a href="/properties/{E(p["listing_id"])}">{E(p["title"])}</a> – {E(" · ".join(bits))}</li>')


async def places_with_counts():
    rows = await db.properties.find(LIVE, {"_id": 0, "city": 1, "locality": 1, "price": 1, "transaction": 1}).to_list(10000)
    towns = {}
    for p in rows:
        t = towns.setdefault(p.get("city") or "", {"count": 0, "localities": {}})
        t["count"] += 1
        t["localities"][p.get("locality") or ""] = t["localities"].get(p.get("locality") or "", 0) + 1
    for loc in await db.locations.find({"active": {"$ne": False}}, {"_id": 0, "kind": 1, "name": 1, "city": 1}).to_list(5000):
        t = towns.setdefault(loc["city"], {"count": 0, "localities": {}})
        if loc["kind"] == "locality":
            t["localities"].setdefault(loc["name"], 0)
    return {k: v for k, v in towns.items() if k}


async def resolve(path, query, base):
    """-> (status, title, description, canonical, image, json-ld list, body html, robots)"""
    s = await get_settings()
    from routes_cms import published
    site = await published()
    branches = await db.branches.find({"active": {"$ne": False}}, {"_id": 0}).sort([("is_head_office", -1), ("order", 1)]).to_list(100)
    name = s.get("name") or "Sellandiamman Estates"
    towns_txt = ", ".join(b["city"] for b in branches) or "Erode and Perundurai"
    ld = await org_ld(base, s, branches, site)
    path = "/" + path.strip("/") if path != "/" else "/"
    if path.startswith(PRIVATE):
        return 200, f"{name}", "", f"{base}{path}", None, [], "", "noindex,nofollow"
    seo = site.get("seo") or {}
    if path == "/":
        latest = await db.properties.find(LIVE, {"_id": 0}).sort([("featured", -1), ("published_at", -1)]).limit(24).to_list(24)
        towns = await places_with_counts()
        posts = await db.posts.find({"status": "published", "deleted": {"$ne": True}, "audience": {"$ne": "investors"}},
                                    {"_id": 0, "slug": 1, "title": 1}).sort("published_at", -1).limit(6).to_list(6)
        body = (f"<h1>{E(site['hero']['title'])}</h1><p>{E(site['hero']['subtitle'])}</p>"
                f"<p>{E(name)} is a real estate services company in Tamil Nadu with branches in {E(towns_txt)}. "
                "It handles buying, selling, renting and leasing of homes, plots, shops, offices, warehouses and factory sheds; "
                "property management for resident and NRI owners; short-stay homes listed on Airbnb, Booking.com, MakeMyTrip and Agoda; "
                "and co-investment in rental and land projects.</p>"
                f"<h2>Latest properties</h2><ul>{''.join(card(p) for p in latest)}</ul>"
                "<h2>Properties by town</h2><ul>" + "".join(
                    f'<li><a href="/properties-in/{slug(t)}">Properties in {E(t)}</a> ({v["count"]} listed)</li>' for t, v in sorted(towns.items())) + "</ul>"
                "<h2>Services</h2><ul>" + "".join(f'<li><a href="/services/{E(x["slug"])}">{E(x["title"])}</a>: {E(x["summary"])}</li>' for x in site["services"]) + "</ul>"
                + _branches_html(branches, s) +
                ("<h2>Guides</h2><ul>" + "".join(f'<li><a href="/insights/{E(x["slug"])}">{E(x["title"])}</a></li>' for x in posts) + "</ul>" if posts else ""))
        return (200, seo.get("title") or f"Property services in {towns_txt}", seo.get("description") or
                f"Verified homes, plots, shops, offices, warehouses and factory sheds for sale, rent and lease in {towns_txt}. Property management, short stays and co-investment.",
                f"{base}/", None, ld, body, "index,follow")
    m = re.fullmatch(r"/properties/([\w-]{3,30})", path)
    if m:
        p = await db.properties.find_one({**LIVE, "listing_id": m.group(1)}, {"_id": 0})
        if not p:
            return 404, "Listing not available", "This property may have been sold, rented or withdrawn.", f"{base}{path}", None, ld, \
                "<h1>Listing not available</h1><p><a href='/properties'>Browse properties</a></p>", "noindex,follow"
        kind = CAT.get(p.get("category"), "property")
        t = f"{p['title']}, {p['locality']} – {price_text(p)}"
        d = f"{p['title']} {TX.get(p['transaction'], '')} in {p['locality']}, {p['city']}: {price_text(p)}. {(p.get('description_public') or '')[:140]}"
        imgs = [abs_url(u, base) for u in (p.get("images") or [])]
        listing = {"@type": "RealEstateListing", "@id": f"{base}{path}#listing", "name": p["title"], "url": f"{base}{path}",
                   "description": p.get("description_public"), "datePosted": (p.get("published_at") or "")[:10], "image": imgs,
                   "about": {"@type": "Accommodation" if p.get("bedrooms") else "Place", "name": p["title"],
                             "address": {"@type": "PostalAddress", "addressLocality": p.get("locality"), "addressRegion": "Tamil Nadu",
                                         "postalCode": p.get("pincode"), "addressCountry": "IN"}},
                   "provider": {"@id": f"{base}/#org"}}
        if p.get("public_lat") and p.get("public_lng"):
            listing["about"]["geo"] = {"@type": "GeoCoordinates", "latitude": p["public_lat"], "longitude": p["public_lng"]}
        if p.get("bedrooms"):
            listing["about"]["numberOfRooms"] = p["bedrooms"]
        if p.get("built_area") or p.get("plot_area"):
            listing["about"]["floorSize"] = {"@type": "QuantitativeValue", "value": p.get("built_area") or p.get("plot_area"),
                                             "unitText": p.get("area_unit") or "sq.ft"}
        if p.get("price") and not p.get("price_on_request"):
            listing["offers"] = {"@type": "Offer", "price": p["price"], "priceCurrency": "INR",
                                 "availability": "https://schema.org/InStock" if p.get("status") == "published" else "https://schema.org/LimitedAvailability",
                                 "businessFunction": "http://purl.org/goodrelations/v1#Sell" if p["transaction"] == "sale" else "http://purl.org/goodrelations/v1#LeaseOut"}
        facts = [("Listing ID", p["listing_id"]), ("Type", kind), ("For", TX.get(p["transaction"])), ("Price", price_text(p)),
                 ("Locality", f"{p['locality']}, {p['city']}"), ("PIN", p.get("pincode")), ("Bedrooms", p.get("bedrooms")),
                 ("Bathrooms", p.get("bathrooms")), ("Built-up area", p.get("built_area") and f"{p['built_area']:,.0f} {p.get('area_unit')}"),
                 ("Plot / land area", p.get("plot_area") and f"{p['plot_area']:,.2f} {p.get('area_unit')}"), ("Furnishing", (p.get("furnishing") or "").replace("_", " ")),
                 ("Power", p.get("power_supply")), ("Access", p.get("loading_access")), ("Parking", p.get("parking")), ("Status", "Under offer" if p["status"] == "under_offer" else "Available")]
        sim = await db.properties.find({**LIVE, "listing_id": {"$ne": p["listing_id"]}, "city": p["city"], "transaction": p["transaction"]},
                                       {"_id": 0}).limit(6).to_list(6)
        body = (f"<nav><a href='/'>Home</a> / <a href='/properties-in/{slug(p['city'])}'>{E(p['city'])}</a> / {E(p['listing_id'])}</nav>"
                f"<h1>{E(p['title'])}</h1><p><strong>{E(price_text(p))}</strong> · {E(kind)} {E(TX.get(p['transaction'], ''))} in {E(p['locality'])}, {E(p['city'])}</p>"
                f"<p>{E(p.get('description_public'))}</p><h2>Key details</h2><dl>" +
                "".join(f"<dt>{E(k)}</dt><dd>{E(v)}</dd>" for k, v in facts if v) + "</dl>" +
                (f"<h2>Features</h2><ul>{''.join(f'<li>{E(a)}</li>' for a in p.get('amenities') or [])}</ul>" if p.get("amenities") else "") +
                "".join(f'<img src="{E(u)}" alt="{E(p["title"])} photo {i + 1}" width="640" loading="lazy">' for i, u in enumerate((p.get("images") or [])[:3])) +
                f"<p>Listed by {E(name)}. Call {E(s.get('phone'))} or enquire on this page. Details are provided by the owner and subject to verification.</p>" +
                (f"<h2>Similar properties in {E(p['city'])}</h2><ul>{''.join(card(x) for x in sim)}</ul>" if sim else ""))
        ld += [listing, crumbs(base, [("Home", "/"), (p["city"], f"/properties-in/{slug(p['city'])}"), (p["title"], path)])]
        return 200, t, d[:300], f"{base}{path}", imgs[0] if imgs else None, ld, body, "index,follow"
    m = re.fullmatch(r"/properties-in/([a-z0-9-]+)(?:/([a-z0-9-]+))?", path)
    if m:
        towns = await places_with_counts()
        town = next((t for t in towns if slug(t) == m.group(1)), None)
        if not town:
            return 404, "Place not found", "", f"{base}{path}", None, ld, "<h1>Place not found</h1>", "noindex,follow"
        loc = None
        if m.group(2):
            loc = next((x for x in towns[town]["localities"] if slug(x) == m.group(2)), None)
            if not loc:
                return 404, "Place not found", "", f"{base}{path}", None, ld, "<h1>Place not found</h1>", "noindex,follow"
        f = {**LIVE, "city": town}
        if loc:
            f["locality"] = loc
        rows = await db.properties.find(f, {"_id": 0}).sort("published_at", -1).to_list(500)
        place = f"{loc}, {town}" if loc else town
        info = await db.locations.find_one({"kind": "locality" if loc else "city", "name": loc or town}, {"_id": 0, "intro": 1, "lat": 1, "lng": 1})
        by_tx = {}
        for p in rows:
            by_tx.setdefault(p["transaction"], []).append(p)
        facts = []
        for tx, ps in by_tx.items():
            prices = [p["price"] for p in ps if p.get("price") and not p.get("price_on_request")]
            rng = ""
            if prices:
                lo, hi = min(prices), max(prices)
                rng = (f" at {inr_short(lo)}" if lo == hi else f", {inr_short(lo)} to {inr_short(hi)}") + PER.get(tx, "")
            facts.append(f"{len(ps)} {'property' if len(ps) == 1 else 'properties'} {TX.get(tx, tx)}{rng}")
        branch = next((b for b in branches if b.get("city", "").lower() == town.lower()), None)
        faq = [{"q": f"How many properties are listed in {place}?", "a": f"As of {today_ist().strftime('%d %B %Y')}, {name} lists {len(rows)} verified "
                                                                         f"{'property' if len(rows) == 1 else 'properties'} in {place}" + (f": {'; '.join(facts)}." if facts else ".")},
               {"q": f"Who can help me buy, rent or lease property in {place}?",
                "a": f"{name}{' has a branch in ' + town if branch else ' covers ' + place} and can arrange site visits, verify documents and handle rental agreements."
                     + (f" Call {s.get('phone')}." if s.get("phone") and "00000" not in s.get("phone") else "")},
               {"q": f"Can I list my property in {place} with {name}?", "a": "Yes. Submit it on the 'List your property' page; the team verifies ownership and agrees terms in writing before publishing."}]
        body = (f"<nav><a href='/'>Home</a> / <a href='/properties-in/{slug(town)}'>{E(town)}</a>{' / ' + E(loc) if loc else ''}</nav>"
                f"<h1>Properties in {E(place)}</h1><p>{E((info or {}).get('intro') or f'Homes, plots, shops, offices and industrial spaces for sale, rent and lease in {place}, verified by {name}.')}</p>"
                + (f"<p>{E('; '.join(facts))}.</p>" if facts else "<p>No listings right now. Post your requirement and we will tell you when one comes up.</p>")
                + f"<ul>{''.join(card(p) for p in rows[:60])}</ul>"
                + ("" if loc else "<h2>Localities</h2><ul>" + "".join(
                    f'<li><a href="/properties-in/{slug(town)}/{slug(x)}">{E(x)}</a> ({c})</li>' for x, c in sorted(towns[town]["localities"].items()) if x) + "</ul>")
                + "<h2>Questions</h2>" + "".join(f"<h3>{E(q['q'])}</h3><p>{E(q['a'])}</p>" for q in faq)
                + (_branches_html([branch], s) if branch else ""))
        ld += [crumbs(base, [("Home", "/"), (town, f"/properties-in/{slug(town)}")] + ([(loc, path)] if loc else [])),
               {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q["q"], "acceptedAnswer": {"@type": "Answer", "text": q["a"]}} for q in faq]},
               {"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f"{base}/properties/{p['listing_id']}", "name": p["title"]}
                                                          for i, p in enumerate(rows[:30])]}]
        return (200, f"Property in {place} – sale, rent & lease", f"{len(rows)} verified properties in {place}: homes, plots, shops, offices and sheds. "
                f"{'; '.join(facts)}"[:300], f"{base}{path}", None, ld, body, "index,follow")
    if path == "/properties":
        f = dict(LIVE)
        tx = (query.get("transaction") or [None])[0]
        city = (query.get("city") or [None])[0]
        if tx in TX:
            f["transaction"] = tx
        if city:
            f["city"] = city
        rows = await db.properties.find(f, {"_id": 0}).sort("published_at", -1).limit(80).to_list(80)
        label = " ".join(x for x in ["Properties", TX.get(tx, "for sale, rent and lease"), f"in {city}" if city else f"in {towns_txt}"] if x)
        body = f"<h1>{E(label)}</h1><ul>{''.join(card(p) for p in rows)}</ul>"
        ld.append({"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f"{base}/properties/{p['listing_id']}", "name": p["title"]}
                                                             for i, p in enumerate(rows[:40])]})
        canon = f"{base}/properties" + (f"?transaction={tx}" if tx in TX and not city else "")
        return 200, label, f"Search verified listings {TX.get(tx, 'for sale, rent and lease')} across {towns_txt}.", canon, None, ld, body, "index,follow"
    if path == "/services":
        body = "<h1>Services</h1><ul>" + "".join(f'<li><a href="/services/{E(x["slug"])}">{E(x["title"])}</a>: {E(x["summary"])}</li>' for x in site["services"]) + "</ul>"
        return 200, "Services", f"Brokerage, rentals, property management, NRI services, short stays, commercial leasing and co-investment in {towns_txt}.", f"{base}/services", None, ld, body, "index,follow"
    m = re.fullmatch(r"/services/([a-z0-9-]+)", path)
    if m:
        x = next((x for x in site["services"] if x["slug"] == m.group(1)), None)
        if not x:
            return 404, "Service not found", "", f"{base}{path}", None, ld, "<h1>Service not found</h1>", "noindex,follow"
        ld += [{"@type": "Service", "name": x["title"], "description": x["summary"], "provider": {"@id": f"{base}/#org"},
                "areaServed": [{"@type": "City", "name": b["city"]} for b in branches]},
               crumbs(base, [("Home", "/"), ("Services", "/services"), (x["title"], path)])]
        body = f"<h1>{E(x['title'])}</h1><p>{E(x['summary'])}</p><ul>{''.join(f'<li>{E(pt)}</li>' for pt in x['points'])}</ul><p>Available in {E(towns_txt)}. Call {E(s.get('phone'))}.</p>"
        return 200, x["title"], x["summary"], f"{base}{path}", None, ld, body, "index,follow"
    if path == "/insights":
        posts = await db.posts.find({"status": "published", "deleted": {"$ne": True}, "audience": {"$ne": "investors"}}, {"_id": 0}).sort("published_at", -1).to_list(200)
        body = "<h1>Insights</h1><ul>" + "".join(f'<li><a href="/insights/{E(p["slug"])}">{E(p["title"])}</a> – {E(p.get("excerpt"))}</li>' for p in posts) + "</ul>"
        return 200, "Insights: property guides and market notes", f"Guides and market updates for property in {towns_txt}.", f"{base}/insights", None, ld, body, "index,follow"
    m = re.fullmatch(r"/insights/([a-z0-9-]+)", path)
    if m:
        p = await db.posts.find_one({"slug": m.group(1), "status": "published", "deleted": {"$ne": True}, "audience": {"$ne": "investors"}}, {"_id": 0})
        if not p:
            return 404, "Article not found", "", f"{base}{path}", None, ld, "<h1>Article not found</h1>", "noindex,follow"
        ld += [{"@type": "BlogPosting", "headline": p["title"], "description": p.get("excerpt"), "datePublished": p.get("published_at"),
                "dateModified": p.get("updated_at"), "author": {"@type": "Person", "name": p.get("author_name")}, "publisher": {"@id": f"{base}/#org"},
                "image": abs_url(p.get("cover_image"), base), "mainEntityOfPage": f"{base}{path}", "keywords": ", ".join(p.get("tags") or [])},
               crumbs(base, [("Home", "/"), ("Insights", "/insights"), (p["title"], path)])]
        body = f"<article><h1>{E(p['title'])}</h1><p><em>{E((p.get('published_at') or '')[:10])} · {E(p.get('author_name'))}</em></p>{_md_html(p.get('body'))}</article>"
        return 200, p.get("seo_title") or p["title"], p.get("seo_description") or p.get("excerpt") or "", f"{base}{path}", abs_url(p.get("cover_image"), base), ld, body, "index,follow"
    if path == "/about":
        a = site["about"]
        ld.append({"@type": "AboutPage", "url": f"{base}/about", "about": {"@id": f"{base}/#org"}})
        return 200, "About us", a["body"][:160], f"{base}/about", abs_url(a.get("image"), base), ld, f"<h1>{E(a['title'])}</h1>{_md_html(a['body'])}" + _branches_html(branches, s), "index,follow"
    if path == "/contact":
        ld.append({"@type": "ContactPage", "url": f"{base}/contact", "about": {"@id": f"{base}/#org"}})
        return 200, "Contact us", f"Branches in {towns_txt}. {site.get('contact_intro') or ''}", f"{base}/contact", None, ld, "<h1>Contact us</h1>" + _branches_html(branches, s), "index,follow"
    if path == "/faq":
        ld.append({"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q["q"], "acceptedAnswer": {"@type": "Answer", "text": q["a"]}} for q in site["faq"]]})
        body = "<h1>Frequently asked questions</h1>" + "".join(f"<h2>{E(q['q'])}</h2><p>{E(q['a'])}</p>" for q in site["faq"])
        return 200, "Frequently asked questions", "Answers about listings, brokerage, verification, NRI services, short stays and investing.", f"{base}/faq", None, ld, body, "index,follow"
    simple = {"/requirement": ("Post your requirement", f"Tell us the home, plot, shop, office or factory shed you need in {towns_txt}; we match it with verified listings."),
              "/list-property": ("List your property", "Owners can submit a property for sale, rent, lease or short stays; we verify ownership before publishing."),
              "/legal/privacy": ("Privacy policy", "How Sellandiamman Estates collects and uses personal data."),
              "/legal/terms": ("Terms of service", "Terms for using this website."), "/legal/disclaimer": ("Listing disclaimer", "About the property listings on this website."),
              "/legal/cookies": ("Cookie policy", "Cookies used on this website.")}
    if path in simple:
        t, d = simple[path]
        return 200, t, d, f"{base}{path}", None, ld, f"<h1>{E(t)}</h1><p>{E(d)}</p>", "index,follow"
    return 404, "Page not found", "", f"{base}{path}", None, ld, "<h1>Page not found</h1><p><a href='/properties'>Browse properties</a></p>", "noindex,follow"


def _branches_html(branches, s):
    out = "<h2>Branches</h2><ul>"
    for b in branches:
        if not b:
            continue
        out += (f"<li><strong>{E(b['name'])}{' (head office)' if b.get('is_head_office') else ''}</strong>: {E(b.get('address'))}"
                f"{' · ' + E(b.get('phone')) if b.get('phone') else ''}{' · ' + E(b.get('email')) if b.get('email') else ''}</li>")
    return out + f"</ul><p>Office hours: {E(s.get('office_hours'))}</p>"


def _md_html(md):
    """Small Markdown to HTML for article text in server pages (headings, lists, paragraphs, bold, links)."""
    out, lst = [], None
    for ln in str(md or "").replace("\r", "").split("\n"):
        t = ln.strip()
        if not t:
            if lst:
                out.append(f"</{lst}>")
                lst = None
            continue
        inline = E(t)
        inline = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", inline)
        inline = re.sub(r"!\[([^\]]*)\]\(((?:/|https://)[^)\s]+)\)", r'<img src="\2" alt="\1" loading="lazy">', inline)
        inline = re.sub(r"\[([^\]]+)\]\(((?:/|https?://)[^)\s]+)\)", r'<a href="\2">\1</a>', inline)
        m = re.match(r"^(#{2,3})\s+(.*)$", inline)
        if m:
            out.append(f"<h{len(m.group(1))}>{m.group(2)}</h{len(m.group(1))}>")
            continue
        m = re.match(r"^(?:[-*]|\d+[.)])\s+(.*)$", inline)
        if m:
            tag = "ol" if re.match(r"^\d", t) else "ul"
            if lst != tag:
                if lst:
                    out.append(f"</{lst}>")
                out.append(f"<{tag}>")
                lst = tag
            out.append(f"<li>{m.group(1)}</li>")
            continue
        if lst:
            out.append(f"</{lst}>")
            lst = None
        out.append(f"<p>{inline.lstrip('&gt; ')}</p>")
    if lst:
        out.append(f"</{lst}>")
    return "".join(out)


def render(shell, status, title, desc, canon, image, ld, body, robots, base, site_name):
    full = f"{title} | {site_name}" if title and site_name not in title else (title or site_name)
    head = (f"<title>{E(full)}</title><meta name=\"description\" content=\"{E(desc)}\"><link rel=\"canonical\" href=\"{E(canon)}\">"
            f"<meta name=\"robots\" content=\"{robots}\"><meta property=\"og:type\" content=\"website\"><meta property=\"og:site_name\" content=\"{E(site_name)}\">"
            f"<meta property=\"og:title\" content=\"{E(full)}\"><meta property=\"og:description\" content=\"{E(desc)}\">"
            f"<meta property=\"og:url\" content=\"{E(canon)}\"><meta property=\"og:image\" content=\"{E(image or base + '/og-image.jpg')}\">"
            f"<meta property=\"og:locale\" content=\"en_IN\"><meta name=\"twitter:card\" content=\"summary_large_image\">"
            f"<meta name=\"geo.region\" content=\"IN-TN\"><link rel=\"alternate\" type=\"text/plain\" title=\"LLM summary\" href=\"{E(base)}/llms.txt\">")
    if ld:
        graph = json.dumps({"@context": "https://schema.org", "@graph": ld}, ensure_ascii=False, default=str).replace("</", "<\\/")
        head += f'<script type="application/ld+json" id="ssr-jsonld">{graph}</script>'
    s = shell
    s = re.sub(r"<title>.*?</title>", "", s, flags=re.S)
    s = re.sub(r"<meta\s+(?:name|property)=\"(?:description|og:[a-z:_]+|twitter:[a-z]+)\"[^>]*>", "", s)
    s = s.replace("</head>", head + "</head>", 1)
    ssr = f'<div id="ssr" class="container-x" style="padding:24px 16px;max-width:72rem;margin:0 auto;font-family:system-ui,sans-serif;line-height:1.6">{body}</div>' if body else ""
    s = re.sub(r'<div id="root">\s*</div>', f'<div id="root">{ssr}</div>', s, count=1)
    return s


@router.api_route("/seo/page", methods=["GET", "HEAD"])
async def seo_page(request: Request, path: str = "/"):
    shell = load_shell()
    if not shell:
        return Response("Website files not found", status_code=503)
    raw = request.headers.get("x-original-uri") or path
    u = urlparse(raw)
    p = unquote(u.path or "/")
    if len(p) > 300:
        return Response("Not found", status_code=404)
    base = base_url(request)
    s = await get_settings()
    status, title, desc, canon, image, ld, body, robots = await resolve(p, parse_qs(u.query), base)
    page = render(shell, status, title, desc, canon, image, ld, body, robots, base, s.get("name") or "Sellandiamman Estates")
    return HTMLResponse(page, status_code=status, headers={"Cache-Control": "no-cache"})


@router.api_route("/sitemap.xml", methods=["GET", "HEAD"])
async def sitemap(request: Request):
    base = base_url(request)
    from routes_cms import published
    site = await published()
    pages = ["", "/properties", "/properties?transaction=sale", "/properties?transaction=rent", "/properties?transaction=lease",
             "/properties?transaction=short_stay", "/services", "/list-property", "/requirement", "/insights", "/about", "/contact", "/faq",
             "/legal/privacy", "/legal/terms", "/legal/disclaimer", "/legal/cookies"]
    pages += [f"/services/{x['slug']}" for x in site["services"]]
    towns = await places_with_counts()
    for t, v in towns.items():
        pages.append(f"/properties-in/{slug(t)}")
        pages += [f"/properties-in/{slug(t)}/{slug(loc)}" for loc, c in v["localities"].items() if loc and c]
    props = await db.properties.find(LIVE, {"_id": 0, "listing_id": 1, "updated_at": 1, "images": 1, "title": 1}).to_list(10000)
    posts = await db.posts.find({"status": "published", "deleted": {"$ne": True}, "audience": {"$ne": "investors"}},
                                {"_id": 0, "slug": 1, "updated_at": 1, "cover_image": 1}).to_list(5000)
    E2 = lambda v: html.escape(str(v), quote=True)  # noqa: E731
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">']
    for u in pages:
        out.append(f"<url><loc>{E2(base + u)}</loc></url>")
    for p in props:
        if not p.get("listing_id"):
            continue
        imgs = "".join(f"<image:image><image:loc>{E2(abs_url(i, base))}</image:loc></image:image>" for i in (p.get("images") or [])[:5])
        lm = f"<lastmod>{(p.get('updated_at') or '')[:10]}</lastmod>" if p.get("updated_at") else ""
        out.append(f"<url><loc>{E2(base)}/properties/{E2(p['listing_id'])}</loc>{lm}{imgs}</url>")
    for p in posts:
        img = f"<image:image><image:loc>{E2(abs_url(p['cover_image'], base))}</image:loc></image:image>" if p.get("cover_image") else ""
        out.append(f"<url><loc>{E2(base)}/insights/{E2(p['slug'])}</loc><lastmod>{(p.get('updated_at') or '')[:10]}</lastmod>{img}</url>")
    out.append("</urlset>")
    return Response("".join(out), media_type="application/xml", headers={"Cache-Control": "public, max-age=3600"})


@router.api_route("/robots.txt", methods=["GET", "HEAD"])
async def robots(request: Request):
    base = base_url(request)
    rules = "Allow: /\nAllow: /s/\nAllow: /api/public/media/\nDisallow: /erp\nDisallow: /owner\nDisallow: /investor\nDisallow: /shortlist\nDisallow: /api/\n"
    txt = "# Search engines and AI assistants are welcome to read the public pages. Private areas are closed.\n"
    txt += f"# A plain-text summary for AI assistants: {base}/llms.txt\n\nUser-agent: *\n{rules}\n"
    for bot in AI_BOTS:
        txt += f"User-agent: {bot}\n{rules}\n"
    txt += f"Sitemap: {base}/sitemap.xml\n"
    return Response(txt, media_type="text/plain", headers={"Cache-Control": "public, max-age=3600"})


async def _llms(request, full=False):
    base = base_url(request)
    s = await get_settings()
    from routes_cms import published
    site = await published()
    branches = await db.branches.find({"active": {"$ne": False}}, {"_id": 0}).sort([("is_head_office", -1), ("order", 1)]).to_list(100)
    towns = await places_with_counts()
    name = s.get("name") or "Sellandiamman Estates"
    lines = [f"# {name}", "", f"> {site.get('footer_tagline')}", "",
             f"{name} is a real estate services company in Tamil Nadu, India (part of the Sellandiamman Group). Head office: "
             f"{next((b['city'] for b in branches if b.get('is_head_office')), branches[0]['city'] if branches else 'Perundurai')}. "
             f"Branches: {', '.join(b['name'] for b in branches)}. Prices are in Indian rupees (INR). Listings are third-party owned "
             "unless stated, and are published only after ownership review and the owner's written marketing authorisation.", "",
             "## Contact", f"- Phone: {s.get('phone')}", f"- Email: {s.get('email')}", f"- Office hours: {s.get('office_hours')}"]
    if s.get("rera_no"):
        lines.append(f"- TNRERA agent registration: {s['rera_no']}")
    lines += ["", "## Branches"] + [f"- {b['name']}{' (head office)' if b.get('is_head_office') else ''}: {b.get('address') or ''} {b.get('phone') or ''}".rstrip() for b in branches]
    lines += ["", "## Services"] + [f"- [{x['title']}]({base}/services/{x['slug']}): {x['summary']}" for x in site["services"]]
    lines += ["", "## Areas served"] + [f"- [Properties in {t}]({base}/properties-in/{slug(t)}): {v['count']} listed" for t, v in sorted(towns.items())]
    lines += ["", "## Key pages", f"- [All properties]({base}/properties)", f"- [Post a requirement]({base}/requirement)",
              f"- [List a property]({base}/list-property)", f"- [FAQ]({base}/faq)", f"- [Insights]({base}/insights)", f"- [Contact]({base}/contact)"]
    props = await db.properties.find(LIVE, {"_id": 0}).sort("published_at", -1).to_list(5000 if full else 40)
    lines += ["", "## Current listings" + ("" if full else " (latest)")]
    for p in props:
        extra = f" {p['bedrooms']} bedrooms," if p.get("bedrooms") else ""
        area = p.get("built_area") or p.get("plot_area")
        line = f"- [{p['title']}]({base}/properties/{p['listing_id']}): {price_text(p)}, {TX.get(p['transaction'], '')} in {p['locality']}, {p['city']}.{extra}"
        if area:
            line += f" {area:,.0f} {p.get('area_unit') or 'sq.ft'}."
        if full and p.get("description_public"):
            line += f" {p['description_public']}"
        lines.append(line)
    if full:
        lines += ["", "## Frequently asked questions"] + [f"### {q['q']}\n{q['a']}\n" for q in site["faq"]]
        for x in site["services"]:
            lines += ["", f"## {x['title']}", x["summary"]] + [f"- {pt}" for pt in x["points"]]
    else:
        lines += ["", f"Full detail (all listings, FAQs and services): {base}/llms-full.txt"]
    lines += ["", f"_Updated {today_ist().isoformat()}_", ""]
    return "\n".join(lines)


@router.api_route("/llms.txt", methods=["GET", "HEAD"])
async def llms(request: Request):
    return Response(await _llms(request), media_type="text/plain; charset=utf-8", headers={"Cache-Control": "public, max-age=3600"})


@router.api_route("/llms-full.txt", methods=["GET", "HEAD"])
async def llms_full(request: Request):
    return Response(await _llms(request, True), media_type="text/plain; charset=utf-8", headers={"Cache-Control": "public, max-age=3600"})
