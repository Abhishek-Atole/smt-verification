import { useState, useEffect, type CSSProperties } from "react";
import {
  adminApi,
  ApiError,
  type Device,
  type DeviceType,
  type DeviceStatus,
  type SecuritySettings,
  type ActiveSession,
} from "../api";
import ConfirmModal from "../components/ConfirmModal";

const DEVICE_TYPES: DeviceType[] = ["end_device", "admin_device", "store_device", "server"];
const DEVICE_STATUSES: DeviceStatus[] = ["active", "blocked", "pending"];

const statusColors: Record<DeviceStatus, { bg: string; color: string }> = {
  active: { bg: "rgba(0,255,136,0.15)", color: "#00ff88" },
  blocked: { bg: "rgba(255,68,68,0.15)", color: "#ff4444" },
  pending: { bg: "rgba(255,170,0,0.15)", color: "#ffaa00" },
};

type NewDevice = {
  deviceType: DeviceType;
  deviceName: string;
  allowedIp: string;
  macAddress: string;
  status: DeviceStatus;
};

const EMPTY_DEVICE: NewDevice = {
  deviceType: "end_device",
  deviceName: "",
  allowedIp: "",
  macAddress: "",
  status: "active",
};

export default function AccessControl() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newDevice, setNewDevice] = useState<NewDevice>(EMPTY_DEVICE);
  const [editDevice, setEditDevice] = useState<Device | null>(null);
  const [editForm, setEditForm] = useState<NewDevice>(EMPTY_DEVICE);
  const [deleteTarget, setDeleteTarget] = useState<Device | null>(null);
  const [logoutTarget, setLogoutTarget] = useState<ActiveSession | null>(null);
  const [settingsStatus, setSettingsStatus] = useState("");

  function openEditDevice(d: Device) {
    setError("");
    setEditForm({
      deviceType: d.deviceType,
      deviceName: d.deviceName,
      allowedIp: d.allowedIp,
      macAddress: d.macAddress ?? "",
      status: d.status,
    });
    setEditDevice(d);
  }

  async function handleSaveDeviceEdit() {
    if (!editDevice) return;
    if (!editForm.deviceName.trim() || !editForm.allowedIp.trim()) {
      setError("Device name and allowed IP are required.");
      return;
    }
    try {
      await adminApi.updateDevice(editDevice.id, {
        deviceType: editForm.deviceType,
        deviceName: editForm.deviceName.trim(),
        allowedIp: editForm.allowedIp.trim(),
        macAddress: editForm.macAddress.trim() || undefined,
        status: editForm.status,
      });
      setEditDevice(null);
      setError("");
      await loadDevices();
    } catch (e) {
      reportError(e, "Failed to update device.");
    }
  }

  function reportError(e: unknown, fallback: string) {
    setError(e instanceof ApiError ? e.message : fallback);
  }

  async function loadDevices() {
    const res = await adminApi.listDevices();
    setDevices(res.devices);
  }

  async function loadSessions() {
    const res = await adminApi.activeSessions();
    setSessions(res.sessions);
  }

  useEffect(() => {
    (async () => {
      try {
        const [dev, sec, sess] = await Promise.all([
          adminApi.listDevices(),
          adminApi.getSecuritySettings(),
          adminApi.activeSessions(),
        ]);
        setDevices(dev.devices);
        setSettings(sec.settings);
        setSessions(sess.sessions);
      } catch (e) {
        reportError(e, "Failed to load access control data.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleAddDevice() {
    if (!newDevice.deviceName.trim() || !newDevice.allowedIp.trim()) {
      setError("Device name and allowed IP are required.");
      return;
    }
    try {
      await adminApi.createDevice({
        deviceType: newDevice.deviceType,
        deviceName: newDevice.deviceName.trim(),
        allowedIp: newDevice.allowedIp.trim(),
        macAddress: newDevice.macAddress.trim() || undefined,
        status: newDevice.status,
      });
      setNewDevice(EMPTY_DEVICE);
      setError("");
      await loadDevices();
    } catch (e) {
      reportError(e, "Failed to add device.");
    }
  }

  async function handleToggleBlock(d: Device) {
    const status: DeviceStatus = d.status === "blocked" ? "active" : "blocked";
    try {
      await adminApi.updateDevice(d.id, { status });
      setError("");
      await loadDevices();
    } catch (e) {
      reportError(e, "Failed to update device.");
    }
  }

  async function handleDeleteDevice(d: Device) {
    setDeleteTarget(d);
  }

  async function confirmDeleteDevice() {
    if (!deleteTarget) return;
    try {
      await adminApi.deleteDevice(deleteTarget.id);
      setDeleteTarget(null);
      setError("");
      await loadDevices();
    } catch (e) {
      setDeleteTarget(null);
      reportError(e, "Failed to delete device.");
    }
  }

  async function handleForceLogout(s: ActiveSession) {
    setLogoutTarget(s);
  }

  async function confirmForceLogout() {
    if (!logoutTarget) return;
    try {
      await adminApi.forceLogout(logoutTarget.userId);
      setLogoutTarget(null);
      setError("");
      await loadSessions();
    } catch (e) {
      setLogoutTarget(null);
      reportError(e, "Failed to force logout.");
    }
  }

  async function handleSaveSettings() {
    if (!settings) return;
    setSettingsStatus("");
    try {
      const res = await adminApi.updateSecuritySettings({
        maintenanceMode: settings.maintenanceMode,
        failedAttemptThreshold: settings.failedAttemptThreshold,
        sessionTimeoutEndDeviceSec: settings.sessionTimeoutEndDeviceSec,
        sessionTimeoutStoreDeviceSec: settings.sessionTimeoutStoreDeviceSec,
        sessionTimeoutAdminDeviceSec: settings.sessionTimeoutAdminDeviceSec,
      });
      setSettings(res.settings);
      setSettingsStatus("Saved.");
    } catch (e) {
      setSettingsStatus(e instanceof ApiError ? e.message : "Failed to save settings.");
    }
  }

  function patchSettings(patch: Partial<SecuritySettings>) {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setSettingsStatus("");
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 1.5rem", color: "#e2e8f0" }}>
        Access Control
      </h1>

      {error && (
        <div style={{
          marginBottom: "1rem", padding: "0.5rem 0.75rem", borderRadius: 6, fontSize: 12,
          background: "rgba(255,68,68,0.1)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.3)",
        }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: "2rem 0" }}>Loading…</div>
      ) : (
        <>
          {/* ─── Devices ─────────────────────────────────────────────── */}
          <section style={cardStyle}>
            <h2 style={sectionTitle}>Devices &amp; IP Allow-list</h2>
            <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e2a3a" }}>
                    {["Type", "Name", "Allowed IP", "MAC", "Status", "Actions"].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {devices.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>No devices</td></tr>
                  )}
                  {devices.map((d) => (
                    <tr key={d.id} style={{ borderBottom: "1px solid rgba(30,42,58,0.5)" }}>
                      <td style={{ padding: "0.5rem 0.75rem", color: "#94a3b8", fontSize: 12 }}>{d.deviceType}</td>
                      <td style={{ padding: "0.5rem 0.75rem", color: "#cbd5e1" }}>{d.deviceName}</td>
                      <td style={{ padding: "0.5rem 0.75rem", color: "#cbd5e1" }}>
                        {d.allowedIp}
                        {/* Module 10.2 — a stored value the strict validator rejects
                            (written before the 2026-08-30 fix). Display-only: the
                            value is left exactly as stored; an admin must edit and
                            re-save it, which then goes through the validator. */}
                        {d.allowedIpValid === false && (
                          <span
                            title="Invalid IP entry — this value fails validation and matches no device. Edit and re-save it with a valid IP or CIDR range."
                            style={{
                              marginLeft: 8, fontSize: 11, padding: "2px 7px", borderRadius: 4,
                              background: "rgba(255,68,68,0.15)", color: "#ff4444",
                              whiteSpace: "nowrap",
                            }}
                          >
                            ⚠ Invalid IP entry — review and correct
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "0.5rem 0.75rem", color: "#64748b", fontSize: 12 }}>{d.macAddress ?? "—"}</td>
                      <td style={{ padding: "0.5rem 0.75rem" }}>
                        <span style={{
                          fontSize: 11, padding: "2px 7px", borderRadius: 4,
                          background: statusColors[d.status].bg, color: statusColors[d.status].color,
                        }}>
                          {d.status}
                        </span>
                      </td>
                      <td style={{ padding: "0.5rem 0.75rem" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => openEditDevice(d)}
                            style={{ ...tinyBtn, color: "#00d4ff" }} title="Edit device details / correct allowed IP">
                            Edit
                          </button>
                          <button onClick={() => handleToggleBlock(d)}
                            style={{ ...tinyBtn, color: d.status === "blocked" ? "#00ff88" : "#ffaa00" }}>
                            {d.status === "blocked" ? "Activate" : "Block"}
                          </button>
                          <button onClick={() => handleDeleteDevice(d)}
                            style={{ ...tinyBtn, color: "#ff4444" }}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <div style={fieldLabel}>Type</div>
                <select value={newDevice.deviceType}
                  onChange={(e) => setNewDevice({ ...newDevice, deviceType: e.target.value as DeviceType })}
                  style={selectStyle}>
                  {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <div style={fieldLabel}>Name</div>
                <input value={newDevice.deviceName}
                  onChange={(e) => setNewDevice({ ...newDevice, deviceName: e.target.value })}
                  style={inputStyle} placeholder="Line 1 scanner" />
              </div>
              <div>
                <div style={fieldLabel}>Allowed IP</div>
                <input value={newDevice.allowedIp}
                  onChange={(e) => setNewDevice({ ...newDevice, allowedIp: e.target.value })}
                  style={inputStyle} placeholder="192.168.1.20 or 192.168.1.0/24" />
              </div>
              <div>
                <div style={fieldLabel}>MAC (optional)</div>
                <input value={newDevice.macAddress}
                  onChange={(e) => setNewDevice({ ...newDevice, macAddress: e.target.value })}
                  style={inputStyle} placeholder="AA:BB:CC:DD:EE:FF" />
              </div>
              <div>
                <div style={fieldLabel}>Status</div>
                <select value={newDevice.status}
                  onChange={(e) => setNewDevice({ ...newDevice, status: e.target.value as DeviceStatus })}
                  style={selectStyle}>
                  {DEVICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <button onClick={handleAddDevice} style={actionBtn}>+ Add device</button>
            </div>
          </section>

          {/* ─── Security Settings ───────────────────────────────────── */}
          <section style={cardStyle}>
            <h2 style={sectionTitle}>Security Settings</h2>
            {!settings ? (
              <div style={{ fontSize: 12, color: "#475569" }}>No settings row found.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 460 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#cbd5e1", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={settings.maintenanceMode}
                    onChange={(e) => patchSettings({ maintenanceMode: e.target.checked })}
                  />
                  Maintenance mode (blocks all non-admin devices)
                </label>

                <div style={settingRow}>
                  <span style={settingLabel}>Failed-attempt lockout threshold</span>
                  <input
                    type="number" min={1} max={50}
                    value={settings.failedAttemptThreshold}
                    onChange={(e) => patchSettings({ failedAttemptThreshold: Number(e.target.value) })}
                    style={numInput}
                  />
                </div>

                <div style={settingRow}>
                  <span style={settingLabel}>Session timeout — end device (sec)</span>
                  <input
                    type="number" min={60} max={86400}
                    value={settings.sessionTimeoutEndDeviceSec}
                    onChange={(e) => patchSettings({ sessionTimeoutEndDeviceSec: Number(e.target.value) })}
                    style={numInput}
                  />
                </div>
                <div style={settingRow}>
                  <span style={settingLabel}>Session timeout — store device (sec)</span>
                  <input
                    type="number" min={60} max={86400}
                    value={settings.sessionTimeoutStoreDeviceSec}
                    onChange={(e) => patchSettings({ sessionTimeoutStoreDeviceSec: Number(e.target.value) })}
                    style={numInput}
                  />
                </div>
                <div style={settingRow}>
                  <span style={settingLabel}>Session timeout — admin device (sec)</span>
                  <input
                    type="number" min={60} max={86400}
                    value={settings.sessionTimeoutAdminDeviceSec}
                    onChange={(e) => patchSettings({ sessionTimeoutAdminDeviceSec: Number(e.target.value) })}
                    style={numInput}
                  />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={handleSaveSettings} style={actionBtn}>Save settings</button>
                  {settingsStatus && (
                    <span style={{ fontSize: 12, color: settingsStatus === "Saved." ? "#00ff88" : "#ff4444" }}>
                      {settingsStatus}
                    </span>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ─── Active Sessions ─────────────────────────────────────── */}
          <section style={cardStyle}>
            <h2 style={sectionTitle}>Active Sessions ({sessions.length})</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e2a3a" }}>
                    {["User", "Role", "Device", "IP", "Signed in", "Expires", ""].map((h, i) => (
                      <th key={i} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>No active sessions</td></tr>
                  )}
                  {sessions.map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid rgba(30,42,58,0.5)" }}>
                      <td style={{ padding: "0.5rem 0.75rem", color: "#cbd5e1" }}>{s.userName}</td>
                      <td style={{ padding: "0.5rem 0.75rem", color: "#94a3b8", fontSize: 12 }}>{s.role}</td>
                      <td style={{ padding: "0.5rem 0.75rem", color: "#94a3b8", fontSize: 12 }}>{s.deviceType}</td>
                      <td style={{ padding: "0.5rem 0.75rem", color: "#64748b", fontSize: 12 }}>{s.ip ?? "—"}</td>
                      <td style={{ padding: "0.5rem 0.75rem", color: "#64748b", fontSize: 12 }}>{new Date(s.issuedAt).toLocaleString()}</td>
                      <td style={{ padding: "0.5rem 0.75rem", color: "#64748b", fontSize: 12 }}>{new Date(s.expiresAt).toLocaleString()}</td>
                      <td style={{ padding: "0.5rem 0.75rem" }}>
                        <button onClick={() => handleForceLogout(s)} style={{ ...tinyBtn, color: "#ff4444" }}>
                          Force logout
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ─── Edit device modal ─────────────────────────────────────── */}
      {editDevice && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex",
            alignItems: "center", justifyContent: "center", zIndex: 10000,
          }}
          onClick={() => setEditDevice(null)}
        >
          <div
            style={{ width: 440, maxWidth: "90vw", background: "#111827", borderRadius: 12, border: "1px solid #1e2a3a", padding: "1.5rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 0.5rem", color: "#e2e8f0" }}>Edit Device</h2>
            <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 1rem", lineHeight: 1.5 }}>
              {editDevice.allowedIpValid === false
                ? "This device's stored IP is invalid. Save a valid IP or CIDR range to fix it — the server re-validates on save."
                : "Update the device type, name, allowed IP, MAC, or status."}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <div style={fieldLabel}>Type</div>
                <select value={editForm.deviceType}
                  onChange={(e) => setEditForm({ ...editForm, deviceType: e.target.value as DeviceType })}
                  style={selectStyle}>
                  {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <div style={fieldLabel}>Status</div>
                <select value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value as DeviceStatus })}
                  style={selectStyle}>
                  {DEVICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <div style={fieldLabel}>Name *</div>
              <input value={editForm.deviceName}
                onChange={(e) => setEditForm({ ...editForm, deviceName: e.target.value })}
                style={inputStyle} placeholder="Line 1 scanner" />
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <div style={fieldLabel}>Allowed IP *</div>
              <input value={editForm.allowedIp}
                onChange={(e) => setEditForm({ ...editForm, allowedIp: e.target.value })}
                style={inputStyle} placeholder="192.168.1.20 or 192.168.1.0/24" />
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <div style={fieldLabel}>MAC (optional)</div>
              <input value={editForm.macAddress}
                onChange={(e) => setEditForm({ ...editForm, macAddress: e.target.value })}
                style={inputStyle} placeholder="AA:BB:CC:DD:EE:FF" />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: "1.25rem" }}>
              <button onClick={() => setEditDevice(null)}
                style={{ padding: "0.5rem 1rem", background: "transparent", border: "1px solid #1e2a3a", borderRadius: 6, color: "#94a3b8", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                Cancel
              </button>
              <button onClick={handleSaveDeviceEdit}
                style={{ padding: "0.5rem 1rem", background: "#00d4ff", border: "none", borderRadius: 6, color: "#0a0e1a", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete Device"
          message={`Permanently delete device "${deleteTarget.deviceName}" (${deleteTarget.allowedIp})? The IP will stop being allowed immediately.`}
          confirmLabel="Delete"
          requireType="DELETE"
          danger
          onConfirm={confirmDeleteDevice}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {logoutTarget && (
        <ConfirmModal
          title="Force Logout"
          message={`Force logout "${logoutTarget.userName}" (${logoutTarget.role})? Their session is revoked now.`}
          confirmLabel="Force logout"
          danger
          onConfirm={confirmForceLogout}
          onCancel={() => setLogoutTarget(null)}
        />
      )}
    </div>
  );
}

const cardStyle: CSSProperties = {
  background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10,
  padding: "1.25rem", marginBottom: "1.5rem",
};
const sectionTitle: CSSProperties = {
  fontSize: 13, color: "#94a3b8", fontWeight: 600, margin: "0 0 1rem",
  textTransform: "uppercase", letterSpacing: "0.06em",
};
const thStyle: CSSProperties = {
  textAlign: "left", padding: "0.5rem 0.75rem", color: "#64748b",
  fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
};
const tinyBtn: CSSProperties = {
  background: "transparent", border: "1px solid #1e2a3a", borderRadius: 5,
  padding: "3px 8px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
};
const fieldLabel: CSSProperties = { fontSize: 10, color: "#64748b", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" };
const inputStyle: CSSProperties = {
  background: "#0d1224", border: "1px solid #1e2a3a", borderRadius: 6,
  padding: "0.4rem 0.6rem", color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", minWidth: 160,
};
const selectStyle: CSSProperties = { ...inputStyle, minWidth: 130 };
const numInput: CSSProperties = { ...inputStyle, minWidth: 110 };
const actionBtn: CSSProperties = {
  background: "rgba(0,212,255,0.12)", border: "1px solid rgba(0,212,255,0.4)", borderRadius: 6,
  padding: "0.45rem 0.9rem", color: "#00d4ff", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const settingRow: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };
const settingLabel: CSSProperties = { fontSize: 13, color: "#cbd5e1" };
