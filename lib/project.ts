/** Plan-year projector, timeline and time simulator. */
import type { Child, Expense, Household } from "./types";
import { addDays, birthdayAt, daysBetween, parseISO, toISO, uid, yearOf } from "./util";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/**
 * Repeat each recurring care payment (same payee + same amount, ≥3 times this year)
 * from its last payment to Dec 31 of the tax year, using its median interval.
 */
export function projectRecurring(expenses: Expense[], taxYear: number, asOf: string): Expense[] {
  const real = expenses.filter((e) => !e.projected && e.included && e.lane === "care" && e.amount > 0 && !e.flags.includes("duplicate") && yearOf(e.date) === taxYear && !(e.serviceTo && yearOf(e.serviceTo) < taxYear));
  const groups = new Map<string, Expense[]>();
  for (const e of real) {
    const key = `${e.providerId ?? e.merchant}|${e.amount.toFixed(2)}|${e.childIds.join(",")}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const yearEnd = `${taxYear}-12-31`;
  // "Now" for the pattern check = the latest real payment we have (data cutoff), capped by asOf.
  const latest = real.reduce((m, e) => (e.date > m ? e.date : m), "");
  const ref = latest && latest < asOf ? latest : asOf;
  const out: Expense[] = [];
  for (const g of groups.values()) {
    if (g.length < 3) continue;
    g.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = g.slice(1).map((e, i) => daysBetween(g[i].date, e.date));
    const step = Math.round(median(gaps));
    if (step < 5 || step > 40) continue;
    const last = g[g.length - 1];
    // Only project if the pattern is still active (last payment within 2 intervals of asOf).
    if (daysBetween(last.date, ref) > step * 2 + 7) continue;
    const monthly = step >= 25;
    let d = last.date;
    let n = 0;
    while (n < 60) {
      d = monthly ? nextMonthSameDay(d) : addDays(d, step);
      if (d > yearEnd) break;
      const shift = daysBetween(last.date, d);
      out.push({
        ...last,
        id: uid("proj"),
        date: d,
        serviceFrom: last.serviceFrom ? (monthly ? monthStart(d) : addDays(last.serviceFrom, shift)) : undefined,
        serviceTo: last.serviceTo ? (monthly ? monthEnd(d) : addDays(last.serviceTo, shift)) : undefined,
        projected: true,
        flags: [...last.flags.filter((f) => f !== "weak_evidence"), "projected"],
        source: "projection",
        confirmedAt: undefined,
      });
      n++;
    }
  }
  return out;
}

function nextMonthSameDay(iso: string): string {
  const d = parseISO(iso);
  const day = d.getUTCDate();
  const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const last = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate();
  n.setUTCDate(Math.min(day, last));
  return toISO(n);
}
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
function monthEnd(iso: string): string {
  const d = parseISO(iso);
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  detail: string;
  status: "done" | "due" | "upcoming";
}

export function timeline(h: Household, children: Child[], asOf: string): TimelineEvent[] {
  const y = h.taxYear;
  const ev: Omit<TimelineEvent, "status">[] = [
    { id: "oe", date: `${y}-11-30`, title: `Open enrollment: ${y + 1} Dependent Care FSA election`, detail: "Typical deadline; check your employer's date. Use the decision curve to pick the amount." },
    { id: "dec15", date: `${y}-12-15`, title: "Pay-by-Dec-31 check", detail: "December care must be paid by Dec 31 to count this year." },
    { id: "pye", date: `${y}-12-31`, title: `${y} plan year ends`, detail: "Last day to incur DCFSA expenses (unless your plan has a grace period)." },
    { id: "w10", date: `${y + 1}-01-31`, title: "Collect provider statements and W-10s", detail: "Year-end statements from every provider; TIN for each one." },
    { id: "w2", date: `${y + 1}-02-15`, title: "Reconcile W-2 box 10", detail: "Box 10 must match your DCFSA reimbursements; excess becomes taxable." },
    { id: "file", date: `${y + 1}-04-15`, title: `File ${y} return with your Tax Pack`, detail: "Form 2441 worksheet, provider list and audit trail for you or your preparer." },
    { id: "camp", date: `${y + 1}-05-15`, title: "Summer day-camp lane", detail: "Day camps count; overnight camps don't. Book with that in mind." },
  ];
  for (const k of children) {
    const b = birthdayAt(k.birthDate, 13);
    if (b > `${y - 1}-12-31` && b < `${y + 2}-01-01`) ev.push({ id: `b13_${k.id}`, date: b, title: `${k.name.split(" ")[0]} turns 13`, detail: "Care after this date no longer qualifies." });
  }
  return ev
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ ...e, status: e.date < asOf ? "done" : daysBetween(asOf, e.date) <= 30 ? "due" : "upcoming" }));
}

export function toIcs(events: TimelineEvent[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const esc = (s: string) => s.replace(/[,;]/g, (m) => `\\${m}`);
  const body = events
    .filter((e) => e.status !== "done")
    .map((e) => {
      const d = e.date.replace(/-/g, "");
      const next = addDays(e.date, 1).replace(/-/g, "");
      return [
        "BEGIN:VEVENT",
        `UID:${e.id}-${d}@babytab.app`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${d}`,
        `DTEND;VALUE=DATE:${next}`,
        `SUMMARY:${esc("BabyTab: " + e.title)}`,
        `DESCRIPTION:${esc(e.detail)}`,
        "BEGIN:VALARM",
        "TRIGGER:-P3D",
        "ACTION:DISPLAY",
        `DESCRIPTION:${esc(e.title)}`,
        "END:VALARM",
        "END:VEVENT",
      ].join("\r\n");
    })
    .join("\r\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BabyTab//EN", "CALSCALE:GREGORIAN", body, "END:VCALENDAR"].join("\r\n");
}
