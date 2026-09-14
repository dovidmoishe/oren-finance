"use client";

import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { useEffect, useMemo } from "react";
import { useWalletStore } from "@/store";

function WalletBridge() {
  const { publicKey, connected, connecting, disconnecting, wallet } = useWallet();
  const setWalletState = useWalletStore((state) => state.setWalletState);

  useEffect(() => {
    setWalletState({
      address: publicKey?.toBase58(),
      connected,
      connecting,
      disconnecting,
      adapterName: wallet?.adapter.name,
    });
  }, [connected, connecting, disconnecting, publicKey, setWalletState, wallet?.adapter.name]);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const endpoint =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl(WalletAdapterNetwork.Mainnet);
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <WalletBridge />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
