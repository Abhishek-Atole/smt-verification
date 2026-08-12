import { create } from "zustand";
import { getBOMEntry, validateComponent } from "@/data/bom";
import { useLogStore } from "@/store/useLogStore";
import { useVerificationStore } from "@/store/useVerificationStore";
import type { SplicingRecord } from "@/types";

interface SplicingStore {
  records: SplicingRecord[];
  saveRecord: (feederId: string, oldSpoolMPN: string, newSpoolMPN: string) => void;
  hydrateRecords: (records: SplicingRecord[]) => void;
  appendRecord: (record: SplicingRecord) => void;
  clearRecords: () => void;
}

const logEvent = useLogStore.getState().addLog;

const areRecordsEqual = (current: SplicingRecord[], next: SplicingRecord[]) => {
  if (current.length !== next.length) {
    return false;
  }

  for (let i = 0; i < current.length; i += 1) {
    const left = current[i];
    const right = next[i];
    if (
      left.feederId !== right.feederId ||
      left.oldSpoolMPN !== right.oldSpoolMPN ||
      left.newSpoolMPN !== right.newSpoolMPN ||
      left.verifiedAgainstBOM !== right.verifiedAgainstBOM ||
      new Date(left.splicedAt).getTime() !== new Date(right.splicedAt).getTime()
    ) {
      return false;
    }
  }

  return true;
};

export const useSplicingStore = create<SplicingStore>((set) => ({
  records: [],
  saveRecord: (rawFeederId, rawOldSpoolMPN, rawNewSpoolMPN) => {
    const feederId = rawFeederId.trim().toUpperCase();
    const oldSpoolMPN = rawOldSpoolMPN.trim().toUpperCase();
    const newSpoolMPN = rawNewSpoolMPN.trim().toUpperCase();

    if (!feederId || !oldSpoolMPN || !newSpoolMPN) {
      throw new Error("All splicing fields are required");
    }

    if (oldSpoolMPN !== newSpoolMPN) {
      logEvent({
        type: "error",
        feederId,
        message: "Splicing rejected: old spool and new spool must be identical for this feeder.",
        details: {
          oldSpoolMPN,
          newSpoolMPN,
        },
      });
      throw new Error("Old spool and new spool must be the same for this feeder");
    }

    const verified = useVerificationStore.getState().isFeederAlreadyScanned(feederId);
    if (!verified) {
      logEvent({
        type: "error",
        feederId,
        message: `Splicing rejected: feeder ${feederId} is not verified.`,
      });
      throw new Error(`Feeder ${feederId} has not been verified yet`);
    }

    const bomEntries = useVerificationStore.getState().getBOMEntries();

    if (!getBOMEntry(feederId, bomEntries)) {
      logEvent({
        type: "error",
        feederId,
        message: `Splicing rejected: feeder ${feederId} not found in BOM.`,
      });
      throw new Error(`Feeder ${feederId} does not exist in BOM`);
    }

    const oldMatch = validateComponent(feederId, oldSpoolMPN, bomEntries);
    const newMatch = validateComponent(feederId, newSpoolMPN, bomEntries);

    if (!oldMatch || !newMatch) {
      logEvent({
        type: "error",
        feederId,
        message: `Splicing rejected: old/new spool did not match BOM alternatives.`,
        details: {
          oldSpoolMPN,
          newSpoolMPN,
        },
      });
      throw new Error("Old and new spool components must match feeder BOM alternatives");
    }

    const nextRecord: SplicingRecord = {
      feederId,
      oldSpoolMPN,
      newSpoolMPN,
      splicedAt: new Date(),
      verifiedAgainstBOM: true,
    };

    set((state) => ({ records: [...state.records, nextRecord] }));

    logEvent({
      type: "success",
      feederId,
      message: `Splicing recorded: OLD=${oldSpoolMPN} -> NEW=${newSpoolMPN}.`,
      details: {
        oldSpoolMPN,
        newSpoolMPN,
      },
    });
  },
  hydrateRecords: (records) => {
    set((state) => {
      const nextRecords = [...records];
      return areRecordsEqual(state.records, nextRecords) ? state : { records: nextRecords };
    });
  },
  appendRecord: (record) => {
    set((state) => ({ records: [...state.records, record] }));
  },
  clearRecords: () => {
    set({ records: [] });
    logEvent({ type: "info", message: "Splicing records cleared." });
  },
}));
