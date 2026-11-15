/** Kid-spending analytics: where the money goes, trends, unit prices, recurring buys. */
import { categoryById } from "./rules";
import type { Child, Expense, Lane } from "./types";
import { daysBetween, monthKey, normalizeName, round2, yearOf, addDays } from "./util";

export interface UnitPriceInsight {
  product: string;
  purchases: number;
  units: number;
  paid: number;
  bestMerchant: string;
  bestUnitPrice: number;
  worstMerchant: string;
  worstUnitPrice: number;
  overspend: number;
}

export interface RecurringItem {
  product: string;
  count: number;
  avgPrice: number;
  everyDays: number;
  nextExpected: string;
  monthlyRunRate: number;
}

export interface SpendingResult {
  total: number;
  count: number;
  monthsElapsed: number;
  monthlyAvg: number;
  annualized: number;
  thisMonth: number;
  thisMonthKey: string;
  budget: number;
  byGroup: { group: string; total: number; share: number }[];
  byCategory: { id: string; label: string; group: string; total: number; count: number }[];
  byMonth: { month: string; total: number; groups: Record<string, number> }[];
  byChild: { id: string; name: string; total: number }[];
  byLane: Record<Lane, number>;
  topMerchants: { merchant: string; total: number; count: number }[];
  trends: { group: string; recent: number; prior: number; change: number }[];
  unitPrices: UnitPriceInsight[];
  unitOverspend: number;
  recurring: RecurringItem[];
}

export const productKey = (desc: string) => normalizeName(desc);

export function analyzeSpending(expenses: Expense[], children: Child[], taxYear: number, asOf: string, budget: number): SpendingResult {
  const rows = expenses.filter(
    (e) => e.included && !e.projected && !e.flags.includes("duplicate") && yearOf(e.date) === taxYear && e.date <= asOf && categoryById(e.category).group !== "Not kid"
  );
  const total = round2(rows.reduce((s, e) => s + e.amount, 0));

  const byGroupM = new Map<string, number>();
  const byCatM = new Map<string, { total: number; count: number }>();
  const byMonthM = new Map<string, { total: number; groups: Record<string, number> }>();
  const byChildM = new Map<string, number>();
  const byLane: Record<Lane, number> = { care: 0, medical: 0, excluded: 0, none: 0 };
  const merchM = new Map<string, { total: number; count: number }>();

  for (const e of rows) {
    const cat = categoryById(e.category);
    byGroupM.set(cat.group, (byGroupM.get(cat.group) ?? 0) + e.amount);
    const c = byCatM.get(cat.id) ?? { total: 0, count: 0 };
    c.total += e.amount;
    c.count += 1;
    byCatM.set(cat.id, c);
    const mk = monthKey(e.date);
    const m = byMonthM.get(mk) ?? { total: 0, groups: {} };
    m.total += e.amount;
    m.groups[cat.group] = (m.groups[cat.group] ?? 0) + e.amount;
    byMonthM.set(mk, m);
    const share = e.childIds.length ? e.amount / e.childIds.length : 0;
    if (e.childIds.length) e.childIds.forEach((id) => byChildM.set(id, (byChildM.get(id) ?? 0) + share));
    else byChildM.set("shared", (byChildM.get("shared") ?? 0) + e.amount);
    byLane[e.lane] += e.amount;
    const mm = merchM.get(e.merchant) ?? { total: 0, count: 0 };
    mm.total += e.amount;
    mm.count += 1;
    merchM.set(e.merchant, mm);
  }

  // Months elapsed in the tax year up to asOf (partial month counts as fraction)
  // Count months from the first month with data (not Jan 1) so partial-year imports aren't diluted.
  const first = rows.reduce((m, e) => (e.date < m ? e.date : m), `${taxYear}-12-31`);
  const start = rows.length ? `${first.slice(0, 7)}-01` : `${taxYear}-01-01`;
  const end = asOf < `${taxYear}-12-31` ? asOf : `${taxYear}-12-31`;
  const monthsElapsed = Math.max(1, Math.min(12, (daysBetween(start, end) + 1) / (365 / 12)));
  const monthlyAvg = round2(total / monthsElapsed);
  const thisMonthKey = monthKey(end);

  const months: { month: string; total: number; groups: Record<string, number> }[] = [];
  for (let i = 1; i <= 12; i++) {
    const k = `${taxYear}-${String(i).padStart(2, "0")}`;
    if (k > thisMonthKey) break;
    const m = byMonthM.get(k) ?? { total: 0, groups: {} };
    months.push({ month: k, total: round2(m.total), groups: m.groups });
  }

  // Trends: last 3 full months vs the 3 before (by group)
  const full = months.filter((m) => m.month < thisMonthKey);
  const recent = full.slice(-3);
  const prior = full.slice(-6, -3);
  const groups = [...byGroupM.keys()];
  const trends = groups
    .map((g) => {
      const r = recent.reduce((s, m) => s + (m.groups[g] ?? 0), 0) / Math.max(1, recent.length);
      const p = prior.reduce((s, m) => s + (m.groups[g] ?? 0), 0) / Math.max(1, prior.length);
      return { group: g, recent: round2(r), prior: round2(p), change: p > 0 ? round2((r - p) / p) : 0 };
    })
    .filter((t) => t.prior > 0 && Math.abs(t.change) >= 0.1 && Math.abs(t.recent - t.prior) >= 15)
    .sort((a, b) => Math.abs(b.change * b.recent) - Math.abs(a.change * a.recent));

  // Unit prices: same product with a unit count bought at different merchants
  const prodM = new Map<string, Expense[]>();
  for (const e of rows) if (e.unitCount && e.amount > 0) prodM.set(productKey(e.description), [...(prodM.get(productKey(e.description)) ?? []), e]);
  const unitPrices: UnitPriceInsight[] = [];
  for (const [, list] of prodM) {
    const merchants = new Set(list.map((e) => e.merchant));
    if (list.length < 2 || merchants.size < 2) continue;
    const per = list.map((e) => ({ m: e.merchant, up: e.amount / e.unitCount! }));
    const best = per.reduce((a, b) => (b.up < a.up ? b : a));
    const worst = per.reduce((a, b) => (b.up > a.up ? b : a));
    const units = list.reduce((s, e) => s + e.unitCount!, 0);
    const paid = list.reduce((s, e) => s + e.amount, 0);
    unitPrices.push({
      product: list[0].description,
      purchases: list.length,
      units,
      paid: round2(paid),
      bestMerchant: best.m,
      bestUnitPrice: round2(best.up * 1000) / 1000,
      worstMerchant: worst.m,
      worstUnitPrice: round2(worst.up * 1000) / 1000,
      overspend: round2(paid - units * best.up),
    });
  }
  unitPrices.sort((a, b) => b.overspend - a.overspend);

  // Recurring purchases (non-care): same product bought 3+ times
  const recM = new Map<string, Expense[]>();
  for (const e of rows) if (e.lane !== "care" && e.amount > 0) recM.set(productKey(e.description), [...(recM.get(productKey(e.description)) ?? []), e]);
  const recurring: RecurringItem[] = [];
  for (const [, list] of recM) {
    if (list.length < 3) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const span = daysBetween(list[0].date, list[list.length - 1].date);
    const everyDays = Math.max(1, Math.round(span / (list.length - 1)));
    const avgPrice = list.reduce((s, e) => s + e.amount, 0) / list.length;
    recurring.push({
      product: list[0].description,
      count: list.length,
      avgPrice: round2(avgPrice),
      everyDays,
      nextExpected: addDays(list[list.length - 1].date, everyDays),
      monthlyRunRate: round2((avgPrice * 30.4) / everyDays),
    });
  }
  recurring.sort((a, b) => b.monthlyRunRate - a.monthlyRunRate);

  return {
    total,
    count: rows.length,
    monthsElapsed: round2(monthsElapsed),
    monthlyAvg,
    annualized: round2(monthlyAvg * 12),
    thisMonth: round2(byMonthM.get(thisMonthKey)?.total ?? 0),
    thisMonthKey,
    budget,
    byGroup: [...byGroupM.entries()].map(([group, t]) => ({ group, total: round2(t), share: total ? t / total : 0 })).sort((a, b) => b.total - a.total),
    byCategory: [...byCatM.entries()].map(([id, v]) => ({ id, label: categoryById(id).label, group: categoryById(id).group, total: round2(v.total), count: v.count })).sort((a, b) => b.total - a.total),
    byMonth: months,
    byChild: [
      ...children.map((c) => ({ id: c.id, name: c.name, total: round2(byChildM.get(c.id) ?? 0) })),
      ...(byChildM.get("shared") ? [{ id: "shared", name: "Shared / unassigned", total: round2(byChildM.get("shared")!) }] : []),
    ],
    byLane: { care: round2(byLane.care), medical: round2(byLane.medical), excluded: round2(byLane.excluded), none: round2(byLane.none) },
    topMerchants: [...merchM.entries()].map(([merchant, v]) => ({ merchant, total: round2(v.total), count: v.count })).sort((a, b) => b.total - a.total).slice(0, 6),
    trends,
    unitPrices,
    unitOverspend: round2(unitPrices.reduce((s, u) => s + u.overspend, 0)),
    recurring,
  };
}
