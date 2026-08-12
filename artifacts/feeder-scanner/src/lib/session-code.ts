import { format } from "date-fns";

export function formatSmtSessionCode(sourceDate: string | Date | null | undefined, sequence: string | number | null | undefined): string {
  if (typeof sequence === "string") {
    const trimmed = sequence.trim();
    if (trimmed.startsWith("SMT_")) {
      return trimmed;
    }
  }

  const numericSequence = typeof sequence === "number"
    ? sequence
    : Number(String(sequence ?? "").replace(/\D/g, ""));

  if (!Number.isFinite(numericSequence) || numericSequence <= 0) {
    return String(sequence ?? "").trim() || "—";
  }

  const date = sourceDate ? new Date(sourceDate) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  return `SMT_${format(safeDate, "yyyyMMdd")}_${String(Math.trunc(numericSequence)).padStart(6, "0")}`;
}