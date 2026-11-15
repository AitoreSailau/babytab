"use client";
import { useState } from "react";
import type { AppData, Computed } from "@/lib/pipeline";
import { getRules } from "@/lib/rules";
import type { Provider, ProviderType, Scenario, TinStatus } from "@/lib/types";
import { money, pctStr } from "@/lib/util";
import { Meter } from "./charts";

const SHORT: Record<string, string> = { oe: "Open enrollment", dec15: "Pay December care", pye: "Plan year ends", w10: "Provider W-10s", w2: "W-2 box 10", file: "File return", camp: "Day camp" };
const STATUS: Record<string, string> = { done: "done", due: "soon", upcoming: "ahead" };
const fmtDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleString("en-US", { month: "short", day: "numeric" });

export function TaxTab({ data, c, explain, isPro, onUnlock, onAsOf, onProviders, sample, withLeo, onToggleLeo, onOpenPack, onIcs, today, busy }: {
  data: AppData;
  c: Computed;
  explain: { text: string; source: string } | null;
  isPro: boolean;
  onUnlock: () => void;
  onAsOf: (d: string) => void;
  onProviders: (p: Provider[]) => void;
  sample: boolean;
  withLeo: boolean;
  onToggleLeo: () => void;
  onOpenPack: () => void;
  onIcs: () => void;
  today: string;
  busy: boolean;
}) {
  const { tax: t, events } = c;
  const h = data.household;
  const R = getRules(h.taxYear);
  const y = h.taxYear;
  const [why, setWhy] = useState(false);
  const rec = t.recommendation === "credit" ? "Credit, no FSA" : t.recommendation === "fsa" ? `FSA ${money(t.best.x)}` : `FSA ${money(t.best.x)} + credit`;
  const sims: [string, string][] = [[today, "Today"], [`${y}-12-31`, "Dec 31"], [`${y + 1}-01-31`, "Jan 31"], [`${y + 1}-04-15`, "Apr 15"]];
  const covered = Math.min(c.incurredToDate, t.elected.x);
  const left = Math.max(0, t.elected.x - c.incurredToDate);
  const noTin = data.providers.filter((p) => p.tinStatus === "none" || p.tinStatus === "refused").length;
  const figure: Record<string, string> = {
    oe: money(t.best.x),
    dec15: left > 0 ? money(left) : "",
    pye: left > 0 ? money(left) : "",
    w10: noTin ? `${noTin} TIN` : "",
    w2: money(t.elected.x),
    file: money(t.best.total),
  };
  const scenarios: [string, string, Scenario, boolean][] = [
    ["Credit only", "$0 FSA", t.creditOnly, false],
    ["Now", `${money(t.elected.x)} FSA`, t.elected, false],
    ["Best", `${money(t.best.x)} FSA`, t.best, true],
  ];

  return (
    <div className="stack">
      <div className="hero-card">
        <div className="row-between">
          <div className="eyebrow">Best childcare tax move · {y}</div>
          {sample && <button className={`chip ${withLeo ? "on" : ""}`} disabled={busy} onClick={onToggleLeo}>{withLeo ? "2 kids" : "+ 2nd kid"}</button>}
        </div>
        <div className="huge">{money(t.best.total)}</div>
        <div className="hero-row">
          <div><b>{rec}</b><span>do this</span></div>
          {t.advantage > 0 && <div><b>+{money(t.advantage)}</b><span>vs. now</span></div>}
          <div><b>{pctStr(t.best.pct)}</b><span>credit rate</span></div>
        </div>
        {explain && <button className="btn btn-sm" onClick={() => setWhy(!why)}>{why ? "Hide" : "Why?"}</button>}
        {why && explain && <p className="why">{explain.text}</p>}
      </div>

      <div className="card">
        <h2>Side by side</h2>
        <div className="tiles t3 flush">
          {scenarios.map(([label, sub, sc, best]) => (
            <div key={label} className={`sbs ${best ? "best" : ""}`}>
              <div className="eyebrow">{label} · {sub}</div>
              <div className="big">{money(sc.total)}</div>
              <div className="pair"><span>FSA</span><b>{money(sc.fsaSavings)}</b></div>
              <div className="pair"><span>Credit</span><b>{money(sc.credit)}</b></div>
            </div>
          ))}
        </div>
        {h.dcfsaAvailable && t.elected.x > 0 && (
          <div className="fsa-meter">
            <div className="row-between"><div className="eyebrow">FSA used</div><div className="mid">{money(covered)} <small>/ {money(t.elected.x)}</small></div></div>
            <Meter value={c.incurredToDate} max={t.elected.x} />
          </div>
        )}
      </div>

      <div className="card">
        <div className="row-between"><h2>Gaps</h2><div className="mid accent">{money(t.gaps.reduce((a, g) => a + g.dollarImpact, 0))}</div></div>
        {t.gaps.map((g, i) => {
          const locked = !isPro && i >= 3;
          return (
            <div key={g.id} className={`line ${locked ? "blur" : ""}`} title={locked ? "" : g.detail}>
              <div><b>{g.title}</b>{g.due && <small>by {fmtDate(g.due)}</small>}</div>
              <div className="mid">{g.dollarImpact > 0 ? money(g.dollarImpact) : "—"}</div>
            </div>
          );
        })}
        {!isPro && t.gaps.length > 3 && <button className="btn btn-accent" style={{ marginTop: 18 }} onClick={onUnlock}>Unlock all {t.gaps.length}</button>}
      </div>

      <div className="card">
        <div className="row-between">
          <h2>Your plan year</h2>
          <div className="row">{sims.map(([d, label]) => <button key={label} className={`chip ${data.asOf === d ? "on" : ""}`} onClick={() => onAsOf(d)}>{label}</button>)}</div>
        </div>
        <div className="plan">
          {events.map((e) => (
            <div key={e.id} className={`plan-row ${e.status}`} title={e.detail}>
              <span className="plan-date">{fmtDate(e.date)}</span>
              <span className="plan-title">{SHORT[e.id] ?? e.title}</span>
              <span className="plan-fig">{figure[e.id] ?? ""}</span>
              <span className={`pill ${e.status}`}>{STATUS[e.status]}</span>
            </div>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 18 }} onClick={isPro ? onIcs : onUnlock}>{isPro ? "Add to calendar" : "🔒 Add to calendar"}</button>
      </div>

      {data.providers.length > 0 && (
        <div className="card">
          <h2>Providers</h2>
          {data.providers.map((p) => (
            <div key={p.id} className="prov-row">
              <b>{p.name}</b>
              <select aria-label="Type" value={p.type} onChange={(e) => onProviders(data.providers.map((x) => (x.id === p.id ? { ...x, type: e.target.value as ProviderType } : x)))}>
                {R.provider_types.map((pt) => <option key={pt} value={pt}>{pt.replace("_", " ")}</option>)}
              </select>
              <select aria-label="Taxpayer ID" value={p.tinStatus} onChange={(e) => onProviders(data.providers.map((x) => (x.id === p.id ? { ...x, tinStatus: e.target.value as TinStatus } : x)))}>
                <option value="have">TIN on file</option><option value="requested">TIN requested</option><option value="refused">TIN refused</option><option value="tax_exempt">Tax-exempt</option><option value="none">TIN missing</option>
              </select>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="row-between"><h2>Tax Pack</h2><button className="btn btn-accent" onClick={isPro ? onOpenPack : onUnlock}>{isPro ? "Open" : "🔒 Unlock"}</button></div>
        <div className={`tiles t3 flush ${isPro ? "" : "blur"}`}>
          <div className="sbs"><div className="eyebrow">Qualified care</div><div className="big">{money(t.eligibleProjected)}</div></div>
          <div className="sbs"><div className="eyebrow">W-2 box 10</div><div className="big">{money(t.best.x)}</div></div>
          <div className="sbs"><div className="eyebrow">Credit</div><div className="big">{money(t.best.credit)}</div></div>
        </div>
      </div>

      <p className="notice" title={R.status_note}>Not tax advice · nothing is filed · rules {R.version} · data stays in this browser</p>
    </div>
  );
}
