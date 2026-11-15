"use client";
/**
 * Receipt scanner. Photo / camera frame / PDF / text file → RawLine[].
 * 1. If a vision model is configured on the server, it reads the photo.
 * 2. Otherwise (or if it fails) the photo is read in the browser with Tesseract (no upload)
 *    and the text goes through the same deterministic parser as every other document.
 */
import { extractRegex, parseDate } from "./parse";
import type { Child, RawLine } from "./types";
import { fnv1a } from "./util";

export interface ScanResult {
  lines: RawLine[];
  engine: "ai" | "ocr" | "text";
  text?: string;
  /** Subtotal (or total) printed on the receipt, used to double-check the items we read. */
  printed?: number;
}

/** Printed subtotal/total from receipt text, for a sum check against the extracted items. */
export function printedTotals(text: string): { subtotal?: number; total?: number } {
  const out: { subtotal?: number; total?: number } = {};
  for (const l of text.split(/\r?\n/)) {
    const m = l.trim().match(/^(sub\s?-?total|total)\b.*?(\d[\d,]*\.\d{2})\s*$/i);
    if (!m) continue;
    const v = Number(m[2].replace(/,/g, ""));
    if (/^sub/i.test(m[1])) out.subtotal ??= v;
    else out.total ??= v;
  }
  return out;
}

/** The printed figure the items should add up to: subtotal if shown, else total. Undefined when the items already match either. */
export function expectedSum(text: string, lines: RawLine[]): number | undefined {
  const { subtotal, total } = printedTotals(normalizeReceiptText(text));
  const sum = lines.reduce((a, l) => a + l.amount, 0);
  const near = (v?: number) => v !== undefined && Math.abs(v - sum) < 0.015;
  if (near(subtotal) || near(total)) return undefined;
  return subtotal ?? total;
}
type Progress = (stage: string, pct: number) => void;

const todayISO = () => new Date().toISOString().slice(0, 10);

/** OCR noise → parser-friendly text; guarantees a date so lines are never dropped. */
export function normalizeReceiptText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/[|]/g, " ")
        // "HUGGIES LS 4   003600051470 F   26.97 X" → drop the UPC and the tax flag next to it
        .replace(/\s+\d{9,14}(\s+[A-Z])?(?=\s)/, " ")
        .replace(/(\d)\s*[,.]\s*(\d{2})\s*[A-Za-z]{0,2}\s*$/, "$1.$2") // "46,99 T" → "46.99"
        .replace(/\$\s+(\d)/g, "$$$1")
        .replace(/\s+$/, "")
    )
    .filter((l) => l.trim());
  if (!lines.length) return "";
  if (!lines.some((l) => parseDate(l))) {
    const [y, m, d] = todayISO().split("-");
    lines.splice(1, 0, `${m}/${d}/${y}`);
  }
  return lines.join("\n");
}

export function parseReceiptText(name: string, text: string, children: Child[]): RawLine[] {
  const clean = normalizeReceiptText(text);
  if (!clean) return [];
  // OCR often reads a leading capital as lowercase ("pampers"): restore it.
  const cap = (t: string) => t.replace(/^[a-z]/, (c) => c.toUpperCase());
  return extractRegex([{ name, text: clean }], children).map((l) => ({ ...l, merchant: cap(l.merchant), description: cap(l.description) }));
}

/** Draw any image source on a canvas, scaled for OCR. */
export function toCanvas(src: CanvasImageSource, w: number, h: number, max = 2000): HTMLCanvasElement {
  const longest = Math.max(w, h) || 1;
  const scale = longest > max ? max / longest : longest < 1100 ? Math.min(2, 1100 / longest) : 1;
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((ok, bad) => {
      img.onload = () => ok();
      img.onerror = () => bad(new Error("image"));
      img.src = url;
    });
    return toCanvas(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function ocr(canvas: HTMLCanvasElement, onProgress?: Progress): Promise<string> {
  // High-contrast grayscale copy reads better than the raw photo.
  const g = document.createElement("canvas");
  g.width = canvas.width;
  g.height = canvas.height;
  const ctx = g.getContext("2d")!;
  ctx.filter = "grayscale(1) contrast(1.35)";
  ctx.drawImage(canvas, 0, 0);
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr",
    langPath: "/ocr",
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.("Reading", 0.2 + m.progress * 0.8);
      else onProgress?.("Loading", 0.1);
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(g);
    return data.text ?? "";
  } finally {
    await worker.terminate();
  }
}

async function viaAi(canvas: HTMLCanvasElement, name: string): Promise<{ lines: RawLine[]; printed?: number } | null> {
  try {
    const small = toCanvas(canvas, canvas.width, canvas.height, 1600);
    const r = await fetch("/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: small.toDataURL("image/jpeg", 0.85) }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.unavailable || !Array.isArray(j.lines) || !j.lines.length) return null;
    const date = typeof j.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : todayISO();
    const merchant = String(j.merchant || "Receipt");
    const hash = fnv1a(JSON.stringify(j.lines));
    const lines = (j.lines as Record<string, unknown>[])
      .map((l) => ({
        date,
        merchant,
        description: String(l.description ?? ""),
        amount: Number(l.amount),
        unitCount: typeof l.unit_count === "number" ? l.unit_count : undefined,
        categoryHint: (l.category_hint as string) || undefined,
        payMethod: "card",
        cardLast4: /^\d{4}$/.test(String(j.card_last4 ?? "")) ? String(j.card_last4) : undefined,
        payerHint: typeof j.payer_name === "string" && j.payer_name ? j.payer_name : undefined,
        source: name,
        sourceHash: hash,
      }))
      .filter((l) => l.description && isFinite(l.amount) && l.amount !== 0);
    if (!lines.length) return null;
    // The model reports the printed subtotal/total separately; the app (not the model) does the sum check.
    const sum = lines.reduce((a, l) => a + l.amount, 0);
    const shown = [j.subtotal, j.total].filter((v): v is number => typeof v === "number" && isFinite(v));
    const printed = shown.length && !shown.some((v) => Math.abs(v - sum) < 0.015) ? shown[0] : undefined;
    return { lines, printed };
  } catch {
    return null;
  }
}

export async function scanCanvas(canvas: HTMLCanvasElement, children: Child[], onProgress?: Progress, name = `scan_${Date.now()}.jpg`): Promise<ScanResult> {
  onProgress?.("Reading", 0.05);
  const ai = await viaAi(canvas, name);
  if (ai) return { lines: ai.lines, engine: "ai", printed: ai.printed };
  const text = await ocr(canvas, onProgress);
  const lines = parseReceiptText(name, text, children);
  return { lines, engine: "ocr", text, printed: expectedSum(text, lines) };
}

async function pdfToTextOrCanvas(file: File): Promise<{ text: string; canvas?: HTMLCanvasElement }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/ocr/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 6); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      rows.set(y, [...(rows.get(y) ?? []), { x: it.transform[4], s: it.str }]);
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => out.push(items.sort((a, b) => a.x - b.x).map((i) => i.s).join("  ")));
  }
  const text = out.join("\n");
  if (text.replace(/\s/g, "").length > 20) return { text };
  // Scanned PDF: render page 1 and OCR it.
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
  return { text: "", canvas };
}

export async function scanFile(file: File, children: Child[], onProgress?: Progress): Promise<ScanResult & { preview?: string }> {
  const name = file.name || `scan_${Date.now()}`;
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(name);
  const isText = file.type.startsWith("text/") || /\.(txt|csv)$/i.test(name);
  if (isText) {
    const text = await file.text();
    const lines = /\.csv$/i.test(name) ? extractRegex([{ name, text }], children) : parseReceiptText(name, text, children);
    return { lines, engine: "text", text, printed: expectedSum(text, lines) };
  }
  if (isPdf) {
    onProgress?.("Reading", 0.1);
    const { text, canvas } = await pdfToTextOrCanvas(file);
    if (!canvas) {
      const lines = parseReceiptText(name, text, children);
      return { lines, engine: "text", text, printed: expectedSum(text, lines) };
    }
    return { ...(await scanCanvas(canvas, children, onProgress, name)), preview: canvas.toDataURL("image/jpeg", 0.7) };
  }
  const canvas = await fileToCanvas(file);
  return { ...(await scanCanvas(canvas, children, onProgress, name)), preview: canvas.toDataURL("image/jpeg", 0.7) };
}
