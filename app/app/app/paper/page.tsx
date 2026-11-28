import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaperLab } from "@/components/paper/paper-lab";
import { paperLabEnabled } from "@/lib/paper-lab";

export const metadata: Metadata = { title: "Paper traders" };

/** Preview-only journal for the PR 142 paper trading benchmark. */
export default function PaperTradersPage() {
  if (!paperLabEnabled()) notFound();
  return <PaperLab />;
}
