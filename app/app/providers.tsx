"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalContext } from "@solana/wallet-adapter-react-ui";
import { PrivySession } from "@/components/auth/privy-session";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <div className="oren-app min-h-screen">
        {appId ? (
          <PrivyProvider appId={appId} config={{
            loginMethods: ["email"],
            appearance: { theme: "light", accentColor: "#171717", walletChainType: "solana-only" },
            embeddedWallets: { solana: { createOnLogin: "off" }, showWalletUIs: true },
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
    </div>
  );
}
