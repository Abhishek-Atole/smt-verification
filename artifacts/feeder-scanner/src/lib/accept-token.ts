// App-defined "accept" sentinel. The operator prints a Code128/QR barcode that
// encodes ACCEPT_TOKEN; scanning it into any manual-accept field fires that
// site's accept handler instead of being treated as scan data. This lets the
// operator confirm with the handheld scanner instead of the keyboard/button.
export const ACCEPT_TOKEN = "##ACCEPT##";

export function isAcceptToken(value: string): boolean {
  return value.trim().toUpperCase() === ACCEPT_TOKEN;
}
