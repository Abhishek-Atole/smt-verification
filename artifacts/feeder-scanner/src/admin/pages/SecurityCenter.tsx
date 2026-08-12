import { useMemo } from "react";
import { useAdmin } from "../admin-context";

export default function SecurityCenter() {
  const { loginEvents } = useAdmin();

  const failedLogins = useMemo(
    () => loginEvents.filter((e) => e.result === "failure"),
    [loginEvents],
  );

  // Failed-login heatmap over the last 7 days, bucketed by day-offset × hour.
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    failedLogins.forEach((e) => {
      const ts = new Date(e.createdAt).getTime();
      if (Number.isNaN(ts)) return;
      const dayIdx = Math.floor((Date.now() - ts) / 86400_000);
      if (dayIdx < 0 || dayIdx > 6) return;
      grid[dayIdx][new Date(ts).getHours()]++;
    });
    return grid;
  }, [failedLogins]);

  // Brute-force heuristic: any failure with ≥10 sibling failures inside a 1h
  // window (same detection the localStorage version used, now over real events).
  const bruteForceCount = useMemo(() => {
    return failedLogins.filter((e) => {
      const t = new Date(e.createdAt).getTime();
      const nearby = failedLogins.filter(
        (x) => Math.abs(new Date(x.createdAt).getTime() - t) < 3600_000,
      );
      return nearby.length >= 10;
    }).length;
  }, [failedLogins]);

  const recentFailures = useMemo(() => failedLogins.slice(0, 12), [failedLogins]);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 1.5rem", color: "#e2e8f0" }}>
        Security Center
      </h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: "1.5rem" }}>
        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
          <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Recent Failed Logins ({failedLogins.length})
          </h2>
          {recentFailures.length === 0 ? (
            <div style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: "1rem 0" }}>No failed logins</div>
          ) : (
            recentFailures.map((e) => (
              <div key={e.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "0.5rem 0", borderBottom: "1px solid rgba(30,42,58,0.5)", fontSize: 12,
              }}>
                <div>
                  <div style={{ color: "#cbd5e1", fontWeight: 600 }}>{e.employeeId ?? "unknown"}</div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>
                    {e.ip ?? "no-ip"} &middot; {e.failureReason ?? "failure"}
                  </div>
                </div>
                <div style={{ color: "#64748b", fontSize: 11 }}>
                  {new Date(e.createdAt).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
          <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Failed Login Heatmap (7d)
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr>
                  <th style={{ color: "#64748b", padding: 2, width: 30 }}></th>
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h} style={{ color: "#64748b", padding: "1px 2px", fontWeight: 400, fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.map((row, di) => (
                  <tr key={di}>
                    <td style={{ color: "#64748b", padding: "1px 2px", fontSize: 9 }}>
                      {di === 0 ? "Today" : `${di}d`}
                    </td>
                    {row.map((count, hi) => {
                      const intensity = count === 0 ? "#0d1224" : count <= 2 ? "rgba(255,170,0,0.4)" : "rgba(255,68,68,0.6)";
                      return (
                        <td
                          key={hi}
                          style={{
                            width: 16, height: 16, background: intensity, borderRadius: 2,
                            textAlign: "center", fontSize: 8, color: count > 2 ? "#fff" : "transparent",
                          }}
                          title={`Day -${di}, Hour ${hi}: ${count} failures`}
                        >
                          {count > 0 ? count : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
        <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Anomaly Alerts
        </h2>
        {bruteForceCount < 10 ? (
          <div style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: "1rem 0" }}>
            No anomalies detected
          </div>
        ) : (
          <div style={{
            padding: "0.5rem 0.75rem", background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.3)",
            borderRadius: 6, fontSize: 12, color: "#ff4444", display: "flex", justifyContent: "space-between",
          }}>
            <span>Brute force pattern detected ({bruteForceCount} failures clustered within 1h windows)</span>
            <span style={{ opacity: 0.6, fontSize: 11 }}>HIGH</span>
          </div>
        )}
      </div>
    </div>
  );
}
