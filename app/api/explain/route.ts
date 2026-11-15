import { NextResponse } from "next/server";
import { callLlm, llmConfigured } from "@/lib/llm";
import { numberLint, templateExplain, type Facts } from "@/lib/explain";

export const runtime = "nodejs";

const SYSTEM = `You explain a family's results from BabyTab, a US childcare tax and kid-spending tool.
Write 4-6 short plain-English sentences for a busy working parent. Use ONLY numbers that appear in the JSON facts, formatted like $1,474 or 35%. Never compute new numbers, never estimate, never round differently.
Cover: which option wins (Dependent Care FSA, credit, or split) and why, what changing the election is worth, where kid money goes, and the single most valuable fix. Cite rule IDs like (R8) when given.
This is information, not tax advice. No greetings, no lists, no markdown.`;

export async function POST(req: Request) {
  let facts: Facts;
  try { facts = (await req.json()).facts; } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const fallback = templateExplain(facts);
  if (!llmConfigured()) return NextResponse.json({ text: fallback, source: "template", reason: "llm_not_configured" });
  const r = await callLlm({ system: SYSTEM, user: JSON.stringify(facts), maxTokens: 500, timeoutMs: 15000 });
  if (!r || !r.text.trim()) return NextResponse.json({ text: fallback, source: "template", reason: "llm_failed" });
  const lint = numberLint(r.text, facts);
  if (!lint.ok) return NextResponse.json({ text: fallback, source: "template", reason: "number_lint_failed", offending: lint.offending });
  return NextResponse.json({ text: r.text.trim(), source: "ai", provider: `${r.provider}:${r.model}` });
}
