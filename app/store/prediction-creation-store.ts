import { create } from "zustand";
import type { PredictionCreationDraft } from "@/types/prediction-creation";
export const usePredictionCreationStore = create<{
  draft?: PredictionCreationDraft;
  open: (draft: PredictionCreationDraft) => void;
  close: () => void;
}>((set) => ({
  open: (draft) => set({ draft }),
  close: () => set({ draft: undefined }),
}));
