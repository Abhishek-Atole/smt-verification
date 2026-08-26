// Shared spool-label parser. Both the operator splicing page and the QA
// verification page must interpret a scanned spool barcode identically —
// keeping one implementation here prevents the two from silently diverging
// (a divergence would make QA scan-verify fail to match recorded splices).

export type SpoolLabel = {
  raw: string;
  mpn1: string | null;
  mpn2: string | null;
  mpn3: string | null;
  internalId: string | null;
  lotNo: string | null;
  qty: string | null;
  supplier: string | null;
};

function parseLabelValue(source: string, keyPatterns: string[]): string | null {
  for (const pattern of keyPatterns) {
    const regex = new RegExp(`${pattern}\\s*[:=]\\s*([^\\n;|,]+)`, "i");
    const match = source.match(regex);
    if (match?.[1]) {
      const value = match[1].trim();
      if (value) return value;
    }
  }
  return null;
}

export function parseSpoolLabel(raw: string): SpoolLabel {
  const trimmed = raw.trim();
  const fallback = trimmed || "";

  const fromJson = (() => {
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  const lookup = (keys: string[]) => {
    if (fromJson && typeof fromJson === "object") {
      const entries = Object.entries(fromJson).reduce<Record<string, unknown>>((acc, [key, value]) => {
        acc[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = value;
        return acc;
      }, {});
      for (const key of keys) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        const value = entries[normalizedKey];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
        if (typeof value === "number" && Number.isFinite(value)) {
          return String(value);
        }
      }
    }

    return parseLabelValue(trimmed, keys);
  };

  const mpn1 = lookup(["mpn1", "mpn_1", "mpn one", "mpn 1"]);
  const mpn2 = lookup(["mpn2", "mpn_2", "mpn two", "mpn 2"]);
  const mpn3 = lookup(["mpn3", "mpn_3", "mpn three", "mpn 3"]);
  const internalId = lookup(["internalid", "internal_id", "internal id", "internal"]);
  const lotNo = lookup(["lotno", "lot_no", "lot number", "lot"]);
  const qty = lookup(["qty", "quantity", "remaining qty", "remaining quantity"]);
  const supplier = lookup(["supplier", "vendor", "make"]);

  return {
    raw: fallback,
    mpn1: mpn1 || (fallback && !mpn2 && !mpn3 && !internalId ? fallback : null),
    mpn2: mpn2 || null,
    mpn3: mpn3 || null,
    internalId: internalId || (fallback && !mpn1 && !mpn2 && !mpn3 ? fallback : null),
    lotNo: lotNo || null,
    qty: qty || null,
    supplier: supplier || null,
  };
}
