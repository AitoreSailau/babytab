export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round0 = (n: number) => Math.round(n);

export function money(n: number, cents = false): string {
  const v = cents ? round2(n) : round0(n);
  const s = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  return (v < 0 ? "-$" : "$") + s;
}

export const pctStr = (p: number) => `${Math.round(p * 100)}%`;

export function parseISO(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, day || 1));
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Date a child turns `age` (YYYY-MM-DD). */
export function birthdayAt(birthDate: string, age: number): string {
  const y = Number(birthDate.slice(0, 4)) + age;
  return `${y}${birthDate.slice(4)}`;
}

/** Simple non-cryptographic hash for audit trail source fingerprints (FNV-1a). */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

let _id = 0;
export function uid(prefix = "id"): string {
  _id += 1;
  return `${prefix}_${Date.now().toString(36)}_${_id.toString(36)}`;
}

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
