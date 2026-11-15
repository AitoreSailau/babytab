export const PLANS = {
  monthly: { id: "monthly", label: "Monthly", price: 7.99, cents: 799, interval: "month" as const, blurb: "Cancel anytime" },
  annual: { id: "annual", label: "Yearly", price: 49, cents: 4900, interval: "year" as const, blurb: "Covers open enrollment → Tax Day. Save 49%" },
};
export type PlanId = keyof typeof PLANS;
export const PRO_FEATURES = [
  "Childcare Tax Pack: Form 2441 worksheet, provider list, audit trail (PDF + CSV)",
  "Every gap with its dollar impact, not just the top 3",
  "Calendar reminders: open enrollment, Dec 31, W-10s, W-2 box 10, Tax Day",
  "Plan-year tracking for every child, all year",
];
