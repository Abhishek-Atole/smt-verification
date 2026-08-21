// Barcode / QR rasterization for label printing. Renders to an offscreen canvas
// via bwip-js and returns a PNG data URL — reused both for on-screen preview
// (<img src>) and for embedding into the jsPDF label sheet (doc.addImage).
import * as bwipjs from "bwip-js/browser";

function renderToDataUrl(opts: bwipjs.RenderOptions): string {
  const canvas = document.createElement("canvas");
  bwipjs.toCanvas(canvas, opts);
  return canvas.toDataURL("image/png");
}

// Code128: human-readable text printed under the bars by default so a picker can
// read the value without a scanner.
export function renderCode128(text: string, includetext = true): string {
  return renderToDataUrl({
    bcid: "code128",
    text,
    scale: 3,
    height: 12,
    includetext,
    textxalign: "center",
    textsize: 10,
  });
}

export function renderQR(text: string): string {
  return renderToDataUrl({
    bcid: "qrcode",
    text,
    scale: 4,
  });
}
