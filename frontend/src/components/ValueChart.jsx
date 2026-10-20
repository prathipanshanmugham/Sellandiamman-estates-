import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr } from "../lib/api";

const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

// Investor holdings over time: value, money put in and payouts received (month ends).
export function ValueChart({ series, height = 240 }) {
  if (!series?.length) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series.map((s) => ({ ...s, m: monthLabel(s.month) }))}>
        <CartesianGrid stroke="#f1f5f9" /><XAxis dataKey="m" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => inr(v, true)} width={72} />
        <Tooltip formatter={(v) => inr(v)} /><Legend />
        <Area type="monotone" dataKey="value" name="Value of holdings" stroke="#0f172a" fill="#0f172a" fillOpacity={0.12} />
        <Area type="monotone" dataKey="invested" name="Money invested" stroke="#94a3b8" fill="none" strokeDasharray="4 3" />
        <Area type="monotone" dataKey="distributions" name="Payouts received (to date)" stroke="#16a34a" fill="#16a34a" fillOpacity={0.08} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

