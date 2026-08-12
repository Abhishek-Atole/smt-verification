import type { AuditEntry } from "../admin-types";

interface Props {
  entries: AuditEntry[];
  max?: number;
}

const OUTCOME_STYLES: Record<string, { bg: string; color: string }> = {
  success: { bg: "rgba(0,255,136,0.1)", color: "#00ff88" },
  failure: { bg: "rgba(255,68,68,0.1)", color: "#ff4444" },
  warning: { bg: "rgba(255,170,0,0.1)", color: "#ffaa00" },
};

export default function ActivityFeed({ entries, max = 5 }: Props) {
  const shown = entries.slice(-max).reverse();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {shown.length === 0 && (
        <div style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: "1rem 0" }}>
          No recent events
        </div>
      )}
      {shown.map((e) => {
        const style = OUTCOME_STYLES[e.outcome] ?? OUTCOME_STYLES.success;
        return (
          <div
            key={e.id}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "0.4rem 0.6rem",
              background: "rgba(255,255,255,0.02)", borderRadius: 6, fontSize: 12,
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: "50%", background: style.color,
              flexShrink: 0,
            }} />
            <span style={{ color: "#64748b", flexShrink: 0, fontSize: 11 }}>
              {e.timestamp.split(" ")[1]}
            </span>
            <span style={{ color: "#94a3b8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.details}
            </span>
            <span style={{
              fontSize: 10, padding: "1px 5px", borderRadius: 4, background: style.bg, color: style.color,
              flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.04em",
            }}>
              {e.outcome}
            </span>
          </div>
        );
      })}
    </div>
  );
}
