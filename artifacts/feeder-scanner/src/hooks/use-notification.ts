import { useCallback, useMemo } from "react";
import playFeedback from "@/utils/audio";
import { useNotificationStore } from "@/store/useNotificationStore";
import type { StoredNotification } from "@/store/useNotificationStore";
import { useLogStore } from "@/store/useLogStore";
import type { NotificationPayload } from "@/types";

export interface AlertNotification {
  id: string;
  type: "success" | "error" | "warning" | "info" | "alternative";
  priority: "critical" | "high" | "medium" | "low";
  message: string;
  title?: string;
  timestamp: number;
  duration?: number; // Auto-dismiss time in ms (0 = manual dismiss)
}

interface UseNotificationReturn {
  notification: AlertNotification | null;
  showNotification: boolean;
  notifications: StoredNotification[];
  showAlert: (
    message: string,
    type: "error" | "warning" | "success",
    priority?: "critical" | "high" | "medium" | "low",
    title?: string,
    duration?: number
  ) => void;
  showErrorAlert: (message: string, priority?: "critical" | "high" | "medium" | "low") => void;
  showWarningAlert: (message: string, priority?: "critical" | "high" | "medium" | "low") => void;
  showSuccessAlert: (message: string, priority?: "critical" | "high" | "medium" | "low") => void;
  notify: {
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
    warning: (title: string, message?: string) => void;
  };
  clearNotification: () => void;
  dismissNotification: (id: string) => void;
}

/**
 * Hook for managing alert notifications with buzzer sounds and priorities
 */
export function useNotification(): UseNotificationReturn {
  const notifications = useNotificationStore((state) => state.notifications);
  const push = useNotificationStore((state) => state.push);
  const dismiss = useNotificationStore((state) => state.dismiss);
  const addLog = useLogStore((state) => state.addLog);

  const notification = useMemo<AlertNotification | null>(() => {
    const latest = notifications[notifications.length - 1];
    if (!latest) {
      return null;
    }

    return {
      id: latest.id,
      type: latest.type,
      priority: latest.type === "error" ? "high" : "low",
      message: latest.message,
      title: latest.title,
      timestamp: 0,
      duration: latest.autoCloseDuration,
    };
  }, [notifications]);

  const showNotification = notifications.length > 0;

  const showAlert = useCallback(
    (
      message: string,
      type: "error" | "warning" | "success" = "warning",
      priority: "critical" | "high" | "medium" | "low" = "medium",
      title?: string,
      duration: number = 0
    ) => {
      const resolvedTitle = title || getTitleForType(type);
      push({
        type,
        title: resolvedTitle,
        message,
        autoCloseDuration: duration > 0 ? duration : getDurationForType(type),
      });

      addLog({
        type,
        message,
        details: {
          priority,
        },
      });

      if (type === "success") {
        playFeedback("success");
      } else if (type === "warning") {
        playFeedback("warning");
      } else {
        playFeedback("error");
      }
    },
    [addLog, push]
  );

  const showErrorAlert = useCallback(
    (message: string, priority: "critical" | "high" | "medium" | "low" = "high") => {
      showAlert(message, "error", priority, "❌ ERROR", 8000);
    },
    [showAlert]
  );

  const notify = useMemo(
    () => ({
      success: (title: string, message?: string) => {
        showAlert(message || title, "success", "low", title, 4000);
      },
      error: (title: string, message?: string) => {
        showAlert(message || title, "error", "high", title, 8000);
      },
      warning: (title: string, message?: string) => {
        showAlert(message || title, "warning", "medium", title, 5000);
      },
    }),
    [showAlert]
  );

  const showWarningAlert = useCallback(
    (message: string, priority: "critical" | "high" | "medium" | "low" = "medium") => {
      showAlert(message, "warning", priority, "⚡ WARNING", 5000);
    },
    [showAlert]
  );

  const showSuccessAlert = useCallback(
    (message: string, priority: "critical" | "high" | "medium" | "low" = "medium") => {
      showAlert(message, "success", priority, "✓ SUCCESS", 4000);
    },
    [showAlert]
  );

  const clearNotification = useCallback(() => {
    if (!notifications.length) {
      return;
    }

    const latest = notifications[notifications.length - 1];
    dismiss(latest.id);
  }, [dismiss, notifications]);

  return {
    notification,
    showNotification,
    notifications,
    showAlert,
    showErrorAlert,
    showWarningAlert,
    showSuccessAlert,
    notify,
    clearNotification,
    dismissNotification: dismiss,
  };
}

function getDurationForType(type: "error" | "warning" | "success") {
  if (type === "error") {
    return 8000;
  }
  if (type === "success") {
    return 4000;
  }
  return 5000;
}

function getTitleForType(type: "error" | "warning" | "success") {
  if (type === "error") {
    return "❌ ERROR";
  }
  if (type === "success") {
    return "✓ SUCCESS";
  }
  return "⚡ WARNING";
}
