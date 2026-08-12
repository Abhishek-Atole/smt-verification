import { useAdmin } from "../admin-context";
import MetricCard from "../components/MetricCard";
import StatusDot from "../components/StatusDot";
import ActivityFeed from "../components/ActivityFeed";
import MiniChart from "../components/MiniChart";
import { useEffect, useState } from "react";
import { nowFormatted } from "../admin-storage";
import { useLocation } from "wouter";
import { ADMIN_ROUTE } from "../config";

export default function Overview() {
  const {
    users, auditLog, loginEvents, dbSize, auditIntegrity,
    storageAnalysis, ready,
  } = useAdmin();
  const [now, setNow] = useState(nowFormatted());
  const [, setLocation] = useLocation();

  useEffect(() => {
    const id = setInterval(() => setNow(nowFormatted()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!ready) {
    return <div style={{ color: "#64748b", textAlign: "center", padding: "4rem" }}>Loading command center…</div>;
  }

  const activeCount = users.filter((u) => u.isActive).length;
  const chainBroken = !!auditIntegrity?.brokenAt;

  const todayStr = new Date().toISOString().slice(0, 10);
  const loginToday = loginEvents.filter((e) => {
    const d = new Date(e.createdAt);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === todayStr;
  });
  const successToday = loginToday.filter((e) => e.result === "success").length;
  const failToday = loginToday.filter((e) => e.result === "failure").length;

  const dbLatest = dbSize && dbSize.samples.length > 0 ? dbSize.samples[dbSize.samples.length - 1] : null;
  const dbMB = dbLatest ? (dbLatest.sizeBytes / 1024 / 1024).toFixed(1) : "—";
  const dbPct = dbLatest && dbSize ? ((dbLatest.sizeBytes / dbSize.maxBytes) * 100).toFixed(0) : "—";

  // Successful logins per day across the last 7 days (oldest → newest), from real events.
  const loginSeries = (() => {
    const buckets = Array(7).fill(0);
    loginEvents.forEach((e) => {
      if (e.result !== "success") return;
      const t = new Date(e.createdAt).getTime();
      if (Number.isNaN(t)) return;
      const dayIdx = Math.floor((Date.now() - t) / 86400_000);
      if (dayIdx >= 0 && dayIdx <= 6) buckets[6 - dayIdx]++;
    });
    return buckets;
  })();

  const recentLogins = loginEvents.slice(0, 5);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#e2e8f0" }}>
          LOGICVERA COMMAND CENTER
        </h1>
        <span style={{ fontSize: 12, color: "#64748b" }}>Last sync: {now}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: "1.5rem" }}>
        <MetricCard label="Users" value={users.length} sub={`${activeCount} active`} icon="👤" />
        <MetricCard label="DB Size" value={`${dbMB} MB`} sub={dbPct === "—" ? "no samples" : `${dbPct}% of budget`} icon="💾" />
        <MetricCard label="Logins Today" value={successToday} sub={`${failToday} failed`} trend={failToday > 0 ? "down" : "up"} />
        <MetricCard label="Audit Events" value={auditLog.length} sub={`chain ${chainBroken ? "broken" : "intact"}`} icon="📋" />
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: "1.5rem" }}>
        <div style={{
          flex: 2, background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem",
        }}>
          <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Login Activity (today)
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: "#64748b" }}>Successful</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#00ff88" }}>{successToday}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#64748b" }}>Failed</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: failToday ? "#ff4444" : "#00ff88" }}>{failToday}</div>
            </div>
          </div>
          {loginSeries.some((n) => n > 0) && (
            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Successful logins (7 days)</div>
              <MiniChart data={loginSeries} color="#00d4ff" type="bar" width={200} height={40} />
            </div>
          )}
        </div>

        <div style={{
          flex: 1, background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem",
        }}>
          <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            localStorage Breakdown
          </h2>
          {storageAnalysis && Object.entries(storageAnalysis.byModule).map(([mod, bytes]) => {
            const pct = storageAnalysis.totalBytes > 0 ? (bytes / storageAnalysis.totalBytes) * 100 : 0;
            const colors: Record<string, string> = { main: "#f59e0b", admin: "#8b5cf6" };
            return (
              <div key={mod} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8", marginBottom: 2 }}>
                  <span style={{ textTransform: "capitalize" }}>{mod}</span>
                  <span>{(bytes / 1024).toFixed(1)} KB</span>
                </div>
                <div style={{ height: 6, background: "#1e2a3a", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: colors[mod] ?? "#64748b", borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: "1.5rem" }}>
        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
          <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Recent Audit Events
          </h2>
          <ActivityFeed entries={auditLog} max={5} />
        </div>

        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
          <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Recent Logins ({loginEvents.length})
          </h2>
          {recentLogins.length === 0 ? (
            <div style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: "0.5rem 0" }}>No login events</div>
          ) : (
            recentLogins.map((e) => (
              <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.3rem 0", fontSize: 12 }}>
                <span style={{ color: "#cbd5e1" }}>{e.employeeId ?? "unknown"}</span>
                <span style={{ color: e.result === "success" ? "#00ff88" : "#ff4444" }}>{e.result}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
          <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Integrity Status
          </h2>
          {auditIntegrity ? (
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <StatusDot status={chainBroken ? "critical" : "healthy"} pulse />
                <span>{chainBroken ? "CHAIN BREAK DETECTED" : "ALL CLEAR"}</span>
              </div>
              <div>{auditIntegrity.total.toLocaleString()} audit rows verified</div>
              {chainBroken && <div style={{ color: "#ffaa00" }}>First break at row #{auditIntegrity.brokenAt!.id}</div>}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#475569" }}>Integrity status unavailable</div>
          )}
        </div>

        <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "1.25rem" }}>
          <h2 style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Quick Actions
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button onClick={() => setLocation(`${ADMIN_ROUTE}/integrity`)} style={quickBtnStyle}>Verify audit chain</button>
            <button onClick={() => setLocation(`${ADMIN_ROUTE}/data`)} style={quickBtnStyle}>Create backup</button>
            <button onClick={() => setLocation(`${ADMIN_ROUTE}/users`)} style={quickBtnStyle}>Manage users</button>
            <button onClick={() => {
              const csv = "timestamp,action,actor,details,outcome\n" + auditLog.map((e) =>
                `"${e.timestamp}","${e.action}","${e.actor}","${e.details.replace(/"/g, '""')}","${e.outcome}"`
              ).join("\n");
              const blob = new Blob(["﻿" + csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `audit-log-${nowFormatted().replace(/[/: ]/g, "-")}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }} style={quickBtnStyle}>Export audit log</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const quickBtnStyle: React.CSSProperties = {
  width: "100%", padding: "0.5rem 0.75rem", background: "#0d1224",
  border: "1px solid #1e2a3a", borderRadius: 6, color: "#94a3b8",
  fontSize: 12, cursor: "pointer", fontFamily: "inherit", textAlign: "left",
};
