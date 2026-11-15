import fs from "fs";
import path from "path";
import { extractRegex, type InputFile } from "@/lib/parse";
import { ingest } from "@/lib/ingest";
import type { AppData } from "@/lib/pipeline";
import type { Child, Household } from "@/lib/types";

const dir = path.resolve(__dirname, "../public/sample");
export const sampleMeta = JSON.parse(fs.readFileSync(path.join(dir, "household.json"), "utf8"));

export function readSample(name: string): InputFile {
  return { name, text: fs.readFileSync(path.join(dir, name), "utf8") };
}

export function sampleData(withLeo = false, overrides: Partial<Household> = {}): AppData {
  const children: Child[] = [...sampleMeta.children, ...(withLeo ? [sampleMeta.optionalChild] : [])];
  const files: InputFile[] = [...sampleMeta.files, ...(withLeo ? sampleMeta.optionalChildFiles : [])].map(readSample);
  const household: Household = { ...sampleMeta.household, ...overrides };
  const raw = extractRegex(files, children);
  const { expenses, providers } = ingest(raw, children, household.taxYear);
  return { household, children, providers, expenses, asOf: sampleMeta.asOf };
}
