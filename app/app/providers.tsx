"use client";

import {
  WalletContext,
  type WalletContextState,
} from "@/components/auth/wallet-context";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AuthContext, type OrenAuth } from "@/components/auth/auth-context";
import type { PublishedSession } from "@/components/auth/privy-auth";
import {
  WalletModalContext,
  type WalletModalContextState,
} from "@/components/auth/wallet-modal-context";
import { useT } from "@/i18n/i18n";
import { reloadOnceForChunkFailure } from "@/lib/chunk-reload";
import { recordPerformanceMetric } from "@/lib/performance-client";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

/** Bound the entire restore, including the SDK download, without cancelling a late session. */
export const PRIVY_STILL_LOADING_MS = 8_000;
export const PRIVY_READY_TIMEOUT_MS = 28_000;

type PrivyModuleState = { status: "pending" } | { status: "loaded" } | { status: "failed" };

let privyModuleState: PrivyModuleState = { status: "pending" };
const privyModuleListeners = new Set<(state: PrivyModuleState) => void>();

function setPrivyModuleState(state: PrivyModuleState) {
  privyModuleState = state;
  for (const listener of privyModuleListeners) listener(state);
}

function subscribePrivyModule(listener: (state: PrivyModuleState) => void) {
  privyModuleListeners.add(listener);
  listener(privyModuleState);
  return () => {
    privyModuleListeners.delete(listener);
  };
}

function loadPrivyAuth() {
  return import("@/components/auth/privy-auth")
    .then((mod) => {
      setPrivyModuleState({ status: "loaded" });
      return mod.PrivyAuth;
    })
    .catch(() => {
      setPrivyModuleState({ status: "failed" });
      return function PrivyAuthUnavailable() {
        return null;
      };
    });
}

// Privy (with its bundled wallet libraries) is the largest part of the app's
// JavaScript. Load it after the shell renders; until then auth is "not ready".
const PrivyAuth = dynamic(loadPrivyAuth, { ssr: false });

const REVIEW_IN_OREN =
  "Review and confirm this trade in Oren before submission.";

/** Matches what `PrivySession` provides while signed out or not ready. */
function signedOutWallet(
  connecting: boolean,
  connect: () => void,
): WalletContextState {
  return {
    autoConnect: false,
    wallets: [],
    wallet: null,
    publicKey: null,
    connected: false,
    connecting,
    disconnecting: false,
    select() {},
    async connect() {
      connect();
    },
    async disconnect() {},
    async sendTransaction() {
      throw new Error(REVIEW_IN_OREN);
    },
    signTransaction: undefined,
    signAllTransactions: undefined,
    signMessage: undefined,
    signIn: undefined,
  };
}

const unconfiguredWallet = signedOutWallet(false, () => {});
const unconfiguredModal: WalletModalContextState = {
  visible: false,
  setVisible() {},
};

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <div className="oren-app min-h-screen bg-background text-foreground" data-oren-product="">
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
function createLoadingSession(start: () => void) {
  const queued = { signIn: false, deposit: false };
  const signIn = () => {
    start();
    queued.signIn = true;
  };
  const auth: OrenAuth = {
    configured: true,
    ready: false,
    authenticated: false,
    wallets: [],
    linkEmail() {},
    linkWallet() {},
    connectWallet() {},
    busy: false,
    walletPreparing: false,
    depositOpen: false,
    openDeposit() {
      start();
      queued.deposit = true;
    },
    closeDeposit() {
      queued.deposit = false;
    },
    open: signIn,
    async signOut() {},
    selectWallet() {},
    async createWallet() {},
    async getAccessToken() {
      return null;
    },
    async authorizeTrade() {
      throw new Error("Sign in before approving a trade.");
    },
    async signTradePermission() {
      throw new Error("Sign in before authorizing chat trading.");
    },
    async addTradeSigner() {
      throw new Error("Sign in before granting a trade signer.");
    },
    async removeTradeSigners() {
      throw new Error("Sign in before removing trade signers.");
    },
  };
  const modal: WalletModalContextState = {
    visible: false,
    setVisible(next) {
      if (next) signIn();
    },
  };
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

function DeferredPrivy({
  appId,
  children,
}: {
  appId: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const [session, setSession] = useState<PublishedSession>();
  const [restoreStarted] = useState(() => Date.now());
  const [startPrivy, setStartPrivy] = useState(false);
  const [loading] = useState(() => createLoadingSession(() => setStartPrivy(true)));
  const [moduleLoaded, setModuleLoaded] = useState(false);
  const [stillLoading, setStillLoading] = useState(false);
  const [restoreTimedOut, setRestoreTimedOut] = useState(false);
  const [restoreError, setRestoreError] = useState<string>();

  useEffect(() => {
    if (session?.auth.ready) recordPerformanceMetric({ name: "account-ready", value: Date.now() - restoreStarted });
  }, [restoreStarted, session?.auth.ready]);

  useEffect(() => {
    if (startPrivy) return;
    // Allow the shell/data requests to start first, but always restore existing
    // sessions. Explicit sign-in/deposit requests bypass the idle delay.
    if (typeof window.requestIdleCallback === "function") {
      const idle = window.requestIdleCallback(() => setStartPrivy(true), { timeout: 500 });
      return () => window.cancelIdleCallback(idle);
    }
    const timer = window.setTimeout(() => setStartPrivy(true), 0);
    return () => window.clearTimeout(timer);
  }, [startPrivy]);

  useEffect(() => {
    return subscribePrivyModule((state) => {
      if (state.status === "loaded") setModuleLoaded(true);
      if (state.status === "failed" && !reloadOnceForChunkFailure()) setRestoreError("auth.restoreSlow");
    });
  }, []);

  useEffect(() => {
    if (session?.auth.ready || restoreError) return;
    const still = window.setTimeout(() => setStillLoading(true), PRIVY_STILL_LOADING_MS);
    const timeout = window.setTimeout(() => setRestoreTimedOut(true), PRIVY_READY_TIMEOUT_MS);
    return () => {
      window.clearTimeout(still);
      window.clearTimeout(timeout);
    };
  }, [restoreError, session?.auth.ready]);

  useEffect(() => {
    if (session) loading.replay(session);
  }, [loading, session]);

  const current = session ?? loading;
  const failed = Boolean(restoreError);
  const timedOut = restoreTimedOut && !current.auth.ready && !failed;
  // The failed import never publishes a session, so a queued sign-in cannot open. Reload instead.
  const retryFailedImport = () => window.location.reload();
  const auth = failed
    ? {
        ...loading.auth,
        ready: true,
        authenticated: false,
        restoreError,
        restoreTimedOut: false,
        open: retryFailedImport,
        openDeposit: retryFailedImport,
      }
    : timedOut
      ? {
          ...current.auth,
          restoreTimedOut: true,
          // There is no login UI to open until the SDK download completes.
          open: moduleLoaded ? current.auth.open : retryFailedImport,
          openDeposit: moduleLoaded ? current.auth.openDeposit : retryFailedImport,
        }
      : current.auth;
  const wallet = failed ? signedOutWallet(false, retryFailedImport) : current.wallet;
  const modal = failed ? { visible: false, setVisible(next: boolean) { if (next) retryFailedImport(); } } : current.modal;
  return (
    <>
      {failed || timedOut ? (
        <div
          className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-xl border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning"
          role="alert"
        >
          <span>{t("auth.restoreSlow")}</span>
          <button className="font-semibold underline" onClick={() => window.location.reload()} type="button">
            {t("auth.reload")}
          </button>
        </div>
      ) : stillLoading && !current.auth.ready ? (
        <div className="mx-auto flex max-w-6xl items-center px-4 py-3 text-sm text-muted" role="status">
          {t("auth.restoreStillLoading")}
        </div>
      ) : null}
      <AuthContext.Provider value={auth}>
        <WalletContext.Provider value={wallet}>
          <WalletModalContext.Provider value={modal}>
            {children}
          </WalletModalContext.Provider>
        </WalletContext.Provider>
      </AuthContext.Provider>
      {/* Rendered beside the app so Privy loading in never remounts the page. */}
      {startPrivy ? <PrivyAuth appId={appId} onSession={setSession} /> : null}
    </>
  );
}
