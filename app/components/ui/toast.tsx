"use client";

import {
  CircleX as CircleXIcon,
  CircleCheck as CircleCheckIcon,
  Info as InfoIcon,
  type LucideIcon,
} from "lucide-react";
import { InterfaceIcon } from "@/components/ui/interface-icon";

import { cn } from "./utils";

type ToastTone = "info" | "success" | "error";

const icons: Record<ToastTone, LucideIcon> = {
  info: InfoIcon,
  success: CircleCheckIcon,
  error: CircleXIcon,
};

const tones: Record<ToastTone, string> = {
  info: "border-border bg-panel text-foreground",
  success: "border-success-border bg-success-surface text-success",
  error: "border-error-border bg-error-surface text-error",
};

export function Toast({
  title,
  description,
  tone = "info",
}: {
  title: string;
  description?: string;
  tone?: ToastTone;
}) {
  return (
    <div className={cn("rounded-lg border p-4 text-sm shadow-sm", tones[tone])}>
      <div className="flex gap-3">
        <InterfaceIcon className="mt-0.5 shrink-0" color="currentColor" icon={icons[tone]} size={16} strokeWidth={1.8} />
        <div>
          <p className="font-medium">{title}</p>
          {description ? <p className="mt-1 opacity-75">{description}</p> : null}
        </div>
      </div>
    </div>
  );
}
