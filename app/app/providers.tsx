"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalContext } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";
import { PrivySession } from "@/components/auth/privy-session";

const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || clusterApiUrl("mainnet-beta");
// Privy's review UI has its own RPC clients; ConnectionProvider does not configure them.
const solanaRpcs = {
  "solana:mainnet": {
    rpc: createSolanaRpc(endpoint),
    rpcSubscriptions: createSolanaRpcSubscriptions(endpoint.replace(/^http/, "ws")),
    blockExplorerUrl: "https://explorer.solana.com",
  },
};

export function AppProviders({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  return (
    <div className="oren-app min-h-screen">
      <ConnectionProvider endpoint={endpoint}>
        {appId ? (
          <PrivyProvider appId={appId} config={{
            loginMethods: ["email"],
            appearance: { theme: "light", accentColor: "#171717", walletChainType: "solana-only" },
            embeddedWallets: { solana: { createOnLogin: "off" }, showWalletUIs: true },
            solana: { rpcs: solanaRpcs },
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
    </div>
  );
}
