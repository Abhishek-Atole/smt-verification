import { z } from "zod";

/**
 * Scan Schema Validation
 * Validates all scan and verification-related request bodies
 */

/**
 * POST /api/verification/scan - Record a feeder scan
 */
export const CreateScanSchema = z.object({
  sessionId: z.number().int().positive("Session ID is required"),
  feederNumber: z.string().min(1, "Feeder number is required"),
  scannedValue: z.string().min(1, "Scanned value is required"),
  lotCode: z.string().optional().nullable(),
  dateCode: z.string().optional().nullable(),
  reelId: z.string().optional().nullable(),
  quantity: z.number().int().nonnegative().optional(),
  status: z.enum(["pass", "fail", "alternate", "mismatch"]).optional(),
  remarks: z.string().optional().nullable(),
});

/**
 * POST /api/verification/check-feeder - Check feeder configuration
 */
export const CheckFeederSchema = z.object({
  feederNumber: z.string().min(1, "Feeder number is required"),
  bomId: z.number().int().positive("BOM ID is required").optional(),
});

/**
 * POST /api/verification/validate-mpn - Validate MPN against BOM
 */
export const ValidateMpnSchema = z.object({
  scannedMpn: z.string().min(1, "Scanned MPN is required"),
  bomId: z.number().int().positive("BOM ID is required"),
  feederNumber: z.string().min(1, "Feeder number is required").optional(),
});

/**
 * POST /api/verification/save-scan - Save scan result with detailed data
 */
export const SaveScanSchema = z.object({
  sessionId: z.number().int().positive("Session ID is required"),
  feederNumber: z.string().min(1, "Feeder number is required"),
  bomItemId: z.number().int().positive("BOM item ID is required").optional(),
  scannedValue: z.string().min(1, "Scanned value is required"),
  lotCode: z.string().optional().nullable(),
  dateCode: z.string().optional().nullable(),
  reelId: z.string().optional().nullable(),
  status: z.enum(["pass", "fail", "alternate", "mismatch", "pending"]).optional(),
  verificationMode: z.enum(["AUTO", "MANUAL"]).optional(),
  remarks: z.string().optional().nullable(),
  quantity: z.number().int().nonnegative().optional(),
  matchedField: z
    .enum(["internalPartNumber", "mpn1", "mpn2", "mpn3", "mpn4", "mpn5", "mpn6", "mpn7", "mpn8", "alternate"])
    .optional(),
  matchedMake: z.string().optional().nullable(),
});

/**
 * POST /api/verification/sessions/:sessionId/reset - Reset all scans in session
 */
export const ResetSessionScansSchema = z.object({
  reason: z.string().optional(),
});
