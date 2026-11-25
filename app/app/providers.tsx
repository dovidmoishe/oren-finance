"use client";

import {
  WalletContext,
  type WalletContextState,
} from "@/components/auth/wallet-context";
import { LoaderCircle as LoaderCircleIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { preconnect } from "react-dom";
import { AuthContext, type OrenAuth } from "@/components/auth/auth-context";
import type { PublishedSession } from "@/components/auth/privy-auth";
import { browserHasPrivySession, isPrivyTokenKey, PRIVY_ORIGIN } from "@/components/auth/privy-session-hint";
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

function importPrivyAuth() {
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

let privyAuthModule: ReturnType<typeof importPrivyAuth> | undefined;

/** One download per page, shared by restore, sign-in intent and the dynamic component. */
function loadPrivyAuth() {
  privyAuthModule ??= importPrivyAuth();
  return privyAuthModule;
}

// Privy (with its bundled wallet libraries) is the largest part of the app's
// JavaScript. Visitors without a saved session never download it until they
// sign in; until a saved session restores, auth is "not ready".
const PrivyAuth = dynamic(loadPrivyAuth, { ssr: false });

/** `/deposit` and `/app/deposit` redirect to `?deposit=1`; `PrivySession` opens Add money for it. */
function hasDepositLink() {
  return new URLSearchParams(window.location.search).get("deposit") === "1";
}

// A saved session or an Add money link needs Privy straight away. Start the
// download while the page hydrates, instead of after it, and open Privy's
// connection alongside.
if (appId && typeof document !== "undefined" && (browserHasPrivySession() || hasDepositLink())) {
  preconnect(PRIVY_ORIGIN);
  void loadPrivyAuth();
}

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

/** Another tab signing in or out changes Privy's tokens; read the hint again then. */
function subscribeSessionHint(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (isPrivyTokenKey(event.key)) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/**
 * Whether this page has seen a saved Privy session. It stays true: signing out
 * removes the tokens, and only a mounted Privy can then publish the signed-out
 * session and open sign-in again.
 */
let sessionSeen = false;
function sessionHint() {
  sessionSeen ||= browserHasPrivySession();
  return sessionSeen;
}

/** The server cannot see web storage, so it and hydration render "not ready". */
const unknownSessionHint = () => null;

type AuthRequest = "signIn" | "deposit";

/** Auth while Privy loads: not ready, signed out, with sign-in/deposit requests queued. */
function createLoadingSession(start: (request: AuthRequest) => void) {
  const queued = { signIn: false, deposit: false };
  const signIn = () => {
    start("signIn");
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
      start("deposit");
      queued.deposit = true;
    },
    closeDeposit() {
      queued.deposit = false;
    },
    open: signIn,
    prefetch() {
      void loadPrivyAuth();
    },
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
  /** Forgets a sign-in whose waiting notice was closed. Privy keeps loading. */
  function cancelSignIn() {
    queued.signIn = false;
  }
  return {
    auth,
    wallet: signedOutWallet(true, signIn),
    idleWallet: signedOutWallet(false, signIn),
    modal,
    replay,
    cancelSignIn,
  };
}

function DeferredPrivy({
  appId,
  children,
}: {
  appId: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const [session, setSession] = useState<PublishedSession>();
  const [restoreStarted] = useState(() => Date.now());
  // null on the server and while hydrating; then whether this page has seen a session to restore.
  const savedSession = useSyncExternalStore(subscribeSessionHint, sessionHint, unknownSessionHint);
  const [requested, setRequested] = useState(false);
  const [signInPending, setSignInPending] = useState(false);
  const [loading] = useState(() => createLoadingSession((request) => {
    setRequested(true);
    if (request === "signIn") setSignInPending(true);
  }));
  const [moduleLoaded, setModuleLoaded] = useState(false);
  const [stillLoading, setStillLoading] = useState(false);
  const [restoreTimedOut, setRestoreTimedOut] = useState(false);
  const [restoreError, setRestoreError] = useState<string>();
  // A saved session restores at once (its download already started); otherwise
  // Privy loads when the visitor asks to sign in or add money. Both stay true,
  // so Privy stays mounted once it starts.
  const startPrivy = requested || savedSession === true;
  // Nothing to restore: this browser is signed out until Privy says otherwise.
  const signedOut = savedSession === false;

  useEffect(() => {
    // An Add money link needs Privy even when signed out. `PrivySession` then
    // opens the dialog and removes the link, as it does for a signed-in visitor.
    if (!hasDepositLink()) return;
    const frame = window.requestAnimationFrame(() => setRequested(true));
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    // Restores only: a sign-in started by a click would also time the visitor's pause.
    if (session?.auth.ready && !requested) recordPerformanceMetric({ name: "account-ready", value: Date.now() - restoreStarted });
  }, [restoreStarted, session?.auth.ready, requested]);

  useEffect(() => {
    return subscribePrivyModule((state) => {
      if (state.status === "loaded") setModuleLoaded(true);
      if (state.status === "failed" && !reloadOnceForChunkFailure()) setRestoreError("auth.restoreSlow");
    });
  }, []);

  useEffect(() => {
    // Timed from the moment Privy is needed: at load for a saved session, at the click otherwise.
    if (!startPrivy || session?.auth.ready || restoreError) return;
    const still = window.setTimeout(() => setStillLoading(true), PRIVY_STILL_LOADING_MS);
    const timeout = window.setTimeout(() => setRestoreTimedOut(true), PRIVY_READY_TIMEOUT_MS);
    return () => {
      window.clearTimeout(still);
      window.clearTimeout(timeout);
    };
  }, [startPrivy, restoreError, session?.auth.ready]);

  useEffect(() => {
    if (session) loading.replay(session);
  }, [loading, session]);

  const current = session ?? loading;
  const privyReady = Boolean(current.auth.ready);
  const failed = Boolean(restoreError);
  const timedOut = restoreTimedOut && !privyReady && !failed;
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
      : signedOut && !privyReady
        // Nothing to restore, so this browser is signed out until Privy says otherwise.
        ? { ...current.auth, ready: true, authenticated: false, busy: signInPending && !session }
        : current.auth;
  const wallet = failed
    ? signedOutWallet(false, retryFailedImport)
    : signedOut && !privyReady ? loading.idleWallet : current.wallet;
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
      ) : stillLoading && !privyReady ? (
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
      {signInPending && !session && !failed ? (
        // Shown from the click until Privy's sign-in dialog can take over.
        <div className="fixed inset-0 z-50 grid place-items-center bg-scrim/30 p-4">
          <div aria-live="polite" className="flex w-full max-w-md items-start gap-3 rounded-2xl border border-border bg-panel p-6 text-foreground shadow-xl" role="status">
            <LoaderCircleIcon aria-hidden="true" className="mt-0.5 shrink-0 text-muted motion-safe:animate-spin" size={18} strokeWidth={1.7} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t("auth.title")}</p>
              <p className="mt-1 text-sm text-muted">{t("auth.waiting")}</p>
            </div>
            <button className="text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus" onClick={() => { loading.cancelSignIn(); setSignInPending(false); }} type="button">
              {t("auth.close")}
            </button>
          </div>
        </div>
      ) : null}
      {/* Rendered beside the app so Privy loading in never remounts the page. */}
      {startPrivy ? <PrivyAuth appId={appId} onSession={setSession} /> : null}
    </>
  );
}
