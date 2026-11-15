/**
 * Server-only key-value store for shared households.
 * Production: Upstash Redis REST (Vercel Marketplace → Upstash; env KV_REST_API_URL/KV_REST_API_TOKEN
 * or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN). Local dev: in-memory when BABYTAB_DEV_STORE=1.
 */
export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export function memoryStore(map = new Map<string, string>()): Store {
  return {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
    del: async (k) => void map.delete(k),
  };
}

const g = globalThis as unknown as { __babytabStore?: Store };

export function getStore(): Store | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const cmd = async (args: string[]) => {
      const r = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args), cache: "no-store" });
      if (!r.ok) throw new Error(`store ${r.status}`);
      return ((await r.json()) as { result: string | null }).result;
    };
    return { get: (k) => cmd(["GET", k]), set: async (k, v) => void (await cmd(["SET", k, v])), del: async (k) => void (await cmd(["DEL", k])) };
  }
  if (process.env.BABYTAB_DEV_STORE === "1") return (g.__babytabStore ??= memoryStore());
  return null;
}
