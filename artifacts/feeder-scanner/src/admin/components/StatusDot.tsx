interface Props {
  status: "healthy" | "warning" | "critical";
  pulse?: boolean;
  label?: string | false;
  size?: number;
}

const COLORS = { healthy: "#00ff88", warning: "#ffaa00", critical: "#ff4444" };
const LABELS = { healthy: "Healthy", warning: "Warning", critical: "Critical" };

export default function StatusDot({ status, pulse, label, size = 10 }: Props) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span
        style={{
          width: size, height: size, borderRadius: "50%", background: COLORS[status],
          display: "inline-block", flexShrink: 0,
          animation: pulse ? "adminPulse 2s ease-in-out infinite" : undefined,
          boxShadow: pulse ? `0 0 6px ${COLORS[status]}80` : undefined,
        }}
      />
      {label !== false && <span style={{ color: COLORS[status] }}>{label ?? LABELS[status]}</span>}
    </span>
  );
}
