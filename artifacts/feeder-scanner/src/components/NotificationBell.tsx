import { useState } from "react";
import { Bell } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// Module 14 — the bell is now driven by the scoped server feed (GET
// /api/notifications), not by local toasts. Rows arrive already filtered to
// this user's role/id; per-user "seen" is tracked server-side, so unread state
// is consistent across a user's devices and local scan toasts no longer leak in.
interface FeedRow {
  id: number;
  type: string;
  message: string;
  detail?: string | null;
  eventClass?: string | null;
  createdAt: string;
  seen: boolean;
}

const DOT_COLOR: Record<string, string> = {
  success: "bg-green-500",
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
};

function timeAgo(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const BELL_QUERY_KEY = ["notification-bell"] as const;

/**
 * Header bell with an unread-count badge. Notifications come from the scoped
 * server feed and stay unread until the operator opens the panel, which marks
 * the visible unread rows seen server-side ("auto-clear on view"). History is
 * retained on the server — there is no client-side clear.
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
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: BELL_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=30", { credentials: "include" });
      if (!res.ok) return { notifications: [] as FeedRow[] };
      return (await res.json()) as { notifications: FeedRow[] };
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });

  const history = data?.notifications ?? [];
  const unread = history.reduce((n, item) => n + (item.seen ? 0 : 1), 0);

  const markSeen = useMutation({
    mutationFn: async (ids: number[]) => {
      await fetch("/api/notifications/seen", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BELL_QUERY_KEY }),
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      markSeen.mutate(history.filter((n) => !n.seen).map((n) => n.id));
    }
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
            </div>
            <div className="max-h-96 overflow-y-auto">
              {history.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications</p>
              ) : (
                history.map((n) => (
                  <div key={n.id} className="flex items-start gap-2.5 border-b border-border/60 px-3 py-2.5 last:border-b-0">
                    <span className={cn("mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full", DOT_COLOR[n.type] ?? "bg-blue-500")} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{n.message}</p>
                      {n.detail && (
                        <p className="mt-0.5 text-xs text-muted-foreground whitespace-pre-line line-clamp-3">{n.detail}</p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground/70">{timeAgo(n.createdAt)}</p>
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
