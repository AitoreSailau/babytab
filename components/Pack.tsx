"use client";
import type { AppData, Computed } from "@/lib/pipeline";
import { categoryById, getRules } from "@/lib/rules";
import { download } from "@/lib/client";
import { money, pctStr } from "@/lib/util";

const CHECK_IDS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11"];

export function Pack({ data, c, onBack }: { data: AppData; c: Computed; onBack: () => void }) {
  const { tax: t, spending: s } = c;
  const h = data.household;
  const R = getRules(h.taxYear);
  const rows = t.ledger.filter((r) => !r.expense.projected);
  const status = (rule: string) => {
    if (rule === "R7" || rule === "R8" || rule === "R9" || rule === "R10") return t.limit > 0 ? "PASS" : "FAIL";
    if (rule === "R5") return h.filingStatus === "mfs" ? "FAIL" : "PASS";
    const ks = rows.flatMap((r) => r.checks.filter((k) => k.rule === rule && r.expense.lane === "care"));
    if (!ks.length) return "PASS";
    return ks.some((k) => k.status === "FAIL") ? "FAIL" : ks.some((k) => k.status === "WARN") ? "WARN" : "PASS";
  };
  const careProviders = data.providers
    .map((p) => ({ p, rows: t.ledger.filter((r) => r.expense.providerId === p.id && r.eligibleAmount > 0) }))
    .filter((x) => x.rows.length);
  const byChild = data.children.map((k) => ({ k, amt: t.ledger.filter((r) => r.expense.childIds.includes(k.id)).reduce((a, r) => a + r.eligibleAmount, 0) }));
  const months = Array.from({ length: 12 }, (_, i) => `${h.taxYear}-${String(i + 1).padStart(2, "0")}`);
  const nanny = careProviders.some((x) => x.p.type === "nanny");

  const csv = () => {
    const head = "date_paid,payee,description,category,tax_lane,amount,eligible,status,rules,service_from,service_to,child,source,source_hash,projected";
    const lines = data.expenses.concat(c.projected).map((e) => {
      const r = t.ledger.find((x) => x.expense.id === e.id);
      const kid = data.children.filter((k) => e.childIds.includes(k.id)).map((k) => k.name).join("|");
      const cells = [e.date, e.merchant, e.description, categoryById(e.category).label, e.lane, e.amount.toFixed(2), (r?.eligibleAmount ?? 0).toFixed(2), r?.status ?? "", r?.checks.map((k) => `${k.rule}:${k.status}`).join(" ") ?? "", e.serviceFrom ?? "", e.serviceTo ?? "", kid, e.source, e.sourceHash ?? "", e.projected ? "yes" : ""];
      return cells.map((x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(",");
    });
    download(`babytab_ledger_${h.taxYear}.csv`, [head, ...lines].join("\n"), "text/csv");
  };
  const json = () => download(`babytab_state_${h.taxYear}.json`, JSON.stringify({ rule_table: R.version, data, result: { ...t, ledger: undefined }, audit: t.audit }, null, 2), "application/json");

  return (
    <div className="container">
      <div className="row no-print" style={{ marginBottom: 16 }}>
        <button className="btn" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" onClick={() => window.print()}>Print / Save as PDF</button>
        <button className="btn" onClick={csv}>Download ledger CSV</button>
        <button className="btn" onClick={json}>Download JSON</button>
      </div>
      <div className="card pack">
        <h1>Childcare Tax Pack · {h.taxYear}</h1>
        <p>Prepared {new Date().toISOString().slice(0, 10)} · data as of {data.asOf} · rule table {R.version} (verified {R.verified_on})<br />
          <em>Worksheet for you or your preparer — not a filed form. Information only, not tax advice.</em></p>

        <h2>1. Summary</h2>
        <table><tbody>
          <tr><td>Recommended strategy</td><td><strong>{t.recommendation === "credit" ? "Child and dependent care credit only" : t.recommendation === "fsa" ? `Dependent Care FSA ${money(t.best.x)}` : `DCFSA ${money(t.best.x)} + credit`}</strong></td></tr>
          <tr><td>Estimated federal benefit</td><td>{money(t.best.total)} (FSA {money(t.best.fsaSavings)} + credit {money(t.best.credit)})</td></tr>
          <tr><td>Current election ({money(t.elected.x)}) benefit</td><td>{money(t.elected.total)}</td></tr>
          <tr><td>Qualifying children / dollar limit</td><td>{t.qualifyingCount} / {money(t.limit)}</td></tr>
          <tr><td>Eligible care: paid / projected full year</td><td>{money(t.eligibleActual)} / {money(t.eligibleProjected)}</td></tr>
          <tr><td>Kid spending year to date</td><td>{money(s.total)} ({money(s.monthlyAvg)}/month)</td></tr>
        </tbody></table>

        <h2>2. Pub 503 checklist</h2>
        <table><thead><tr><th>Rule</th><th>Test</th><th>Publication section</th><th>Result</th></tr></thead><tbody>
          {CHECK_IDS.map((id) => {
            const ck = (R.checks as Record<string, { name: string; pub: string }>)[id];
            return <tr key={id}><td>{id}</td><td>{ck.name}</td><td>{ck.pub}</td><td><strong>{status(id)}</strong></td></tr>;
          })}
        </tbody></table>

        <h2>3. Form 2441-style worksheet</h2>
        <p><strong>Part I — Care providers</strong></p>
        <table><thead><tr><th>Provider</th><th>Type</th><th>TIN</th><th>W-10</th><th className="num">Paid (eligible)</th></tr></thead><tbody>
          {careProviders.map(({ p, rows }) => (
            <tr key={p.id}><td>{p.name}</td><td>{p.type.replace("_", " ")}</td><td>{p.tinStatus === "have" ? "on file" : p.tinStatus === "tax_exempt" ? "tax-exempt" : "MISSING"}</td><td>{p.w10OnFile ? "yes" : "no"}</td><td className="num">{money(rows.reduce((a, r) => a + r.eligibleAmount, 0), true)}</td></tr>
          ))}
        </tbody></table>
        <p><strong>Part II — Qualified expenses</strong></p>
        <table><tbody>
          {byChild.map(({ k, amt }) => <tr key={k.id}><td>{k.name} (born {k.birthDate})</td><td className="num">{money(amt, true)}</td></tr>)}
          <tr><td>Dollar limit (R7)</td><td className="num">{money(t.limit)}</td></tr>
          <tr><td>Less dependent care benefits excluded (R8)</td><td className="num">{money(t.best.x)}</td></tr>
          <tr><td>Credit base after earned-income limit (R9)</td><td className="num">{money(t.best.base)}</td></tr>
          <tr><td>Applicable percentage at AGI (R10)</td><td className="num">{pctStr(t.best.pct)}</td></tr>
          <tr><td><strong>Credit (nonrefundable)</strong></td><td className="num"><strong>{money(t.best.credit)}</strong></td></tr>
        </tbody></table>
        <p><strong>Part III — Dependent care benefits</strong>: W-2 box 10 should equal your DCFSA reimbursements ({money(t.elected.x)} elected this year). Excess over the limit becomes taxable wages.</p>
        <p><strong>Where it goes:</strong> Form 2441 → Schedule 3 (Form 1040), line 2 → Form 1040. Confirm line numbers on the {h.taxYear} forms when the IRS releases them.</p>

        <h2>4. Provider payments by month</h2>
        <table><thead><tr><th>Provider</th>{months.map((m) => <th key={m} className="num">{m.slice(5)}</th>)}</tr></thead><tbody>
          {careProviders.map(({ p, rows }) => (
            <tr key={p.id}><td>{p.name}</td>{months.map((m) => { const v = rows.filter((r) => r.expense.date.startsWith(m)).reduce((a, r) => a + r.eligibleAmount, 0); return <td key={m} className="num">{v ? Math.round(v).toLocaleString() : "–"}</td>; })}</tr>
          ))}
        </tbody></table>
        {careProviders.some(({ p }) => p.tinStatus !== "have" && p.tinStatus !== "tax_exempt") && (
          <p><strong>Due diligence statement (template):</strong> “I requested the provider's taxpayer identification number on Form W-10 on ____ and the provider did not supply it. Provider name and address: ____.” Attach to Form 2441 if the TIN is still missing. Keep Form W-10 in your records; it is not sent to the IRS.</p>
        )}
        {nanny && <p><strong>Household employer check:</strong> if a nanny works in your home and you control how the work is done, you may be a household employer (Schedule H). Employer taxes you pay on those wages count as care expenses.</p>}

        <h2>5. Kid spending report</h2>
        <table><thead><tr><th>Category</th><th className="num">Total</th><th className="num">Items</th></tr></thead><tbody>
          {s.byCategory.map((x) => <tr key={x.id}><td>{x.label}</td><td className="num">{money(x.total, true)}</td><td className="num">{x.count}</td></tr>)}
          <tr><td>HSA/FSA-eligible kid medical (keep receipts)</td><td className="num">{money(t.medical.hsaEligible, true)}</td><td /></tr>
        </tbody></table>

        <h2>6. Next year plan</h2>
        <p>Open enrollment for {h.taxYear + 1}: elect <strong>{money(t.best.x)}</strong> in the Dependent Care FSA (benefit {money(t.best.total)} vs {money(t.creditOnly.total)} credit-only), assuming similar care costs and income.</p>
        <ul>{t.gaps.map((g) => <li key={g.id}>{g.title}{g.dollarImpact > 0 ? ` — ${money(g.dollarImpact)}` : ""}{g.due ? ` (by ${g.due})` : ""}</li>)}</ul>

        <h2>7. Records to keep</h2>
        <ul>
          <li>Provider invoices/statements showing name, address, dates of care and amounts paid</li>
          <li>Form W-10 or a provider statement with the TIN, for each provider</li>
          <li>Zelle/Venmo/bank records for every payment; signed receipts for cash</li>
          <li>W-2 (box 10) and DCFSA claim confirmations</li>
        </ul>

        <h2>8. Audit appendix</h2>
        <table><thead><tr><th>Date</th><th>Payee</th><th className="num">Amount</th><th>Rules</th><th>Decision</th><th>Source hash</th><th>Confirmed</th></tr></thead><tbody>
          {t.audit.filter((a) => !(a.inputs as { projected?: boolean }).projected).map((a, i) => (
            <tr key={i}><td>{String((a.inputs as { date?: string }).date ?? "")}</td><td>{String((a.inputs as { payee?: string }).payee ?? "")}</td><td className="num">{(a.inputs as { amount?: number }).amount !== undefined ? money((a.inputs as { amount: number }).amount, true) : ""}</td><td className="mono">{a.rule_id}</td><td>{a.decision}</td><td className="mono">{a.source_hash ?? ""}</td><td className="mono">{a.user_confirmed_at?.slice(0, 16) ?? ""}</td></tr>
          ))}
        </tbody></table>

        <h2>Assumptions & disclaimers</h2>
        <ul>{t.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        <p>BabyTab is an information and records tool. It does not prepare or file returns and is not tax advice. You are responsible for your return; consult a tax professional.</p>
      </div>
    </div>
  );
}
