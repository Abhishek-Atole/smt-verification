// ZPL (Zebra Programming Language) builders for direct-to-Zebra printing via the
// BrowserPrint service (see zebra.ts). Each builder returns a complete ^XA…^XZ
// label. Sizing targets a common 50x25mm label at 203 dpi (~8 dots/mm → 400x200
// dots); adjust ^PW/^LL if your stock differs.

const PW = 400; // print width in dots (~50mm @ 203dpi)
const LL = 200; // label length in dots (~25mm @ 203dpi)

// Hex-escape the characters that are control prefixes in ZPL field data. The
// escaped fields are emitted with ^FH (default indicator "_"), so "_5E" is decoded
// back to "^" by the printer. The indicator "_" itself must therefore be escaped
// too, or literal underscores in the data would be misread as hex sequences.
function zplEscape(text: string): string {
  return text.replace(/[\^~_]/g, (c) => {
    const hex = c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    return `_${hex}`;
  });
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
    `^FH^FD${data}^FS`,
    // Caption text under the barcode.
    `^FO40,120^A0N,28,28^FH^FD${cap}^FS`,
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
    `^FH^FDLA,${data}^FS`,
    `^FO200,80^A0N,28,28^FH^FD${cap}^FS`,
    "^XZ",
  ].join("\n");
}
