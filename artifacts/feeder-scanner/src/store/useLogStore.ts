import { create } from "zustand";
import type { LogEntry } from "@/types";

interface LogStore {
  logs: LogEntry[];
  addLog: (entry: Omit<LogEntry, "id" | "timestamp">) => void;
  clearLogs: () => void;
  loadLogsFromStorage: () => void;
}

const createLogId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const LOGS_STORAGE_KEY = "smt-verification-logs";
const MAX_LOGS = 100;

// Use sessionStorage for better security - cleared when tab/browser closes
const storage = sessionStorage;

// Load logs from sessionStorage
const loadLogsFromStorage = (): LogEntry[] => {
  try {
    const stored = storage.getItem(LOGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Convert timestamp strings back to Date objects
      return parsed.map((log: any) => ({
        ...log,
        timestamp: new Date(log.timestamp),
      }));
    }
  } catch (err) {
  }
  return [];
};

// Save logs to sessionStorage
const saveLogsToStorage = (logs: LogEntry[]): void => {
  try {
    storage.setItem(LOGS_STORAGE_KEY, JSON.stringify(logs));
  } catch (err) {
  }
};

export const useLogStore = create<LogStore>((set, get) => {
  // Load initial state from sessionStorage
  const initialLogs = loadLogsFromStorage();

  return {
    logs: initialLogs,
    addLog: (entry) => {
      set((state) => {
        const next: LogEntry = {
          ...entry,
          id: createLogId(),
          timestamp: new Date(),
        };

        const cappedLogs = [...state.logs, next].slice(-MAX_LOGS);
        // Persist to sessionStorage immediately
        saveLogsToStorage(cappedLogs);
        return { logs: cappedLogs };
      });
    },
    clearLogs: () => {
      set({ logs: [] });
      // Clear from sessionStorage
      try {
        storage.removeItem(LOGS_STORAGE_KEY);
      } catch (err) {
      }
    },
    loadLogsFromStorage: () => {
      const logs = loadLogsFromStorage();
      set({ logs });
    },
  };
});
