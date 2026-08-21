// ZPL (Zebra Programming Language) builders for direct-to-Zebra printing via the
// BrowserPrint service (see zebra.ts). Each builder returns a complete ^XA…^XZ
// label. Sizing targets a common 50x25mm label at 203 dpi (~8 dots/mm → 400x200
// dots); adjust ^PW/^LL if your stock differs.

const PW = 400; // print width in dots (~50mm @ 203dpi)
const LL = 200; // label length in dots (~25mm @ 203dpi)

// Escape the handful of characters that are control prefixes in ZPL field data.
function zplEscape(text: string): string {
  return text.replace(/[\^~]/g, (c) => (c === "^" ? "_5E" : "_7E"));
}

// Code128 label with a human-readable caption printed below the bars.
export function code128Label(text: string, caption?: string): string {
  const data = zplEscape(text);
  const cap = zplEscape(caption ?? text);
  return [
    "^XA",
    `^PW${PW}`,
    `^LL${LL}`,
    "^CI28", // UTF-8 input
    // Code128, ^BY sets module width; ^FO x,y positions; height 80 dots.
    "^BY2,2,80",
    "^FO40,30^BCN,80,N,N,N",
    `^FD${data}^FS`,
    // Caption text under the barcode.
    `^FO40,120^A0N,28,28^FD${cap}^FS`,
    "^XZ",
  ].join("\n");
}

// QR label with a caption to the right of the code.
export function qrLabel(text: string, caption?: string): string {
  const data = zplEscape(text);
  const cap = zplEscape(caption ?? text);
  return [
    "^XA",
    `^PW${PW}`,
    `^LL${LL}`,
    "^CI28",
    // QR: ^BQN,2,<magnification>. ^FDLA, selects auto data mode.
    "^FO30,40^BQN,2,6",
    `^FDLA,${data}^FS`,
    `^FO200,80^A0N,28,28^FD${cap}^FS`,
    "^XZ",
  ].join("\n");
}
