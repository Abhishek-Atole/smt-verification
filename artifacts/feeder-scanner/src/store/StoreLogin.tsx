import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { STORE_ROUTE } from "./config";
import { logger } from "../lib/logger";
import { consumeSessionExpiredNotice, SESSION_EXPIRED_MESSAGE } from "../lib/session-guard";

// Store-only login window. Role is fixed to "storekeeper" (no role picker) —
// this is an isolated entry point distinct from the main app login.
export default function StoreLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  // Module 13(c) — same notice as the main and admin logins. StoreGate renders
  // this component inline (no navigation), so the flag is what carries the
  // reason across the reload the guard performs.
  const [sessionExpired] = useState(consumeSessionExpiredNotice);
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    try {
      setError("");
      const { mustChangePassword } = await login(username.trim(), "storekeeper", password);
      setLocation(mustChangePassword ? "/change-password" : STORE_ROUTE);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Authentication failed. Please try again.";
      logger.warn({ error }, "[StoreLogin] Authentication failed: " + errorMessage);
      setError(errorMessage);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg border-border">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Store Login</CardTitle>
          <CardDescription className="text-center">Enter your storekeeper credentials to continue</CardDescription>
        </CardHeader>
        <CardContent>
          {sessionExpired && (
            <p role="status" className="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-400">
              {SESSION_EXPIRED_MESSAGE}
            </p>
          )}
          <form onSubmit={handleLogin} className="space-y-6" autoComplete="on">
            <div className="space-y-3">
              <label className="text-sm font-medium" htmlFor="store-username">
                Username
              </label>
              <Input
                id="store-username"
                name="username"
                autoComplete="username"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-12 text-lg"
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium" htmlFor="store-password">
                Password
              </label>
              <Input
                id="store-password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 text-lg"
              />
            </div>

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}

            <Button
              type="submit"
              className="w-full h-12 text-lg font-bold tracking-wide"
              disabled={!username.trim() || !password}
            >
              LOGIN
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
