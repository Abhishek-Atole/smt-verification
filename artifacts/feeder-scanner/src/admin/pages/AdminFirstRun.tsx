// First-login account setup. The seeded admin lands here (mustChange=true) and
// cannot reach the Control Panel until they replace BOTH the seeded username and
// the temporary password. Mirrors AdminLogin's dark-shell styling.
import { useState } from "react";
import { adminApi, ApiError, type AdminMe } from "../api";

interface Props {
  onDone: (me: AdminMe) => void;
  onLogout: () => void;
}

const MIN_PASSWORD = 12;

export default function AdminFirstRun({ onDone, onLogout }: Props) {
  const [newUsername, setNewUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [shake, setShake] = useState(false);

  function fail(message: string) {
    setMsg(message);
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newUsername.trim().length < 3) { fail("Username must be at least 3 characters."); return; }
    if (newPassword.length < MIN_PASSWORD) { fail(`Password must be at least ${MIN_PASSWORD} characters.`); return; }
    if (newPassword !== confirm) { fail("New passwords do not match."); return; }
    setBusy(true);
    setMsg("");
    try {
      const me = await adminApi.changeCredentials({
        newUsername: newUsername.trim(),
        currentPassword,
        newPassword,
      });
      onDone(me);
    } catch (err) {
      // Backend surfaces invalid_current_password, username_taken,
      // username_unchanged, password_unchanged, invalid_* here.
      fail(err instanceof ApiError ? err.message : "Could not update credentials");
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0a0e1a", color: "#e2e8f0", fontFamily: "'JetBrains Mono','Fira Code',monospace",
      zIndex: 9999, padding: "1rem",
    }}>
      <div style={{
        width: 420, maxWidth: "90vw", padding: "2.5rem", background: "#111827",
        borderRadius: 12, border: "1px solid #1e2a3a",
      }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%", background: "rgba(0,212,255,0.15)",
            color: "#00d4ff", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, margin: "0 auto 1rem", border: "2px solid rgba(0,212,255,0.3)",
          }}>&#x1F511;</div>
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, letterSpacing: "0.06em" }}>
            SET UP ADMIN ACCOUNT
          </h1>
          <p style={{ fontSize: 12, color: "#64748b", margin: "0.35rem 0 0", lineHeight: 1.5 }}>
            For security, choose a new administrator username and password before continuing.
          </p>
        </div>
        <form onSubmit={handleSubmit} style={{ margin: 0 }}>
          <label style={labelStyle}>New username</label>
          <input
            type="text"
            placeholder="New administrator username"
            value={newUsername}
            maxLength={255}
            autoComplete="username"
            onChange={(e) => setNewUsername(e.target.value)}
            autoFocus
            style={inputStyle}
          />
          <label style={labelStyle}>Current (temporary) password</label>
          <input
            type={showPw ? "text" : "password"}
            placeholder="Current password"
            value={currentPassword}
            maxLength={128}
            autoComplete="current-password"
            onChange={(e) => setCurrentPassword(e.target.value)}
            style={inputStyle}
          />
          <label style={labelStyle}>New password</label>
          <input
            type={showPw ? "text" : "password"}
            placeholder={`New password (min ${MIN_PASSWORD} chars)`}
            value={newPassword}
            maxLength={128}
            autoComplete="new-password"
            onChange={(e) => setNewPassword(e.target.value)}
            style={inputStyle}
          />
          <label style={labelStyle}>Confirm new password</label>
          <input
            type={showPw ? "text" : "password"}
            placeholder="Re-enter new password"
            value={confirm}
            maxLength={128}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
            style={inputStyle}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b", marginBottom: "1rem", cursor: "pointer" }}>
            <input type="checkbox" checked={showPw} onChange={() => setShowPw(!showPw)} />
            Show passwords
          </label>
          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%", padding: "0.75rem", background: busy ? "#1e3a44" : "#00d4ff",
              color: "#0a0e1a", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: busy ? "default" : "pointer", fontFamily: "inherit",
            }}
          >
            {busy ? "Saving…" : "Save and continue"}
          </button>
        </form>
        {msg && (
          <div style={{
            marginTop: "0.75rem", padding: "0.5rem 0.75rem", borderRadius: 6, fontSize: 12,
            background: "rgba(255,68,68,0.1)", color: "#ff4444", textAlign: "center",
            animation: shake ? "shake 0.4s ease-in-out" : undefined,
          }}>
            {msg}
          </div>
        )}
        <button
          type="button"
          onClick={onLogout}
          style={{
            width: "100%", marginTop: "0.75rem", padding: "0.5rem", background: "transparent",
            border: "none", color: "#64748b", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Lock session
        </button>
      </div>
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        input:focus { border-color: #00d4ff !important; box-shadow: 0 0 0 1px rgba(0,212,255,0.3); }
      `}</style>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.75rem 1rem", background: "#0d1224",
  border: "1px solid #1e2a3a", borderRadius: 8, color: "#e2e8f0",
  fontFamily: "inherit", fontSize: 14, outline: "none", boxSizing: "border-box",
  marginBottom: "0.75rem",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em",
  display: "block", marginBottom: 4,
};
