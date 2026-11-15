/** Server-only: BabyTab session after Google sign-in (HMAC-signed, 30 days). */
import { signToken, verifyToken } from "./token";

const MAX_AGE = 30 * 24 * 3600 * 1000;
/** Sessions need a real secret in production; the dev default is refused there. */
export const sessionsEnabled = () => process.env.NODE_ENV !== "production" || !!process.env.ENTITLEMENT_SECRET;
export const newSession = (email: string, name: string) => signToken({ kind: "session", email, name });

export function sessionEmail(req: Request): string | null {
  if (!sessionsEnabled()) return null;
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  const p = m ? verifyToken(m[1]) : null;
  if (!p || p.kind !== "session" || typeof p.email !== "string" || typeof p.iat !== "number" || Date.now() - p.iat > MAX_AGE) return null;
  return p.email;
}
