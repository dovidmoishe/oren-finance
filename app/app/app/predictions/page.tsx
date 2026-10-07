import { Suspense } from "react";
import { AppShell } from "@/components/shell";
import { PredictionsOverview } from "@/components/predictions/predictions-overview";

export default function PredictionsPage() {
  return (
    <AppShell>
      <Suspense fallback={<p>Loading predictions…</p>}>
        <PredictionsOverview />
      </Suspense>
    </AppShell>
  );
}
