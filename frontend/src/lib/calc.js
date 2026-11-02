// Property calculators. Plain functions (no React) so they are easy to test and reuse.
// Rates that change by government notification are inputs with today's values as defaults.

const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

// ---------- Home-loan EMI ----------
export function emi(principal, annualRatePct, months) {
  const P = Number(principal) || 0;
  const n = Math.max(1, Math.round(Number(months) || 0));
  const r = (Number(annualRatePct) || 0) / 1200;
  if (P <= 0) return 0;
  if (r === 0) return P / n;
  const f = (1 + r) ** n;
  return (P * r * f) / (f - 1);
}

export function amortization(principal, annualRatePct, months) {
  const P = Number(principal) || 0;
  const n = Math.max(1, Math.round(Number(months) || 0));
  const r = (Number(annualRatePct) || 0) / 1200;
  const e = emi(P, annualRatePct, n);
  let bal = P;
  const years = [];
  let yr = { year: 1, principal: 0, interest: 0, balance: P };
  for (let m = 1; m <= n; m++) {
    const int = bal * r;
    const prin = Math.min(bal, e - int);
    bal = Math.max(0, bal - prin);
    yr.principal += prin;
    yr.interest += int;
    if (m % 12 === 0 || m === n) {
      yr.balance = bal;
      years.push({ year: yr.year, principal: r2(yr.principal), interest: r2(yr.interest), balance: r2(yr.balance) });
      yr = { year: yr.year + 1, principal: 0, interest: 0, balance: bal };
    }
  }
  const totalPaid = e * n;
  return { emi: r2(e), totalInterest: r2(totalPaid - P), totalPaid: r2(totalPaid), years };
}

// Loan amount a given EMI can service.
export function loanForEmi(monthlyEmi, annualRatePct, months) {
  const E = Number(monthlyEmi) || 0;
  const n = Math.max(1, Math.round(Number(months) || 0));
  const r = (Number(annualRatePct) || 0) / 1200;
  if (E <= 0) return 0;
  if (r === 0) return E * n;
  return (E * ((1 + r) ** n - 1)) / (r * (1 + r) ** n);
}

// RBI loan-to-value caps for housing loans.
export const ltvFor = (price) => (price <= 30e5 ? 0.9 : price <= 75e5 ? 0.8 : 0.75);

// How much property a household can buy: banks usually cap all EMIs at 40–60% of net monthly income (FOIR),
// lend at most the LTV share of the price, and do not finance stamp duty and registration.
export function affordability({ income, existingEmi = 0, ratePct, years, foirPct = 50, savings = 0, feesPct = 9 }) {
  const maxEmi = Math.max(0, (Number(income) || 0) * (Number(foirPct) || 0) / 100 - (Number(existingEmi) || 0));
  const maxLoan = loanForEmi(maxEmi, ratePct, (Number(years) || 0) * 12);
  const S = Math.max(0, Number(savings) || 0);
  const f = (Number(feesPct) || 0) / 100;
  let price = (maxLoan + S) / (1 + f);
  for (let i = 0; i < 4; i++) {
    const ltv = ltvFor(price);
    if (maxLoan > ltv * price) price = S / (1 + f - ltv);
  }
  price = Math.max(0, price);
  const loan = Math.min(maxLoan, ltvFor(price) * price);
  return { maxEmi: r2(maxEmi), maxLoan: r2(maxLoan), price: Math.floor(price / 1000) * 1000, loan: r2(loan),
    downPayment: r2(Math.max(0, price - loan)), fees: r2(price * f), emi: r2(emi(loan, ratePct, (Number(years) || 0) * 12)),
    limitedBy: maxLoan > ltvFor(price) * price + 1 ? "savings" : "income" };
}

// ---------- Tamil Nadu stamp duty & registration (sale deed) ----------
// Duty is charged on the higher of the agreed price and the guideline value.
// Women buying alone or with other women pay 1% registration (not 2%) when the value is up to ₹10 lakh (from 1 April 2025).
export const TN_RATES = { stampPct: 7, registrationPct: 2, womenRegistrationPct: 1, womenCap: 10e5 };

export function tnPurchaseCosts({ price, guideline = 0, womenOnly = false, stampPct = TN_RATES.stampPct, registrationPct = TN_RATES.registrationPct, legal = 0, brokeragePct = 0 }) {
  const P = Number(price) || 0;
  const basis = Math.max(P, Number(guideline) || 0);
  const womenConcession = womenOnly && basis <= TN_RATES.womenCap;
  const regPct = womenConcession ? TN_RATES.womenRegistrationPct : Number(registrationPct);
  const stamp = (basis * Number(stampPct)) / 100;
  const registration = (basis * regPct) / 100;
  const brokerage = (P * (Number(brokeragePct) || 0)) / 100;
  const total = stamp + registration + (Number(legal) || 0) + brokerage;
  return { basis, stamp: r2(stamp), registration: r2(registration), regPct, womenConcession, brokerage: r2(brokerage),
    legal: r2(legal), total: r2(total), allIn: r2(P + total), basisIsGuideline: basis > P };
}

// ---------- Area units (sq.ft per unit) ----------
export const AREA_UNITS = [
  ["sqft", "Square feet", 1], ["sqm", "Square metres", 10.7639104], ["sqyd", "Square yards", 9],
  ["cent", "Cents", 435.6], ["ground", "Grounds", 2400], ["acre", "Acres", 43560], ["hectare", "Hectares", 107639.104],
];
export function convertArea(value, from) {
  const v = Number(value) || 0;
  const base = AREA_UNITS.find((u) => u[0] === from)?.[2] || 1;
  const sqft = v * base;
  return AREA_UNITS.map(([k, name, f]) => ({ unit: k, name, value: sqft / f }));
}

// ---------- Rental yield for an owner or investor ----------
export function rentalYield({ price, rent, vacancyMonths = 1, mgmtPct = 0, maintenance = 0, tax = 0 }) {
  const P = Number(price) || 0;
  const R = Number(rent) || 0;
  const months = Math.max(0, 12 - (Number(vacancyMonths) || 0));
  const grossAnnual = R * 12;
  const collected = R * months;
  const fees = (collected * (Number(mgmtPct) || 0)) / 100;
  const net = collected - fees - (Number(maintenance) || 0) - (Number(tax) || 0);
  return { grossAnnual: r2(grossAnnual), collected: r2(collected), fees: r2(fees), net: r2(net), netMonthly: r2(net / 12),
    grossYield: P ? r2((grossAnnual / P) * 100) : 0, netYield: P ? r2((net / P) * 100) : 0 };
}

// ---------- Commercial / industrial lease with escalation ----------
export function leaseSchedule({ rent, escalationPct = 5, everyMonths = 12, years = 3, depositMonths = 6 }) {
  const R = Number(rent) || 0;
  const n = Math.max(1, Math.round((Number(years) || 0) * 12));
  const every = Math.max(0, Math.round(Number(everyMonths) || 0));
  const rows = [];
  let total = 0;
  for (let y = 0; y * 12 < n; y++) {
    let yearTotal = 0;
    let first = 0;
    for (let m = y * 12; m < Math.min(n, y * 12 + 12); m++) {
      const steps = every ? Math.floor(m / every) : 0;
      const amt = R * (1 + (Number(escalationPct) || 0) / 100) ** steps;
      if (m === y * 12) first = amt;
      yearTotal += amt;
    }
    total += yearTotal;
    rows.push({ year: y + 1, monthly: r2(first), annual: r2(yearTotal) });
  }
  return { rows, total: r2(total), deposit: r2(R * (Number(depositMonths) || 0)), lastMonthly: rows.length ? rows[rows.length - 1].monthly : 0 };
}

// ---------- Short-stay income estimate for an owner ----------
export function shortStayEstimate({ nightly, occupancyPct = 55, avgStay = 2, cleaning = 600, platformPct = 15, mgmtPct = 20, fixedMonthly = 3000, longTermRent = 0 }) {
  const nights = 30 * (Number(occupancyPct) || 0) / 100;
  const stays = avgStay > 0 ? nights / Number(avgStay) : 0;
  const room = nights * (Number(nightly) || 0);
  const platform = (room * (Number(platformPct) || 0)) / 100;
  const net = room - platform;
  const fee = (net * (Number(mgmtPct) || 0)) / 100;
  const cleaningCost = stays * (Number(cleaning) || 0);
  const owner = net - fee - cleaningCost - (Number(fixedMonthly) || 0);
  return { nights: r2(nights), stays: r2(stays), room: r2(room), platform: r2(platform), fee: r2(fee), cleaning: r2(cleaningCost),
    fixed: r2(fixedMonthly), owner: r2(owner), vsLongTerm: r2(owner - (Number(longTermRent) || 0)) };
}

// ---------- XIRR: yearly return on dated cash flows (money out negative, money in positive) ----------
export function xirr(flows) {
  const f = (flows || []).filter((x) => x.date && Number(x.amount)).map((x) => ({ t: Date.parse(`${x.date}T00:00:00Z`), a: Number(x.amount) })).sort((a, b) => a.t - b.t);
  if (f.length < 2 || !f.some((x) => x.a < 0) || !f.some((x) => x.a > 0)) return null;
  const t0 = f[0].t;
  const npv = (r) => f.reduce((s, x) => s + x.a / (1 + r) ** ((x.t - t0) / (365 * 864e5)), 0);
  let lo = -0.9999, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; if (hi - lo < 1e-9) break; }
  return r2(((lo + hi) / 2) * 100);
}

// ---------- Capital gains on selling land or a building (individuals / HUF, resident) ----------
// Long term after 24 months. From 23 July 2024: 12.5% without indexation. For property bought before 23 July 2024,
// resident individuals and HUFs may instead pay 20% with indexation, whichever is lower. Cost Inflation Index (CII)
// base year 2001-02 = 100; properties bought earlier use the fair market value on 1 April 2001.
export const CII = { 2001: 100, 2002: 105, 2003: 109, 2004: 113, 2005: 117, 2006: 122, 2007: 129, 2008: 137, 2009: 148, 2010: 167, 2011: 184, 2012: 200, 2013: 220, 2014: 240, 2015: 254, 2016: 264, 2017: 272, 2018: 280, 2019: 289, 2020: 301, 2021: 317, 2022: 331, 2023: 348, 2024: 363, 2025: 376 };
export const fyOf = (date) => { const d = new Date(`${date}T00:00:00Z`); const y = d.getUTCFullYear(); return d.getUTCMonth() < 3 ? y - 1 : y; }; // 2025 = FY 2025-26
export function capitalGains({ buyDate, sellDate, cost, improvement = 0, improvementDate = "", sale, expenses = 0, saleCii = null, cessPct = 4, slabRatePct = 30 }) {
  const C = Number(cost) || 0, I = Number(improvement) || 0, S = Number(sale) || 0, E = Number(expenses) || 0;
  if (!buyDate || !sellDate || sellDate <= buyDate) return null;
  const months = (Date.parse(sellDate) - Date.parse(buyDate)) / (864e5 * 30.4375);
  const longTerm = months > 24;
  const net = S - E;
  const plain = net - C - I;
  const out = { months: Math.floor(months), longTerm, net: r2(net), gainPlain: r2(plain) };
  if (!longTerm) return { ...out, rate: Number(slabRatePct), tax: r2(Math.max(0, plain) * Number(slabRatePct) / 100 * (1 + cessPct / 100)), basis: "short" };
  const tax125 = Math.max(0, plain) * 0.125 * (1 + cessPct / 100);
  const res = { ...out, tax125: r2(tax125), tax: r2(tax125), basis: "12.5% without indexation" };
  if (buyDate < "2024-07-23" && sellDate >= "2024-07-23") {
    const by = Math.max(2001, fyOf(buyDate)), sy = fyOf(sellDate);
    const ciiSale = Number(saleCii) || CII[sy] || CII[2025];
    const ciiBuy = CII[by] || 100;
    const ciiImp = improvementDate ? CII[Math.max(2001, fyOf(improvementDate))] || ciiBuy : ciiBuy;
    const idxCost = (C * ciiSale) / ciiBuy + (I * ciiSale) / ciiImp;
    const gainIdx = net - idxCost;
    const tax20 = Math.max(0, gainIdx) * 0.2 * (1 + cessPct / 100);
    Object.assign(res, { ciiBuy, ciiSale, indexedCost: r2(idxCost), gainIndexed: r2(gainIdx), tax20: r2(tax20) });
    if (tax20 < tax125) Object.assign(res, { tax: r2(tax20), basis: "20% with indexation" });
  }
  return res;
}

// ---------- TDS on property payments (Income-tax Act, 2025 section 393; earlier 194-IA, 194-IB, 194-I, 194H) ----------
export function propertyTds({ kind, amount, months = 1, rateOverride }) {
  const A = Number(amount) || 0;
  if (kind === "sale") { const due = A >= 50e5; const rate = rateOverride ?? 1; return { due, rate, tds: due ? r2((A * rate) / 100) : 0, note: due ? "Buyer deducts 1% of the whole price (or the stamp-duty value if higher) and files Form 26QB within 30 days of the month end." : "No TDS when the price is under ₹50 lakh." }; }
  if (kind === "rent_individual") { const due = A > 50000; const rate = rateOverride ?? 2; const total = A * (Number(months) || 1); return { due, rate, tds: due ? r2((total * rate) / 100) : 0, note: due ? "Tenants (individuals/HUF not under audit) paying over ₹50,000 a month deduct 2%, once a year or at the end of the tenancy (Form 26QC)." : "No TDS at ₹50,000 a month or less." }; }
  if (kind === "rent_business") { const due = A > 50000; const rate = rateOverride ?? 10; return { due, rate, tds: due ? r2((A * rate) / 100) : 0, note: due ? "Businesses deduct 10% on rent for land, buildings and furniture above ₹50,000 a month." : "No TDS at ₹50,000 a month or less." }; }
  if (kind === "commission") { const due = A > 20000; const rate = rateOverride ?? 2; return { due, rate, tds: due ? r2((A * rate) / 100) : 0, note: due ? "Businesses paying commission or brokerage above ₹20,000 in a year deduct 2%." : "No TDS at ₹20,000 a year or less." }; }
  return null;
}

// ---------- Brokerage with GST and co-broker split ----------
export function commissionCalc({ basis = "percent", value, pct = 2, months = 1, gstPct = 18, coBrokerPct = 0, tdsPct = 2, payerDeductsTds = true }) {
  const V = Number(value) || 0;
  const commission = basis === "percent" ? (V * (Number(pct) || 0)) / 100 : basis === "months" ? V * (Number(months) || 0) : V;
  const gst = (commission * (Number(gstPct) || 0)) / 100;
  const tds = payerDeductsTds && commission > 20000 ? (commission * (Number(tdsPct) || 0)) / 100 : 0;
  const coBroker = (commission * (Number(coBrokerPct) || 0)) / 100;
  return { commission: r2(commission), gst: r2(gst), invoice: r2(commission + gst), tds: r2(tds), received: r2(commission + gst - tds), coBroker: r2(coBroker), ours: r2(commission - coBroker) };
}

// ---------- Rent or buy ----------
export function rentVsBuy({ price, downPct = 20, ratePct = 8.5, years = 20, horizon = 10, rent, rentGrowthPct = 5, growthPct = 5, investPct = 7, feesPct = 9, upkeepPct = 0.5 }) {
  const P = Number(price) || 0, H = Math.max(1, Math.round(Number(horizon) || 1));
  const loan = P * (1 - (Number(downPct) || 0) / 100);
  const n = Math.max(1, Math.round((Number(years) || 1) * 12));
  const e = emi(loan, ratePct, n);
  const r = (Number(ratePct) || 0) / 1200;
  let bal = loan, rentM = Number(rent) || 0, renterPot = P - loan + (P * (Number(feesPct) || 0)) / 100, buyerCash = 0;
  const im = (Number(investPct) || 0) / 1200;
  for (let m = 1; m <= H * 12; m++) {
    if (m <= n) { bal = Math.max(0, bal - (e - bal * r)); }
    const buyerMonthly = (m <= n ? e : 0) + (P * (Number(upkeepPct) || 0)) / 1200;
    renterPot = renterPot * (1 + im) + Math.max(0, buyerMonthly - rentM);
    buyerCash = buyerCash * (1 + im) + Math.max(0, rentM - buyerMonthly);
    if (m % 12 === 0) rentM *= 1 + (Number(rentGrowthPct) || 0) / 100;
  }
  const value = P * (1 + (Number(growthPct) || 0) / 100) ** H;
  const buyer = value - bal + buyerCash, renter = renterPot;
  return { emi: r2(e), loan: r2(loan), value: r2(value), balance: r2(bal), buyer: r2(buyer), renter: r2(renter), better: buyer >= renter ? "buy" : "rent", gap: r2(Math.abs(buyer - renter)) };
}
