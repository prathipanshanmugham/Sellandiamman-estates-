import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { inr, inr0, num, todayIST } from "../../lib/api";
import { amortization, affordability, tnPurchaseCosts, AREA_UNITS, convertArea, rentalYield, leaseSchedule, shortStayEstimate, TN_RATES, xirr, capitalGains, CII, fyOf, propertyTds, commissionCalc, rentVsBuy } from "../../lib/calc";
import { PageHeader } from "../../components/erp/kit";

const SECTIONS = [["emi", "Loan EMI"], ["afford", "Affordability"], ["stamp-duty", "Stamp duty"], ["commission", "Brokerage & GST"], ["tds", "TDS"], ["capital-gains", "Capital gains"], ["xirr", "Investment return"], ["rent-vs-buy", "Rent or buy"], ["area", "Area converter"], ["yield", "Rental yield"], ["lease", "Lease escalation"], ["short-stay", "Short-stay income"]];

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
    <Block id="area" title="Area converter" intro="Land in the Kongu belt is often quoted in cents or acres, and town plots in grounds or square feet.">
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
        <p className="mt-3 text-sm text-slate-600">Page to share with the owner: <Link to="/services/property-management" className="font-medium underline">Property management</Link></p>
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
        <p className="mt-1 text-xs text-slate-500">Bookings vary by season; festival months and weekends fill first. Page to share with the owner: <Link to="/services/short-stay" className="underline">Short-stay management</Link></p>
      </div>
    </Block>
  );
}

function CommissionCalc() {
  const [v, setV] = useState({ basis: "percent", value: 7000000, pct: 2, months: 1, gstPct: 18, coBrokerPct: 0, tdsPct: 2, payerDeductsTds: true });
  const set = (k) => (x) => setV({ ...v, [k]: x });
  const c = commissionCalc(v);
  return (
    <Block id="commission" title="Brokerage, GST and co-broker split" intro="What to invoice for a deal, the GST on it, the TDS a business client deducts, and what is left after sharing with a co-broker.">
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <div><label className="lbl" htmlFor="cm-basis">Charged as</label><select id="cm-basis" className="inp" value={v.basis} onChange={(e) => set("basis")(e.target.value)}><option value="percent">% of the price</option><option value="months">Months of rent</option><option value="fixed">Fixed amount</option></select></div>
        <Num id="cm-value" label={v.basis === "months" ? "Monthly rent" : v.basis === "fixed" ? "Brokerage amount" : "Deal value"} value={v.value} onChange={set("value")} />
        {v.basis === "percent" && <Num id="cm-pct" label="Brokerage" value={v.pct} onChange={set("pct")} prefix="" suffix="%" step="0.25" />}
        {v.basis === "months" && <Num id="cm-months" label="Months of rent" value={v.months} onChange={set("months")} prefix="" suffix="months" step="0.5" />}
        <Num id="cm-gst" label="GST on brokerage" value={v.gstPct} onChange={set("gstPct")} prefix="" suffix="%" hint="18% for real-estate agent services when registered" />
        <Num id="cm-co" label="Co-broker share" value={v.coBrokerPct} onChange={set("coBrokerPct")} prefix="" suffix="%" />
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={v.payerDeductsTds} onChange={(e) => set("payerDeductsTds")(e.target.checked)} />Client is a business that deducts TDS on commission ({v.tdsPct}%)</label>
      </div>
      <div className="panel p-5">
        <Result label="Brokerage" value={inr0(c.commission)} big testid="commission-result" />
        <Result label={`GST (${v.gstPct}%)`} value={inr0(c.gst)} />
        <Result label="Invoice total" value={inr0(c.invoice)} />
        {c.tds > 0 && <Result label="TDS the client deducts" value={`– ${inr0(c.tds)}`} note="Claim it back against our income tax (shows in Form 26AS)" />}
        <Result label="Received in the bank" value={inr0(c.received)} />
        {c.coBroker > 0 && <Result label="Co-broker's share (before GST)" value={`– ${inr0(c.coBroker)}`} />}
        <Result label="Our brokerage after the split" value={inr0(c.ours)} />
      </div>
    </Block>
  );
}

function TdsCalc() {
  const [v, setV] = useState({ kind: "sale", amount: 6000000, months: 12 });
  const set = (k) => (x) => setV({ ...v, [k]: x });
  const t = propertyTds(v);
  return (
    <Block id="tds" title="TDS on property payments" intro="Tax the payer deducts and deposits for the payee. Section 393 of the Income-tax Act, 2025 (earlier sections 194-IA, 194-IB, 194-I and 194H). Check the current rates with your accountant.">
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="lbl" htmlFor="tds-kind">Payment</label><select id="tds-kind" className="inp" value={v.kind} onChange={(e) => set("kind")(e.target.value)}><option value="sale">Buying a property (paid to the seller)</option><option value="rent_individual">Rent paid by an individual / family</option><option value="rent_business">Rent paid by a business</option><option value="commission">Brokerage / commission paid by a business (for the year)</option></select></div>
        <Num id="tds-amount" label={v.kind === "sale" ? "Sale price" : v.kind === "commission" ? "Commission in the year" : "Monthly rent"} value={v.amount} onChange={set("amount")} />
        {v.kind === "rent_individual" && <Num id="tds-months" label="Months of rent" value={v.months} onChange={set("months")} prefix="" suffix="months" step="1" />}
      </div>
      <div className="panel p-5">
        <Result label={t.due ? `TDS at ${t.rate}%` : "TDS"} value={inr0(t.tds)} big testid="tds-result" />
        <p className="mt-2 text-sm text-slate-600">{t.note}</p>
        {v.kind === "sale" && t.due && <p className="mt-2 text-xs text-slate-500">An NRI seller is taxed differently: the buyer deducts TDS on the capital gain at the NRI rates and needs a TAN. Ask a CA.</p>}
      </div>
    </Block>
  );
}

function CapitalGainsCalc() {
  const [v, setV] = useState({ buyDate: "2015-06-01", sellDate: todayIST(), cost: 2000000, improvement: 0, improvementDate: "", sale: 6000000, expenses: 60000, saleCii: CII[fyOf(todayIST())] || CII[2025], slabRatePct: 30 });
  const set = (k) => (x) => setV({ ...v, [k]: x });
  const g = capitalGains(v);
  const fy = fyOf(v.sellDate || todayIST());
  return (
    <Block id="capital-gains" title="Capital gains on selling land or a building" intro="For resident individuals and HUFs. Held over 24 months it is long-term: 12.5% without indexation, or, for property bought before 23 July 2024, 20% with indexation if that is lower. Plus 4% cess (surcharge not included).">
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <div><label className="lbl" htmlFor="cg-buy">Bought on</label><input id="cg-buy" type="date" className="inp" value={v.buyDate} onChange={(e) => set("buyDate")(e.target.value)} /></div>
        <div><label className="lbl" htmlFor="cg-sell">Sold on</label><input id="cg-sell" type="date" className="inp" value={v.sellDate} onChange={(e) => set("sellDate")(e.target.value)} /></div>
        <Num id="cg-cost" label="Purchase cost (incl. stamp duty)" value={v.cost} onChange={set("cost")} hint={v.buyDate < "2001-04-01" ? "Bought before April 2001: use the fair market value on 1 April 2001" : undefined} />
        <Num id="cg-sale" label="Sale price" value={v.sale} onChange={set("sale")} hint="Or the guideline value if higher" />
        <Num id="cg-exp" label="Selling expenses (brokerage, legal)" value={v.expenses} onChange={set("expenses")} />
        <Num id="cg-imp" label="Improvements (construction, additions)" value={v.improvement} onChange={set("improvement")} />
        <Num id="cg-cii" label={`Cost Inflation Index for FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`} value={v.saleCii} onChange={set("saleCii")} prefix="" hint={CII[fy] ? "Notified value" : "Not in our table yet: enter the notified figure"} />
        {g && !g.longTerm && <Num id="cg-slab" label="Your income-tax slab rate" value={v.slabRatePct} onChange={set("slabRatePct")} prefix="" suffix="%" />}
      </div>
      <div className="panel p-5">
        {!g ? <p className="text-sm text-slate-500">Enter the dates (sold after bought).</p> : <>
          <Result label={g.longTerm ? `Long-term (${g.months} months) · ${g.basis}` : `Short-term (${g.months} months), taxed at your slab`} value={inr0(g.tax)} big testid="cg-result" />
          <Result label="Gain without indexation" value={inr0(g.gainPlain)} />
          {g.longTerm && <Result label="Tax at 12.5% + cess" value={inr0(g.tax125)} />}
          {g.tax20 != null && <><Result label={`Indexed cost (CII ${g.ciiBuy} → ${g.ciiSale})`} value={inr0(g.indexedCost)} /><Result label="Gain with indexation" value={inr0(g.gainIndexed)} /><Result label="Tax at 20% + cess" value={inr0(g.tax20)} /></>}
          <p className="mt-3 text-xs text-slate-500">Long-term gains can be saved by buying another house (up to ₹10 crore) or capital-gains bonds (up to ₹50 lakh within 6 months). Confirm with a chartered accountant.</p>
        </>}
      </div>
    </Block>
  );
}

function XirrCalc() {
  const t = todayIST();
  const [rows, setRows] = useState([{ date: `${Number(t.slice(0, 4)) - 3}${t.slice(4)}`, amount: -2500000 }, { date: `${Number(t.slice(0, 4)) - 2}${t.slice(4)}`, amount: 200000 }, { date: `${Number(t.slice(0, 4)) - 1}${t.slice(4)}`, amount: 210000 }, { date: t, amount: 3100000 }]);
  const r = xirr(rows);
  const put = rows.filter((x) => x.amount < 0).reduce((a, x) => a - Number(x.amount), 0), got = rows.filter((x) => x.amount > 0).reduce((a, x) => a + Number(x.amount), 0);
  return (
    <Block id="xirr" title="Investment return (XIRR)" intro="The yearly return on money that goes in and comes out at different dates: purchase, rent received, repairs and the sale. Enter money paid out as a minus.">
      <div className="space-y-2">
        {rows.map((x, i) => <div key={i} className="flex gap-2"><input type="date" className="inp" value={x.date} onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, date: e.target.value } : y)))} aria-label={`Date ${i + 1}`} /><input type="number" className="inp tabular" value={x.amount} onChange={(e) => setRows(rows.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} aria-label={`Amount ${i + 1}`} data-testid={`xirr-amount-${i}`} /><button className="p-2 text-slate-400 hover:text-red-700" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove row"><Trash2 size={14} /></button></div>)}
        <button className="btn-line btn-sm" onClick={() => setRows([...rows, { date: t, amount: 0 }])}><Plus size={13} />Add a cash flow</button>
      </div>
      <div className="panel p-5">
        <Result label="Yearly return (XIRR)" value={r == null ? "Needs money out and money in" : `${r}%`} big testid="xirr-result" />
        <Result label="Money put in" value={inr0(put)} />
        <Result label="Money received" value={inr0(got)} />
        <Result label="Profit" value={inr0(got - put)} />
        <p className="mt-3 text-xs text-slate-500">Compare with a fixed deposit (about 6.5–7.5%) and remember property returns are not guaranteed.</p>
      </div>
    </Block>
  );
}

function RentVsBuyCalc() {
  const [v, setV] = useState({ price: 6000000, downPct: 20, ratePct: 8.5, years: 20, horizon: 10, rent: 15000, rentGrowthPct: 5, growthPct: 5, investPct: 7, feesPct: 9 });
  const set = (k) => (x) => setV({ ...v, [k]: x });
  const r = rentVsBuy(v);
  return (
    <Block id="rent-vs-buy" title="Rent or buy?" intro="Compares owning (home value minus the loan still owed) with renting and investing the down payment, purchase costs and any monthly saving, over the years you expect to stay.">
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <Num id="rb-price" label="Home price" value={v.price} onChange={set("price")} />
        <Num id="rb-rent" label="Rent for a similar home" value={v.rent} onChange={set("rent")} hint="per month" />
        <Num id="rb-down" label="Down payment" value={v.downPct} onChange={set("downPct")} prefix="" suffix="%" />
        <Num id="rb-rate" label="Loan interest" value={v.ratePct} onChange={set("ratePct")} prefix="" suffix="%" step="0.05" />
        <Num id="rb-horizon" label="Years you will stay" value={v.horizon} onChange={set("horizon")} prefix="" suffix="years" step="1" />
        <Num id="rb-growth" label="Home value growth" value={v.growthPct} onChange={set("growthPct")} prefix="" suffix="% a year" />
        <Num id="rb-rg" label="Rent increase" value={v.rentGrowthPct} onChange={set("rentGrowthPct")} prefix="" suffix="% a year" />
        <Num id="rb-inv" label="Return on savings" value={v.investPct} onChange={set("investPct")} prefix="" suffix="% a year" />
      </div>
      <div className="panel p-5">
        <Result label={r.better === "buy" ? "Buying comes out ahead by" : "Renting comes out ahead by"} value={inr0(r.gap)} big testid="rvb-result" />
        <Result label={`Buyer's wealth after ${v.horizon} years`} value={inr0(r.buyer)} note={`Home worth ${inr(r.value, true)}, loan left ${inr(r.balance, true)}`} />
        <Result label="Renter's investments" value={inr0(r.renter)} />
        <Result label="EMI" value={inr0(r.emi)} note={`on a loan of ${inr(r.loan, true)}`} />
        <p className="mt-3 text-xs text-slate-500">Includes about {v.feesPct}% stamp duty and registration and 0.5% a year upkeep. Tax benefits on home loans are not included.</p>
      </div>
    </Block>
  );
}

export default function Tools() {
  const { hash } = useLocation();
  useEffect(() => { if (hash) { const el = document.getElementById(hash.slice(1)); if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 50); } }, [hash]);
  return (
    <div data-testid="tools-page">
      <PageHeader title="Tools & calculators" sub="For staff talking to buyers, owners, tenants and investors. Results are estimates: banks, lawyers, chartered accountants and the sub-registrar have the final figures." />
      <nav className="sticky top-14 z-20 -mx-4 flex gap-2 overflow-x-auto border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" aria-label="Calculators">
        {SECTIONS.map(([id, l]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className="chip shrink-0" data-testid={`tools-nav-${id}`}>{l}</a>)}
      </nav>
      <EmiCalc /><AffordCalc /><StampCalc /><CommissionCalc /><TdsCalc /><CapitalGainsCalc /><XirrCalc /><RentVsBuyCalc /><AreaCalc /><YieldCalc /><LeaseCalc /><ShortStayCalc />
    </div>
  );
}
