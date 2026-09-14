import { apiRequest } from "./api-client";
import type { PreparedVaultTransaction, VaultIntent, VaultPosition, VaultUnlockIntent } from "@/types";

export function getVaults(wallet: string) {
  return apiRequest<VaultPosition[]>(`/vaults/${wallet}`);
}

export function prepareVaultLock(intent: VaultIntent) {
  return apiRequest<PreparedVaultTransaction>("/vaults/prepare-lock", {
    method: "POST",
    body: intent,
  });
}

export function prepareVaultUnlock(intent: VaultUnlockIntent) {
  return apiRequest<PreparedVaultTransaction>("/vaults/prepare-unlock", {
    method: "POST",
    body: intent,
  });
}

export function confirmVaultLock(wallet: string, lockAddress: string, signature: string) {
  return apiRequest<VaultPosition>("/vaults/confirm-lock", {
    method: "POST",
    body: { wallet, lockAddress, signature },
  });
}

export function confirmVaultUnlock(wallet: string, lockAddress: string, signature: string) {
  return apiRequest<VaultPosition>("/vaults/confirm-unlock", {
    method: "POST",
    body: { wallet, lockAddress, signature },
  });
}
