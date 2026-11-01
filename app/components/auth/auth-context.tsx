"use client";

import { createContext, useContext } from "react";

export interface OrenAuth {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  address?: string;
  wallets: { address: string; label: string }[];
  error?: string;
  busy: boolean;
  email?: string;
  walletPreparing: boolean;
  depositOpen: boolean;
  openDeposit: () => void;
  closeDeposit: () => void;
  open: () => void;
  signOut: () => Promise<void>;
  selectWallet: (address: string) => void;
  createWallet: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  authorizeTrade: (id: string, token: string | null) => Promise<string>;
  addWalletSigners: (address: string, signers: { signerId: string; policyIds: string[] }[]) => Promise<void>;
  removeWalletSigners: (address: string) => Promise<void>;
}

export const AuthContext = createContext<OrenAuth>({
  configured: false, ready: true, authenticated: false, wallets: [], busy: false,
  walletPreparing: false, depositOpen: false, openDeposit() {}, closeDeposit() {},
  open() {}, async signOut() {}, selectWallet() {}, async createWallet() {},
  async getAccessToken() { return null; },
  async authorizeTrade() { throw new Error('Sign in before approving a trade.'); },
  async addWalletSigners() { throw new Error('Sign in before adding a signer.'); },
  async removeWalletSigners() { throw new Error('Sign in before removing signers.'); },
});
export const useOrenAuth = () => useContext(AuthContext);
