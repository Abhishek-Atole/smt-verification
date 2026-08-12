import React, { useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useNotification } from "@/hooks/use-notification";

interface ManualOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  feederNumber: string;
  scannedValue: string;
  expectedMPNs: string[];
  onApproved: (approverRole: "supervisor" | "qa", approverName: string) => void;
}

export const ManualOverrideModal: React.FC<ManualOverrideModalProps> = ({
  isOpen,
  onClose,
  feederNumber,
  scannedValue,
  expectedMPNs,
  onApproved,
}) => {
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"supervisor" | "qa">("supervisor");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { notify } = useNotification();

  // PLAYBACK BUZZER
  const playBuzzer = (type: "success" | "error" = "error") => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (type === "success") {
      oscillator.frequency.value = 800;
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } else {
      oscillator.frequency.value = 300;
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    }
  };

  const handleApprove = async () => {
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/verify-override", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, role }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError("Invalid password or credentials");
        playBuzzer("error");
        setLoading(false);
        return;
      }

      // PASSWORD CORRECT
      notify.success(
        `✓ Approved by ${data.approverName} (${role})`,
        `Override approved for feeder ${feederNumber}`
      );
      playBuzzer("success");

      onApproved(role, data.approverName);
      handleClose();
    } catch (err) {
      setError((err as Error).message);
      playBuzzer("error");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPassword("");
    setRole("supervisor");
    setError("");
    onClose();
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && password && !loading) {
      handleApprove();
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <DialogTitle>Manual Override Required</DialogTitle>
          </div>
          <DialogDescription>
            Supervisor or QA approval required to use an unlisted MPN
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* MISMATCH DETAILS */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
            <div className="text-sm">
              <span className="text-gray-600">Feeder: </span>
              <span className="font-bold">{feederNumber}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-600">Scanned MPN: </span>
              <span className="font-bold">{scannedValue}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-600">Expected (BOM): </span>
              <span className="font-bold">{expectedMPNs.join(" | ")}</span>
            </div>
          </div>

          {/* WARNING BOX */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm text-amber-900">
              The scanned MPN does not match any BOM-approved option. To proceed with this alternate
              component, supervisor or QA approval is required.
            </p>
          </div>

          {/* ROLE SELECTION */}
          <div className="space-y-2">
            <Label className="text-base font-semibold">Select Approver Role</Label>
            <RadioGroup value={role} onValueChange={(v) => setRole(v as "supervisor" | "qa")}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="supervisor" id="supervisor" />
                <Label htmlFor="supervisor" className="text-sm font-normal cursor-pointer">
                  Supervisor Approval
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="qa" id="qa" />
                <Label htmlFor="qa" className="text-sm font-normal cursor-pointer">
                  QA Engineer Approval
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* PASSWORD INPUT */}
          <div className="space-y-2">
            <Label htmlFor="password" className="text-base font-semibold flex items-center gap-2">
              <Lock className="w-4 h-4" />
              Password
            </Label>
            <input
              type="text"
              name="username"
              autoComplete="username"
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
              value="manual-override"
              readOnly
            />
            <Input
              id="password"
              type="password"
              placeholder="Enter approval password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={loading}
              autoFocus
              className="text-lg py-2"
            />
            <p className="text-xs text-gray-500">Press Enter or click Approve</p>
          </div>

          {/* ERROR MESSAGE */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* BUTTONS */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleApprove}
              disabled={!password || loading}
              className="flex-1 bg-white text-navy border-navy border-2 hover:bg-gray-50"
            >
              {loading ? "Verifying..." : "Approve Override"}
            </Button>
            <Button onClick={handleClose} variant="outline" disabled={loading} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
