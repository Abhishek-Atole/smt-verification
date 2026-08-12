import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export interface ScannedFeeder {
  lineItemId: string;
  feederNumber: string;
  description: string | null;
  scannedMpn: string;
  lotCode: string | null;
  make: string;
  matchType: "mpn1" | "mpn2" | "mpn3" | "ucal_part_number";
  isAlternate: boolean;
  scannedAt: string;
}

export interface VerificationProgress {
  verified: number;
  total: number;
  percentage: number;
  isComplete: boolean;
  remaining: string[];
}

interface VerificationState {
  changeoverId: string | null;
  scannedFeeders: Map<string, ScannedFeeder>;
  progress: VerificationProgress;
  scanStep: "mpn" | "lot";
  pendingFeeder: ScannedFeeder | null;
  hydrate: (changeoverId: string, scans: ScannedFeeder[], progress: VerificationProgress) => void;
  setProgress: (progress: VerificationProgress) => void;
  setPendingFeeder: (feeder: ScannedFeeder | null) => void;
  confirmScan: (lotCode: string | null) => void;
  setScanStep: (step: "mpn" | "lot") => void;
  reset: () => void;
}

const INITIAL_PROGRESS: VerificationProgress = {
  verified: 0,
  total: 0,
  percentage: 0,
  isComplete: false,
  remaining: [],
};

export const useVerificationStore = create<VerificationState>()(
  immer((set) => ({
    changeoverId: null,
    scannedFeeders: new Map(),
    progress: INITIAL_PROGRESS,
    scanStep: "mpn",
    pendingFeeder: null,

    hydrate: (changeoverId, scans, progress) => {
      set((state) => {
        state.changeoverId = changeoverId;
        state.scannedFeeders = new Map(scans.map((scan) => [scan.lineItemId, scan]));
        state.progress = progress;
        state.scanStep = "mpn";
        state.pendingFeeder = null;
      });
    },

    setProgress: (progress) => {
      set((state) => {
        state.progress = progress;
      });
    },

    setPendingFeeder: (feeder) => {
      set((state) => {
        state.pendingFeeder = feeder;
        state.scanStep = feeder ? "lot" : "mpn";
      });
    },

    confirmScan: (lotCode) => {
      set((state) => {
        const pending = state.pendingFeeder;
        if (!pending) return;

        const finalScan = { ...pending, lotCode };
        state.scannedFeeders.set(finalScan.lineItemId, finalScan);
        state.pendingFeeder = null;
        state.scanStep = "mpn";
      });
    },

    setScanStep: (step) => {
      set((state) => {
        state.scanStep = step;
      });
    },

    reset: () => {
      set((state) => {
        state.changeoverId = null;
        state.scannedFeeders = new Map();
        state.progress = INITIAL_PROGRESS;
        state.scanStep = "mpn";
        state.pendingFeeder = null;
      });
    },
  })),
);
