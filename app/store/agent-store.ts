"use client";

import { create } from "zustand";
import { sendAgentMessage } from "@/services";
import type { AgentArtifact, AgentMessage } from "@/types";

interface AgentState {
  threadId?: string;
  messages: AgentMessage[];
  artifacts: AgentArtifact[];
  isSending: boolean;
  error?: string;
  sendMessage: (message: string, wallet?: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  artifacts: [],
  isSending: false,
  async sendMessage(message, wallet) {
    set({ isSending: true, error: undefined });
    try {
      const response = await sendAgentMessage({
        wallet,
        threadId: get().threadId,
        message,
      });
      set({
        threadId: response.threadId,
        messages: response.messages,
        artifacts: response.artifacts ?? [],
        isSending: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to reach Oren agent", isSending: false });
    }
  },
}));
