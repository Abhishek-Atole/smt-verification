import { useEffect, useState, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, CheckCircle2, XCircle, AlertTriangle, ScanLine, FileText, ThumbsUp, ThumbsDown } from "lucide-react";
import { format } from "date-fns";
import { useNotification } from "@/components/NotificationSystem";

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
  const scanInputRef = useRef<HTMLInputElement>(null);
  const { success, error } = useNotification();

  const [session, setSession] = useState<SessionData | null>(null);
  const [scans, setScans] = useState<FeederScanData[]>([]);
  const [splices, setSplices] = useState<SpliceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [qaNotes, setQaNotes] = useState("");
  const [currentFeeder, setCurrentFeeder] = useState("");
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
        setTimeout(() => scanInputRef.current?.focus(), 100);
      }
    } finally {
      setLocking(false);
    }
  };

  const handleManualConfirm = async () => {
    if (!window.confirm(`You are confirming all ${scans.length} feeder slots as manually verified. This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/verification/qa-queue/${sessionId}/manual-confirm`, {
        method: "POST", credentials: "include",
      });
      if (res.ok) {
        success("Manually Confirmed", "All feeders marked as manually verified");
        fetchDetail();
      } else {
        const data = await res.json();
        error("Failed to Confirm", data.error || "Unknown error");
      }
    } catch {
      error("Failed to Confirm", "Network error occurred");
    }
  };

  const handleRejectSplice = async (spliceId: string) => {
    if (!window.confirm("Reject this splice? This will mark it as failed.")) return;
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
    }
  };

  const handleApproveSplice = async (spliceId: string) => {
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
    }
  };
  const handleRescan = async (feederNumber: string, scannedValue?: string) => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch(`/api/verification/qa-queue/${sessionId}/rescan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ feederNumber, scannedValue: scannedValue ?? currentFeeder, notes: qaNotes || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        setScanResult({ feederNumber, qaResult: data.qaResult, message: `Feeder ${feederNumber}: ${data.qaResult}` });
        fetchDetail();
        setCurrentFeeder("");
        setQaNotes("");
      } else {
        setScanResult({ feederNumber, qaResult: "error", message: data.error ?? "Scan failed" });
      }
    } catch {
      setScanResult({ feederNumber, qaResult: "error", message: "Network error" });
    } finally {
      setScanning(false);
      setTimeout(() => scanInputRef.current?.focus(), 100);
    }
  };

  const handleComplete = async () => {
    try {
      const res = await fetch(`/api/verification/qa-queue/${sessionId}/complete`, {
        method: "POST", credentials: "include",
      });
      if (res.ok) {
        success("QA Review Completed", "Session has been marked as QA confirmed");
        fetchDetail();
      } else {
        const data = await res.json();
        error("Failed to Complete", data.error || "Unknown error");
      }
    } catch {
      error("Failed to Complete", "Network error occurred");
    }
  };

  const handleReleaseLock = async () => {
    await fetch(`/api/verification/qa-queue/${sessionId}/unlock`, {
      method: "POST", credentials: "include",
    });
    setIsLocked(false);
    setLocation("/feeder/qa-queue");
  };

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFeeder.trim()) return;
    // Expect input format: "feederNumber scannedValue" or just a barcode scan
    const parts = currentFeeder.trim().split(/\s+/);
    if (parts.length >= 2) {
      const fn = parts[0];
      const sv = parts.slice(1).join(" ");
      handleRescan(fn, sv);
    } else {
      const value = parts[0];
      // First try: match as feeder number
      const feederMatch = scans.find((s) => s.feederNumber === value);
      if (feederMatch) {
        handleRescan(value);
        return;
      }
      // Second try: match scanned value against expected MPN fields (bare MPN barcode)
      const upper = value.toUpperCase();
      const mpnMatch = scans.find((s) => {
        const e = s.expected;
        if (!e) return false;
        return (
          e.mpn1?.toUpperCase() === upper ||
          e.mpn2?.toUpperCase() === upper ||
          e.mpn3?.toUpperCase() === upper ||
          e.internalPartNumber?.toUpperCase() === upper
        );
      });
      if (mpnMatch) {
        handleRescan(mpnMatch.feederNumber, value);
      } else {
        setScanResult({ feederNumber: value, qaResult: "error", message: `Feeder ${value} not found in session` });
      }
    }
  };

  const pendingCount = scans.filter((s) => !s.qaResult || s.qaResult === "pending").length;
  const passedCount = scans.filter((s) => s.qaResult === "pass").length;
  const altAcceptedCount = scans.filter((s) => s.qaResult === "alternate_accepted").length;
  const failedCount = scans.filter((s) => s.qaResult === "fail").length;
  const manualConfirmedCount = scans.filter((s) => s.qaResult && s.qaResult !== "pending").length;
  const allDone = pendingCount === 0;

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!session) {
    return <div className="flex-1 flex items-center justify-center"><p className="text-muted-foreground font-mono">Session not found.</p></div>;
  }

  return (
    <div className="w-full space-y-4 sm:space-y-6 mt-6 sm:mt-8">
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
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {session.bomName ?? `BOM #${session.bomId}`} &mdash; Operator: {session.operatorName ?? session.operatorId.slice(0, 8)}
                &nbsp;&middot;&nbsp;Started {format(new Date(session.startedAt), "MMM d, HH:mm")}
              </p>
            </div>
          </div>
          {!isLocked && session.status !== "qa_confirmed" && (
            <Button onClick={acquireLock} disabled={locking} className="font-mono text-xs rounded-sm">
              {locking ? "Locking..." : "Start Review"}
            </Button>
          )}
          {isLocked && (
            <Button variant="outline" onClick={handleReleaseLock} className="font-mono text-xs rounded-sm">
              Release &amp; Go Back
            </Button>
          )}
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

        {/* Action buttons when reviewing */}
        {isLocked && (
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleManualConfirm} className="font-mono text-xs rounded-sm" variant="outline">
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              Confirm All — Manually Verified
            </Button>
            {allDone && (
              <Button onClick={handleComplete} className="font-mono text-xs rounded-sm">
                <FileText className="w-4 h-4 mr-1.5" />
                Complete QA Review
              </Button>
            )}
          </div>
        )}

        {/* Re-scan input when reviewing */}
        {isLocked && (
          <form onSubmit={handleScanSubmit} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-mono text-muted-foreground mb-1 block">Re-scan feeder (feederNumber scannedValue or barcode)</label>
              <Input
                ref={scanInputRef}
                value={currentFeeder}
                onChange={(e) => setCurrentFeeder(e.target.value)}
                placeholder="F01 MM1Z5V1  or  scan barcode..."
                className="font-mono text-sm rounded-sm bg-background border-border"
                disabled={scanning}
                autoFocus
              />
            </div>
            <Button type="submit" disabled={scanning || !currentFeeder.trim()} className="font-mono text-xs rounded-sm">
              <ScanLine className="w-4 h-4 mr-1.5" />
              {scanning ? "Verifying..." : "Re-scan"}
            </Button>
          </form>
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
                  <tr key={scan.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
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
            <h3 className="text-sm font-mono font-bold mb-2">Splice Records — QA Approval Required</h3>
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
                          {splice.qaResult === "pending" || !splice.qaResult ? (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs rounded-sm text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-700"
                                onClick={() => handleApproveSplice(splice.id)}
                              >
                                <ThumbsUp className="w-3 h-3 mr-1" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
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
        {session.status === "qa_confirmed" && (
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
