interface Props {
  label: string;
  value: string | number;
  sub?: string;
  trend?: "up" | "down" | "flat";
  icon?: string;
  color?: string;
}

const TREND_COLORS = { up: "#00ff88", down: "#ff4444", flat: "#94a3b8" };
const TREND_ARROWS = { up: "\u2191", down: "\u2193", flat: "\u2192" };

export default function MetricCard({ label, value, sub, trend, icon, color = "#00d4ff" }: Props) {
  return (
    <div
      style={{
        background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1rem 1.25rem",
        display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </span>
        {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color }}>{value}</span>
        {trend && (
          <span style={{ fontSize: 14, color: TREND_COLORS[trend] }}>
            {TREND_ARROWS[trend]}
          </span>
        )}
      </div>
      {sub && <span style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{sub}</span>}
    </div>
  );
}
