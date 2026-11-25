import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/shell";

export const metadata: Metadata = { title: "Venues" };

export default function VenuesPage() {
  return (
    <PagePlaceholder
      description="Venue availability and routing surfaces will live here."
      eyebrow="Venues"
      title="Venues"
    />
  );
}
