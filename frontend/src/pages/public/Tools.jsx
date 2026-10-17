import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { inr, inr0, num, useMeta } from "../../lib/api";
import { amortization, affordability, tnPurchaseCosts, AREA_UNITS, convertArea, rentalYield, leaseSchedule, shortStayEstimate, TN_RATES } from "../../lib/calc";

const SECTIONS = [["emi", "Loan EMI"], ["afford", "Affordability"], ["stamp-duty", "Stamp duty"], ["area", "Area converter"], ["yield", "Rental yield"], ["lease", "Lease escalation"], ["short-stay", "Short-stay income"]];

function Num({ id, label, value, onChange, suffix, prefix = "₹", step = "any", min = 0, hint, compact = true }) {
  const v = Number(value);
  return (
    <div>
      <label className="lbl" htmlFor={id}>{label}</label>
      <div className="flex items-stretch border border-slate-300 bg-white focus-within:border-slate-900 focus-within:ring-1 focus-within:ring-slate-900">
        {prefix && <span className="flex items-center bg-slate-50 px-2.5 text-sm text-slate-500">{prefix}</span>}
        <input id={id} type="number" inputMode="decimal" min={min} step={step} className="w-full min-w-0 bg-white px-3 py-2 text-sm tabular focus:outline-none" value={value} onChange={(e) => onChange(e.target.value)} data-testid={`calc-${id}`} />
        {suffix && <span className="flex items-center bg-slate-50 px-2.5 text-sm text-slate-500">{suffix}</span>}
      </div>
      {(hint || (prefix === "₹" && compact && v >= 1e5)) && <p className="mt-1 text-xs text-slate-500">{prefix === "₹" && compact && v >= 1e5 ? inr(v, true) : ""}{hint ? ` ${hint}` : ""}</p>}
    </div>
  );
}

function Result({ label, value, big, note, testid }) {
  return <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0"><span className="text-sm text-slate-600">{label}{note && <span className="block text-xs text-slate-400">{note}</span>}</span><span className={`shrink-0 text-right tabular ${big ? "font-heading text-2xl font-semibold text-slate-900" : "text-sm font-semibold text-slate-900"}`} data-testid={testid}>{value}</span></div>;
}

function Block({ id, title, intro, children }) {
  return (
    <section id={id} className="scroll-mt-32 border-t border-slate-200 py-12" data-testid={`tool-${id}`}>
      <h2 className="font-heading text-2xl font-semibold">{title}</h2>
      {intro && <p className="mt-2 max-w-2xl text-sm text-slate-600">{intro}</p>}
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_1.1fr]">{children}</div>
    </section>
  );
}

const Split = ({ a, b, la, lb }) => {
  const t = a + b || 1;
  return <div className="mt-4"><div className="flex h-3 w-full overflow-hidden bg-slate-100"><div className="bg-slate-900" style={{ width: `${(a / t) * 100}%` }} /><div className="bg-brand" style={{ width: `${(b / t) * 100}%` }} /></div><div className="mt-2 flex justify-between text-xs text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 bg-slate-900" />{la} {Math.round((a / t) * 100)}%</span><span><i className="mr-1 inline-block h-2 w-2 bg-brand" />{lb} {Math.round((b / t) * 100)}%</span></div></div>;
};

function EmiCalc() {
  const [v, setV] = useState({ amount: 5000000, rate: 8.5, years: 20 });
  const set = (k) => (x) => setV({ ...v, [k]: x });
  const a = useMemo(() => amortization(v.amount, v.rate, Number(v.years) * 12), [v]);
  const [open, setOpen] = useState(false);
  return (
    <Block id="emi" title="Home-loan EMI" intro="The monthly instalment for a loan, how much of it is interest, and how the balance falls each year.">
      <div className="grid content-start gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        <Num id="emi-amount" label="Loan amount" value={v.amount} onChange={set("amount")} />
        <Num id="emi-rate" label="Interest rate (yearly)" value={v.rate} onChange={set("rate")} prefix="" suffix="%" step="0.05" />
        <Num id="emi-years" label="Tenure" value={v.years} onChange={set("years")} prefix="" suffix="years" step="1" />
      </div>
      <div className="panel p-5">
        <Result label="Monthly EMI" value={inr0(a.emi)} big testid="emi-result" />
        <Result label="Total interest" value={inr0(a.totalInterest)} />
        <Result label="Total paid over the loan" value={inr0(a.totalPaid)} />
        <Split a={Number(v.amount)} b={a.totalInterest} la="Principal" lb="Interest" />
        <button className="mt-4 text-sm font-medium underline" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="emi-schedule-toggle">{open ? "Hide" : "Show"} year-by-year schedule</button>
        {open && <div className="mt-3 max-h-72 overflow-auto"><table className="tbl w-full"><thead><tr><th>Year</th><th className="!text-right">Principal</th><th className="!text-right">Interest</th><th className="!text-right">Balance</th></tr></thead><tbody>{a.years.map((y) => <tr key={y.year}><td>{y.year}</td><td className="text-right tabular">{inr0(y.principal)}</td><td className="text-right tabular">{inr0(y.interest)}</td><td className="text-right tabular">{inr0(y.balance)}</td></tr>)}</tbody></table></div>}
      </div>
    </Block>
  );
}

function AffordCalc() {
  const [v, setV] = useState({ income: 120000, existing: 0, savings: 1500000, rate: 8.5, years: 20, foir: 50 });
  const set = (k) => (x) => setV({ ...v, [k]: x });
  const a = useMemo(() => affordability({ income: v.income, existingEmi: v.existing, savings: v.savings, ratePct: v.rate, years: v.years, foirPct: v.foir }), [v]);
  return (
    <Block id="afford" title="How much can I afford?" intro="Banks usually keep all your EMIs within about half of your take-home pay, lend up to 75–90% of the price depending on the value, and do not fund stamp duty or registration.">
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <Num id="aff-income" label="Take-home income per month" value={v.income} onChange={set("income")} />
        <Num id="aff-existing" label="Existing EMIs per month" value={v.existing} onChange={set("existing")} />
        <Num id="aff-savings" label="Savings for down payment & costs" value={v.savings} onChange={set("savings")} />
        <Num id="aff-rate" label="Interest rate" value={v.rate} onChange={set("rate")} prefix="" suffix="%" step="0.05" />
        <Num id="aff-years" label="Tenure" value={v.years} onChange={set("years")} prefix="" suffix="years" step="1" />
        <Num id="aff-foir" label="Share of income for EMIs" value={v.foir} onChange={set("foir")} prefix="" suffix="%" step="5" hint="Banks use 40–60%." />
      </div>
      <div className="panel p-5">
        <Result label="Property you can aim for" value={inr(a.price, true)} big testid="afford-result" />
        <Result label="Loan" value={inr0(a.loan)} note={`Most a bank may lend on your income: ${inr(a.maxLoan, true)}`} />
        <Result label="Down payment" value={inr0(a.downPayment)} />
        <Result label="Stamp duty & registration (about 9%)" value={inr0(a.fees)} />
        <Result label="EMI" value={`${inr0(a.emi)} / month`} />
        <p className="mt-3 text-xs text-slate-500" data-testid="afford-limit">{a.limitedBy === "savings" ? "Your savings set the limit here: the bank's loan-to-value cap leaves the rest of the price and the purchase costs to you." : "Your income sets the limit here: the EMI the bank allows caps the loan."}</p>
      </div>
    </Block>
  );
}

function StampCalc() {
  const [v, setV] = useState({ price: 6500000, guideline: 5200000, women: false, legal: 25000, brokerage: 1 });
  const set = (k) => (x) => setV({ ...v, [k]: x });
  const c = useMemo(() => tnPurchaseCosts({ price: v.price, guideline: v.guideline, womenOnly: v.women, legal: v.legal, brokeragePct: v.brokerage }), [v]);
  return (
    <Block id="stamp-duty" title="Stamp duty & registration (Tamil Nadu)" intro={`Sale deeds pay ${TN_RATES.stampPct}% stamp duty and ${TN_RATES.registrationPct}% registration on the higher of the agreed price and the guideline value. Women buying alone or with other women pay 1% registration on properties valued up to ₹10 lakh.`}>
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <Num id="sd-price" label="Agreed price" value={v.price} onChange={set("price")} />
        <Num id="sd-guideline" label="Guideline value" value={v.guideline} onChange={set("guideline")} hint="From the TNREGINET portal." />
        <Num id="sd-legal" label="Lawyer & document charges" value={v.legal} onChange={set("legal")} />
        <Num id="sd-brokerage" label="Brokerage" value={v.brokerage} onChange={set("brokerage")} prefix="" suffix="% of price" step="0.25" />
        <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2"><input type="checkbox" className="mt-1" checked={v.women} onChange={(e) => set("women")(e.target.checked)} data-testid="calc-sd-women" />Buyer is a woman, or only women are buying together</label>
      </div>
      <div className="panel p-5">
        <Result label="Duty is charged on" value={inr0(c.basis)} note={c.basisIsGuideline ? "The guideline value is higher than the price" : "The agreed price"} />
        <Result label={`Stamp duty (${TN_RATES.stampPct}%)`} value={inr0(c.stamp)} />
        <Result label={`Registration fee (${c.regPct}%)`} value={inr0(c.registration)} note={c.womenConcession ? "Women buyers' 1% rate applies" : v.women ? "1% rate applies only up to ₹10 lakh" : null} />
        <Result label="Lawyer & documents" value={inr0(c.legal)} />
        <Result label="Brokerage" value={inr0(c.brokerage)} />
        <Result label="Total costs on top of the price" value={inr0(c.total)} big testid="stamp-result" />
        <Result label="All-in cost" value={inr0(c.allIn)} />
        <p className="mt-3 text-xs text-slate-500">Rates change by government notification. Confirm the guideline value and fees with the sub-registrar or your lawyer before registration.</p>
      </div>
    </Block>
  );
}

function AreaCalc() {
  const [v, setV] = useState({ value: 10, unit: "cent" });
  const rows = useMemo(() => convertArea(v.value, v.unit), [v]);
  return (
    <Block id="area" title="Area converter" intro="Land in Erode and Perundurai is often quoted in cents or acres, and city plots in grounds or square feet.">
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <Num id="area-value" label="Area" value={v.value} onChange={(x) => setV({ ...v, value: x })} prefix="" compact={false} />
        <div><label className="lbl" htmlFor="area-unit">Unit</label><select id="area-unit" className="inp" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} data-testid="calc-area-unit">{AREA_UNITS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
        <p className="text-xs text-slate-500 sm:col-span-2">1 cent = 435.6 sq.ft · 1 ground = 2,400 sq.ft · 1 acre = 100 cents = 43,560 sq.ft</p>
      </div>
      <div className="panel p-5" data-testid="area-result">{rows.map((r) => <Result key={r.unit} label={r.name} value={num(r.value < 1 ? Number(r.value.toFixed(4)) : r.value)} />)}</div>
    </Block>
  );
}

function YieldCalc() {
  const [v, setV] = useState({ price: 6800000, rent: 18000, vacancy: 1, mgmt: 8, maintenance: 12000, tax: 4000 });
  const set = (k) => (x) => setV({ ...v, [k]: x });
  const y = useMemo(() => rentalYield({ price: v.price, rent: v.rent, vacancyMonths: v.vacancy, mgmtPct: v.mgmt, maintenance: v.maintenance, tax: v.tax }), [v]);
  return (
    <Block id="yield" title="Rental yield" intro="What a rented property earns each year after empty months, management fees, repairs and property tax.">
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <Num id="y-price" label="Property value" value={v.price} onChange={set("price")} />
        <Num id="y-rent" label="Monthly rent" value={v.rent} onChange={set("rent")} />
        <Num id="y-vac" label="Empty months a year" value={v.vacancy} onChange={set("vacancy")} prefix="" suffix="months" step="0.5" />
        <Num id="y-mgmt" label="Management fee" value={v.mgmt} onChange={set("mgmt")} prefix="" suffix="% of rent" step="0.5" />
        <Num id="y-maint" label="Repairs & maintenance a year" value={v.maintenance} onChange={set("maintenance")} />
        <Num id="y-tax" label="Property tax a year" value={v.tax} onChange={set("tax")} />
      </div>
      <div className="panel p-5">
        <Result label="Net yield" value={`${y.netYield}%`} big testid="yield-result" />
        <Result label="Gross yield" value={`${y.grossYield}%`} />
        <Result label="Rent collected in a year" value={inr0(y.collected)} />
        <Result label="Management fees" value={inr0(y.fees)} />
        <Result label="Net income a year" value={inr0(y.net)} note={`${inr0(y.netMonthly)} a month`} />
        <p className="mt-3 text-sm text-slate-600">Want us to find the tenant and handle rent? <Link to="/services/property-management" className="font-medium underline">Property management</Link></p>
      </div>
    </Block>
  );
}

function LeaseCalc() {
  const [v, setV] = useState({ rent: 180000, esc: 5, every: 12, years: 5, deposit: 6 });
  const set = (k) => (x) => setV({ ...v, [k]: x });
  const s = useMemo(() => leaseSchedule({ rent: v.rent, escalationPct: v.esc, everyMonths: v.every, years: v.years, depositMonths: v.deposit }), [v]);
  const max = Math.max(...s.rows.map((r) => r.monthly), 1);
  return (
    <Block id="lease" title="Commercial lease escalation" intro="Rent across a shop, warehouse or factory-shed lease with a fixed escalation. Near SIPCOT, 5% a year or 15% every three years is common.">
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <Num id="l-rent" label="Starting monthly rent" value={v.rent} onChange={set("rent")} />
        <Num id="l-esc" label="Escalation" value={v.esc} onChange={set("esc")} prefix="" suffix="%" step="0.5" />
        <div><label className="lbl" htmlFor="l-every">Every</label><select id="l-every" className="inp" value={v.every} onChange={(e) => set("every")(e.target.value)}>{[[12, "12 months"], [24, "2 years"], [36, "3 years"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <Num id="l-years" label="Lease term" value={v.years} onChange={set("years")} prefix="" suffix="years" step="1" />
        <Num id="l-dep" label="Security deposit" value={v.deposit} onChange={set("deposit")} prefix="" suffix="months' rent" step="1" />
      </div>
      <div className="panel p-5">
        <Result label="Total rent over the term" value={inr(s.total, true)} big testid="lease-result" />
        <Result label="Security deposit" value={inr0(s.deposit)} />
        <Result label="Rent in the final year" value={`${inr0(s.lastMonthly)} / month`} />
        <div className="mt-4 space-y-1.5" aria-label="Monthly rent by year">{s.rows.map((r) => <div key={r.year} className="flex items-center gap-3 text-xs"><span className="w-12 shrink-0 text-slate-500">Year {r.year}</span><div className="h-4 flex-1 bg-slate-100"><div className="h-full bg-slate-800" style={{ width: `${(r.monthly / max) * 100}%` }} /></div><span className="w-24 shrink-0 text-right tabular text-slate-700">{inr0(r.monthly)}</span></div>)}</div>
      </div>
    </Block>
  );
}

function ShortStayCalc() {
  const [v, setV] = useState({ nightly: 3200, occ: 55, stay: 2.5, cleaning: 600, platform: 15, mgmt: 20, fixed: 3000, tenant: 18000 });
  const set = (k) => (x) => setV({ ...v, [k]: x });
  const e = useMemo(() => shortStayEstimate({ nightly: v.nightly, occupancyPct: v.occ, avgStay: v.stay, cleaning: v.cleaning, platformPct: v.platform, mgmtPct: v.mgmt, fixedMonthly: v.fixed, longTermRent: v.tenant }), [v]);
  return (
    <Block id="short-stay" title="Short-stay income vs a tenant" intro="An estimate of what a furnished home earns from nightly bookings each month, after platform fees, our management fee, cleaning and running costs.">
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <Num id="s-night" label="Nightly rate" value={v.nightly} onChange={set("nightly")} />
        <Num id="s-occ" label="Nights booked" value={v.occ} onChange={set("occ")} prefix="" suffix="% of month" step="5" />
        <Num id="s-stay" label="Average stay" value={v.stay} onChange={set("stay")} prefix="" suffix="nights" step="0.5" />
        <Num id="s-clean" label="Cleaning per stay" value={v.cleaning} onChange={set("cleaning")} />
        <Num id="s-plat" label="Platform fee" value={v.platform} onChange={set("platform")} prefix="" suffix="%" step="1" />
        <Num id="s-mgmt" label="Management fee" value={v.mgmt} onChange={set("mgmt")} prefix="" suffix="%" step="1" />
        <Num id="s-fixed" label="Electricity, Wi-Fi, supplies a month" value={v.fixed} onChange={set("fixed")} />
        <Num id="s-tenant" label="Rent from a regular tenant" value={v.tenant} onChange={set("tenant")} />
      </div>
      <div className="panel p-5">
        <Result label="Owner's income per month" value={inr0(e.owner)} big testid="shortstay-result" />
        <Result label={`Room revenue (${num(e.nights)} nights)`} value={inr0(e.room)} />
        <Result label="Platform fees" value={`– ${inr0(e.platform)}`} />
        <Result label="Management fee" value={`– ${inr0(e.fee)}`} />
        <Result label={`Cleaning (${num(e.stays)} stays)`} value={`– ${inr0(e.cleaning)}`} />
        <Result label="Running costs" value={`– ${inr0(e.fixed)}`} />
        <p className={`mt-3 text-sm font-medium ${e.vsLongTerm >= 0 ? "text-emerald-800" : "text-amber-800"}`} data-testid="shortstay-compare">{e.vsLongTerm >= 0 ? `About ${inr0(e.vsLongTerm)} a month more than a regular tenant.` : `About ${inr0(-e.vsLongTerm)} a month less than a regular tenant.`}</p>
        <p className="mt-1 text-xs text-slate-500">Bookings vary by season; festival months and weekends fill first. <Link to="/services/short-stay" className="underline">Short-stay management</Link></p>
      </div>
    </Block>
  );
}

export default function Tools() {
  useMeta({ title: "Property calculators", description: "Home-loan EMI, affordability, Tamil Nadu stamp duty and registration, area conversion (cents, grounds, acres), rental yield, lease escalation and short-stay income.", path: "/tools" });
  const { hash } = useLocation();
  useEffect(() => { if (hash) { const el = document.getElementById(hash.slice(1)); if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 50); } }, [hash]);
  return (
    <div className="container-x py-10 sm:py-14">
      <p className="eyebrow">Tools</p>
      <h1 className="mt-2 max-w-3xl font-heading text-4xl font-semibold">Property calculators</h1>
      <p className="mt-4 max-w-2xl text-slate-600">Quick estimates for buyers, owners and businesses in Erode and Perundurai. Results are estimates; your bank, lawyer and the sub-registrar have the final figures.</p>
      <nav className="sticky top-16 z-20 -mx-4 mt-8 flex gap-2 overflow-x-auto border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:px-0" aria-label="Calculators">
        {SECTIONS.map(([id, l]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className="chip shrink-0" data-testid={`tools-nav-${id}`}>{l}</a>)}
      </nav>
      <EmiCalc /><AffordCalc /><StampCalc /><AreaCalc /><YieldCalc /><LeaseCalc /><ShortStayCalc />
    </div>
  );
}
