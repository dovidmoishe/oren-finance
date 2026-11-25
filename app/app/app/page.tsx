import type { Metadata } from "next";
import { PortfolioDashboard } from "@/components/portfolio";

export const metadata: Metadata = { title: "Portfolio" };

export default function AppHome() {
  return <PortfolioDashboard />;
}
