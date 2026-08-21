
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Circle, Scissors, TriangleAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useScanner } from "@/hooks/useScanner";
import { useAutoScan } from "@/hooks/useAutoScan";
import { useNotification } from "@/hooks/use-notification";
import { ScanNotification } from "@/components/notifications/ScanNotification";
import { LogPanel } from "@/components/LogPanel";
import { AppLogo } from "@/components/AppLogo";
import { appConfig } from "@/lib/appConfig";
import { useAuth } from "@/context/auth-context";
import { useSession } from "@/context/session-context";
import { logger } from "@/lib/logger";
import { isAcceptToken } from "@/lib/accept-token";
import { getGetBomQueryKey, getGetSessionQueryKey, getListSplicesQueryKey, useGetBom, useGetSession, useListSplices, useRecordSplice } from "@workspace/api-client-react";

type WorkflowStep = "feeder" | "oldSpool" | "newSpool" | "newLot" | "confirm";
type SpoolField = "mpn1" | "mpn2" | "mpn3" | "internalId";
type RetryKey = WorkflowStep;

type BomLine = {
  feederNumber: string;
  mpn1: string | null;
  mpn2: string | null;
  mpn3: string | null;
  internalId: string | null;
  description: string | null;
  refDes: string | null;
  quantity: string | null;
  supplier: string | null;
};

type SpoolLabel = {
  raw: string;
  mpn1: string | null;
  mpn2: string | null;
  mpn3: string | null;
  internalId: string | null;
  lotNo: string | null;
  qty: string | null;
  supplier: string | null;
};

type StepFailure = {
  code: "NO_BOM_LOADED" | "FEEDER_NOT_IN_BOM" | "OLD_SPOOL_BOM_MISMATCH" | "NEW_SPOOL_MISMATCH" | "MAX_RETRY_EXCEEDED" | "MISSING_LOT_CODE" | "WRONG_FEEDER_ALLOCATION";
  step: WorkflowStep;
  message: string;
};

type MatchResult = {
  field: SpoolField;
  label: string;
  expected: string;
  received: string;
};

type FinalSummary = {
  feederNumber: string;
  bomPart: string;
  bomRefDes: string;
  oldSpoolId: string;
  oldMatched: string;
  oldLotQty: string;
  newSpoolId: string;
  newMatched: string;
  newLotQty: string;
  newLotCode: string;
  operatorId: string;
  timestampUtc: string;
};

type RemoteSpliceRecord = {
  id: number;
  sessionId: number;
  feederNumber: string;
  operatorId: string;
  oldSpoolBarcode: string;
  newSpoolBarcode: string;
  durationSeconds?: number | null;
  splicedAt: string;
  scannedValue?: string;
  matchedAs?: string;
  matchedField?: string | null;
  lotCode?: string | null;
  status?: "verified" | "alternate" | "failed";
  verificationMode?: "AUTO" | "MANUAL";
  bomItem?: unknown;
};

const FIELD_LABELS: Record<SpoolField, string> = {
  mpn1: "MPN 1",
  mpn2: "MPN 2",
  mpn3: "MPN 3",
  internalId: "Internal ID",
};

const RETRY_LIMIT = 5;

function normalizeValue(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["", "N/A", "NA", "NONE", "-"].includes(normalized)) {
    return "";
  }
  return normalized;
}

function parseLabelValue(source: string, keyPatterns: string[]): string | null {
  for (const pattern of keyPatterns) {
    const regex = new RegExp(`${pattern}\\s*[:=]\\s*([^\\n;|,]+)`, "i");
    const match = source.match(regex);
    if (match?.[1]) {
      const value = match[1].trim();
      if (value) return value;
    }
  }
  return null;
}

function parseSpoolLabel(raw: string): SpoolLabel {
  const trimmed = raw.trim();
  const fallback = trimmed || "";

  const fromJson = (() => {
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  const lookup = (keys: string[]) => {
    if (fromJson && typeof fromJson === "object") {
      const entries = Object.entries(fromJson).reduce<Record<string, unknown>>((acc, [key, value]) => {
        acc[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = value;
        return acc;
      }, {});
      for (const key of keys) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        const value = entries[normalizedKey];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
        if (typeof value === "number" && Number.isFinite(value)) {
          return String(value);
        }
      }
    }

    return parseLabelValue(trimmed, keys);
  };

  const mpn1 = lookup(["mpn1", "mpn_1", "mpn one", "mpn 1"]);
  const mpn2 = lookup(["mpn2", "mpn_2", "mpn two", "mpn 2"]);
  const mpn3 = lookup(["mpn3", "mpn_3", "mpn three", "mpn 3"]);
  const internalId = lookup(["internalid", "internal_id", "internal id", "internal"]);
  const lotNo = lookup(["lotno", "lot_no", "lot number", "lot"]);
  const qty = lookup(["qty", "quantity", "remaining qty", "remaining quantity"]);
  const supplier = lookup(["supplier", "vendor", "make"]);

  return {
    raw: fallback,
    mpn1: mpn1 || (fallback && !mpn2 && !mpn3 && !internalId ? fallback : null),
    mpn2: mpn2 || null,
    mpn3: mpn3 || null,
    internalId: internalId || (fallback && !mpn1 && !mpn2 && !mpn3 ? fallback : null),
    lotNo: lotNo || null,
    qty: qty || null,
    supplier: supplier || null,
  };
}

function normalizeBomLine(item: any): BomLine {
  const feederNumber = normalizeValue(item.feederNumber ?? item.feeder_number);
  const description = String(item.description ?? item.itemName ?? "").trim() || null;
  const refDes = String(item.reference ?? item.referenceDesignator ?? item.reference_designator ?? "").trim() || null;
  const internalId = String(item.internalId ?? item.ucalIntPn ?? item.internalPartNumber ?? item.partNumber ?? item.rdeplyPartNo ?? "").trim() || null;
  const supplier = String(item.supplier1 ?? item.make1 ?? item.manufacturer ?? "").trim() || null;

  return {
    feederNumber,
    mpn1: normalizeValue(item.mpn1 ?? item.mpn_1) || null,
    mpn2: normalizeValue(item.mpn2 ?? item.mpn_2) || null,
    mpn3: normalizeValue(item.mpn3 ?? item.mpn_3) || null,
    internalId: normalizeValue(internalId) || null,
    description,
    refDes,
    quantity: String(item.quantity ?? item.requiredQty ?? item.required_qty ?? "").trim() || null,
    supplier,
  };
}

function getFieldValue(entity: Pick<SpoolLabel, "mpn1" | "mpn2" | "mpn3" | "internalId"> | BomLine, field: SpoolField): string {
  return normalizeValue(entity[field]);
}

function findMatch(subject: Pick<SpoolLabel, "mpn1" | "mpn2" | "mpn3" | "internalId">, target: Pick<SpoolLabel, "mpn1" | "mpn2" | "mpn3" | "internalId"> | BomLine): MatchResult | null {
  for (const field of ["mpn1", "mpn2", "mpn3", "internalId"] as SpoolField[]) {
    const received = getFieldValue(subject, field);
    const expected = getFieldValue(target, field);
    if (received && expected && received === expected) {
      return {
        field,
        label: FIELD_LABELS[field],
        expected,
        received,
      };
    }
  }

  return null;
}

function formatUTC(date: Date) {
  return date.toISOString();
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }
  if (m > 0) {
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  return `${s}s`;
}

function normalizeRemoteRecord(record: RemoteSpliceRecord): RemoteSpliceRecord {
  return {
    ...record,
    feederNumber: String(record.feederNumber ?? ""),
    operatorId: String(record.operatorId ?? ""),
    oldSpoolBarcode: String(record.oldSpoolBarcode ?? ""),
    newSpoolBarcode: String(record.newSpoolBarcode ?? ""),
    splicedAt: new Date(record.splicedAt).toISOString(),
    durationSeconds: record.durationSeconds ?? null,
    scannedValue: String(record.scannedValue ?? record.newSpoolBarcode ?? ""),
    matchedAs: String(record.matchedAs ?? ""),
    matchedField: record.matchedField ?? null,
    lotCode: record.lotCode ?? null,
    status: record.status ?? "failed",
    verificationMode: record.verificationMode ?? "AUTO",
  };
}

async function postWorkflowAuditLog(payload: {
  sessionId: number;
  operatorId: string;
  step: WorkflowStep;
  code: StepFailure["code"];
  feederNumber: string;
  scannedValues: Record<string, unknown>;
  expectedValues: Record<string, unknown>;
  message: string;
}) {
  try {
    await fetch("/api/audit/log", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: "splice_workflow_error",
        entityId: `session_${payload.sessionId}_feeder_${payload.feederNumber || "unassigned"}`,
        action: payload.code,
        oldValue: {
          step: payload.step,
          feederNumber: payload.feederNumber,
          scannedValues: payload.scannedValues,
          expectedValues: payload.expectedValues,
          timestampUtc: formatUTC(new Date()),
        },
        newValue: {
          code: payload.code,
          message: payload.message,
        },
        changedBy: payload.operatorId,
        description: payload.message,
      }),
    });
  } catch (error) {
    logger.warn("Failed to record splice workflow audit log", error);
  }
}

export default function SplicingPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeSession, loading: sessionLoading } = useSession();
  const sessionId = Number(activeSession?.id ?? 0);
  const bomId = Number(activeSession?.bomId ?? 0);

  const sessionQuery = useGetSession(sessionId, {
    query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId) },
  });
  const bomQuery = useGetBom(bomId, {
    query: { enabled: !!bomId, queryKey: getGetBomQueryKey(bomId) },
  });
  const spliceQuery = useListSplices(sessionId, {
    query: { enabled: !!sessionId, queryKey: getListSplicesQueryKey(sessionId) },
  });
  const recordSpliceMutation = useRecordSplice();

  const [step, setStep] = useState<WorkflowStep>("feeder");
  const [feederNumber, setFeederNumber] = useState("");
  const [lockedBomItem, setLockedBomItem] = useState<BomLine | null>(null);
  const [oldSpool, setOldSpool] = useState<SpoolLabel | null>(null);
  const [oldMatch, setOldMatch] = useState<MatchResult | null>(null);
  const [newSpool, setNewSpool] = useState<SpoolLabel | null>(null);
  const [newMatch, setNewMatch] = useState<MatchResult | null>(null);
  const [newLotCode, setNewLotCode] = useState<string>("");
  const [workflowLocked, setWorkflowLocked] = useState(false);
  const [retryCounts, setRetryCounts] = useState<Record<RetryKey, number>>({ feeder: 0, oldSpool: 0, newSpool: 0, newLot: 0, confirm: 0 });
  const [workflowFailure, setWorkflowFailure] = useState<StepFailure | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [autoSubmitCountdown, setAutoSubmitCountdown] = useState<number | null>(null);
  const [workflowStartedAt, setWorkflowStartedAt] = useState<number | null>(null);
  const [overrideRole, setOverrideRole] = useState<"supervisor" | "qa">("supervisor");
  const [overridePassword, setOverridePassword] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideVerifying, setOverrideVerifying] = useState(false);

  // Latest onFinalize reference so the auto-submit timer always calls the
  // current version (it has fresh closures over `summary`, `lockedBomItem`, etc.)
  const onFinalizeRef = useRef<(() => Promise<void> | void) | null>(null);

  const {
    notifications,
    dismissNotification,
    showErrorAlert,
    showSuccessAlert,
    showWarningAlert,
  } = useNotification();

  useEffect(() => {
    if (!sessionLoading && !activeSession) {
      // No active session — fall back to the session-history list.
      setLocation("/sessions");
    }
  }, [activeSession, sessionLoading, setLocation]);

  useEffect(() => {
    if (workflowStartedAt === null) {
      setWorkflowStartedAt(Date.now());
    }
  }, [workflowStartedAt]);

  const backToVerificationHref = activeSession?.id
    ? `/session/${activeSession.id}?tab=loading`
    : "/sessions";

  useEffect(() => {
    document.title = `${appConfig.companyShort} | Splicing`;
  }, []);

  const bomItems = useMemo(() => (bomQuery.data?.items ?? []).map(normalizeBomLine).filter((item) => item.feederNumber), [bomQuery.data]);
  const bomByFeeder = useMemo(() => new Map(bomItems.map((item) => [item.feederNumber.toUpperCase(), item] as const)), [bomItems]);
  const records = useMemo(() => (spliceQuery.data ?? []).map((record) => normalizeRemoteRecord(record as RemoteSpliceRecord)), [spliceQuery.data]);

  const bomLoaded = !!bomId && !bomQuery.isLoading && bomItems.length > 0;
  // Approved "Skip BOM Verification" changeover: splicing must not reject on BOM
  // mismatch — feeder/spool scans are accepted as-is. The backend enforces the
  // same bypass; this only relaxes the client-side workflow gates.
  const bomBypass = (sessionQuery.data as { bomVerificationSkipped?: boolean } | undefined)?.bomVerificationSkipped === true;
  const currentSessionVerificationMode = String(sessionQuery.data?.verificationMode ?? "AUTO").toUpperCase() === "MANUAL" ? "MANUAL" : "AUTO";
  const operatorId = String(user?.userId ?? activeSession?.operatorId ?? "");

  const currentStepLabel = useMemo(() => {
    if (workflowLocked) {
      return `WORKFLOW LOCKED${workflowFailure?.code ? ` - ${workflowFailure.code}` : ""}`;
    }
    if (step === "feeder") return "STEP 1 / 6 - Scan FEEDER NUMBER";
    if (step === "oldSpool") return `STEP 2 / 6 - Scan OLD SPOOL for ${feederNumber}`;
    if (step === "newSpool") return `STEP 3 / 6 - Scan NEW SPOOL for ${feederNumber}`;
    if (step === "newLot") return `STEP 4 / 6 - Type NEW SPOOL LOT CODE for ${feederNumber} (manual entry)`;
    return `STEP 5 / 6 - Review and confirm splice for ${feederNumber}`;
  }, [feederNumber, step, workflowFailure?.code, workflowLocked]);

  const summary = useMemo<FinalSummary | null>(() => {
    if (!lockedBomItem || !oldSpool || !newSpool || !oldMatch || !newMatch) {
      return null;
    }

    return {
      feederNumber,
      bomPart: `${lockedBomItem.mpn1 || "-"} ${lockedBomItem.description ? `+ ${lockedBomItem.description}` : ""}`.trim(),
      bomRefDes: lockedBomItem.refDes || "-",
      oldSpoolId: `${oldSpool.internalId || oldSpool.raw || "-"} (${oldMatch.label}: ${oldMatch.received})`,
      oldMatched: `${oldMatch.label}: ${oldMatch.received}`,
      oldLotQty: `${oldSpool.lotNo || "-"} / ${oldSpool.qty || "-"}`,
      newSpoolId: `${newSpool.internalId || newSpool.raw || "-"} (${newMatch.label}: ${newMatch.received})`,
      newMatched: `${newMatch.label}: ${newMatch.received}`,
      newLotQty: `${newSpool.lotNo || "-"} / ${newSpool.qty || "-"}`,
      newLotCode: newLotCode || "-",
      operatorId: operatorId || "-",
      timestampUtc: formatUTC(new Date()),
    };
  }, [feederNumber, lockedBomItem, newLotCode, newMatch, newSpool, oldMatch, oldSpool, operatorId]);

  const currentBomItem = lockedBomItem;

  const recordFailure = async (failure: StepFailure, scannedValues: Record<string, unknown>, expectedValues: Record<string, unknown>) => {
    const nextCount = (retryCounts[failure.step] ?? 0) + 1;
    const shouldLock = nextCount >= RETRY_LIMIT;

    setRetryCounts((current) => ({ ...current, [failure.step]: nextCount }));
    setWorkflowFailure(failure);

    await postWorkflowAuditLog({
      sessionId,
      operatorId: operatorId || "system",
      step: failure.step,
      code: failure.code,
      feederNumber,
      scannedValues,
      expectedValues,
      message: failure.message,
    });

    if (shouldLock) {
      setWorkflowLocked(true);
      showErrorAlert(`MAX_RETRY_EXCEEDED - ${failure.message}. Supervisor override required.`, "high");
      return;
    }

    showErrorAlert(`${failure.code} - ${failure.message}`, "high");
  };

  const clearStepInput = () => {
    reset();
  };

  const resetWorkflow = () => {
    setStep("feeder");
    setFeederNumber("");
    setLockedBomItem(null);
    setOldSpool(null);
    setOldMatch(null);
    setNewSpool(null);
    setNewMatch(null);
    setNewLotCode("");
    setWorkflowLocked(false);
    setWorkflowFailure(null);
    setAutoSubmitCountdown(null);
    setRetryCounts({ feeder: 0, oldSpool: 0, newSpool: 0, newLot: 0, confirm: 0 });
    setWorkflowStartedAt(Date.now());
    resetOverrideState();
    clearStepInput();
  };

  const resetOverrideState = () => {
    setOverridePassword("");
    setOverrideError(null);
    setOverrideVerifying(false);
  };

  const handleOverride = async () => {
    if (!overridePassword) {
      setOverrideError("Supervisor/QA password is required.");
      return;
    }
    setOverrideVerifying(true);
    setOverrideError(null);
    try {
      const res = await fetch("/api/auth/verify-override", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: overridePassword, role: overrideRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setOverrideError(body?.error || "Override verification failed.");
        setOverrideVerifying(false);
        return;
      }
      const data = await res.json();
      showSuccessAlert(`Override approved by ${data.approverName} (${data.approverRole}). Workflow unlocked.`, "medium");
      setWorkflowLocked(false);
      setWorkflowFailure(null);
      setRetryCounts((prev) => ({ ...prev, [workflowFailure?.step ?? "oldSpool"]: 0 }));
      setStep(workflowFailure?.step ?? "oldSpool");
      resetOverrideState();
    } catch {
      setOverrideError("Network error. Please try again.");
      setOverrideVerifying(false);
    }
  };

  const cancelAutoSubmit = () => {
    setAutoSubmitCountdown(null);
  };

  const onFinalize = async () => {
    if (!summary || !lockedBomItem || !oldSpool || !newSpool || !oldMatch || !newMatch || !sessionId) {
      showErrorAlert("No confirmed splice is ready to finalize.", "high");
      return;
    }

    setFinalizing(true);
    try {
      const newBarcode = String(newSpool[newMatch.field] ?? newSpool.raw).trim();
      const oldBarcode = String(oldSpool[oldMatch.field] ?? oldSpool.raw).trim();
      const capturedDuration = workflowStartedAt
        ? Math.max(0, Math.round((Date.now() - workflowStartedAt) / 1000))
        : 0;
      const response = await recordSpliceMutation.mutateAsync({
        sessionId,
        data: {
          feederNumber,
          operatorId: operatorId || "0",
          scannedValue: newBarcode,
          oldSpoolBarcode: oldBarcode,
          newSpoolBarcode: newBarcode,
          durationSeconds: capturedDuration,
          matchedAs: newMatch.label,
          matchedField: newMatch.field,
          status: newMatch.field === "mpn1" ? "verified" : "alternate",
          verificationMode: currentSessionVerificationMode,
          newLotCode: newLotCode || null,
          oldSpool: {
            barcode: oldBarcode,
            label: oldSpool,
            lotCode: oldSpool.lotNo ?? null,
          },
          newSpool: {
            barcode: newBarcode,
            label: newSpool,
            lotCode: newSpool.lotNo ?? null,
          },
        } as any,
      });

      const normalized = normalizeRemoteRecord((response ?? {}) as RemoteSpliceRecord);
      queryClient.setQueryData(getListSplicesQueryKey(sessionId), (current: unknown) => {
        const currentList = Array.isArray(current) ? (current as RemoteSpliceRecord[]) : [];
        return [normalized, ...currentList];
      });

      showSuccessAlert(`Splice saved successfully for feeder ${feederNumber}.`, "medium");
      resetWorkflow();
    } catch (error: any) {
      // Surface API validation errors (e.g. MISSING_LOT_CODE, WRONG_FEEDER_ALLOCATION)
      // as workflow failures so the user can retry the appropriate step.
      const apiCode = error?.response?.data?.code ?? error?.body?.code ?? null;
      const apiMessage = error?.response?.data?.error ?? error?.body?.error ?? error?.message ?? "Failed to save splice.";

      if (apiCode === "MISSING_LOT_CODE" || apiCode === "WRONG_FEEDER_ALLOCATION" || apiCode === "OLD_SPOOL_BOM_MISMATCH") {
        const failure: StepFailure = {
          code: apiCode,
          step: apiCode === "WRONG_FEEDER_ALLOCATION" ? "newSpool" : "newSpool",
          message: apiMessage,
        };
        await recordFailure(failure, { apiError: apiMessage, apiCode }, { feederNumber, newSpool, oldSpool });
        // Roll back to the new-spool step so the user can re-scan
        setStep("newSpool");
        setNewSpool(null);
        setNewMatch(null);
        clearStepInput();
      } else {
        showErrorAlert(apiMessage, "high");
      }
    } finally {
      setFinalizing(false);
    }
  };

  // Keep the latest onFinalize available to non-React timers/listeners
  // without re-binding them on every render.
  onFinalizeRef.current = onFinalize;

  // ─── Auto-submit timer ────────────────────────────────────────────────────────
  // When the operator reaches the confirm step, give them 5 seconds to review
  // the summary, then automatically submit. The manual "Submit & Finalize" button
  // and the Enter key both submit immediately (and clear this timer).
  const AUTO_SUBMIT_SECONDS = 5;

  useEffect(() => {
    if (step !== "confirm" || !summary || finalizing || workflowLocked) {
      setAutoSubmitCountdown(null);
      return;
    }

    setAutoSubmitCountdown(AUTO_SUBMIT_SECONDS);
    const tick = setInterval(() => {
      setAutoSubmitCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(tick);
          // Fire-and-forget — onFinalize handles its own state.
          onFinalizeRef.current?.();
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [step, summary, finalizing, workflowLocked]);

  // ─── Enter-to-submit ─────────────────────────────────────────────────────────
  // During the confirm step, pressing Enter on the keyboard (outside of any
  // text input) submits the splice immediately. The manual button stays available.
  useEffect(() => {
    if (step !== "confirm" || finalizing || workflowLocked) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      // Don't intercept Enter when the user is typing in an input/textarea/contentEditable
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      event.preventDefault();
      onFinalizeRef.current?.();
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [step, finalizing, workflowLocked]);

  const handleWorkflowScan = async (raw: string) => {
    if (workflowLocked) {
      showWarningAlert("Workflow is locked. Supervisor override is required.", "high");
      return;
    }

    const value = raw.trim();
    if (!value) return;

    // App accept barcode: at the confirm step it finalizes the splice (same as
    // the button / Enter). At data-entry steps it is not a scannable value, so
    // ignore it rather than storing the token (e.g. as a lot code).
    if (isAcceptToken(value)) {
      if (step === "confirm") {
        cancelAutoSubmit();
        void onFinalize();
      }
      clearStepInput();
      return;
    }

    if (!bomLoaded && !bomBypass) {
      const failure: StepFailure = {
        code: "NO_BOM_LOADED",
        step: "feeder",
        message: "A BOM must be loaded before splicing can begin.",
      };
      await recordFailure(failure, { scannedValue: value }, { bomLoaded: false });
      clearStepInput();
      return;
    }

    if (step === "feeder") {
      const normalizedFeeder = normalizeValue(value);
      const bomItem = bomByFeeder.get(normalizedFeeder);
      if (!bomItem && !bomBypass) {
        const failure: StepFailure = {
          code: "FEEDER_NOT_IN_BOM",
          step: "feeder",
          message: `Feeder ${normalizedFeeder} was not found in the loaded BOM.`,
        };
        await recordFailure(failure, { feederNumber: normalizedFeeder }, { expectedFeeders: bomItems.map((item) => item.feederNumber) });
        clearStepInput();
        return;
      }

      // Bypass: accept a feeder that isn't in the BOM as a free-scan line.
      const lockedItem: BomLine = bomItem ?? {
        feederNumber: normalizedFeeder,
        mpn1: null, mpn2: null, mpn3: null,
        internalId: null, description: null, refDes: null,
        quantity: null, supplier: null,
      };

      setFeederNumber(normalizedFeeder);
      setLockedBomItem(lockedItem);
      setStep("oldSpool");
      setWorkflowFailure(null);
      setRetryCounts((current) => ({ ...current, feeder: 0 }));
      clearStepInput();
      showSuccessAlert(`Feeder ${normalizedFeeder} accepted. Scan the old spool now.`, "medium");
      return;
    }

    if (step === "oldSpool") {
      if (!lockedBomItem) {
        showErrorAlert("No feeder is locked. Scan a feeder first.", "high");
        clearStepInput();
        return;
      }

      const parsed = parseSpoolLabel(value);
      let match = findMatch(parsed, lockedBomItem);
      if (!match) {
        if (!bomBypass) {
          const failure: StepFailure = {
            code: "OLD_SPOOL_BOM_MISMATCH",
            step: "oldSpool",
            message: `Old spool does not match BOM feeder ${feederNumber}.`,
          };
          await recordFailure(failure, parsed, { feederNumber, bom: lockedBomItem });
          clearStepInput();
          return;
        }
        match = { field: "internalId", label: "BOM bypassed", expected: "-", received: parsed.internalId || parsed.raw };
      }

      setOldSpool(parsed);
      setOldMatch(match);
      setStep("newSpool");
      setWorkflowFailure(null);
      setRetryCounts((current) => ({ ...current, oldSpool: 0 }));
      clearStepInput();
      showSuccessAlert(`Old spool accepted via ${match.label}.`, "medium");
      return;
    }

    if (step === "newSpool") {
      if (!oldSpool || !oldMatch) {
        showErrorAlert("Old spool must be confirmed before scanning the new spool.", "high");
        clearStepInput();
        return;
      }
      if (!lockedBomItem) {
        showErrorAlert("No feeder is locked. Scan a feeder first.", "high");
        clearStepInput();
        return;
      }

      const parsed = parseSpoolLabel(value);

      // New spool must match one of MPN1, MPN2, MPN3, or Internal ID for the locked feeder.
      // We do NOT require it to match the same field as the old spool — the new spool
      // can be a different alternate of the same part number. Re-scanning the same
      // physical spool is also allowed (the operator may simply be re-confirming).
      const match = findMatch(parsed, lockedBomItem);
      if (!match) {
        if (!bomBypass) {
          const failure: StepFailure = {
            code: "NEW_SPOOL_MISMATCH",
            step: "newSpool",
            message: `New spool does not match BOM feeder ${feederNumber} (MPN1, MPN2, MPN3, or Internal ID).`,
          };
          await recordFailure(failure, parsed, { feederNumber, bom: lockedBomItem });
          clearStepInput();
          return;
        }
        setNewSpool(parsed);
        setNewMatch({ field: "internalId", label: "BOM bypassed", expected: "-", received: parsed.internalId || parsed.raw });
        setStep("newLot");
        setWorkflowFailure(null);
        setRetryCounts((current) => ({ ...current, newSpool: 0 }));
        clearStepInput();
        showSuccessAlert("New spool accepted (BOM bypassed). Scan the new spool LOT CODE.", "medium");
        return;
      }

      setNewSpool(parsed);
      setNewMatch(match);
      setStep("newLot");
      setWorkflowFailure(null);
      setRetryCounts((current) => ({ ...current, newSpool: 0 }));
      clearStepInput();
      showSuccessAlert(`New spool accepted via ${match.label}. Scan the new spool LOT CODE.`, "medium");
      return;
    }

    if (step === "newLot") {
      if (!newSpool || !newMatch) {
        showErrorAlert("New spool must be confirmed before scanning the lot code.", "high");
        clearStepInput();
        return;
      }

      // The lot code scan is a free-form value — no BOM validation. The operator
      // can scan a separate label, type a code, or use whatever identifier the
      // spliced spool carries. Empty scans are rejected; otherwise we accept.
      const scannedLot = value.trim();
      if (!scannedLot) {
        clearStepInput();
        return;
      }

      setNewLotCode(scannedLot);
      setStep("confirm");
      setWorkflowFailure(null);
      setRetryCounts((current) => ({ ...current, newLot: 0 }));
      clearStepInput();
      showSuccessAlert(`Lot code "${scannedLot}" captured. Review and confirm the splice.`, "medium");
      return;
    }
  };

  const { inputRef, value, setValue, reset, handleKeyDown } = useScanner({
    onSubmit: handleWorkflowScan,
    autoFocus: true,
    resetAfterMs: 10000,
  });

  useAutoScan(value, {
    onScan: handleWorkflowScan,
    delayMs: 300,
    minLength: 1,
    // Auto-scan is disabled for the lot-code step — that field requires
    // manual entry (typed value + Enter, or the "Capture Lot Code" button).
    enabled: !workflowLocked && step !== "confirm" && step !== "newLot",
  });

  // ─── Loading state ────────────────────────────────────────────────────────────
  if (sessionLoading || bomQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <Card className="border-border shadow-sm">
          <CardContent className="flex items-center justify-center py-16 text-muted-foreground">
            Loading splice workflow...
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── No BOM state ─────────────────────────────────────────────────────────────
  // Skipped when the changeover has an approved BOM-verification bypass.
  if (!bomLoaded && !bomBypass) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <AppLogo className="h-10 w-10 shrink-0" />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold">Splicing Station</h1>
                <p className="truncate text-xs text-muted-foreground">{appConfig.systemTitle}</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => setLocation(backToVerificationHref)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Feeder Verification
            </Button>
          </div>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="h-5 w-5 text-red-600" /> Workflow blocked
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                <div className="font-bold">NO_BOM_LOADED</div>
                <div className="mt-1">Load a BOM into the active session before starting the splice workflow.</div>
              </div>
              <Button onClick={() => setLocation(backToVerificationHref)}>Return to Feeder Verification</Button>
            </CardContent>
          </Card>
        </div>

        <ScanNotification notifications={notifications} onDismiss={dismissNotification} />
        <LogPanel />
      </div>
    );
  }

  // ─── Main page ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen overflow-y-auto bg-gradient-to-b from-background via-background to-muted/20 app-noise">

      {/* Decorative blobs — fixed so they never push content */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 top-[-6rem] h-72 w-72 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute right-[-5rem] top-24 h-80 w-80 rounded-full bg-slate-500/10 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      {/* ── Single scrollable column ─────────────────────────────────────────── */}
      <div className="relative w-full space-y-6 px-4 py-6 md:px-6">

        {/* ═══════════════════════════════════════════════════════════════════════
            SECTION 1 — PAGE HEADER (title + session pills)
        ═══════════════════════════════════════════════════════════════════════ */}
        <div className="overflow-hidden rounded-3xl border border-border/70 bg-card/85 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
          {/* Title bar */}
          <div className="flex flex-col gap-4 border-b border-border/60 bg-gradient-to-r from-slate-950 via-slate-900 to-amber-900 px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between md:px-6">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 shadow-inner shadow-black/20">
                <AppLogo className="h-9 w-9" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.28em] text-amber-200">
                  <Scissors className="h-3.5 w-3.5" /> Guided Splice Station
                </div>
                <h1 className="truncate text-2xl font-black tracking-tight md:text-3xl">Splicing Station</h1>
                <p className="max-w-2xl text-sm text-slate-300">
                  Scan the feeder, old spool, and new spool in one flow. Every mismatch is logged and the final record is saved back to the session.
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <Button
                variant="secondary"
                className="border-white/10 bg-white/10 text-white hover:bg-white/20"
                onClick={() => setLocation(backToVerificationHref)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" /> Back To Verification
              </Button>
            </div>
          </div>

          {/* Session summary pills */}
          <div className="grid grid-cols-2 gap-3 px-5 py-4 md:px-6 lg:grid-cols-4">
            {[
              { label: "Session",  value: activeSession?.id || sessionId },
              { label: "BOM",      value: activeSession?.bomId || bomId },
              { label: "Operator", value: operatorId || "Unknown" },
              { label: "Mode",     value: `${currentSessionVerificationMode} / ${workflowLocked ? "Locked" : "Ready"}` },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-2xl border border-border/70 bg-muted/30 p-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
                <div className="mt-1 truncate font-mono text-sm font-semibold">{String(value)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            SECTION 2 — SPLICING VERIFICATION (full-width, TOP priority)
        ═══════════════════════════════════════════════════════════════════════ */}
        <Card className="overflow-hidden border-border/70 bg-card/90 shadow-[0_16px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <CardHeader className="border-b border-border/60 bg-gradient-to-r from-amber-50 via-background to-background pb-4">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <Scissors className="h-5 w-5 text-amber-600" /> Guided Splice Workflow
            </CardTitle>
            <p className="text-xs text-muted-foreground md:text-sm">
              Follow the five-step flow below. The page locks down each step once it is accepted.
            </p>
          </CardHeader>

          <CardContent className="space-y-5 p-4 md:p-6">

            {/* Step progress tracker — full width across 6 cols */}
            <div className="grid grid-cols-2 gap-2 text-center text-xs font-bold uppercase tracking-[0.2em] sm:grid-cols-3 lg:grid-cols-6">
              {[
                { key: "feeder",   label: "Feeder",    done: step !== "feeder" && step !== "oldSpool" },
                { key: "oldSpool", label: "Old Spool", done: step === "newSpool" || step === "newLot" || step === "confirm" },
                { key: "newSpool", label: "New Spool", done: step === "newLot" || step === "confirm" },
                { key: "newLot",   label: "Lot Code",  done: step === "confirm" },
                { key: "confirm",  label: "Review",    done: step === "confirm" },
                { key: "submit",   label: finalizing ? "Submitting" : "Submit", done: finalizing },
              ].map((item, index) => {
                const isActive =
                  (item.key === "feeder"   && step === "feeder")   ||
                  (item.key === "oldSpool" && step === "oldSpool") ||
                  (item.key === "newSpool" && step === "newSpool") ||
                  (item.key === "newLot"   && step === "newLot")   ||
                  (item.key === "confirm"  && step === "confirm")  ||
                  (item.key === "submit"   && finalizing);

                return (
                  <div
                    key={item.key}
                    className={`rounded-2xl border px-3 py-3 transition-all ${
                      isActive
                        ? "border-amber-400 bg-amber-50 text-amber-800 shadow-sm"
                        : item.done
                          ? "border-emerald-200 bg-emerald-50/70 text-emerald-700"
                          : "border-border bg-muted/25 text-muted-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span>{index + 1}</span>
                      <span className="tracking-[0.28em]">{item.done ? "OK" : isActive ? "NOW" : "WAIT"}</span>
                    </div>
                    <div className="mt-1.5 text-xs md:text-sm">{item.label}</div>
                  </div>
                );
              })}
            </div>

            {/* Two-column: step context + scan input side by side on md+ */}
            <div className="grid gap-4 md:grid-cols-2">

              {/* Left col: current step status + feeder/BOM info */}
              <div className={`rounded-2xl border p-4 ${workflowLocked ? "border-red-300 bg-red-50/80" : "border-border/70 bg-card shadow-inner"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-sm font-semibold tracking-wide text-foreground md:text-base">{currentStepLabel}</Label>
                  <div className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${workflowLocked ? "border-red-300 bg-red-100 text-red-700" : "border-border bg-muted/30 text-muted-foreground"}`}>
                    {currentSessionVerificationMode} mode
                  </div>
                </div>

                {workflowFailure && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                    <div className="font-bold">{workflowFailure.code}</div>
                    <div className="mt-1">{workflowFailure.message}</div>
                  </div>
                )}

                {workflowLocked && (
                  <div className="mt-3 space-y-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                    <div>
                      <div className="font-bold">MAX_RETRY_EXCEEDED</div>
                      <div className="mt-1">Supervisor/QA override required before the workflow can continue.</div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${overrideRole === "supervisor" ? "bg-red-200 text-red-900" : "bg-red-100/50 text-red-700 hover:bg-red-100"}`}
                          onClick={() => { setOverrideRole("supervisor"); setOverrideError(null); }}
                        >Supervisor</button>
                        <button
                          type="button"
                          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${overrideRole === "qa" ? "bg-red-200 text-red-900" : "bg-red-100/50 text-red-700 hover:bg-red-100"}`}
                          onClick={() => { setOverrideRole("qa"); setOverrideError(null); }}
                        >QA</button>
                      </div>
                      <input
                        type="password"
                        value={overridePassword}
                        onChange={(e) => { setOverridePassword(e.target.value); setOverrideError(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") handleOverride(); }}
                        placeholder={`${overrideRole === "supervisor" ? "Supervisor" : "QA"} password`}
                        className="w-full rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-red-900 placeholder-red-400 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                        disabled={overrideVerifying}
                      />
                      {overrideError && (
                        <div className="text-xs font-semibold text-red-600">{overrideError}</div>
                      )}
                      <button
                        type="button"
                        onClick={handleOverride}
                        disabled={overrideVerifying}
                        className="w-full rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                      >
                        {overrideVerifying ? "Verifying..." : "Verify & Unlock"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Feeder</div>
                    <div className="mt-1 font-mono text-lg font-bold">{feederNumber || "—"}</div>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Matched BOM</div>
                    <div className="mt-1 font-mono text-sm font-semibold">
                      {lockedBomItem ? `${lockedBomItem.mpn1 || "-"} ${lockedBomItem.description ? `+ ${lockedBomItem.description}` : ""}`.trim() : "—"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{lockedBomItem?.refDes || "RefDes not set"}</div>
                  </div>
                </div>
              </div>

              {/* Right col: scan input box + action buttons */}
              {step !== "confirm" && !workflowLocked ? (
                <div className="flex flex-col gap-3 md:col-span-2">
                  <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-sm md:p-6">
                    <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                      <span>Live scan input</span>
                      <span>{step === "feeder" ? "Feeder" : step === "oldSpool" ? "Old spool" : step === "newSpool" ? "New spool" : "Lot code"}</span>
                    </div>
                    <Input
                      ref={inputRef}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={
                        step === "feeder"   ? "Scan feeder number"
                        : step === "oldSpool" ? "Scan old spool label"
                        : step === "newSpool" ? "Scan new spool label"
                        : "Type LOT CODE then press Enter (manual entry)"
                      }
                      className="h-24 border-2 border-dashed border-amber-200 bg-background/95 text-center font-mono text-2xl font-semibold tracking-[0.22em] shadow-inner focus-visible:border-amber-500 md:h-28 md:text-3xl lg:h-32 lg:text-4xl"
                      autoComplete="off"
                    />
                  </div>

                  <div className="mt-auto grid gap-2 sm:grid-cols-2">
                    <Button type="button" variant="outline" className="h-11 border-border/70 bg-background/80" onClick={resetWorkflow}>
                      Reset Workflow
                    </Button>
                    {step === "oldSpool" && (
                      <Button type="button" className="h-11 bg-amber-600 text-white hover:bg-amber-700" onClick={() => handleWorkflowScan(value)}>
                        Validate Old Spool
                      </Button>
                    )}
                    {step === "newSpool" && (
                      <Button type="button" className="h-11 bg-amber-600 text-white hover:bg-amber-700" onClick={() => handleWorkflowScan(value)}>
                        Validate New Spool
                      </Button>
                    )}
                    {step === "newLot" && (
                      <Button type="button" className="h-11 bg-amber-600 text-white hover:bg-amber-700" onClick={() => handleWorkflowScan(value)}>
                        Capture Lot Code
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                /* Placeholder when scan input is hidden (confirm step or locked) */
                <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/10 p-6 text-sm text-muted-foreground">
                  {workflowLocked ? "Enter supervisor/QA password in the panel on the left to unlock." : "Review the summary below before submitting."}
                </div>
              )}
            </div>

            {/* Confirm & submit review — full width within the card */}
            {step === "confirm" && summary && (
              <div className="space-y-4 rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-background to-emerald-100/50 p-4 shadow-[0_16px_40px_rgba(16,185,129,0.12)] dark:border-emerald-900/40 dark:from-emerald-950/30 dark:via-background dark:to-emerald-900/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-700 dark:text-emerald-300">Final review</div>
                      <div className="mt-1 text-sm text-muted-foreground">Confirm the record before it is written to the session log.</div>
                    </div>
                    {autoSubmitCountdown !== null && !finalizing && (
                      <div
                        data-testid="auto-submit-countdown"
                        className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-800 shadow-sm dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                      >
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                        Auto-submit in {autoSubmitCountdown}s — press Enter or click the button to submit now
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    { label: "Feeder No.",   value: summary.feederNumber, note: "Locked from Step 1" },
                    { label: "BOM Part",     value: summary.bomPart || "-", note: `RefDes: ${summary.bomRefDes}` },
                    { label: "Old Spool ID", value: summary.oldSpoolId, note: `Old Lot / Qty: ${summary.oldLotQty}` },
                    { label: "New Spool ID", value: summary.newSpoolId, note: `New Lot / Qty: ${summary.newLotQty}` },
                    { label: "New Lot Code", value: summary.newLotCode, note: "Scanned in Step 4" },
                    { label: "Operator ID", value: summary.operatorId, note: "Current operator" },
                    { label: "Timestamp",    value: summary.timestampUtc, note: "UTC time" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-border/70 bg-background/90 p-3 shadow-sm">
                      <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{item.label}</div>
                      <div className="mt-2 break-words font-mono text-sm font-semibold text-foreground">{item.value}</div>
                      <div className="mt-2 text-xs text-muted-foreground">{item.note}</div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" className="h-11 border-border/70 bg-background/80" onClick={resetWorkflow}>
                    Start Over
                  </Button>
                  <Button
                    type="button"
                    className="h-11 bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() => {
                      cancelAutoSubmit();
                      onFinalize();
                    }}
                    disabled={finalizing}
                  >
                    {finalizing ? "Submitting..." : "Submit & Finalize"}
                  </Button>
                </div>

                {/* Three-way accept: the button above, Enter, or the app accept
                    barcode (##ACCEPT##) scanned into this field. */}
                {!finalizing && (
                  <input
                    autoFocus
                    aria-label="Scan accept barcode or press Enter to finalize"
                    className="w-full text-center text-xs font-mono tracking-widest bg-background/80 border border-emerald-300 dark:border-emerald-800 rounded px-2 py-1 text-emerald-900 dark:text-emerald-100 placeholder:text-emerald-500/60"
                    placeholder="Scan ✓ accept barcode or press ENTER to submit"
                    autoComplete="off"
                    onChange={(e) => {
                      if (isAcceptToken(e.currentTarget.value)) {
                        e.currentTarget.value = "";
                        cancelAutoSubmit();
                        void onFinalize();
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.value = "";
                        cancelAutoSubmit();
                        void onFinalize();
                      }
                    }}
                  />
                )}
              </div>
            )}

            {/* Info footer */}
            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
              Step 1 checks the feeder against the loaded BOM. Step 2 requires the old spool to match one BOM field. Step 3 requires the new spool to match the BOM for that feeder (MPN1, MPN2, MPN3, or Internal ID). Step 4 captures the new spool's LOT CODE — this field requires <b>manual entry</b> (type the value and press Enter, or click "Capture Lot Code"). Auto-scan is disabled for the lot-code step.               Step 5 shows a 5-second preview with a countdown; the splice <b>auto-submits</b> when the timer reaches 0, but the manual <b>Submit & Finalize</b> button and the <b>Enter</b> key both submit immediately.
            </div>
          </CardContent>
        </Card>

        {/* Loaded BOM line */}
        <Card className="overflow-hidden border-border/70 bg-card/90 shadow-[0_8px_30px_rgba(15,23,42,0.07)]">
            <CardHeader className="border-b border-border/60 bg-gradient-to-r from-slate-50 via-background to-background py-3">
              <CardTitle className="text-sm">Loaded BOM Line</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3 text-sm">
              {currentBomItem ? (
                <>
                  {[
                    { label: "Feeder",      value: currentBomItem.feederNumber, mono: true, bold: true },
                    { label: "MPN1",        value: currentBomItem.mpn1 || "-", mono: true },
                    { label: "Description", value: currentBomItem.description || "-" },
                    { label: "RefDes",      value: currentBomItem.refDes || "-" },
                    { label: "Internal ID", value: currentBomItem.internalId || "-", mono: true },
                  ].map(({ label, value, mono, bold }) => (
                    <div key={label} className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
                      <span className={`ml-2 min-w-0 truncate text-right text-xs ${mono ? "font-mono" : ""} ${bold ? "font-bold" : ""}`}>{value}</span>
                    </div>
                  ))}
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-center text-xs text-muted-foreground">
                  Scan a feeder to lock the BOM line.
                </div>
              )}
            </CardContent>
        </Card>

        {/* ═══════════════════════════════════════════════════════════════════════
            SECTION 4 — LOGS (always at the bottom)
        ═══════════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

          {/* Splice log */}
          <Card className="overflow-hidden border-border/70 bg-card/90 shadow-[0_16px_50px_rgba(15,23,42,0.08)]">
            <CardHeader className="border-b border-border/60 bg-gradient-to-r from-amber-50 via-background to-background">
              <CardTitle className="flex items-center gap-2 text-base">
                <Scissors className="h-4 w-4 text-amber-600" /> Splice Log
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="mb-2 hidden sm:block overflow-x-auto">
                <div className="grid min-w-[700px] grid-cols-7 gap-2 rounded-xl border border-border/70 bg-muted/35 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                  <div>Time</div>
                  <div>Feeder</div>
                  <div>Old / New</div>
                  <div>Matched As</div>
                  <div>Lot</div>
                  <div>Duration</div>
                  <div>Status</div>
                </div>
              </div>

              {records.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  No splices yet. The last finalized splice will appear here.
                </div>
              ) : (
                <div className="space-y-2 overflow-x-auto">
                  {records.map((row, idx) => (
                    <div
                      key={`${row.id}-${idx}`}
                      className="grid min-w-[700px] grid-cols-7 gap-2 rounded-xl border border-border/70 bg-background/95 p-3 text-sm shadow-sm transition-colors hover:border-amber-300 hover:bg-amber-50/40"
                    >
                      <div className="font-mono text-xs text-muted-foreground">
                        {new Date(row.splicedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </div>
                      <div className="font-mono font-semibold text-foreground">{row.feederNumber}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">{row.oldSpoolBarcode} → {row.newSpoolBarcode}</div>
                      <div className="truncate text-xs text-foreground">{row.matchedAs || "—"}</div>
                      <div className="font-mono truncate text-muted-foreground">{row.lotCode || "-"}</div>
                      <div className="font-mono text-xs text-foreground">
                        {row.durationSeconds != null ? formatDuration(row.durationSeconds) : "—"}
                      </div>
                      <div>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          row.status === "verified"   ? "bg-emerald-100 text-emerald-700"
                          : row.status === "alternate" ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                        }`}>
                          {row.status || "failed"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity log */}
          <Card className="overflow-hidden border-border/70 bg-card/90 shadow-[0_16px_50px_rgba(15,23,42,0.08)]">
            <CardHeader className="border-b border-border/60 bg-gradient-to-r from-emerald-50 via-background to-background">
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Activity Log
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <LogPanel />
            </CardContent>
          </Card>

        </div>
      </div>{/* end scrollable column */}

      <ScanNotification notifications={notifications} onDismiss={dismissNotification} />
    </div>
  );
}