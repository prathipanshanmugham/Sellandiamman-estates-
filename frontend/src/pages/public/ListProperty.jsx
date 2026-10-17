import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { api, errMsg, useTitle } from "../../lib/api";
import { useSite } from "../../components/public/SiteLayout";
import Turnstile from "../../components/public/Turnstile";

const SERVICES = ["Sale brokerage", "Rental brokerage", "Property management", "Short-stay management", "Marketing & photography", "Inspection & maintenance"];

export default function ListProperty() {
  useTitle("List your property", "Submit your property to Sellandiamman Estates for verification and marketing.");
  const [f, setF] = useState({ name: "", phone: "", email: "", preferred_contact: "phone", city: "Erode", locality: "", pincode: "", address: "", category: "residential", transaction: "sale", price: "", description: "", declaration: false, website: "" });
  const [services, setServices] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [st, setSt] = useState({ loading: false, error: "", ref: "" });
  const site = useSite();
  const [token, setToken] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (photos.length > 6) return setSt({ ...st, error: "Up to 6 photos allowed" });
    if (f.name.trim().length < 2 || !f.locality.trim()) return setSt({ ...st, error: "Please enter your name and the property's locality." });
    if (!/^(\+?91)?[6-9]\d{9}$/.test(f.phone.replace(/[\s\-()]/g, ""))) return setSt({ ...st, error: "Enter a valid 10-digit Indian mobile number." });
    if (!f.declaration) return setSt({ ...st, error: "Please confirm you are the owner or authorised by the owner." });
    if (site.turnstile_site_key && !token) return setSt({ ...st, error: "Please complete the 'I am human' check." });
    setSt({ loading: true, error: "", ref: "" });
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => { if (v !== "" && v !== null) fd.append(k, v); });
    fd.append("services", services.join(", "));
    if (token) fd.append("cf_token", token);
    photos.forEach((p) => fd.append("photos", p));
    try { const { data } = await api.post("/public/owner-submission", fd); setSt({ loading: false, error: "", ref: data.reference }); }
    catch (err) { setSt({ loading: false, error: errMsg(err), ref: "" }); }
  };
  if (st.ref) return (
    <div className="container-x max-w-2xl py-24" data-testid="owner-submission-success"><CheckCircle2 className="text-emerald-700" size={32} /><h1 className="mt-4 font-heading text-3xl font-semibold">Submission received</h1><p className="mt-3 text-slate-600">Reference <span className="font-mono">{st.ref}</span>. Our team will verify ownership and contact you before anything is published.</p><Link to="/" className="btn-dark mt-8">Back to home</Link></div>
  );
  const inp = (k, l, props = {}) => <div><label className="lbl" htmlFor={`own-${k}`}>{l}</label><input id={`own-${k}`} className="inp" value={f[k]} onChange={set(k)} data-testid={`owner-${k}-input`} {...props} /></div>;
  return (
    <div className="container-x grid gap-14 py-14 lg:grid-cols-[1fr_1.6fr]">
      <div><p className="eyebrow">For owners</p><h1 className="mt-2 font-heading text-4xl font-semibold">List your property</h1>
        <p className="mt-5 text-slate-600">Tell us about your property. Every submission is reviewed by our team. We verify ownership and agree terms in writing before any listing goes live.</p>
        <ol className="mt-8 space-y-4 text-sm text-slate-700">{["Submit details and photos", "We call you to understand your goals", "Ownership verification and written authorisation", "Professional listing and marketing"].map((s, i) => <li key={s} className="flex gap-3"><span className="font-mono text-slate-400">0{i + 1}</span>{s}</li>)}</ol></div>
      <form onSubmit={submit} noValidate className="space-y-5 border border-slate-200 p-5 sm:p-8" data-testid="owner-submission-form">
        <input type="text" className="hidden" tabIndex={-1} value={f.website} onChange={set("website")} aria-hidden="true" />
        <div className="grid gap-4 sm:grid-cols-2">{inp("name", "Owner name", { required: true })}{inp("phone", "Mobile number", { required: true, inputMode: "tel" })}{inp("email", "Email (optional)", { type: "email" })}
          <div><label className="lbl">Preferred contact</label><select className="inp" value={f.preferred_contact} onChange={set("preferred_contact")} data-testid="owner-contact-select"><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></div></div>
        <div className="grid gap-4 sm:grid-cols-3"><div><label className="lbl">City</label><select className="inp" value={f.city} onChange={set("city")} data-testid="owner-city-select"><option>Erode</option><option>Perundurai</option><option>Other</option></select></div>{inp("locality", "Locality", { required: true })}{inp("pincode", "PIN code", { maxLength: 6, inputMode: "numeric" })}</div>
        <div><label className="lbl">Full address (kept private)</label><textarea className="inp" rows={2} value={f.address} onChange={set("address")} data-testid="owner-address-input" /></div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div><label className="lbl">Category</label><select className="inp" value={f.category} onChange={set("category")} data-testid="owner-category-select">{[["residential", "House / villa"], ["apartment", "Apartment"], ["land", "Plot / land"], ["agricultural", "Agricultural land"], ["commercial", "Commercial"], ["shop", "Shop / showroom"], ["office", "Office"], ["industrial", "Industrial plot"], ["factory_shed", "Factory shed"], ["warehouse", "Warehouse"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="lbl">I want to</label><select className="inp" value={f.transaction} onChange={set("transaction")} data-testid="owner-transaction-select"><option value="sale">Sell</option><option value="rent">Rent out</option><option value="lease">Lease (commercial)</option><option value="short_stay">Short-stay / Airbnb</option></select></div>
          {inp("price", f.transaction === "sale" ? "Asking price (₹)" : "Expected rent (₹/month)", { type: "number", min: 0 })}
        </div>
        <div><label className="lbl">Description</label><textarea className="inp" rows={4} value={f.description} onChange={set("description")} data-testid="owner-description-input" /></div>
        <fieldset><legend className="lbl">Services of interest</legend><div className="grid gap-2 sm:grid-cols-2">{SERVICES.map((s) => <label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={services.includes(s)} onChange={(e) => setServices(e.target.checked ? [...services, s] : services.filter((x) => x !== s))} />{s}</label>)}</div></fieldset>
        <div><label className="lbl">Photos (up to 6, JPG/PNG/WebP, 5 MB each)</label><input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhotos([...e.target.files])} className="text-sm" data-testid="owner-photos-input" /></div>
        <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.declaration} onChange={set("declaration")} className="mt-1" data-testid="owner-declaration-checkbox" />I confirm I am the owner of this property or am authorised by the owner to submit it, and I accept the <Link to="/legal/privacy" className="underline">privacy policy</Link>.</label>
        <Turnstile siteKey={site.turnstile_site_key} onToken={setToken} />
        {st.error && <p className="text-sm text-red-700" role="alert" data-testid="owner-submission-error">{st.error}</p>}
        <button className="btn-dark w-full" disabled={st.loading} data-testid="owner-submit-btn">{st.loading ? "Submitting…" : "Submit for review"}</button>
      </form>
    </div>
  );
}
