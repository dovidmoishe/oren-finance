"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { useWallet, type WalletContextState } from "@/components/auth/wallet-context";
import { memo, useContext, useLayoutEffect } from "react";
import { useResolvedTheme, useThemePrimaryColor } from "../theme/theme";
import { AuthContext, type OrenAuth } from "./auth-context";
import { PrivySession } from "./privy-session";
import { WalletModalContext, type WalletModalContextState } from "./wallet-modal-context";

const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: false });

export interface PublishedSession {
  auth: OrenAuth;
  wallet: WalletContextState;
  modal: WalletModalContextState;
}

/** Copies the session contexts out to `AppProviders`, which owns the app tree. */
function SessionPublisher({ onSession }: { onSession: (session: PublishedSession) => void }) {
  const auth = useContext(AuthContext);
  const wallet = useWallet();
  const modal = useContext(WalletModalContext);
  useLayoutEffect(() => { onSession({ auth, wallet, modal }); }, [auth, wallet, modal, onSession]);
  return null;
}

/**
 * Privy and its bundled wallet libraries are heavy, so `AppProviders` loads this
 * module after the app shell renders. It renders beside the app (not around it)
 * so loading it never remounts the page; the session is published upward instead.
 * Memoized so `AppProviders` re-rendering with a new session cannot loop back here.
 */
export const PrivyAuth = memo(function PrivyAuth({ appId, onSession }: { appId: string; onSession: (session: PublishedSession) => void }) {
  const theme = useResolvedTheme();
  const accentColor = useThemePrimaryColor();
  return (
    <PrivyProvider appId={appId} config={{
      loginMethods: ["wallet", "email"],
      appearance: { theme, accentColor, walletChainType: "solana-only" },
      externalWallets: { solana: { connectors: solanaConnectors }, walletConnect: { enabled: false } },
      embeddedWallets: { solana: { createOnLogin: "off" }, showWalletUIs: true },
    }}>
      <PrivySession>
        <SessionPublisher onSession={onSession} />
      </PrivySession>
    </PrivyProvider>
  );
});
