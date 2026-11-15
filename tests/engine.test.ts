import { describe, expect, it } from "vitest";
import { creditPct, incomeTax, taxOnAgi } from "@/lib/tax";
import { scenario, under13Fraction } from "@/lib/engine";
import { runAll } from "@/lib/pipeline";
import { classify } from "@/lib/classify";
import { numberLint, templateExplain, buildFacts } from "@/lib/explain";
import { extractRegex, redact } from "@/lib/parse";
import type { Household } from "@/lib/types";
import { readSample, sampleData } from "./helpers";

const H: Household = {
  taxYear: 2026, filingStatus: "mfj", agi: 120000, earnedYou: 68000, earnedSpouse: 52000,
  dcfsaElected: 5000, dcfsaPlanCap: 7500, dcfsaAvailable: true, hasHsaOrHealthFsa: true, monthlyBudget: 1900,
};

describe("tax tables (Rev. Proc. 2025-32)", () => {
  it("MFJ tax at $100,800 taxable is $11,600", () => expect(incomeTax(100800, "mfj", 2026)).toBeCloseTo(11600, 2));
  it("single tax at $50,400 taxable is $5,800", () => expect(incomeTax(50400, "single", 2026)).toBeCloseTo(5800, 2));
  it("HoH tax at $67,450 taxable is $7,740", () => expect(incomeTax(67450, "hoh", 2026)).toBeCloseTo(7740, 2));
  it("standard deduction applied", () => expect(taxOnAgi(32200, "mfj", 2026)).toBe(0));
});

describe("R10 applicable percentage TY2026 (IRC §21 as amended)", () => {
  it("50% at AGI $15,000", () => expect(creditPct(15000, "mfj", 2026)).toBe(0.5));
  it("49% just above $15,000 (or fraction thereof)", () => expect(creditPct(15001, "single", 2026)).toBe(0.49));
  it("35% plateau from $43,001", () => {
    expect(creditPct(43000, "single", 2026)).toBe(0.36);
    expect(creditPct(43001, "single", 2026)).toBe(0.35);
    expect(creditPct(75000, "single", 2026)).toBe(0.35);
  });
  it("single second phase-down: 20% above $103,000", () => {
    expect(creditPct(103000, "single", 2026)).toBe(0.21);
    expect(creditPct(103001, "single", 2026)).toBe(0.2);
  });
  it("MFJ: 35% at $150,000, 20% above $206,000 ($4,000 steps)", () => {
    expect(creditPct(150000, "mfj", 2026)).toBe(0.35);
    expect(creditPct(154000, "mfj", 2026)).toBe(0.34);
    expect(creditPct(206001, "mfj", 2026)).toBe(0.2);
  });
});

describe("R7–R10 credit vs DCFSA (spec example)", () => {
  it("one child: DCFSA $7,500 beats credit-only $1,050", () => {
    const c = scenario(0, 13200, 3000, H);
    const f = scenario(7500, 13200, 3000, H);
    expect(c.total).toBeCloseTo(1050, 0);
    expect(f.total).toBeCloseTo(1473.75, 1);
    expect(f.credit).toBe(0);
  });
  it("two children: credit-only $2,100 beats DCFSA $7,500", () => {
    const c = scenario(0, 13200, 6000, H);
    const f = scenario(7500, 13200, 6000, H);
    expect(c.total).toBeCloseTo(2100, 0);
    expect(f.total).toBeLessThan(c.total);
  });
  it("forfeits unused election", () => {
    const s = scenario(5000, 3000, 3000, H);
    expect(s.forfeit).toBe(2000);
  });
  it("earned income limit caps the base (R9)", () => {
    const s = scenario(0, 13200, 6000, { ...H, earnedSpouse: 2000 });
    expect(s.base).toBe(2000);
  });
});

describe("R1 under-13 pro-rata", () => {
  it("full when under 13", () => expect(under13Fraction({ id: "a", name: "A", birthDate: "2020-01-01" }, "2026-01-01", "2026-01-31")).toBe(1));
  it("partial when 13th birthday falls inside the period", () => {
    const f = under13Fraction({ id: "a", name: "A", birthDate: "2013-06-16" }, "2026-06-01", "2026-06-30");
    expect(f).toBeCloseTo(0.5, 1);
  });
});

describe("classification rules", () => {
  const cat = (d: string, m = "") => classify({ description: d, merchant: m }).category;
  it("kindergarten tuition is not care", () => expect(cat("Kindergarten tuition - fall semester", "St. Mark's Academy")).toBe("not_care_kindergarten"));
  it("overnight camp is not care", () => expect(cat("Overnight camp session - 1 week")).toBe("not_care_overnight"));
  it("day camp is care", () => expect(cat("Summer day camp - week 1")).toBe("care_daycamp"));
  it("date-night sitter is not care", () => expect(cat("date night sitter")).toBe("not_care_datenight"));
  it("diapers are not tax-advantaged", () => expect(classify({ description: "Pampers Easy Ups 3T-4T 112 ct", merchant: "Target" }).lane).toBe("none"));
  it("OTC children's medicine is HSA/FSA-eligible", () => expect(classify({ description: "Children's Tylenol Oral Suspension", merchant: "Target" }).lane).toBe("medical"));
  it("merchant name decides when description is vague", () => expect(cat("Credit - closure week refund", "Little Oaks Early Learning Center")).toBe("care_center"));
  it("adult household items are not kid spending", () => expect(cat("Paper Towels 6 roll")).toBe("not_kid"));
});

describe("regex extraction", () => {
  it("parses the provider statement with service periods and refund", () => {
    const rows = extractRegex([readSample("little_oaks_statement.txt")], [{ id: "c", name: "Mia Rivera", birthDate: "2023-04-12" }]);
    const dec = rows.find((r) => r.description.includes("Dec 2025"))!;
    expect(dec.date).toBe("2026-01-06");
    expect(dec.serviceTo).toBe("2025-12-31");
    expect(rows.find((r) => r.amount < 0)!.amount).toBe(-120);
    const mixed = rows.filter((r) => r.date === "2026-09-03");
    expect(mixed.map((r) => r.amount).sort((a, b) => a - b)).toEqual([45, 65, 1050]);
    expect(rows.every((r) => r.tinPresent)).toBe(true);
  });
  it("parses Zelle/Venmo with payee, memo and flipped sign", () => {
    const rows = extractRegex([readSample("zelle_venmo_history.txt")], []);
    expect(rows[0]).toMatchObject({ merchant: "Rosa Martinez", amount: 300, payMethod: "zelle" });
    expect(rows.find((r) => r.merchant.startsWith("Emma"))!.description).toBe("date night sitter");
  });
  it("parses store receipts, skips totals and tax, captures unit counts", () => {
    const rows = extractRegex([readSample("store_receipts.txt")], []);
    expect(rows.some((r) => /total|tax/i.test(r.description))).toBe(false);
    const p = rows.filter((r) => r.description.startsWith("Pampers"));
    expect(p.length).toBe(10);
    expect(p[0].unitCount).toBe(112);
    expect(rows.find((r) => r.merchant === "Costco Wholesale")).toBeTruthy();
  });
  it("redacts identifiers before LLM", () => {
    expect(redact("EIN: 99-2938471 card 4111 1111 1111 1111 mail a@b.com")).not.toMatch(/2938471|4111|a@b/);
  });
});

describe("full sample pipeline", () => {
  it("one child (Mia): recommends DCFSA $7,500 and flags seeded edge cases", () => {
    const d = sampleData(false);
    const { tax, spending } = runAll(d);
    expect(tax.qualifyingCount).toBe(1);
    expect(tax.best.x).toBe(7500);
    expect(tax.recommendation).toBe("fsa");
    expect(tax.best.total).toBeCloseTo(1473.75, 1);
    expect(tax.advantage).toBeGreaterThan(400);
    const ids = tax.gaps.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(["election", "excluded", "prior_year", "weak", "hsa", "pub502"]));
    expect(tax.gaps.some((g) => g.id.startsWith("tin_"))).toBe(true);
    // duplicate Oct ACH payment excluded
    expect(d.expenses.filter((e) => e.flags.includes("duplicate")).length).toBe(1);
    // kid spending excludes paper towels and coffee
    expect(spending.byCategory.some((c) => c.id === "not_kid")).toBe(false);
    expect(spending.unitOverspend).toBeGreaterThan(0);
    expect(spending.recurring.length).toBeGreaterThan(0);
  });

  it("two children (Mia + Leo): recommendation flips to the credit", () => {
    const { tax } = runAll(sampleData(true));
    expect(tax.qualifyingCount).toBe(2);
    expect(tax.best.x).toBe(0);
    expect(tax.recommendation).toBe("credit");
    expect(tax.best.total).toBeCloseTo(2100, 0);
    const k = tax.ledger.find((r) => r.expense.category === "not_care_kindergarten")!;
    expect(k.status).toBe("FAIL");
  });

  it("template explanation passes the number-lint", () => {
    const { tax, spending } = runAll(sampleData(false));
    const f = buildFacts(tax, spending);
    const txt = templateExplain(f);
    expect(numberLint(txt, f).ok).toBe(true);
    expect(numberLint("You will save $9,999 this year.", f).ok).toBe(false);
  });

  it("time simulator: fast-forward to Jan marks deadlines done", () => {
    const d = sampleData(false);
    const r = runAll({ ...d, asOf: "2027-01-20" });
    expect(r.events.find((e) => e.id === "oe")!.status).toBe("done");
    expect(r.events.find((e) => e.id === "w10")!.status).toBe("due");
  });
});

describe("projection survives fast-forward", () => {
  it("projected December care is still counted when the clock is moved to January", () => {
    const d = sampleData(false);
    const now = runAll(d);
    const later = runAll({ ...d, asOf: "2027-01-31" });
    expect(later.tax.eligibleProjected).toBe(now.tax.eligibleProjected);
    expect(now.tax.eligibleProjected).toBeGreaterThan(now.tax.eligibleActual);
  });
});
