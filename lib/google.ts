/** Server-only: verify a Google Sign-In ID token (RS256) against Google's public keys. */
import crypto from "crypto";

export interface GoogleUser { email: string; name: string; sub: string }
type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string };

const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
let cache: { keys: Jwk[]; at: number } | null = null;

async function googleKeys(): Promise<Jwk[]> {
  if (cache && Date.now() - cache.at < 3600_000) return cache.keys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!r.ok) throw new Error("jwks");
  const j = (await r.json()) as { keys: Jwk[] };
  cache = { keys: j.keys, at: Date.now() };
  return j.keys;
}

export function googleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
}

export async function verifyGoogleIdToken(token: string, clientId: string, keys?: Jwk[], now = Date.now()): Promise<GoogleUser | null> {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s || !clientId) return null;
    const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg: string; kid: string };
    if (header.alg !== "RS256") return null;
    const jwk = (keys ?? (await googleKeys())).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: "jwk" });
    const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
    if (!ok) return null;
    const c = JSON.parse(Buffer.from(p, "base64url").toString()) as { iss: string; aud: string; exp: number; email?: string; email_verified?: boolean | string; name?: string; sub: string };
    if (!ISSUERS.includes(c.iss) || c.aud !== clientId || c.exp * 1000 < now) return null;
    if (!c.email || !(c.email_verified === true || c.email_verified === "true")) return null;
    return { email: c.email.toLowerCase(), name: c.name ?? "", sub: c.sub };
  } catch {
    return null;
  }
}
