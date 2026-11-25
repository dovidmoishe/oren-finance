import type { Metadata } from "next";
import { TradingCalendar } from "@/components/calendar";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <div className="mx-auto max-w-[1540px] pb-20">
      <TradingCalendar />
    </div>
  );
}
