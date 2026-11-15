/**
 * Shared household: one record, opened by every parent e-mail listed in it.
 * Keys: bt:hh:<id> → record, bt:email:<email> → household id.
 */
import crypto from "crypto";
import type { AppData } from "./pipeline";
import type { Store } from "./store";

export interface HouseholdRecord { id: string; data: AppData; updatedAt: string; emails: string[]; updatedBy: string }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hk = (id: string) => `bt:hh:${id}`;
const ek = (email: string) => `bt:email:${email}`;
const clean = (e: string) => e.trim().toLowerCase();

export async function loadHousehold(store: Store, email: string): Promise<HouseholdRecord | null> {
  const id = await store.get(ek(clean(email)));
  if (!id) return null;
  const raw = await store.get(hk(id));
  if (!raw) return null;
  const rec = JSON.parse(raw) as HouseholdRecord;
  return rec.emails.includes(clean(email)) ? rec : null; // the index alone never grants access
}

export type SaveResult =
  | { ok: true; record: HouseholdRecord; taken: string[] }
  | { ok: false; conflict: HouseholdRecord };

/**
 * Save from a signed-in parent. `base` is the updatedAt the client last saw; a mismatch means the
 * other parent saved in between, so the caller gets the newer record back instead of overwriting it.
 */
export async function saveHousehold(store: Store, email: string, data: AppData, base: string | null, now = new Date().toISOString()): Promise<SaveResult> {
  const me = clean(email);
  const existing = await loadHousehold(store, me);
  if (existing && existing.updatedAt !== base) return { ok: false, conflict: existing };
  const id = existing?.id ?? crypto.randomUUID();
  const wanted = [...new Set([me, ...(data.parents ?? []).map((p) => clean(p.email)).filter((e) => EMAIL.test(e))])];
  const emails: string[] = [];
  const taken: string[] = [];
  for (const e of wanted) {
    const owner = await store.get(ek(e));
    if (owner && owner !== id) taken.push(e); // already in another household: never hijacked
    else emails.push(e);
  }
  for (const e of existing?.emails ?? []) if (!emails.includes(e)) await store.del(ek(e));
  const record: HouseholdRecord = { id, data, updatedAt: now, emails, updatedBy: me };
  await store.set(hk(id), JSON.stringify(record));
  for (const e of emails) await store.set(ek(e), id);
  return { ok: true, record, taken };
}
