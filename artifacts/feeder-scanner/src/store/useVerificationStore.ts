import { create } from "zustand";
import { BOM_DATA, getBOMEntry, validateComponent } from "@/data/bom";
import { useLogStore } from "@/store/useLogStore";
import type { ComponentOption, FeederScan, ProgressResult } from "@/types";

type VerificationStep = "feederId" | "mpn" | "lotCode" | "complete";

interface VerificationStore {
  bomEntries: typeof BOM_DATA;
  scannedFeeders: Map<string, FeederScan>;
  currentStep: VerificationStep;
  activeFeederInput: string;
  isVerificationComplete: boolean;
  pendingMatch: ComponentOption | null;

  setBomEntries: (entries: typeof BOM_DATA) => void;
  submitFeederId: (id: string) => void;
  submitMPN: (value: string) => void;
  submitLotCode: (code: string) => void;
  hydrateFromScans: (scans: FeederScan[]) => void;
  upsertVerifiedFeeder: (scan: FeederScan) => void;
  resetCurrentScan: () => void;
  resetAll: () => void;

  getProgress: () => ProgressResult;
  isFeederAlreadyScanned: (feederId: string) => boolean;
  getBOMEntries: () => typeof BOM_DATA;
  getBOMEntry: (feederId: string) => ReturnType<typeof getBOMEntry>;
  getScannedList: () => FeederScan[];
}

const VERIFICATION_STORAGE_KEY = "smt-verification-state";

// Use sessionStorage for better security - cleared when tab/browser closes
const storage = sessionStorage;

// Serialize scannedFeeders Map to JSON
const serializeScans = (scans: Map<string, FeederScan>): FeederScan[] => {
  return Array.from(scans.values()).map((scan) => ({
    ...scan,
    scannedAt: new Date(scan.scannedAt),
  }));
};

// Deserialize from array back to Map
const deserializeScans = (scans: FeederScan[]): Map<string, FeederScan> => {
  const map = new Map<string, FeederScan>();
  scans.forEach((scan) => {
    map.set(scan.feederId.toUpperCase(), {
      ...scan,
      scannedAt: new Date(scan.scannedAt),
    });
  });
  return map;
};

// Load verification state from sessionStorage
const loadVerificationState = () => {
  try {
    const stored = storage.getItem(VERIFICATION_STORAGE_KEY);
    if (stored) {
      const state = JSON.parse(stored);
      return {
        scannedFeeders: deserializeScans(state.scannedFeeders || []),
        currentStep: state.currentStep || "feederId",
        activeFeederInput: state.activeFeederInput || "",
        isVerificationComplete: state.isVerificationComplete || false,
      };
    }
  } catch (err) {
  }
  return {
    scannedFeeders: new Map<string, FeederScan>(),
    currentStep: "feederId" as VerificationStep,
    activeFeederInput: "",
    isVerificationComplete: false,
  };
};

// Save verification state to sessionStorage
const saveVerificationState = (state: {
  scannedFeeders: Map<string, FeederScan>;
  currentStep: VerificationStep;
  activeFeederInput: string;
  isVerificationComplete: boolean;
}): void => {
  try {
    storage.setItem(
      VERIFICATION_STORAGE_KEY,
      JSON.stringify({
        scannedFeeders: serializeScans(state.scannedFeeders),
        currentStep: state.currentStep,
        activeFeederInput: state.activeFeederInput,
        isVerificationComplete: state.isVerificationComplete,
      })
    );
  } catch (err) {
  }
};

const getProgressFromMap = (scannedFeeders: Map<string, FeederScan>, bomEntries: typeof BOM_DATA): ProgressResult => {
  const totalRequired = bomEntries.length;
  const verifiedCount = scannedFeeders.size;
  const percentage = totalRequired === 0 ? 0 : Math.round((verifiedCount / totalRequired) * 100);
  const remainingFeeders = bomEntries.map((entry) => entry.feederId).filter(
    (feederId) => !scannedFeeders.has(feederId),
  );

  return {
    verifiedCount,
    totalRequired,
    percentage,
    remainingFeeders,
    isComplete: verifiedCount >= totalRequired && totalRequired > 0,
  };
};

const logEvent = useLogStore.getState().addLog;

const areBomEntriesEqual = (a: typeof BOM_DATA, b: typeof BOM_DATA) => {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left.feederId !== right.feederId) {
      return false;
    }
    if (left.alternatives.length !== right.alternatives.length) {
      return false;
    }
    for (let j = 0; j < left.alternatives.length; j += 1) {
      const lAlt = left.alternatives[j];
      const rAlt = right.alternatives[j];
      if (
        lAlt.mpn !== rAlt.mpn ||
        lAlt.partId !== rAlt.partId ||
        lAlt.description !== rAlt.description
      ) {
        return false;
      }
    }
  }

  return true;
};

const areScansEqual = (current: Map<string, FeederScan>, next: Map<string, FeederScan>) => {
  if (current.size !== next.size) {
    return false;
  }

  for (const [key, value] of next.entries()) {
    const existing = current.get(key);
    if (!existing) {
      return false;
    }
    if (
      existing.mpn !== value.mpn ||
      existing.partId !== value.partId ||
      (existing.lotCode || "") !== (value.lotCode || "") ||
      existing.status !== value.status
    ) {
      return false;
    }
  }

  return true;
};

// Load initial state from localStorage
const initialState = loadVerificationState();

export const useVerificationStore = create<VerificationStore>((set, get) => {
  // Wrap set to persist to localStorage
  const persistingSet = (updater: any) => {
    set(updater);
    // Save to localStorage after state update
    const state = get();
    saveVerificationState({
      scannedFeeders: state.scannedFeeders,
      currentStep: state.currentStep,
      activeFeederInput: state.activeFeederInput,
      isVerificationComplete: state.isVerificationComplete,
    });
  };

  return {
    bomEntries: BOM_DATA,
    scannedFeeders: initialState.scannedFeeders,
    currentStep: initialState.currentStep as VerificationStep,
    activeFeederInput: initialState.activeFeederInput,
    isVerificationComplete: initialState.isVerificationComplete,
    pendingMatch: null,

    setBomEntries: (entries) => {
      const nextEntries = entries.length > 0 ? entries : BOM_DATA;
      persistingSet((state: any) =>
        areBomEntriesEqual(state.bomEntries, nextEntries) ? state : { bomEntries: nextEntries }
      );
    },

    submitFeederId: (id) => {
    const feederId = id.trim().toUpperCase();
    if (!feederId) {
      return;
    }

    const entry = getBOMEntry(feederId, get().bomEntries);
    if (!entry) {
      logEvent({
        type: "error",
        feederId,
        message: `Feeder ${feederId} not found in BOM.`,
      });
      throw new Error(`Feeder ${feederId} not found in BOM`);
    }

    if (get().scannedFeeders.has(feederId)) {
      logEvent({
        type: "error",
        feederId,
        message: `Duplicate scan attempt for ${feederId}.`,
      });
      throw new Error(`Feeder ${feederId} already scanned`);
    }

    logEvent({
      type: "info",
      feederId,
      message: `Feeder ${feederId} found in BOM. Awaiting MPN/Part scan.`,
    });

    persistingSet({
      activeFeederInput: feederId,
      currentStep: "mpn",
      pendingMatch: null,
    });
  },

  submitMPN: (value) => {
    const feederId = get().activeFeederInput;
    const scannedValue = value.trim().toUpperCase();

    if (!feederId) {
      throw new Error("No active feeder selected");
    }

    const matched = validateComponent(feederId, scannedValue, get().bomEntries);
    if (!matched) {
      logEvent({
        type: "error",
        feederId,
        message: `Component ${scannedValue} does not match BOM alternatives.`,
      });
      throw new Error(`Component ${scannedValue} does not match feeder ${feederId}`);
    }

    const isAlternative = getBOMEntry(feederId, get().bomEntries)?.alternatives[0]?.partId !== matched.partId;
    logEvent({
      type: isAlternative ? "warning" : "success",
      feederId,
      message: isAlternative
        ? `${feederId} verified with alternative component ${matched.mpn}.`
        : `${feederId} verified with primary component ${matched.mpn}.`,
      details: {
        partId: matched.partId,
        mpn: matched.mpn,
      },
    });

    persistingSet({
      pendingMatch: matched,
      currentStep: "lotCode",
    });
  },

  submitLotCode: (code) => {
    const feederId = get().activeFeederInput;
    const pendingMatch = get().pendingMatch;
    if (!feederId || !pendingMatch) {
      throw new Error("No pending verification found");
    }

    const nextScan: FeederScan = {
      feederId,
      mpn: pendingMatch.mpn,
      partId: pendingMatch.partId,
      lotCode: code.trim() || undefined,
      scannedAt: new Date(),
      status: "verified",
      matchedAlternative: pendingMatch,
    };

    persistingSet((state: any) => {
      const nextMap = new Map(state.scannedFeeders) as Map<string, FeederScan>;
      nextMap.set(feederId, nextScan);
      const progress = getProgressFromMap(nextMap, state.bomEntries);

      return {
        scannedFeeders: nextMap,
        currentStep: progress.isComplete ? "complete" : "feederId",
        activeFeederInput: "",
        pendingMatch: null,
        isVerificationComplete: progress.isComplete,
      };
    });

    const progress = get().getProgress();
    logEvent({
      type: "success",
      feederId,
      message: `Feeder ${feederId} verified successfully.`,
      details: {
        lotCode: code.trim() || "SKIPPED",
      },
    });

    if (progress.isComplete) {
      logEvent({
        type: "success",
        message: `All ${progress.verifiedCount}/${progress.totalRequired} feeders verified. Verification complete.`,
      });
    }
  },

  hydrateFromScans: (scans) => {
    const nextMap = new Map<string, FeederScan>();

    scans.forEach((scan) => {
      nextMap.set(scan.feederId.trim().toUpperCase(), scan);
    });

    persistingSet((state: any) => {
      if (areScansEqual(state.scannedFeeders, nextMap)) {
        return state;
      }

      const isComplete = getProgressFromMap(nextMap, state.bomEntries).isComplete;
      return {
        scannedFeeders: nextMap,
        isVerificationComplete: isComplete,
        currentStep: isComplete ? "complete" : state.currentStep,
      };
    });
  },

  upsertVerifiedFeeder: (scan) => {
    persistingSet((state: any) => {
      const nextMap = new Map(state.scannedFeeders) as Map<string, FeederScan>;
      nextMap.set(scan.feederId.trim().toUpperCase(), scan);
      const progress = getProgressFromMap(nextMap, state.bomEntries);

      return {
        scannedFeeders: nextMap,
        isVerificationComplete: progress.isComplete,
        currentStep: progress.isComplete ? "complete" : state.currentStep,
      };
    });
  },

  resetCurrentScan: () => {
    persistingSet({
      activeFeederInput: "",
      pendingMatch: null,
      currentStep: "feederId",
    });
  },

  resetAll: () => {
    persistingSet({
      bomEntries: BOM_DATA,
      scannedFeeders: new Map<string, FeederScan>(),
      currentStep: "feederId",
      activeFeederInput: "",
      pendingMatch: null,
      isVerificationComplete: false,
    });

    logEvent({
      type: "info",
      message: "Verification state reset for new job.",
    });
  },

  getProgress: () => getProgressFromMap(get().scannedFeeders, get().bomEntries),

  isFeederAlreadyScanned: (feederId) => get().scannedFeeders.has(feederId.trim().toUpperCase()),

  getBOMEntries: () => get().bomEntries,

  getBOMEntry: (feederId) => getBOMEntry(feederId, get().bomEntries),

  getScannedList: () => Array.from(get().scannedFeeders.values()),
};
});

export const useIsVerificationComplete = () =>
  useVerificationStore((state) => state.isVerificationComplete);
