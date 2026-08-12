import { useAdmin } from "../admin-context";
import MiniChart from "../components/MiniChart";

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export default function SystemHealth() {
  const { metricsLatest, metricsHistory, storageAnalysis } = useAdmin();

  const cpuPct = metricsLatest ? Math.round(metricsLatest.cpu * 100) : 0;
  const memPct = metricsLatest && metricsLatest.ramTotal > 0
    ? Math.round((metricsLatest.ramUsed / metricsLatest.ramTotal) * 100)
    : 0;
  const storagePct = storageAnalysis ? Math.round(storageAnalysis.usedPercent) : 0;

  const cpuSeries = metricsHistory.map((s) => Math.round(s.cpu * 100));
  const memSeries = metricsHistory.map((s) => s.ramTotal > 0 ? Math.round((s.ramUsed / s.ramTotal) * 100) : 0);

  const ringStyle = (pct: number, color: string) => ({
    width: 100, height: 100, borderRadius: "50%",
    background: `conic-gradient(${color} ${pct}%, #1e2a3a ${pct}%)`,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 18, fontWeight: 700, color: "#e2e8f0",
  });

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 1.5rem", color: "#e2e8f0" }}>
        System Health
      </h1>

      {!metricsLatest && (
        <div style={{
          marginBottom: "1.5rem", padding: "0.75rem", borderRadius: 6, fontSize: 12,
          background: "rgba(255,170,0,0.1)", border: "1px solid rgba(255,170,0,0.3)", color: "#ffaa00",
        }}>
          No server metrics available yet — the sampler populates a point every 5 s. CPU and memory
          rings will fill in shortly.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: "1.5rem" }}>
        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Server CPU</div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={ringStyle(cpuPct, cpuPct > 80 ? "#ff4444" : "#00ff88")}>
              {cpuPct}%
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>1-min load avg ÷ cores</div>
        </div>

        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Server Memory</div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={ringStyle(memPct, memPct > 80 ? "#ff4444" : "#00d4ff")}>
              {memPct}%
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
            {metricsLatest ? `${fmtBytes(metricsLatest.ramUsed)} / ${fmtBytes(metricsLatest.ramTotal)}` : "—"}
          </div>
        </div>

        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>localStorage</div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={ringStyle(storagePct, storagePct > 80 ? "#ff4444" : "#f59e0b")}>
              {storagePct}%
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
            {storageAnalysis ? (storageAnalysis.totalBytes / 1024 / 1024).toFixed(2) : "—"} MB / 5 MB
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: "1.5rem" }}>
        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
          <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Database Connection Pool
          </h2>
          {metricsLatest ? (
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", fontSize: 13 }}>
              <span style={{ color: "#64748b" }}>Total connections</span>
              <span style={{ color: "#cbd5e1" }}>{metricsLatest.dbPoolTotal}</span>
              <span style={{ color: "#64748b" }}>Idle</span>
              <span style={{ color: "#cbd5e1" }}>{metricsLatest.dbPoolIdle}</span>
              <span style={{ color: "#64748b" }}>Waiting</span>
              <span style={{ color: metricsLatest.dbPoolWaiting > 0 ? "#ffaa00" : "#cbd5e1" }}>
                {metricsLatest.dbPoolWaiting}
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: "1rem" }}>No pool data</div>
          )}
          {cpuSeries.length > 1 && (
            <div style={{ marginTop: "1rem" }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>CPU % (last {cpuSeries.length} samples)</div>
              <MiniChart data={cpuSeries} color="#00ff88" type="line" width={280} height={40} />
            </div>
          )}
          {memSeries.length > 1 && (
            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Memory % (last {memSeries.length} samples)</div>
              <MiniChart data={memSeries} color="#00d4ff" type="line" width={280} height={40} />
            </div>
          )}
        </div>

        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
          <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Largest Storage Keys
          </h2>
          {storageAnalysis && storageAnalysis.largestKeys.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e2a3a" }}>
                  <th style={{ textAlign: "left", padding: "0.3rem 0.5rem", color: "#64748b", fontWeight: 600 }}>Key</th>
                  <th style={{ textAlign: "right", padding: "0.3rem 0.5rem", color: "#64748b", fontWeight: 600 }}>Size</th>
                </tr>
              </thead>
              <tbody>
                {storageAnalysis.largestKeys.slice(0, 8).map((k) => (
                  <tr key={k.key} style={{ borderBottom: "1px solid rgba(30,42,58,0.5)" }}>
                    <td style={{ padding: "0.3rem 0.5rem", color: "#94a3b8", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {k.key}
                    </td>
                    <td style={{ padding: "0.3rem 0.5rem", color: "#cbd5e1", textAlign: "right" }}>
                      {(k.sizeBytes / 1024).toFixed(1)} KB
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: "1rem" }}>No storage data</div>
          )}
        </div>
      </div>

      <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
        <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Storage Health &mdash; Per Module
        </h2>
        {storageAnalysis && Object.entries(storageAnalysis.byModule).length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(storageAnalysis.byModule).map(([mod, bytes]) => {
              const pct = storageAnalysis.totalBytes > 0 ? (bytes / storageAnalysis.totalBytes) * 100 : 0;
              const colors: Record<string, string> = { main: "#f59e0b", admin: "#8b5cf6" };
              return (
                <div key={mod}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8", marginBottom: 2 }}>
                    <span style={{ textTransform: "capitalize" }}>{mod}</span>
                    <span>{(bytes / 1024).toFixed(1)} KB ({pct.toFixed(0)}%)</span>
                  </div>
                  <div style={{ height: 12, background: "#1e2a3a", borderRadius: 6, overflow: "hidden" }}>
                    <div style={{
                      width: `${pct}%`, height: "100%", background: colors[mod] ?? "#64748b",
                      borderRadius: 6, transition: "width 0.5s",
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: "1rem" }}>No modules found</div>
        )}
      </div>
    </div>
  );
}
