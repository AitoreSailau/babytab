/**
 * Deterministic extractor (regex fallback). Turns pasted receipts, provider
 * invoices/statements, Zelle/Venmo history and CSV exports into RawLine[].
 * The LLM route produces the same RawLine shape; this parser is used when the
 * LLM is unavailable and is the one exercised by the test suite.
 */
import type { Child, RawLine } from "./types";
import { fnv1a } from "./util";

export interface InputFile {
  name: string;
  text: string;
}

const AMOUNT_END = /(\(?-?\s?\$?\s?-?[\d,]*\d\.\d{2}\)?)\s*$/;
const DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/;
const DATE_RE_G = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/g;
const SKIP_LINE = /^(sub\s?total|subtotal|total|tax|sales tax|order total|total due|balance|change|amount due|tip|grand total|payment received|visa|mastercard|amex|discover)\b/i;
const SEPARATOR = /^\s*(-{3,}|={3,}|_{3,}|\*{3,})\s*$/;

export function parseDate(s: string): string | undefined {
  const m = s.match(DATE_RE);
  if (!m) return undefined;
  if (m[4]) return `${m[4]}-${m[5]}-${m[6]}`;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const mm = String(Number(m[1])).padStart(2, "0");
  const dd = String(Number(m[2])).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function allDates(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(DATE_RE_G)) {
    const d = parseDate(m[0]);
    if (d) out.push(d);
  }
  return out;
}

export function parseAmount(s: string): number | undefined {
  const neg = /\(.*\)/.test(s) || /-/.test(s);
  const n = Number(s.replace(/[^\d.]/g, ""));
  if (!isFinite(n) || s.replace(/[^\d]/g, "") === "") return undefined;
  return neg ? -n : n;
}

function cleanMerchant(header: string): string {
  return header
    .split(/\s{2,}|\t/)[0]
    .replace(/#\s*\d+.*/, "")
    .replace(/\b(T-\d+|store \d+)\b.*/i, "")
    .trim();
}

function unitCount(desc: string): number | undefined {
  const m = desc.match(/\b(\d{2,4})\s*(ct|count)\b/i);
  return m ? Number(m[1]) : undefined;
}

function payMethodOf(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/\bzelle\b/.test(t)) return "zelle";
  if (/\bvenmo\b/.test(t)) return "venmo";
  if (/\bcash\b/.test(t)) return "cash";
  if (/\bach\b|checking/.test(t)) return "ach";
  if (/\bcheck\b|chk\s?#/.test(t)) return "check";
  if (/visa|mastercard|\bmc\b|amex|discover|card|\*{4}\d{4}/.test(t)) return "card";
  return undefined;
}

/** Last 4 digits of the card a document was paid with ("VISA ****4417", "card ending in 4417", "VISA 4417"). */
export function cardLast4(text: string): string | undefined {
  // tolerant of OCR noise between the brand / mask and the digits ("VISA *x%*4417", "ACCOUNT # **** **** **** 4417")
  const m = text.match(/(?:\*{2,}|x{3,}|ending in|visa|master ?card|amex|discover|debit|credit|card|acct|account\s*#)[^\n\d]{0,16}(\d{4})(?![\d.,\/-])/i);
  return m ? m[1] : undefined;
}
/** A person named on the document as the one who paid. */
export function payerHint(text: string): string | undefined {
  const m = text.match(/\b(?:account holder|card ?holder|paid by|payer|member)\s*[:\-]\s*([A-Za-z][A-Za-z.' -]{1,40})/i);
  return m ? m[1].trim().split(/\s{2,}/)[0] : undefined;
}

function childIn(text: string, children: Child[]): string | undefined {
  for (const c of children) {
    const first = c.name.split(/\s+/)[0];
    if (first && new RegExp(`\\b${first}\\b`, "i").test(text)) return c.name;
  }
  return undefined;
}

/** "Zelle to ROSA MARTINEZ   memo: ..." → "ROSA MARTINEZ" */
function payeeFrom(desc: string): string | undefined {
  const m =
    desc.match(/\b(?:zelle|venmo|paypal|cash app)\s+(?:payment\s+)?to\s+(.+?)(?:\s{2,}|\s+memo:|\s+"|$)/i) ||
    desc.match(/^cash\s*[-–:]\s*([a-z]+(?:\s+[a-z.]+)?)/i);
  return m ? m[1].trim().replace(/[.,]$/, "") : undefined;
}

function csvSplit(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(file: InputFile, children: Child[]): RawLine[] {
  const lines = file.text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = csvSplit(lines[0]).map((h) => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = col("date");
  const iPayee = col("payee", "merchant", "name");
  const iDesc = col("description", "memo", "details");
  const iAmt = col("amount", "debit");
  const iMethod = col("card", "method", "account");
  const iCat = col("category");
  const iChild = col("child");
  if (iDate < 0 || iAmt < 0) return [];
  const hash = fnv1a(file.text);
  const rows: RawLine[] = [];
  for (const l of lines.slice(1)) {
    const c = csvSplit(l);
    const date = parseDate(c[iDate] || "");
    const amount = parseAmount(c[iAmt] || "");
    if (!date || amount === undefined) continue;
    const payeeCol = iPayee >= 0 && iPayee !== iDesc ? c[iPayee] : "";
    const desc = (iDesc >= 0 ? c[iDesc] : "") || payeeCol;
    const payee = payeeCol || payeeFrom(desc);
    const merchant = payee || desc.replace(/\b(ach|pmt|payment|pos|debit)\b.*$/i, "").split(/\s+/).slice(0, 4).join(" ");
    rows.push({
      date,
      merchant: titleCase(merchant),
      description: desc,
      amount,
      payMethod: payMethodOf(`${desc} ${iMethod >= 0 ? c[iMethod] : ""}`),
      childName: (iChild >= 0 && c[iChild]) || childIn(`${desc} ${payeeCol}`, children),
      cardLast4: iMethod >= 0 ? cardLast4(c[iMethod] || "") ?? (c[iMethod] || "").match(/\b(\d{4})\b/)?.[1] : undefined,
      source: file.name,
      sourceHash: hash,
    });
  }
  return flipIfOutflows(rows);
}

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s.trim();
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Elc|Ymca|Cvs|Ach|Rx|Llc|Inc)\b/g, (m) => (m === "Llc" || m === "Inc" ? m : m.toUpperCase()))
    .replace(/\.Com\b/g, ".com")
    .replace(/\bSt\. Mark'S\b/g, "St. Mark's")
    .replace(/'S\b/g, "'s")
    .trim();
}

/** Bank-style exports show spending as negative numbers; flip so spend is positive. */
function flipIfOutflows(rows: RawLine[]): RawLine[] {
  const neg = rows.filter((r) => r.amount < 0).length;
  if (rows.length && neg > rows.length / 2) return rows.map((r) => ({ ...r, amount: -r.amount }));
  return rows;
}

function parseDoc(doc: string, file: InputFile, children: Child[]): RawLine[] {
  const lines = doc.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
  if (!lines.length) return [];
  const hash = fnv1a(doc);
  const header = lines[0];
  const docMerchant = titleCase(cleanMerchant(header));
  const tinPresent = /\b(EIN|TIN|FEIN|SSN)\b[:#\s]*\d/i.test(doc) || /tax[- ]exempt/i.test(doc);
  const docChild = childIn(doc, children);
  const paidLine = lines.find((l) => /^\s*paid\b/i.test(l) && DATE_RE.test(l));
  const paidDate = paidLine ? parseDate(paidLine) : undefined;
  const svcLine = lines.find((l) => /service period/i.test(l) && DATE_RE.test(l) && !AMOUNT_END.test(l));
  const svc = svcLine ? allDates(svcLine) : [];
  const firstDate = lines.map((l) => (AMOUNT_END.test(l) && /^\s*\d/.test(l) ? undefined : parseDate(l))).find(Boolean);
  const docDate = paidDate ?? firstDate;
  const docMethod = payMethodOf(doc);
  const docCard = cardLast4(doc);
  const docPayer = payerHint(doc);

  const out: RawLine[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    const am = line.match(AMOUNT_END);
    if (!am) continue;
    let body = line.slice(0, am.index).trim();
    if (!body || SKIP_LINE.test(body)) continue;
    const amount = parseAmount(am[1]);
    if (amount === undefined || amount === 0) continue;

    let date = docDate;
    let serviceFrom: string | undefined = svc[0];
    let serviceTo: string | undefined = svc[1] ?? svc[0];
    const lead = body.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\s+/);
    if (lead) {
      date = parseDate(lead[1]);
      body = body.slice(lead[0].length);
      const range = body.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\s+/);
      if (range) {
        serviceFrom = parseDate(range[1]);
        serviceTo = parseDate(range[2]);
        body = body.slice(range[0].length);
      } else {
        serviceFrom = undefined;
        serviceTo = undefined;
      }
    }
    if (!date) continue;
    const desc = body.replace(/\s{2,}/g, "  ").trim();
    const payee = payeeFrom(desc);
    const memo = desc.match(/memo:\s*(.+)$/i)?.[1] ?? desc.match(/"([^"]+)"/)?.[1];
    out.push({
      date,
      merchant: payee ? titleCase(payee) : docMerchant,
      description: memo ? memo.trim() : desc,
      amount,
      serviceFrom,
      serviceTo,
      payMethod: payMethodOf(`${desc} ${lead ? header : ""}`) ?? docMethod,
      childName: childIn(desc, children) ?? docChild,
      tinPresent,
      unitCount: unitCount(desc),
      cardLast4: docCard,
      payerHint: docPayer,
      source: file.name,
      sourceHash: hash,
    });
  }
  return flipIfOutflows(out);
}

export function looksLikeCsv(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return /date/i.test(first) && /amount|debit/i.test(first) && first.split(",").length >= 3;
}

/** Split a pasted blob into documents (receipts / invoices / statements). */
export function splitDocs(text: string): string[] {
  const docs: string[] = [];
  let cur: string[] = [];
  for (const l of text.split(/\r?\n/)) {
    if (SEPARATOR.test(l)) {
      if (cur.join("").trim()) docs.push(cur.join("\n"));
      cur = [];
    } else cur.push(l);
  }
  if (cur.join("").trim()) docs.push(cur.join("\n"));
  return docs;
}

export function extractRegex(files: InputFile[], children: Child[]): RawLine[] {
  const out: RawLine[] = [];
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".csv") || looksLikeCsv(f.text)) {
      out.push(...parseCsv(f, children));
      continue;
    }
    for (const doc of splitDocs(f.text)) out.push(...parseDoc(doc, f, children));
  }
  return out;
}

/** Strip identifiers before any text is sent to an LLM. Presence is recorded locally. */
export function redact(text: string): string {
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]")
    .replace(/\b(EIN|TIN|FEIN)\b[:#\s]*\d{2}-?\d{7}\b/gi, "$1: [ID ON FILE]")
    .replace(/\b\d{2}-\d{7}\b/g, "[ID]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[CARD]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[EMAIL]")
    .replace(/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g, "[PHONE]");
}
