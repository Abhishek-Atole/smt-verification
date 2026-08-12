import { logAudit } from "./admin-storage";
import { sha256 } from "./integrity";
import { detectModule } from "./integrity";

export function readBackupFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error("No file selected"));
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    };
    input.click();
  });
}

export async function restoreBackup(content: string): Promise<void> {
  let payload: { version?: string; data?: Record<string, string>; checksum?: string };
  try {
    payload = JSON.parse(content);
  } catch {
    throw new Error("Backup file is not valid JSON.");
  }

  if (!payload || typeof payload !== "object" || typeof payload.data !== "object" || payload.data === null) {
    throw new Error("Backup file is missing a data payload.");
  }
  if (typeof payload.version !== "string") {
    throw new Error("Backup file is missing a version stamp.");
  }

  const computedChecksum = await sha256(content);

  // Verify against manifest checksum if present (best-effort integrity check).
  if (payload.checksum && payload.checksum !== computedChecksum) {
    throw new Error("Backup file checksum does not match the manifest.");
  }

  for (const [key, value] of Object.entries(payload.data)) {
    if (typeof value !== "string") continue;
    localStorage.setItem(key, value);
  }

  const { saveBaseline } = await import("./integrity");
  await saveBaseline();

  logAudit("backup_restored", "Data restored from backup file", "success");
}

export function analyzeStorage(): {
  totalBytes: number;
  usedPercent: number;
  byModule: Record<string, number>;
  largestKeys: { key: string; sizeBytes: number }[];
} {
  const byModule: Record<string, number> = {};
  const allKeys: { key: string; sizeBytes: number }[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    const value = localStorage.getItem(key) ?? "";
    const size = new Blob([value]).size;
    const module = detectModule(key);
    byModule[module] = (byModule[module] ?? 0) + size;
    allKeys.push({ key, sizeBytes: size });
  }

  const totalBytes = allKeys.reduce((s, k) => s + k.sizeBytes, 0);
  allKeys.sort((a, b) => b.sizeBytes - a.sizeBytes);

  return {
    totalBytes,
    usedPercent: Math.min(100, (totalBytes / 5_000_000) * 100),
    byModule,
    largestKeys: allKeys.slice(0, 10),
  };
}
