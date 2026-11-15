import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "BabyTab — what your kids cost, and the tax money you're owed back",
  description:
    "Track every kid expense from receipts, invoices and Zelle history. BabyTab tells US parents whether the childcare credit or a Dependent Care FSA pays more and keeps audit-ready records.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
