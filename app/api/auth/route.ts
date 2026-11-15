import { NextResponse } from "next/server";
import { googleClientId, verifyGoogleIdToken } from "@/lib/google";
import { newSession, sessionsEnabled } from "@/lib/session";

export const runtime = "nodejs";

/** Google Sign-In credential → BabyTab session. */
export async function POST(req: Request) {
  const clientId = googleClientId();
  if (!clientId || !sessionsEnabled()) return NextResponse.json({ error: "signin_not_configured" }, { status: 501 });
  let body: { credential?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const user = await verifyGoogleIdToken(String(body.credential ?? ""), clientId);
  if (!user) return NextResponse.json({ error: "bad_credential" }, { status: 401 });
  return NextResponse.json({ session: newSession(user.email, user.name), email: user.email, name: user.name });
}
