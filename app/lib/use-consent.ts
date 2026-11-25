"use client";

import { useSyncExternalStore } from "react";
import { currentConsent, subscribeConsent, type ConsentChoice } from "./consent";

/** "unknown" on the server and during hydration; analytics wait for "granted". */
export type ConsentState = ConsentChoice | "undecided" | "unknown";

const clientState = (): ConsentState => currentConsent() ?? "undecided";
const serverState = (): ConsentState => "unknown";

export function useConsent(): ConsentState {
  return useSyncExternalStore(subscribeConsent, clientState, serverState);
}
