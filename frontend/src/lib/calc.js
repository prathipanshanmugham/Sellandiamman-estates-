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
