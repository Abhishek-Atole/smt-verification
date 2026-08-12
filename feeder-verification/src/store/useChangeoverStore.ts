import { create } from "zustand";

interface ChangeoverState {
  activeChangeoverId: string | null;
  setActiveChangeover: (changeoverId: string | null) => void;
}

export const useChangeoverStore = create<ChangeoverState>((set) => ({
  activeChangeoverId: null,
  setActiveChangeover: (changeoverId) => set({ activeChangeoverId: changeoverId }),
}));
