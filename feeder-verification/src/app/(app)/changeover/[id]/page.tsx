"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useVerificationStore } from "@/store/useVerificationStore";
import { useSplicingStore } from "@/store/useSplicingStore";
import { useScanner } from "@/components/scanner/useScanner";
import { ScanInput } from "@/components/scanner/ScanInput";
import { ScanNotification } from "@/components/scanner/ScanNotification";
import { VerificationCard } from "@/components/verification/VerificationCard";
import { ProgressRing } from "@/components/verification/ProgressRing";
import { ScannedList } from "@/components/verification/ScannedList";
import { SplicingCard } from "@/components/splicing/SplicingCard";
import { SpliceList } from "@/components/splicing/SpliceList";

type PageTab = "verification" | "splicing";

export default function ChangeoverPage() {
  const { id: changeoverId } = useParams<{ id: string }>();
  const verification = useVerificationStore();
  const splicing = useSplicingStore();
  const [tab, setTab] = useState<PageTab>("verification");
  const [notification, setNotification] = useState<{ type: "ok" | "err" | "alt"; msg: string } | null>(null);

  useEffect(() => {
    fetch(`/api/changeovers/${changeoverId}/scans`)
      .then((response) => response.json())
      .then(({ scans }) => {
        fetch(`/api/changeovers/${changeoverId}/progress`)
          .then((response) => response.json())
          .then(({ progress }) => {
            verification.hydrate(
              changeoverId,
              (scans ?? []).map(
                (scan: {
                  lineItemId: string;
                  lineItem: { feederNumber: string; description: string | null };
                  scannedMpn: string;
                  scannedLotCode: string | null;
                  alternative: { make: string };
                  matchType: "mpn1" | "mpn2" | "mpn3" | "ucal_part_number";
                  isAlternate: boolean;
                  scannedAt: string;
                }) => ({
                  lineItemId: scan.lineItemId,
                  feederNumber: scan.lineItem.feederNumber,
                  description: scan.lineItem.description,
                  scannedMpn: scan.scannedMpn,
                  lotCode: scan.scannedLotCode,
                  make: scan.alternative.make,
                  matchType: scan.matchType,
                  isAlternate: scan.isAlternate,
                  scannedAt: scan.scannedAt,
                }),
              ),
              progress,
            );

            if (progress?.isComplete) setTab("splicing");
          });
      });

    fetch(`/api/changeovers/${changeoverId}/splices`)
      .then((response) => response.json())
      .then(({ splices }) => {
        splicing.setEntries(
          (splices ?? []).map(
            (entry: {
              id: string;
              lineItemId: string;
              lineItem: { feederNumber: string };
              oldSpoolMpn: string;
              oldSpoolLot: string | null;
              newSpoolMpn: string;
              newSpoolLot: string | null;
              splicedAt: string;
            }) => ({
              id: entry.id,
              lineItemId: entry.lineItemId,
              feederNumber: entry.lineItem.feederNumber,
              oldSpoolMpn: entry.oldSpoolMpn,
              oldSpoolLot: entry.oldSpoolLot,
              newSpoolMpn: entry.newSpoolMpn,
              newSpoolLot: entry.newSpoolLot,
              splicedAt: entry.splicedAt,
            }),
          ),
        );
      });
  }, [changeoverId, verification, splicing]);

  useEffect(() => {
    if (verification.progress.isComplete && tab === "verification") {
      setTimeout(() => setTab("splicing"), 1500);
    }
  }, [verification.progress.isComplete, tab]);

  const handleMpnScan = useCallback(
    async (value: string): Promise<"success" | "error"> => {
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch(`/api/changeovers/${changeoverId}/scans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scannedValue: value, idempotencyKey }),
      });

      const data = await response.json();
      if (!response.ok) {
        setNotification({ type: "err", msg: data.message ?? data.error });
        return "error";
      }

      verification.setPendingFeeder({
        lineItemId: data.scan.lineItemId,
        feederNumber: data.match.feederNumber,
        description: data.scan.lineItem.description,
        scannedMpn: data.scan.scannedMpn,
        lotCode: null,
        make: data.match.make,
        matchType: data.match.matchType,
        isAlternate: data.match.isAlternate,
        scannedAt: data.scan.scannedAt,
      });

      verification.setProgress(data.progress);

      setNotification({
        type: data.match.isAlternate ? "alt" : "ok",
        msg: `Verified ${data.match.feederNumber} (${data.match.make})`,
      });

      return "success";
    },
    [changeoverId, verification],
  );

  const handleLotScan = useCallback(
    async (lotCode: string): Promise<"success" | "error"> => {
      if (!verification.pendingFeeder) return "error";

      const response = await fetch(`/api/changeovers/${changeoverId}/scans`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItemId: verification.pendingFeeder.lineItemId,
          lotCode,
          idempotencyKey: crypto.randomUUID(),
        }),
      });

      if (!response.ok) return "error";

      verification.confirmScan(lotCode);
      setNotification({ type: "ok", msg: `LOT ${lotCode} saved` });
      return "success";
    },
    [changeoverId, verification],
  );

  const skipLot = useCallback(() => {
    verification.confirmScan(null);
    setNotification(null);
  }, [verification]);

  const mpnScanner = useScanner({
    onSubmit: handleMpnScan,
    disabled: verification.scanStep !== "mpn" || tab !== "verification",
  });

  const lotScanner = useScanner({
    onSubmit: handleLotScan,
    disabled: verification.scanStep !== "lot" || tab !== "verification",
  });

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
        {tab === "verification" ? (
          <>
            <VerificationCard title="MPN Scan">
              <ScanInput
                label="Scan spool barcode"
                placeholder="Scan MPN or UCAL part number"
                value={mpnScanner.value}
                onChange={mpnScanner.setValue}
                onKeyDown={mpnScanner.handleKeyDown}
                inputRef={mpnScanner.inputRef}
                disabled={verification.scanStep !== "mpn"}
              />
            </VerificationCard>
            <VerificationCard title="LOT Scan">
              {verification.pendingFeeder ? (
                <p className="mb-3 text-xs text-neutral-600">
                  Matched feeder {verification.pendingFeeder.feederNumber} ({verification.pendingFeeder.make})
                </p>
              ) : null}
              <ScanInput
                label="Scan lot code"
                placeholder="Scan lot code"
                value={lotScanner.value}
                onChange={lotScanner.setValue}
                onKeyDown={lotScanner.handleKeyDown}
                inputRef={lotScanner.inputRef}
                disabled={verification.scanStep !== "lot"}
              />
              {verification.scanStep === "lot" ? (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={skipLot}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
                  >
                    Skip LOT
                  </button>
                </div>
              ) : null}
            </VerificationCard>
          </>
        ) : (
          <SplicingCard>
            <h2 className="mb-4 text-base font-semibold text-neutral-900">Splicing Section</h2>
            <p className="mb-4 text-sm text-neutral-600">Verification reached 100%. You can now record splices.</p>
            <SpliceList entries={splicing.entries} />
          </SplicingCard>
        )}
      </div>

      <div className="flex w-80 flex-col border-l border-neutral-200">
        <div className="p-4">
          <ProgressRing percentage={verification.progress.percentage} />
          <p className="mt-2 text-sm text-neutral-600">
            {verification.progress.verified} / {verification.progress.total} feeders verified
          </p>
        </div>
        <ScannedList scans={[...verification.scannedFeeders.values()]} />
      </div>

      {notification ? (
        <ScanNotification type={notification.type} message={notification.msg} onClose={() => setNotification(null)} />
      ) : null}
    </div>
  );
}
