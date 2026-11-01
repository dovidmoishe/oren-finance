"use client";

import { WalletContext, type WalletContextState } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AuthContext, type OrenAuth } from "@/components/auth/auth-context";
import type { PublishedSession } from "@/components/auth/privy-auth";
import { WalletModalContext, type WalletModalContextState } from "@/components/auth/wallet-modal-context";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

// Privy (with its bundled wallet libraries) is the largest part of the app's
// JavaScript. Load it after the shell renders; until then auth is "not ready".
const PrivyAuth = dynamic(
  () => import("@/components/auth/privy-auth").then((mod) => mod.PrivyAuth),
  { ssr: false },
);

const REVIEW_IN_OREN = "Review and confirm this trade in Oren before submission.";

/** Matches what `PrivySession` provides while signed out or not ready. */
function signedOutWallet(connecting: boolean, connect: () => void): WalletContextState {
  return {
    autoConnect: false, wallets: [], wallet: null, publicKey: null,
    connected: false, connecting, disconnecting: false, select() {},
    async connect() { connect(); }, async disconnect() {},
    async sendTransaction() { throw new Error(REVIEW_IN_OREN); },
    signTransaction: undefined, signAllTransactions: undefined, signMessage: undefined, signIn: undefined,
  };
}

const unconfiguredWallet = signedOutWallet(false, () => {});
const unconfiguredModal: WalletModalContextState = { visible: false, setVisible() {} };

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <div className="oren-app min-h-screen">
      {appId ? (
        <DeferredPrivy appId={appId}>{children}</DeferredPrivy>
      ) : (
        <WalletContext.Provider value={unconfiguredWallet}>
          <WalletModalContext.Provider value={unconfiguredModal}>
            {children}
          </WalletModalContext.Provider>
        </WalletContext.Provider>
      )}
    </div>
  );
}

/** Auth while Privy loads: not ready, signed out, with sign-in/deposit requests queued. */
function createLoadingSession() {
  const queued = { signIn: false, deposit: false };
  const signIn = () => { queued.signIn = true; };
  const auth: OrenAuth = {
    configured: true, ready: false, authenticated: false, wallets: [], busy: false,
    walletPreparing: false, depositOpen: false,
    openDeposit() { queued.deposit = true; }, closeDeposit() { queued.deposit = false; },
    open: signIn, async signOut() {}, selectWallet() {}, async createWallet() {},
    async getAccessToken() { return null; },
    async authorizeTrade() { throw new Error("Sign in before approving a trade."); },
    async addWalletSigners() { throw new Error("Sign in before adding a signer."); },
    async removeWalletSigners() { throw new Error("Sign in before removing signers."); },
  };
  const modal: WalletModalContextState = { visible: false, setVisible(next) { if (next) signIn(); } };
  /** Replays queued requests into the loaded session, once. */
  function replay(session: PublishedSession) {
    const { signIn: wantsSignIn, deposit } = queued;
    queued.signIn = false;
    queued.deposit = false;
    if (wantsSignIn) session.auth.open();
    if (deposit) session.auth.openDeposit();
  }
  return { auth, wallet: signedOutWallet(true, signIn), modal, replay };
}

function DeferredPrivy({ appId, children }: { appId: string; children: React.ReactNode }) {
  const [session, setSession] = useState<PublishedSession>();
  const [loading] = useState(createLoadingSession);

  useEffect(() => {
    if (session) loading.replay(session);
  }, [loading, session]);

  const current = session ?? loading;
  return (
    <>
      <AuthContext.Provider value={current.auth}>
        <WalletContext.Provider value={current.wallet}>
          <WalletModalContext.Provider value={current.modal}>
            {children}
          </WalletModalContext.Provider>
        </WalletContext.Provider>
      </AuthContext.Provider>
      {/* Rendered beside the app so Privy loading in never remounts the page. */}
      <PrivyAuth appId={appId} onSession={setSession} />
    </>
  );
}
