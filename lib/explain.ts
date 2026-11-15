/**
 * Explanation layer. The engine computes every number; the LLM may only rephrase.
 * `buildFacts` is the only payload sent to /api/explain (no names, no IDs).
 * `numberLint` rejects any LLM text containing a number not present in the facts.
 */
import type { TaxResult } from "./types";
import type { SpendingResult } from "./spending";
import { money, pctStr } from "./util";

export interface Facts {
  tax_year: number;
  qualifying_children: number;
  dollar_limit: number;
  eligible_care_projected: number;
  eligible_care_paid_so_far: number;
  credit_only_total: number;
  current_election: number;
  current_election_total: number;
  best_election: number;
  best_total: number;
  best_credit: number;
  best_fsa_savings: number;
  credit_rate_pct: number;
  advantage_vs_current: number;
  recommendation: string;
  marginal_rate_pct: number;
  kid_spending_ytd: number;
  kid_spending_monthly_avg: number;
  kid_spending_annualized: number;
  top_categories: { label: string; total: number }[];
  unit_price_overspend: number;
  hsa_eligible_medical: number;
  hsa_savings_estimate: number;
  top_gaps: { title: string; dollar_impact: number; rule: string }[];
}

export function buildFacts(t: TaxResult, s: SpendingResult): Facts {
  return {
    tax_year: t.taxYear,
    qualifying_children: t.qualifyingCount,
    dollar_limit: t.limit,
    eligible_care_projected: Math.round(t.eligibleProjected),
    eligible_care_paid_so_far: Math.round(t.eligibleActual),
    credit_only_total: Math.round(t.creditOnly.total),
    current_election: Math.round(t.elected.x),
    current_election_total: Math.round(t.elected.total),
    best_election: Math.round(t.best.x),
    best_total: Math.round(t.best.total),
    best_credit: Math.round(t.best.credit),
    best_fsa_savings: Math.round(t.best.fsaSavings),
    credit_rate_pct: Math.round(t.best.pct * 100),
    advantage_vs_current: Math.round(t.advantage),
    recommendation: t.recommendation,
    marginal_rate_pct: Math.round(t.marginalRate * 100),
    kid_spending_ytd: Math.round(s.total),
    kid_spending_monthly_avg: Math.round(s.monthlyAvg),
    kid_spending_annualized: Math.round(s.annualized),
    top_categories: s.byCategory.slice(0, 3).map((c) => ({ label: c.label, total: Math.round(c.total) })),
    unit_price_overspend: Math.round(s.unitOverspend),
    hsa_eligible_medical: Math.round(t.medical.hsaEligible),
    hsa_savings_estimate: Math.round(t.medical.hsaSavingsEstimate),
    top_gaps: t.gaps.slice(0, 3).map((g) => ({ title: g.title, dollar_impact: Math.round(g.dollarImpact), rule: g.rule })),
  };
}

/** Numbers that may legitimately appear in prose without coming from the engine. */
const ALWAYS_OK = new Set(["0", "1", "2", "3", "13", "2441", "1040", "503", "502", "969", "10", "31", "15", "7.65", "7.5", "100"]);

function collectNumbers(v: unknown, out: Set<string>) {
  if (typeof v === "number") {
    const r = Math.round(v);
    out.add(String(r));
    out.add(String(Math.abs(r)));
    out.add(String(v));
  } else if (typeof v === "string") {
    for (const m of v.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(m[0].replace(/,/g, ""));
  } else if (Array.isArray(v)) v.forEach((x) => collectNumbers(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => collectNumbers(x, out));
}

export function numberLint(text: string, facts: Facts): { ok: boolean; offending: string[] } {
  const allowed = new Set(ALWAYS_OK);
  collectNumbers(facts, allowed);
  for (let i = 1; i <= 11; i++) allowed.add(String(i)); // rule IDs R1..R11
  allowed.add(String(facts.tax_year + 1));
  allowed.add(String(facts.tax_year - 1));
  const offending: string[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = m[0].replace(/,/g, "").replace(/\.0+$/, "");
    if (!allowed.has(n)) offending.push(m[0]);
  }
  return { ok: offending.length === 0, offending };
}

/** Deterministic fallback explanation (also used when the LLM fails the lint). */
export function templateExplain(f: Facts): string {
  const rec =
    f.recommendation === "credit"
      ? `Take the Child and Dependent Care Credit and skip the Dependent Care FSA. The credit pays ${f.credit_rate_pct}% of up to ${money(f.dollar_limit)} of care, worth ${money(f.best_total)}.`
      : f.recommendation === "fsa"
      ? `Put ${money(f.best_election)} in your Dependent Care FSA. Pre-tax pay saves your ${f.marginal_rate_pct}% income-tax rate plus 7.65% payroll tax, worth ${money(f.best_total)}. That beats the credit alone (${money(f.credit_only_total)}).`
      : `Split: elect ${money(f.best_election)} in the Dependent Care FSA and claim the credit on the rest (base up to ${money(f.dollar_limit)}). Together: ${money(f.best_total)}.`;
  const delta =
    f.advantage_vs_current > 0
      ? ` Your current election of ${money(f.current_election)} is worth ${money(f.current_election_total)}, so changing it gains ${money(f.advantage_vs_current)} a year (R8).`
      : ` Your current election is already the best choice (R8).`;
  const spend = ` Your kids have cost ${money(f.kid_spending_ytd)} so far in ${f.tax_year}, about ${money(f.kid_spending_monthly_avg)} a month. The biggest line is ${f.top_categories[0]?.label.toLowerCase() ?? "childcare"} (${money(f.top_categories[0]?.total ?? 0)}).`;
  const unit = f.unit_price_overspend > 0 ? ` Buying the same items at your cheapest store would have saved ${money(f.unit_price_overspend)}.` : "";
  const hsa = f.hsa_savings_estimate > 0 ? ` Paying ${money(f.hsa_eligible_medical)} of kid medical from an HSA or health FSA would save about ${money(f.hsa_savings_estimate)}.` : "";
  const gap = f.top_gaps[0] ? ` First fix: ${f.top_gaps[0].title} (${f.top_gaps[0].rule}).` : "";
  return rec + delta + spend + unit + hsa + gap;
}

export { pctStr };
