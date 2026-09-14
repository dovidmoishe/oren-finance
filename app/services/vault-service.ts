import { apiRequest } from "./api-client";
import type { PreparedTransaction, VaultIntent, VaultPosition, VaultUnlockIntent } from "@/types";

export function getVaults(wallet: string) {
  return apiRequest<VaultPosition[]>(`/vaults/${wallet}`);
}

export function prepareVaultLock(intent: VaultIntent) {
  return apiRequest<PreparedTransaction>("/vaults/prepare-lock", {
    method: "POST",
    body: intent,
  });
}

export function prepareVaultUnlock(intent: VaultUnlockIntent) {
  return apiRequest<PreparedTransaction>("/vaults/prepare-unlock", {
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
