"use client";

import { Button } from "@/components/ui";
import { useT } from "@/i18n/i18n";
import { useOrenAuth, type OrenAuth } from "./auth-context";

export function restoreBlocked(auth: Pick<OrenAuth, "restoreError" | "restoreTimedOut">) {
  return Boolean(auth.restoreError || auth.restoreTimedOut);
}

export function RestoreActions({
  signInLabel,
  size = "md",
}: {
  signInLabel: string;
  size?: "sm" | "md";
}) {
  const auth = useOrenAuth();
  const t = useT();
  return (
    <div className={size === "sm" ? "flex items-center gap-2" : "flex flex-wrap items-center justify-center gap-2"}>
      <Button onClick={() => window.location.reload()} size={size} type="button" variant="secondary">
        {t("auth.reload")}
      </Button>
      <Button onClick={auth.open} size={size} type="button">
        {signInLabel}
      </Button>
    </div>
  );
}
