import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRoute, useLocation, useSearchParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useGetSession, useScanFeeder, useUpdateSession, useGetBom,
  useListSplices,
  getGetBomQueryKey, getGetSessionQueryKey, getListSplicesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, ScanLine, CheckCircle2, Circle, XCircle, Scissors, ArrowLeft, RefreshCw, X, AlertCircle } from "lucide-react";
import { format, differenceInSeconds } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import SplicingPage from "./Splicing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlternateSelector } from "@/components/alternate-selector";
import { ModeToggle } from "@/components/ModeToggle";
import { HandoverModal } from "@/feeder/HandoverModal";
import { useNotification } from "@/hooks/use-notification";
import { useNotification as useToastNotification } from "@/components/NotificationSystem";
import { useScanner } from "@/hooks/useScanner";
import { useAutoScan } from "@/hooks/useAutoScan";
import { ScanNotification } from "@/components/notifications/ScanNotification";
import { LogPanel } from "@/components/LogPanel";
import { useAuth } from "@/context/auth-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useVerificationStore } from "@/store/useVerificationStore";
import { useSplicingStore } from "@/store/useSplicingStore";
import { useLogStore } from "@/store/useLogStore";
import { useNotificationStore } from "@/store/useNotificationStore";
import type { FeederScan, SplicingRecord } from "@/types";
import { AppLogo } from "@/components/AppLogo";
import { buildCandidates, normalizeMpn } from "@/utils/mpnUtils";
import { logger } from "@/lib/logger";
import { ACCEPT_TOKEN, isAcceptToken } from "@/lib/accept-token";
import { registerScanResult, resetStrikes, signalError, signalSuccess } from "@/utils/indication";

type ScanStep = "feeder" | "spool" | "lot";
type Mode = "scan" | "splice";

interface LocalScanEntry {
  id: number;
  feederNumber: string;
  spoolBarcode?: string;
  partNumber?: string | null;
  status: "ok" | "reject";
  scannedAt: string;
  durationMs?: number;
}

interface SessionScanLogRow {
  id: number;
  feederNumber: string;
  scannedValue: string;
  matchedField: string | null;
  matchedMake: string | null;
  lotCode: string | null;
  status: "verified" | "duplicate" | "failed";
  verificationMode: "AUTO" | "MANUAL";
  scannedAt: string;
  bom: {
    refDes: string | null;
    componentDesc: string | null;
    packageSize: string | null;
    internalPartNumber: string | null;
    expectedMpns: string[];
    makes: string[];
  };
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatElapsed(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function focusNextFrame(inputRef: React.RefObject<HTMLInputElement | null>) {
  setTimeout(() => inputRef.current?.focus(), 80);
}

function normalizeScanValue(value: string): string {
  return value.trim().toUpperCase();
}

// AUTO_LEGACY skips the feeder-scan step, so it never runs the alternate-selection
// prompt that AUTO/MANUAL use. To keep MPN validation correct for feeders that have
// alternate rows, build candidates from EVERY BOM row matching the current feeder
// (union across sources), de-duplicated by value. Falls back to the single locked row.
function buildLegacyCandidates(
  feeder: string,
  sessionRows: any[],
  uiRows: any[] | undefined,
  lockedFeeder: any,
): ReturnType<typeof buildCandidates> {
  const target = normalizeScanValue(feeder);
  const rows = [
    ...(sessionRows ?? []),
    ...(uiRows ?? []),
  ].filter((row) => normalizeScanValue(String(row?.feederNumber ?? "")) === target);
  const source = rows.length > 0 ? rows : lockedFeeder ? [lockedFeeder] : [];
  const seen = new Set<string>();
  const merged: ReturnType<typeof buildCandidates> = [];
  for (const row of source) {
    for (const candidate of buildCandidates(row)) {
      if (seen.has(candidate.value)) continue;
      seen.add(candidate.value);
      merged.push(candidate);
    }
  }
  return merged;
}

// Web Audio API sound generator. Success/error now route through the central
// indication layer (strong "wrong" buzzer + on-screen LED + hardware seam);
// warning keeps its lightweight single mid-range beep.
function playBuzzer(type: "success" | "error" | "warning") {
  if (type === "success") {
    signalSuccess();
    return;
  }
  if (type === "error") {
    signalError();
    return;
  }
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.frequency.value = 600;
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch (err) {
    logger.warn("Audio playback failed:", err);
  }
}

function tokenizeInternalPartNumber(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/[\r\n]+/g, " ")
    .split(/[\s,;/|]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.toUpperCase());
}

export default function SessionActive() {
  const [, feederParams] = useRoute("/feeder/sessions/:id");
  const [, legacyParams] = useRoute("/session/:id");
  const rawSessionId = feederParams?.id ?? legacyParams?.id;
  const sessionId = rawSessionId ? Number(rawSessionId) : NaN;
  const isValidSessionId = Number.isFinite(sessionId) && sessionId > 0;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Use the new notification system with buzzer sounds
  const {
    notifications,
    showAlert,
    showErrorAlert,
    showWarningAlert,
    showSuccessAlert,
    dismissNotification,
  } = useNotification();
  const notify = useToastNotification();
  const scanNotifications = useMemo(
    () =>
      notifications.map((n) => ({
        ...n,
        title: n.title ?? (n.type === "error" ? "ERROR" : n.type === "success" ? "SUCCESS" : "NOTICE"),
      })),
    [notifications],
  );

  const { data: session, isLoading: sessionLoading } = useGetSession(sessionId, {
    query: {
      enabled: isValidSessionId,
      queryKey: getGetSessionQueryKey(sessionId),
      // Poll while the session is awaiting QA so the operator's screen reacts
      // the moment QA confirms — for loading (status → qa_confirmed, auto-redirect
      // to splicing) and for splicing (status → completed, auto-redirect to report).
      refetchInterval: (query) => {
        const s = String((query.state.data as { status?: string } | undefined)?.status ?? "");
        return s === "pending_qa" || s === "qa_in_review" || s === "splicing_pending_qa" ? 5000 : false;
      },
      // Keep polling even while the operator's tab is backgrounded, so QA's
      // confirmation is observed and the auto-redirect fires without the operator
      // having to refocus the tab (the root cause of the "broken redirect" report).
      refetchIntervalInBackground: true,
    },
  });
  const bomId = session?.bomId;
  // Free Scan Mode: no BOM attached (stored as NULL in the DB). Every scan is
  // captured with no validation. Keyed off the absence of a bomId — not `=== 0`,
  // which never matches the NULL the backend actually stores.
  const isFreeScan = !!session && !bomId;
  const { data: bomDetail, isLoading: bomLoading } = useGetBom(bomId!, {
    query: { enabled: !!bomId && isValidSessionId, queryKey: getGetBomQueryKey(bomId!) },
  });
  const [sessionApiBom, setSessionApiBom] = useState<any[]>([]);

  // DEBUG: Log session and BOM status
  useEffect(() => {
    logger.debug('[DEBUG] Session ID:', sessionId);
    logger.debug('[DEBUG] Session loading:', sessionLoading);
    logger.debug('[DEBUG] Session data:', session);
    logger.debug('[DEBUG] BOM ID:', bomId);
    logger.debug('[DEBUG] BOM loading:', bomLoading);
    logger.debug('[DEBUG] BOM detail:', bomDetail);
    logger.debug('[DEBUG] Session API BOM count:', sessionApiBom.length);
  }, [sessionId, sessionLoading, session, bomId, bomLoading, bomDetail, sessionApiBom]);

  useEffect(() => {
    if (!isValidSessionId) {
      logger.error('[ERROR] No valid session ID available for session load fetch');
      return;
    }

    const loadSessionData = async () => {
      logger.debug('[LOADING SESSION]', { sessionId });
      try {
        const response = await fetch(`/api/sessions/${sessionId}`, {
          credentials: 'include',
        });
        logger.debug('[SESSION API]', {
          status: response.status,
          ok: response.ok,
        });
        if (!response.ok) {
          throw new Error('Failed to load session');
        }
        const data = await response.json();
        logger.info('[SESSION LOADED]', {
          bomId: data.session?.bomId,
          bomItemCount: data.bom?.length || 0,
          status: data.session?.status,
        });
        setSessionApiBom(data.bom || []);
      } catch (err) {
        logger.error({ err }, '[SESSION LOAD ERROR]');
      }
    };

    loadSessionData();
  }, [sessionId, isValidSessionId]);

  useEffect(() => {
    if (bomDetail?.items && bomDetail.items.length > 0) {
      logger.debug('[BOM FEEDERS]', bomDetail.items.map((item) => item.feederNumber));
      logger.debug('[BOM SAMPLE]', bomDetail.items[0]);
    }
  }, [bomDetail]);

  const { data: splices, isLoading: splicesLoading } = useListSplices(sessionId, {
    query: { enabled: isValidSessionId, queryKey: getListSplicesQueryKey(sessionId) },
  });
  const { data: scanLog } = useQuery({
    queryKey: ["session-scan-log", sessionId],
    queryFn: async () => {
      const response = await fetch(`/api/sessions/${sessionId}/scans`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to load scan log");
      }
      return (await response.json()) as { sessionId: number; scans: SessionScanLogRow[] };
    },
    enabled: isValidSessionId,
  });

  const scanFeeder = useScanFeeder();
  const updateSession = useUpdateSession();

  const [mode, setMode] = useState<Mode>("scan");
  const [scanStep, setScanStep] = useState<ScanStep>("feeder");
  const [pendingFeeder, setPendingFeeder] = useState("");
  const [feederScanTime, setFeederScanTime] = useState<number | null>(null);
  const [pendingMpnScan, setPendingMpnScan] = useState("");
  const [pendingScanDuration, setPendingScanDuration] = useState<number | undefined>(undefined);
  
  // Internal ID / MPN verification state
  const [internalIdInput, setInternalIdInput] = useState("");
  const [internalIdType, setInternalIdType] = useState<"mpn" | "internal_id">("mpn");
  const [caseConverted, setCaseConverted] = useState(false);
  const [isDuplicate, setIsDuplicate] = useState(false);
  
  // Alternate selection state
  const [pendingAvailableOptions, setPendingAvailableOptions] = useState<{
    primary: any[];
    alternates: any[];
  } | null>(null);
  const [selectedItemIdForScan, setSelectedItemIdForScan] = useState<number | null>(null);
  const [needsAlternateSelection, setNeedsAlternateSelection] = useState(false);
  const [verificationMode, setVerificationMode] = useState<"AUTO" | "MANUAL" | "AUTO_LEGACY">("AUTO");
  const [pendingVerification, setPendingVerification] = useState<any>(null);
  const [verificationLocked, setVerificationLocked] = useState(false);
  const [lastVerificationTime, setLastVerificationTime] = useState<number | null>(null);
  const [verificationInProgress, setVerificationInProgress] = useState(false);
  const [autoAdvanceTimer, setAutoAdvanceTimer] = useState<NodeJS.Timeout | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanningRef = useRef(false);

  // Free Scan Mode capture: three fields (Feeder + MPN + Lot), committed
  // manually. Kept separate from the BOM-coupled scan state machine.
  const [freeFeeder, setFreeFeeder] = useState("");
  const [freeMpn, setFreeMpn] = useState("");
  const [freeLot, setFreeLot] = useState("");
  const [freeSubmitting, setFreeSubmitting] = useState(false);
  // Synchronous in-flight guard. A scanner fires the accept token via onChange and
  // an Enter via onKeyDown in the same tick; the freeSubmitting *state* is still
  // false on the second call (React hasn't re-rendered), so a ref is needed to
  // reject the duplicate submit.
  const freeInFlightRef = useRef(false);
  const [showAcceptTokenHelp, setShowAcceptTokenHelp] = useState(false);
  const freeFeederRef = useRef<HTMLInputElement>(null);
  const freeMpnRef = useRef<HTMLInputElement>(null);
  const freeLotRef = useRef<HTMLInputElement>(null);
  // Captures the app accept barcode / Enter to confirm a MANUAL pending scan.
  const verifyScanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (session?.verificationMode) {
      const raw = String(session.verificationMode).toUpperCase();
      setVerificationMode(raw === "MANUAL" ? "MANUAL" : raw === "AUTO_LEGACY" ? "AUTO_LEGACY" : "AUTO");
    }
  }, [session?.verificationMode]);

  const legacyMode = verificationMode === "AUTO_LEGACY";

  const handleVerificationModeChange = async (mode: "AUTO" | "MANUAL") => {
    if (!isValidSessionId) {
      return;
    }

    const response = await fetch(`/api/sessions/${sessionId}/mode`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error ?? "Failed to update verification mode");
    }

    setVerificationMode(mode);
    await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
  };

  // Tab-based UI state for Loading vs Splicing
  // ?tab=loading | ?tab=splicing in the URL controls the active tab so deep
  // links from other pages (e.g. the Splicing page's "Back" button) land on
  // the intended tab. Tab clicks also update the URL so the back/forward
  // browser buttons and bookmarks reflect the current view.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const activeTab: "loading" | "splicing" = tabFromUrl === "splicing" ? "splicing" : "loading";

  // Splicing is unlocked only after QA has verified the changeover. Until then
  // the operator completes loading and hands off for QA quality confirmation.
  // It stays unlocked once the operator starts splicing (active_splicing).
  const isSpliceEligible = String(session?.status) === "qa_confirmed" || String(session?.status) === "active_splicing";
  // Once the operator submits splicing for QA the session enters the 200%
  // splicing checkpoint — splicing stays visible (read-only) while QA reviews.
  const isSplicingPendingQa = String(session?.status) === "splicing_pending_qa";

  const setActiveTab = (tab: "loading" | "splicing") => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "loading") {
          next.delete("tab");
        } else {
          next.set("tab", "splicing");
        }
        return next;
      },
      { replace: true }
    );
  };

  const [splicingPhaseActive, setSplicingPhaseActive] = useState(false);

  const [elapsed, setElapsed] = useState(0);
  const [showCompletionOverlay, setShowCompletionOverlay] = useState(false);
  const [submittingQa, setSubmittingQa] = useState(false);
  const [qaNotified, setQaNotified] = useState(false);
  const qaConfirmedRedirectedRef = useRef(false);
  const [submittingSplicingQa, setSubmittingSplicingQa] = useState(false);
  const splicingCompletedRedirectedRef = useRef(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  // Module 3: closure prompt captures production quantity + cycle time before
  // the changeover is completed (or submitted to splicing QA).
  const [showClosureDialog, setShowClosureDialog] = useState(false);
  const [closureQty, setClosureQty] = useState("");
  const [closureCycle, setClosureCycle] = useState("");
  const [lastScanResult, setLastScanResult] = useState<{
    status: "ok" | "reject" | "splice";
    feeder: string;
    msg: string;
  } | null>(null);
  const lastNotifiedRef = useRef<string>("");
  const wasAllRequiredVerifiedRef = useRef(false);
  const [showHandoverModal, setShowHandoverModal] = useState(false);

  const scanLogRows = scanLog?.scans ?? [];

  const formatMatchedAs = (row: SessionScanLogRow) => {
    const field = row.matchedField ?? "";
    if (!field) return "—";
    if (field === "internalPartNumber") return "Internal P/N";

    const suffix = row.matchedMake ? ` (${row.matchedMake})` : "";
    const label = field.replace("mpn", "MPN ");
    return `${label}${suffix}`;
  };

  const getScannedValueStyle = (row: SessionScanLogRow) => {
    if (row.status === "failed") return "text-[#B91C1C] font-bold";
    if (row.matchedField === "mpn2" || row.matchedField === "mpn3") return "text-[#B45309] font-bold";
    return "text-[#15803D] font-bold";
  };

  const getScannedValueSuffix = (row: SessionScanLogRow) => {
    if (row.status === "failed") return " ✗";
    if (row.matchedField === "mpn2" || row.matchedField === "mpn3") return " ▲";
    return "";
  };

  const resetVerificationState = useVerificationStore((state) => state.resetAll);
  const setVerificationBomEntries = useVerificationStore((state) => state.setBomEntries);
  const hydrateVerificationScans = useVerificationStore((state) => state.hydrateFromScans);
  const upsertVerifiedFeeder = useVerificationStore((state) => state.upsertVerifiedFeeder);
  const verificationBomEntries = useVerificationStore((state) => state.bomEntries);
  const scannedFeeders = useVerificationStore((state) => state.scannedFeeders);
  const verificationScans = useMemo(() => Array.from(scannedFeeders.values()), [scannedFeeders]);
  const verificationProgress = useMemo(() => {
    // After QA confirmation, loading verification is already complete — enable
    // splicing. Stays true through the splicing phase (active_splicing /
    // splicing_pending_qa) so the splicing tab never re-disables mid-work.
    const qaConfirmed = ["qa_confirmed", "active_splicing", "splicing_pending_qa"].includes(String(session?.status));
    // Use bomItemCount from API if available, otherwise fall back to BOM entries
    const totalRequired = session?.bomItemCount ?? verificationBomEntries.length;
    const verifiedCount = scannedFeeders.size;
    const percentage = totalRequired === 0 ? 0 : Math.round((verifiedCount / totalRequired) * 100);
    const remainingFeeders = verificationBomEntries
      .map((entry) => entry.feederId)
      .filter((feederId) => !scannedFeeders.has(feederId));

    return {
      verifiedCount,
      totalRequired,
      percentage,
      remainingFeeders,
      isComplete: qaConfirmed || (verifiedCount >= totalRequired && totalRequired > 0),
    };
  }, [verificationBomEntries, scannedFeeders, session?.bomItemCount, session?.status]);

  // AUTO_LEGACY: feeders are populated serially in BOM order, so the operator never
  // scans a feeder barcode. Pre-load the next un-verified feeder and jump straight to
  // the MPN (spool) step. After each successful scan the flow resets to scanStep
  // "feeder" with an empty pendingFeeder, and this effect re-fires to load the next one.
  useEffect(() => {
    if (!legacyMode) return;
    if (session?.status !== "active" || activeTab !== "loading") return;
    if (scanStep !== "feeder" || pendingFeeder) return;
    const nextFeeder = verificationProgress.remainingFeeders[0];
    if (!nextFeeder) return;
    setPendingFeeder(nextFeeder);
    setFeederScanTime(Date.now());
    setScanStep("spool");
  }, [legacyMode, session?.status, activeTab, scanStep, pendingFeeder, verificationProgress.remainingFeeders]);

  const clearSplicingRecords = useSplicingStore((state) => state.clearRecords);
  const hydrateSplicingRecords = useSplicingStore((state) => state.hydrateRecords);
  const splicingRecords = useSplicingStore((state) => state.records);
  const clearLogs = useLogStore((state) => state.clearLogs);
  const addLog = useLogStore((state) => state.addLog);
  const clearNotifications = useNotificationStore((state) => state.clearAll);

  useEffect(() => {
    const bomItems = bomDetail?.items;
    if (!bomItems || bomItems.length === 0) {
      return;
    }

    const grouped = new Map<string, { primary: any[]; alternates: any[] }>();
    bomItems.forEach((item) => {
      const feederNumber = item.feederNumber.trim().toUpperCase();
      if (!grouped.has(feederNumber)) {
        grouped.set(feederNumber, { primary: [], alternates: [] });
      }
      const bucket = grouped.get(feederNumber)!;
      const option = {
        mpn: (item.expectedMpn || item.partNumber || item.internalId || item.feederNumber).trim().toUpperCase(),
        partId: String(item.id ?? item.partNumber ?? item.feederNumber),
        description: item.partNumber || item.expectedMpn || item.internalId || item.feederNumber,
      };
      if (item.isAlternate) {
        bucket.alternates.push(option);
      } else {
        bucket.primary.push(option);
      }
    });

    setVerificationBomEntries(
      Array.from(grouped.entries()).map(([feederId, group]) => ({
        feederId,
        alternatives: [...group.primary, ...group.alternates],
      })),
    );
  }, [bomDetail, setVerificationBomEntries]);

  useEffect(() => {
    const mappedScans: FeederScan[] = (session?.scans || [])
      .filter((scan) => scan.status === "ok")
      .map((scan) => ({
        feederId: scan.feederNumber.trim().toUpperCase(),
        mpn: (scan.partNumber || scan.feederNumber).trim().toUpperCase(),
        partId: String(scan.id),
        scannedAt: new Date(scan.scannedAt),
        status: "verified",
        matchedAlternative: {
          mpn: (scan.partNumber || scan.feederNumber).trim().toUpperCase(),
          partId: String(scan.id),
          description: scan.partNumber || scan.feederNumber,
        },
      }));

    hydrateVerificationScans(mappedScans);
  }, [hydrateVerificationScans, session?.scans]);

  useEffect(() => {
    const mappedRecords: SplicingRecord[] = (splices || []).map((splice) => ({
      feederId: splice.feederNumber.trim().toUpperCase(),
      oldSpoolMPN: splice.oldSpoolBarcode.trim().toUpperCase(),
      newSpoolMPN: splice.newSpoolBarcode.trim().toUpperCase(),
      splicedAt: new Date(splice.splicedAt),
      verifiedAgainstBOM: true,
    }));

    hydrateSplicingRecords(mappedRecords);
  }, [hydrateSplicingRecords, splices]);

  const handleScanBarcode = useCallback(async (val: string) => {
    logger.debug('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.debug('[SCAN START]', {
      input: val,
      scanStep,
      scanningRef: scanningRef.current,
      verificationInProgress,
      verificationLocked,
      sessionId,
      bomLoaded: !!bomDetail,
      bomItemsCount: bomDetail?.items?.length ?? 0,
    });
    logger.debug('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (scanningRef.current) {
      logger.debug('[BLOCKED] scanningRef.current is true');
      return;
    }

    if (verificationInProgress) {
      logger.debug('[BLOCKED] verificationInProgress is true');
      return;
    }

    if (verificationLocked) {
      logger.debug('[BLOCKED] verificationLocked is true');
      return;
    }

    if (!bomDetail) {
      logger.debug('[BLOCKED] BOM detail missing');
      showErrorAlert('BOM not loaded yet. Please wait.', 'high');
      clearScanInput();
      return;
    }

    setVerificationInProgress(true);
    scanningRef.current = true;
    setScanning(true);
    try {
      const normalizedInput = normalizeScanValue(val);

      if (needsAlternateSelection) {
        setScanStep("spool");
        setNeedsAlternateSelection(false);
        return;
      }

      if (!normalizedInput && scanStep !== "lot") {
        return;
      }

      if (scanStep === "feeder") {
        logger.debug('[DEBUG] Processing feeder step', { normalizedInput, uiBomItemsCount: bomDetail?.items?.length });

        const uiBomItems = bomDetail?.items || [];
        const sessionBomItems = sessionApiBom || [];
        const normalizedFeederNumber = normalizedInput;

        const matchingUiItems = uiBomItems.filter(
          (item) => normalizeScanValue(item.feederNumber) === normalizedFeederNumber,
        );
        const matchingSessionItems = sessionBomItems.filter(
          (item) => normalizeScanValue(String(item.feederNumber ?? "")) === normalizedFeederNumber,
        );
        const matchingItems = matchingSessionItems.length > 0 ? matchingSessionItems : matchingUiItems;

        if (matchingItems.length === 0) {
          setLastScanResult({
            status: "reject",
            feeder: normalizedFeederNumber,
            msg: `❌ ERROR: Feeder "${normalizedFeederNumber}" not found in BOM`,
          });
          clearScanInput();
          showErrorAlert(
            `Feeder "${normalizedFeederNumber}" does not exist in the loaded BOM.\n\nPlease check the feeder number and try again.`,
            "high",
          );
          registerScanResult(
            normalizedFeederNumber,
            false,
            `Feeder "${normalizedFeederNumber}" rejected 3 times. Verify the feeder number or call a supervisor.`,
          );
          return;
        }

        const sessionScans = [
          ...(session?.scans ?? []).map((scan) => ({
            feederNumber: normalizeScanValue(scan.feederNumber),
            status: scan.status === "ok" ? "verified" : String(scan.status || "").toLowerCase(),
          })),
          ...scanLogRows.map((scan) => ({
            feederNumber: normalizeScanValue(scan.feederNumber),
            status: String(scan.status || "").toLowerCase(),
          })),
        ];

        const alreadyScanned = sessionScans.some(
          (scan) => scan.feederNumber === normalizedFeederNumber && scan.status !== "failed",
        );

        if (alreadyScanned) {
          setLastScanResult({
            status: "reject",
            feeder: normalizedFeederNumber,
            msg: `⚠️ DUPLICATE: Feeder "${normalizedFeederNumber}" already verified`,
          });
          clearScanInput();
          setIsDuplicate(true);
          lastNotifiedRef.current = `${normalizedFeederNumber}::⚠️ DUPLICATE: Feeder "${normalizedFeederNumber}" already verified`;
          notify(
            "duplicate",
            `Feeder "${normalizedFeederNumber}" has already been verified.`,
            "To re-scan, reject the existing scan first.",
            () => focusNextFrame(inputRef),
          );
          return;
        }

        const primaryItems = matchingUiItems.filter((item) => !item.isAlternate);
        const alternateItems = matchingUiItems.filter((item) => item.isAlternate);

        setPendingFeeder(normalizedFeederNumber);
        setFeederScanTime(Date.now());
        clearScanInput();
        setCaseConverted(val !== normalizedFeederNumber);
        setIsDuplicate(false);

        if (alternateItems.length > 0) {
          setPendingAvailableOptions({
            primary: primaryItems,
            alternates: alternateItems,
          });
          setSelectedItemIdForScan(primaryItems[0]?.id || alternateItems[0]?.id || null);
          setNeedsAlternateSelection(true);
          showWarningAlert(
            `Feeder "${normalizedFeederNumber}" has ${alternateItems.length} alternative component option(s).\n\nSelect from primary or alternatives, then press ENTER.`,
            "medium",
          );
          playBuzzer("warning");
          return;
        }

        showSuccessAlert(`Feeder "${normalizedFeederNumber}" found in BOM`);
        registerScanResult(normalizedFeederNumber, true);
        setScanStep("spool");
        setNeedsAlternateSelection(false);
        return;
      }

      if (scanStep === "spool") {
      logger.debug('[DEBUG] Processing MPN step', { pendingFeeder, normalizedInput });

        const sessionMatchedBomItem =
          sessionApiBom.find(
            (item) =>
              normalizeScanValue(String(item.feederNumber ?? "")) === normalizeScanValue(pendingFeeder) &&
              (selectedItemIdForScan == null || Number(item.id) === selectedItemIdForScan),
          ) ||
          sessionApiBom.find(
            (item) => normalizeScanValue(String(item.feederNumber ?? "")) === normalizeScanValue(pendingFeeder),
          );

        const uiMatchedBomItem =
          bomDetail?.items.find(
            (item) =>
              normalizeScanValue(item.feederNumber) === normalizeScanValue(pendingFeeder) &&
              (selectedItemIdForScan == null || item.id === selectedItemIdForScan),
          ) ||
          bomDetail?.items.find(
            (item) => normalizeScanValue(item.feederNumber) === normalizeScanValue(pendingFeeder),
          );

        const lockedFeeder = (sessionMatchedBomItem ?? uiMatchedBomItem) as any;
        const rawScanned = val;
        const normalizedScanned = normalizeMpn(val);

        logger.debug("[FULL BOM ITEM]", JSON.stringify(lockedFeeder, null, 2));

        logger.debug("[MPN DEBUG] scanned raw:    |%s|", rawScanned);
        logger.debug("[MPN DEBUG] scanned normal: |%s|", normalizedScanned);
        logger.debug("[MPN DEBUG] bom.mpn1 raw:   |%s|", lockedFeeder?.mpn1);
        logger.debug("[MPN DEBUG] bom.mpn2 raw:   |%s|", lockedFeeder?.mpn2);
        logger.debug("[MPN DEBUG] bom.mpn3 raw:   |%s|", lockedFeeder?.mpn3);
        logger.debug("[MPN DEBUG] bom.internalPn: |%s|", lockedFeeder?.internalPartNumber);
        logger.debug("[MPN DEBUG] field names:    %o", Object.keys(lockedFeeder ?? {}));

        if (!normalizedScanned) {
          showErrorAlert("Empty scan — please scan the part MPN barcode", "high");
          playBuzzer("error");
          clearScanInput();
          return;
        }

        if (!lockedFeeder) {
          showErrorAlert("No feeder locked — restart from feeder scan", "high");
          playBuzzer("error");
          setScanStep("feeder");
          clearScanInput();
          return;
        }

        const candidates = legacyMode
          ? buildLegacyCandidates(pendingFeeder, sessionApiBom, bomDetail?.items, lockedFeeder)
          : buildCandidates(lockedFeeder);

        logger.debug("[MPN MATCH ATTEMPT] scanned:", normalizedScanned);
        logger.debug("[MPN MATCH ATTEMPT] candidates:", candidates);

        if (candidates.length === 0) {
          showErrorAlert("BOM item has no MPN data — contact engineer", "high");
          playBuzzer("error");
          clearScanInput();
          return;
        }

        const match = candidates.find((candidate) => candidate.value === normalizedScanned);

        if (!match) {
          const expectedDisplay = candidates.map((candidate) => candidate.value).join(" | ");
          showErrorAlert(
            `MPN Mismatch for Feeder ${lockedFeeder?.feederNumber ?? pendingFeeder}. Expected: ${expectedDisplay}`,
            "high",
          );
          registerScanResult(
            normalizedScanned,
            false,
            `Component "${normalizedScanned}" rejected 3 times on feeder ${lockedFeeder?.feederNumber ?? pendingFeeder}. Verify the part or call a supervisor.`,
          );
          clearScanInput();
          return;
        }

        if (match.label === "Internal ID") {
          setInternalIdType("internal_id");
        } else {
          setInternalIdType("mpn");
        }

        if (match.isPrimary) {
          showSuccessAlert(`✓ Primary Match — ${match.label}: ${match.value}`);
          registerScanResult(normalizedScanned, true);
        } else {
          showWarningAlert(`⚠ Alternate Match — ${match.label}: ${match.value}`, "medium");
          resetStrikes(normalizedScanned);
          playBuzzer("warning");
        }

        setInternalIdInput(match.value);
        setCaseConverted(caseConverted || rawScanned !== normalizedScanned);
        clearScanInput();

        const duration = feederScanTime ? Date.now() - feederScanTime : undefined;
        setPendingMpnScan(match.value);
        setPendingScanDuration(duration);
        setScanStep("lot");
        focusNextFrame(inputRef);
        return;
      }

      if (scanStep === "lot") {
        logger.debug('[DEBUG] Processing lot step', { normalizedInput, pendingFeeder, pendingMpnScan });

        const lotCode = normalizedInput || null;
        const matchingItem = bomDetail?.items.find((item) => item.id === selectedItemIdForScan);
        const duration = pendingScanDuration;

        if (verificationMode === "MANUAL") {
          setPendingVerification({
            feederNumber: pendingFeeder,
            mpnOrInternalId: pendingMpnScan || null,
            lotCode,
            internalIdType,
            verificationMode: "MANUAL",
            selectedItemId: selectedItemIdForScan || undefined,
            partNumber: matchingItem?.partNumber,
            duration,
          });
        } else {
          await handleAutoModeSubmit(pendingMpnScan, duration, lotCode ?? undefined);
        }
      }
    } catch (err: any) {
      logger.error({ err }, '[SCAN ERROR]');
      showErrorAlert(err?.message || 'Unexpected scan error', 'high');
      playBuzzer("error");
    } finally {
      setVerificationInProgress(false);
      scanningRef.current = false;
      setScanning(false);
      logger.debug('[SCAN COMPLETE] Flags reset');
    }
  }, [
    // State values
    scanStep,
    bomDetail,
    pendingFeeder,
    sessionApiBom,
    session?.scans,
    scanLogRows,
    selectedItemIdForScan,
    needsAlternateSelection,
    verificationInProgress,
    verificationLocked,
    caseConverted,
    feederScanTime,
    pendingScanDuration,
    internalIdType,
    verificationMode,
    legacyMode,
    // State setters
    setVerificationInProgress,
    setScanStep,
    setNeedsAlternateSelection,
    setLastScanResult,
    setFeederScanTime,
    setPendingFeeder,
    setIsDuplicate,
    setCaseConverted,
    setPendingAvailableOptions,
    setSelectedItemIdForScan,
    setInternalIdInput,
    setPendingMpnScan,
    setPendingScanDuration,
    setPendingVerification,
    setScanning,
    // Callbacks and refs
    showErrorAlert,
    showWarningAlert,
    showSuccessAlert,
    notify,
    focusNextFrame,
    sessionId,
  ]);

  const {
    inputRef,
    value: scanInput,
    setValue: setScanInput,
  } = useScanner({
    onSubmit: handleScanBarcode,
    resetAfterMs: 10000,
    // Pause the periodic re-focus while a data-entry modal is open, otherwise it
    // steals focus back to the hidden scan input every 1.2s and the operator
    // can't type into the closure / handover fields.
    autoFocus: !showClosureDialog && !showHandoverModal,
  });

  const { reset: resetAutoScan } = useAutoScan(scanInput, {
    onScan: (value) => {
      if (
        scanningRef.current ||
        verificationInProgress ||
        verificationLocked ||
        pendingVerification ||
        needsAlternateSelection ||
        scanStep === "lot"
      ) {
        return;
      }

      void handleScanBarcode(value);
    },
    delayMs: 300,
    minLength: 3,
    enabled: session?.status === "active" && activeTab === "loading" && scanStep !== "lot" && !showClosureDialog && !showHandoverModal,
  });

  const feederInputRef = inputRef;
  const mpnInputRef = inputRef;
  const lotCodeInputRef = inputRef;

  useEffect(() => {
    if (session?.status !== "active" || activeTab !== "loading" || showClosureDialog || showHandoverModal) {
      return;
    }

    const focusMap: Record<ScanStep, React.RefObject<HTMLInputElement | null>> = {
      feeder: feederInputRef,
      spool: mpnInputRef,
      lot: lotCodeInputRef,
    };

    const t = setTimeout(() => {
      focusMap[scanStep]?.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [activeTab, feederInputRef, lotCodeInputRef, mpnInputRef, scanStep, session?.status, showClosureDialog, showHandoverModal]);

  useEffect(() => {
    return () => {
      if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
      }
    };
  }, [autoAdvanceTimer]);

  useEffect(() => {
    if (session?.startTime) {
      const start = new Date(session.startTime);
      const timer = setInterval(() => {
        const end = session.endTime ? new Date(session.endTime) : new Date();
        setElapsed(differenceInSeconds(end, start));
      }, 500);
      return () => clearInterval(timer);
    }
  }, [session?.startTime, session?.endTime]);

  // Show notification for errors
  useEffect(() => {
    if (lastScanResult && lastScanResult.status === "reject") {
      const signature = `${lastScanResult.feeder}::${lastScanResult.msg}`;
      if (lastNotifiedRef.current === signature) {
        return;
      }
      lastNotifiedRef.current = signature;

      const msgLower = lastScanResult.msg.toLowerCase();
      if (msgLower.includes("error") || msgLower.includes("failed")) {
        showErrorAlert(lastScanResult.msg);
      } else if (msgLower.includes("warning")) {
        showWarningAlert(lastScanResult.msg);
      }
    }
  }, [lastScanResult, showErrorAlert, showWarningAlert]);

  const flashBg = (status: "ok" | "reject" | "splice") => {
    const bg = document.getElementById("scan-flash-bg");
    if (bg) {
      bg.classList.remove("flash-green", "flash-red");
      void bg.offsetWidth;
      if (status === "ok" || status === "splice") bg.classList.add("flash-green");
      else bg.classList.add("flash-red");
    }
  };

  const mirrorVerificationResult = (feederId: string, scannedValue: string, sourcePartNumber?: string | null) => {
    const bomEntry = useVerificationStore.getState().getBOMEntry(feederId);
    const normalizedValue = scannedValue.trim().toUpperCase();
    const matchedAlternative =
      bomEntry?.alternatives.find(
        (alt) => alt.mpn.toUpperCase() === normalizedValue || alt.partId.toUpperCase() === normalizedValue,
      ) || {
        mpn: normalizedValue || (sourcePartNumber || feederId).trim().toUpperCase(),
        partId: normalizedValue || feederId,
        description: sourcePartNumber || feederId,
      };

    upsertVerifiedFeeder({
      feederId: feederId.trim().toUpperCase(),
      mpn: matchedAlternative.mpn,
      partId: matchedAlternative.partId,
      lotCode: undefined,
      scannedAt: new Date(),
      status: "verified",
      matchedAlternative,
    });
  };

  const handleVerifyPendingScan = async () => {
    if (!pendingVerification || verificationLocked) return;
    
    // Check for single-entry violation
    if (lastVerificationTime) {
      const timeDiff = Date.now() - lastVerificationTime;
      if (timeDiff < 5000) { // Within 5 seconds = same verification attempt
        setLastScanResult({
          status: "reject",
          feeder: pendingVerification.feederNumber,
          msg: "❌ ERROR: Single-entry violation detected! Wait before next scan.",
        });
        return;
      }
    }

    setVerificationInProgress(true);
    setVerificationLocked(true);

    try {
      await scanFeeder.mutateAsync({
        sessionId,
        data: {
          sessionId,
          feederNumber: pendingVerification.feederNumber,
          mpnOrInternalId: pendingVerification.mpnOrInternalId || undefined,
          lotCode: pendingVerification.lotCode || undefined,
          internalIdType: pendingVerification.internalIdType,
          verificationMode: "MANUAL",
          selectedItemId: pendingVerification.selectedItemId,
        },
      });
      showSuccessAlert(`MPN matched successfully for feeder ${pendingVerification.feederNumber}.`);
      mirrorVerificationResult(
        pendingVerification.feederNumber,
        pendingVerification.mpnOrInternalId || pendingVerification.partNumber || pendingVerification.feederNumber,
        pendingVerification.partNumber,
      );
      
      setSplicingPhaseActive(true);
      setLastVerificationTime(Date.now());
      setPendingVerification(null);
      setScanStep("feeder");
      setPendingFeeder("");
      setPendingMpnScan("");
      setPendingScanDuration(undefined);
      setScanInput("");
      setInternalIdInput("");
      setCaseConverted(false);
      setPendingAvailableOptions(null);
      setSelectedItemIdForScan(null);
      queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
    } catch (err: any) {
      setLastScanResult({
        status: "reject",
        feeder: pendingVerification.feederNumber,
        msg: err?.message || "Verification failed",
      });
      showErrorAlert(`MPN mismatch for feeder ${pendingVerification.feederNumber}. ${err?.message || "Verification failed"}`, "high");
    } finally {
      setVerificationInProgress(false);
      setVerificationLocked(false);
    }
  };

  // Free Scan Mode: commit the captured Feeder + MPN + Lot with no validation.
  // The backend (bomId = null) auto-accepts and still rejects duplicate feeders.
  const handleFreeScanAccept = async () => {
    const feeder = freeFeeder.trim();
    if (!feeder || freeInFlightRef.current) return;

    freeInFlightRef.current = true;
    setFreeSubmitting(true);
    try {
      const res = await scanFeeder.mutateAsync({
        sessionId,
        data: {
          sessionId,
          feederNumber: feeder,
          mpnOrInternalId: freeMpn.trim() || undefined,
          lotCode: freeLot.trim() || undefined,
          verificationMode: "AUTO",
        },
      });

      setLastScanResult({
        status: res.status as "ok" | "reject",
        feeder,
        msg: res.message,
      });

      if (res.status === "ok") {
        showSuccessAlert(`Recorded feeder ${feeder}.`);
        setFreeFeeder("");
        setFreeMpn("");
        setFreeLot("");
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
        queryClient.invalidateQueries({ queryKey: ["session-scan-log", sessionId] });
        requestAnimationFrame(() => freeFeederRef.current?.focus());
      } else {
        showErrorAlert(res.message || `Feeder ${feeder} rejected.`, "high");
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to record scan";
      setLastScanResult({ status: "reject", feeder, msg });
      showErrorAlert(msg, "high");
    } finally {
      freeInFlightRef.current = false;
      setFreeSubmitting(false);
    }
  };

  // Shared onChange for the free-scan fields: if the operator scans the app
  // accept barcode, commit instead of writing the token into the field.
  const handleFreeFieldChange =
    (setter: React.Dispatch<React.SetStateAction<string>>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (isAcceptToken(v)) {
        void handleFreeScanAccept();
        return;
      }
      setter(v);
    };

  const clearScanInput = () => {
    setScanInput("");
    resetAutoScan();
    scanningRef.current = false;
    setScanning(false);
    setVerificationInProgress(false);
    setVerificationLocked(false);
  };

  const handlePrimaryInputKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") {
      return;
    }

    e.preventDefault();

    if (scanStep !== "lot") {
      return;
    }

    if (scanningRef.current) {
      return;
    }

    const val = scanInput.trim();

    if (needsAlternateSelection) {
      await handleScanBarcode("");
      return;
    }

    // Lot code is explicitly enter/skip-driven (empty Enter means skip)
    if (scanStep === "lot" && !val) {
      await handleScanBarcode("");
      return;
    }

    if (!val) {
      return;
    }

    await handleScanBarcode(val);
  };

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    logger.debug('[FORM SUBMIT]', { value: scanInput, scanStep, sessionId });

    if (scanStep !== "lot") {
      return;
    }

    if (scanningRef.current) {
      logger.debug('[FORM SUBMIT BLOCKED] scanningRef.current true');
      return;
    }
    const val = scanInput.trim();

    if (needsAlternateSelection) {
      await handleScanBarcode("");
      return;
    }
    
    // Lot code is explicitly enter/skip-driven (no auto-submit)
    if (scanStep === "lot" && !val) {
      await handleScanBarcode("");
      return;
    }
    
    if (!val) {
      return;
    }
    await handleScanBarcode(val);
  };

  // New helper for auto-mode submission
  const handleAutoModeSubmit = async (mpnScanned: string, duration?: number, lotCode?: string) => {
    if (verificationInProgress) return;
    setVerificationInProgress(true);

    try {
      const res = await scanFeeder.mutateAsync({
        sessionId,
        data: {
          sessionId,
          feederNumber: pendingFeeder,
          mpnOrInternalId: mpnScanned || undefined,
          lotCode: lotCode || undefined,
          internalIdType,
          verificationMode: "AUTO",
          selectedItemId: selectedItemIdForScan || undefined,
        },
      });

      setLastScanResult({
        status: res.status as "ok" | "reject",
        feeder: pendingFeeder,
        msg: res.message + (duration ? ` (${formatDuration(duration)})` : ""),
      });

      if (res.status === "ok") {
        showSuccessAlert(`MPN matched successfully for feeder ${pendingFeeder}.`);
        playBuzzer("success");
        mirrorVerificationResult(pendingFeeder, mpnScanned, pendingAvailableOptions?.primary?.[0]?.partNumber);
        setSplicingPhaseActive(true);
        clearScanInput();
        setPendingFeeder("");
        setFeederScanTime(null);
        setScanStep("feeder");
        setPendingMpnScan("");
        setPendingScanDuration(undefined);
        setPendingAvailableOptions(null);
        setSelectedItemIdForScan(null);
        setInternalIdInput("");
        setCaseConverted(false);
        setIsDuplicate(false);
        setLastVerificationTime(Date.now());
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });

        focusNextFrame(inputRef);
      } else {
        showErrorAlert(`MPN mismatch for feeder ${pendingFeeder}. ${res.message}`, "high");
        playBuzzer("error");
        clearScanInput();
      }
    } catch (err: any) {
      setLastScanResult({
        status: "reject",
        feeder: pendingFeeder,
        msg: err?.message || "Verification failed",
      });
      showErrorAlert(`MPN verification failed for feeder ${pendingFeeder}. ${err?.message || "Unknown error"}`, "high");
    } finally {
      setVerificationInProgress(false);
      scanningRef.current = false;
      setScanning(false);
    }
  };

  const handleEndSession = () => {
    // Module 3: capture production quantity + cycle time at closure before either
    // completing directly or routing splices through the QA 200% verification.
    setShowClosureDialog(true);
  };

  const confirmClosure = () => {
    const qty = Number(closureQty);
    const cycle = Number(closureCycle);
    if (closureQty.trim() === "" || !Number.isInteger(qty) || qty < 0) {
      alert("Enter a valid total production quantity (whole number ≥ 0).");
      return;
    }
    if (closureCycle.trim() === "" || !Number.isFinite(cycle) || cycle < 0) {
      alert("Enter a valid current cycle time in seconds (≥ 0).");
      return;
    }

    const hasSplices = (splices?.length ?? 0) > 0;
    const data: { totalProductionQuantity: number; currentCycleTime: number; status?: "completed"; endTime?: string } = {
      totalProductionQuantity: qty,
      currentCycleTime: cycle,
    };
    // No splices → close directly in the same request. With splices the changeover
    // is submitted for QA 200% verification and QA performs the final close.
    if (!hasSplices) {
      data.status = "completed";
      data.endTime = new Date().toISOString();
    }

    updateSession.mutate(
      { sessionId, data },
      {
        onSuccess: () => {
          setShowClosureDialog(false);
          queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
          if (hasSplices) {
            handleSubmitSplicingQa();
          } else {
            setLocation(`/session/${sessionId}/report`);
          }
        },
        onError: (err: any) => {
          alert(`Failed to record closure data: ${err?.data?.error || err?.message || "Unknown error"}`);
        },
      }
    );
  };

  const handleCancelSession = () => {
    if (
      confirm(
        "CANCEL this session? This will discard all scans and mark it as cancelled.\n\nThis action cannot be undone. Continue?"
      )
    ) {
      updateSession.mutate(
        { sessionId, data: { status: "cancelled", endTime: new Date().toISOString() } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
            setLocation("/sessions");
          },
          onError: (err: any) => {
            alert(`Failed to cancel session: ${err?.message || "Unknown error"}`);
          },
        }
      );
    }
  };

  const requiredFeedsVerifiedCount = verificationProgress.verifiedCount;
  const totalRequiredFeeders = verificationProgress.totalRequired;
  const allRequiredFeedersVerified = verificationProgress.isComplete;

  useEffect(() => {
    const s = String(session?.status);
    if (
      (s === "active" || s === "pending_qa") &&
      allRequiredFeedersVerified &&
      !wasAllRequiredVerifiedRef.current
    ) {
      setShowCompletionOverlay(true);
    }

    wasAllRequiredVerifiedRef.current = allRequiredFeedersVerified;
  }, [allRequiredFeedersVerified, session?.status]);

  // Operator confirms the completed loading and hands off to QA: sets pending_qa
  // and fires a cross-dashboard notification so QA sees it on their queue.
  const handleSubmitForQa = async () => {
    setSubmittingQa(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/submit-qa`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("submit failed");
      }
      await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
      setQaNotified(true);
      showSuccessAlert("Loading confirmed — QA has been notified");
    } catch {
      showErrorAlert("Failed to notify QA. Please try again.", "high");
    } finally {
      setSubmittingQa(false);
    }
  };

  // Operator finishes splicing and submits it for the QA 200% verification.
  // The changeover cannot be closed until QA reviews every splice — QA closes it.
  const handleSubmitSplicingQa = async () => {
    if (!confirm("Submit splicing for QA 200% verification? QA must approve every splice before the changeover can close.")) return;
    setSubmittingSplicingQa(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/submit-splicing-qa`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("submit failed");
      }
      await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
      showSuccessAlert("Splicing submitted — awaiting QA 200% verification");
    } catch {
      showErrorAlert("Failed to submit splicing for QA. Please try again.", "high");
    } finally {
      setSubmittingSplicingQa(false);
    }
  };

  // Once QA confirms (status → qa_confirmed), auto-redirect the operator straight
  // into splicing. Operator-only (a QA/supervisor viewing the session stays put).
  // Runs once per confirmation via the ref guard.
  useEffect(() => {
    if (user?.role === "operator" && String(session?.status) === "qa_confirmed" && !qaConfirmedRedirectedRef.current) {
      qaConfirmedRedirectedRef.current = true;
      setShowCompletionOverlay(false);
      setActiveTab("splicing");
      showSuccessAlert("QA verified the changeover — proceeding to splicing");
    }
  }, [session?.status, user?.role]);

  // When QA verifies splicing and closes the changeover (status → completed from
  // the splicing checkpoint), auto-redirect the operator to the report.
  // Operator-only — a QA/supervisor viewing the same session isn't yanked away.
  useEffect(() => {
    if (user?.role === "operator" && String(session?.status) === "completed" && !splicingCompletedRedirectedRef.current) {
      splicingCompletedRedirectedRef.current = true;
      showSuccessAlert("QA verified the splicing — changeover closed");
      setLocation(`/session/${sessionId}/report`);
    }
  }, [session?.status, user?.role]);

  if (sessionLoading || (session?.bomId && bomLoading) || !session) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  // Calculate required feeders (those with at least one non-alternate component)
  const requiredFeeders = new Set<string>();
  bomDetail?.items.forEach((item) => {
    if (!item.isAlternate) {
      requiredFeeders.add(item.feederNumber);
    }
  });
  
  const okScans = verificationScans;

  const uniqueOkScans = new Set(okScans.map((s) => s.feederId)).size;
  const totalBomItems = bomDetail?.items.length || 0;

  const handleResetSessionState = async () => {
    // Call backend to delete scan records from database
    try {
      const response = await fetch(`/api/sessions/${sessionId}/scans`, {
        method: "DELETE",
        credentials: "include",
      });
      if (response.ok) {
        await response.json();
      } else {
        console.error("Failed to clear scan records:", await response.text());
      }
    } catch (err) {
      console.error("Error clearing scan records:", err);
    }

    clearNotifications();
    clearLogs();
    resetVerificationState();
    clearSplicingRecords();
    addLog({
      type: "warning",
      message: `Session ${sessionId} scanner state reset by operator.`,
      details: {
        sessionId: String(sessionId),
      },
    });

    // Clear all scan-related state
    setScanStep("feeder");
    setPendingFeeder("");
    setFeederScanTime(null);
    setInternalIdInput("");
    setPendingMpnScan("");
    setPendingScanDuration(undefined);
    setCaseConverted(false);
    setIsDuplicate(false);
    setPendingAvailableOptions(null);
    setSelectedItemIdForScan(null);
    setNeedsAlternateSelection(false);
    setPendingVerification(null);
    
    // Clear verification flags and refs
    setVerificationLocked(false);
    setVerificationInProgress(false);
    scanningRef.current = false;
    
    // Clear splicing-related state
    setSplicingPhaseActive(false);
    
    // Clear UI state
    setLastScanResult(null);
    setScanInput("");
    setShowCompletionOverlay(false);
    setActiveTab("loading");
    lastNotifiedRef.current = "";
    
    // Focus input for next scan
    focusNextFrame(inputRef);
    
    playBuzzer("success");
    showWarningAlert("Session scanner state has been reset.", "medium");
  };

  const feederStatusMap: Record<string, "ok" | "reject" | "pending"> = {};
  bomDetail?.items.forEach((item) => {
    const okScan = session.scans.find((s) => s.feederNumber === item.feederNumber && s.status === "ok");
    if (okScan) {
      feederStatusMap[item.feederNumber] = "ok";
    } else {
      const rejectScan = session.scans.find((s) => s.feederNumber === item.feederNumber && s.status === "reject");
      feederStatusMap[item.feederNumber] = rejectScan ? "reject" : "pending";
    }
  });

  // === ENHANCED: Group items by feeder for display (primary with alternates) ===
  const feederGroups: Record<string, { primary: any; alternates: any[] }> = {};
  bomDetail?.items.forEach((item) => {
    if (!feederGroups[item.feederNumber]) {
      feederGroups[item.feederNumber] = { primary: null, alternates: [] };
    }
    if (!item.isAlternate) {
      feederGroups[item.feederNumber].primary = item;
    } else {
      feederGroups[item.feederNumber].alternates.push(item);
    }
  });

  // Create array of feeder groups, filtering to only show required feeders in main list
  const feederGroupArray = Object.entries(feederGroups)
    .filter(([feederNum]) => requiredFeeders.has(feederNum))
    .map(([feederNum, group]) => ({ feederNum, ...group }))
    .sort((a, b) => a.feederNum.localeCompare(b.feederNum));

  const getScanStepLabel = () => {
    if (needsAlternateSelection) {
      return `SELECT COMPONENT for ${pendingFeeder} — Click primary or alternate, then press ENTER`;
    }
    if (legacyMode) {
      if (scanStep === "spool") {
        return `AUTO LEGACY — Feeder ${pendingFeeder} auto-loaded · SCAN MPN / INTERNAL ID`;
      }
      if (scanStep === "lot") {
        return `AUTO LEGACY — Feeder ${pendingFeeder} · SCAN LOT CODE (Enter/Skip)`;
      }
      return "AUTO LEGACY — Loading next feeder…";
    }
    if (scanStep === "feeder") {
      return verificationMode === "AUTO"
        ? "STEP 1 — Scan FEEDER NUMBER (Auto-Advance)"
        : "STEP 1 / 2 — Scan FEEDER NUMBER";
    }
    if (scanStep === "spool") {
      const stepLabel = verificationMode === "AUTO" 
        ? "STEP 2 (Auto-Submit)" 
        : "STEP 2 / 3";
      return `${stepLabel} — Scan MPN / INTERNAL ID or press ENTER to skip (Feeder: ${pendingFeeder})`;
    }
    const stepLabel = verificationMode === "AUTO"
      ? "STEP 3 — Enter LOT CODE (Enter/Skip)"
      : "STEP 3 / 3 — Enter LOT CODE (Enter/Skip)";
    return `${stepLabel} (Feeder: ${pendingFeeder})`;
  };

  return (
    <div id="scan-flash-bg" className="min-h-screen w-full flex flex-col transition-colors duration-1000 bg-background overflow-y-auto">
      <style>{`
        /* Radix UI ScrollArea scrollbars styling */
        [data-radix-scroll-area-viewport] {
          scrollbar-width: auto;
        }
        /* Webkit browsers (Chrome, Safari, Edge) */
        [data-radix-scroll-area-viewport]::-webkit-scrollbar {
          width: 12px;
          height: 12px;
        }
        [data-radix-scroll-area-viewport]::-webkit-scrollbar-track {
          background: hsl(var(--muted) / 0.3);
          border-radius: 6px;
        }
        [data-radix-scroll-area-viewport]::-webkit-scrollbar-thumb {
          background: hsl(var(--muted-foreground));
          border-radius: 6px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        [data-radix-scroll-area-viewport]::-webkit-scrollbar-thumb:hover {
          background: hsl(var(--foreground));
          background-clip: padding-box;
        }
        /* Horizontal scrollbar styling */
        [data-radix-scroll-area-viewport]::-webkit-scrollbar-corner {
          background: hsl(var(--muted) / 0.3);
        }
      `}</style>

      <div className="relative w-full space-y-4 px-4 py-4 md:px-6">
        {/* Decorative background blobs */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -left-24 top-[-6rem] h-72 w-72 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="absolute right-[-5rem] top-24 h-80 w-80 rounded-full bg-slate-500/10 blur-3xl" />
          <div className="absolute bottom-[-8rem] left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
        </div>

        {/* Header - Responsive */}
        <header className="bg-card border-b border-border p-2 sm:p-3 lg:p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-4 shrink-0 shadow-sm z-10 relative">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <AppLogo className="h-8 sm:h-10" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-2 sm:gap-x-4 lg:gap-x-8 gap-y-1 sm:gap-y-2 text-xs sm:text-sm min-w-0">
              <div className="truncate"><span className="text-muted-foreground font-medium text-xs">PANEL:</span> <span className="font-bold text-primary ml-1 truncate block">{session.panelName}</span></div>
              <div className="truncate"><span className="text-muted-foreground font-medium text-xs">BOM:</span> <span className="font-bold ml-1 truncate block">{session.bomName || session.bomId}</span></div>
              <div className="hidden sm:block truncate"><span className="text-muted-foreground font-medium text-xs">OP:</span> <span className="font-bold ml-1 truncate block">{session.operatorName}</span></div>
              <div className="hidden lg:block truncate"><span className="text-muted-foreground font-medium text-xs">SHIFT:</span> <span className="font-bold ml-1 truncate block">{session.shiftName}</span></div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 ml-auto sm:ml-0 w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex items-center gap-2">
              {isFreeScan && (
                <div className="px-2 py-1 sm:px-3 sm:py-1.5 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-sm text-xs sm:text-sm font-bold text-amber-800 dark:text-amber-400">
                  FREE SCAN
                </div>
              )}
            </div>
            <div className="text-right flex flex-col items-end">
              <div className="text-muted-foreground text-xs font-bold tracking-wider">TIME</div>
              <div className="text-lg sm:text-2xl font-mono font-black tracking-widest">{formatElapsed(elapsed)}</div>
            </div>
            {session.status === "active" ? (
              <div className="flex gap-1 sm:gap-2 flex-col-reverse sm:flex-row">
                <Button
                  variant="secondary"
                  className="font-bold tracking-widest text-xs sm:text-sm py-1 sm:py-2 px-2 sm:px-4 h-auto"
                  onClick={() => window.open(`/api/sessions/${sessionId}/report/pdf`, "_blank")}
                >
                  📄 PDF
                </Button>
                <Button
                  variant="outline"
                  className="font-bold tracking-widest text-xs sm:text-sm py-1 sm:py-2 px-2 sm:px-4 h-auto"
                  onClick={() => setShowResetDialog(true)}
                >
                  RESET
                </Button>
                <Button
                  variant="secondary"
                  className="font-bold tracking-widest text-xs sm:text-sm py-1 sm:py-2 px-2 sm:px-4 h-auto"
                  onClick={() => setShowHandoverModal(true)}
                >
                  ⇄ H/O
                </Button>
                <Button
                  variant="secondary"
                  className="font-bold tracking-widest text-xs sm:text-sm py-1 sm:py-2 px-2 sm:px-4 h-auto"
                  onClick={clearScanInput}
                >
                  UNLOCK
                </Button>
                <Button variant="destructive" className="font-bold tracking-widest text-xs sm:text-sm py-1 sm:py-2 px-2 sm:px-4 h-auto" onClick={handleEndSession}>
                  END
                </Button>
                <Button
                  variant="outline"
                  className="font-bold tracking-widest border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground text-xs sm:text-sm py-1 sm:py-2 px-2 sm:px-3 h-auto"
                  onClick={handleCancelSession}
                >
                  <X className="w-3 h-3 sm:w-4 sm:h-4" />
                </Button>
              </div>
            ) : isSpliceEligible ? (
              // Splicing phase: the primary action lives on top so the operator can
              // finish easily. With splices recorded, END submits them for the QA
              // 200% verification; with none, END closes the changeover directly.
              <div className="flex gap-1 sm:gap-2 flex-col-reverse sm:flex-row">
                <Button
                  variant="secondary"
                  className="font-bold tracking-widest text-xs sm:text-sm py-1 sm:py-2 px-2 sm:px-4 h-auto"
                  onClick={() => window.open(`/api/sessions/${sessionId}/report/pdf`, "_blank")}
                >
                  📄 PDF
                </Button>
                <Button
                  variant="destructive"
                  className="font-bold tracking-widest text-xs sm:text-sm py-1 sm:py-2 px-3 sm:px-5 h-auto"
                  disabled={submittingSplicingQa}
                  onClick={handleEndSession}
                >
                  {submittingSplicingQa && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {(splices?.length ?? 0) > 0 ? "FINISH SPLICING" : "END SESSION"}
                </Button>
                {/* No cancel-session (✕) in the splicing phase: once splicing is
                    underway the only forward action is submitting to QA. The cancel
                    option stays in the loading phase only. */}
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="font-bold tracking-widest text-xs sm:text-sm py-1 sm:py-2 px-2 sm:px-4 h-auto"
                  onClick={() => window.open(`/api/sessions/${sessionId}/report/pdf`, "_blank")}
                >
                  📄 PDF
                </Button>
                <Button asChild className="font-bold tracking-widest text-xs sm:text-sm py-1 sm:py-2 px-2 sm:px-4 h-auto">
                  <Link href={`/session/${session.id}/report`}>REPORT</Link>
                </Button>
              </div>
            )}
          </div>
        </header>

        {/* Tab Navigation */}
        {(isSpliceEligible || isSplicingPendingQa) && (
          <div className="bg-card border-b border-border flex gap-1 p-2 sm:p-3 shrink-0 shadow-sm">
            <Button
              type="button"
              variant={activeTab === "loading" ? "default" : "outline"}
              className="flex-1 sm:flex-none px-4 sm:px-6 h-9 sm:h-10 font-semibold text-xs sm:text-sm"
              onClick={() => setActiveTab("loading")}
            >
              📦 LOADING (
              <span className="font-bold text-primary ml-1">
                {requiredFeedsVerifiedCount} / {totalRequiredFeeders}
              </span>
              )
            </Button>
            <Button
              type="button"
              variant={activeTab === "splicing" ? "default" : "outline"}
              className={`flex-1 sm:flex-none px-4 sm:px-6 h-9 sm:h-10 font-semibold text-xs sm:text-sm ${
                !allRequiredFeedersVerified ? "opacity-50 cursor-not-allowed" : ""
              }`}
              onClick={() => {
                if (allRequiredFeedersVerified) {
                  setActiveTab("splicing");
                }
              }}
              disabled={!allRequiredFeedersVerified}
              title={!allRequiredFeedersVerified ? "Complete all required feeder verification first" : ""}
            >
              ✂️ SPLICING
              {!allRequiredFeedersVerified && (
                <span className="ml-2 text-xs font-medium">({totalRequiredFeeders - requiredFeedsVerifiedCount} remaining)</span>
              )}
            </Button>
          </div>
        )}

        <div className="flex gap-4 overflow-hidden max-w-full">
          {/* Left column - Main content */}
          <div className="flex-1 min-w-0 space-y-6 overflow-y-auto">

            {session.status === "active" && activeTab === "loading" && (
            <>
              {isFreeScan ? (
                <div className="space-y-4">
                  <div
                    className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs sm:text-sm font-bold tracking-widest"
                    style={{ border: "1px solid #93C5FD", color: "#1D4ED8", background: "rgba(59, 130, 246, 0.08)" }}
                  >
                    🆓 FREE SCAN — NO BOM VALIDATION
                  </div>

                  <div className="bg-card border-2 border-primary/50 p-3 sm:p-6 rounded-xl shadow-[0_0_20px_rgba(var(--primary),0.1)] space-y-4">
                    <Label className="text-sm lg:text-lg tracking-widest text-primary flex items-center gap-2 font-black uppercase">
                      <ScanLine className="w-4 h-4 lg:w-5 lg:h-5" /> Capture — Feeder · MPN · Lot
                    </Label>

                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs font-bold text-muted-foreground">FEEDER</Label>
                        <Input
                          ref={freeFeederRef}
                          value={freeFeeder}
                          onChange={handleFreeFieldChange(setFreeFeeder)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); freeMpnRef.current?.focus(); } }}
                          placeholder="SCAN FEEDER"
                          autoComplete="off"
                          autoFocus
                          className="text-center text-xl lg:text-2xl h-12 lg:h-14 font-mono tracking-widest"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-bold text-muted-foreground">MPN / INTERNAL ID</Label>
                        <Input
                          ref={freeMpnRef}
                          value={freeMpn}
                          onChange={handleFreeFieldChange(setFreeMpn)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); freeLotRef.current?.focus(); } }}
                          placeholder="SCAN MPN / ID"
                          autoComplete="off"
                          className="text-center text-xl lg:text-2xl h-12 lg:h-14 font-mono tracking-widest"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-bold text-muted-foreground">LOT CODE</Label>
                        <Input
                          ref={freeLotRef}
                          value={freeLot}
                          onChange={handleFreeFieldChange(setFreeLot)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleFreeScanAccept(); } }}
                          placeholder="SCAN LOT (ENTER = ACCEPT)"
                          autoComplete="off"
                          className="text-center text-xl lg:text-2xl h-12 lg:h-14 font-mono tracking-widest"
                        />
                      </div>
                    </div>

                    <Button
                      className="w-full h-12 font-black tracking-widest"
                      onClick={() => handleFreeScanAccept()}
                      disabled={!freeFeeder.trim() || freeSubmitting}
                    >
                      {freeSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      ✓ ACCEPT & RECORD
                    </Button>

                    <div className="text-center">
                      <button
                        type="button"
                        className="text-xs underline text-muted-foreground hover:text-foreground"
                        onClick={() => setShowAcceptTokenHelp((v) => !v)}
                      >
                        {showAcceptTokenHelp ? "Hide" : "Show"} accept-barcode help
                      </button>
                      {showAcceptTokenHelp && (
                        <div className="mt-2 text-xs text-muted-foreground bg-muted/50 border border-border rounded p-2 leading-relaxed">
                          Accept three ways: the <strong>ACCEPT &amp; RECORD</strong> button, <strong>Enter</strong> in the lot field,
                          or scan a barcode/QR that encodes <code className="font-mono font-bold text-foreground">{ACCEPT_TOKEN}</code> into any field.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
              <>
              {!legacyMode && (
                <div className="flex justify-end">
                  <ModeToggle
                    currentMode={verificationMode}
                    onModeChange={handleVerificationModeChange}
                    sessionId={String(sessionId)}
                    sessionStartedAt={session.startedAt || ""}
                  />
                </div>
              )}

              <div
                className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs sm:text-sm font-bold tracking-widest"
                style={{
                  border: `1px solid ${legacyMode ? "#C4B5FD" : verificationMode === "AUTO" ? "#93C5FD" : "#FCD34D"}`,
                  color: legacyMode ? "#6D28D9" : verificationMode === "AUTO" ? "#1D4ED8" : "#B45309",
                  background: legacyMode ? "rgba(139, 92, 246, 0.08)" : verificationMode === "AUTO" ? "rgba(59, 130, 246, 0.08)" : "rgba(245, 158, 11, 0.08)",
                }}
              >
                {legacyMode ? "🔁 AUTO LEGACY — STRICT" : verificationMode === "AUTO" ? "⚡ AUTO — STRICT" : "🔒 MANUAL MODE"}
              </div>

              {/* Pending Verification Alert */}
              {pendingVerification && verificationMode === "MANUAL" && (
                <div className="bg-blue-50 dark:bg-blue-950 border-2 border-blue-400 p-3 sm:p-4 rounded-lg space-y-3">
                  <div className="text-sm font-semibold text-blue-900 dark:text-blue-100">⏳ MANUAL VERIFICATION PENDING</div>
                  
                  {/* Feeder Info */}
                  <div className="bg-white dark:bg-blue-900/20 p-2 rounded border border-blue-200 dark:border-blue-700">
                    <p className="text-xs text-blue-600 dark:text-blue-300 font-bold">FEEDER NUMBER:</p>
                    <p className="text-sm sm:text-base font-mono font-bold text-blue-900 dark:text-blue-100">
                      {pendingVerification.feederNumber}
                      {caseConverted && <span className="text-orange-600 dark:text-orange-400 text-xs ml-2">(AUTO-UPPERCASE)</span>}
                    </p>
                    {pendingVerification.partNumber && (
                      <p className="text-xs text-blue-700 dark:text-blue-200 mt-1">Part: {pendingVerification.partNumber}</p>
                    )}
                  </div>

                  {/* MPN / Internal ID Info */}
                  {pendingVerification.mpnOrInternalId && (
                    <div className="bg-white dark:bg-blue-900/20 p-2 rounded border border-blue-200 dark:border-blue-700">
                      <p className="text-xs text-blue-600 dark:text-blue-300 font-bold">
                        {pendingVerification.internalIdType === "mpn" ? "MPN / PART NUMBER" : "INTERNAL ID"}:
                      </p>
                      <p className="text-sm sm:text-base font-mono font-bold text-blue-900 dark:text-blue-100">
                        {pendingVerification.mpnOrInternalId}
                        {pendingVerification.caseConverted && <span className="text-orange-600 dark:text-orange-400 text-xs ml-2">(AUTO-UPPERCASE)</span>}
                      </p>
                    </div>
                  )}

                  <Button
                    className="w-full bg-white text-navy border-navy border-2 hover:bg-gray-50 font-bold"
                    onClick={() => handleVerifyPendingScan()}
                    disabled={verificationLocked || verificationInProgress}
                  >
                    ✓ VERIFY & CONFIRM ENTRY
                  </Button>

                  {/* Three-way manual accept: the button above, Enter, or the
                      app accept barcode (##ACCEPT##) scanned into this field. */}
                  <input
                    ref={verifyScanRef}
                    autoFocus
                    aria-label="Scan accept barcode or press Enter to confirm"
                    className="w-full text-center text-xs font-mono tracking-widest bg-white/70 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-700 rounded px-2 py-1 text-blue-900 dark:text-blue-100 placeholder:text-blue-400"
                    placeholder="Scan ✓ accept barcode or press ENTER"
                    autoComplete="off"
                    onChange={(e) => {
                      if (isAcceptToken(e.currentTarget.value)) {
                        e.currentTarget.value = "";
                        void handleVerifyPendingScan();
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.value = "";
                        void handleVerifyPendingScan();
                      }
                    }}
                  />
                </div>
              )}

              {/* SCAN MODE - Primary Section */}
              <div className="bg-card border-2 border-primary/50 p-2 sm:p-4 lg:p-8 rounded-xl shadow-[0_0_20px_rgba(var(--primary),0.1)]">
                <form onSubmit={handleScanSubmit} className="flex flex-col items-center gap-2 sm:gap-3 lg:gap-6">
                  <Label className="text-xs sm:text-sm lg:text-lg xl:text-xl tracking-widest text-primary flex items-center gap-1 sm:gap-2 font-black uppercase text-center line-clamp-2">
                    <ScanLine className="w-3 h-3 sm:w-4 sm:h-4 lg:w-5 lg:h-5 xl:w-6 xl:h-6 flex-shrink-0" />
                    {getScanStepLabel()}
                  </Label>
                  
                  {/* Alternate Selector */}
                  {needsAlternateSelection && pendingAvailableOptions && (
                    <div className="w-full max-w-lg">
                      <AlternateSelector
                        feederNumber={pendingFeeder}
                        primaryOptions={pendingAvailableOptions.primary}
                        alternateOptions={pendingAvailableOptions.alternates}
                        selectedId={selectedItemIdForScan || undefined}
                        onSelect={setSelectedItemIdForScan}
                        isLoading={scanFeeder.isPending}
                      />
                    </div>
                  )}

                  <div
                    className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold tracking-widest"
                    style={{
                      border: `1px solid ${legacyMode ? "#C4B5FD" : verificationMode === "AUTO" ? "#93C5FD" : "#FCD34D"}`,
                      color: legacyMode ? "#6D28D9" : verificationMode === "AUTO" ? "#1D4ED8" : "#B45309",
                      background: legacyMode ? "rgba(139, 92, 246, 0.08)" : verificationMode === "AUTO" ? "rgba(59, 130, 246, 0.08)" : "rgba(245, 158, 11, 0.08)",
                    }}
                  >
                    {legacyMode ? "🔁 AUTO LEGACY — STRICT" : verificationMode === "AUTO" ? "⚡ AUTO — STRICT" : "🔒 MANUAL MODE"}
                  </div>

                  <div className="w-full flex gap-0.5 sm:gap-1 lg:gap-2 items-center justify-center min-h-12 sm:min-h-14 lg:min-h-16">
                    {!legacyMode && (scanStep === "spool" || scanStep === "lot") && !needsAlternateSelection && !pendingVerification && (
                      <Button type="button" variant="ghost" size="icon" className="shrink-0 h-10 sm:h-12 lg:h-14 xl:h-16 w-10 sm:w-12 lg:w-14 xl:w-16" onClick={() => { setScanStep("feeder"); setPendingFeeder(""); setFeederScanTime(null); setScanInput(""); setNeedsAlternateSelection(false); setPendingAvailableOptions(null); setSelectedItemIdForScan(null); setInternalIdInput(""); setPendingMpnScan(""); setPendingScanDuration(undefined); setCaseConverted(false); }}>
                        <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4 lg:w-5 lg:h-5 xl:w-6 xl:h-6" />
                      </Button>
                    )}
                    {needsAlternateSelection && (
                      <Button type="button" variant="ghost" size="icon" className="shrink-0 h-10 sm:h-12 lg:h-14 xl:h-16 w-10 sm:w-12 lg:w-14 xl:w-16" onClick={() => { setScanStep("feeder"); setPendingFeeder(""); setFeederScanTime(null); setScanInput(""); setNeedsAlternateSelection(false); setPendingAvailableOptions(null); setSelectedItemIdForScan(null); setInternalIdInput(""); setCaseConverted(false); }}>
                        <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4 lg:w-5 lg:h-5 xl:w-6 xl:h-6" />
                      </Button>
                    )}
                    {!pendingVerification && (
                      <Input
                        ref={inputRef}
                        value={scanInput}
                        onChange={(e) => setScanInput(e.target.value)}
                        onKeyDown={handlePrimaryInputKeyDown}
                        className="flex-1 text-center text-2xl sm:text-3xl lg:text-4xl xl:text-5xl h-14 sm:h-16 lg:h-20 xl:h-24 font-mono tracking-[0.15em] sm:tracking-[0.2em] bg-background border-2 border-border focus-visible:border-primary rounded-lg shadow-inner text-xs sm:text-sm"
                        placeholder={needsAlternateSelection ? "Press ENTER..." : legacyMode ? (scanStep === "lot" ? "SCAN LOT CODE (ENTER=SKIP)" : "SCAN MPN/ID") : (scanStep === "feeder" ? "SCAN FEEDER..." : scanStep === "spool" ? (verificationMode === "AUTO" ? "SCAN MPN/ID" : "SCAN MPN/ID...") : "SCAN LOT CODE (ENTER=SKIP)")}
                        autoComplete="off"
                      />
                    )}
                    {scanStep === "lot" && !needsAlternateSelection && !pendingVerification && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="shrink-0 h-10 sm:h-12 lg:h-14 px-3 sm:px-4"
                        onClick={() => handleScanBarcode("")}
                      >
                        Skip
                      </Button>
                    )}
                  </div>
                  {scanStep === "spool" && !needsAlternateSelection && !pendingVerification && (
                    <div className="w-full space-y-1 sm:space-y-2">
                      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 p-1.5 sm:p-2 lg:p-3 rounded text-center">
                        <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2">Feeder <strong className="text-foreground font-mono">{pendingFeeder}</strong> selected</p>
                      </div>
                      
                      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 p-2 sm:p-3 rounded-lg">
                        <p className="text-xs font-bold text-blue-900 dark:text-blue-100 mb-2">📝 STEP 2: MPN/INTERNAL ID</p>
                        <p className="text-xs text-blue-800 dark:text-blue-200">
                          • Scan the MPN or Internal ID for verification
                        </p>
                        <p className="text-xs text-blue-800 dark:text-blue-200">
                          • Press <strong>ENTER</strong> to skip verification
                        </p>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-2 italic">
                          ⓘ Required MPN/Internal ID is enforced in both AUTO and MANUAL modes
                        </p>
                      </div>
                    </div>
                  )}
                  {scanStep === "lot" && !needsAlternateSelection && !pendingVerification && (
                    <div className="w-full space-y-1 sm:space-y-2">
                      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 p-1.5 sm:p-2 lg:p-3 rounded text-center">
                        <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2">Feeder <strong className="text-foreground font-mono">{pendingFeeder}</strong> selected</p>
                      </div>

                      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 p-2 sm:p-3 rounded-lg">
                        <p className="text-xs font-bold text-blue-900 dark:text-blue-100 mb-2">🏷️ STEP 3: LOT CODE</p>
                        <p className="text-xs text-blue-800 dark:text-blue-200">
                          • Scan lot code or press <strong>Skip</strong>
                        </p>
                        <p className="text-xs text-blue-800 dark:text-blue-200">
                          • Press <strong>ENTER</strong> to submit value
                        </p>
                      </div>
                    </div>
                  )}
                </form>
              </div>
              </>
              )}


          {/* Feedback Area - Responsive */}
          <div className="h-20 sm:h-24 lg:h-32 xl:h-40 flex items-center justify-center shrink-0">
            {lastScanResult ? (
              <div className={`w-full h-full flex flex-col items-center justify-center rounded-xl border-2 shadow-lg transition-all gap-1 sm:gap-2 p-2 sm:p-3 lg:p-4 ${
                lastScanResult.status === "ok" ? "bg-green-50 dark:bg-green-950/30 border-green-500 text-green-700 dark:text-green-300" :
                lastScanResult.status === "splice" ? "bg-amber-50 dark:bg-amber-950/30 border-amber-400 text-amber-600 dark:text-amber-400" :
                lastScanResult.msg?.includes("ALREADY") || lastScanResult.msg?.includes("DUPLICATE") ? 
                  "bg-orange-50 dark:bg-orange-950/30 border-orange-400 text-orange-700 dark:text-orange-300" :
                "bg-red-50 dark:bg-red-950/30 border-red-500 text-red-700 dark:text-red-300"
              }`}>
                <div className="flex items-center gap-1 sm:gap-2 lg:gap-3">
                  {lastScanResult.status === "ok" && <CheckCircle2 className="w-6 h-6 sm:w-8 sm:h-8 lg:w-10 lg:h-10" />}
                  {lastScanResult.status === "splice" && <Scissors className="w-6 h-6 sm:w-8 sm:h-8 lg:w-10 lg:h-10" />}
                  {lastScanResult.status === "reject" && (
                    lastScanResult.msg?.includes("ALREADY") || lastScanResult.msg?.includes("DUPLICATE") ?
                    <AlertCircle className="w-6 h-6 sm:w-8 sm:h-8 lg:w-10 lg:h-10" /> :
                    <XCircle className="w-6 h-6 sm:w-8 sm:h-8 lg:w-10 lg:h-10" />
                  )}
                  <div className="text-lg sm:text-2xl lg:text-3xl xl:text-4xl font-black tracking-widest uppercase">
                    {lastScanResult.status === "splice" ? "SPLICED" :
                     lastScanResult.status === "ok" ? "PASS ✓" :
                     lastScanResult.msg?.includes("ALREADY") || lastScanResult.msg?.includes("DUPLICATE") ?
                     "⚠️ DUPLICATE" : "FAIL ✗"}
                  </div>
                </div>
                <div className="text-xs sm:text-sm lg:text-base font-bold tracking-wide text-center px-2 line-clamp-2">
                  {lastScanResult.msg}
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center border-2 border-dashed border-border rounded-xl text-muted-foreground font-medium text-xs sm:text-sm lg:text-lg bg-card/50">
                Ready — scan to begin
              </div>
            )}
          </div>

          {/* Scan History - Responsive */}
          <Card className="flex-1 flex flex-col overflow-hidden border-border shadow-sm">
            <CardHeader className="bg-secondary/30 py-2 px-3 sm:py-3 sm:px-4 border-b border-border">
              <div className="flex justify-between items-center gap-2">
                <CardTitle className="text-xs sm:text-sm font-bold tracking-wider uppercase text-muted-foreground">Log</CardTitle>
                <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm font-bold">
                  <span className="text-primary">{scanLogRows.length || session.scans.length}</span>
                  <span className="text-amber-500">{splicingRecords.length}S</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 overflow-hidden">
              <ScrollArea className="h-full w-full">
                <style>{`
                  @keyframes scanRowSlideIn {
                    from { opacity: 0; transform: translateY(-6px); }
                    to { opacity: 1; transform: translateY(0); }
                  }
                  .scan-row-slide-in {
                    animation: scanRowSlideIn 180ms ease-out;
                  }
                `}</style>
                <div className="p-2 sm:p-3 space-y-2">
                  {/* Splice records first (inline, amber) */}
                  {splices && splices.length > 0 && splices.map((sp) => (
                    <div key={`splice-${sp.id}`} className="flex w-full flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs shadow-sm dark:bg-amber-950/20 dark:border-amber-800 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <Scissors className="w-3 h-3 text-amber-600 shrink-0" />
                        <span className="font-bold text-amber-700 dark:text-amber-400 w-10 truncate">SPLICD</span>
                        <span className="font-bold text-sm truncate">{sp.feederNumber}</span>
                        <span className="text-muted-foreground text-xs truncate">{sp.oldSpoolBarcode?.substring(0, 8)}... → {sp.newSpoolBarcode?.substring(0, 8)}...</span>
                        {sp.durationSeconds != null && <span className="text-muted-foreground text-xs">{sp.durationSeconds}s</span>}
                      </div>
                      <div className="text-muted-foreground text-xs font-medium shrink-0 text-right">
                        {format(new Date(sp.splicedAt), "HH:mm")}
                      </div>
                    </div>
                  ))}
                  <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
                    <ScrollArea className="h-[42vh] w-full rounded-none">
                      <div className="w-full overflow-x-auto">
                        <table className="min-w-full border-collapse font-mono text-[11px] sm:text-xs lg:text-sm">
                        <thead className="sticky top-0 z-20 bg-slate-900 text-white">
                          <tr>
                            <th className="px-2 py-2 text-left font-bold whitespace-nowrap">Time</th>
                            <th className="px-2 py-2 text-left font-bold whitespace-nowrap">Feeder No.</th>
                            <th className="px-2 py-2 text-left font-bold whitespace-nowrap">Ref / Des</th>
                            <th className="px-2 py-2 text-left font-bold whitespace-nowrap">Component</th>
                            <th className="px-2 py-2 text-left font-bold whitespace-nowrap">Package</th>
                            <th className="px-2 py-2 text-left font-bold whitespace-nowrap">Internal P/N</th>
                            <th className="px-2 py-2 text-left font-bold whitespace-nowrap text-[#1D4ED8]">Expected MPN</th>
                            <th className="px-2 py-2 text-left font-bold whitespace-nowrap">Scanned (Actual)</th>
                            <th className="px-2 py-2 text-left font-bold whitespace-nowrap">Matched As</th>
                            <th className="px-2 py-2 text-left font-bold whitespace-nowrap">Lot Code</th>
                            <th className="px-2 py-2 text-left font-bold whitespace-nowrap">Mode</th>
                            <th className="px-2 py-2 text-left font-bold whitespace-nowrap">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scanLogRows.length === 0 ? (
                            <tr>
                              <td colSpan={12} className="px-3 py-8 text-center text-muted-foreground font-medium">
                                No scans yet
                              </td>
                            </tr>
                          ) : (
                            scanLogRows.map((row, index) => (
                              <tr
                                key={`scan-${row.id}-${index}`}
                                className={`border-t border-border/60 ${index % 2 === 1 ? "bg-slate-50/70 dark:bg-slate-950/15" : "bg-background"} scan-row-slide-in`}
                              >
                                <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{format(new Date(row.scannedAt), "hh:mm:ss a")}</td>
                                <td className="px-2 py-2 whitespace-nowrap font-bold">{row.feederNumber}</td>
                                <td className="px-2 py-2 whitespace-nowrap">{row.bom.refDes || "—"}</td>
                                <td className="px-2 py-2 whitespace-nowrap">{row.bom.componentDesc || "—"}</td>
                                <td className="px-2 py-2 whitespace-nowrap">{row.bom.packageSize || "—"}</td>
                                <td className="px-2 py-2 whitespace-nowrap">{row.bom.internalPartNumber || "—"}</td>
                                <td className="px-2 py-2 whitespace-nowrap text-[#1D4ED8] font-semibold">{row.bom.expectedMpns.length > 0 ? row.bom.expectedMpns.join(" / ") : "—"}</td>
                                <td className={`px-2 py-2 whitespace-nowrap ${getScannedValueStyle(row)}`}>{row.scannedValue}{getScannedValueSuffix(row)}</td>
                                <td className="px-2 py-2 whitespace-nowrap">{formatMatchedAs(row)}</td>
                                <td className="px-2 py-2 whitespace-nowrap">{row.lotCode || "—"}</td>
                                <td className="px-2 py-2 whitespace-nowrap">
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${row.verificationMode === "AUTO" ? "bg-blue-100 text-[#1D4ED8]" : "bg-amber-100 text-[#B45309]"}`}>
                                    {row.verificationMode}
                                  </span>
                                </td>
                                <td className="px-2 py-2 whitespace-nowrap">
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${row.status === "verified" ? "bg-green-100 text-[#15803D]" : row.status === "duplicate" ? "bg-amber-100 text-[#B45309]" : "bg-red-100 text-[#B91C1C]"}`}>
                                    {row.status}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                      </div>
                    </ScrollArea>
                  </div>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="mt-4">
            <LogPanel />
          </div>
            </>
          )}

          {/* SPLICING SECTION - Shows when activeTab === "splicing" and all feeders verified */}
          {(isSpliceEligible || isSplicingPendingQa) && activeTab === "splicing" && (
            <div className="flex flex-col">
              <SplicingPage />

              {/* 200% QA checkpoint. The submit action lives in the top header
                  (FINISH SPLICING); this strip just tells the operator what's next. */}
              {isSpliceEligible && splicingRecords.length > 0 && (
                <div className="border-t border-border bg-card p-4 text-sm text-muted-foreground">
                  <span className="font-bold text-foreground">{splicingRecords.length}</span> splice(s) recorded.
                  Use <span className="font-bold text-foreground">FINISH SPLICING</span> at the top to send them for the 200% verification — QA and the supervisor are notified, and the changeover closes once every splice is verified.
                </div>
              )}

              {isSplicingPendingQa && user?.role === "operator" && (
                <div className="border-t border-border bg-amber-50 dark:bg-amber-900/20 p-4 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
                  <div className="text-sm text-amber-800 dark:text-amber-300">
                    <div className="font-bold">Splicing submitted — awaiting QA 200% verification.</div>
                    <div className="text-xs mt-0.5">QA must approve every splice before the changeover closes. This screen will advance to the report automatically.</div>
                  </div>
                </div>
              )}
            </div>
          )}
          </div>
          {/* End of left column */}

        {/* Right Panel: BOM Checklist - Hidden on mobile, shown on lg, hidden if free scan mode */}
        {!isFreeScan && (
          <div className="w-80 hidden lg:flex flex-col bg-card shrink-0 shadow-[-4px_0_15px_-5px_rgba(0,0,0,0.1)] z-10 border-l border-border overflow-hidden">
            <div className="p-3 border-b border-border bg-secondary/30 flex justify-between items-center gap-2 shrink-0">
              <h2 className="font-bold tracking-wider uppercase text-xs truncate">BOM</h2>
              <div className="text-xs font-bold bg-background px-2 py-1 rounded-full border border-border shadow-sm shrink-0">
                <span className="text-success">{uniqueOkScans}</span> / {totalBomItems}
              </div>
            </div>

            <ScrollArea className="flex-1 w-full overflow-hidden">
              <div className="p-2 space-y-2 w-full min-w-max">
                {feederGroupArray.map(({ feederNum, primary, alternates }) => {
                  const status = feederStatusMap[feederNum];
                  const hasSplice = splicingRecords.some((sp) => sp.feederId === feederNum);
                  const canRescan = session.status === "active" && (status === "reject" || status === "pending");

                  return (
                    <div key={`feeder-${feederNum}`} className="space-y-1 w-full overflow-hidden">
                      {/* PRIMARY ITEM */}
                      <div className={`flex items-start justify-between p-2 rounded-lg border shadow-sm transition-colors text-xs gap-2 min-w-0 ${
                        status === "ok" ? "bg-success/5 border-success/30" :
                        status === "reject" ? "bg-destructive/5 border-destructive/30" :
                        "bg-background border-border"
                      }`}>
                        <div className="flex flex-col min-w-0 flex-1 gap-1">
                          {/* Row 1: Feeder Number & Status */}
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="font-bold font-mono text-xs shrink-0">{feederNum}</span>
                            {hasSplice && (
                              <span title="Spool replaced">
                                <Scissors className="w-3 h-3 text-amber-500 shrink-0" />
                              </span>
                            )}
                            {!primary?.isAlternate && <span className="text-xs font-bold text-success px-1.5 py-0.5 bg-success/10 rounded-full shrink-0 whitespace-nowrap">PRIMARY</span>}
                          </div>

                          {/* Row 2: Part Number */}
                          <span className="text-xs text-muted-foreground truncate font-medium">{primary?.partNumber}</span>

                          {/* Row 3: Expected MPN (if exists) */}
                          {primary?.expectedMpn && (
                            <div className="text-xs text-muted-foreground font-mono truncate">
                              <span className="font-bold text-foreground">MPN:</span> <span className="truncate inline-block max-w-full">{primary.expectedMpn}</span>
                            </div>
                          )}

                          {/* Row 4: Internal ID (if exists) */}
                          {primary?.internalId && (
                            <div className="text-xs text-muted-foreground font-mono truncate">
                              <span className="font-bold text-foreground">ID:</span> <span className="truncate inline-block max-w-[calc(100%-20px)]">{primary.internalId}</span>
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 flex items-start gap-1">
                          {canRescan && (
                            <button
                              title="Re-scan"
                              onClick={() => {
                                setMode("scan");
                                setPendingFeeder(feederNum);
                                setFeederScanTime(Date.now());
                                setScanStep("spool");
                                setScanInput("");
                                focusNextFrame(inputRef);
                              }}
                              className="text-primary hover:text-primary/70 transition-colors p-1 rounded"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                          )}
                          {status === "ok" && <CheckCircle2 className="w-4 h-4 text-success shrink-0" />}
                          {status === "reject" && <XCircle className="w-4 h-4 text-destructive shrink-0" />}
                          {status === "pending" && <Circle className="w-4 h-4 text-muted-foreground/30 shrink-0" />}
                        </div>
                      </div>

                      {/* ALTERNATE ITEMS (if any) */}
                      {alternates && alternates.length > 0 && (
                        <div className="ml-2 space-y-1 pl-2 border-l-2 border-amber-300/50 w-full overflow-hidden">
                          {alternates.map((altItem) => (
                            <div
                              key={`alt-${feederNum}-${altItem.id}`}
                              className="flex items-start justify-between p-1.5 rounded border border-amber-200/50 bg-amber-50/30 dark:bg-amber-950/20 text-xs gap-2 min-w-0"
                            >
                              <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                                <span className="text-amber-600 dark:text-amber-400 font-bold shrink-0">ALT</span>
                                <span className="text-muted-foreground truncate font-medium">{altItem.partNumber}</span>
                                {altItem.expectedMpn && (
                                  <div className="text-muted-foreground font-mono text-xs truncate">
                                    <span className="font-bold">MPN:</span> <span className="truncate inline-block max-w-[calc(100%-20px)]">{altItem.expectedMpn}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {feederGroupArray.length === 0 && (
                  <div className="p-4 text-center text-xs text-muted-foreground font-medium border border-dashed border-border rounded-lg mt-2 w-full overflow-hidden">
                    No required items in BOM.
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Splice summary */}
            {splicingRecords.length > 0 && (
              <div className="p-2 border-t border-border bg-amber-50/50 dark:bg-amber-950/20 shrink-0">
                <div className="text-xs font-bold text-amber-600 dark:text-amber-400 tracking-wider mb-2 flex items-center gap-1">
                  <Scissors className="w-3 h-3" /> {splicingRecords.length} SPLICES
                </div>
                <div className="space-y-0.5">
                  {splicingRecords.map((sp) => (
                    <div key={`${sp.feederId}-${sp.splicedAt.toISOString()}`} className="text-xs text-muted-foreground font-mono flex justify-between px-1 overflow-hidden">
                      <span className="truncate">{sp.feederId}</span>
                      <span className="shrink-0 ml-1">{format(new Date(sp.splicedAt), "HH:mm")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Progress bar */}
            <div className="p-2 border-t border-border bg-background shrink-0">
              <div className="flex justify-between text-xs font-bold mb-2 tracking-wider text-muted-foreground">
                <span>PROGRESS</span>
                <span className="text-foreground">{totalBomItems > 0 ? Math.round((uniqueOkScans / totalBomItems) * 100) : 0}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: `${totalBomItems > 0 ? (uniqueOkScans / totalBomItems) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        )}
        </div>
        {/* End of flex row for left and right columns */}

      <ScanNotification
        notifications={scanNotifications}
        onDismiss={(id) => {
          const dismissed = notifications.find((n) => n.id === id);
          dismissNotification(id);

          if (!dismissed) {
            return;
          }

          const text = `${dismissed.title ?? ""} ${dismissed.message ?? ""}`.toLowerCase();
          if (dismissed.type === "error" || text.includes("duplicate")) {
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        }}
      />

      {showCompletionOverlay && user?.role === "operator" && (String(session.status) === "active" || String(session.status) === "pending_qa") && (
        <div className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl border border-amber-400/50 bg-card p-8 sm:p-10 shadow-2xl text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
              <CheckCircle2 className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="text-2xl sm:text-4xl font-black tracking-tight text-amber-600 dark:text-amber-400">
              VERIFICATION COMPLETE
            </div>
            <p className="mt-3 text-sm sm:text-base text-muted-foreground">
              {requiredFeedsVerifiedCount} / {totalRequiredFeeders} feeders verified.
            </p>
            {qaNotified ? (
              <div className="mx-auto mt-6 max-w-md rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="flex items-center justify-center gap-2 font-bold text-base">
                  <Loader2 className="h-4 w-4 animate-spin" /> Awaiting QA Confirmation
                </div>
                <p className="mt-2 leading-relaxed">
                  QA has been notified. Once they verify the changeover from their dashboard, you'll be moved to <strong>splicing</strong> automatically.
                </p>
              </div>
            ) : (
              <div className="mx-auto mt-6 max-w-md rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="font-bold text-base">Confirm Loading Quality</div>
                <p className="mt-2 leading-relaxed">
                  All feeders have been scanned. Confirm the loading to send it for <strong>QA</strong> quality verification — QA will be notified and you'll continue to splicing once they verify.
                </p>
              </div>
            )}
            <div className="mt-6 flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center">
              {!qaNotified && (
                <Button
                  className="font-semibold"
                  disabled={submittingQa}
                  onClick={handleSubmitForQa}
                >
                  {submittingQa && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm Loading &amp; Notify QA
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setShowCompletionOverlay(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Session Scanner State?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears verification/splicing store state, logs, notifications, and the current in-page scan inputs. Server-side scan records are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleResetSessionState}
            >
              Reset Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showClosureDialog} onOpenChange={setShowClosureDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Changeover</AlertDialogTitle>
            <AlertDialogDescription>
              Enter the production figures for this changeover. Total output units are computed as production quantity × BOM cavity count.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="closure-qty">Total Production Quantity *</Label>
              <Input
                id="closure-qty"
                // type=text (not number): a background refetch re-render wipes a
                // partially-typed value from a controlled number input. Text holds
                // the raw string; confirmClosure still validates via Number(...).
                type="text"
                inputMode="numeric"
                value={closureQty}
                onChange={(e) => setClosureQty(e.target.value)}
                placeholder="e.g. 1200"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="closure-cycle">Current Cycle Time (seconds) *</Label>
              <Input
                id="closure-cycle"
                // type=text (not number): see closure-qty above — protects the
                // partially-typed value from background-refetch re-renders.
                type="text"
                inputMode="decimal"
                value={closureCycle}
                onChange={(e) => setClosureCycle(e.target.value)}
                placeholder="e.g. 12.5"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={confirmClosure} disabled={updateSession.isPending}>
              {(splices?.length ?? 0) > 0 ? "Save & Submit to QA" : "Save & Close Changeover"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <HandoverModal
        open={showHandoverModal}
        onOpenChange={setShowHandoverModal}
        sessionId={String(session?.id ?? sessionId)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
        }}
      />
    </div>
    </div>
  );
}
