import { getRules } from "./rules";
import type { FilingStatus } from "./types";

/** Federal income tax (ordinary rates) on taxable income. Rev. Proc. 2025-32 tables. */
export function incomeTax(taxable: number, status: FilingStatus, taxYear: number): number {
  const brackets = getRules(taxYear).income_tax.brackets[status] as number[][];
  if (taxable <= 0) return 0;
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [start, rate] = brackets[i];
    const end = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    if (taxable <= start) break;
    tax += (Math.min(taxable, end) - start) * rate;
  }
  return tax;
}

export function standardDeduction(status: FilingStatus, taxYear: number): number {
  return getRules(taxYear).income_tax.standard_deduction[status];
}

/** Tax before credits for a given AGI, assuming the standard deduction. */
export function taxOnAgi(agi: number, status: FilingStatus, taxYear: number): number {
  return incomeTax(Math.max(0, agi - standardDeduction(status, taxYear)), status, taxYear);
}

export function marginalRate(agi: number, status: FilingStatus, taxYear: number): number {
  const taxable = Math.max(0, agi - standardDeduction(status, taxYear));
  const brackets = getRules(taxYear).income_tax.brackets[status] as number[][];
  let rate = 0;
  for (const [start, r] of brackets) if (taxable > start) rate = r;
  return taxable > 0 ? rate : 0;
}

/**
 * Applicable percentage, IRC §21(a)(2) as amended for TY2026:
 * 50%, reduced 1 point per $2,000 (or fraction) of AGI over $15,000, not below 35%;
 * then reduced 1 point per $2,000 ($4,000 MFJ) (or fraction) over $75,000 ($150,000 MFJ), not below 20%.
 */
export function creditPct(agi: number, status: FilingStatus, taxYear: number): number {
  const c = getRules(taxYear).credit;
  let pts = Math.round(c.rate_max * 100);
  const floor1 = Math.round(c.phase1_floor * 100);
  const floor2 = Math.round(c.phase2_floor * 100);
  if (agi > c.phase1_start_agi) {
    const steps = Math.ceil((agi - c.phase1_start_agi) / c.phase1_step);
    pts = Math.max(floor1, pts - steps);
  }
  const start2 = c.phase2_start_agi[status];
  const step2 = c.phase2_step[status];
  if (agi > start2) {
    const steps = Math.ceil((agi - start2) / step2);
    pts = Math.max(floor2, pts - steps);
  }
  return pts / 100;
}
