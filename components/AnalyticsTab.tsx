"use client";
import { useState } from "react";
import { categories, categoryById } from "@/lib/rules";
import type { SpendingResult } from "@/lib/spending";
import type { Expense } from "@/lib/types";
import { money, pctStr } from "@/lib/util";
import { BarList, Meter, MonthBars } from "./charts";

export function AnalyticsTab({ s, expenses, year, onEdit, onDelete, onGoScan, onSample, busy }: {
  s: SpendingResult;
  expenses: Expense[];
  year: number;
  onEdit: (id: string, category: string) => void;
  onDelete: (id: string) => void;
  onGoScan: () => void;
  onSample: () => void;
  busy: boolean;
}) {
  const [all, setAll] = useState(false);
  const cats = categories();
  if (!expenses.length) {
    return (
      <div className="empty">
        <h1>No spending yet</h1>
        <p>Scan a receipt or add an expense by hand and your numbers show up here.</p>
        <div className="row"><button className="btn btn-accent btn-lg" onClick={onGoScan}>Scan a receipt</button><button className="btn btn-lg" onClick={onSample} disabled={busy}>{busy ? "Loading…" : "Try with Sample US Data"}</button></div>
      </div>
    );
  }
  const over = s.budget > 0 && s.thisMonth > s.budget;
  const list = [...expenses].sort((a, b) => (a.date < b.date ? 1 : -1));
  const shown = all ? list : list.slice(0, 6);
  const top = s.unitPrices[0];
  return (
    <div className="stack">
      <div className="hero-card">
        <div className="eyebrow">Kids · {year}</div>
        <div className="huge">{money(s.total)}</div>
        <div className="hero-row">
          <div><b>{money(s.monthlyAvg)}</b><span>per month</span></div>
          <div><b>{money(s.annualized)}</b><span>year pace</span></div>
          <div><b>{s.count}</b><span>expenses</span></div>
        </div>
      </div>

      <div className="tiles t3">
        <div className="tile">
          <div className="eyebrow">This month</div>
          <div className={`big ${over ? "accent" : ""}`}>{money(s.thisMonth)}</div>
          {s.budget > 0 && <><Meter value={s.thisMonth} max={s.budget} /><div className="sub">of {money(s.budget)}</div></>}
        </div>
        <div className="tile">
          <div className="eyebrow">Tax-advantaged</div>
          <div className="big">{s.total ? pctStr((s.byLane.care + s.byLane.medical) / s.total) : "0%"}</div>
          <div className="sub">{money(s.byLane.care + s.byLane.medical)}</div>
        </div>
        <div className="tile">
          <div className="eyebrow">Overpaid</div>
          <div className="big accent">{money(s.unitOverspend)}</div>
          <div className="sub">{top ? `${top.bestMerchant} is cheaper` : "same item, other store"}</div>
        </div>
      </div>

      <div className="card">
        <div className="row-between"><h2>By month</h2><div className="legend"><span><i className="dot-care" />Childcare</span><span><i className="dot-rest" />Everything else</span></div></div>
        <MonthBars months={s.byMonth} budget={s.budget || undefined} />
      </div>

      <div className="tiles t2">
        <div className="card"><h2>By category</h2><BarList rows={s.byCategory.slice(0, 7).map((x) => ({ label: x.label, value: x.total, strong: x.group === "Childcare" }))} /></div>
        <div className="card">
          <h2>By child</h2>
          <BarList rows={s.byChild.map((k) => ({ label: k.name, value: k.total, strong: true }))} />
          {s.trends.slice(0, 3).map((tr) => (
            <div key={tr.group} className="trend"><span>{tr.group}</span><b>{tr.change > 0 ? "▲" : "▼"} {pctStr(Math.abs(tr.change))}</b></div>
          ))}
        </div>
      </div>

      {(s.unitPrices.length > 0 || s.recurring.length > 0) && (
        <div className="tiles t2">
          {s.unitPrices.length > 0 && (
            <div className="card">
              <h2>Cheaper elsewhere</h2>
              {s.unitPrices.slice(0, 3).map((u) => (
                <div key={u.product} className="line" title={`${u.purchases} buys · worst ${u.worstMerchant} ${money(u.worstUnitPrice * 100, true)}/100`}>
                  <div><b>{u.product}</b><small>{u.bestMerchant} · {money(u.bestUnitPrice * 100, true)}/100</small></div>
                  <div className="mid accent">−{money(u.overspend)}</div>
                </div>
              ))}
            </div>
          )}
          {s.recurring.length > 0 && (
            <div className="card">
              <h2>Repeat buys</h2>
              {s.recurring.slice(0, 3).map((r) => (
                <div key={r.product} className="line" title={`every ~${r.everyDays} days · ${money(r.avgPrice, true)} avg`}>
                  <div><b>{r.product}</b><small>next {r.nextExpected}</small></div>
                  <div className="mid">{money(r.monthlyRunRate)}<small>/mo</small></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="row-between"><h2>Expenses</h2><button className="btn btn-sm" onClick={() => setAll(!all)}>{all ? "Show less" : `All ${list.length}`}</button></div>
        <div className={`exp-list ${all ? "scroll" : ""}`}>
          {shown.map((e) => (
            <div key={e.id} className={`exp-row ${e.included ? "" : "off"}`}>
              <span className="exp-date">{e.date.slice(5)}</span>
              <span className="exp-what" title={e.description}><b>{e.merchant}</b><small>{e.description}</small></span>
              <select value={e.category} onChange={(ev) => onEdit(e.id, ev.target.value)} aria-label="Category">
                {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <span className="num">{money(e.amount, true)}</span>
              <button className="x" onClick={() => onDelete(e.id)} aria-label={`Delete ${categoryById(e.category).label}`}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
