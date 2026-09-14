export interface VaultPosition {
  lockAddress: string;
  owner: string;
  assetId: string;
  ticker: string;
  name?: string;
  mint: string;
  quantity: number;
  valueUsd?: number;
  createdAt: string;
  unlockAt: string;
  transactionSignature?: string;
}

export interface VaultIntent {
  wallet: string;
  assetId: string;
  quantity: number;
  unlockAt: string;
}

export interface VaultUnlockIntent {
  wallet: string;
  lockAddress: string;
}

export interface PreparedVaultTransaction {
  wallet: string;
  transaction: string;
  lockAddress?: string;
  tokenVaultAddress?: string;
  unlockAt?: string;
  amount?: number;
  mint?: string;
  assetId?: string;
  ticker?: string;
}
