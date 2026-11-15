import { NextResponse } from "next/server";
import { PLANS, type PlanId } from "@/lib/pricing";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { plan = "monthly" } = (await req.json().catch(() => ({}))) as { plan?: PlanId };
  const p = PLANS[plan] ?? PLANS.monthly;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ mode: "demo" });
  if (!key.startsWith("sk_test_")) return NextResponse.json({ error: "Only Stripe test keys are allowed in this build." }, { status: 400 });
  const origin = req.headers.get("origin") || new URL(req.url).origin;
  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(p.cents),
    "line_items[0][price_data][recurring][interval]": p.interval,
    "line_items[0][price_data][product_data][name]": `BabyTab Pro (${p.label})`,
    success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancel`,
    "metadata[plan]": p.id,
  });
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const j = await r.json();
  if (!r.ok) return NextResponse.json({ error: j.error?.message ?? "stripe_error" }, { status: 502 });
  return NextResponse.json({ mode: "stripe", url: j.url });
}
