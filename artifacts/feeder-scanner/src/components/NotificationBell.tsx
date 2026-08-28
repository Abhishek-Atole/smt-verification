import { useState } from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useNotificationBellStore,
  selectUnreadCount,
  type BellNotificationType,
} from "@/store/useNotificationBellStore";

const DOT_COLOR: Record<BellNotificationType, string> = {
  success: "bg-green-500",
  error: "bg-red-500",
  warning: "bg-amber-500",
  alternative: "bg-amber-500",
  duplicate: "bg-amber-500",
  info: "bg-blue-500",
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Header bell with an unread-count badge. Notifications persist (localStorage)
 * and stay unread until the operator opens the panel, which marks them read.
 *
 * `align` controls which way the dropdown opens: "right" (default) aligns the
 * panel's right edge to the bell (for a bell near the screen's right edge);
 * "left" opens rightward (for the left-sidebar bell, so it isn't clipped).
 */
export function NotificationBell({
  className,
  align = "right",
}: {
  className?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const history = useNotificationBellStore((s) => s.history);
  const unread = useNotificationBellStore(selectUnreadCount);
  const markAllRead = useNotificationBellStore((s) => s.markAllRead);
  const clear = useNotificationBellStore((s) => s.clear);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) markAllRead();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        title="Notifications"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          className,
        )}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div
            className={cn(
              "absolute z-[9999] mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-xl",
              align === "left" ? "left-0" : "right-0",
            )}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">Notifications</span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={clear}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {history.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications</p>
              ) : (
                history.map((n) => (
                  <div key={n.id} className="flex items-start gap-2.5 border-b border-border/60 px-3 py-2.5 last:border-b-0">
                    <span className={cn("mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full", DOT_COLOR[n.type])} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{n.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground whitespace-pre-line line-clamp-3">{n.message}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground/70">{timeAgo(n.ts)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
