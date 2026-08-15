import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { logger } from "../lib/logger";
import { recordDailyMetric, appendAuditEntry, loadActiveSessions, saveActiveSessions, nowFormatted } from "../admin/admin-storage";

type Role = "supervisor" | "qa" | "operator" | "admin";

interface User {
  userId: number | string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

interface AuthSessionResponse {
  authenticated?: boolean;
  userId: number | string;
  username: string;
  role: Role;
  mustChangePassword: boolean;
}

const AUTH_SESSION_HINT_KEY = "feeder-scanner-auth-session";

function hasAuthSessionHint() {
  return typeof window !== "undefined" && window.localStorage.getItem(AUTH_SESSION_HINT_KEY) === "true";
}

function setAuthSessionHint(isAuthenticated: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  if (isAuthenticated) {
    window.localStorage.setItem(AUTH_SESSION_HINT_KEY, "true");
    return;
  }

  window.localStorage.removeItem(AUTH_SESSION_HINT_KEY);
}

function normalizeAuthSession(payload: unknown): AuthSessionResponse | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const source = "user" in payload && typeof (payload as { user?: unknown }).user === "object"
    ? (payload as { user: Record<string, unknown> }).user
    : (payload as Record<string, unknown>);

  if (source.authenticated === false) {
    return null;
  }

  const rawUserId = source.userId ?? source.id;
  const userId = typeof rawUserId === "number" || typeof rawUserId === "string" ? rawUserId : null;
  const username = typeof source.username === "string" ? source.username : "";
  const role = source.role;

  const hasValidUserId =
    (typeof userId === "number" && Number.isFinite(userId))
    || (typeof userId === "string" && userId.trim().length > 0);

  if (!hasValidUserId || !username || (role !== "supervisor" && role !== "qa" && role !== "operator" && role !== "admin")) {
    return null;
  }

  return {
    authenticated: true,
    userId,
    username,
    role,
    mustChangePassword: source.mustChangePassword === true,
  };
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, role: Role, password: string) => Promise<{ mustChangePassword: boolean }>;
  logout: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function fetchWithCredentials<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw response;
  }

  return readJsonResponse<T>(response);
}

async function toAuthError(response: Response): Promise<Error> {
  try {
    const payload = await readJsonResponse<{ error?: string }>(response);
    if (payload?.error) {
      const normalized = payload.error.trim().toLowerCase();
      if (normalized === "unauthorized" || normalized === "invalid credentials") {
        return new Error("Invalid username, role, or password.");
      }

      return new Error(payload.error);
    }
  } catch {
    // Ignore JSON parsing failures and fallback to status-based error text.
  }

  if (response.status === 401) {
    return new Error("Invalid username, role, or password.");
  }

  return new Error(`Authentication request failed (${response.status}).`);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.pathname.endsWith("/login")) {
      setUser(null);
      setLoading(false);
      return;
    }

    if (!hasAuthSessionHint()) {
      setUser(null);
      setLoading(false);
      return;
    }

    let active = true;

    void (async () => {
      try {
        const sessionPayload = await fetchWithCredentials<unknown>("/api/auth/me");
        const session = normalizeAuthSession(sessionPayload);
        if (active) {
          if (session) {
            setUser({ userId: session.userId, name: session.username, role: session.role, mustChangePassword: session.mustChangePassword });
            setAuthSessionHint(true);
          } else {
            setUser(null);
            setAuthSessionHint(false);
          }
        }
      } catch (error) {
        const isExpectedUnauthenticated =
          error instanceof Response && error.status === 401;

        // 401 errors are expected when user is not logged in - no need to warn
        if (!isExpectedUnauthenticated) {
          logger.error({ error }, "[AuthContext] Failed to restore session");
        }

        if (active) {
          setUser(null);
          setAuthSessionHint(false);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const uid = user?.userId;
      if (uid) {
        try {
          const sessions = loadActiveSessions().filter((s) => s.userId !== String(uid));
          saveActiveSessions(sessions);
        } catch {}
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [user]);

  const login = async (username: string, role: Role, password: string) => {
    let session: AuthSessionResponse;
    setLoading(true);
    try {
      const sessionPayload = await fetchWithCredentials<unknown>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password, role }),
        headers: {
          "Content-Type": "application/json",
        },
      });

      const normalized = normalizeAuthSession(sessionPayload);
      if (!normalized) {
        throw new Error("Login succeeded but user session payload is invalid.");
      }
      session = normalized;
    } catch (error) {
      logger.error({ error }, "[Login] Login attempt failed");
      if (error instanceof Response) {
        throw await toAuthError(error);
      }
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Login failed: An unexpected error occurred.");
    } finally {
      setLoading(false);
    }

    setUser({ userId: session.userId, name: session.username, role: session.role, mustChangePassword: session.mustChangePassword });
    setAuthSessionHint(true);
    recordDailyMetric({ loginSuccesses: 1 });
    appendAuditEntry({
      timestamp: nowFormatted(), action: "admin_login_success", actor: String(session.userId),
      details: `${session.username} logged in`, outcome: "success",
    });
    try {
      const fp = String(navigator.userAgent.length + screen.width).slice(0, 8);
      const sessions = loadActiveSessions();
      sessions.push({
        userId: String(session.userId), userName: session.username, role: session.role,
        loginAt: nowFormatted(), lastActiveAt: nowFormatted(), fingerprint: fp,
      });
      saveActiveSessions(sessions);
    } catch {}

    return { mustChangePassword: session.mustChangePassword };
  };

  const logout = async () => {
    setLoading(true);
    try {
      await fetchWithCredentials<{ success: boolean }>("/api/auth/logout", { method: "POST" });
    } catch {}
    const uid = user?.userId;
    if (uid) {
      try {
        const sessions = loadActiveSessions().filter((s) => s.userId !== String(uid));
        saveActiveSessions(sessions);
      } catch {}
    }
    setUser(null);
    setAuthSessionHint(false);
    setLoading(false);
  };

  const changePassword = async (oldPassword: string, newPassword: string) => {
    try {
      await fetchWithCredentials<{ success: boolean }>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ oldPassword, newPassword }),
      });
    } catch (error) {
      if (error instanceof Response) {
        throw await toAuthError(error);
      }
      throw error instanceof Error ? error : new Error("Password change failed.");
    }
    // Backend cleared must_change_password and re-issued cookies for this
    // device; reflect it locally so the redirect gate releases.
    setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
