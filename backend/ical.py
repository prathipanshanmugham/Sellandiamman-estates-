"""Minimal iCalendar (RFC 5545) reading and writing for short-stay calendar sync with booking platforms.
Platforms share availability as all-day events: DTSTART = check-in, DTEND = check-out (exclusive)."""
from datetime import date, datetime, timezone

UID_DOMAIN = "sellandiamman-estates"


def _unfold(text):
    lines = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _unescape(v):
    return v.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\").strip()


def _to_date(v):
    v = v.strip()
    try:
        if len(v) >= 8 and v[:8].isdigit():
            if "T" in v and v.endswith("Z"):
                # a timed UTC value: use the India date it falls on
                dt = datetime.strptime(v[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
                from core import IST
                return dt.astimezone(IST).date()
            return date(int(v[:4]), int(v[4:6]), int(v[6:8]))
    except ValueError:
        return None
    return None


def parse(text, limit=2000):
    """Returns [{uid, start, end, summary, description, status}] for each VEVENT with valid dates."""
    events, cur = [], None
    for line in _unfold(text or ""):
        if line == "BEGIN:VEVENT":
            cur = {}
            continue
        if line == "END:VEVENT":
            if cur is not None:
                s, e = cur.get("DTSTART"), cur.get("DTEND")
                if s and not e:
                    from datetime import timedelta
                    e = s + timedelta(days=1)
                if s and e and e > s:
                    events.append({"uid": cur.get("UID") or f"{s}-{e}", "start": s.isoformat(), "end": e.isoformat(),
                                   "summary": cur.get("SUMMARY") or "", "description": cur.get("DESCRIPTION") or "",
                                   "status": (cur.get("STATUS") or "CONFIRMED").upper()})
            cur = None
            if len(events) >= limit:
                break
            continue
        if cur is None or ":" not in line:
            continue
        head, value = line.split(":", 1)
        name = head.split(";", 1)[0].upper()
        if name in ("DTSTART", "DTEND"):
            cur[name] = _to_date(value)
        elif name in ("UID", "SUMMARY", "DESCRIPTION", "STATUS"):
            cur[name] = _unescape(value)[:500]
    return events


def _fold(line):
    out, b = [], line.encode("utf-8")
    while len(b) > 75:
        cut = 75
        while cut > 0 and (b[cut] & 0xC0) == 0x80:  # do not split a multi-byte character
            cut -= 1
        out.append(b[:cut].decode("utf-8"))
        b = b" " + b[cut:]
    out.append(b.decode("utf-8"))
    return "\r\n".join(out)


def _esc(v):
    return str(v or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def build(name, events):
    """events: [{uid, start (YYYY-MM-DD), end, summary}] -> .ics text. Summaries never carry guest details."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", f"PRODID:-//Sellandiamman Estates//Short stays//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", f"X-WR-CALNAME:{_esc(name)}"]
    for e in events:
        lines += ["BEGIN:VEVENT", f"UID:{e['uid']}@{UID_DOMAIN}", f"DTSTAMP:{stamp}",
                  f"DTSTART;VALUE=DATE:{e['start'].replace('-', '')}", f"DTEND;VALUE=DATE:{e['end'].replace('-', '')}",
                  f"SUMMARY:{_esc(e.get('summary') or 'Reserved')}", "TRANSP:OPAQUE", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(ln) for ln in lines) + "\r\n"


def is_ours(uid):
    return (uid or "").endswith(f"@{UID_DOMAIN}")


def is_block(summary):
    """Platforms send owner-closed dates as e.g. 'Airbnb (Not available)', 'CLOSED - Not available', 'Blocked'."""
    s = (summary or "").lower()
    return any(w in s for w in ("not available", "blocked", "closed", "unavailable"))
