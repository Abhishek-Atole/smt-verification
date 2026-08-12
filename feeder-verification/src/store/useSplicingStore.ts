import { create } from "zustand";

export interface SpliceEntry {
  id: string;
  lineItemId: string;
  feederNumber: string;
  oldSpoolMpn: string;
  oldSpoolLot: string | null;
  newSpoolMpn: string;
  newSpoolLot: string | null;
  splicedAt: string;
}

interface SplicingState {
  entries: SpliceEntry[];
  setEntries: (entries: SpliceEntry[]) => void;
  addEntry: (entry: SpliceEntry) => void;
  reset: () => void;
}

export const useSplicingStore = create<SplicingState>((set) => ({
  entries: [],
  setEntries: (entries) => set({ entries }),
  addEntry: (entry) => set((state) => ({ entries: [entry, ...state.entries] })),
  reset: () => set({ entries: [] }),
}));
