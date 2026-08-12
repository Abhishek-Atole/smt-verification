import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Info, TriangleAlert, X } from "lucide-react";
import type { NotificationPayload } from "@/types";

interface ScanNotificationProps {
  notifications: Array<
    NotificationPayload & {
      id: string;
      duration?: number;
    }
  >;
  onDismiss: (id: string) => void;
}

const styleByType = {
  success: {
    border: "#22c55e",
    icon: CheckCircle2,
  },
  error: {
    border: "#ef4444",
    icon: AlertCircle,
  },
  warning: {
    border: "#f59e0b",
    icon: TriangleAlert,
  },
  alternative: {
    border: "#f59e0b",
    icon: TriangleAlert,
  },
  info: {
    border: "#3b82f6",
    icon: Info,
  },
} as const;

export function ScanNotification({ notifications, onDismiss }: ScanNotificationProps) {
  const reversed = useMemo(() => [...notifications].reverse(), [notifications]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div className="fixed top-4 right-4 z-[9999] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2 sm:right-4 sm:left-auto left-1/2 -translate-x-1/2 sm:translate-x-0">
      <AnimatePresence>
        {reversed.map((entry) => {
          const tone = styleByType[entry.type];
          const Icon = tone.icon;
          const duration = entry.autoCloseDuration ?? entry.duration ?? 3000;
          const isExpanded = !!expanded[entry.id];
          const hasDetails = entry.message.includes("\n") || entry.message.length > 110;

          return (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.2 }}
              className="relative overflow-hidden rounded-md border border-border bg-card shadow-xl"
              style={{ borderLeft: `4px solid ${tone.border}` }}
            >
              <button
                type="button"
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                onClick={() => onDismiss(entry.id)}
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="p-3 pr-8">
                <div className="flex items-start gap-2">
                  <Icon className="mt-0.5 h-7 w-7 shrink-0" style={{ color: tone.border }} />
                  <div className="min-w-0">
                    <h4 className="text-[15px] font-semibold leading-5">{entry.title}</h4>
                    <p className={`mt-1 text-[13px] text-muted-foreground whitespace-pre-line ${isExpanded ? "" : "line-clamp-2"}`}>
                      {entry.message}
                    </p>
                    {entry.feederId && (
                      <p className="mt-2 text-xs text-muted-foreground">Feeder: {entry.feederId}</p>
                    )}
                    {hasDetails && (
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                        onClick={() =>
                          setExpanded((prev) => ({
                            ...prev,
                            [entry.id]: !prev[entry.id],
                          }))
                        }
                      >
                        {isExpanded ? (
                          <>
                            Hide details <ChevronUp className="h-3.5 w-3.5" />
                          </>
                        ) : (
                          <>
                            Show details <ChevronDown className="h-3.5 w-3.5" />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <motion.div
                className="h-1 w-full"
                style={{
                  backgroundColor: tone.border,
                  transformOrigin: "left",
                }}
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: duration / 1000, ease: "linear" }}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
