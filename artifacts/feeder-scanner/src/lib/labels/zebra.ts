// Zebra BrowserPrint client — talks to the Zebra BrowserPrint desktop service over
// its documented localhost HTTP API (no proprietary SDK bundled). All calls are
// best-effort: if the service isn't installed/running, detectZebra() resolves to
// null and the UI simply hides the "Send to Zebra" option.
//
// BrowserPrint listens on http://localhost:9100 (and https on 9101). We use the
// plain HTTP endpoint, which the service enables for local web apps.

const BASE = "http://localhost:9100";

export interface ZebraDevice {
  uid: string;
  name: string;
  connection: string;
  deviceType: string;
  version?: number;
  provider?: string;
  manufacturer?: string;
}

async function fetchWithTimeout(url: string, init?: RequestInit, ms = 1500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Returns the list of available Zebra printer devices, or null if the BrowserPrint
// service is unreachable. Never throws.
export async function detectZebra(): Promise<ZebraDevice[] | null> {
  try {
    const res = await fetchWithTimeout(`${BASE}/available`);
    if (!res.ok) return null;
    const data = (await res.json()) as { printer?: ZebraDevice[] } | ZebraDevice[];
    const printers = Array.isArray(data) ? data : data.printer ?? [];
    return printers.length > 0 ? printers : null;
  } catch {
    return null;
  }
}

// Sends raw ZPL to the given device. Throws on failure so the caller can surface it.
export async function sendZpl(device: ZebraDevice, zpl: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${BASE}/write`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device, data: zpl }),
    },
    5000,
  );
  if (!res.ok) {
    throw new Error(`Zebra print failed (HTTP ${res.status})`);
  }
}
