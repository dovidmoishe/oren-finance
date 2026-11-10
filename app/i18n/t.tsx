"use client";

import { useT, type MessageKey, type MessageValues } from "./i18n";

/** Translated text for places that can't call a hook, such as server components. */
export function T({ k, values }: { k: MessageKey; values?: MessageValues }) {
  return <>{useT()(k, values)}</>;
}
