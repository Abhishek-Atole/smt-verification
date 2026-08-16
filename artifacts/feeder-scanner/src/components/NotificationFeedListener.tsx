import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNotification } from "@/components/NotificationSystem";

interface FeedRow {
  id: number;
  type: string;
  message: string;
  detail?: string | null;
  createdAt: string;
}

const TOAST_TYPES = ["success", "info", "warning", "error"] as const;
type ToastType = (typeof TOAST_TYPES)[number];

/**
 * Cross-dashboard notification feed. Polls GET /api/notifications and toasts
 * new rows so every logged-in dashboard sees BOM changes made elsewhere.
 *
 * Mounted once inside the authed shell, so it only polls while signed in.
 * Uses `since` (echoing the server's own createdAt string, avoiding client/
 * server timezone math) to bound the query, plus a seen-id set to dedupe the
 * boundary row. The first poll is a silent baseline — we don't replay history.
 */
export function NotificationFeedListener() {
  const notify = useNotification();
  const primedRef = useRef(false);
  const sinceRef = useRef<string | null>(null);
  const seenIds = useRef<Set<number>>(new Set());

  const { data } = useQuery({
    queryKey: ["notification-feed"],
    queryFn: async () => {
      const since = sinceRef.current;
      const url = since
        ? `/api/notifications?since=${encodeURIComponent(since)}`
        : "/api/notifications";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return { notifications: [] as FeedRow[] };
      return (await res.json()) as { notifications: FeedRow[] };
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const rows = data?.notifications ?? [];
    if (rows.length === 0) return;

    // API returns newest-first; advance `since` to the newest server timestamp.
    sinceRef.current = rows[0].createdAt;

    if (!primedRef.current) {
      // Baseline pass: remember what already exists, but don't toast history.
      rows.forEach((r) => seenIds.current.add(r.id));
      primedRef.current = true;
      return;
    }

    // Toast oldest-first for natural ordering.
    const fresh = rows.filter((r) => !seenIds.current.has(r.id)).reverse();
    for (const row of fresh) {
      seenIds.current.add(row.id);
      const type: ToastType = TOAST_TYPES.includes(row.type as ToastType)
        ? (row.type as ToastType)
        : "info";
      notify[type](row.message, row.detail ?? undefined);
    }
  }, [data, notify]);

  return null;
}
