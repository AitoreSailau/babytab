export type FilingStatus = "single" | "mfj" | "hoh" | "mfs";
export type Lane = "care" | "medical" | "excluded" | "none";
export type Status = "PASS" | "WARN" | "FAIL" | "INFO";
export type TinStatus = "have" | "requested" | "refused" | "tax_exempt" | "none";
export type ProviderType =
  | "center" | "home" | "nanny" | "after_school" | "day_camp" | "overnight"
  | "school" | "relative" | "other_parent" | "spouse" | "other";

export interface Household {
  taxYear: number;
  filingStatus: FilingStatus;
  agi: number;               // AGI before any Dependent Care FSA exclusion
  earnedYou: number;
  earnedSpouse: number;      // ignored unless mfj
  dcfsaElected: number;      // current plan-year election
  dcfsaPlanCap: number;      // employer plan cap (ask HR)
  dcfsaAvailable: boolean;   // employer offers a DCFSA
  hasHsaOrHealthFsa: boolean;
  monthlyBudget: number;     // kid-spending budget per month (retention meter)
}

export interface Parent {
  id: string;
  name: string;
  role: "mom" | "dad";
  email: string;           // Google account that can open this household
  pays: string[];          // how this parent pays: card last-4 ("4417") or method ("venmo", "zelle", "checking", "cash")
}

export interface Child {
  id: string;
  name: string;
  birthDate: string; // YYYY-MM-DD
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  tinStatus: TinStatus;
  w10OnFile: boolean;
}

export interface RawLine {
  date: string;            // date paid, YYYY-MM-DD
  merchant: string;
  description: string;
  amount: number;          // positive = spend, negative = refund
  serviceFrom?: string;
  serviceTo?: string;
  payMethod?: string;
  childName?: string;
  tinPresent?: boolean;
  unitCount?: number;      // e.g. 150 ct diapers
  categoryHint?: string;   // LLM hint only, never a decision
  cardLast4?: string;      // last 4 digits printed on the receipt / card column
  payerHint?: string;      // a name printed as cardholder / account holder / "paid by"
  source: string;          // file name / "manual"
  sourceHash?: string;
}

export interface Expense extends RawLine {
  id: string;
  category: string;
  lane: Lane;
  childIds: string[];
  providerId?: string;
  reimbursed: number;      // amount already reimbursed by DCFSA / employer / state
  flags: string[];
  included: boolean;       // user confirm toggle
  confirmedAt?: string;
  payerId?: string;        // which parent paid (Parent.id)
  projected?: boolean;     // created by the plan-year projector, not a real payment
}

export interface Check {
  rule: string;
  status: Status;
  note: string;
}

export interface LedgerRow {
  expense: Expense;
  status: Status;
  checks: Check[];
  eligibleAmount: number;
}

export interface AuditEntry {
  rule_id: string;
  pub_section: string;
  tax_year: number;
  inputs: Record<string, unknown>;
  decision: string;
  source_hash?: string;
  user_confirmed_at?: string;
}

export interface Gap {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  dollarImpact: number;
  rule: string;
  due?: string;
}

export interface Scenario {
  label: string;
  x: number;
  fsaSavings: number;
  credit: number;
  forfeit: number;
  total: number;
  pct: number;
  base: number;
}

export interface TaxResult {
  taxYear: number;
  qualifyingCount: number;
  limit: number;
  eligibleActual: number;
  eligibleProjected: number;
  reimbursed: number;
  xMax: number;
  curve: Scenario[];
  creditOnly: Scenario;
  elected: Scenario;
  best: Scenario;
  recommendation: "credit" | "fsa" | "split";
  advantage: number;
  marginalRate: number;
  taxBeforeCredits: number;
  ledger: LedgerRow[];
  medical: {
    hsaEligible: number;
    pub502Includible: number;
    floor: number;
    itemizeHelps: boolean;
    hsaSavingsEstimate: number;
  };
  gaps: Gap[];
  audit: AuditEntry[];
  assumptions: string[];
}
