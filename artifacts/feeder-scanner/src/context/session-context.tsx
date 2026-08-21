import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth-context";
import { logger } from "@/lib/logger";

export interface ActiveSession {
  id: string;
  bomId: number;
  bomName: string;
  operatorId: string;
  status: "active" | "completed" | "cancelled" | "qa_confirmed" | "pending_qa" | "splicing_pending_qa";
  startedAt: string;
}

interface SessionContextType {
  activeSession: ActiveSession | null;
  loading: boolean;
  refreshSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

function normalizeActiveSession(payload: unknown): ActiveSession | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const wrapper = payload as { session?: unknown; sessions?: unknown };

  // The /api/verification/sessions/active endpoint returns { sessions: [...] }.
  // Also support a single-session wrapper { session: {...} }.
  let session: unknown = wrapper.session;
  if (!session && Array.isArray(wrapper.sessions)) {
    session = wrapper.sessions[0];
  }
  if (!session || typeof session !== "object") {
    return null;
  }

  const source = session as Record<string, unknown>;
  const id = typeof source.id === "string" ? source.id.trim() : String(source.id ?? "").trim();
  const bomId = Number(source.bomId);
  const operatorId = typeof source.operatorId === "string" ? source.operatorId.trim() : String(source.operatorId || "");
  const bomName = typeof source.bomName === "string" ? source.bomName : "Unknown BOM";
  const startedAt = typeof source.startedAt === "string" ? source.startedAt : "";
  const status = source.status;

  if (!id || !Number.isFinite(bomId) || !operatorId) {
    return null;
  }

  if (
    status !== "active" &&
    status !== "completed" &&
    status !== "cancelled" &&
    status !== "qa_confirmed" &&
    status !== "pending_qa" &&
    status !== "splicing_pending_qa"
  ) {
    return null;
  }

  return {
    id,
    bomId,
    bomName,
    operatorId,
    status,
    startedAt,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [location] = useLocation();
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [loading, setLoading] = useState(true);

  const loadActiveSession = async () => {
    if (authLoading) {
      return;
    }

    if (!user) {
      setActiveSession(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/verification/sessions/active", {
        credentials: "include",
      });

      if (!response.ok) {
        setActiveSession(null);
        return;
      }

      const data = await response.json();
      const session = normalizeActiveSession(data);
      setActiveSession(session);
    } catch (err) {
      logger.error({ err }, "[SESSION CONTEXT] Load error");
      setActiveSession(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadActiveSession();
  }, [user, authLoading, location]);

  // Periodic refresh every 10 seconds to catch active sessions
  useEffect(() => {
    const interval = setInterval(() => {
      void loadActiveSession();
    }, 10000);
    return () => clearInterval(interval);
  }, [authLoading, user]);

  const refreshSession = async () => {
    await loadActiveSession();
  };

  return (
    <SessionContext.Provider value={{ activeSession, loading, refreshSession }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }

  return context;
}