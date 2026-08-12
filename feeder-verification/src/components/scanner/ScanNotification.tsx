"use client";

interface ScanNotificationProps {
  type: "ok" | "err" | "alt";
  message: string;
  onClose?: () => void;
}

export function ScanNotification({ type, message, onClose }: ScanNotificationProps) {
  const colorByType: Record<ScanNotificationProps["type"], string> = {
    ok: "bg-emerald-50 border-emerald-300 text-emerald-900",
    err: "bg-red-50 border-red-300 text-red-900",
    alt: "bg-amber-50 border-amber-300 text-amber-900",
  };

  return (
    <div className={`fixed bottom-4 right-4 rounded-md border px-4 py-3 shadow ${colorByType[type]}`}>
      <div className="flex items-start gap-3">
        <p className="text-sm font-medium">{message}</p>
        {onClose ? (
          <button onClick={onClose} className="text-xs text-neutral-600 hover:text-neutral-900">
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}
