import { useEffect, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Loader } from "lucide-react";

interface PasswordConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** Called only after the current user's password is verified. */
  onConfirmed: () => void;
}

/**
 * Step-up confirmation: the logged-in user re-enters their OWN password to
 * authorize a sensitive action (BOM create/edit/delete/restore). Verifies via
 * POST /api/auth/verify-password; on success closes and fires onConfirmed().
 *
 * Uses raw fetch (not lib/api.ts) on purpose: that client redirects to /login
 * on any 401, but here a 401 means "wrong password", which must stay inline.
 */
export function PasswordConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirmed,
}: PasswordConfirmModalProps) {
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setError(null);
      setVerifying(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (!password) {
      setError("Password is required");
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onOpenChange(false);
        onConfirmed();
        return;
      }
      setError(res.status === 401 ? "Password is incorrect" : "Verification failed. Please try again.");
    } catch {
      setError("Verification failed. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleConfirm();
          }}
        >
          <label className="text-sm font-medium text-gray-700">Confirm your password</label>
          <Input
            type="password"
            autoFocus
            value={password}
            disabled={verifying}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="mt-1"
          />
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          {/* Hidden submit lets Enter submit the form (clears the browser
              "password field not in a form" warning + enables password managers). */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
        <div className="flex gap-3 justify-end">
          <AlertDialogCancel disabled={verifying}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={verifying}
            className={`${destructive ? "bg-red-600 hover:bg-red-700" : ""} disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2`}
          >
            {verifying && <Loader className="w-4 h-4 animate-spin" />}
            {verifying ? "Verifying..." : confirmLabel}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
