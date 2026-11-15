const base = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden {...base} strokeWidth={2.6}>
      <circle cx="11" cy="21" r="6.5" />
      <path d="M15.5 16.5l5-5" />
      <path d="M17 7.5l7.5 7.5" strokeWidth={4.2} />
      <circle cx="24.5" cy="7.5" r="3.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function IconScan() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden {...base}>
      <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
      <rect x="7" y="7" width="4" height="4" rx="1" /><rect x="13" y="7" width="4" height="4" rx="1" /><rect x="7" y="13" width="4" height="4" rx="1" />
      <path d="M13.5 13.5h3.5v3.5" />
    </svg>
  );
}
export function IconChart() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden {...base}>
      <path d="M4 20v-5M9 20v-8M14 20V9" strokeWidth={2.6} /><circle cx="18" cy="6" r="3" /><path d="M20.2 8.2L22 10" />
    </svg>
  );
}
export function IconTax() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden {...base} strokeWidth={1.8}>
      <path d="M6 9V3h9l3 3v3" /><rect x="2.5" y="9" width="19" height="9" rx="1.5" /><path d="M6 18v3h12v-3" />
      <path d="M5.5 11.5h3M7 11.5v4M10.2 15.5l1.5-4 1.5 4M10.7 14.3h2M15.2 11.5l3 4M18.2 11.5l-3 4" strokeWidth={1.5} />
    </svg>
  );
}
export function IconUser() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden {...base}>
      <circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0z" />
    </svg>
  );
}
export function IconCamera({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...base} strokeWidth={1.6}>
      <path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
