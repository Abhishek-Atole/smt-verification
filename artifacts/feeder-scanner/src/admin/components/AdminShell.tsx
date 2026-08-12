import { useEffect, useRef, type ReactNode } from "react";
import AdminNav from "./AdminNav";

const IDLE_TIMEOUT_MS = 20 * 60 * 1000;

export default function AdminShell({ onLogout, children }: { onLogout: () => void; children: ReactNode }) {
  const idleRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function resetIdleTimer() {
    clearTimeout(idleRef.current);
    idleRef.current = setTimeout(onLogout, IDLE_TIMEOUT_MS);
  }

  useEffect(() => {
    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((ev) => document.addEventListener(ev, resetIdleTimer));
    resetIdleTimer();
    return () => {
      clearTimeout(idleRef.current);
      events.forEach((ev) => document.removeEventListener(ev, resetIdleTimer));
    };
  }, []);

  return (
    <div
      style={{
        display: "flex", height: "100vh", background: "#0a0e1a", color: "#e2e8f0",
        fontFamily: "'JetBrains Mono','Fira Code',monospace", position: "fixed", inset: 0, zIndex: 9998,
      }}
    >
      <AdminNav onLogout={onLogout} />
      <main style={{ flex: 1, overflowY: "auto", padding: "1.5rem 2rem" }}>
        {children}
      </main>
    </div>
  );
}
