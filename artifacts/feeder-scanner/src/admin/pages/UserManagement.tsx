import { useState, useMemo } from "react";
import { useAdmin } from "../admin-context";
import { adminApi, ApiError, type AdminUser, type UserRole } from "../api";
import ConfirmModal from "../components/ConfirmModal";

const ROLES: UserRole[] = ["operator", "qa", "supervisor", "admin", "storekeeper"];

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let pw = "";
  for (let i = 0; i < 14; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  if (!/[A-Z]/.test(pw)) pw = "A" + pw.slice(1);
  if (!/[0-9]/.test(pw)) pw = pw.slice(0, -1) + "7";
  if (!/[!@#$%]/.test(pw)) pw = pw.slice(0, -2) + "@";
  return pw;
}

export default function UserManagement() {
  const { users, refreshAll } = useAdmin();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", employeeId: "", role: "operator" as UserRole, password: "" });
  const [showResetModal, setShowResetModal] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<AdminUser | null>(null);
  const [disablePrompt, setDisablePrompt] = useState<AdminUser | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    let items = users;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((u) =>
        u.name.toLowerCase().includes(q) ||
        (u.employeeId ?? "").toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q));
    }
    if (roleFilter) items = items.filter((u) => u.role === roleFilter);
    if (statusFilter === "active") items = items.filter((u) => u.isActive);
    if (statusFilter === "disabled") items = items.filter((u) => !u.isActive);
    return items;
  }, [users, search, roleFilter, statusFilter]);

  function reportError(e: unknown, fallback: string) {
    setError(e instanceof ApiError ? e.message : fallback);
  }

  async function handleCreate() {
    if (!newUser.name.trim() || !newUser.employeeId.trim() || newUser.password.length < 8) {
      setError("Name, employee ID, and an 8+ character password are required.");
      return;
    }
    try {
      await adminApi.createUser({
        name: newUser.name.trim(),
        employeeId: newUser.employeeId.trim(),
        role: newUser.role,
        password: newUser.password,
      });
      setShowCreate(false);
      setNewUser({ name: "", employeeId: "", role: "operator", password: "" });
      setError("");
      await refreshAll();
    } catch (e) {
      reportError(e, "Failed to create user.");
    }
  }

  async function handleResetPassword(userId: string) {
    const pw = generateTempPassword();
    try {
      await adminApi.resetPassword(userId, pw);
      setGeneratedPassword(pw);
      setShowResetModal(userId);
      setError("");
      await refreshAll();
    } catch (e) {
      reportError(e, "Failed to reset password.");
    }
  }

  async function handleToggleActive(user: AdminUser) {
    try {
      await adminApi.updateUser(user.id, { isActive: !user.isActive });
      setError("");
      await refreshAll();
    } catch (e) {
      reportError(e, "Failed to update user.");
    }
  }

  async function handleDelete(user: AdminUser) {
    try {
      await adminApi.deleteUser(user.id);
      setShowDeleteModal(null);
      setError("");
      await refreshAll();
    } catch (e) {
      setShowDeleteModal(null);
      // Backend returns 409 when the user has dependent records (FK RESTRICT).
      // Per PRD, such users are Disabled, not Deleted — offer that instead.
      if (e instanceof ApiError && e.status === 409) {
        setDisablePrompt(user);
      } else {
        reportError(e, "Failed to delete user.");
      }
    }
  }

  async function handleDisableInstead(user: AdminUser) {
    try {
      await adminApi.updateUser(user.id, { isActive: false });
      setDisablePrompt(null);
      setError("");
      await refreshAll();
    } catch (e) {
      setDisablePrompt(null);
      reportError(e, "Failed to disable user.");
    }
  }

  const roleColors: Record<string, { bg: string; color: string }> = {
    operator: { bg: "rgba(0,212,255,0.12)", color: "#00d4ff" },
    qa: { bg: "rgba(0,255,136,0.12)", color: "#00ff88" },
    supervisor: { bg: "rgba(255,170,0,0.12)", color: "#ffaa00" },
    admin: { bg: "rgba(139,92,246,0.12)", color: "#8b5cf6" },
    storekeeper: { bg: "rgba(236,72,153,0.12)", color: "#ec4899" },
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#e2e8f0" }}>
          User Management
        </h1>
        <button onClick={() => { setError(""); setShowCreate(true); }} style={actionBtn}>
          + Create User
        </button>
      </div>

      {error && (
        <div style={{
          marginBottom: "1rem", padding: "0.5rem 0.75rem", borderRadius: 6, fontSize: 12,
          background: "rgba(255,68,68,0.1)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.3)",
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: "1rem" }}>
        <input
          placeholder="Search by name, employee ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1, padding: "0.5rem 0.75rem", background: "#0d1224", border: "1px solid #1e2a3a",
            borderRadius: 6, color: "#e2e8f0", fontFamily: "inherit", fontSize: 13, outline: "none",
          }}
        />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          style={selectStyle}>
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          style={selectStyle}>
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e2a3a" }}>
              {["Name", "Employee ID", "Role", "Status", "Created", "Actions"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "0.6rem 0.75rem", color: "#64748b", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>No users found</td></tr>
            )}
            {filtered.map((u) => (
              <tr key={u.id} style={{ borderBottom: "1px solid rgba(30,42,58,0.5)", background: u.isActive ? undefined : "rgba(255,68,68,0.03)" }}>
                <td style={{ padding: "0.5rem 0.75rem", color: "#cbd5e1" }}>{u.name}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: "#94a3b8", fontSize: 12 }}>{u.employeeId ?? "—"}</td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <span style={{
                    fontSize: 11, padding: "2px 7px", borderRadius: 4,
                    background: roleColors[u.role]?.bg ?? "rgba(100,116,139,0.15)",
                    color: roleColors[u.role]?.color ?? "#94a3b8",
                  }}>
                    {u.role}
                  </span>
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <span style={{
                    fontSize: 11, padding: "2px 7px", borderRadius: 4,
                    background: u.isActive ? "rgba(0,255,136,0.15)" : "rgba(255,68,68,0.15)",
                    color: u.isActive ? "#00ff88" : "#ff4444",
                  }}>
                    {u.isActive ? "Active" : "Disabled"}
                  </span>
                </td>
                <td style={{ padding: "0.5rem 0.75rem", color: "#64748b", fontSize: 12 }}>
                  {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => handleResetPassword(u.id)}
                      style={tinyBtn} title="Reset password">
                      Reset PW
                    </button>
                    <button onClick={() => handleToggleActive(u)}
                      style={{ ...tinyBtn, color: u.isActive ? "#ffaa00" : "#00ff88" }}>
                      {u.isActive ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => setShowDeleteModal(u)}
                      style={{ ...tinyBtn, color: "#ff4444" }} title="Delete user">
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex",
            alignItems: "center", justifyContent: "center", zIndex: 10000,
          }}
          onClick={() => setShowCreate(false)}
        >
          <div
            style={{ width: 400, maxWidth: "90vw", background: "#111827", borderRadius: 12, border: "1px solid #1e2a3a", padding: "1.5rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 1rem", color: "#e2e8f0" }}>Create User</h2>
            <div style={{ marginBottom: "0.75rem" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Name *</div>
              <input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                style={inputStyle} placeholder="Full name" />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Employee ID *</div>
              <input value={newUser.employeeId} onChange={(e) => setNewUser({ ...newUser, employeeId: e.target.value })}
                style={inputStyle} placeholder="e.g. operator3" />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Role</div>
              <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                style={selectStyle}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Temporary password * (min 8 chars)</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  style={{ ...inputStyle, flex: 1 }} placeholder="Password" />
                <button
                  onClick={() => setNewUser({ ...newUser, password: generateTempPassword() })}
                  style={{ ...tinyBtn, whiteSpace: "nowrap", padding: "0 0.6rem" }}>
                  Generate
                </button>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setShowCreate(false)}
                style={{ padding: "0.5rem 1rem", background: "transparent", border: "1px solid #1e2a3a", borderRadius: 6, color: "#94a3b8", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                Cancel
              </button>
              <button onClick={handleCreate}
                style={{ padding: "0.5rem 1rem", background: "#00d4ff", border: "none", borderRadius: 6, color: "#0a0e1a", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                Create User
              </button>
            </div>
          </div>
        </div>
      )}

      {showResetModal && generatedPassword && (
        <ConfirmModal
          title="Password Reset"
          message={`Temporary password: ${generatedPassword}\n\nCopy this now. It will not be shown again. The user's active session has been revoked.`}
          confirmLabel="Done"
          onConfirm={() => { setShowResetModal(null); setGeneratedPassword(""); }}
          onCancel={() => { setShowResetModal(null); setGeneratedPassword(""); }}
        />
      )}

      {showDeleteModal && (
        <ConfirmModal
          title="Delete User"
          message={`Permanently delete "${showDeleteModal.name}"? If the user has dependent records this will be blocked and you'll be offered a Disable instead.`}
          confirmLabel="Delete"
          requireType="DELETE"
          danger
          onConfirm={() => handleDelete(showDeleteModal)}
          onCancel={() => setShowDeleteModal(null)}
        />
      )}

      {disablePrompt && (
        <ConfirmModal
          title="Cannot Delete — Disable Instead?"
          message={`"${disablePrompt.name}" has dependent records (sessions, scans, or audit history) and cannot be deleted. Disable the account instead to revoke access while preserving history?`}
          confirmLabel="Disable"
          onConfirm={() => handleDisableInstead(disablePrompt)}
          onCancel={() => setDisablePrompt(null)}
        />
      )}
    </div>
  );
}

const actionBtn: React.CSSProperties = {
  padding: "0.5rem 1rem", background: "#00d4ff", border: "none", borderRadius: 6,
  color: "#0a0e1a", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

const tinyBtn: React.CSSProperties = {
  padding: "0.25rem 0.5rem", background: "#0d1224", border: "1px solid #1e2a3a",
  borderRadius: 4, color: "#94a3b8", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.5rem 0.75rem", background: "#0d1224", border: "1px solid #1e2a3a",
  borderRadius: 6, color: "#e2e8f0", fontFamily: "inherit", fontSize: 13, outline: "none", boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  padding: "0.4rem 0.5rem", background: "#0d1224", border: "1px solid #1e2a3a",
  borderRadius: 6, color: "#e2e8f0", fontFamily: "inherit", fontSize: 12, outline: "none",
};
