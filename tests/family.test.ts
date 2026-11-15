import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { verifyGoogleIdToken } from "@/lib/google";
import { loadHousehold, saveHousehold } from "@/lib/household";
import { assignPayers, parsePays, resolvePayer, spendingByPayer } from "@/lib/payer";
import { cardLast4, extractRegex, payerHint } from "@/lib/parse";
import { memoryStore } from "@/lib/store";
import type { AppData } from "@/lib/pipeline";
import type { Expense, Parent } from "@/lib/types";

const mom: Parent = { id: "m", name: "Ana Rivera", role: "mom", email: "ana@gmail.com", pays: ["4417", "venmo"] };
const dad: Parent = { id: "d", name: "Marco Rivera", role: "dad", email: "marco@gmail.com", pays: ["9012", "zelle", "checking"] };
const exp = (o: Partial<Expense>): Expense => ({ id: Math.random().toString(36), date: "2026-03-01", merchant: "Target", description: "x", amount: 10, source: "t", category: "diapers", lane: "none", childIds: [], reimbursed: 0, flags: [], included: true, ...o });

describe("who paid", () => {
  it("reads card digits and printed payer names", () => {
    expect(cardLast4("VISA ****4417")).toBe("4417");
    expect(cardLast4("Paid Mastercard ****9012")).toBe("9012");
    expect(cardLast4("card ending in 0042")).toBe("0042");
    expect(cardLast4("TOTAL 12.00")).toBeUndefined();
    expect(payerHint("Account holder: Ana Rivera   Autopay from checking")).toBe("Ana Rivera");
    const lines = extractRegex([{ name: "r.txt", text: "TARGET\n03/08/2026\nPampers 112 ct   46.99\nTOTAL 46.99\nVISA ****4417" }], []);
    expect(lines[0].cardLast4).toBe("4417");
  });
  it("resolves by name, then card, then method, then device owner", () => {
    const ps = [mom, dad];
    expect(resolvePayer({ payerHint: "MARCO R", cardLast4: "4417" }, ps)).toBe("d");
    expect(resolvePayer({ cardLast4: "4417" }, ps)).toBe("m");
    expect(resolvePayer({ payMethod: "zelle" }, ps)).toBe("d");
    expect(resolvePayer({ payMethod: "ach" }, ps)).toBe("d");
    expect(resolvePayer({ payMethod: "cash" }, ps)).toBeUndefined();
    expect(resolvePayer({ payMethod: "cash" }, ps, "m")).toBe("m");
    expect(resolvePayer({ cardLast4: "4417" }, [])).toBeUndefined();
    expect(parsePays("4417, Venmo; **9012")).toEqual(["4417", "venmo", "9012"]);
  });
  it("re-assigns when cards change but keeps manual choices", () => {
    const es = [exp({ id: "a", cardLast4: "4417" }), exp({ id: "b", cardLast4: "4417", payerId: "d", flags: ["payer_manual"] }), exp({ id: "c", payerId: "m", flags: ["payer_device"] })];
    const out = assignPayers(es, [{ ...mom, pays: [] }, { ...dad, pays: ["4417"] }]);
    expect(out.map((e) => e.payerId)).toEqual(["d", "d", "m"]);
  });
  it("splits spending by parent", () => {
    const es = [exp({ payerId: "m", amount: 30 }), exp({ payerId: "d", amount: 60, date: "2026-11-02" }), exp({ amount: 10 }), exp({ payerId: "m", amount: 999, included: false })];
    const r = spendingByPayer(es, [mom, dad], 2026, "2026-11", (id) => id);
    expect(r.map((x) => [x.id, x.total])).toEqual([["m", 30], ["d", 60], ["", 10]]);
    expect(r[1].thisMonth).toBe(60);
    expect(r[0].share).toBeCloseTo(0.3);
  });
});

describe("shared household", () => {
  const data = (parents: Parent[], n = 0): AppData => ({ household: {} as AppData["household"], children: [], parents, providers: [], expenses: Array.from({ length: n }, () => exp({})), asOf: "2026-11-15" });
  it("both parents' e-mails open the same record; strangers get nothing", async () => {
    const store = memoryStore();
    const a = await saveHousehold(store, "Ana@gmail.com", data([mom, dad], 2), null, "t1");
    expect(a.ok).toBe(true);
    const viaDad = await loadHousehold(store, "marco@gmail.com");
    expect(viaDad?.data.expenses.length).toBe(2);
    expect(await loadHousehold(store, "eve@gmail.com")).toBeNull();
    // dad saves on top of what he saw
    const b = await saveHousehold(store, "marco@gmail.com", data([mom, dad], 3), "t1", "t2");
    expect(b.ok).toBe(true);
    expect((await loadHousehold(store, "ana@gmail.com"))?.data.expenses.length).toBe(3);
  });
  it("a stale save does not overwrite the other parent's newer data", async () => {
    const store = memoryStore();
    await saveHousehold(store, "ana@gmail.com", data([mom, dad], 1), null, "t1");
    await saveHousehold(store, "marco@gmail.com", data([mom, dad], 2), "t1", "t2");
    const stale = await saveHousehold(store, "ana@gmail.com", data([mom, dad], 1), "t1", "t3");
    expect(stale.ok).toBe(false);
    expect((await loadHousehold(store, "ana@gmail.com"))?.data.expenses.length).toBe(2);
  });
  it("cannot pull an e-mail that already belongs to another family, and removing a parent revokes access", async () => {
    const store = memoryStore();
    await saveHousehold(store, "eve@gmail.com", data([{ ...mom, id: "e", email: "eve@gmail.com" }], 5), null, "t1");
    const r = await saveHousehold(store, "ana@gmail.com", data([mom, { ...dad, email: "eve@gmail.com" }], 1), null, "t2");
    expect(r.ok && r.taken).toEqual(["eve@gmail.com"]);
    expect((await loadHousehold(store, "eve@gmail.com"))?.data.expenses.length).toBe(5);
    const s = await saveHousehold(store, "ana@gmail.com", data([mom, dad], 1), "t2", "t3");
    expect(s.ok).toBe(true);
    await saveHousehold(store, "ana@gmail.com", data([mom], 1), "t3", "t4");
    expect(await loadHousehold(store, "marco@gmail.com")).toBeNull();
  });
});

describe("Google sign-in token", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as { n: string; e: string; kty: string }), kid: "k1" };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const make = (claims: Record<string, unknown>, key = privateKey, alg = "RS256") => {
    const head = `${b64({ alg, kid: "k1", typ: "JWT" })}.${b64(claims)}`;
    return `${head}.${crypto.sign("RSA-SHA256", Buffer.from(head), key).toString("base64url")}`;
  };
  const now = 1_800_000_000_000;
  const good = { iss: "https://accounts.google.com", aud: "client-1", exp: now / 1000 + 600, email: "Ana@Gmail.com", email_verified: true, name: "Ana", sub: "1" };
  it("accepts a valid token and lower-cases the e-mail", async () => {
    expect(await verifyGoogleIdToken(make(good), "client-1", [jwk], now)).toEqual({ email: "ana@gmail.com", name: "Ana", sub: "1" });
  });
  it("rejects wrong audience, issuer, expiry, unverified e-mail, bad signature and alg tricks", async () => {
    const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    for (const t of [
      make({ ...good, aud: "someone-else" }),
      make({ ...good, iss: "https://evil.example" }),
      make({ ...good, exp: now / 1000 - 1 }),
      make({ ...good, email_verified: false }),
      make(good, other),
      make(good, privateKey, "none"),
      "garbage",
    ]) expect(await verifyGoogleIdToken(t, "client-1", [jwk], now)).toBeNull();
    expect(await verifyGoogleIdToken(make(good), "", [jwk], now)).toBeNull();
  });
});

describe("card digits through OCR noise", () => {
  it("still finds the last four", () => {
    expect(cardLast4("VISA *x%*4417")).toBe("4417");
    expect(cardLast4("ACCOUNT #  **** **** **** 4417")).toBe("4417");
    expect(cardLast4("VISA TEND     86.00")).toBeUndefined();
    expect(cardLast4("Family account statement - Rivera, Mia   Printed 11/14/2026")).toBeUndefined();
  });
});
