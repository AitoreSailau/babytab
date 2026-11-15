/** Server-only LLM helper. Anthropic first, OpenAI second, else null (caller falls back). */
export interface LlmImage { mediaType: string; base64: string }
export interface LlmOpts { system: string; user: string; json?: boolean; maxTokens?: number; timeoutMs?: number; image?: LlmImage }

export function llmConfigured(): "anthropic" | "openai" | null {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

export async function callLlm(o: LlmOpts): Promise<{ text: string; provider: string; model: string } | null> {
  const p = llmConfigured();
  if (!p) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 20000);
  try {
    if (p === "anthropic") {
      const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: o.maxTokens ?? 2000, temperature: 0, system: o.system, messages: [{
          role: "user",
          content: o.image
            ? [{ type: "image", source: { type: "base64", media_type: o.image.mediaType, data: o.image.base64 } }, { type: "text", text: o.user }]
            : o.user,
        }] }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      const text = (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
      return { text, provider: "anthropic", model };
    }
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: o.maxTokens ?? 2000,
        ...(o.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: o.system },
          {
            role: "user",
            content: o.image
              ? [{ type: "text", text: o.user }, { type: "image_url", image_url: { url: `data:${o.image.mediaType};base64,${o.image.base64}` } }]
              : o.user,
          },
        ],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return { text: j.choices?.[0]?.message?.content ?? "", provider: "openai", model };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function extractJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
