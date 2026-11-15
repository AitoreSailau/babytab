"use client";
import { useEffect, useRef } from "react";
import type { Session } from "@/lib/client";
import { parsePays } from "@/lib/payer";
import type { Child, FilingStatus, Household, Parent } from "@/lib/types";
import { uid } from "@/lib/util";

const num = (v: string) => (v === "" ? 0 : Math.max(0, Number(v.replace(/[^\d.]/g, "")) || 0));
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const SYNC: Record<string, string> = { ok: "synced", saving: "saving…", error: "offline", nostore: "storage not set up", off: "" };

type Gsi = { accounts: { id: { initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void; renderButton: (el: HTMLElement, o: Record<string, unknown>) => void } } };

function GoogleButton({ onCredential }: { onCredential: (c: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  useEffect(() => {
    const render = () => {
      const g = (window as unknown as { google?: Gsi }).google;
      if (!g || !ref.current) return;
      g.accounts.id.initialize({ client_id: CLIENT_ID, callback: (r) => cb.current(r.credential) });
      g.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", shape: "pill", text: "signin_with" });
    };
    if ((window as unknown as { google?: Gsi }).google) return render();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, []);
  return <div ref={ref} />;
}

export function ProfileTab({ household: h, kids, parents, onChange, meId, onMe, session, sync, onCredential, onSignOut, sample, plan, onSample, onReset, busy }: {
  household: Household;
  kids: Child[];
  parents: Parent[];
  onChange: (h: Household, c: Child[], p: Parent[]) => void;
  meId: string | null;
  onMe: (id: string) => void;
  session: Session | null;
  sync: string;
  onCredential: (c: string) => void;
  onSignOut: () => void;
  sample: boolean;
  plan: string | null;
  onSample: () => void;
  onReset: () => void;
  busy: boolean;
}) {
  const set = (patch: Partial<Household>) => onChange({ ...h, ...patch }, kids, parents);
  const setKid = (i: number, patch: Partial<Child>) => onChange(h, kids.map((c, j) => (j === i ? { ...c, ...patch } : c)), parents);
  const setParent = (i: number, patch: Partial<Parent>) => onChange(h, kids, parents.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const addParent = () => onChange(h, kids, [...parents, { id: uid("par"), name: "", role: parents.some((p) => p.role === "mom") ? "dad" : "mom", email: !parents.length && session ? session.email : "", pays: [] }]);
  const mfj = h.filingStatus === "mfj";
  const label = (p: Parent) => p.name.trim().split(/\s+/)[0] || (p.role === "mom" ? "Mom" : "Dad");
  return (
    <div className="stack">
      <div className="intro wide">
        <h1>Profile</h1>
        <p>One family, two Gmail accounts. Add Mom and Dad with their Gmail addresses, then each parent signs in with their own Google account and sees the same kids, receipts and numbers.</p>
        <p>List the cards each parent pays with. BabyTab reads the card digits on every receipt and knows who paid.</p>
      </div>

      <div className="card">
        <div className="row-between">
          <h2>Account</h2>
          {session ? (
            <div className="row"><span className="mid-s">{session.email}</span>{SYNC[sync] && <span className="pill">{SYNC[sync]}</span>}<button className="btn btn-sm" onClick={onSignOut}>Sign out</button></div>
          ) : CLIENT_ID ? (
            <GoogleButton onCredential={onCredential} />
          ) : (
            <span className="pill" title="Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to turn on Google sign-in">Google sign-in not set up</span>
          )}
        </div>
        {!session && parents.length > 0 && (
          <div className="row"><span className="eyebrow">This device</span>{parents.map((p) => <button key={p.id} className={`chip ${meId === p.id ? "on" : ""}`} onClick={() => onMe(p.id)}>{label(p)}</button>)}</div>
        )}
      </div>

      <div className="card">
        <div className="row-between"><h2>Parents</h2>{parents.length < 2 && <button className="btn btn-sm" onClick={addParent}>+ Add</button>}</div>
        {parents.map((p, i) => (
          <div className="form-grid parent" key={p.id}>
            <label className="field">Role
              <select value={p.role} onChange={(e) => setParent(i, { role: e.target.value as Parent["role"] })}><option value="mom">Mom</option><option value="dad">Dad</option></select>
            </label>
            <label className="field">Name<input value={p.name} placeholder={p.role === "mom" ? "Ana" : "Marco"} onChange={(e) => setParent(i, { name: e.target.value })} /></label>
            <label className="field">Gmail<input type="email" inputMode="email" value={p.email} placeholder="name@gmail.com" onChange={(e) => setParent(i, { email: e.target.value.trim() })} /></label>
            <label className="field">Pays with<input defaultValue={p.pays.join(", ")} placeholder="4417, venmo" onBlur={(e) => setParent(i, { pays: parsePays(e.target.value) })} /></label>
            <button className="x" onClick={() => onChange(h, kids, parents.filter((_, j) => j !== i))} aria-label="Remove parent">✕</button>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row-between"><h2>Kids</h2><button className="btn btn-sm" onClick={() => onChange(h, [...kids, { id: uid("kid"), name: "", birthDate: "" }], parents)}>+ Add</button></div>
        {kids.map((c, i) => (
          <div className="form-grid kid" key={c.id}>
            <label className="field">Name<input value={c.name} placeholder="Mia" onChange={(e) => setKid(i, { name: e.target.value })} /></label>
            <label className="field">Born<input type="date" value={c.birthDate} onChange={(e) => setKid(i, { birthDate: e.target.value })} /></label>
            <button className="x" onClick={() => onChange(h, kids.filter((_, j) => j !== i), parents)} aria-label="Remove child">✕</button>
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
