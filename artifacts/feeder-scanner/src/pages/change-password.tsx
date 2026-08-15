import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { appConfig } from "@/lib/appConfig";
import { AppLogo } from "@/components/AppLogo";
import { logger } from "../lib/logger";

// APP-FLOW §5 — forced first-login password change. Policy mirrors the backend
// (auth.ts): >= 10 chars, at least one letter and one number.
function policyError(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must include at least one letter and one number.";
  return null;
}

export default function ChangePassword() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { user, changePassword } = useAuth();
  const [, setLocation] = useLocation();

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    const policy = policyError(newPassword);
    if (policy) {
      setError(policy);
      return;
    }
    if (newPassword === oldPassword) {
      setError("New password must be different from the current password.");
      return;
    }

    try {
      setSubmitting(true);
      await changePassword(oldPassword, newPassword);
      setLocation("/");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Password change failed. Please try again.";
      logger.warn({ err }, "[ChangePassword] failed: " + message);
      setError(message);
    } finally {
      setSubmitting(false);
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
          <CardTitle className="text-2xl text-center">Set a New Password</CardTitle>
          <CardDescription className="text-center">
            {user ? `Welcome, ${user.name}. ` : ""}You must set a new password before continuing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6" autoComplete="off">
            <input type="text" name="username" autoComplete="username" value={user ? String(user.name) : ""} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />

            <div className="space-y-3">
              <label className="text-sm font-medium" htmlFor="old-password">Current Password</label>
              <Input
                id="old-password"
                name="old-password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your current password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="h-12 text-lg"
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium" htmlFor="new-password">New Password</label>
              <Input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 10 characters, with a letter and a number"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-12 text-lg"
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium" htmlFor="confirm-password">Confirm New Password</label>
              <Input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder="Re-enter your new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-12 text-lg"
              />
            </div>

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}

            <Button
              type="submit"
              className="w-full h-12 text-lg font-bold tracking-wide"
              disabled={submitting || !oldPassword || !newPassword || !confirm}
            >
              {submitting ? "SAVING…" : "SET NEW PASSWORD"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
