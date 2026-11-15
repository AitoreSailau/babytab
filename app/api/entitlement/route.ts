import { NextResponse } from "next/server";
import { signToken } from "@/lib/token";

export const runtime = "nodejs";

/** Stripe success redirect → verify the Checkout Session → signed entitlement token. */
export async function GET(req: Request) {
  const sid = new URL(req.url).searchParams.get("session_id");
  const key = process.env.STRIPE_SECRET_KEY;
  if (!sid || !key) return NextResponse.json({ error: "missing" }, { status: 400 });
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sid)}`, { headers: { authorization: `Bearer ${key}` } });
  const s = await r.json();
  if (!r.ok || s.status !== "complete") return NextResponse.json({ error: "not_paid" }, { status: 402 });
  return NextResponse.json({ token: signToken({ plan: s.metadata?.plan ?? "monthly", sid, mode: "stripe_test" }), plan: s.metadata?.plan ?? "monthly" });
}

/** Demo checkout when Stripe keys are not configured: accepts only the Stripe test card. */
export async function POST(req: Request) {
  const { card = "", plan = "monthly" } = (await req.json().catch(() => ({}))) as { card?: string; plan?: string };
  if (card.replace(/\D/g, "") !== "4242424242424242") return NextResponse.json({ error: "Use the test card 4242 4242 4242 4242." }, { status: 402 });
  return NextResponse.json({ token: signToken({ plan, mode: "demo" }), plan });
}
