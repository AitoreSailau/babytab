"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScanTab } from "@/components/ScanTab";
import { AnalyticsTab } from "@/components/AnalyticsTab";
import { TaxTab } from "@/components/TaxTab";
import { ProfileTab } from "@/components/ProfileTab";
import { Paywall } from "@/components/Paywall";
import { Pack } from "@/components/Pack";
import { IconChart, IconScan, IconTax, IconUser, Logo } from "@/components/Icons";
import { defaultHousehold, download, extractLines, load, loadSample, save, todayISO, wipe, type Saved, type Tab } from "@/lib/client";
import { buildProviders, ingest, markDuplicates } from "@/lib/ingest";
import { runAll, type AppData } from "@/lib/pipeline";
import { buildFacts, templateExplain } from "@/lib/explain";
import { toIcs } from "@/lib/project";
import { categoryById } from "@/lib/rules";
import { analyzeSpending } from "@/lib/spending";
import type { Expense } from "@/lib/types";

const SAMPLE_AS_OF = "2026-11-15";
const empty = (asOf: string): Saved => ({
  tab: "scan",
  data: { household: defaultHousehold(), children: [], providers: [], expenses: [], asOf },
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

  // Restore + Stripe return
  useEffect(() => {
    const saved = load();
    if (saved?.data) setSt({ ...empty(today), ...saved });
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
      const merged = markDuplicates([...data.expenses, ...added]);
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
      patch({ mode: "sample", withLeo, tab, data: { household: meta.household, children, providers, expenses: expenses.map((e) => ({ ...e, confirmedAt: now })), asOf: meta.asOf } });
    } catch {
      setToast("Could not load sample files");
    }
    setBusy(false);
  };

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
            {st.tab === "scan" && <ScanTab kids={d.children} taxYear={h.taxYear} onAdd={addExpenses} onSample={() => startSample(false)} busy={busy} count={d.expenses.length} />}

            {st.tab === "analytics" && (
              <AnalyticsTab s={spending} expenses={d.expenses} year={h.taxYear} onEdit={editExpense} onDelete={deleteExpense} onGoScan={() => patch({ tab: "scan" })} onSample={() => startSample(false)} busy={busy} />
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
              <ProfileTab household={h} kids={d.children} onChange={(household, children) => setData((x) => ({ ...x, household, children }))} sample={st.mode === "sample"} plan={st.plan} onSample={() => startSample(false)} onReset={reset} busy={busy} />
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
