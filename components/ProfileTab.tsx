"use client";
import type { Child, FilingStatus, Household } from "@/lib/types";
import { uid } from "@/lib/util";

const num = (v: string) => (v === "" ? 0 : Math.max(0, Number(v.replace(/[^\d.]/g, "")) || 0));

export function ProfileTab({ household: h, kids, onChange, sample, plan, onSample, onReset, busy }: {
  household: Household;
  kids: Child[];
  onChange: (h: Household, c: Child[]) => void;
  sample: boolean;
  plan: string | null;
  onSample: () => void;
  onReset: () => void;
  busy: boolean;
}) {
  const set = (patch: Partial<Household>) => onChange({ ...h, ...patch }, kids);
  const setKid = (i: number, patch: Partial<Child>) => onChange(h, kids.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const mfj = h.filingStatus === "mfj";
  return (
    <div className="stack">
      <div className="intro">
        <h1>Profile</h1>
        <p>Income, kids and benefits power the tax math. Everything stays in this browser.</p>
      </div>

      <div className="card">
        <div className="row-between"><h2>Kids</h2><button className="btn btn-sm" onClick={() => onChange(h, [...kids, { id: uid("kid"), name: "", birthDate: "" }])}>+ Add</button></div>
        {kids.map((c, i) => (
          <div className="form-grid kid" key={c.id}>
            <label className="field">Name<input value={c.name} placeholder="Mia" onChange={(e) => setKid(i, { name: e.target.value })} /></label>
            <label className="field">Born<input type="date" value={c.birthDate} onChange={(e) => setKid(i, { birthDate: e.target.value })} /></label>
            <button className="x" onClick={() => onChange(h, kids.filter((_, j) => j !== i))} aria-label="Remove child">✕</button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Income · {h.taxYear}</h2>
        <div className="form-grid">
          <label className="field">Filing status
            <select value={h.filingStatus} onChange={(e) => set({ filingStatus: e.target.value as FilingStatus })}>
              <option value="mfj">Married, joint</option><option value="single">Single</option><option value="hoh">Head of household</option><option value="mfs">Married, separate</option>
            </select>
          </label>
          <label className="field">Household AGI<input inputMode="numeric" value={h.agi || ""} placeholder="120000" onChange={(e) => set({ agi: num(e.target.value) })} /></label>
          <label className="field">Your earned income<input inputMode="numeric" value={h.earnedYou || ""} placeholder="68000" onChange={(e) => set({ earnedYou: num(e.target.value) })} /></label>
          {mfj && <label className="field">Spouse earned income<input inputMode="numeric" value={h.earnedSpouse || ""} placeholder="52000" onChange={(e) => set({ earnedSpouse: num(e.target.value) })} /></label>}
        </div>
      </div>

      <div className="card">
        <h2>Benefits & budget</h2>
        <div className="form-grid">
          <label className="check"><input type="checkbox" checked={h.dcfsaAvailable} onChange={(e) => set({ dcfsaAvailable: e.target.checked })} /> Dependent Care FSA at work</label>
          <label className="check"><input type="checkbox" checked={h.hasHsaOrHealthFsa} onChange={(e) => set({ hasHsaOrHealthFsa: e.target.checked })} /> HSA or health FSA</label>
          {h.dcfsaAvailable && <label className="field">FSA election this year<input inputMode="numeric" value={h.dcfsaElected || ""} placeholder="5000" onChange={(e) => set({ dcfsaElected: num(e.target.value) })} /></label>}
          {h.dcfsaAvailable && <label className="field">FSA plan maximum<input inputMode="numeric" value={h.dcfsaPlanCap || ""} placeholder="7500" onChange={(e) => set({ dcfsaPlanCap: num(e.target.value) })} /></label>}
          <label className="field">Monthly kid budget<input inputMode="numeric" value={h.monthlyBudget || ""} placeholder="1500" onChange={(e) => set({ monthlyBudget: num(e.target.value) })} /></label>
        </div>
      </div>

      <div className="card">
        <div className="row-between">
          <h2>Data{plan ? ` · Pro ${plan}` : ""}</h2>
          <div className="row">
            <button className="btn" onClick={onSample} disabled={busy}>{busy ? "Loading…" : sample ? "Reload sample" : "Try with Sample US Data"}</button>
            <button className="btn" onClick={onReset}>Delete my data</button>
          </div>
        </div>
      </div>
    </div>
  );
}
