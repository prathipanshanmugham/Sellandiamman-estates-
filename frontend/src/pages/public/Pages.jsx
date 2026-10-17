import { Link, useParams } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import { useTitle, useMeta, asset, telLink } from "../../lib/api";
import { SERVICES, FAQ, LEGAL } from "../../lib/content";
import EnquiryForm from "../../components/public/EnquiryForm";
import { useSite } from "../../components/public/SiteLayout";

export function Services() {
  useTitle("Services", "Brokerage, rental, property management, NRI, short-stay and commercial leasing services.");
  return (
    <div className="container-x py-14">
      <p className="eyebrow">Services</p>
      <h1 className="mt-2 max-w-3xl font-heading text-4xl font-semibold sm:text-5xl">Everything an owner, buyer or tenant needs, handled by one team.</h1>
      <div className="mt-12 grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2">
        {SERVICES.map((s) => <Link key={s.slug} to={`/services/${s.slug}`} className="group bg-white p-8 hover:bg-slate-50" data-testid={`services-card-${s.slug}`}><h2 className="font-heading text-xl font-semibold">{s.title}</h2><p className="mt-2 text-sm text-slate-600">{s.summary}</p><span className="mt-5 inline-flex items-center gap-1 text-sm font-medium">Learn more <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></span></Link>)}
      </div>
    </div>
  );
}

export function ServiceDetail() {
  const { slug } = useParams();
  const s = SERVICES.find((x) => x.slug === slug);
  useTitle(s?.title, s?.summary);
  if (!s) return <div className="container-x py-24">Service not found.</div>;
  const interest = { "property-management": "management", "nri-services": "management", "short-stay": "management", "commercial-industrial": "lease", "rental-brokerage": "rent", "buy-sell": "buy" }[slug] || "other";
  return (
    <div className="container-x grid gap-14 py-14 lg:grid-cols-[1.4fr_1fr]" data-testid={`service-page-${slug}`}>
      <div>
        <Link to="/services" className="text-xs text-slate-500 hover:underline">← All services</Link>
        <h1 className="mt-3 font-heading text-4xl font-semibold sm:text-5xl">{s.title}</h1>
        <p className="mt-5 text-base text-slate-600 md:text-lg">{s.summary}</p>
        <ul className="mt-10 space-y-4">{s.points.map((p) => <li key={p} className="flex gap-3 border-b border-slate-100 pb-4 text-sm text-slate-700"><Check size={16} className="mt-0.5 shrink-0" />{p}</li>)}</ul>
        <p className="mt-8 text-sm text-slate-500">Fees and terms are agreed in writing before any engagement.</p>
      </div>
      <div className="border border-slate-200 p-6 lg:self-start"><EnquiryForm kind={interest === "management" ? "management" : "enquiry"} defaultInterest={interest} title="Talk to our team" testid="service-enquiry" /></div>
    </div>
  );
}

export function About() {
  useTitle("About us");
  return (
    <div>
      <section className="container-x grid gap-12 py-16 lg:grid-cols-2">
        <div><p className="eyebrow">About</p><h1 className="mt-2 font-heading text-4xl font-semibold sm:text-5xl">Sellandiamman Estates</h1>
          <p className="mt-6 text-base leading-relaxed text-slate-600">Sellandiamman Estates is the real estate services arm of the Sellandiamman Group. We help owners sell, rent, lease and manage their properties, and help buyers, tenants and businesses find the right space in Erode and Perundurai.</p>
          <p className="mt-4 text-base leading-relaxed text-slate-600">We work on an asset-light model: we do not buy land or build. Our role is to represent owners and clients with clear written terms, verified listings and transparent reporting.</p></div>
        <img src={asset("/images/estate.jpg")} alt="Residential property" className="aspect-[4/3] w-full object-cover" />
      </section>
    </div>
  );
}

export function Contact() {
  const site = useSite();
  useTitle("Contact us", "Contact Sellandiamman Estates in Erode and Perundurai.");
  return (
    <div className="container-x py-14">
      <p className="eyebrow">Contact</p><h1 className="mt-2 font-heading text-4xl font-semibold">Speak with our team</h1>
      <div className="mt-10 grid gap-10 lg:grid-cols-3">
        <div className="space-y-4 text-sm text-slate-700" data-testid="contact-details"><p><span className="eyebrow block">Office</span>{site.address}</p><p><span className="eyebrow block">Phone</span><a href={telLink(site.phone)} className="hover:underline">{site.phone}</a></p><p><span className="eyebrow block">Email</span><a href={`mailto:${site.email}`} className="break-all hover:underline">{site.email}</a></p><p><span className="eyebrow block">Hours</span>{site.office_hours}</p><p className="border-t border-slate-200 pt-4"><span className="eyebrow block">Looking for something specific?</span><Link to="/requirement" className="font-medium underline">Post your requirement</Link> and we will match it with new listings.</p></div>
        <div className="border border-slate-200 p-6"><EnquiryForm kind="callback" title="Request a callback" testid="callback" /></div>
        <div className="border border-slate-200 p-6"><EnquiryForm kind="management" defaultInterest="management" showInterest={false} title="Property management enquiry" testid="management" /></div>
      </div>
    </div>
  );
}

export function Faq() {
  useTitle("Frequently asked questions");
  return (
    <div className="container-x max-w-3xl py-14"><p className="eyebrow">FAQ</p><h1 className="mt-2 font-heading text-4xl font-semibold">Frequently asked questions</h1>
      <div className="mt-10 divide-y divide-slate-200 border-y border-slate-200">{FAQ.map(([q, a], i) => <details key={q} className="group py-5" data-testid={`faq-item-${i}`}><summary className="cursor-pointer list-none font-medium text-slate-900">{q}</summary><p className="mt-3 text-sm text-slate-600">{a}</p></details>)}</div>
    </div>
  );
}

export function Legal() {
  const { slug } = useParams();
  const doc = LEGAL[slug];
  useTitle(doc?.title);
  if (!doc) return <div className="container-x py-24">Page not found.</div>;
  return (
    <div className="container-x prose-legal max-w-3xl py-14" data-testid={`legal-${slug}`}><h1 className="font-heading text-4xl font-semibold">{doc.title}</h1><p className="mt-2 text-xs text-slate-400">This is a template. Please have it reviewed by your legal advisor before going live.</p>
      {doc.body.map(([h, p]) => <div key={h}><h2>{h}</h2><p>{p}</p></div>)}
    </div>
  );
}

export function Requirement() {
  useMeta({ title: "Post your requirement", description: "Tell us the home, plot, shop, office or factory shed you need in Erode or Perundurai. We match it with verified listings.", path: "/requirement" });
  return (
    <div className="container-x grid gap-14 py-14 lg:grid-cols-[1fr_1.3fr]" data-testid="requirement-page">
      <div>
        <p className="eyebrow">Requirement</p>
        <h1 className="mt-2 font-heading text-4xl font-semibold">Tell us what you need</h1>
        <p className="mt-5 text-slate-600">Not every property is advertised. Share your budget, area and must-haves, and an agent will send you verified matches, including new listings before they go online.</p>
        <ul className="mt-8 space-y-3 text-sm text-slate-700">
          {["Homes and plots for buyers", "Rentals for families and working professionals", "Shops, offices and showrooms", "Factory sheds and warehouses near SIPCOT and Chithode"].map((t) => <li key={t} className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0" />{t}</li>)}
        </ul>
      </div>
      <div className="border border-slate-200 p-6 sm:p-8"><EnquiryForm kind="requirement" title="Your requirement" testid="requirement" /></div>
    </div>
  );
}

export function NotFound() {
  useMeta({ title: "Page not found", noindex: true });
  return (
    <div className="container-x py-24" data-testid="not-found">
      <p className="eyebrow">404</p>
      <h1 className="mt-2 font-heading text-3xl font-semibold">This page does not exist</h1>
      <p className="mt-3 text-sm text-slate-600">The link may be old or mistyped.</p>
      <div className="mt-6 flex flex-wrap gap-2"><Link to="/properties" className="btn-dark">Browse properties</Link><Link to="/" className="btn-line">Home</Link></div>
    </div>
  );
}
