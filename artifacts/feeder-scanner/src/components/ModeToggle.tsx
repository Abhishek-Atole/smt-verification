import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSmtSessionCode } from "@/lib/session-code";

interface ModeToggleProps {
  currentMode: "AUTO" | "MANUAL";
  onModeChange: (mode: "AUTO" | "MANUAL") => void | Promise<void>;
  sessionId: string;
  sessionStartedAt: string;
}

const MANUAL_PASSWORD = import.meta.env.VITE_MANUAL_PASSWORD;

const isManualModeEnabled = Boolean(MANUAL_PASSWORD);

export function ModeToggle({ currentMode, onModeChange, sessionId, sessionStartedAt }: ModeToggleProps) {
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [error, setError] = useState("");
  const [isChanging, setIsChanging] = useState(false);
  const displaySessionId = formatSmtSessionCode(sessionStartedAt, sessionId);

  const closeModal = useCallback(() => {
    if (isChanging) {
      return;
    }

    setShowPasswordModal(false);
    setPasswordInput("");
    setError("");
  }, [isChanging]);

  const handleToggle = useCallback(() => {
    if (!isManualModeEnabled) {
      return;
    }

    setError("");

    if (currentMode === "AUTO") {
      setShowPasswordModal(true);
      return;
    }

    void onModeChange("AUTO");
  }, [currentMode, onModeChange]);

  const handlePasswordSubmit = useCallback(async () => {
    if (!MANUAL_PASSWORD) {
      setError("Manual mode is not configured.");
      return;
    }

    const normalizedPassword = passwordInput.trim();
    if (!normalizedPassword) {
      setError("Enter the password to unlock manual mode.");
      return;
    }

    if (normalizedPassword !== MANUAL_PASSWORD) {
      setError("Incorrect password.");
      return;
    }

    setIsChanging(true);
    try {
      await onModeChange("MANUAL");
      setShowPasswordModal(false);
      setPasswordInput("");
      setError("");
    } finally {
      setIsChanging(false);
    }
  }, [onModeChange, passwordInput]);

  return (
    <>
      <div className="inline-flex rounded-md border border-border bg-background p-1 shadow-sm">
        <Button
          type="button"
          variant={currentMode === "AUTO" ? "default" : "outline"}
          className="h-8 px-3 text-xs sm:text-sm font-bold tracking-widest"
          onClick={handleToggle}
        >
          {currentMode === "AUTO" ? "AUTO MODE" : "AUTO → MANUAL"}
        </Button>
      </div>

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md border-2 border-border shadow-2xl">
            <CardHeader>
              <CardTitle className="text-lg font-bold tracking-wide">Unlock Manual Mode</CardTitle>
              <div className="text-xs text-muted-foreground font-mono truncate">Session {displaySessionId}</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Password</label>
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="sr-only"
                  value="manual-mode"
                  readOnly
                />
                <Input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    if (error) {
                      setError("");
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handlePasswordSubmit();
                    }
                  }}
                  placeholder="Enter manual mode password"
                  autoComplete="off"
                  autoFocus
                />
                {error && <div className="text-sm font-medium text-destructive">{error}</div>}
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={closeModal} disabled={isChanging}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void handlePasswordSubmit()} disabled={isChanging}>
                  {isChanging ? "Checking..." : "Unlock"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}