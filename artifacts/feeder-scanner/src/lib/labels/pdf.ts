// Universal label-sheet printing via jsPDF (already a project dependency). Lays out
// barcode/QR PNGs in a grid on A4 and either opens the browser/OS print dialog
// (works with Zebra label printers through their driver AND any other printer) or
// saves a PDF. Mirrors the jsPDF setup already used in src/pages/session-report.tsx.
import jsPDF from "jspdf";

export interface LabelItem {
  imgDataUrl: string;
  caption: string;
}

// Page + grid geometry in mm (A4 portrait).
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 12;
const COLS = 2;
const CELL_GAP = 8;
const CELL_H = 40; // image area + caption per label
const CAPTION_H = 6;

function loadSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = dataUrl;
  });
}

export async function buildLabelSheetPdf(labels: LabelItem[]): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const cellW = (PAGE_W - MARGIN * 2 - CELL_GAP * (COLS - 1)) / COLS;
  const imgAreaH = CELL_H - CAPTION_H;
  let col = 0;
  let y = MARGIN;

  for (const label of labels) {
    const x = MARGIN + col * (cellW + CELL_GAP);
    if (y + CELL_H > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
      col = 0;
    }

    // Fit the image into the cell's image area preserving aspect ratio.
    const { w: nw, h: nh } = await loadSize(label.imgDataUrl);
    const scale = Math.min(cellW / nw, imgAreaH / nh);
    const drawW = nw * scale;
    const drawH = nh * scale;
    const imgX = x + (cellW - drawW) / 2;
    doc.addImage(label.imgDataUrl, "PNG", imgX, y, drawW, drawH);

    doc.setFontSize(9);
    doc.text(label.caption, x + cellW / 2, y + imgAreaH + 4, { align: "center" });

    col += 1;
    if (col >= COLS) {
      col = 0;
      y += CELL_H;
    }
  }

  return doc;
}

// Print the PDF via a hidden iframe. window.open() after an awaited build loses
// the user-activation gesture and gets popup-blocked; a same-document iframe does
// not. The blob URL is revoked once the print dialog has been dispatched.
export function printPdf(doc: jsPDF): void {
  doc.autoPrint();
  const url = doc.output("bloburl") as unknown as string;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.src = url;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // If in-frame print is blocked, fall back to opening the blob directly.
      window.open(url, "_blank");
    }
    // Give the print dialog time to grab the document before cleanup.
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      iframe.remove();
    }, 60_000);
  };
  document.body.appendChild(iframe);
}

export function savePdf(doc: jsPDF, filename: string): void {
  doc.save(filename);
}
