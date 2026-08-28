import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BellNotificationType = "success" | "error" | "warning" | "info" | "alternative" | "duplicate";

export interface BellNotification {
  id: string;
  type: BellNotificationType;
  title: string;
  message: string;
  ts: number;
  read: boolean;
}

interface BellStore {
  history: BellNotification[];
  record: (entry: { type: BellNotificationType; title: string; message: string }) => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  clear: () => void;
}

const MAX_HISTORY = 50;

const createId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Persistent notification history that backs the header bell. Unlike the
 * transient toasts, these survive auto-dismiss and page reload (localStorage)
 * and stay marked unread until the operator opens the bell.
 */
export const useNotificationBellStore = create<BellStore>()(
  persist(
    (set) => ({
      history: [],
      record: ({ type, title, message }) =>
        set((state) => ({
          history: [
            { id: createId(), type, title, message, ts: Date.now(), read: false },
            ...state.history,
          ].slice(0, MAX_HISTORY),
        })),
      markAllRead: () =>
        set((state) => ({ history: state.history.map((n) => (n.read ? n : { ...n, read: true })) })),
      markRead: (id) =>
        set((state) => ({ history: state.history.map((n) => (n.id === id ? { ...n, read: true } : n)) })),
      clear: () => set({ history: [] }),
    }),
    { name: "smt-notification-bell" },
  ),
);

/** Convenience selector for the unread badge count. */
export const selectUnreadCount = (state: BellStore) => state.history.reduce((n, item) => n + (item.read ? 0 : 1), 0);
