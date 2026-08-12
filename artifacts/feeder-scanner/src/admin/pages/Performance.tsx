import { useState, useMemo } from "react";
import { useAdmin } from "../admin-context";
import MiniChart from "../components/MiniChart";

type Period = 7 | 30 | 90;

export default function PerformancePage() {
  const { dailyMetrics } = useAdmin();
  const [period, setPeriod] = useState<Period>(30);

  const sliced = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - period);
    const c = cutoff.toISOString().slice(0, 10);
    return dailyMetrics.filter((m) => m.date >= c).slice(-period);
  }, [dailyMetrics, period]);

  const loginSuccesses = sliced.map((m) => m.loginSuccesses);
  const loginFailures = sliced.map((m) => m.loginFailures);
  const scanEvents = sliced.map((m) => m.scanEvents);
  const exportEvents = sliced.map((m) => m.exportEvents);
  const errorCounts = sliced.map((m) => m.errorCount);
  const storageGrowth = sliced.map((m) => +(m.storageUsedBytes / 1024 / 1024).toFixed(2));

  const thisWeek = sliced.slice(-7);
  const prevWeek = sliced.slice(-14, -7);
  const compare = (field: keyof typeof thisWeek[number]) => {
    const now = thisWeek.reduce((s, m) => s + (m[field] as number || 0), 0);
    const prev = prevWeek.reduce((s, m) => s + ((m as any)[field] || 0), 0);
    const delta = prev > 0 ? ((now - prev) / prev) * 100 : 0;
    return { now, prev, delta: Math.round(delta * 10) / 10 };
  };

  const periodBtn = (p: Period): React.CSSProperties => ({
    padding: "0.4rem 0.75rem", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer",
    fontFamily: "inherit", background: period === p ? "#00d4ff" : "#0d1224",
    color: period === p ? "#0a0e1a" : "#64748b", fontWeight: period === p ? 600 : 400,
  });

  const cardStyle: React.CSSProperties = {
    background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#e2e8f0" }}>
          Performance
        </h1>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={periodBtn(7)} onClick={() => setPeriod(7)}>7d</button>
          <button style={periodBtn(30)} onClick={() => setPeriod(30)}>30d</button>
          <button style={periodBtn(90)} onClick={() => setPeriod(90)}>90d</button>
        </div>
      </div>

      <div style={{
        marginBottom: "1.5rem", padding: "0.75rem", borderRadius: 6, fontSize: 12,
        background: "rgba(255,170,0,0.1)", border: "1px solid rgba(255,170,0,0.3)", color: "#ffaa00",
      }}>
        Sample data — no backend metrics source yet. These daily business aggregates
        (logins, scans, exports, errors) are generated locally; wiring them to real
        server-side rollups is out of scope for this pass.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: "1.5rem" }}>
        {[
          { label: "Logins", cmp: compare("loginSuccesses"), icon: "\u2191", color: "#00ff88" },
          { label: "Scans", cmp: compare("scanEvents"), icon: "\u2191", color: "#00d4ff" },
          { label: "Exports", cmp: compare("exportEvents"), icon: "\u2191", color: "#8b5cf6" },
          { label: "Errors", cmp: compare("errorCount"), icon: "\u2193", color: "#ff4444" },
        ].map((m) => (
          <div key={m.label} style={cardStyle}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{m.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: m.color }}>{m.cmp.now}</div>
            <div style={{ fontSize: 11, color: m.cmp.delta > 0 ? (m.label === "Errors" ? "#ff4444" : "#00ff88") : "#64748b" }}>
              {m.cmp.delta > 0 ? "+" : ""}{m.cmp.delta}% vs last week
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: "1.5rem" }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Login Activity
          </div>
          <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: 11, color: "#64748b" }}>Successes</div>
              <MiniChart data={loginSuccesses} color="#00ff88" type="bar" width={200} height={40} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#64748b" }}>Failures</div>
              <MiniChart data={loginFailures} color="#ff4444" type="bar" width={200} height={40} />
            </div>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Scan Volume
          </div>
          <MiniChart data={scanEvents} color="#00d4ff" type="bar" width={400} height={40} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Export Events
          </div>
          <MiniChart data={exportEvents} color="#8b5cf6" type="line" width={400} height={40} />
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Error Rate
          </div>
          <MiniChart data={errorCounts} color="#ff4444" type="bar" width={400} height={40} />
        </div>
      </div>
    </div>
  );
}
