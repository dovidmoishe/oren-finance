"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalContext } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";
import { PrivySession } from "@/components/auth/privy-session";

const connectors = toSolanaWalletConnectors({ shouldAutoConnect: false });

export function AppProviders({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || clusterApiUrl("mainnet-beta");
  return (
    <ConnectionProvider endpoint={endpoint}>
      {appId ? (
        <PrivyProvider appId={appId} config={{
          loginMethods: ["email", "wallet"],
          appearance: { theme: "light", accentColor: "#171717", walletChainType: "solana-only" },
          embeddedWallets: { solana: { createOnLogin: "off" }, showWalletUIs: true },
          externalWallets: { solana: { connectors } },
        }}>
          <PrivySession>{children}</PrivySession>
        </PrivyProvider>
      ) : (
        <WalletProvider wallets={[]} autoConnect={false}>
          <WalletModalContext.Provider value={{ visible: false, setVisible() {} }}>
            {children}
          </WalletModalContext.Provider>
        </WalletProvider>
      )}
    </ConnectionProvider>
  );
}
