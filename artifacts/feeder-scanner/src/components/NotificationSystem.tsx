import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, TriangleAlert, XCircle, X } from "lucide-react";
import { logger } from "../lib/logger";

type NotificationType = "success" | "error" | "warning" | "info" | "duplicate";

type NotifyFn = {
  (type: NotificationType, message: string, details?: string, onDismiss?: () => void): void;
  
  success: (message: string, details?: string) => void;
  error: (message: string, details?: string, onDismiss?: () => void) => void;
  warning: (message: string, details?: string) => void;
  info: (message: string, details?: string) => void;
  duplicate: (message: string, details?: string, onDismiss?: () => void) => void;
};

interface NotificationItem {
  id: string;
  type: NotificationType;
  message: string;
  details?: string;
  createdAt: number;
  autoDismissMs: number;
  onDismiss?: () => void;
}

interface NotificationContextValue {
  notify: NotifyFn;
}

const NOTIFICATION_LIMIT = 5;

const TYPE_STYLE: Record<
  NotificationType,
  {
    title: string;
    bg: string;
    border: string;
    icon: ReactNode;
    autoDismiss: number;
  }
> = {
  success: {
    title: "SUCCESS",
    bg: "#dcfce7",
    border: "#16a34a",
    icon: <CheckCircle2 className="h-5 w-5" />,
    autoDismiss: 5000,
  },
  error: {
    title: "ERROR",
    bg: "#fee2e2",
    border: "#dc2626",
    icon: <XCircle className="h-5 w-5" />,
    autoDismiss: 10000,
  },
  warning: {
    title: "WARNING",
    bg: "#fef3c7",
    border: "#d97706",
    icon: <TriangleAlert className="h-5 w-5" />,
    autoDismiss: 6000,
  },
  info: {
    title: "INFO",
    bg: "#dbeafe",
    border: "#2563eb",
    icon: <Info className="h-5 w-5" />,
    autoDismiss: 5000,
  },
  duplicate: {
    title: "Duplicate Scan",
    bg: "#fef3c7",
    border: "#d97706",
    icon: "⚠️",
    autoDismiss: 8000,
  },
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function playBuzzer(): void {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);

    oscillator.onended = () => {
      void audioContext.close();
    };
  } catch (error) {
    logger.warn("[NotificationSystem] Audio unavailable", error);
  }
}

function NotificationToast({
  item,
  onClose,
}: {
  item: NotificationItem;
  onClose: (id: string) => void;
}) {
  const style = TYPE_STYLE[item.type];

  useEffect(() => {
    if (item.type === "error") {
      playBuzzer();
    }
  }, [item.type]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.2 }}
      className="relative w-full max-w-[360px] overflow-hidden rounded-md border shadow-lg"
      style={{ backgroundColor: style.bg, borderColor: style.border }}
      data-testid={`notification-${item.id}`}
    >
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5 text-lg leading-none" style={{ color: style.border }}>
          {style.icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-5">{style.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{item.message}</p>
          {item.details ? <p className="mt-1 text-xs text-muted-foreground">{item.details}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => onClose(item.id)}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="h-0.5" style={{ backgroundColor: style.border }} />
    </motion.div>
  );
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.onDismiss) target.onDismiss();
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const push = useCallback(
    (type: NotificationType, message: string, details?: string, onDismiss?: () => void) => {
      const item: NotificationItem = {
        id: createId(),
        type,
        message,
        details,
        createdAt: Date.now(),
        autoDismissMs: TYPE_STYLE[type].autoDismiss,
        onDismiss,
      };

      setItems((prev) => {
        const next = [...prev, item];
        if (next.length <= NOTIFICATION_LIMIT) return next;

        const [oldest, ...rest] = next;
        const oldTimer = timersRef.current.get(oldest.id);
        if (oldTimer) {
          clearTimeout(oldTimer);
          timersRef.current.delete(oldest.id);
        }
        if (oldest.onDismiss) oldest.onDismiss();
        return rest;
      });

      const timer = setTimeout(() => dismiss(item.id), item.autoDismissMs);
      timersRef.current.set(item.id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const value = useMemo<NotificationContextValue>(
    () => {
      const notify = ((type: NotificationType, message: string, details?: string, onDismiss?: () => void) =>
        push(type, message, details, onDismiss)) as NotifyFn;

      notify.success = (message, details) => push("success", message, details);
      notify.error = (message, details, onDismiss) => push("error", message, details, onDismiss);
      notify.warning = (message, details) => push("warning", message, details);
      notify.info = (message, details) => push("info", message, details);
      notify.duplicate = (message, details, onDismiss) => push("duplicate", message, details, onDismiss);

      return { notify };
    },
    [push],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {/* Secondary toasts (duplicate scans + server feed) sit bottom-right so
          they never cover the primary top-right scan notifications. */}
      <div className="fixed right-4 bottom-4 z-[9999] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <NotificationToast key={item.id} item={item} onClose={dismiss} />
          ))}
        </AnimatePresence>
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotification(): NotificationContextValue["notify"] {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotification must be used within NotificationProvider");
  }
  return context.notify;
}
