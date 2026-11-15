import { NextResponse } from "next/server";
import { callLlm, extractJson, llmConfigured } from "@/lib/llm";
import { categories } from "@/lib/rules";

export const runtime = "nodejs";

const SYSTEM = `You read a photo of a US store receipt or a childcare invoice.
Return ONLY JSON: {"merchant":string,"date":"YYYY-MM-DD"|null,"subtotal":number|null,"total":number|null,"lines":[{"description":string,"amount":number,"unit_count":number|null,"category_hint":string|null}]}
Rules:
- subtotal / total = the figures printed on the receipt (before tax / after tax), copied not computed.
- One line per purchased item or payment. Skip subtotal, total, tax, change and card lines.
- amount: positive for money paid, negative for refunds/discounts.
- description = the item text as printed.
- unit_count = the number before "ct"/"count" if present.
- category_hint is only a hint; choose from: ${categories().map((c) => c.id).join(", ")}.
- If the picture is not a receipt or cannot be read, return {"merchant":"","date":null,"subtotal":null,"total":null,"lines":[]}.
Do not invent lines. Do not compute anything.`;

/** Photo → lines, via a vision model. Stateless: the image is not logged or stored. */
export async function POST(req: Request) {
  if (!llmConfigured()) return NextResponse.json({ unavailable: true, error: "llm_not_configured" });
  let body: { image?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.image ?? "");
  if (!m || m[2].length > 5_500_000) return NextResponse.json({ error: "bad_image" }, { status: 400 });
  const r = await callLlm({ system: SYSTEM, user: "Extract the lines from this receipt.", json: true, maxTokens: 3000, timeoutMs: 30000, image: { mediaType: m[1], base64: m[2] } });
  if (!r) return NextResponse.json({ unavailable: true, error: "llm_failed" });
  const j = extractJson(r.text) as { merchant?: string; date?: string | null; subtotal?: number | null; total?: number | null; lines?: Record<string, unknown>[] } | null;
  if (!j?.lines) return NextResponse.json({ unavailable: true, error: "llm_bad_output" });
  return NextResponse.json({ merchant: j.merchant ?? "", date: j.date ?? null, subtotal: j.subtotal ?? null, total: j.total ?? null, lines: j.lines, provider: `${r.provider}:${r.model}` });
}
