import { NextResponse } from "next/server";
import { loadHousehold, saveHousehold } from "@/lib/household";
import type { AppData } from "@/lib/pipeline";
import { sessionEmail } from "@/lib/session";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The household this signed-in parent belongs to (shared by every parent e-mail listed in it). */
export async function GET(req: Request) {
  const email = sessionEmail(req);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore();
  if (!store) return NextResponse.json({ error: "sync_not_configured" }, { status: 501 });
  const rec = await loadHousehold(store, email);
  if (!rec) return NextResponse.json({ none: true });
  return NextResponse.json({ data: rec.data, updatedAt: rec.updatedAt, updatedBy: rec.updatedBy });
}

export async function PUT(req: Request) {
  const email = sessionEmail(req);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore();
  if (!store) return NextResponse.json({ error: "sync_not_configured" }, { status: 501 });
  const text = await req.text();
  if (text.length > 900_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let body: { data?: AppData; base?: string | null };
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  if (!body.data?.household || !Array.isArray(body.data.expenses)) return NextResponse.json({ error: "bad_data" }, { status: 400 });
  const r = await saveHousehold(store, email, body.data, body.base ?? null);
  if (!r.ok) return NextResponse.json({ conflict: true, data: r.conflict.data, updatedAt: r.conflict.updatedAt, updatedBy: r.conflict.updatedBy }, { status: 409 });
  return NextResponse.json({ updatedAt: r.record.updatedAt, taken: r.taken });
}
