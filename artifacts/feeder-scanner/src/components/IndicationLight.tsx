import { AlertTriangle, BellOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { stopAlarm, useIndicationStore } from "@/utils/indication";

const LED_COLOR: Record<string, string> = {
  idle: "bg-muted-foreground/30",
  ok: "bg-green-500 shadow-[0_0_12px_2px_rgba(34,197,94,0.7)]",
  fail: "bg-red-500 shadow-[0_0_12px_2px_rgba(239,68,68,0.7)]",
  alarm: "bg-red-600 shadow-[0_0_16px_4px_rgba(220,38,38,0.85)] animate-pulse",
};

const LED_LABEL: Record<string, string> = {
  idle: "Ready",
  ok: "OK",
  fail: "Reject",
  alarm: "ALARM",
};

/**
 * Global on-screen indicator: a small always-visible LED reflecting the last
 * scan result, plus a blocking overlay + "Stop Buzzer" button while the
 * 3-strike continuous alarm is ringing. Mounted once in the authed shell.
 */
export function IndicationLight() {
  const led = useIndicationStore((s) => s.led);
  const alarmActive = useIndicationStore((s) => s.alarmActive);
  const alarmMessage = useIndicationStore((s) => s.alarmMessage);

  return (
    <>
      {/* Always-on LED status pill */}
      <div className="fixed bottom-3 left-3 z-[9998] flex items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-1.5 shadow-md backdrop-blur">
        <span className={cn("inline-block h-3.5 w-3.5 rounded-full transition-colors", LED_COLOR[led])} />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{LED_LABEL[led]}</span>
      </div>

      {/* Blocking alarm overlay */}
      {alarmActive && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border-2 border-red-600 bg-card p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-9 w-9 text-red-600 animate-pulse" />
            </div>
            <h2 className="text-xl font-bold text-red-700">Repeated Reject</h2>
            <p className="mt-2 text-sm text-foreground">
              {alarmMessage ?? "The same scan was rejected 3 times."}
            </p>
            <button
              type="button"
              onClick={stopAlarm}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-red-700"
              autoFocus
            >
              <BellOff className="h-5 w-5" />
              Stop Buzzer &amp; Acknowledge
            </button>
          </div>
        </div>
      )}
    </>
  );
}
