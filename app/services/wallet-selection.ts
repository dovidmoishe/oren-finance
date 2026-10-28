export type WalletSelection = { userId: string; address: string };
type WalletOwner = { id: string; linkedAccounts: { type: string; chainType?: string; address?: string }[] };

export function resolveSolanaWallet<T extends { address: string }>(
  wallets: T[], user: WalletOwner | null, selection?: WalletSelection,
) {
  const owns = (address: string) => user?.linkedAccounts.some((account) =>
    account.type === "wallet" && account.chainType === "solana" && account.address === address);
  const linked = wallets.filter((wallet) => owns(wallet.address));
  const selected = selection?.userId === user?.id && selection && owns(selection.address)
    ? selection.address : undefined;
  // Do not silently replace a selected but disconnected external wallet.
  return { linked, active: selected ? linked.find((wallet) => wallet.address === selected) : linked[0] };
}
