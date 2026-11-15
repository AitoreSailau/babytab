import { classify } from "./classify";
import { categoryById } from "./rules";
import type { Child, Expense, Provider, ProviderType, RawLine } from "./types";
import { daysBetween, normalizeName, uid } from "./util";

export function providerKey(merchant: string): string {
  return normalizeName(merchant)
    .replace(/^(zelle|venmo|cash|paypal)( to)? /, "")
    .split(" ")
    .slice(0, 2)
    .join(" ");
}

const TYPE_BY_CATEGORY: Record<string, ProviderType> = {
  care_center: "center",
  care_registration: "center",
  care_nanny: "nanny",
  care_afterschool: "after_school",
  care_daycamp: "day_camp",
  not_care_overnight: "overnight",
  not_care_kindergarten: "school",
  not_care_tutoring: "school",
  not_care_datenight: "nanny",
};

/** Raw extracted lines → classified expenses (deterministic rules). */
export function toExpenses(raw: RawLine[], children: Child[], taxYear: number): Expense[] {
  return raw.map((r) => {
    const c = classify(r, taxYear);
    const child = r.childName
      ? children.find((k) => normalizeName(k.name) === normalizeName(r.childName!) || normalizeName(k.name).startsWith(normalizeName(r.childName!).split(" ")[0]))
      : undefined;
    const childIds = child ? [child.id] : children.length === 1 ? [children[0].id] : [];
    const flags: string[] = [];
    if (c.matchedOn === "hint") flags.push("ai_hint");
    if (c.matchedOn === "none") flags.push("unsorted");
    if (r.payMethod === "cash") flags.push("weak_evidence");
    if (r.amount < 0) flags.push("refund");
    return {
      ...r,
      id: uid("exp"),
      category: c.category,
      lane: c.lane,
      childIds,
      reimbursed: 0,
      flags,
      included: c.category !== "not_kid",
    };
  });
}

/** Group care-related payees into providers; keep any user edits from `existing`. */
export function buildProviders(expenses: Expense[], existing: Provider[] = []): { expenses: Expense[]; providers: Provider[] } {
  const byKey = new Map<string, Provider>();
  for (const p of existing) byKey.set(providerKey(p.name), p);
  const votes = new Map<string, Record<string, number>>();
  const tin = new Map<string, boolean>();
  const out = expenses.map((e) => {
    const cat = categoryById(e.category);
    if (cat.group !== "Childcare" && cat.group !== "Education" && e.category !== "not_care_overnight") return e;
    const key = providerKey(e.merchant);
    if (!key) return e;
    if (!byKey.has(key)) {
      byKey.set(key, { id: uid("prov"), name: e.merchant.replace(/\s+(Tuition|Late Pickup|Childcare).*$/i, ""), type: "other", tinStatus: "none", w10OnFile: false });
    }
    const v = votes.get(key) ?? {};
    v[e.category] = (v[e.category] ?? 0) + 1;
    votes.set(key, v);
    if (e.tinPresent) tin.set(key, true);
    return { ...e, providerId: byKey.get(key)!.id };
  });
  const providers = [...byKey.entries()].map(([key, p]) => {
    const fromExisting = existing.find((x) => x.id === p.id);
    if (fromExisting) return fromExisting;
    const v = votes.get(key) ?? {};
    const top = Object.entries(v).sort((a, b) => b[1] - a[1])[0]?.[0];
    const type = (top && TYPE_BY_CATEGORY[top]) || "other";
    return { ...p, type, tinStatus: tin.get(key) ? "have" : "none" } as Provider;
  });
  const used = new Set(out.map((e) => e.providerId).filter(Boolean));
  return { expenses: out, providers: providers.filter((p) => used.has(p.id)) };
}

/** D1: same payee + same amount + paid within ±3 days → duplicate (first one wins). */
export function markDuplicates(expenses: Expense[]): Expense[] {
  const seen: Expense[] = [];
  return expenses.map((e) => {
    const dup = seen.find(
      (s) =>
        !s.flags.includes("duplicate") &&
        providerKey(s.merchant) === providerKey(e.merchant) &&
        Math.abs(s.amount - e.amount) < 0.005 &&
        Math.abs(daysBetween(s.date, e.date)) <= 3 &&
        s.source !== e.source
    );
    seen.push(e);
    if (dup) return { ...e, included: false, flags: [...e.flags.filter((f) => f !== "duplicate"), "duplicate"] };
    return e;
  });
}

export function ingest(raw: RawLine[], children: Child[], taxYear: number, existingProviders: Provider[] = []) {
  const exp = markDuplicates(toExpenses(raw, children, taxYear));
  return buildProviders(exp, existingProviders);
}
