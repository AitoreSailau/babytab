/**
 * Who paid? Deterministic rules, in this order:
 *  1. a parent's name printed on the document (cardholder / account holder / "paid by")
 *  2. the card's last 4 digits listed under a parent in Profile
 *  3. the payment method listed under a parent (venmo, zelle, checking, cash, check)
 *  4. the fallback (the parent using this device when a receipt is scanned or typed in)
 * The AI only reads the card digits and the printed name; it never decides the payer.
 */
import type { Expense, Parent, RawLine } from "./types";

const METHOD_ALIASES: Record<string, string> = { checking: "ach", bank: "ach", ach: "ach", zelle: "zelle", venmo: "venmo", cash: "cash", check: "check", cheque: "check", manual: "manual" };
const norm = (s: string) => s.toLowerCase().trim();
const first = (s: string) => norm(s).split(/\s+/)[0] ?? "";

export function parsePays(text: string): string[] {
  return text.split(/[,;\s]+/).map((t) => norm(t).replace(/[^a-z0-9]/g, "")).filter(Boolean);
}

export function resolvePayer(line: Pick<RawLine, "cardLast4" | "payerHint" | "payMethod">, parents: Parent[], fallback?: string): string | undefined {
  if (!parents.length) return undefined;
  if (line.payerHint) {
    const h = first(line.payerHint);
    const byName = parents.find((p) => p.name.trim() && first(p.name) === h);
    if (byName) return byName.id;
  }
  if (line.cardLast4) {
    const byCard = parents.find((p) => p.pays.includes(line.cardLast4!));
    if (byCard) return byCard.id;
  }
  if (line.payMethod) {
    const m = METHOD_ALIASES[norm(line.payMethod)] ?? norm(line.payMethod);
    const byMethod = parents.filter((p) => p.pays.some((t) => (METHOD_ALIASES[t] ?? t) === m));
    if (byMethod.length === 1) return byMethod[0].id;
  }
  return fallback && parents.some((p) => p.id === fallback) ? fallback : undefined;
}

/** Fill payerId on every expense the user hasn't set by hand. */
export function assignPayers(expenses: Expense[], parents: Parent[], fallback?: string): Expense[] {
  return expenses.map((e) => {
    if (e.flags.includes("payer_manual")) return parents.some((p) => p.id === e.payerId) ? e : { ...e, payerId: undefined, flags: e.flags.filter((f) => f !== "payer_manual") };
    const keep = e.flags.includes("payer_device") ? e.payerId : undefined; // set from the device owner at scan time
    const payerId = resolvePayer(e, parents, keep ?? fallback);
    return payerId === e.payerId ? e : { ...e, payerId };
  });
}

export interface PayerShare {
  id: string;
  name: string;
  role: "mom" | "dad" | "none";
  total: number;
  share: number;
  thisMonth: number;
  count: number;
  top: { label: string; total: number }[];
}

export function spendingByPayer(expenses: Expense[], parents: Parent[], taxYear: number, monthKey: string, labelOf: (categoryId: string) => string): PayerShare[] {
  const rows = new Map<string, PayerShare & { cats: Map<string, number> }>();
  const mk = (id: string, name: string, role: PayerShare["role"]) => ({ id, name, role, total: 0, share: 0, thisMonth: 0, count: 0, top: [], cats: new Map<string, number>() });
  for (const p of parents) rows.set(p.id, mk(p.id, p.name || (p.role === "mom" ? "Mom" : "Dad"), p.role));
  rows.set("", mk("", "Not assigned", "none"));
  let all = 0;
  for (const e of expenses) {
    if (!e.included || e.projected || !e.date.startsWith(String(taxYear))) continue;
    const r = rows.get(e.payerId && rows.has(e.payerId) ? e.payerId : "")!;
    r.total += e.amount;
    r.count++;
    if (e.date.startsWith(monthKey)) r.thisMonth += e.amount;
    r.cats.set(e.category, (r.cats.get(e.category) ?? 0) + e.amount);
    all += e.amount;
  }
  return [...rows.values()]
    .filter((r) => r.id !== "" || r.count > 0)
    .map(({ cats, ...r }) => ({
      ...r,
      share: all > 0 ? r.total / all : 0,
      top: [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, total]) => ({ label: labelOf(id), total })),
    }));
}
