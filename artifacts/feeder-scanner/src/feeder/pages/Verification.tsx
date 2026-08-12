
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScanLine, CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { useVerificationStore } from "@/store/useVerificationStore";
import { useScanner } from "@/hooks/useScanner";
import { useNotification } from "@/hooks/use-notification";
import { ScanNotification } from "@/components/notifications/ScanNotification";
import { LogPanel } from "@/components/LogPanel";
import { AppLogo } from "@/components/AppLogo";
import { appConfig } from "@/lib/appConfig";

export default function VerificationPage() {
  const [, setLocation] = useLocation();
  const [lotCodeValue, setLotCodeValue] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmStep, setResetConfirmStep] = useState<"pending" | "confirmed">("pending");

  const currentStep = useVerificationStore((s) => s.currentStep);
  const activeFeederInput = useVerificationStore((s) => s.activeFeederInput);
  const pendingMatch = useVerificationStore((s) => s.pendingMatch);
  const submitFeederId = useVerificationStore((s) => s.submitFeederId);
  const submitMPN = useVerificationStore((s) => s.submitMPN);
  const submitLotCode = useVerificationStore((s) => s.submitLotCode);
  const resetCurrentScan = useVerificationStore((s) => s.resetCurrentScan);
  const resetAll = useVerificationStore((s) => s.resetAll);
  const getProgress = useVerificationStore((s) => s.getProgress);
  const getScannedList = useVerificationStore((s) => s.getScannedList);

  const progress = getProgress();
  const scanned = getScannedList();
  const ringRadius = 42;
  const ringCircumference = 2 * Math.PI * ringRadius;

  const {
    notifications,
    dismissNotification,
    showErrorAlert,
    showWarningAlert,
    showSuccessAlert,
  } = useNotification();

  const handleScanValue = (value: string) => {
    try {
      if (currentStep === "feederId") {
        submitFeederId(value);
        showSuccessAlert(`Feeder ${value.trim().toUpperCase()} found in BOM.`);
        return;
      }

      if (currentStep === "mpn") {
        submitMPN(value);
        const isAlt = pendingMatch && pendingMatch.partId !== undefined;
        if (isAlt) {
          showWarningAlert(`Component ${value.trim().toUpperCase()} accepted for ${activeFeederInput}.`);
        } else {
          showSuccessAlert(`Component ${value.trim().toUpperCase()} matched for ${activeFeederInput}.`);
        }
        return;
      }

      if (currentStep === "lotCode") {
        submitLotCode(value);
        showSuccessAlert(`Feeder ${activeFeederInput} verified successfully.`);
      }
    } catch (error: any) {
      showErrorAlert(error?.message || "Verification failed", "high");
    }
  };

  const { inputRef, value, setValue, handleKeyDown } = useScanner({
    onSubmit: handleScanValue,
    autoFocus: true,
    resetAfterMs: 10000,
  });

  const currentLabel = useMemo(() => {
    if (currentStep === "feederId") return "SCAN FEEDER NUMBER";
    if (currentStep === "mpn") return `SCAN MPN / PART FOR ${activeFeederInput}`;
    if (currentStep === "lotCode") return `SCAN LOT CODE FOR ${activeFeederInput} (OPTIONAL)`;
    return "VERIFICATION COMPLETE";
  }, [currentStep, activeFeederInput]);

  useEffect(() => {
    document.title = `${appConfig.companyShort} | Verifying... (${progress.verifiedCount}/${progress.totalRequired})`;
  }, [progress.verifiedCount, progress.totalRequired]);

  useEffect(() => {
    if (!progress.isComplete) {
      return;
    }

    const timer = setTimeout(() => {
      setLocation("/splicing");
    }, 2000);

    return () => clearTimeout(timer);
  }, [progress.isComplete, setLocation]);

  const submitLot = () => {
    try {
      submitLotCode(lotCodeValue);
      setLotCodeValue("");
      showSuccessAlert(`Feeder ${activeFeederInput} verified successfully.`);
    } catch (error: any) {
      showErrorAlert(error?.message || "Lot code save failed", "high");
    }
  };

  const handleResetSession = () => {
    if (resetConfirmStep === "pending") {
      setResetConfirmStep("confirmed");
      return;
    }

    resetAll();
    setShowResetConfirm(false);
    setResetConfirmStep("pending");
    setLotCodeValue("");
    showSuccessAlert("Verification session reset. Ready to scan new feeders.");
  };

  const cancelReset = () => {
    setShowResetConfirm(false);
    setResetConfirmStep("pending");
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 app-noise">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo className="h-10 w-10 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base font-bold truncate">Verification Station</h1>
              <p className="text-xs text-muted-foreground truncate">{appConfig.systemTitle}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card className="panel-pop scan-surface">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScanLine className="h-5 w-5" /> Verification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm font-semibold text-primary">{currentLabel}</div>

              {currentStep !== "lotCode" && currentStep !== "complete" && (
                <div className="space-y-2">
                  <Input
                    ref={inputRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Scan and press Enter"
                    className="scan-input-surface h-14 text-center font-mono text-xl"
                    autoComplete="off"
                  />
                </div>
              )}

              {currentStep === "lotCode" && (
                <div className="space-y-2">
                  <Label>Lot Code (Optional)</Label>
                  <Input
                    value={lotCodeValue}
                    onChange={(e) => setLotCodeValue(e.target.value)}
                    placeholder="Scan lot code"
                    className="scan-input-surface h-12 font-mono"
                  />
                  <div className="flex gap-2">
                    <Button onClick={submitLot}>Save Lot</Button>
                    <Button variant="outline" onClick={() => { setLotCodeValue(""); submitLotCode(""); showSuccessAlert(`Feeder ${activeFeederInput} verified successfully.`); }}>
                      Skip
                    </Button>
                    <Button variant="ghost" onClick={resetCurrentScan}>Cancel</Button>
                  </div>
                </div>
              )}

              {currentStep === "complete" && (
                <div className="rounded-md border border-success/30 bg-success/10 p-4 text-success">
                  <div className="text-lg font-bold">All Feeders Verified</div>
                  <div className="text-sm">Proceeding to splicing...</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="panel-pop scan-surface">
            <CardHeader>
              <CardTitle>Scanned Feeders</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {scanned.length === 0 ? (
                <div className="text-sm text-muted-foreground">No feeders scanned yet.</div>
              ) : (
                scanned.map((entry) => (
                  <div key={entry.feederId} className="flex items-center justify-between rounded border p-2 text-sm">
                    <div className="font-mono">{entry.feederId}</div>
                    <div className="font-mono text-muted-foreground">{entry.mpn}</div>
                    <div>{entry.status === "verified" ? "VERIFIED" : "ERROR"}</div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card className="panel-pop scan-surface">
            <CardHeader>
              <CardTitle>Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="relative h-28 w-28 shrink-0">
                  <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                    <circle cx="50" cy="50" r={ringRadius} className="stroke-border/40 fill-none" strokeWidth="10" />
                    <circle
                      cx="50"
                      cy="50"
                      r={ringRadius}
                      className="progress-ring stroke-primary fill-none"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringCircumference - (ringCircumference * progress.percentage) / 100}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-center">
                    <div>
                      <div className="text-3xl font-black">{progress.percentage}%</div>
                      <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Complete</div>
                    </div>
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="font-semibold text-foreground">{progress.verifiedCount} / {progress.totalRequired} feeders verified</div>
                  <div className="text-muted-foreground">Progress updates as the store receives each verified feeder.</div>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                {progress.remainingFeeders.map((id) => (
                  <div key={id} className="flex items-center gap-2">
                    <Circle className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono">{id}</span>
                  </div>
                ))}
                {progress.isComplete && (
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Completed</span>
                  </div>
                )}
              </div>
              <Button className="w-full" onClick={() => setLocation("/splicing")} disabled={!progress.isComplete}>
                Go To Splicing <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => setShowResetConfirm(true)}
                disabled={progress.verifiedCount === 0}
              >
                Reset Session
              </Button>
            </CardContent>
          </Card>

          <LogPanel />
        </div>
      </div>
      </div>

      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md border-2 border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive">
                {resetConfirmStep === "pending" ? "Reset Session?" : "Confirm Reset?"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground">
                {resetConfirmStep === "pending"
                  ? `This will clear all ${progress.verifiedCount} verified feeders and start fresh. This action cannot be undone.`
                  : "Click Confirm Reset again to proceed. All verification data will be cleared."}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={cancelReset} className="flex-1">
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleResetSession}
                  className="flex-1"
                >
                  {resetConfirmStep === "pending" ? "Reset" : "Confirm Reset"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <ScanNotification notifications={notifications} onDismiss={dismissNotification} />
    </div>
  );
}
