// Control Panel: label/sticker printing. Generates scannable stickers for:
//   1. the ##ACCEPT## "ENTER command" barcode (see src/lib/accept-token.ts),
//   2. machine QR + barcode,
//   3. feeder-number ranges (MACHINE-NNN).
// Prints two ways: a universal label PDF via the browser/OS dialog (any printer,
// incl. Zebra via driver) and — when the Zebra BrowserPrint service is detected —
// raw ZPL sent straight to a Zebra printer. Styled for the dark admin shell.
import { useEffect, useMemo, useState } from "react";
import { ACCEPT_TOKEN } from "@/lib/accept-token";
import { renderCode128, renderQR } from "@/lib/labels/render";
import { buildLabelSheetPdf, printPdf, type LabelItem } from "@/lib/labels/pdf";
import { code128Label, qrLabel } from "@/lib/labels/zpl";
import { detectZebra, sendZpl, type ZebraDevice } from "@/lib/labels/zebra";

const MAX_FEEDER_LABELS = 500;

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

const card: React.CSSProperties = {
  background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10,
  padding: "1.25rem", marginBottom: "1.25rem",
};
const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: "#e2e8f0", margin: "0 0 0.5rem" };
const sub: React.CSSProperties = { fontSize: 12, color: "#64748b", margin: "0 0 0.75rem", lineHeight: 1.5 };
const labelStyle: React.CSSProperties = {
  fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em",
  display: "block", marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  background: "#0d1224", border: "1px solid #1e2a3a", borderRadius: 6, color: "#e2e8f0",
  padding: "0.45rem 0.6rem", fontFamily: "inherit", fontSize: 13, width: "100%", boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  padding: "0.5rem 0.9rem", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer",
  fontFamily: "inherit", fontWeight: 600, background: "#00d4ff", color: "#0a0e1a",
};
const btnOutline: React.CSSProperties = {
  ...btn, background: "transparent", border: "1px solid #1e2a3a", color: "#94a3b8", fontWeight: 400,
};
const imgStyle: React.CSSProperties = { height: 96, background: "#fff", padding: 8, borderRadius: 6 };

function disable(base: React.CSSProperties, off: boolean): React.CSSProperties {
  return off ? { ...base, opacity: 0.45, cursor: "not-allowed" } : base;
}

export default function PrintLabels() {
  const [zebra, setZebra] = useState<ZebraDevice[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [acceptCopies, setAcceptCopies] = useState(1);
  const [machineName, setMachineName] = useState("");
  const [feederMachine, setFeederMachine] = useState("");
  const [feederStart, setFeederStart] = useState(1);
  const [feederEnd, setFeederEnd] = useState(10);
  const [feederWidth, setFeederWidth] = useState(3);

  useEffect(() => {
    void detectZebra().then(setZebra);
  }, []);

  const zebraOn = zebra !== null && zebra.length > 0;

  const acceptImg = useMemo(() => renderCode128(ACCEPT_TOKEN), []);
  const machineQrImg = useMemo(() => (machineName.trim() ? renderQR(machineName.trim()) : ""), [machineName]);
  const machineBarImg = useMemo(() => (machineName.trim() ? renderCode128(machineName.trim()) : ""), [machineName]);

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

  async function printLabels(labels: LabelItem[]) {
    if (labels.length === 0 || busy) return;
    setBusy(true);
    try {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const doc = await buildLabelSheetPdf(labels);
      printPdf(doc);
    } finally {
      setBusy(false);
    }
  }

  async function printZebra(zpl: string) {
    if (!zebra || zebra.length === 0) return;
    try {
      await sendZpl(zebra[0], zpl);
    } catch (err) {
      alert((err as Error)?.message ?? "Zebra print failed");
    }
  }

  const acceptLabels = (): LabelItem[] =>
    Array.from({ length: Math.max(1, acceptCopies) }, () => ({ imgDataUrl: acceptImg, caption: "ACCEPT / ENTER" }));
  const acceptZpl = () =>
    Array.from({ length: Math.max(1, acceptCopies) }, () => code128Label(ACCEPT_TOKEN, "ACCEPT / ENTER")).join("\n");

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

  const feederLabels = (): LabelItem[] => feederIds.map((id) => ({ imgDataUrl: renderCode128(id), caption: id }));
  const feederZpl = () => feederIds.map((id) => code128Label(id, id)).join("\n");

  // __RENDER__
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#e2e8f0" }}>Print Labels</h1>
        <div style={{
          fontSize: 11, borderRadius: 999, padding: "0.25rem 0.7rem",
          border: `1px solid ${zebraOn ? "rgba(0,255,136,0.4)" : "#1e2a3a"}`,
          color: zebraOn ? "#00ff88" : "#64748b",
        }}>
          {zebraOn ? `Zebra: ${zebra?.length} printer(s)` : "Zebra: not detected"}
        </div>
      </div>

      {/* 1 · Accept command barcode */}
      <div style={card}>
        <h2 style={cardTitle}>Accept Command Barcode</h2>
        <p style={sub}>
          Scanning this barcode into any manual-accept field confirms the entry (same as pressing Enter).
          Encodes <code style={{ color: "#00d4ff" }}>{ACCEPT_TOKEN}</code>.
        </p>
        {acceptImg && <img src={acceptImg} alt="Accept barcode" style={imgStyle} />}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 12 }}>
          <div style={{ width: 110 }}>
            <label style={labelStyle}>Copies</label>
            <input type="number" min={1} value={acceptCopies} style={inputStyle}
              onChange={(e) => setAcceptCopies(Number(e.target.value) || 1)} />
          </div>
          <button style={disable(btn, busy)} disabled={busy} onClick={() => void printLabels(acceptLabels())}>
            {busy ? "Preparing…" : "Print (PDF)"}
          </button>
          {zebraOn && <button style={btnOutline} onClick={() => void printZebra(acceptZpl())}>Send to Zebra</button>}
        </div>
      </div>

      {/* 2 · Machine label */}
      <div style={card}>
        <h2 style={cardTitle}>Machine Label (QR + Barcode)</h2>
        <div style={{ maxWidth: 320, marginBottom: 12 }}>
          <label style={labelStyle}>Machine Name</label>
          <input value={machineName} style={inputStyle} placeholder="e.g. SMT-LINE-1"
            onChange={(e) => setMachineName(e.target.value)} />
        </div>
        {machineName.trim() && (
          <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 12 }}>
            {machineQrImg && <img src={machineQrImg} alt="Machine QR" style={{ ...imgStyle, height: 112 }} />}
            {machineBarImg && <img src={machineBarImg} alt="Machine barcode" style={imgStyle} />}
          </div>
        )}
        <div style={{ display: "flex", gap: 12 }}>
          <button style={disable(btn, busy || !machineName.trim())} disabled={busy || !machineName.trim()}
            onClick={() => void printLabels(machineLabels())}>
            {busy ? "Preparing…" : "Print (PDF)"}
          </button>
          {zebraOn && (
            <button style={disable(btnOutline, !machineName.trim())} disabled={!machineName.trim()}
              onClick={() => void printZebra(machineZpl())}>Send to Zebra</button>
          )}
        </div>
      </div>

      {/* 3 · Feeder range */}
      <div style={card}>
        <h2 style={cardTitle}>Feeder Number Stickers</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Machine</label>
            <input value={feederMachine} style={inputStyle} placeholder="e.g. M1"
              onChange={(e) => setFeederMachine(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Start</label>
            <input type="number" min={0} value={feederStart} style={inputStyle}
              onChange={(e) => setFeederStart(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label style={labelStyle}>End</label>
            <input type="number" min={0} value={feederEnd} style={inputStyle}
              onChange={(e) => setFeederEnd(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label style={labelStyle}>Digits</label>
            <input type="number" min={1} max={6} value={feederWidth} style={inputStyle}
              onChange={(e) => setFeederWidth(Number(e.target.value) || 1)} />
          </div>
        </div>
        {feederError ? (
          <p style={{ ...sub, color: "#ff4444" }}>{feederError}</p>
        ) : (
          <p style={sub}>
            {feederIds.length} stickers: <span style={{ color: "#e2e8f0" }}>{feederIds[0]}</span> …{" "}
            <span style={{ color: "#e2e8f0" }}>{feederIds[feederIds.length - 1]}</span>
          </p>
        )}
        <div style={{ display: "flex", gap: 12 }}>
          <button style={disable(btn, busy || !!feederError)} disabled={busy || !!feederError}
            onClick={() => void printLabels(feederLabels())}>
            {busy ? "Preparing…" : "Print (PDF)"}
          </button>
          {zebraOn && (
            <button style={disable(btnOutline, !!feederError)} disabled={!!feederError}
              onClick={() => void printZebra(feederZpl())}>Send to Zebra</button>
          )}
        </div>
      </div>
    </div>
  );

}

