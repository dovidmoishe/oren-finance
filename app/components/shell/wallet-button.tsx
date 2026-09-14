"use client";

import { ArrowDown01Icon, LogOutIcon, Wallet02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui";

function Icon({ icon, size = 14 }: { icon: Parameters<typeof HugeiconsIcon>[0]["icon"]; size?: number }) {
  return <HugeiconsIcon color="currentColor" icon={icon} size={size} strokeWidth={1.8} />;
}

function shorten(address?: string) {
  if (!address) {
    return "Connect wallet";
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <Button className="hidden h-10 gap-2 rounded-[12px] border-foreground bg-foreground px-4 text-xs text-white hover:bg-black/85 sm:inline-flex" onClick={() => setVisible(true)} variant="primary">
          <Icon icon={Wallet02Icon} size={13} />
          <span className="font-medium">{shorten(publicKey?.toBase58())}</span>
          <span className="font-normal text-white/60">{wallet?.adapter.name}</span>
        </Button>
        <Button aria-label="Disconnect wallet" className="h-10 w-10 rounded-full border-0 bg-transparent shadow-none" onClick={() => void disconnect()} size="icon" variant="ghost">
          <Icon icon={LogOutIcon} size={13} />
        </Button>
      </div>
    );
  }

  return (
    <Button className="h-10 gap-2 rounded-[12px] px-4 text-xs" disabled={connecting} onClick={() => setVisible(true)} variant="primary">
      <span className="text-sm leading-none">+</span>
      {connecting ? "Connecting" : "Connect Wallet"}
      <Icon icon={ArrowDown01Icon} size={13} />
    </Button>
  );
}
