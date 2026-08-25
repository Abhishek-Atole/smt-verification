import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, CheckCircle2, XCircle, AlertTriangle, ScanLine, FileText, ThumbsUp, ThumbsDown, Keyboard } from "lucide-react";
import { format } from "date-fns";
import { useNotification } from "@/components/NotificationSystem";
import { useScanner } from "@/hooks/useScanner";

type QaResult = "pass" | "fail" | "alternate_accepted" | "pending" | null;

interface FeederScanData {
  id: number;
  feederNumber: string;
  scannedValue: string;
  matchedField: string | null;
  matchedMake: string | null;
  lotCode: string | null;
  status: string;
  scannedAt: string;
  operatorId: string;
  qaVerifiedById: string | null;
  qaVerifiedAt: string | null;
  qaResult: QaResult;
  qaNotes: string | null;
  expected: {
    feederNumber: string;
    mpn1: string | null;
    mpn2: string | null;
    mpn3: string | null;
    make1: string | null;
    make2: string | null;
    make3: string | null;
    description: string | null;
    internalPartNumber: string | null;
  } | null;
}

interface SpliceData {
  id: string;
  feederNumber: string | null;
  newSpoolMpn: string | null;
  qaResult: QaResult;
}

interface SessionData {
  id: string;
  operatorId: string;
  operatorName: string | null;
  status: string;
  startedAt: string;
  bomName: string | null;
  bomId: number;
  qaDiscrepancyFound: boolean | null;
  qaLockExpiresAt: string | null;
}

function QaResultBadge({ result }: { result: QaResult }) {
  if (!result || result === "pending") {
    return <Badge variant="outline" className="font-mono text-xs bg-slate-50 dark:bg-slate-900">PENDING</Badge>;
  }
  switch (result) {
    case "pass":
      return <Badge className="font-mono text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-0">PASS</Badge>;
    case "alternate_accepted":
      return <Badge className="font-mono text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-0">ALT&nbsp;ACCEPTED</Badge>;
    case "fail":
      return <Badge className="font-mono text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-0">FAIL</Badge>;
    default:
      return null;
  }
}

function ScanStatusBadge({ status }: { status: string }) {
  if (status === "verified" || status === "ok") {
    return <Badge className="font-mono text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-0">PASS</Badge>;
  }
  if (status === "failed" || status === "reject") {
    return <Badge className="font-mono text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-0">FAIL</Badge>;
  }
  return null;
}

export default function QAVerificationDetail() {
  const [, params] = useRoute<{ sessionId: string }>("/feeder/qa-queue/:sessionId");
  const sessionId = params?.sessionId ?? "";
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { success, error } = useNotification();

  const [session, setSession] = useState<SessionData | null>(null);
  const [scans, setScans] = useState<FeederScanData[]>([]);
  const [splices, setSplices] = useState<SpliceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [busySpliceId, setBusySpliceId] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [verifyMode, setVerifyMode] = useState<"scan" | "manual">("scan");
  const [qaScanStep, setQaScanStep] = useState<"feeder" | "mpn">("feeder");
  const [activeFeeder, setActiveFeeder] = useState("");
  const [scanResult, setScanResult] = useState<{ feederNumber: string; qaResult: string; message: string } | null>(null);

  const fetchDetail = async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/verification/qa-queue/${sessionId}`, { credentials: "include" });
      if (!res.ok) { setLocation("/feeder/qa-queue"); return; }
      const data = await res.json();
      setSession(data.session);
      setScans(data.scans ?? []);
      setSplices(data.splices ?? []);
    } catch {
      setLocation("/feeder/qa-queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDetail(); }, [sessionId]);

  const acquireLock = async () => {
    if (!sessionId) return;
    setLocking(true);
    try {
      const res = await fetch(`/api/verification/qa-queue/${sessionId}/lock`, {
        method: "POST", credentials: "include",
      });
      if (res.ok) {
        setIsLocked(true);
        fetchDetail();
      }
    } finally {
      setLocking(false);
    }
  };

  const handleManualConfirm = async () => {
    if (!window.confirm(`You are confirming all ${scans.length} feeder slots as manually verified. This cannot be undone.`)) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/verification/qa-queue/${sessionId}/manual-confirm`, {
        method: "POST", credentials: "include",
      });
      if (res.ok) {
        success("Manually Confirmed", "All feeders verified — QA confirmed");
        // manual-confirm finalizes the session (status qa_confirmed, lock released),
        // so this IS the completion — go straight to the queue, no extra Complete step.
        setTimeout(() => setLocation("/feeder/qa-queue"), 1400);
        return;
      }
      const data = await res.json();
      error("Failed to Confirm", data.error || "Unknown error");
      setConfirming(false);
    } catch {
      error("Failed to Confirm", "Network error occurred");
      setConfirming(false);
    }
  };

  const handleRejectSplice = async (spliceId: string) => {
    if (!window.confirm("Reject this splice? This will mark it as failed.")) return;
    setBusySpliceId(spliceId);
    try {
      const res = await fetch(`/api/verification/splices/${spliceId}/reject`, {
        method: "POST", credentials: "include",
      });
      if (res.ok) {
        success("Splice Rejected", "Splice has been marked as failed");
        fetchDetail();
      } else {
        error("Failed to Reject", "Could not reject splice");
      }
    } catch {
      error("Failed to Reject", "Network error occurred");
    } finally {
      setBusySpliceId(null);
    }
  };

  const handleApproveSplice = async (spliceId: string) => {
    setBusySpliceId(spliceId);
    try {
      const res = await fetch(`/api/verification/splices/${spliceId}/approve`, {
        method: "POST", credentials: "include",
      });
      if (res.ok) {
        success("Splice Approved", "Splice has been approved");
        fetchDetail();
      } else {
        error("Failed to Approve", "Could not approve splice");
      }
    } catch {
      error("Failed to Approve", "Network error occurred");
    } finally {
      setBusySpliceId(null);
    }
  };
  const rescanMessage = (fn: string, qaResult: string) => {
    switch (qaResult) {
      case "pass": return `Feeder ${fn} — PASS (exact match)`;
      case "alternate_accepted": return `Feeder ${fn} — ALTERNATE ACCEPTED`;
      case "fail": return `Feeder ${fn} — FAIL (does not match expected)`;
      default: return `Feeder ${fn}: ${qaResult}`;
    }
  };

  const handleRescan = async (feederNumber: string, scannedValue: string) => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch(`/api/verification/qa-queue/${sessionId}/rescan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ feederNumber, scannedValue }),
      });
      const data = await res.json();
      if (res.ok) {
        setScanResult({ feederNumber, qaResult: data.qaResult, message: rescanMessage(feederNumber, data.qaResult) });
        fetchDetail();
      } else {
        setScanResult({ feederNumber, qaResult: "error", message: data.error ?? "Scan failed" });
      }
    } catch {
      setScanResult({ feederNumber, qaResult: "error", message: "Network error" });
    } finally {
      setScanning(false);
      setQaScanStep("feeder");
      setActiveFeeder("");
    }
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      const res = await fetch(`/api/verification/qa-queue/${sessionId}/complete`, {
        method: "POST", credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // Both the splicing 200% close ("completed") and a normal 200% ("qa_confirmed")
        // return QA to the queue to pick up the next changeover. /complete already
        // releases the QA lock (qaLockExpiresAt: null), so no separate unlock is needed.
        if (data.status === "completed") {
          success("Changeover Completed", "Splicing verified — changeover closed");
        } else {
          success("QA Review Completed", "Session has been marked as QA confirmed");
        }
        // Hold the full-screen "Completing…" overlay ~1.4s so QA sees the result land,
        // then go to the queue. Leave `completing` true — the component unmounts on nav.
        setTimeout(() => setLocation("/feeder/qa-queue"), 1400);
        return;
      }
      error("Failed to Complete", data.error || "Unknown error");
      setCompleting(false);
    } catch {
      error("Failed to Complete", "Network error occurred");
      setCompleting(false);
    }
  };

  // "At once" path: approve every pending splice, then close the changeover in one click.
  // The individual Approve/Reject buttons remain for the one-by-one path.
  const handleApproveAllAndComplete = async () => {
    const pending = splices.filter((s) => !s.qaResult || s.qaResult === "pending");
    if (!window.confirm(`Approve all ${pending.length} pending splice(s) and close this changeover? This cannot be undone.`)) return;
    setCompleting(true);
    try {
      // Approve sequentially, not in parallel: the audit_logs chain is HMAC-linked,
      // so concurrent writes can corrupt it. One /approve = one audit row. Each is
      // idempotent, so an already-passed splice is a safe no-op.
      for (const splice of pending) {
        const res = await fetch(`/api/verification/splices/${splice.id}/approve`, {
          method: "POST", credentials: "include",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          error("Failed to Approve", data.error || `Could not approve splice for feeder ${splice.feederNumber ?? splice.id}`);
          setCompleting(false);
          fetchDetail();
          return;
        }
      }
      // All pending splices approved — /complete now clears the countUnverifiedSplices gate.
      const res = await fetch(`/api/verification/qa-queue/${sessionId}/complete`, {
        method: "POST", credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        success("Changeover Completed", "All splices approved — changeover closed");
        setTimeout(() => setLocation("/feeder/qa-queue"), 1400);
        return;
      }
      error("Failed to Complete", data.error || "Unknown error");
      setCompleting(false);
      fetchDetail();
    } catch {
      error("Failed to Complete", "Network error occurred");
      setCompleting(false);
    }
  };

  // Guided cross-verify: feeder step finds the slot, MPN step verifies via /rescan.
  const handleQaScan = (rawValue: string) => {
    const value = rawValue.trim();
    if (!value) return;
    if (qaScanStep === "feeder") {
      const match = scans.find((s) => s.feederNumber.toUpperCase() === value.toUpperCase());
      if (!match) {
        setScanResult({ feederNumber: value, qaResult: "error", message: `Feeder "${value}" not found in this session` });
        return;
      }
      setActiveFeeder(match.feederNumber);
      setQaScanStep("mpn");
      setScanResult(null);
      return;
    }
    // MPN step — verify the scanned component against the active feeder's BOM row
    handleRescan(activeFeeder, value);
  };

  const {
    inputRef,
    value: scanValue,
    setValue: setScanValue,
    handleKeyDown: handleScanKeyDown,
    reset: resetScanner,
  } = useScanner({ onSubmit: handleQaScan, autoFocus: isLocked && verifyMode === "scan" });

  const pendingCount = scans.filter((s) => !s.qaResult || s.qaResult === "pending").length;
  const passedCount = scans.filter((s) => s.qaResult === "pass").length;
  const altAcceptedCount = scans.filter((s) => s.qaResult === "alternate_accepted").length;
  const failedCount = scans.filter((s) => s.qaResult === "fail").length;
  const manualConfirmedCount = scans.filter((s) => s.qaResult && s.qaResult !== "pending").length;
  const allDone = pendingCount === 0;
  // Splices still awaiting a QA decision (pending/unset). Drives the one-click
  // "Approve All & Complete" shortcut and hides the plain Complete button while any remain.
  const pendingSplices = splices.filter((s) => !s.qaResult || s.qaResult === "pending");

  const activeExpectedMpn = scans.find((s) => s.feederNumber === activeFeeder)?.expected?.mpn1 ?? null;
  const qaStepLabel = qaScanStep === "feeder"
    ? "STEP 1 — Scan FEEDER NUMBER"
    : `STEP 2 — Scan MPN / INTERNAL ID  ·  Feeder ${activeFeeder}${activeExpectedMpn ? `, expected ${activeExpectedMpn}` : ""}`;

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!session) {
    return <div className="flex-1 flex items-center justify-center"><p className="text-muted-foreground font-mono">Session not found.</p></div>;
  }

  return (
    <div className="w-full space-y-4 sm:space-y-6 mt-6 sm:mt-8">
      {(completing || confirming) && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/85 backdrop-blur-sm">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
          <p className="font-mono text-sm text-muted-foreground">Completing QA review…</p>
        </div>
      )}
      <div className="px-4 sm:px-6 lg:px-8 flex flex-col gap-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setLocation("/feeder/qa-queue")} className="p-1.5 rounded-sm hover:bg-secondary transition-colors">
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </button>
            <div>
              <h1 className="text-xl sm:text-2xl font-mono font-bold tracking-tight text-foreground">
                QA REVIEW: {session.id}
              </h1>
              {session.status === "splicing_pending_qa" && (
                <Badge className="mt-1 font-mono text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-0">
                  SPLICING QA (200%) — approve each splice, or use Approve All &amp; Complete to close the changeover
                </Badge>
              )}
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {session.bomName ?? `BOM #${session.bomId}`} &mdash; Operator: {session.operatorName ?? session.operatorId.slice(0, 8)}
                &nbsp;&middot;&nbsp;Started {format(new Date(session.startedAt), "MMM d, HH:mm")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isLocked && session.status !== "qa_confirmed" && (
              <Button onClick={acquireLock} disabled={locking} className="font-mono text-xs rounded-sm">
                {locking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {locking ? "Starting…" : "Start Review"}
              </Button>
            )}
            {isLocked && allDone && pendingSplices.length === 0 && (
              <Button onClick={handleComplete} disabled={completing} className="font-mono text-xs rounded-sm">
                {completing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileText className="w-4 h-4 mr-1.5" />}
                {completing ? "Completing…" : "Complete QA Review"}
              </Button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
          <span>Progress:</span>
          <span className="text-green-600 dark:text-green-400">{manualConfirmedCount} confirmed</span>
          {altAcceptedCount > 0 && <span className="text-amber-600 dark:text-amber-400">{altAcceptedCount} alternate</span>}
          {failedCount > 0 && <span className="text-red-600 dark:text-red-400">{failedCount} failed</span>}
          {pendingCount > 0 && <span className="text-amber-600 dark:text-amber-400">{pendingCount} pending</span>}
          <span className="text-muted-foreground">/ {scans.length} total</span>
        </div>

        {/* Verify mode + actions when reviewing */}
        {isLocked && (
          <div className="space-y-3">
            {/* Mode toggle — QA chooses how to 200% verify */}
            <div className="inline-flex rounded-sm border border-border overflow-hidden font-mono text-xs">
              <button
                type="button"
                onClick={() => setVerifyMode("scan")}
                className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${verifyMode === "scan" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-secondary/50"}`}
              >
                <ScanLine className="w-4 h-4" /> Cross-verify by scanning
              </button>
              <button
                type="button"
                onClick={() => setVerifyMode("manual")}
                className={`flex items-center gap-1.5 px-3 py-2 border-l border-border transition-colors ${verifyMode === "manual" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-secondary/50"}`}
              >
                <Keyboard className="w-4 h-4" /> Confirm all manually
              </button>
            </div>

            {verifyMode === "manual" ? (
              <div className="flex flex-wrap gap-3 items-center">
                <Button onClick={handleManualConfirm} disabled={confirming} className="font-mono text-xs rounded-sm" variant="outline">
                  {confirming ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
                  {confirming ? "Confirming…" : "Confirm All — Manually Verified"}
                </Button>
                <span className="text-xs font-mono text-muted-foreground">
                  Marks every pending slot as verified without scanning — use only after a physical 200% check by hand.
                </span>
              </div>
            ) : (
              <div className="border border-border rounded-sm p-3 space-y-3 bg-secondary/20">
                {/* Guided step banner — mirrors the operator scanner */}
                <div className="flex items-center justify-between gap-2">
                  <div className={`text-xs font-mono font-bold px-2.5 py-1.5 rounded-sm ${qaScanStep === "feeder" ? "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                    {qaStepLabel}
                  </div>
                  {qaScanStep === "mpn" && !scanning && (
                    <button
                      type="button"
                      onClick={() => { setQaScanStep("feeder"); setActiveFeeder(""); resetScanner(); }}
                      className="text-xs font-mono text-muted-foreground hover:text-foreground underline"
                    >
                      ↺ change feeder
                    </button>
                  )}
                </div>

                <Input
                  ref={inputRef}
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  onKeyDown={handleScanKeyDown}
                  placeholder={qaScanStep === "feeder" ? "Scan FEEDER NUMBER…" : "Scan MPN / INTERNAL ID…"}
                  className="font-mono text-sm rounded-sm bg-background border-border"
                  disabled={scanning}
                  autoFocus
                />

                {scanning && (
                  <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying feeder {activeFeeder}…
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {scanResult && (
          <div className={`p-3 rounded-sm border text-sm font-mono ${
            scanResult.qaResult === "pass" ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/20 dark:border-green-800 dark:text-green-300" :
            scanResult.qaResult === "alternate_accepted" ? "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/20 dark:border-amber-800 dark:text-amber-300" :
            scanResult.qaResult === "fail" ? "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-300" :
            "bg-slate-50 border-slate-200 text-slate-800 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300"
          }`}>
            {scanResult.message}
          </div>
        )}

        {session.qaDiscrepancyFound && (
          <div className="flex items-center gap-3 border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800 rounded-sm p-4 text-sm text-red-800 dark:text-red-200 font-mono">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span>Discrepancy found during QA review. See discrepancy report for details.</span>
          </div>
        )}

        {/* Feeder scans table */}
        <div className="border border-border rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left p-3 text-xs text-muted-foreground font-semibold">SLOT</th>
                  <th className="text-left p-3 text-xs text-muted-foreground font-semibold">EXPECTED MPN</th>
                  <th className="text-left p-3 text-xs text-muted-foreground font-semibold">SCANNED</th>
                  <th className="text-left p-3 text-xs text-muted-foreground font-semibold">OPERATOR</th>
                  <th className="text-left p-3 text-xs text-muted-foreground font-semibold">QA STATUS</th>
                  <th className="text-left p-3 text-xs text-muted-foreground font-semibold hidden md:table-cell">NOTES</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <tr key={scan.id} className={`border-b border-border last:border-0 transition-colors ${scan.feederNumber === activeFeeder ? "bg-amber-50 dark:bg-amber-950/20" : "hover:bg-secondary/30"}`}>
                    <td className="p-3 font-bold text-xs">{scan.feederNumber}</td>
                    <td className="p-3 text-xs">
                      <div>{scan.expected?.mpn1 ?? "—"}</div>
                      {scan.expected?.mpn2 && <div className="text-muted-foreground text-[10px]">alt: {scan.expected.mpn2}</div>}
                    </td>
                    <td className="p-3 text-xs">
                      <div>{scan.scannedValue}</div>
                      <div className="text-muted-foreground text-[10px]">{scan.matchedField ?? ""}</div>
                    </td>
                    <td className="p-3 text-xs">
                      <ScanStatusBadge status={scan.status} />
                    </td>
                    <td className="p-3">
                      <QaResultBadge result={scan.qaResult} />
                    </td>
                    <td className="p-3 text-xs text-muted-foreground hidden md:table-cell">
                      {scan.qaNotes ?? ""}
                    </td>
                  </tr>
                ))}
                {scans.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground text-xs">
                      No feeder scans recorded for this session.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Splice records */}
        {splices.length > 0 && (
          <div>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <h3 className="text-sm font-mono font-bold">Splice Records — QA Approval Required</h3>
              {isLocked && pendingSplices.length > 0 && (
                <Button
                  onClick={handleApproveAllAndComplete}
                  disabled={completing || busySpliceId !== null}
                  className="font-mono text-xs rounded-sm"
                >
                  {completing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
                  {completing ? "Completing…" : `Approve All & Complete (${pendingSplices.length})`}
                </Button>
              )}
            </div>
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm font-mono">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="text-left p-3 text-xs text-muted-foreground font-semibold">FEEDER</th>
                    <th className="text-left p-3 text-xs text-muted-foreground font-semibold">NEW SPOOL MPN</th>
                    <th className="text-left p-3 text-xs text-muted-foreground font-semibold">QA STATUS</th>
                    {isLocked && <th className="text-left p-3 text-xs text-muted-foreground font-semibold">ACTION</th>}
                  </tr>
                </thead>
                <tbody>
                  {splices.map((splice) => (
                    <tr key={splice.id} className="border-b border-border last:border-0">
                      <td className="p-3 text-xs">{splice.feederNumber ?? "—"}</td>
                      <td className="p-3 text-xs">{splice.newSpoolMpn ?? "—"}</td>
                      <td className="p-3">
                        <QaResultBadge result={splice.qaResult} />
                      </td>
                      {isLocked && (
                        <td className="p-3">
                          {busySpliceId === splice.id ? (
                            <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…
                            </div>
                          ) : splice.qaResult === "pending" || !splice.qaResult ? (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busySpliceId !== null}
                                className="h-7 px-2 text-xs rounded-sm text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-700"
                                onClick={() => handleApproveSplice(splice.id)}
                              >
                                <ThumbsUp className="w-3 h-3 mr-1" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busySpliceId !== null}
                                className="h-7 px-2 text-xs rounded-sm text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-700"
                                onClick={() => handleRejectSplice(splice.id)}
                              >
                                <ThumbsDown className="w-3 h-3 mr-1" /> Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Bottom actions for completed review */}
        {(session.status === "qa_confirmed" || session.status === "completed") && (
          <div className="flex gap-3 mt-2">
            <Button variant="outline" onClick={() => setLocation("/feeder/qa-queue")} className="font-mono text-xs rounded-sm">
              Back to Queue
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
