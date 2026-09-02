import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Settings, ShieldCheck, ScanLine } from "lucide-react";
import { appConfig } from "@/lib/appConfig";
import { AppLogo } from "@/components/AppLogo";
import { logger } from "../lib/logger";
import { consumeSessionExpiredNotice, SESSION_EXPIRED_MESSAGE } from "../lib/session-guard";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [role, setRole] = useState<"supervisor" | "qa" | "operator" | null>(null);
  // Module 13(c) — read-and-clear on first render so the user is told why they
  // landed here. Lazy initialiser, not an effect: the flag must be consumed
  // exactly once, and StrictMode double-invokes effects.
  const [sessionExpired] = useState(consumeSessionExpiredNotice);
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  const defaultPasswordByRole: Record<"supervisor" | "qa" | "operator", string> = {
    supervisor: "engineer123",
    qa: "qa123",
    operator: "operator123",
  };
  const allowSeedPasswordHint = import.meta.env.DEV;

  const handleRoleChange = (r: "supervisor" | "qa" | "operator") => {
    setRole(r);
    setPassword("");
    setError("");
  };

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!username.trim() || !role) return;
    try {
      setError("");
      const { mustChangePassword } = await login(username.trim(), role, password);
      setLocation(mustChangePassword ? "/change-password" : "/");
    } catch (error: unknown) {
      const rawErrorMessage = error instanceof Error ? error.message : "Authentication failed. Please try again.";
      const errorMessage =
        role && rawErrorMessage === "Invalid username, role, or password."
          ? `${rawErrorMessage} For local seeded users, try password: ${defaultPasswordByRole[role]}`
          : rawErrorMessage;
      logger.warn({ error }, "[Login] Authentication failed: " + errorMessage);
      setError(errorMessage);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="mb-8 text-center">
        <AppLogo className="h-20 sm:h-24 mx-auto mb-4" />
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground font-semibold">{appConfig.companyShort}</p>
        <h1 className="text-3xl font-black tracking-tighter text-primary">{appConfig.companyName}</h1>
        <p className="text-muted-foreground mt-2">{appConfig.systemTitle}</p>
      </div>

      <Card className="w-full max-w-xl shadow-lg border-border">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Authentication</CardTitle>
          <CardDescription className="text-center">Select your role and enter credentials to continue</CardDescription>
        </CardHeader>
        <CardContent>
          {sessionExpired && (
            <p role="status" className="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-400">
              {SESSION_EXPIRED_MESSAGE}
            </p>
          )}
          <form onSubmit={handleLogin} className="space-y-8" autoComplete="on">
            <div className="space-y-4">
              <label className="text-sm font-medium">Select Role</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(["supervisor", "qa", "operator"] as const).map((r) => {
                  const Icon = r === "supervisor" ? Settings : r === "qa" ? ShieldCheck : ScanLine;
                  const label = r === "supervisor" ? "Supervisor" : r === "qa" ? "QA Engineer" : "Operator";
                  const sub = r === "supervisor" ? "Full Access" : r === "qa" ? "Reports Only" : "Scanning Only";
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleRoleChange(r)}
                      className={`flex flex-col items-center justify-center p-6 rounded-lg border-2 transition-all ${
                        role === r
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/50 text-muted-foreground"
                      }`}
                    >
                      <Icon className="w-8 h-8 mb-2" />
                      <span className="font-medium">{label}</span>
                      <span className="text-xs mt-1 opacity-80">{sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium" htmlFor="username">
                Username
              </label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-12 text-lg"
              />
            </div>

            {role && (
              <div className="space-y-3">
                {/* Hidden username field helps password managers and a11y tools associate credentials reliably. */}
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={username}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  className="sr-only"
                />
                <label className="text-sm font-medium" htmlFor="password">
                  Password
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 text-lg"
                />
              </div>
            )}

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}

            <Button
              type="submit"
              className="w-full h-12 text-lg font-bold tracking-wide"
              disabled={!username.trim() || !role || !password}
            >
              LOGIN
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
