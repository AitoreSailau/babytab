import { computeTax } from "./engine";
import { projectRecurring, timeline } from "./project";
import { analyzeSpending } from "./spending";
import type { Child, Expense, Household, Parent, Provider } from "./types";

export interface AppData {
  household: Household;
  children: Child[];
  parents?: Parent[];
  providers: Provider[];
  expenses: Expense[];
  asOf: string;
}

export function runAll(d: AppData) {
  const projected = projectRecurring(d.expenses, d.household.taxYear, d.asOf);
  // Simulated time: projected payments dated on/before asOf are treated as paid.
  const withProjection = [...d.expenses, ...projected];
  const tax = computeTax({ household: d.household, children: d.children, providers: d.providers, expenses: withProjection, asOf: d.asOf });
  const simulatedPaid = projected.filter((p) => p.date <= d.asOf).map((p) => ({ ...p, projected: false, flags: [...p.flags, "simulated"] }));
  const spending = analyzeSpending([...d.expenses, ...simulatedPaid], d.children, d.household.taxYear, d.asOf, d.household.monthlyBudget);
  const events = timeline(d.household, d.children, d.asOf);
  const incurredToDate = tax.ledger
    .filter((r) => !r.expense.projected || r.expense.date <= d.asOf)
    .reduce((s, r) => s + r.eligibleAmount, 0);
  return { tax, spending, events, projected, incurredToDate };
}

export type Computed = ReturnType<typeof runAll>;
