/**
 * BabyTab tax engine — Pub 503 tests R1–R11, Dependent Care FSA vs credit optimizer,
 * Pub 502 / HSA lane, gap detector and audit trail. Pure functions, no I/O.
 */
import { getRules, categoryById } from "./rules";
import { creditPct, marginalRate, taxOnAgi } from "./tax";
import type {
  AuditEntry, Check, Child, Expense, Gap, Household, LedgerRow, Provider, Scenario, Status, TaxResult,
} from "./types";
import { addDays, birthdayAt, daysBetween, money, parseISO, pctStr, round2, yearOf } from "./util";

export interface EngineInput {
  household: Household;
  children: Child[];
  providers: Provider[];
  expenses: Expense[]; // includes projected rows (flag `projected`)
  asOf: string;
}

const worst = (checks: Check[]): Status =>
  checks.some((c) => c.status === "FAIL") ? "FAIL" : checks.some((c) => c.status === "WARN") ? "WARN" : "PASS";

/** Fraction of the service period during which the child was under 13 (R1, pro-rata). */
export function under13Fraction(child: Child, from: string, to: string, ageLimit = 13): number {
  const bday = birthdayAt(child.birthDate, ageLimit);
  const total = daysBetween(from, to) + 1;
  if (total <= 0) return parseISO(from) < parseISO(bday) ? 1 : 0;
  if (parseISO(to) < parseISO(bday)) return 1;
  if (parseISO(from) >= parseISO(bday)) return 0;
  return Math.max(0, daysBetween(from, bday)) / total;
}

export function earnedIncomeMin(h: Household): number {
  return h.filingStatus === "mfj" ? Math.min(h.earnedYou, h.earnedSpouse) : h.earnedYou;
}

export function evaluateLine(e: Expense, inp: EngineInput): LedgerRow {
  const { household: h, children, providers } = inp;
  const R = getRules(h.taxYear);
  const ty = h.taxYear;
  const checks: Check[] = [];
  const cat = categoryById(e.category, ty);
  let fraction = 1;

  // R11 timing
  if (yearOf(e.date) !== ty) {
    checks.push({ rule: "R11", status: "FAIL", note: `Paid in ${yearOf(e.date)}; counts for that tax year, not ${ty}.` });
  } else if (e.serviceTo && yearOf(e.serviceTo) < ty) {
    checks.push({ rule: "R11", status: "WARN", note: `Care provided in ${yearOf(e.serviceTo)} but paid in ${ty}: excluded here; may increase the ${yearOf(e.serviceTo)} credit (Pub 503 Worksheet A).` });
    fraction = 0;
  } else if (e.serviceFrom && yearOf(e.serviceFrom) > ty) {
    checks.push({ rule: "R11", status: "FAIL", note: `Prepaid for ${yearOf(e.serviceFrom)} care: counts in the year care is provided.` });
  } else {
    checks.push({ rule: "R11", status: "PASS", note: `Paid and provided in ${ty}.` });
  }

  // R3 work-related
  if (e.lane === "excluded") {
    checks.push({ rule: "R3", status: "FAIL", note: cat.reason ?? "Not a work-related care expense." });
  } else {
    checks.push({ rule: "R3", status: "PASS", note: `${cat.label}: qualifying type of care.` });
  }

  // R1 qualifying person
  const kids = children.filter((c) => e.childIds.includes(c.id));
  if (!kids.length) {
    checks.push({ rule: "R1", status: "WARN", note: "No child assigned to this payment." });
  } else {
    const from = e.serviceFrom ?? e.date;
    const to = e.serviceTo ?? e.date;
    const fr = kids.map((k) => under13Fraction(k, from, to, R.credit.qualifying_age_under));
    const f = fr.reduce((a, b) => a + b, 0) / fr.length;
    if (f >= 1) checks.push({ rule: "R1", status: "PASS", note: `${kids.map((k) => k.name.split(" ")[0]).join(", ")} under 13 during care.` });
    else if (f <= 0) checks.push({ rule: "R1", status: "FAIL", note: "Child was 13 or older during this care." });
    else checks.push({ rule: "R1", status: "WARN", note: `Child turned 13 during the period: ${Math.round(f * 100)}% of the period counts.` });
    fraction = Math.min(fraction, f);
  }

  // R2 earned income, R5 joint return
  if (h.earnedYou <= 0 || (h.filingStatus === "mfj" && h.earnedSpouse <= 0)) {
    checks.push({ rule: "R2", status: "FAIL", note: "Both spouses need earned income (unless a student or disabled)." });
  } else checks.push({ rule: "R2", status: "PASS", note: "Earned income present." });
  if (h.filingStatus === "mfs") {
    checks.push({ rule: "R5", status: "FAIL", note: "Married filing separately generally cannot claim the credit." });
  }

  // R4 payee, R6 provider ID
  const p = providers.find((x) => x.id === e.providerId);
  if (p) {
    if (p.type === "spouse" || p.type === "other_parent") {
      checks.push({ rule: "R4", status: "FAIL", note: "Payments to your spouse or the child's other parent don't count." });
    } else if (p.type === "relative") {
      checks.push({ rule: "R4", status: "WARN", note: "Relatives count only if not your dependent and not your child under 19." });
    } else checks.push({ rule: "R4", status: "PASS", note: "Payee is not a spouse, parent or dependent." });
    if (e.lane === "care") {
      if (p.tinStatus === "have" || p.tinStatus === "tax_exempt") {
        checks.push({ rule: "R6", status: "PASS", note: p.tinStatus === "tax_exempt" ? "Tax-exempt provider: name and address only." : "Provider TIN on file." });
      } else {
        checks.push({ rule: "R6", status: "WARN", note: "No provider TIN. Request Form W-10; if refused, keep a due-diligence statement." });
      }
    }
  }
  if (e.flags.includes("weak_evidence")) {
    checks.push({ rule: "R6", status: "WARN", note: "Cash without a receipt: get a signed receipt from the provider." });
  }

  const status = worst(checks);
  const eligibleAmount = e.lane === "care" && status !== "FAIL" ? round2((e.amount - e.reimbursed) * fraction) : 0;
  return { expense: e, status, checks, eligibleAmount };
}

export function scenario(x: number, E: number, L: number, h: Household, label = ""): Scenario {
  const R = getRules(h.taxYear);
  const eiMin = earnedIncomeMin(h);
  const xEff = Math.max(0, Math.min(x, eiMin));
  const agi2 = Math.max(0, h.agi - xEff);
  const fsaSavings = taxOnAgi(h.agi, h.filingStatus, h.taxYear) - taxOnAgi(agi2, h.filingStatus, h.taxYear) + R.dcfsa.fica_rate * xEff;
  const forfeit = Math.max(0, x - E);
  const base = Math.max(0, Math.min(E - x, L - x, eiMin));
  const pct = creditPct(agi2, h.filingStatus, h.taxYear);
  const credit = Math.min(pct * base, taxOnAgi(agi2, h.filingStatus, h.taxYear));
  return {
    label,
    x,
    fsaSavings: round2(fsaSavings),
    credit: round2(credit),
    forfeit: round2(forfeit),
    total: round2(fsaSavings + credit - forfeit),
    pct,
    base: round2(base),
  };
}

export function computeTax(inp: EngineInput): TaxResult {
  const { household: h, children, providers, asOf } = inp;
  const R = getRules(h.taxYear);
  const ty = h.taxYear;
  const included = inp.expenses.filter((e) => e.included && !e.flags.includes("duplicate"));
  const careish = included.filter((e) => e.lane === "care" || (e.lane === "excluded" && ["Childcare", "Education", "Activities", "Food"].includes(categoryById(e.category).group)));
  const ledger = careish.map((e) => evaluateLine(e, inp));

  const actualRows = ledger.filter((r) => !r.expense.projected);
  const eligibleActual = round2(actualRows.reduce((s, r) => s + r.eligibleAmount, 0));
  const eligibleProjected = round2(ledger.reduce((s, r) => s + r.eligibleAmount, 0));

  const qualifyingIds = new Set<string>();
  for (const r of ledger) if (r.eligibleAmount > 0) r.expense.childIds.forEach((id) => qualifyingIds.add(id));
  const qualifyingCount = qualifyingIds.size;
  const L = qualifyingCount >= 2 ? R.credit.expense_limit_two_plus : qualifyingCount === 1 ? R.credit.expense_limit_one : 0;

  const statCap = R.dcfsa.limit[h.filingStatus];
  const xMax = h.dcfsaAvailable ? Math.min(statCap, h.dcfsaPlanCap || statCap) : 0;
  const E = eligibleProjected;
  const step = R.dcfsa.grid_step;
  const curve: Scenario[] = [];
  for (let x = 0; x <= xMax + 0.001; x += step) curve.push(scenario(x, E, L, h));
  const creditOnly = scenario(0, E, L, h, "Credit only");
  const electedX = Math.min(h.dcfsaAvailable ? h.dcfsaElected : 0, statCap);
  const elected = scenario(electedX, E, L, h, "Your election");
  let best = curve.reduce((a, b) => (b.total > a.total + 0.004 ? b : a), creditOnly);
  best = { ...best, label: "Best" };
  const recommendation = best.x === 0 ? "credit" : best.base > 0 ? "split" : "fsa";
  const advantage = round2(best.total - elected.total);

  // Medical lane (Pub 502 / HSA-FSA)
  const med = included.filter((e) => e.lane === "medical" && !e.projected && yearOf(e.date) === ty);
  const hsaEligible = round2(med.reduce((s, e) => s + e.amount, 0));
  const pub502Includible = round2(med.filter((e) => categoryById(e.category).pub502).reduce((s, e) => s + e.amount, 0));
  const floor = round2(R.medical.agi_floor * h.agi);
  const mRate = marginalRate(h.agi, h.filingStatus, ty);
  const hsaSavingsEstimate = h.hasHsaOrHealthFsa ? round2(hsaEligible * (mRate + R.dcfsa.fica_rate)) : 0;

  const gaps = detectGaps({ inp, ledger, E, L, best, elected, creditOnly, hsaEligible, hsaSavingsEstimate, pub502Includible, floor, xMax });

  const audit: AuditEntry[] = ledger.map((r) => ({
    rule_id: r.checks.map((c) => `${c.rule}:${c.status}`).join(" "),
    pub_section: r.checks.map((c) => (R.checks as Record<string, { pub: string }>)[c.rule]?.pub).filter(Boolean).join("; "),
    tax_year: ty,
    inputs: { date: r.expense.date, payee: r.expense.merchant, amount: r.expense.amount, service: [r.expense.serviceFrom, r.expense.serviceTo], projected: !!r.expense.projected },
    decision: r.eligibleAmount > 0 ? `eligible ${money(r.eligibleAmount, true)}` : "not counted",
    source_hash: r.expense.sourceHash,
    user_confirmed_at: r.expense.confirmedAt,
  }));
  audit.push({
    rule_id: "R7 R8 R9 R10",
    pub_section: "Pub 503 Dollar Limit / Reduced Dollar Limit / Earned Income Limit; IRC §21(a)(2)",
    tax_year: ty,
    inputs: { E, L, x: best.x, earned_income_min: earnedIncomeMin(h), agi: h.agi },
    decision: `best: DCFSA ${money(best.x)} + credit base ${money(best.base)} at ${pctStr(best.pct)} = ${money(best.total)}`,
  });

  return {
    taxYear: ty,
    qualifyingCount,
    limit: L,
    eligibleActual,
    eligibleProjected,
    reimbursed: Math.min(electedX, E),
    xMax,
    curve,
    creditOnly,
    elected,
    best,
    recommendation,
    advantage,
    marginalRate: mRate,
    taxBeforeCredits: round2(taxOnAgi(h.agi, h.filingStatus, ty)),
    ledger,
    medical: { hsaEligible, pub502Includible, floor, itemizeHelps: pub502Includible > floor, hsaSavingsEstimate },
    gaps,
    audit,
    assumptions: [
      "Federal only. State income tax and state credits are not included.",
      `Standard deduction assumed (${money(getRules(ty).income_tax.standard_deduction[h.filingStatus])}).`,
      "DCFSA saves federal income tax plus 7.65% FICA (wages below the Social Security wage base).",
      "The dependent care credit is applied before other nonrefundable credits.",
      "Unused DCFSA money is forfeited (no grace period or carryover assumed).",
      `Projected payments repeat each provider's recent pattern to Dec 31, ${ty}.`,
      `${ty} rules: ${R.status_note}`,
    ],
  };
}

interface GapCtx {
  inp: EngineInput;
  ledger: LedgerRow[];
  E: number;
  L: number;
  best: Scenario;
  elected: Scenario;
  creditOnly: Scenario;
  hsaEligible: number;
  hsaSavingsEstimate: number;
  pub502Includible: number;
  floor: number;
  xMax: number;
}

function detectGaps(c: GapCtx): Gap[] {
  const { inp, ledger, E, L, best, elected } = c;
  const { household: h, children, providers, asOf } = inp;
  const ty = h.taxYear;
  const gaps: Gap[] = [];

  // R6 provider TIN
  for (const p of providers) {
    if (p.tinStatus === "have" || p.tinStatus === "tax_exempt") continue;
    const rows = ledger.filter((r) => r.expense.providerId === p.id && r.eligibleAmount > 0);
    const amt = rows.reduce((s, r) => s + r.eligibleAmount, 0);
    if (amt <= 0) continue;
    const atRisk = E > 0 ? round2((Math.min(amt, E) / E) * best.total) : 0;
    gaps.push({
      id: `tin_${p.id}`,
      severity: "high",
      title: `Get ${p.name}'s taxpayer ID (Form W-10)`,
      detail: `${money(amt)} of care paid to ${p.name} has no TIN on file. Form 2441 and DCFSA claims need the provider's name, address and SSN/EIN. Ask them to fill out Form W-10; if they refuse, keep a due-diligence note.`,
      dollarImpact: atRisk,
      rule: "R6",
      due: `${ty + 1}-01-31`,
    });
  }

  // R8 election optimization (next open enrollment)
  if (h.dcfsaAvailable && Math.abs(best.x - elected.x) >= 1 && best.total - elected.total >= 1) {
    gaps.push({
      id: "election",
      severity: "high",
      title: best.x > elected.x ? `Raise your Dependent Care FSA election to ${money(best.x)}` : best.x === 0 ? `Skip the Dependent Care FSA, take the credit` : `Lower your Dependent Care FSA election to ${money(best.x)}`,
      detail: `With your numbers, a ${money(best.x)} election is worth ${money(best.total)} versus ${money(elected.total)} at your current ${money(elected.x)}. Use this at open enrollment for ${ty + 1} (assumes similar care costs and income).`,
      dollarImpact: round2(best.total - elected.total),
      rule: "R8",
      due: `${ty}-11-30`,
    });
  }

  // Forfeiture risk
  if (h.dcfsaAvailable && elected.x > E) {
    gaps.push({
      id: "forfeit",
      severity: "high",
      title: "You may forfeit Dependent Care FSA money",
      detail: `Your election (${money(elected.x)}) is higher than the eligible care you are on track to pay (${money(E)}).`,
      dollarImpact: round2(elected.x - E),
      rule: "R8",
      due: `${ty}-12-31`,
    });
  }

  // R11 December payment timing
  const decRows = ledger.filter((r) => r.expense.projected && r.eligibleAmount > 0 && r.expense.date >= `${ty}-12-01`);
  const decAmt = decRows.reduce((s, r) => s + r.eligibleAmount, 0);
  if (decAmt > 0 && asOf <= `${ty}-12-31`) {
    const without = scenario(best.x, E - decAmt, L, h).total;
    const impact = round2(best.total - without);
    gaps.push({
      id: "dec31",
      severity: impact > 0 ? "high" : "low",
      title: `Pay December care by Dec 31`,
      detail: impact > 0
        ? `${money(decAmt)} of December care must be paid by Dec 31, ${ty} to count this year.`
        : `${money(decAmt)} of December care is expected. You are already past the dollar limits, so paying in January costs you nothing this year.`,
      dollarImpact: impact,
      rule: "R11",
      due: `${ty}-12-31`,
    });
  }

  // Prior-year care paid this year (Worksheet A)
  const prior = ledger.filter((r) => r.checks.some((k) => k.rule === "R11" && k.status === "WARN"));
  if (prior.length) {
    const amt = prior.reduce((s, r) => s + r.expense.amount, 0);
    gaps.push({
      id: "prior_year",
      severity: "low",
      title: `${money(amt)} paid in ${ty} was for ${ty - 1} care`,
      detail: `It is excluded from ${ty}. If you did not reach the ${ty - 1} limit, Pub 503 Worksheet A can add it to your ${ty} credit for ${ty - 1} expenses.`,
      dollarImpact: 0,
      rule: "R11",
    });
  }

  // Excluded childcare-like spending
  const excl = ledger.filter((r) => r.expense.lane === "excluded");
  if (excl.length) {
    const amt = excl.reduce((s, r) => s + r.expense.amount, 0);
    const labels = [...new Set(excl.map((r) => categoryById(r.expense.category).label.toLowerCase()))];
    gaps.push({
      id: "excluded",
      severity: "low",
      title: `${money(amt)} of care-like spending doesn't qualify`,
      detail: `Not counted: ${labels.join(", ")}. Don't put these on your FSA claim or Form 2441.`,
      dollarImpact: 0,
      rule: "R3",
    });
  }

  // Weak evidence
  const weak = ledger.filter((r) => r.expense.flags.includes("weak_evidence") && r.eligibleAmount > 0);
  if (weak.length) {
    gaps.push({
      id: "weak",
      severity: "medium",
      title: `Get receipts for ${money(weak.reduce((s, r) => s + r.expense.amount, 0))} paid in cash`,
      detail: "Cash payments need a receipt with the provider's name, date and amount.",
      dollarImpact: 0,
      rule: "R6",
    });
  }

  // HSA / FSA reimbursement
  if (c.hsaEligible > 0) {
    gaps.push({
      id: "hsa",
      severity: h.hasHsaOrHealthFsa ? "medium" : "low",
      title: h.hasHsaOrHealthFsa ? `Reimburse ${money(c.hsaEligible)} of kid medical from your HSA / health FSA` : `${money(c.hsaEligible)} of kid medical is HSA/FSA-eligible`,
      detail: h.hasHsaOrHealthFsa
        ? "Copays, prescriptions, OTC medicine, first aid and lactation supplies can be paid with pre-tax HSA/FSA money. Keep the receipts."
        : "If your employer offers an HSA or health FSA, these items could be paid pre-tax next year.",
      dollarImpact: c.hsaSavingsEstimate,
      rule: "M1",
    });
  }
  if (c.pub502Includible > 0 && c.pub502Includible <= c.floor) {
    gaps.push({
      id: "pub502",
      severity: "low",
      title: "Itemizing kid medical costs won't lower your tax",
      detail: `Deductible medical costs (${money(c.pub502Includible)}) are below 7.5% of AGI (${money(c.floor)}). Diapers, formula and clothing never qualify.`,
      dollarImpact: 0,
      rule: "M2",
    });
  }

  // Life events: 13th birthday, kindergarten
  for (const k of children) {
    const b13 = birthdayAt(k.birthDate, 13);
    if (b13 > asOf && b13 <= addDays(asOf, 400)) {
      gaps.push({ id: `b13_${k.id}`, severity: "medium", title: `${k.name.split(" ")[0]} turns 13 on ${b13}`, detail: "Care after the 13th birthday stops counting for the credit and the DCFSA.", dollarImpact: 0, rule: "R1", due: b13 });
    }
    const kYear = Number(k.birthDate.slice(0, 4)) + (k.birthDate.slice(5) <= "09-01" ? 5 : 6);
    const kStart = `${kYear}-08-15`;
    if (kStart > asOf && kStart <= addDays(asOf, 400)) {
      gaps.push({ id: `k_${k.id}`, severity: "medium", title: `${k.name.split(" ")[0]} may start kindergarten in ${kYear}`, detail: "Kindergarten tuition won't count. Before- and after-school care and day camps still do.", dollarImpact: 0, rule: "R3", due: kStart });
    }
  }

  const sev = { high: 0, medium: 1, low: 2 };
  return gaps.sort((a, b) => b.dollarImpact - a.dollarImpact || sev[a.severity] - sev[b.severity]);
}
