import Papa from "papaparse";

export interface ParsedBomLine {
  feederNumber: string;
  description?: string;
  packageDesc?: string;
  ucalPartNumbers: string[];
  alternatives: Array<{
    rank: 1 | 2 | 3;
    make: string;
    mpn: string;
    supplierCode?: string;
  }>;
}

export interface ParsedBom {
  bomNumber: string;
  revision: string;
  bomDate: Date;
  customerName?: string;
  partNameInternal?: string;
  lines: ParsedBomLine[];
}

export function parseBomCsv(csv: string): ParsedBom {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  if (parsed.errors.length) {
    throw new Error(`Failed to parse CSV: ${parsed.errors[0]?.message ?? "Unknown parse error"}`);
  }

  const rows = parsed.data;
  if (!rows.length) {
    throw new Error("CSV has no rows");
  }

  const lines: ParsedBomLine[] = rows.map((row) => {
    const make1 = row.Make1?.trim() ?? "";
    const make2 = row.Make2?.trim() ?? "";
    const make3 = row.Make3?.trim() ?? "";
    const mpn1 = row.MPN1?.trim() ?? "";
    const mpn2 = row.MPN2?.trim() ?? "";
    const mpn3 = row.MPN3?.trim() ?? "";

    return {
      feederNumber: row.FeederNumber?.trim() ?? row.feeder_number?.trim() ?? "",
      description: row.Description?.trim(),
      packageDesc: row.Package?.trim() ?? row.package_desc?.trim(),
      ucalPartNumbers: (row.UCALPartNumbers ?? row.ucal_part_numbers ?? "")
        .split("/")
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean),
      alternatives: [
        { rank: 1, make: make1, mpn: mpn1, supplierCode: row.SupplierCode1?.trim() },
        { rank: 2, make: make2, mpn: mpn2, supplierCode: row.SupplierCode2?.trim() },
        { rank: 3, make: make3, mpn: mpn3, supplierCode: row.SupplierCode3?.trim() },
      ].filter((alternative) => alternative.make && alternative.mpn) as ParsedBomLine["alternatives"],
    };
  });

  return {
    bomNumber: rows[0]?.BOMNumber?.trim() ?? rows[0]?.bom_number?.trim() ?? `BOM-${Date.now()}`,
    revision: rows[0]?.Revision?.trim() ?? rows[0]?.revision?.trim() ?? "R00",
    bomDate: new Date(rows[0]?.BOMDate?.trim() ?? rows[0]?.bom_date?.trim() ?? new Date().toISOString()),
    customerName: rows[0]?.CustomerName?.trim() ?? rows[0]?.customer_name?.trim(),
    partNameInternal: rows[0]?.PartNameInternal?.trim() ?? rows[0]?.part_name_internal?.trim(),
    lines,
  };
}
