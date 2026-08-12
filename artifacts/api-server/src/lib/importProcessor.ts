import ExcelJS from "exceljs";
import { parse as parseCsv } from "papaparse";
import { randomUUID } from "crypto";
import { buildQrPayload } from "./qrSigning";

const STAGE_ORDER: Record<string, number> = {
  SPI: 1,
  Feeder: 2,
  Reflow: 3,
  AOI: 4,
  Other: 5,
};

function getStageOrder(stage: string): number {
  return STAGE_ORDER[stage] ?? 5;
}

export interface ImportRow {
  programName: string;
  stage: string;
  machineId?: string;
  machineType?: string;
  partNo?: string;
  version?: string;
  workingProgram?: string;
  updatedProgram?: string;
  description?: string;
}

export interface ImportResult {
  rows: ImportRow[];
  errors: { row: number; programName: string; error: string }[];
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function normalizeStage(raw: string): string {
  const stage = raw.trim().toLowerCase();
  if (stage === "spi") return "SPI";
  if (stage === "feeder" || stage === "pnp" || stage === "pick&place" || stage === "pick_and_place") return "Feeder";
  if (stage === "reflow") return "Reflow";
  if (stage === "aoi") return "AOI";
  return "Other";
}

function sanitizeText(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function validateRow(raw: Record<string, unknown>): { row: ImportRow | null; error: string | null } {
  const programName = sanitizeText(raw.program_name);
  const rawStage = sanitizeText(raw.stage);

  if (!programName) {
    return { row: null, error: "program_name is required" };
  }

  if (!rawStage) {
    return { row: null, error: "stage is required" };
  }

  return {
    row: {
      programName,
      stage: normalizeStage(rawStage),
      machineId: sanitizeText(raw.machine_id),
      machineType: sanitizeText(raw.machine_type),
      partNo: sanitizeText(raw.part_no),
      version: sanitizeText(raw.version) ?? "1.0",
      workingProgram: sanitizeText(raw.working_program),
      updatedProgram: sanitizeText(raw.updated_program),
      description: sanitizeText(raw.description),
    },
    error: null,
  };
}

export async function parseExcelBuffer(buffer: Buffer): Promise<ImportResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];

  if (!sheet) {
    throw new Error("No worksheet found in Excel file");
  }

  const result: ImportResult = { rows: [], errors: [] };
  const headers: Record<number, string> = {};
  const headerValues = sheet.getRow(1).values as unknown[];

  headerValues.forEach((value, index) => {
    if (index > 0 && value != null) {
      headers[index] = normalizeHeader(String(value));
    }
  });

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const raw: Record<string, unknown> = {};
    row.eachCell((cell, colNumber) => {
      const key = headers[colNumber];
      if (key) {
        raw[key] = cell.value;
      }
    });

    if (!Object.values(raw).some((value) => String(value ?? "").trim().length > 0)) {
      return;
    }

    const parsed = validateRow(raw);
    if (parsed.error || !parsed.row) {
      result.errors.push({
        row: rowNumber,
        programName: String(raw.program_name ?? ""),
        error: parsed.error ?? "Invalid row",
      });
      return;
    }

    result.rows.push(parsed.row);
  });

  return result;
}

export function parseCsvBuffer(buffer: Buffer): ImportResult {
  const csvText = buffer.toString("utf-8");
  const parsed = parseCsv(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
  });

  const result: ImportResult = { rows: [], errors: [] };
  (parsed.data as Record<string, unknown>[]).forEach((raw, index) => {
    const validated = validateRow(raw);
    if (validated.error || !validated.row) {
      result.errors.push({
        row: index + 2,
        programName: String(raw.program_name ?? ""),
        error: validated.error ?? "Invalid row",
      });
      return;
    }

    result.rows.push(validated.row);
  });

  return result;
}

export function buildProgramInsertValues(
  row: ImportRow,
  actorId: string,
  source: "manual" | "bulk_csv" | "bulk_excel",
  importBatchId?: string,
) {
  const id = randomUUID();
  const version = row.version ?? "1.0";

  return {
    id,
    programName: row.programName,
    stage: row.stage,
    stageOrder: getStageOrder(row.stage),
    machineId: row.machineId ?? null,
    machineType: row.machineType ?? null,
    partNo: row.partNo ?? null,
    version,
    workingProgram: row.workingProgram ?? null,
    updatedProgram: row.updatedProgram ?? null,
    description: row.description ?? null,
    qrPayload: buildQrPayload({
      id,
      programName: row.programName,
      stage: row.stage,
      version,
      machineId: row.machineId,
    }),
    status: "active" as const,
    importSource: source,
    importBatchId: importBatchId ?? null,
    createdBy: actorId,
    updatedBy: actorId,
  };
}
