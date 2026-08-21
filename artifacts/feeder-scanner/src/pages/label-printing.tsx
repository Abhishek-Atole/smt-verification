// Admin-only label/sticker printing. Generates scannable stickers for:
//   1. the ##ACCEPT## "ENTER command" barcode (see src/lib/accept-token.ts),
//   2. machine QR + barcode,
//   3. feeder-number ranges (MACHINE-NNN).
// Prints two ways: a universal label PDF via the browser/OS dialog (any printer,
// incl. Zebra via driver) and — when the Zebra BrowserPrint service is detected —
// raw ZPL sent straight to a Zebra printer.
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrCode, Printer, ScanLine } from "lucide-react";
import { ACCEPT_TOKEN } from "@/lib/accept-token";
import { renderCode128, renderQR } from "@/lib/labels/render";
import { buildLabelSheetPdf, printPdf, type LabelItem } from "@/lib/labels/pdf";
import { code128Label, qrLabel } from "@/lib/labels/zpl";
import { detectZebra, sendZpl, type ZebraDevice } from "@/lib/labels/zebra";

const MAX_FEEDER_LABELS = 500;

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export default function LabelPrinting() {
  const [zebra, setZebra] = useState<ZebraDevice[] | null>(null);

  // Accept command
  const [acceptCopies, setAcceptCopies] = useState(1);

  // Machine label
  const [machineName, setMachineName] = useState("");

  // Feeder range
  const [feederMachine, setFeederMachine] = useState("");
  const [feederStart, setFeederStart] = useState(1);
  const [feederEnd, setFeederEnd] = useState(10);
  const [feederWidth, setFeederWidth] = useState(3);

  useEffect(() => {
    void detectZebra().then(setZebra);
  }, []);

  const zebraOn = zebra !== null && zebra.length > 0;

  // --- Previews (data URLs) ---
  const acceptImg = useMemo(() => renderCode128(ACCEPT_TOKEN), []);
  const machineQrImg = useMemo(() => (machineName.trim() ? renderQR(machineName.trim()) : ""), [machineName]);
  const machineBarImg = useMemo(() => (machineName.trim() ? renderCode128(machineName.trim()) : ""), [machineName]);

  // --- Feeder range ids ---
  const feederIds = useMemo(() => {
    const m = feederMachine.trim();
    if (!m || feederEnd < feederStart) return [];
    const count = feederEnd - feederStart + 1;
    if (count > MAX_FEEDER_LABELS) return [];
    return Array.from({ length: count }, (_, i) => `${m}-${pad(feederStart + i, feederWidth)}`);
  }, [feederMachine, feederStart, feederEnd, feederWidth]);

  const feederCount = feederEnd - feederStart + 1;
  const feederError =
    !feederMachine.trim()
      ? "Enter a machine name."
      : feederEnd < feederStart
      ? "End must be ≥ start."
      : feederCount > MAX_FEEDER_LABELS
      ? `Too many labels (${feederCount}); max ${MAX_FEEDER_LABELS}.`
      : "";

  // --- Print helpers ---
  async function printLabels(labels: LabelItem[]) {
    if (labels.length === 0) return;
    const doc = await buildLabelSheetPdf(labels);
    printPdf(doc);
  }

  async function printZebra(zpl: string) {
    if (!zebra || zebra.length === 0) return;
    try {
      await sendZpl(zebra[0], zpl);
    } catch (err) {
      alert((err as Error)?.message ?? "Zebra print failed");
    }
  }

  // --- Accept ---
  const acceptLabels = (): LabelItem[] =>
    Array.from({ length: Math.max(1, acceptCopies) }, () => ({ imgDataUrl: acceptImg, caption: "ACCEPT / ENTER" }));
  const acceptZpl = () =>
    Array.from({ length: Math.max(1, acceptCopies) }, () => code128Label(ACCEPT_TOKEN, "ACCEPT / ENTER")).join("\n");

  // --- Machine ---
  const machineLabels = (): LabelItem[] => {
    const m = machineName.trim();
    if (!m) return [];
    return [
      { imgDataUrl: machineQrImg, caption: m },
      { imgDataUrl: machineBarImg, caption: m },
    ];
  };
  const machineZpl = () => {
    const m = machineName.trim();
    return `${qrLabel(m, m)}\n${code128Label(m, m)}`;
  };

  // --- Feeder ---
  const feederLabels = (): LabelItem[] => feederIds.map((id) => ({ imgDataUrl: renderCode128(id), caption: id }));
  const feederZpl = () => feederIds.map((id) => code128Label(id, id)).join("\n");

  return (
    <div className="w-full space-y-6 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Printer className="h-5 w-5" /> Print Labels
          </h1>
          <p className="text-sm text-muted-foreground">Generate scannable stickers — accept command, machine, and feeder numbers.</p>
        </div>
        <div className={`text-xs rounded-full px-3 py-1 border ${zebraOn ? "border-success/40 text-success" : "border-border text-muted-foreground"}`}>
          {zebraOn ? `Zebra: ${zebra?.length} printer(s)` : "Zebra: not detected"}
        </div>
      </div>

      {/* 1 · Accept command barcode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5" /> Accept Command Barcode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Scanning this barcode into any manual-accept field confirms the entry (same as pressing Enter). Encodes <code>{ACCEPT_TOKEN}</code>.
          </p>
          {acceptImg && <img src={acceptImg} alt="Accept barcode" className="h-24 bg-white p-2 rounded border" />}
          <div className="flex items-end gap-3">
            <div className="w-32">
              <Label>Copies</Label>
              <Input type="number" min={1} value={acceptCopies} onChange={(e) => setAcceptCopies(Number(e.target.value) || 1)} />
            </div>
            <Button onClick={() => void printLabels(acceptLabels())}><Printer className="mr-2 h-4 w-4" /> Print (PDF)</Button>
            {zebraOn && <Button variant="outline" onClick={() => void printZebra(acceptZpl())}>Send to Zebra</Button>}
          </div>
        </CardContent>
      </Card>

      {/* 2 · Machine label */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> Machine Label (QR + Barcode)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-sm">
            <Label>Machine Name</Label>
            <Input value={machineName} onChange={(e) => setMachineName(e.target.value)} placeholder="e.g. SMT-LINE-1" />
          </div>
          {machineName.trim() && (
            <div className="flex items-center gap-6">
              {machineQrImg && <img src={machineQrImg} alt="Machine QR" className="h-28 bg-white p-2 rounded border" />}
              {machineBarImg && <img src={machineBarImg} alt="Machine barcode" className="h-24 bg-white p-2 rounded border" />}
            </div>
          )}
          <div className="flex gap-3">
            <Button disabled={!machineName.trim()} onClick={() => void printLabels(machineLabels())}>
              <Printer className="mr-2 h-4 w-4" /> Print (PDF)
            </Button>
            {zebraOn && (
              <Button variant="outline" disabled={!machineName.trim()} onClick={() => void printZebra(machineZpl())}>
                Send to Zebra
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 3 · Feeder range */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5" /> Feeder Number Stickers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <Label>Machine</Label>
              <Input value={feederMachine} onChange={(e) => setFeederMachine(e.target.value)} placeholder="e.g. M1" />
            </div>
            <div>
              <Label>Start</Label>
              <Input type="number" min={0} value={feederStart} onChange={(e) => setFeederStart(Number(e.target.value) || 0)} />
            </div>
            <div>
              <Label>End</Label>
              <Input type="number" min={0} value={feederEnd} onChange={(e) => setFeederEnd(Number(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Digits</Label>
              <Input type="number" min={1} max={6} value={feederWidth} onChange={(e) => setFeederWidth(Number(e.target.value) || 1)} />
            </div>
          </div>
          {feederError ? (
            <p className="text-sm text-destructive">{feederError}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {feederIds.length} stickers: <span className="font-mono">{feederIds[0]}</span> … <span className="font-mono">{feederIds[feederIds.length - 1]}</span>
            </p>
          )}
          <div className="flex gap-3">
            <Button disabled={!!feederError} onClick={() => void printLabels(feederLabels())}>
              <Printer className="mr-2 h-4 w-4" /> Print (PDF)
            </Button>
            {zebraOn && (
              <Button variant="outline" disabled={!!feederError} onClick={() => void printZebra(feederZpl())}>
                Send to Zebra
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
