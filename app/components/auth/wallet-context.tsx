"use client";

import { createContext, useContext } from "react";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export type { WalletContextState } from "@solana/wallet-adapter-react";

// Only the adapter's type contract is needed: Privy owns the actual session.
// Importing the adapter barrel at runtime pulls wallet discovery into startup.
export const WalletContext = createContext<WalletContextState | null>(null);

export function useWallet(): WalletContextState {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("Wallet context is unavailable outside AppProviders.");
  return wallet;
}
