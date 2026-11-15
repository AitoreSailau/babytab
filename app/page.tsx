"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScanTab } from "@/components/ScanTab";
import { AnalyticsTab } from "@/components/AnalyticsTab";
import { TaxTab } from "@/components/TaxTab";
import { ProfileTab } from "@/components/ProfileTab";
import { Paywall } from "@/components/Paywall";
import { Pack } from "@/components/Pack";
import { IconChart, IconScan, IconTax, IconUser, Logo } from "@/components/Icons";
import { defaultHousehold, download, extractLines, load, loadSample, loadSession, save, saveSession, todayISO, wipe, type Saved, type Session, type Tab } from "@/lib/client";
import { buildProviders, ingest, markDuplicates } from "@/lib/ingest";
import { runAll, type AppData } from "@/lib/pipeline";
import { buildFacts, templateExplain } from "@/lib/explain";
import { toIcs } from "@/lib/project";
import { categoryById } from "@/lib/rules";
import { analyzeSpending } from "@/lib/spending";
import { assignPayers, resolvePayer } from "@/lib/payer";
import type { Child, Expense, Household, Parent } from "@/lib/types";

const SAMPLE_AS_OF = "2026-11-15";
const empty = (asOf: string): Saved => ({
  tab: "scan",
  me: null,
  data: { household: defaultHousehold(), children: [], parents: [], providers: [], expenses: [], asOf },
  mode: "own",
  withLeo: false,
  token: null,
  plan: null,
});
const TABS: [Tab, string, () => React.ReactNode][] = [
  ["scan", "Scan", IconScan],
  ["analytics", "Spending", IconChart],
  ["tax", "Tax", IconTax],
  ["profile", "Profile", IconUser],
];

export default function Home() {
  const today = useRef(todayISO()).current;
  const [st, setSt] = useState<Saved>(() => empty(today));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [pack, setPack] = useState(false);
  const [toast, setToast] = useState("");
  const [explain, setExplain] = useState<{ text: string; source: string } | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [sync, setSync] = useState<"off" | "ok" | "saving" | "error" | "nostore">("off");
  const syncRef = useRef<{ base: string | null; last: string; pulled: boolean }>({ base: null, last: "", pulled: false });

  // Restore + Stripe return
  useEffect(() => {
    const saved = load();
    if (saved?.data) setSt({ ...empty(today), ...saved });
    setSession(loadSession());
    setReady(true);
    const q = new URLSearchParams(window.location.search);
    const sid = q.get("session_id");
    if (q.get("checkout") === "success" && sid) {
      fetch(`/api/entitlement?session_id=${encodeURIComponent(sid)}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.token) {
            setSt((s) => ({ ...s, token: j.token, plan: j.plan, tab: "tax" }));
            setToast("Pro unlocked");
          }
        })
        .finally(() => window.history.replaceState({}, "", "/"));
    } else if (q.get("checkout")) window.history.replaceState({}, "", "/");
  }, [today]);
  useEffect(() => { if (ready) save(st); }, [st, ready]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 3000); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [st.tab, pack]);

  const patch = (p: Partial<Saved>) => setSt((s) => ({ ...s, ...p }));
  const setData = (fn: (d: AppData) => AppData) => setSt((s) => ({ ...s, data: fn(s.data) }));
  const isPro = !!st.token;
  const d = st.data;
  const h = d.household;
  const parents = useMemo(() => d.parents ?? [], [d.parents]);
  /** The parent on this device: the signed-in Google account if it matches a parent, else the one picked in Profile. */
  const meId = (session && parents.find((p) => p.email.trim().toLowerCase() === session.email)?.id) || (parents.some((p) => p.id === st.me) ? st.me : null);

  const profileOk = h.agi > 0 && h.earnedYou > 0 && d.children.length > 0 && d.children.every((c) => c.name.trim() && /^\d{4}-\d{2}-\d{2}$/.test(c.birthDate));
  const computed = useMemo(() => (profileOk && d.expenses.length ? runAll(d) : null), [d, profileOk]);
  const spending = useMemo(() => computed?.spending ?? analyzeSpending(d.expenses, d.children, h.taxYear, d.asOf, h.monthlyBudget), [computed, d, h.taxYear, h.monthlyBudget]);

  // Explanation: template immediately, AI if available (number-linted server-side)
  const factsKey = computed ? JSON.stringify(buildFacts(computed.tax, computed.spending)) : "";
  useEffect(() => {
    if (!computed) return;
    const facts = buildFacts(computed.tax, computed.spending);
    setExplain({ text: templateExplain(facts), source: "template" });
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch("/api/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ facts }), signal: ctrl.signal })
        .then((r) => r.json())
        .then((j) => j.text && setExplain({ text: j.text, source: j.source }))
        .catch(() => {});
    }, 500);
    return () => { clearTimeout(t); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factsKey]);

  /** New expenses from a scan or the manual form: dedupe against what's saved, rebuild providers. */
  const addExpenses = (added: Expense[]) => {
    setData((data) => {
      const ps = data.parents ?? [];
      // Who paid: printed name / card digits / method first; otherwise the parent holding this device.
      const withPayer = added.map((e) => {
        if (e.flags.includes("payer_manual")) return e;
        const found = resolvePayer(e, ps);
        if (found) return { ...e, payerId: found };
        return meId ? { ...e, payerId: meId, flags: [...e.flags, "payer_device"] } : e;
      });
      const merged = markDuplicates([...data.expenses, ...withPayer]);
      const { expenses, providers } = buildProviders(merged, data.providers);
      return { ...data, expenses, providers };
    });
    const sum = added.filter((e) => e.included).reduce((s, e) => s + e.amount, 0);
    setToast(`Added $${sum.toFixed(2)}`);
  };
  const editExpense = (id: string, category: string) =>
    setData((data) => {
      const cat = categoryById(category);
      const next = data.expenses.map((e) => (e.id === id ? { ...e, category, lane: cat.lane as Expense["lane"], included: category !== "not_kid", flags: e.flags.filter((f) => f !== "unsorted") } : e));
      const { expenses, providers } = buildProviders(next, data.providers);
      return { ...data, expenses, providers };
    });
  const setPayer = (id: string, payerId: string) =>
    setData((data) => ({ ...data, expenses: data.expenses.map((e) => (e.id === id ? { ...e, payerId: payerId || undefined, flags: [...e.flags.filter((f) => f !== "payer_manual" && f !== "payer_device"), ...(payerId ? ["payer_manual"] : [])] } : e)) }));
  const setProfile = (household: Household, children: Child[], ps: Parent[]) =>
    setData((data) => ({ ...data, household, children, parents: ps, expenses: ps === data.parents ? data.expenses : assignPayers(data.expenses, ps) }));
  const deleteExpense = (id: string) =>
    setData((data) => {
      const { expenses, providers } = buildProviders(data.expenses.filter((e) => e.id !== id), data.providers);
      return { ...data, expenses, providers };
    });

  const startSample = async (withLeo = false, tab: Tab = "analytics") => {
    setBusy(true);
    try {
      const { meta, files } = await loadSample(withLeo);
      const children = [...meta.children, ...(withLeo ? [meta.optionalChild] : [])];
      const rep = await extractLines(files, children, true);
      const { expenses, providers } = ingest(rep.lines, children, meta.household.taxYear);
      const now = new Date().toISOString();
      const ps = meta.parents ?? [];
      patch({ mode: "sample", withLeo, tab, me: ps[0]?.id ?? null, data: { household: meta.household, children, parents: ps, providers, expenses: assignPayers(expenses, ps).map((e) => ({ ...e, confirmedAt: now })), asOf: meta.asOf } });
    } catch {
      setToast("Could not load sample files");
    }
    setBusy(false);
  };

  // ---------- Shared household (Google sign-in): one record for both parents ----------
  const api = async (sess: Session, method: "GET" | "PUT", body?: unknown) =>
    fetch("/api/household", { method, headers: { authorization: `Bearer ${sess.token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const adopt = (data: AppData, updatedAt: string) => {
    syncRef.current = { base: updatedAt, last: JSON.stringify(data), pulled: true };
    setSt((s) => ({ ...s, mode: "own", data }));
    setSync("ok");
  };
  const signOut = () => { saveSession(null); setSession(null); setSync("off"); syncRef.current = { base: null, last: "", pulled: false }; };
  const pull = async (sess: Session, first: boolean) => {
    try {
      const r = await api(sess, "GET");
      if (r.status === 501) return setSync("nostore");
      if (r.status === 401) return signOut();
      const j = await r.json();
      if (j.none) { syncRef.current.pulled = true; return setSync("ok"); } // first parent: the next save creates the household
      if (first && stRef.current.mode === "own") {
        // keep anything typed on this device before signing in
        const have = new Set((j.data.expenses as Expense[]).map((e) => e.id));
        const extra = stRef.current.data.expenses.filter((e) => !have.has(e.id));
        if (extra.length) {
          syncRef.current = { base: j.updatedAt, last: JSON.stringify(j.data), pulled: true };
          setSt((s) => ({ ...s, mode: "own", data: { ...j.data, expenses: markDuplicates([...j.data.expenses, ...extra]) } }));
          return setSync("ok");
        }
      }
      if (JSON.stringify(j.data) !== syncRef.current.last) {
        const mine = JSON.stringify(stRef.current.data) !== syncRef.current.last && syncRef.current.pulled && !first;
        if (!mine) { adopt(j.data, j.updatedAt); if (!first && j.updatedBy !== sess.email) setToast("Updated by the other parent"); }
      }
    } catch { setSync("error"); }
  };
  const stRef = useRef(st);
  stRef.current = st;
  const signIn = async (credential: string) => {
    try {
      const r = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential }) });
      const j = await r.json();
      if (!j.session) return setToast(r.status === 501 ? "Sign-in is not set up on this site" : "Sign-in failed");
      const sess = { token: j.session, email: j.email, name: j.name };
      saveSession(sess);
      setSession(sess);
    } catch { setToast("Sign-in failed"); }
  };
  useEffect(() => {
    if (!session) return;
    pull(session, true);
    const tick = () => { if (document.visibilityState === "visible") pull(session, false); };
    const t = setInterval(tick, 15000);
    window.addEventListener("focus", tick);
    return () => { clearInterval(t); window.removeEventListener("focus", tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  useEffect(() => {
    if (!session || st.mode !== "own" || !syncRef.current.pulled || sync === "nostore") return;
    const body = JSON.stringify(d);
    if (body === syncRef.current.last) return;
    const t = setTimeout(async () => {
      setSync("saving");
      try {
        const r = await api(session, "PUT", { data: d, base: syncRef.current.base });
        const j = await r.json();
        if (r.status === 409) { adopt(j.data, j.updatedAt); setToast("Updated by the other parent"); return; }
        if (!r.ok) return setSync(r.status === 501 ? "nostore" : "error");
        syncRef.current = { base: j.updatedAt, last: body, pulled: true };
        setSync("ok");
        if (j.taken?.length) setToast(`${j.taken[0]} already has a BabyTab family`);
      } catch { setSync("error"); }
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, session, st.mode, sync === "nostore"]);

  const reset = () => {
    wipe();
    setSt({ ...empty(today), token: st.token, plan: st.plan, tab: "profile" });
    setToast("Deleted from this browser");
  };

  if (!ready) return null;

  return (
    <div className="shell">
      <nav className="side no-print" aria-label="Sections">
        <div className="side-logo" title="BabyTab"><Logo /></div>
        {TABS.map(([id, label, Icon]) => (
          <button key={id} className={`side-btn ${st.tab === id && !pack ? "on" : ""}`} onClick={() => { setPack(false); patch({ tab: id }); }} aria-label={label} title={label}>
            <Icon />
          </button>
        ))}
      </nav>

      <main className="main">
        {pack && computed ? (
          <Pack data={d} c={computed} onBack={() => setPack(false)} />
        ) : (
          <>
            {st.tab === "scan" && <ScanTab parents={parents} meId={meId} kids={d.children} taxYear={h.taxYear} onAdd={addExpenses} onSample={() => startSample(false)} busy={busy} count={d.expenses.length} />}

            {st.tab === "analytics" && (
              <AnalyticsTab s={spending} expenses={d.expenses} year={h.taxYear} parents={parents} onPayer={setPayer} onEdit={editExpense} onDelete={deleteExpense} onGoScan={() => patch({ tab: "scan" })} onSample={() => startSample(false)} busy={busy} />
            )}

            {st.tab === "tax" && (computed ? (
              <TaxTab
                data={d}
                c={computed}
                explain={explain}
                isPro={isPro}
                busy={busy}
                today={st.mode === "sample" ? SAMPLE_AS_OF : today}
                onUnlock={() => setPaywall(true)}
                onAsOf={(asOf) => setData((x) => ({ ...x, asOf }))}
                onProviders={(providers) => setData((x) => ({ ...x, providers }))}
                sample={st.mode === "sample"}
                withLeo={st.withLeo}
                onToggleLeo={() => startSample(!st.withLeo, "tax")}
                onOpenPack={() => setPack(true)}
                onIcs={() => download("babytab_reminders.ics", toIcs(computed.events), "text/calendar")}
              />
            ) : (
              <div className="empty">
                <h1>Credit or FSA?</h1>
                <p>{profileOk ? "Add your childcare payments and BabyTab shows which one pays more." : "Add your kids and income in Profile, then your childcare payments. BabyTab shows whether the childcare credit or a Dependent Care FSA pays more."}</p>
                <div className="row">
                  <button className="btn btn-accent btn-lg" onClick={() => patch({ tab: profileOk ? "scan" : "profile" })}>{profileOk ? "Scan a receipt" : "Fill in profile"}</button>
                  <button className="btn btn-lg" onClick={() => startSample(false, "tax")} disabled={busy}>{busy ? "Loading…" : "Try with Sample US Data"}</button>
                </div>
              </div>
            ))}

            {st.tab === "profile" && (
              <ProfileTab household={h} kids={d.children} parents={parents} onChange={setProfile} meId={meId} onMe={(me) => patch({ me })} session={session} sync={sync} onCredential={signIn} onSignOut={signOut} sample={st.mode === "sample"} plan={st.plan} onSample={() => startSample(false)} onReset={reset} busy={busy} />
            )}
          </>
        )}
      </main>

      {paywall && computed && (
        <Paywall
          bestTotal={computed.tax.best.total}
          gapTotal={computed.tax.gaps.reduce((a, g) => a + g.dollarImpact, 0)}
          onClose={() => setPaywall(false)}
          onToken={(token, plan) => { patch({ token, plan }); setPaywall(false); setToast("Pro unlocked"); }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
