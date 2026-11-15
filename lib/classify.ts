import { categories, type CategoryRule } from "./rules";
import type { Lane, RawLine } from "./types";

const compiled = new Map<number, { rule: CategoryRule; res: RegExp[] }[]>();

function table(taxYear: number) {
  let t = compiled.get(taxYear);
  if (!t) {
    t = categories(taxYear).map((rule) => ({ rule, res: rule.match.map((m) => new RegExp(m, "i")) }));
    compiled.set(taxYear, t);
  }
  return t;
}

function firstMatch(text: string, taxYear: number): CategoryRule | undefined {
  for (const { rule, res } of table(taxYear)) {
    if (res.some((r) => r.test(text))) return rule;
  }
  return undefined;
}

export interface Classification {
  category: string;
  lane: Lane;
  matchedOn: "description" | "merchant" | "hint" | "none";
}

/**
 * Deterministic classification from rules.json. Description is checked first,
 * then merchant name. An LLM category hint is used only when no rule matched,
 * and the row is flagged for user confirmation.
 */
export function classify(line: Pick<RawLine, "description" | "merchant" | "categoryHint">, taxYear = 2026): Classification {
  const byDesc = firstMatch(line.description || "", taxYear);
  if (byDesc) return { category: byDesc.id, lane: byDesc.lane, matchedOn: "description" };
  const byMerchant = firstMatch(line.merchant || "", taxYear);
  if (byMerchant) return { category: byMerchant.id, lane: byMerchant.lane, matchedOn: "merchant" };
  if (line.categoryHint) {
    const hinted = categories(taxYear).find((c) => c.id === line.categoryHint);
    if (hinted) return { category: hinted.id, lane: hinted.lane, matchedOn: "hint" };
  }
  return { category: "other", lane: "none", matchedOn: "none" };
}
