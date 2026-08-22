import { useState, useRef } from "react";
import { adminApi, ApiError, type AdminMe } from "../api";

interface Props {
  onSuccess: (me: AdminMe) => void;
}

export default function AdminLogin({ onSuccess }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [shake, setShake] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }

  async function handleLogin() {
    if (!username || !password) {
      triggerShake();
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const me = await adminApi.login(username.trim(), password);
      onSuccess(me);
    } catch (e) {
      // Backend surfaces 401 "Invalid credentials" and 429 rate-limit here.
      setMsg(e instanceof ApiError ? e.message : "Login failed");
      triggerShake();
      setBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleLogin();
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0.75rem 1rem", background: "#0d1224",
    border: "1px solid #1e2a3a", borderRadius: 8, color: "#e2e8f0",
    fontFamily: "inherit", fontSize: 14, outline: "none", boxSizing: "border-box",
    marginBottom: "0.75rem",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0a0e1a", color: "#e2e8f0", fontFamily: "'JetBrains Mono','Fira Code',monospace",
      zIndex: 9999,
    }}>
      <div style={{
        width: 400, maxWidth: "90vw", padding: "2.5rem", background: "#111827",
        borderRadius: 12, border: "1px solid #1e2a3a",
      }}>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%", background: "rgba(0,212,255,0.15)",
            color: "#00d4ff", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, margin: "0 auto 1rem", border: "2px solid rgba(0,212,255,0.3)",
          }}>&#x2699;</div>
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, letterSpacing: "0.06em" }}>
            SYSTEM ADMINISTRATION
          </h1>
          <p style={{ fontSize: 12, color: "#64748b", margin: "0.25rem 0 0" }}>
            LogicVera Control Interface
          </p>
        </div>
        <form onSubmit={handleSubmit} style={{ margin: 0 }}>
          <input
            ref={userRef}
            type="text"
            placeholder="Administrator username"
            value={username}
            maxLength={255}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            style={inputStyle}
          />
          <input
            type={showPw ? "text" : "password"}
            placeholder="Administrator password"
            value={password}
            maxLength={128}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b", marginBottom: "1rem", cursor: "pointer" }}>
            <input type="checkbox" checked={showPw} onChange={() => setShowPw(!showPw)} />
            Show password
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
            {busy ? "Authenticating…" : "Authenticate"}
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
