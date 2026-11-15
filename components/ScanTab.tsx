"use client";
import { useEffect, useRef, useState } from "react";
import { toExpenses } from "@/lib/ingest";
import { categories, categoryById } from "@/lib/rules";
import { scanCanvas, scanFile, toCanvas, type ScanResult } from "@/lib/scan";
import type { Child, Expense } from "@/lib/types";
import { money, uid } from "@/lib/util";
import { IconCamera } from "./Icons";

const today = () => new Date().toISOString().slice(0, 10);

export function ScanTab({ kids, taxYear, onAdd, onSample, busy, count }: {
  kids: Child[];
  taxYear: number;
  onAdd: (e: Expense[]) => void;
  onSample: () => void;
  busy: boolean;
  count: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [work, setWork] = useState<{ stage: string; pct: number } | null>(null);
  const [draft, setDraft] = useState<Expense[] | null>(null);
  const [engine, setEngine] = useState<ScanResult["engine"] | null>(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);

  const stopCam = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCam(false);
  };
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => {
    if (cam && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cam]);

  const startCam = async () => {
    setError("");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      streamRef.current = s;
      setPreview(null);
      setDraft(null);
      setCam(true);
    } catch {
      fileRef.current?.click(); // no camera or permission denied → pick a photo
    }
  };

  const finish = (r: ScanResult) => {
    setWork(null);
    setEngine(r.engine);
    if (!r.lines.length) {
      setDraft(null);
      setError("No prices found. Try a sharper photo or add it by hand.");
      return;
    }
    const now = new Date().toISOString();
    setDraft(toExpenses(r.lines, kids, taxYear).map((e) => ({ ...e, confirmedAt: now })));
  };
  const progress = (stage: string, pct: number) => setWork({ stage, pct });

  const capture = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = toCanvas(v, v.videoWidth, v.videoHeight);
    setPreview(canvas.toDataURL("image/jpeg", 0.7));
    stopCam();
    setError("");
    setWork({ stage: "Reading", pct: 0.05 });
    try { finish(await scanCanvas(canvas, kids, progress)); } catch { setWork(null); setError("Could not read this photo."); }
  };

  const onFile = async (f: File | undefined | null) => {
    if (!f) return;
    stopCam();
    setError("");
    setDraft(null);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    setWork({ stage: "Reading", pct: 0.05 });
    try {
      const r = await scanFile(f, kids, progress);
      if (r.preview) setPreview(r.preview);
      finish(r);
    } catch { setWork(null); setError("Could not read this file."); }
  };

  const add = () => {
    if (!draft) return;
    onAdd(draft);
    setDraft(null);
    setPreview(null);
    setEngine(null);
  };
  const kept = draft?.filter((e) => e.included) ?? [];
  const total = kept.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="scan-grid">
      <div className="scan-left">
        {draft ? (
          <div className="found">
            <div className="eyebrow">{draft[0].merchant} · {draft[0].date}{engine === "ai" ? " · AI" : ""}</div>
            <div className="big">{money(total, true)}</div>
            <div className="found-list">
              {draft.map((e) => (
                <label key={e.id} className={`found-row ${e.included ? "" : "off"}`}>
                  <input type="checkbox" checked={e.included} onChange={() => setDraft(draft.map((x) => (x.id === e.id ? { ...x, included: !x.included } : x)))} />
                  <span className="found-desc">{e.description}<small>{categoryById(e.category).label}</small></span>
                  <span className="num">{money(e.amount, true)}</span>
                </label>
              ))}
            </div>
            <div className="row">
              <button className="btn btn-accent btn-lg" onClick={add} disabled={!kept.length}>Add {kept.length} · {money(total, true)}</button>
              <button className="btn btn-lg" onClick={() => { setDraft(null); setPreview(null); }}>Discard</button>
            </div>
          </div>
        ) : (
          <div className="intro">
            <h1>Scan a receipt</h1>
            <p>Point your camera at a store receipt or a daycare invoice. BabyTab reads every line, keeps the kid stuff and sorts it into your spending and your childcare tax numbers.</p>
            <p>No receipt? Add the expense by hand.</p>
            {count === 0 && <button className="btn btn-lg" onClick={onSample} disabled={busy}>{busy ? "Loading…" : "Try with Sample US Data"}</button>}
            {count > 0 && <div className="eyebrow">{count} expenses saved</div>}
          </div>
        )}
      </div>

      <div className="scan-card">
        <div
          className="scan-preview"
          onClick={() => { if (!cam && !work) startCam(); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
          role="button"
          aria-label="Open camera"
        >
          {cam && <video ref={videoRef} playsInline muted />}
          {!cam && preview && <img src={preview} alt="Receipt" />}
          {!cam && !preview && <div className="scan-empty"><IconCamera /><span>camera</span></div>}
          {work && (
            <div className="scan-progress">
              <div className="big">{Math.round(work.pct * 100)}%</div>
              <div className="meter"><span style={{ width: `${work.pct * 100}%` }} /></div>
            </div>
          )}
        </div>
        <button className="scan-btn" disabled={!!work} onClick={() => (cam ? capture() : startCam())}>{work ? "reading…" : "scan"}</button>
        <div className="scan-alt">
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!work}>photo / file</button>
          <button className="btn" onClick={() => setManual(true)}>+ by hand</button>
        </div>
        {error && <div className="scan-error">{error}</div>}
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf,.txt,.csv" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      {manual && <ManualForm kids={kids} onClose={() => setManual(false)} onSave={(e) => { onAdd([e]); setManual(false); }} />}
    </div>
  );
}

function ManualForm({ kids, onClose, onSave }: { kids: Child[]; onClose: () => void; onSave: (e: Expense) => void }) {
  const cats = categories().filter((c) => c.id !== "not_kid");
  const [f, setF] = useState({ amount: "", date: today(), payee: "", category: "diapers", child: kids.length === 1 ? kids[0].id : "" });
  const amount = Number(f.amount.replace(/[^\d.]/g, ""));
  const ok = amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.payee.trim();
  const save = () => {
    if (!ok) return;
    const cat = categoryById(f.category);
    onSave({
      id: uid("exp"),
      date: f.date,
      merchant: f.payee.trim(),
      description: cat.label,
      amount,
      payMethod: "manual",
      source: "manual",
      category: cat.id,
      lane: cat.lane as Expense["lane"],
      childIds: f.child ? [f.child] : [],
      reimbursed: 0,
      flags: ["manual"],
      included: true,
      confirmedAt: new Date().toISOString(),
    });
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add expense">
        <div className="row-between"><h2>Add expense</h2><button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button></div>
        <label className="amount-field">
          <span>$</span>
          <input autoFocus inputMode="decimal" placeholder="0.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-label="Amount" />
        </label>
        <div className="form-grid">
          <label className="field">Date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="field">Paid to<input placeholder="Target" value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></label>
          <label className="field">Category
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          </label>
          <label className="field">Child
            <select value={f.child} onChange={(e) => setF({ ...f, child: e.target.value })}>
              <option value="">All kids</option>
              {kids.map((k) => <option key={k.id} value={k.id}>{k.name || "Child"}</option>)}
            </select>
          </label>
        </div>
        <button className="btn btn-accent btn-lg wide" disabled={!ok} onClick={save}>Add {amount > 0 ? money(amount, true) : ""}</button>
      </div>
    </div>
  );
}
