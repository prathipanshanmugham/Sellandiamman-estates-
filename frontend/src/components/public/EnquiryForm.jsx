import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { api, errMsg, todayIST, fmtDate } from "../../lib/api";
import { useSite } from "./SiteLayout";
import Turnstile from "./Turnstile";

const utm = () => {
  const q = new URLSearchParams(window.location.search);
  return { utm_source: q.get("utm_source") || undefined, utm_campaign: q.get("utm_campaign") || undefined };
};

const INTERESTS = [["buy", "Buy"], ["rent", "Rent"], ["lease", "Lease (commercial)"], ["short_stay", "Book a short stay"], ["sell", "Sell my property"], ["management", "Get my property managed"], ["other", "Other"]];
const SLOTS = [["morning", "Morning (10 AM – 12 PM)"], ["afternoon", "Afternoon (2 – 4 PM)"], ["evening", "Evening (4 – 6 PM)"]];
const CATEGORIES = [["", "Any type"], ["House / villa", "House / villa"], ["Apartment", "Apartment"], ["Plot / land", "Plot / land"], ["Agricultural land", "Agricultural land"], ["Shop / showroom", "Shop / showroom"], ["Office", "Office"], ["Factory shed / industrial", "Factory shed / industrial"], ["Warehouse", "Warehouse"]];

// kind: enquiry | callback | management | visit | requirement
export default function EnquiryForm({ listingId, kind = "enquiry", defaultInterest = "buy", title = "Send an enquiry", showInterest = true, testid = "enquiry", submitLabel }) {
  const site = useSite();
  const [f, setF] = useState({ name: "", phone: "", email: "", message: "", interest: defaultInterest, preferred_contact: "phone", preferred_time: "", preferred_date: "", preferred_slot: "morning", category: "", preferred_locations: "", budget_max: "", consent: false, marketing_consent: false, website: "" });
  const [token, setToken] = useState("");
  const [state, setState] = useState({ loading: false, error: "", ref: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const fail = (error) => setState({ loading: false, error, ref: "" });
  const submit = async (e) => {
    e.preventDefault();
    if (f.name.trim().length < 2) return fail("Please enter your name.");
    if (!/^(\+?91)?[6-9]\d{9}$/.test(f.phone.replace(/[\s\-()]/g, ""))) return fail("Enter a valid 10-digit Indian mobile number.");
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return fail("Check the email address, or leave it blank.");
    if (kind === "visit" && !f.preferred_date) return fail("Choose a date for the visit.");
    if (!f.consent) return fail("Please accept the privacy policy to continue.");
    if (site.turnstile_site_key && !token) return fail("Please complete the 'I am human' check.");
    setState({ loading: true, error: "", ref: "" });
    const body = { ...f, email: f.email || null, listing_id: listingId, kind, cf_token: token || undefined, ...utm(),
      budget_max: f.budget_max ? Number(f.budget_max) : null, preferred_date: kind === "visit" ? f.preferred_date : null,
      preferred_slot: kind === "visit" ? f.preferred_slot : null, category: f.category || null, preferred_locations: f.preferred_locations || null };
    try {
      const { data } = await api.post("/public/enquiry", body);
      setState({ loading: false, error: "", ref: data.reference });
    } catch (err) { fail(errMsg(err)); }
  };
  if (state.ref) return (
    <div className="border border-slate-200 bg-slate-50 p-6" data-testid={`${testid}-success`} role="status">
      <CheckCircle2 className="text-emerald-700" />
      <p className="mt-3 font-heading text-lg font-semibold">{kind === "visit" ? "Visit request received." : "Thank you. We have your request."}</p>
      <p className="mt-1 text-sm text-slate-600">{kind === "visit" ? `We will call you to confirm a time on ${fmtDate(f.preferred_date)}.` : "Our team will contact you shortly."} Reference: <span className="font-mono">{state.ref}</span></p>
    </div>
  );
  const id = (k) => `${testid}-${k}`;
  return (
    <form onSubmit={submit} className="space-y-4" data-testid={`${testid}-form`} noValidate>
      {title && <h3 className="font-heading text-lg font-semibold">{title}</h3>}
      <input type="text" name="website" value={f.website} onChange={set("website")} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <div><label className="lbl" htmlFor={id("name")}>Full name</label><input id={id("name")} className="inp" autoComplete="name" required value={f.name} onChange={set("name")} data-testid={`${testid}-name-input`} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="lbl" htmlFor={id("phone")}>Mobile number</label><input id={id("phone")} className="inp" required inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={f.phone} onChange={set("phone")} data-testid={`${testid}-phone-input`} /></div>
        <div><label className="lbl" htmlFor={id("email")}>Email (optional)</label><input id={id("email")} type="email" autoComplete="email" className="inp" value={f.email} onChange={set("email")} data-testid={`${testid}-email-input`} /></div>
      </div>
      {kind === "visit" && <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="lbl" htmlFor={id("date")}>Preferred date</label><input id={id("date")} type="date" min={todayIST()} className="inp" value={f.preferred_date} onChange={set("preferred_date")} data-testid={`${testid}-date-input`} /></div>
        <div><label className="lbl" htmlFor={id("slot")}>Time of day</label><select id={id("slot")} className="inp" value={f.preferred_slot} onChange={set("preferred_slot")} data-testid={`${testid}-slot-select`}>{SLOTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </div>}
      {kind === "requirement" && <>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="lbl" htmlFor={id("cat")}>Property type</label><select id={id("cat")} className="inp" value={f.category} onChange={set("category")} data-testid={`${testid}-category-select`}>{CATEGORIES.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select></div>
          <div><label className="lbl" htmlFor={id("budget")}>{["rent", "lease"].includes(f.interest) ? "Monthly budget up to (₹)" : "Budget up to (₹)"}</label><input id={id("budget")} type="number" min="0" inputMode="numeric" className="inp" value={f.budget_max} onChange={set("budget_max")} data-testid={`${testid}-budget-input`} /></div>
        </div>
        <div><label className="lbl" htmlFor={id("locs")}>Preferred localities</label><input id={id("locs")} className="inp" placeholder="e.g. Thindal, Perundurai Road, SIPCOT" value={f.preferred_locations} onChange={set("preferred_locations")} data-testid={`${testid}-locations-input`} /></div>
      </>}
      <div className="grid gap-4 sm:grid-cols-2">
        {showInterest && kind !== "visit" && <div><label className="lbl" htmlFor={id("interest")}>I want to</label><select id={id("interest")} className="inp" value={f.interest} onChange={set("interest")} data-testid={`${testid}-interest-select`}>
          {INTERESTS.filter(([v]) => kind !== "requirement" || !["sell", "management"].includes(v)).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></div>}
        <div><label className="lbl" htmlFor={id("contact")}>Preferred contact</label><select id={id("contact")} className="inp" value={f.preferred_contact} onChange={set("preferred_contact")} data-testid={`${testid}-contact-select`}><option value="phone">Phone call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></div>
      </div>
      {kind === "callback" && <div><label className="lbl" htmlFor={id("time")}>Preferred time</label><input id={id("time")} className="inp" placeholder="e.g. Weekdays after 5 PM" value={f.preferred_time} onChange={set("preferred_time")} data-testid={`${testid}-time-input`} /></div>}
      <div><label className="lbl" htmlFor={id("msg")}>{kind === "requirement" ? "Anything else (size, facing, timeline)" : "Message"}</label><textarea id={id("msg")} rows={3} className="inp" value={f.message} onChange={set("message")} data-testid={`${testid}-message-input`} /></div>
      <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" checked={f.consent} onChange={set("consent")} className="mt-0.5" data-testid={`${testid}-consent-checkbox`} /><span>I agree to be contacted about this request and accept the <Link to="/legal/privacy" className="underline">privacy policy</Link>.</span></label>
      <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" checked={f.marketing_consent} onChange={set("marketing_consent")} className="mt-0.5" data-testid={`${testid}-marketing-checkbox`} />Send me new listings that match (optional).</label>
      <Turnstile siteKey={site.turnstile_site_key} onToken={setToken} />
      {state.error && <p className="text-sm text-red-700" role="alert" data-testid={`${testid}-error`}>{state.error}</p>}
      <button className="btn-dark w-full" disabled={state.loading} data-testid={`${testid}-submit-btn`}>{state.loading ? "Sending…" : submitLabel || { callback: "Request a callback", visit: "Request this visit", requirement: "Send my requirement" }[kind] || "Submit enquiry"}</button>
    </form>
  );
}
