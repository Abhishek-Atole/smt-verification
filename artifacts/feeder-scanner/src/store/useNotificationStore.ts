import { create } from "zustand";
import type { NotificationPayload } from "@/types";

export interface StoredNotification extends NotificationPayload {
  id: string;
}

interface NotificationStore {
  notifications: StoredNotification[];
  push: (payload: NotificationPayload) => string;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

const createNotificationId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  push: (payload) => {
    const id = createNotificationId();
    const autoCloseDuration = payload.autoCloseDuration ?? 3000;

    const nextNotification: StoredNotification = {
      ...payload,
      id,
      autoCloseDuration,
    };

    set((state) => ({ notifications: [...state.notifications, nextNotification] }));

    const timer = setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter((entry) => entry.id !== id),
      }));
      timers.delete(id);
    }, autoCloseDuration);

    timers.set(id, timer);
    return id;
  },
  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }

    set((state) => ({
      notifications: state.notifications.filter((entry) => entry.id !== id),
    }));
  },
  clearAll: () => {
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    set({ notifications: [] });
  },
}));
