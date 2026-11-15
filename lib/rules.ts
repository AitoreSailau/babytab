import rules2026 from "@/rules/rules.2026.json";
import type { FilingStatus, Lane } from "./types";

export interface CategoryRule {
  id: string;
  label: string;
  group: string;
  lane: Lane;
  rule?: string;
  reason?: string;
  pub502?: boolean;
  match: string[];
}

export type RuleTable = typeof rules2026;

const TABLES: Record<number, RuleTable> = { 2026: rules2026 };

export function getRules(taxYear: number): RuleTable {
  const t = TABLES[taxYear];
  if (!t) throw new Error(`No rule table for tax year ${taxYear}`);
  return t;
}

export const SUPPORTED_YEARS = Object.keys(TABLES).map(Number);

export function categories(taxYear = 2026): CategoryRule[] {
  return getRules(taxYear).categories as CategoryRule[];
}

export function categoryById(id: string, taxYear = 2026): CategoryRule {
  return categories(taxYear).find((c) => c.id === id) ?? categories(taxYear).find((c) => c.id === "other")!;
}

export function fs(status: FilingStatus): "single" | "mfj" | "hoh" | "mfs" {
  return status;
}
