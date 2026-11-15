"use client";
import { useState } from "react";
import { PLANS, PRO_FEATURES, type PlanId } from "@/lib/pricing";
import { money } from "@/lib/util";

export function Paywall({ onClose, onToken, bestTotal, gapTotal }: { onClose: () => void; onToken: (t: string, plan: string) => void; bestTotal: number; gapTotal: number }) {
  const [plan, setPlan] = useState<PlanId>("annual");
  const [demo, setDemo] = useState(false);
  const [card, setCard] = useState("4242 4242 4242 4242");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const checkout = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan }) });
      const j = await r.json();
      if (j.url) {
        window.location.href = j.url;
        return;
      }
      if (j.mode === "demo") setDemo(true);
      else setErr(j.error ?? "Checkout failed");
    } catch {
      setDemo(true);
    }
    setBusy(false);
  };
  const payDemo = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/entitlement", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ card, plan }) });
    const j = await r.json();
    setBusy(false);
    if (j.token) onToken(j.token, plan);
    else setErr(j.error ?? "Payment failed");
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Unlock BabyTab Pro">
        <div className="row-between">
          <h2 style={{ margin: 0 }}>BabyTab Pro</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="hero-row"><div><b>{money(bestTotal)}</b><span>best move</span></div><div><b>{money(gapTotal)}</b><span>at risk in gaps</span></div></div>
        <div className="grid g2" style={{ margin: "14px 0" }}>
          {(Object.keys(PLANS) as PlanId[]).map((id) => {
            const p = PLANS[id];
            return (
              <div key={id} className={`plan ${plan === id ? "on" : ""}`} onClick={() => setPlan(id)}>
                <div className="row-between"><strong>{p.label}</strong>{id === "annual" && <span className="badge b-accent">Best value</span>}</div>
                <div className="price">${p.price % 1 ? p.price.toFixed(2) : p.price}<span style={{ fontSize: 15, fontWeight: 500, color: "var(--ink-3)" }}>/{p.interval}</span></div>
                <div className="hint">{p.blurb}</div>
              </div>
            );
          })}
        </div>
        <ul style={{ paddingLeft: 18, margin: "0 0 16px" }}>{PRO_FEATURES.map((f) => <li key={f} style={{ margin: "4px 0" }}>{f}</li>)}</ul>

        <div className="testcard">
          <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>STRIPE TEST MODE · no real charge</div>
          Card 4242 4242 4242 4242 · any future date · any CVC · any ZIP
        </div>

        {!demo ? (
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn btn-accent btn-lg" onClick={checkout} disabled={busy}>{busy ? "Opening checkout…" : `Continue to Stripe Checkout (test) · $${PLANS[plan].price % 1 ? PLANS[plan].price.toFixed(2) : PLANS[plan].price}`}</button>
            <button className="btn btn-ghost" onClick={onClose}>Not now</button>
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <p className="hint">Stripe keys aren't configured on this deployment, so this is BabyTab's built-in test checkout. It accepts only the Stripe test card.</p>
            <div className="grid g3">
              <label className="field">Card number<input value={card} onChange={(e) => setCard(e.target.value)} /></label>
              <label className="field">Expiry<input defaultValue="12 / 34" /></label>
              <label className="field">CVC<input defaultValue="123" /></label>
            </div>
            <button className="btn btn-accent btn-lg" style={{ marginTop: 12 }} onClick={payDemo} disabled={busy}>{busy ? "Processing…" : "Pay (test)"}</button>
          </div>
        )}
        {err && <p style={{ color: "var(--fail)", marginTop: 10 }}>{err}</p>}
      </div>
    </div>
  );
}
