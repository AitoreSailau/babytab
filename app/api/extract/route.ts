import { NextResponse } from "next/server";
import { callLlm, extractJson, llmConfigured } from "@/lib/llm";
import { redact } from "@/lib/parse";
import { categories } from "@/lib/rules";

export const runtime = "nodejs";

const SYSTEM = `You extract payment lines from US receipts, provider invoices/statements, Zelle/Venmo history and CSV exports.
Return ONLY JSON: {"lines":[{"date":"YYYY-MM-DD","merchant":string,"description":string,"amount":number,"service_from":"YYYY-MM-DD"|null,"service_to":"YYYY-MM-DD"|null,"pay_method":"card"|"ach"|"zelle"|"venmo"|"cash"|"check"|null,"child_name":string|null,"tin_present":boolean,"unit_count":number|null,"category_hint":string|null}]}
Rules:
- One line per purchased item or payment. Skip subtotal, total, tax, balance and card lines.
- amount: positive for money paid, negative for refunds/credits. Bank exports often show payments as negative: flip them so payments are positive.
- date = the date the money was paid. For invoices use the "Paid" date if present.
- merchant = store or care provider; for Zelle/Venmo use the payee name.
- description = the item or memo text, unchanged.
- tin_present = true if the document shows an EIN/TIN (it may appear as [ID ON FILE]) or says tax-exempt.
- unit_count = the number before "ct"/"count" if present.
- category_hint is only a hint; choose from: ${categories().map((c) => c.id).join(", ")}.
Do not invent lines. Do not compute anything.`;

export async function POST(req: Request) {
  if (!llmConfigured()) return NextResponse.json({ lines: [], unavailable: true, error: "llm_not_configured" });
  let body: { files?: { name: string; text: string }[]; children?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const files = (body.files ?? []).slice(0, 12).map((f) => ({ name: String(f.name).slice(0, 80), text: redact(String(f.text)).slice(0, 20000) }));
  if (!files.length) return NextResponse.json({ lines: [] });
  const children = (body.children ?? []).map((c) => String(c).split(" ")[0]).slice(0, 6);
  const out: unknown[] = [];
  let provider = "";
  for (const f of files) {
    const r = await callLlm({
      system: SYSTEM,
      user: `Known children first names: ${children.join(", ") || "none"}.\nFile: ${f.name}\n---\n${f.text}`,
      json: true,
      maxTokens: 4000,
      timeoutMs: 25000,
    });
    if (!r) return NextResponse.json({ lines: [], unavailable: true, error: "llm_failed" });
    provider = `${r.provider}:${r.model}`;
    const j = extractJson(r.text) as { lines?: Record<string, unknown>[] } | null;
    if (!j?.lines) return NextResponse.json({ lines: [], unavailable: true, error: "llm_bad_output" });
    for (const l of j.lines) out.push({ ...l, source: f.name });
  }
  // Stateless: nothing is logged or stored.
  return NextResponse.json({ lines: out, provider });
}
