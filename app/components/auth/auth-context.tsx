"use client";

import { createContext, useContext } from "react";
import type { TradeAuthorization } from "@/services/approval-service";

export interface OrenAuth {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  address?: string;
  wallets: { address: string; label: string }[];
  error?: string;
  /** Catalog key set when sign-in could not load after one reload. */
  restoreError?: string;
  /** Privy loaded, but it did not become ready before the restore window. */
  restoreTimedOut?: boolean;
  busy: boolean;
  userId?: string;
  email?: string;
  walletKind?: 'embedded' | 'external';
  walletConnected?: boolean;
  linkEmail: () => void;
  linkWallet: () => void;
  connectWallet: () => void;
  walletPreparing: boolean;
  depositOpen: boolean;
  openDeposit: () => void;
  closeDeposit: () => void;
  open: () => void;
  signOut: () => Promise<void>;
  selectWallet: (address: string) => void;
  createWallet: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  authorizeTrade: (id: string, token: string | null) => Promise<TradeAuthorization>;
  signTradePermission: (wallet: string, message: string) => Promise<string>;
  addTradeSigner: (
    wallet: string,
    signerId: string,
    policyId: string,
  ) => Promise<void>;
  removeTradeSigners: (wallet: string) => Promise<void>;
}

export const AuthContext = createContext<OrenAuth>({
  configured: false,
  ready: true,
  authenticated: false,
  wallets: [],
  linkEmail() {},
  linkWallet() {},
  connectWallet() {},
  busy: false,
  walletPreparing: false,
  depositOpen: false,
  openDeposit() {},
  closeDeposit() {},
  open() {},
  async signOut() {},
  selectWallet() {},
  async createWallet() {},
  async getAccessToken() {
    return null;
  },
  async authorizeTrade() {
    throw new Error("Sign in before approving a trade.");
  },
  async addTradeSigner() {
    throw new Error("Sign in before granting a trade signer.");
  },
  async signTradePermission() {
    throw new Error("Sign in before authorizing chat trading.");
  },
  async removeTradeSigners() {
    throw new Error("Sign in before removing trade signers.");
  },
});
export const useOrenAuth = () => useContext(AuthContext);
