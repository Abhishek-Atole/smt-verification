import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { useLogStore } from "@/store/useLogStore";

const iconByType = {
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
};

const colorByType = {
  success: "text-green-500",
  error: "text-red-500",
  warning: "text-amber-500",
  info: "text-blue-500",
};

export function LogPanel() {
  const logs = useLogStore((state) => state.logs);
  const clearLogs = useLogStore((state) => state.clearLogs);
  const [confirmClear, setConfirmClear] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    scroller.scrollTop = scroller.scrollHeight;
  }, [logs]);

  const sortedLogs = useMemo(() => [...logs], [logs]);

  const exportLogs = () => {
    const payload = JSON.stringify(sortedLogs, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ucal-smt-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold">Log Panel</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportLogs}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-secondary"
          >
            <Download className="h-3.5 w-3.5" /> EXPORT LOG
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirmClear) {
                clearLogs();
                setConfirmClear(false);
                return;
              }
              setConfirmClear(true);
            }}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-secondary"
          >
            <Trash2 className="h-3.5 w-3.5" /> {confirmClear ? "CONFIRM?" : "CLEAR LOG"}
          </button>
        </div>
      </header>

      <div
        ref={scrollerRef}
        className="h-[280px] overflow-y-auto px-3 py-2 text-xs"
        style={{ scrollbarWidth: "thin" }}
      >
        {sortedLogs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No events recorded yet
          </div>
        ) : (
          <ul className="space-y-1">
            {sortedLogs.map((entry, idx) => (
              <li
                key={entry.id}
                className={`rounded px-2 py-1 animate-logEntryFadeIn ${idx === sortedLogs.length - 1 ? "recent-log-highlight" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleTimeString("en-GB", { hour12: false })}
                  </span>
                  <span className={colorByType[entry.type]}>{iconByType[entry.type]}</span>
                  {entry.feederId && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
                      {entry.feederId}
                    </span>
                  )}
                  <span className="text-foreground">{entry.message}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
