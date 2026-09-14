"use client";

import { create } from "zustand";
import { getVaults, prepareVaultLock, prepareVaultUnlock } from "@/services";
import type { PreparedTransaction, VaultIntent, VaultPosition, VaultUnlockIntent } from "@/types";

interface VaultState {
  positions: VaultPosition[];
  prepared?: PreparedTransaction;
  isLoading: boolean;
  error?: string;
  loadVaults: (wallet: string) => Promise<void>;
  prepareLock: (intent: VaultIntent) => Promise<void>;
  prepareUnlock: (intent: VaultUnlockIntent) => Promise<void>;
}

export const useVaultStore = create<VaultState>((set) => ({
  positions: [],
  isLoading: false,
  async loadVaults(wallet) {
    set({ isLoading: true, error: undefined });
    try {
      const positions = await getVaults(wallet);
      set({ positions, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load vaults", isLoading: false });
    }
  },
  async prepareLock(intent) {
    set({ isLoading: true, error: undefined });
    try {
      const prepared = await prepareVaultLock(intent);
      set({ prepared, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to prepare lock", isLoading: false });
    }
  },
  async prepareUnlock(intent) {
    set({ isLoading: true, error: undefined });
    try {
      const prepared = await prepareVaultUnlock(intent);
      set({ prepared, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to prepare unlock", isLoading: false });
    }
  },
}));
