import { useEffect, useMemo, useState } from "react";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

const AUTH_STORAGE_KEY = "mockup-sandbox-auth-user";

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        setUser(JSON.parse(stored) as AuthUser);
      }
    } catch {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useMemo(
    () => (nextUser: AuthUser) => {
      setUser(nextUser);
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextUser));
    },
    [],
  );

  const logout = useMemo(
    () => () => {
      setUser(null);
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    },
    [],
  );

  return {
    isLoggedIn: Boolean(user),
    user,
    loading,
    login,
    logout,
  };
}
