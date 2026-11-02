import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { api, errMsg, inr0 } from "../../lib/api";
import Turnstile from "./Turnstile";

const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const WD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function Month({ first, taken, today, ci, co, pick }) {
  const y = first.getUTCFullYear(), m = first.getUTCMonth();
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(new Date(Date.UTC(y, m, i + 1))))];
  return (
    <div>
      <p className="mb-2 text-center text-sm font-semibold">{first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
      <div className="grid grid-cols-7 gap-px text-center text-[11px]">
        {WD.map((w) => <span key={w} className="py-1 text-slate-400">{w}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const past = d < today, busy = taken(d);
          const sel = d === ci || d === co, inside = ci && co && d > ci && d < co;
          return <button type="button" key={d} disabled={past || (busy && !(ci && !co && d > ci))} onClick={() => pick(d)}
            className={`py-1.5 text-xs tabular ${sel ? "bg-slate-900 font-semibold text-white" : inside ? "bg-slate-200" : busy ? "text-slate-300 line-through" : past ? "text-slate-300" : "hover:bg-slate-100"}`}
            aria-label={`${d}${busy ? " (taken)" : ""}`} aria-pressed={sel} data-testid={`stay-day-${d}`}>{Number(d.slice(8))}</button>;
        })}
      </div>
    </div>
  );
}

// Short-stay homes on the website: free dates from the shared calendar (bookings from every platform and closed
// dates), a price estimate, and a request that the team confirms on WhatsApp or phone.
export default function StayBox({ p, siteKey }) {
  const [av, setAv] = useState(null);
  const [start, setStart] = useState(0);
  const [ci, setCi] = useState("");
  const [co, setCo] = useState("");
  const [f, setF] = useState({ name: "", phone: "", email: "", guests: 2, message: "", consent: false, website: "" });
  const [token, setToken] = useState("");
  const [st, setSt] = useState({ busy: false, error: "", done: null });
  useEffect(() => { api.get(`/public/properties/${p.listing_id}/availability`).then((r) => setAv(r.data)).catch(() => setAv(false)); }, [p.listing_id]);
  const takenSet = useMemo(() => {
    const s = new Set();
    (av?.taken || []).forEach((r) => { for (let d = r.start; d < r.end; d = addDays(d, 1)) s.add(d); });
    return s;
  }, [av]);
  if (av === false) return null;
  if (!av) return <p className="text-sm text-slate-500">Loading dates…</p>;
  const today = av.today;
  const months = [0, 1].map((k) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + start + k); return d; });
  const clash = (a, b) => { for (let d = a; d < b; d = addDays(d, 1)) if (takenSet.has(d)) return true; return false; };
  const pick = (d) => {
    setSt((x) => ({ ...x, error: "" }));
    if (!ci || co || d <= ci) { setCi(d); setCo(""); return; }
    if (clash(ci, d)) { setSt((x) => ({ ...x, error: "Some nights in between are taken. Choose other dates." })); return; }
    setCo(d);
  };
  const n = ci && co ? nightsBetween(ci, co) : 0;
  let est = 0;
  for (let d = ci; n && d < co; d = addDays(d, 1)) { const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); est += (wd === 5 || wd === 6) && av.weekend_rate ? av.weekend_rate : av.base_rate; }
  if (n) est += av.cleaning_fee || 0;
  const tooShort = n && n < (av.min_nights || 1);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (!n) return setSt({ ...st, error: "Choose your check-in and check-out dates on the calendar." });
    if (tooShort) return setSt({ ...st, error: `The minimum stay is ${av.min_nights} nights.` });
    if (f.name.trim().length < 2 || !/^(\+?91)?[6-9]\d{9}$/.test(f.phone.replace(/[\s\-()]/g, ""))) return setSt({ ...st, error: "Enter your name and a valid 10-digit mobile number." });
    if (!f.consent) return setSt({ ...st, error: "Please accept the privacy policy." });
    if (siteKey && !token) return setSt({ ...st, error: "Please complete the 'I am human' check." });
    setSt({ busy: true, error: "", done: null });
    try {
      const { data } = await api.post("/public/stay-request", { listing_id: p.listing_id, check_in: ci, check_out: co, guests: Number(f.guests) || 1, name: f.name, phone: f.phone, email: f.email || null, message: f.message || null, consent: true, website: f.website, cf_token: token || null });
      setSt({ busy: false, error: "", done: data });
    } catch (err) { setSt({ busy: false, error: errMsg(err), done: null }); }
  };
  if (st.done) return <div className="text-sm" data-testid="stay-request-done"><CheckCircle2 className="text-emerald-700" size={24} /><p className="mt-2 font-semibold">Request sent · {st.done.reference}</p><p className="mt-1 text-slate-600">{st.done.nights} nights, about {inr0(st.done.estimate)}. Our team will call or WhatsApp you to confirm the booking and payment. Your dates are not held until then.</p></div>;
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="stay-box" noValidate>
      <input type="text" className="hidden" tabIndex={-1} value={f.website} onChange={set("website")} aria-hidden="true" />
      <div className="flex items-center justify-between"><button type="button" className="p-1 disabled:opacity-30" onClick={() => setStart(Math.max(0, start - 1))} disabled={start === 0} aria-label="Earlier months"><ChevronLeft size={16} /></button><span className="text-xs text-slate-500">Tap check-in, then check-out</span><button type="button" className="p-1 disabled:opacity-30" onClick={() => setStart(Math.min(5, start + 1))} disabled={start >= 5} aria-label="Later months"><ChevronRight size={16} /></button></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{months.map((m) => <Month key={m.toISOString()} first={m} taken={(d) => takenSet.has(d)} today={today} ci={ci} co={co} pick={pick} />)}</div>
      <p className="text-xs text-slate-500" aria-live="polite" data-testid="stay-summary">{n ? `${n} night${n > 1 ? "s" : ""} · about ${inr0(est)} including cleaning${tooShort ? ` · minimum ${av.min_nights} nights` : ""}` : `From ${inr0(av.base_rate)} a night${av.weekend_rate ? ` (${inr0(av.weekend_rate)} Fri–Sat)` : ""}${av.min_nights > 1 ? ` · minimum ${av.min_nights} nights` : ""}`}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className="lbl" htmlFor="sr-name">Your name</label><input id="sr-name" className="inp" value={f.name} onChange={set("name")} data-testid="stay-name" /></div>
        <div><label className="lbl" htmlFor="sr-phone">Mobile</label><input id="sr-phone" className="inp" inputMode="tel" value={f.phone} onChange={set("phone")} data-testid="stay-phone" /></div>
        <div><label className="lbl" htmlFor="sr-guests">Guests</label><input id="sr-guests" type="number" min="1" max={av.max_guests || 20} className="inp" value={f.guests} onChange={set("guests")} data-testid="stay-guests" /></div>
        <div className="col-span-2"><label className="lbl" htmlFor="sr-msg">Message (optional)</label><textarea id="sr-msg" rows={2} className="inp" value={f.message} onChange={set("message")} /></div>
      </div>
      <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" className="mt-0.5" checked={f.consent} onChange={set("consent")} data-testid="stay-consent" /><span>I agree to be contacted about this booking and accept the <Link to="/legal/privacy" className="underline">privacy policy</Link>.</span></label>
      <Turnstile siteKey={siteKey} onToken={setToken} />
      {st.error && <p className="text-sm text-red-700" role="alert" data-testid="stay-error">{st.error}</p>}
      <button className="btn-dark w-full" disabled={st.busy} data-testid="stay-submit">{st.busy ? "Sending…" : "Request these dates"}</button>
    </form>
  );
}
