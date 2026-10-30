"use client";

import { useAuthorizationSignature, useLogin, usePrivy } from "@privy-io/react-auth";
import { usePathname } from "next/navigation";
import { useCreateWallet, useSignMessage, useWallets } from "@privy-io/react-auth/solana";
import { WalletContext, type WalletContextState } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAgentStore, useExecutionStore, usePortfolioStore, useSocialStore, useVaultStore, useWalletStore } from "@/store";
import { invalidateWalletSession, walletSessionIsCurrent } from "@/services/wallet-session";
import { getApprovalAuthorizationRequest } from "@/services/approval-service";
import { createPrivySigner } from "@/services/privy-signer";
import { resolveEmbeddedSolanaAccount, resolveSolanaWallet, type WalletSelection } from "@/services/wallet-selection";
import { AuthContext } from "./auth-context";
import { EmailLogin } from "./email-login";
import { WalletModalContext } from "./wallet-modal-context";

const SELECTION_KEY = "oren.active-wallet.v1";
function readSelection(): WalletSelection | undefined {
  if (typeof window === "undefined") return;
  try {
    const value = JSON.parse(window.localStorage.getItem(SELECTION_KEY) ?? "null");
    if (value && typeof value.userId === "string" && typeof value.address === "string") return value;
  } catch { /* Storage is optional; ownership still comes from Privy. */ }
}

function clearWalletData() {
  invalidateWalletSession();
  useWalletStore.getState().reset();
  usePortfolioStore.getState().reset();
  useExecutionStore.getState().resetAll();
  useVaultStore.getState().reset();
  useSocialStore.getState().clearCopy();
  void useAgentStore.getState().initialize();
}

export function PrivySession({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const pathname = usePathname();
  const [depositOpen, setDepositOpen] = useState(false);
  useLogin({ onComplete: ({ isNewUser, wasAlreadyAuthenticated }) => {
    if (isNewUser && !wasAlreadyAuthenticated) setDepositOpen(true);
  } });
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signMessage } = useSignMessage();
  const [selection, setSelection] = useState<WalletSelection | undefined>(readSelection);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [signingOut, setSigningOut] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const actionLock = useRef(false);
  const setupAttempted = useRef(new Set<string>());
  const setupInFlight = useRef(new Set<string>());
  const [setup, setSetup] = useState<{ userId: string; pending: boolean; error?: string }>();
  const currentUser = useRef<string | undefined>(undefined);
  const account = resolveEmbeddedSolanaAccount(user, selection);
  const hasLinkedWallet = account.linked.length > 0;
  const { active: availableWallet } = resolveSolanaWallet(wallets, user, account.active?.address && user ? { userId: user.id, address: account.active.address } : undefined);
  // Browser signers are optional for legacy message proofs. Server trades use
  // the authenticated embedded account without waiting for signer discovery.
  const active = ready && authenticated && !signingOut
    ? availableWallet
    : undefined;
  const address = ready && authenticated && !signingOut ? account.active?.address : undefined;
  const publicKey = address ? new PublicKey(address) : null;
  const adapterName = address ? 'Privy' : undefined;
  const identity = `${authenticated && !signingOut ? user?.id ?? "" : ""}:${address ?? ""}`;
  useLayoutEffect(() => { currentUser.current = authenticated && !signingOut ? user?.id : undefined; }, [authenticated, signingOut, user?.id]);

  // Own creation explicitly for the custom email flow, with one automatic attempt per user.
  const setupWallet = useCallback(async () => {
    if (!ready || !authenticated || !user || signingOut || hasLinkedWallet || actionLock.current || setupInFlight.current.has(user.id)) return;
    const userId = user.id;
    setupInFlight.current.add(userId);
    setupAttempted.current.add(userId);
    setSetup({ userId, pending: true });
    try { await createWallet(); }
    catch {
      if (currentUser.current === userId) setSetup({ userId, pending: false, error: "We couldn’t prepare your wallet. Please retry." });
    } finally {
      setupInFlight.current.delete(userId);
      if (currentUser.current === userId) setSetup((previous) => previous?.userId === userId ? { ...previous, pending: false } : previous);
    }
  }, [ready, authenticated, user, signingOut, hasLinkedWallet, createWallet]);

  useEffect(() => {
    if (user && !setupAttempted.current.has(user.id)) void setupWallet();
  }, [user, setupWallet]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("deposit") === "1") {
      const frame = window.requestAnimationFrame(() => {
        setDepositOpen(true);
        url.searchParams.delete("deposit");
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [pathname]);

  useLayoutEffect(() => {
    clearWalletData();
    return clearWalletData;
  }, [identity]);

  useLayoutEffect(() => {
    useWalletStore.getState().setWalletState({
      address, connected: Boolean(address), connecting: !ready,
      adapterName,
    });
  }, [identity, address, ready, adapterName]);

  useEffect(() => {
    const element = dialog.current;
    if (visible && !authenticated) element?.showModal();
    else element?.close();
  }, [visible, authenticated]);

  const open = useCallback(() => { setError(undefined); setVisible(true); }, []);
  const signOut = useCallback(async () => {
    if (actionLock.current) return;
    actionLock.current = true;
    setSigningOut(true); setBusy(true); setError(undefined);
    clearWalletData();
    try { await logout(); setVisible(false); setDepositOpen(false); setupAttempted.current.clear(); }
    catch { setError("Unable to sign out. Please try again."); }
    finally { actionLock.current = false; setBusy(false); setSigningOut(false); }
  }, [logout]);

  // Compatibility boundary for existing trade screens; Privy owns the signer.
  const walletContext: WalletContextState = {
    autoConnect: false, wallets: [], wallet: null,
    publicKey,
    connected: Boolean(address), connecting: !ready,
    disconnecting: signingOut, select() {},
    async connect() { open(); }, disconnect: signOut,
    ...createPrivySigner({
      wallet: active, getAddress: () => useWalletStore.getState().address,
      async signTransaction() { throw new Error("Review and confirm this trade in Oren before submission."); }, signMessage,
    }),
    async sendTransaction() { throw new Error("Review and confirm this trade in Oren before submission."); },
    signTransaction: undefined,
    signAllTransactions: undefined, signIn: undefined,
  };

  return (
    <AuthContext.Provider value={{
      configured: true, ready, authenticated: authenticated && !signingOut,
      address, busy: busy || (setup?.userId === user?.id && setup?.pending) || false,
      error: error || (setup && setup.userId === user?.id ? setup.error : undefined), open, signOut, getAccessToken,
      async authorizeTrade(id, token) {
        const current = walletSessionIsCurrent();
        if (!ready || !authenticated || !address) throw new Error('Sign in before approving a trade.');
        const request = await getApprovalAuthorizationRequest(id, token);
        if (!current()) throw new Error('Your account changed. Review the trade again.');
        const { signature } = await generateAuthorizationSignature(request);
        if (!current()) throw new Error('Your account changed. Review the trade again.');
        return signature;
      },
      email: user?.email?.address,
      walletPreparing: authenticated && !address && !error && !(setup?.userId === user?.id && setup?.error) && !signingOut,
      depositOpen, openDeposit: () => setDepositOpen(true), closeDeposit: () => setDepositOpen(false),
      wallets: account.linked.map(wallet => ({ address: wallet.address!, label: 'Privy' })),
      selectWallet(next) {
        if (user && next !== address && account.linked.some(wallet => wallet.address === next)) {
          clearWalletData();
          const nextSelection = { userId: user.id, address: next };
          setSelection(nextSelection);
          try { window.localStorage.setItem(SELECTION_KEY, JSON.stringify(nextSelection)); }
          catch { /* Selection remains usable for this session without storage. */ }
        }
      },
      createWallet: setupWallet,
    }}>
      <WalletContext.Provider value={walletContext}>
        <WalletModalContext.Provider value={{ visible, setVisible: (next) => {
          if (next && authenticated) {
            // A trade's legacy connect request is wallet recovery, never account linking.
            if (!address) {
              setDepositOpen(true);
              void setupWallet();
            }
            return;
          }
          setVisible(next);
        } }}>
          {children}
          <dialog ref={dialog} aria-label="Sign in to Oren" className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-panel p-6 text-foreground shadow-xl backdrop:bg-black/30" onCancel={() => setVisible(false)} onClose={() => setVisible(false)}>
            <button aria-label="Close sign in" className="mb-4 ml-auto block text-sm text-muted" onClick={() => setVisible(false)} type="button">Close</button>
            {visible && <EmailLogin onComplete={() => setVisible(false)} />}
          </dialog>
        </WalletModalContext.Provider>
      </WalletContext.Provider>
    </AuthContext.Provider>
  );
}
