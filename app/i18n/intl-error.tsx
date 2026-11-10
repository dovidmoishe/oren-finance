"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { getMessageFallback, onIntlError } from "./intl-policy";

// onError and getMessageFallback are functions, so the server provider cannot
// pass them through. This nested provider adds the same policy on the client.
export function IntlErrorProvider({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider onError={onIntlError} getMessageFallback={getMessageFallback}>
      {children}
    </NextIntlClientProvider>
  );
}
