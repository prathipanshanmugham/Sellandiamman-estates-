import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { api, errMsg } from "../../lib/api";

const utm = () => {
  const q = new URLSearchParams(window.location.search);
  return { utm_source: q.get("utm_source") || undefined, utm_campaign: q.get("utm_campaign") || undefined };
};

export default function EnquiryForm({ listingId, kind = "enquiry", defaultInterest = "buy", title = "Send an enquiry", showInterest = true, testid = "enquiry" }) {
  const [f, setF] = useState({ name: "", phone: "", email: "", message: "", interest: defaultInterest, preferred_contact: "phone", preferred_time: "", consent: false, marketing_consent: false, website: "" });
  const [state, setState] = useState({ loading: false, error: "", ref: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.name.trim().length < 2) return setState({ loading: false, error: "Please enter your name.", ref: "" });
    if (!/^(\+?91)?[6-9]\d{9}$/.test(f.phone.replace(/[\s\-()]/g, ""))) return setState({ loading: false, error: "Enter a valid 10-digit Indian mobile number.", ref: "" });
    if (!f.consent) return setState({ loading: false, error: "Please accept the privacy policy to continue.", ref: "" });
    setState({ loading: true, error: "", ref: "" });
    try {
      const { data } = await api.post("/public/enquiry", { ...f, email: f.email || null, listing_id: listingId, kind, ...utm() });
      setState({ loading: false, error: "", ref: data.reference });
    } catch (err) { setState({ loading: false, error: errMsg(err), ref: "" }); }
  };
  if (state.ref) return (
    <div className="border border-slate-200 bg-slate-50 p-6" data-testid={`${testid}-success`}>
      <CheckCircle2 className="text-emerald-700" />
      <p className="mt-3 font-heading text-lg font-semibold">Thank you. We have received your request.</p>
      <p className="mt-1 text-sm text-slate-600">Our team will contact you shortly. Reference: <span className="font-mono">{state.ref}</span></p>
    </div>
  );
  return (
    <form onSubmit={submit} className="space-y-4" data-testid={`${testid}-form`} noValidate>
      {title && <h3 className="font-heading text-lg font-semibold">{title}</h3>}
      <input type="text" name="website" value={f.website} onChange={set("website")} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <div><label className="lbl" htmlFor={`${testid}-name`}>Full name</label><input id={`${testid}-name`} className="inp" required value={f.name} onChange={set("name")} data-testid={`${testid}-name-input`} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="lbl" htmlFor={`${testid}-phone`}>Mobile number</label><input id={`${testid}-phone`} className="inp" required inputMode="tel" placeholder="98765 43210" value={f.phone} onChange={set("phone")} data-testid={`${testid}-phone-input`} /></div>
        <div><label className="lbl" htmlFor={`${testid}-email`}>Email (optional)</label><input id={`${testid}-email`} type="email" className="inp" value={f.email} onChange={set("email")} data-testid={`${testid}-email-input`} /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {showInterest && <div><label className="lbl">I want to</label><select className="inp" value={f.interest} onChange={set("interest")} data-testid={`${testid}-interest-select`}>
          {[["buy", "Buy"], ["rent", "Rent"], ["lease", "Lease (commercial)"], ["short_stay", "Book a short stay"], ["sell", "Sell my property"], ["management", "Get my property managed"], ["other", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></div>}
        <div><label className="lbl">Preferred contact</label><select className="inp" value={f.preferred_contact} onChange={set("preferred_contact")} data-testid={`${testid}-contact-select`}><option value="phone">Phone call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></div>
      </div>
      {kind === "callback" && <div><label className="lbl">Preferred time</label><input className="inp" placeholder="e.g. Weekdays after 5 PM" value={f.preferred_time} onChange={set("preferred_time")} data-testid={`${testid}-time-input`} /></div>}
      <div><label className="lbl">Message</label><textarea rows={3} className="inp" value={f.message} onChange={set("message")} data-testid={`${testid}-message-input`} /></div>
      <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" checked={f.consent} onChange={set("consent")} className="mt-0.5" data-testid={`${testid}-consent-checkbox`} /><span>I agree to be contacted about this enquiry and accept the <Link to="/legal/privacy" className="underline">privacy policy</Link>.</span></label>
      <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" checked={f.marketing_consent} onChange={set("marketing_consent")} className="mt-0.5" data-testid={`${testid}-marketing-checkbox`} />Send me new listings and updates (optional).</label>
      {state.error && <p className="text-sm text-red-700" role="alert" data-testid={`${testid}-error`}>{state.error}</p>}
      <button className="btn-dark w-full" disabled={state.loading} data-testid={`${testid}-submit-btn`}>{state.loading ? "Sending…" : kind === "callback" ? "Request a callback" : "Submit enquiry"}</button>
    </form>
  );
}
