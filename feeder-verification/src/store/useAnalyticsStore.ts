import { create } from "zustand";
import type { AnalyticsTab } from "@/lib/analytics/types";

interface AnalyticsStore {
  activeTab: AnalyticsTab;
  days: number;
  selectedBomHeaderId: string;
  selectedLineNumber: string;
  setActiveTab: (tab: AnalyticsTab) => void;
  setDays: (days: number) => void;
  setSelectedBomHeaderId: (bomHeaderId: string) => void;
  setSelectedLineNumber: (lineNumber: string) => void;
}

export const useAnalyticsStore = create<AnalyticsStore>((set) => ({
  activeTab: "overview",
  days: 7,
  selectedBomHeaderId: "",
  selectedLineNumber: "",
  setActiveTab: (tab) => set({ activeTab: tab }),
  setDays: (days) => set({ days }),
  setSelectedBomHeaderId: (selectedBomHeaderId) => set({ selectedBomHeaderId }),
  setSelectedLineNumber: (selectedLineNumber) => set({ selectedLineNumber }),
}));
