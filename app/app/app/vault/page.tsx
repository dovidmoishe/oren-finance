import type { Metadata } from "next";
import { VaultDashboard } from "@/components/vault";

export const metadata: Metadata = { title: "Vault" };

export default function VaultPage() {
  return (
    <div className="mx-auto max-w-[1540px] pb-20">
      <VaultDashboard />
    </div>
  );
}
