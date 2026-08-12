import type { StorageSnapshot, IntegrityResult } from "./admin-types";
import { loadBaselineSnapshot, saveBaselineSnapshot, nowFormatted } from "./admin-storage";

export async function sha256(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function detectModule(key: string): string {
  if (key.startsWith("adm_")) return "admin";
  if (key.startsWith("feeder_")) return "feeder";
  if (key.startsWith("ses_")) return "production";
  return "main";
}

export async function snapshotStorage(): Promise<StorageSnapshot> {
  const keys: StorageSnapshot["keys"] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    const value = localStorage.getItem(key) ?? "";
    const checksum = await sha256(value);
    const sizeBytes = new Blob([value]).size;
    const module = detectModule(key);
    keys.push({ key, sizeBytes, checksum, module });
  }
  return {
    timestamp: nowFormatted(),
    keys,
    totalBytes: keys.reduce((sum, k) => sum + k.sizeBytes, 0),
  };
}

export async function verifyIntegrity(baseline: StorageSnapshot): Promise<IntegrityResult[]> {
  const current = await snapshotStorage();
  const results: IntegrityResult[] = [];
  for (const baseKey of baseline.keys) {
    const curr = current.keys.find((k) => k.key === baseKey.key);
    if (!curr) {
      results.push({
        key: baseKey.key,
        module: baseKey.module,
        stored: baseKey.checksum,
        current: "MISSING",
        match: false,
      });
      continue;
    }
    results.push({
      key: baseKey.key,
      module: baseKey.module,
      stored: baseKey.checksum,
      current: curr.checksum,
      match: baseKey.checksum === curr.checksum,
    });
  }
  return results;
}

export async function runIntegrityCheck(): Promise<{
  passed: boolean;
  results: IntegrityResult[];
  tampered: IntegrityResult[];
}> {
  const baseline = loadBaselineSnapshot();
  if (!baseline) return { passed: true, results: [], tampered: [] };
  const results = await verifyIntegrity(baseline);
  const tampered = results.filter((r) => !r.match);
  return { passed: tampered.length === 0, results, tampered };
}

export async function saveBaseline(): Promise<void> {
  const snapshot = await snapshotStorage();
  saveBaselineSnapshot(snapshot);
}
