import { useState } from "react";

interface Props {
  title: string;
  message: string;
  confirmText?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  requireType?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title, message, confirmText, cancelLabel = "Cancel", confirmLabel = "Confirm",
  requireType, danger, onConfirm, onCancel,
}: Props) {
  const [typed, setTyped] = useState("");
  const canConfirm = requireType ? typed === requireType : true;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex",
        alignItems: "center", justifyContent: "center", zIndex: 10000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          width: 420, maxWidth: "90vw", background: "#111827", borderRadius: 12,
          border: `1px solid ${danger ? "#ff4444" : "#1e2a3a"}`, padding: "1.5rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 0.5rem", color: danger ? "#ff4444" : "#e2e8f0" }}>
          {title}
        </h2>
        <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5, margin: "0 0 1rem" }}>
          {message}
        </p>
        {requireType && (
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>
              Type <span style={{ color: "#00d4ff", fontWeight: 600 }}>{requireType}</span> to confirm:
            </div>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              style={{
                width: "100%", padding: "0.5rem 0.75rem", background: "#0d1224",
                border: "1px solid #1e2a3a", borderRadius: 6, color: "#e2e8f0",
                fontFamily: "inherit", fontSize: 13, outline: "none", boxSizing: "border-box",
              }}
              autoFocus
            />
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              padding: "0.5rem 1rem", background: "transparent", border: "1px solid #1e2a3a",
              borderRadius: 6, color: "#94a3b8", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            style={{
              padding: "0.5rem 1rem", background: danger ? "#ff4444" : "#00d4ff",
              border: "none", borderRadius: 6, color: danger ? "#fff" : "#0a0e1a",
              fontSize: 13, fontWeight: 600, cursor: canConfirm ? "pointer" : "not-allowed",
              fontFamily: "inherit", opacity: canConfirm ? 1 : 0.4,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
