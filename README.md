# BabyTab

Kid-spending tracker + US childcare tax tool (credit vs. Dependent Care FSA, tax year 2026).

## What's in v2

- **Four tabs** in a left rail: Scan, Spending, Tax, Profile. Pink palette taken from the design sketch only.
- **Receipt scanner**: camera or photo/PDF/text file. Without keys the photo is read in the browser (Tesseract.js, assets self-hosted in `/public/ocr`, nothing uploaded) and parsed by the rules parser. With `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` a vision model reads the photo via `/api/scan`.
- **Scan safety net**: the app (not the model) adds up the items and compares them with the subtotal/total printed on the receipt; on a mismatch it warns and prices are editable before saving.
- **Manual entry**: amount, date, payee, category, child.
- **Spending**: totals, month chart, categories, cheaper-elsewhere, repeat buys, editable expense list.
- **Tax**: best move, side-by-side numbers, gaps by dollars, plan-year timeline with time travel, providers, Tax Pack behind the paywall (Stripe test mode).
- **Mom / Dad**: Profile holds both parents (name, Gmail, cards and payment methods). Every expense gets a payer by rule: printed cardholder name → card last-4 → payment method → the parent on this device. The AI only copies printed card digits and names; it never decides who paid. Spending shows a "Who pays" split and each expense's payer is editable.
- **One family, two Gmail accounts**: with `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + Upstash Redis (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) + `ENTITLEMENT_SECRET`, each parent signs in with Google and both open the same household (`/api/auth`, `/api/household`). Without these the app stays local to the browser and the parent is picked with a "This device" switch.
- Removed from the UI: review step, Pub 503 ledger table, FSA curve chart, medical lane block.

## Run it

```bash
npm install
npm test          # 42 tests: engine, parser, payer rules, shared household, Google token checks
npm run dev       # http://localhost:3000
```

### Deploy (Vercel)

1. Push this repo to GitHub → Vercel → New Project → import → Deploy (no config needed).
2. Optional env vars (Project → Settings → Environment Variables), see `.env.example`:
   - `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`) or `OPENAI_API_KEY` (+ `OPENAI_MODEL`) for AI extraction/explanations.
   - `STRIPE_SECRET_KEY=sk_test_…` for real Stripe Checkout in test mode; `ENTITLEMENT_SECRET` for signing the Pro token.

## Project map

```
app/page.tsx                 shell, tabs + state (localStorage)
app/api/scan                 photo → lines with a vision model (optional)
components/ScanTab.tsx       camera, OCR progress, found items, manual form
components/AnalyticsTab.tsx  spending numbers and charts
components/TaxTab.tsx        credit vs FSA, gaps, plan year, providers
components/ProfileTab.tsx    household, kids, budget
lib/scan.ts                  in-browser OCR (Tesseract), PDF text, AI fallback order
scripts/copy-assets.mjs      copies OCR/PDF assets to public/ocr on install/build
app/api/extract              LLM extraction (redacted input, no logging)
app/api/explain              LLM explanation + server-side number-lint
app/api/checkout             Stripe Checkout session (test keys only)
app/api/entitlement          verify session → HMAC-signed Pro token; demo test-card path
lib/parse.ts                 regex extractor + redaction
lib/classify.ts, rules/      rule table by tax year
lib/ingest.ts                expenses, providers, duplicates
lib/engine.ts                R1–R11, optimizer, medical lane, gaps, audit trail
lib/project.ts               plan-year projection, timeline, .ics
lib/spending.ts              kid-spending analytics
lib/explain.ts               facts payload, number-lint, template explanation
public/sample/               synthetic US sample files
tests/engine.test.ts         Vitest
```

## Limits (honest)

Federal only (no state taxes); standard deduction assumed; FICA assumed on FSA dollars (wages below the SS wage base); no grace period / carryover; household-employer (Schedule H) is a flag, not a payroll calculation. BabyTab is an information and records tool, not tax advice, and files nothing.
