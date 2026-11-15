"use client";
import { extractRegex, type InputFile } from "./parse";
import type { Child, Household, RawLine } from "./types";
import { fnv1a } from "./util";
import type { AppData } from "./pipeline";

export const STORAGE_KEY = "babytab.v2";

export type Tab = "scan" | "analytics" | "tax" | "profile";
export interface Saved {
  tab: Tab;
  data: AppData;
  mode: "sample" | "own";
  withLeo: boolean;
  token: string | null;
  plan: string | null;
}

export function load(): Saved | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? (JSON.parse(s) as Saved) : null;
  } catch {
    return null;
  }
}
export function save(s: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage full or disabled: app keeps working in memory */
  }
}
export function wipe() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const defaultHousehold = (): Household => ({
  taxYear: 2026,
  filingStatus: "mfj",
  agi: 0,
  earnedYou: 0,
  earnedSpouse: 0,
  dcfsaElected: 0,
  dcfsaPlanCap: 7500,
  dcfsaAvailable: true,
  hasHsaOrHealthFsa: false,
  monthlyBudget: 1000,
});

export interface SampleMeta {
  asOf: string;
  household: Household;
  children: Child[];
  optionalChild: Child;
  files: string[];
  optionalChildFiles: string[];
}

export async function loadSample(withLeo: boolean): Promise<{ meta: SampleMeta; files: InputFile[] }> {
  const meta = (await (await fetch("/sample/household.json")).json()) as SampleMeta;
  const names = [...meta.files, ...(withLeo ? meta.optionalChildFiles : [])];
  const files = await Promise.all(names.map(async (name) => ({ name, text: await (await fetch(`/sample/${name}`)).text() })));
  return { meta, files };
}

export interface ExtractReport {
  lines: RawLine[];
  engine: "ai" | "rules" | "mixed";
  notes: string[];
}

const sum = (xs: RawLine[]) => xs.reduce((s, l) => s + l.amount, 0);

/**
 * AI extraction cross-checked by the deterministic parser. Per file:
 * - rules found nothing → use AI lines
 * - totals agree within 1% → use AI lines (verified)
 * - totals disagree → keep rules lines and say so
 */
export async function extractLines(files: InputFile[], children: Child[], useAi: boolean): Promise<ExtractReport> {
  const rulesAll = extractRegex(files, children);
  if (!useAi) return { lines: rulesAll, engine: "rules", notes: ["Rules-based parser (AI off)."] };
  let ai: (Record<string, unknown> & { source: string })[] = [];
  let provider = "";
  try {
    const r = await fetch("/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files, children: children.map((c) => c.name) }),
    });
    if (!r.ok) {
      const why = r.status === 501 ? "AI not configured on this deployment" : "AI unavailable";
      return { lines: rulesAll, engine: "rules", notes: [`${why}: used the rules-based parser.`] };
    }
    const j = await r.json();
    if (j.unavailable) {
      const why = j.error === "llm_not_configured" ? "AI not configured on this deployment" : "AI unavailable";
      return { lines: rulesAll, engine: "rules", notes: [`${why}: used the rules-based parser.`] };
    }
    ai = j.lines ?? [];
    provider = j.provider ?? "";
  } catch {
    return { lines: rulesAll, engine: "rules", notes: ["AI request failed: used the rules-based parser."] };
  }
  const out: RawLine[] = [];
  const notes: string[] = [];
  let usedAi = 0;
  for (const f of files) {
    const rules = rulesAll.filter((l) => l.source === f.name);
    const hash = fnv1a(f.text);
    const tin = rules.some((l) => l.tinPresent);
    const aiLines: RawLine[] = ai
      .filter((l) => l.source === f.name)
      .map((l) => ({
        date: String(l.date ?? ""),
        merchant: String(l.merchant ?? ""),
        description: String(l.description ?? ""),
        amount: Number(l.amount),
        serviceFrom: (l.service_from as string) || undefined,
        serviceTo: (l.service_to as string) || undefined,
        payMethod: (l.pay_method as string) || undefined,
        childName: (l.child_name as string) || undefined,
        tinPresent: Boolean(l.tin_present) || tin,
        unitCount: typeof l.unit_count === "number" ? l.unit_count : undefined,
        categoryHint: (l.category_hint as string) || undefined,
        source: f.name,
        sourceHash: hash,
      }))
      .filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.date) && isFinite(l.amount) && l.amount !== 0);
    if (!rules.length && aiLines.length) {
      out.push(...aiLines);
      usedAi++;
      notes.push(`${f.name}: read by AI (${aiLines.length} lines).`);
    } else if (aiLines.length && Math.abs(sum(aiLines) - sum(rules)) <= Math.max(1, Math.abs(sum(rules)) * 0.01)) {
      out.push(...aiLines);
      usedAi++;
      notes.push(`${f.name}: AI extraction matched the rules parser total.`);
    } else {
      out.push(...rules);
      if (aiLines.length) notes.push(`${f.name}: AI total differed from the rules parser; kept rules result.`);
    }
  }
  const engine = usedAi === files.length ? "ai" : usedAi ? "mixed" : "rules";
  if (provider && usedAi) notes.unshift(`AI: ${provider}`);
  return { lines: out, engine, notes };
}

export function download(name: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
