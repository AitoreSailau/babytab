"use client";
import { money } from "@/lib/util";

export function Meter({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="meter" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function BarList({ rows }: { rows: { label: string; value: number; strong?: boolean }[] }) {
  const m = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <div className="bar-label" title={r.label}>{r.label}</div>
          <div className="track"><div className={`fill ${r.strong ? "strong" : ""}`} style={{ width: `${(Math.max(0, r.value) / m) * 100}%` }} /></div>
          <div className="num">{money(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

/** Monthly spend: childcare (accent) stacked on everything else (light). */
export function MonthBars({ months, budget }: { months: { month: string; total: number; groups: Record<string, number> }[]; budget?: number }) {
  const rows = months.map((m) => {
    const care = Math.max(0, m.groups["Childcare"] ?? 0);
    const all = Object.values(m.groups).reduce((s, v) => s + Math.max(0, v), 0);
    return { month: m.month, care, rest: Math.max(0, all - care), all };
  });
  const max = Math.max(1, budget ?? 0, ...rows.map((r) => r.all));
  const H = 240;
  return (
    <div>
      <div className="months" style={{ height: H }}>
        {budget ? <div className="budget-line" style={{ bottom: (budget / max) * H }}><span>{money(budget)}</span></div> : null}
        {rows.map((r) => (
          <div key={r.month} className="month-col" title={`${r.month}: ${money(r.all)}`}>
            <div className="bar-rest" style={{ height: `${(r.rest / max) * 100}%` }} />
            <div className="bar-care" style={{ height: `${(r.care / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="months-x">
        {rows.map((r) => <div key={r.month}>{new Date(r.month + "-15").toLocaleString("en-US", { month: "short" })}</div>)}
      </div>
    </div>
  );
}
