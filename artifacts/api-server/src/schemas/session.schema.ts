import { z } from "zod";

/**
 * Session Schema Validation
 * Validates all session-related request bodies
 */

/**
 * POST /api/sessions - Create new verification session
 */
export const CreateSessionSchema = z.object({
  bomId: z.number().int().positive("BOM ID must be a positive integer"),
  mode: z.enum(["AUTO", "MANUAL"]).optional().default("AUTO"),
  verificationMode: z.enum(["AUTO", "MANUAL"]).optional(),
  lineNumber: z.string().optional().nullable(),
  shift: z.string().optional().nullable(),
  operatorName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
});

/**
 * PATCH /api/sessions/:sessionId - Update session
 */
export const UpdateSessionSchema = z.object({
  endTime: z.union([z.string().datetime(), z.date()]).optional(),
  productionCount: z.number().int().nonnegative().optional(),
  status: z
    .enum([
      "active",
      "paused",
      "completed",
      "cancelled",
      "pending",
      "in_progress",
    ])
    .optional(),
  logoUrl: z.string().url().optional().nullable(),
  verificationMode: z.enum(["AUTO", "MANUAL"]).optional(),
});

/**
 * POST /api/verification/sessions - Create verification session
 */
export const CreateVerificationSessionSchema = z.object({
  bomId: z.number().int().positive("BOM ID is required"),
  mode: z.enum(["AUTO", "MANUAL"]).default("AUTO"),
  verificationMode: z.enum(["AUTO", "MANUAL"]).optional(),
  lineNumber: z.string().optional().nullable(),
  shift: z.string().optional().nullable(),
  operatorName: z.string().optional().nullable(),
  productionCount: z.number().int().nonnegative().optional().default(0),
});

/**
 * POST /api/verification/sessions/:sessionId/reset - Reset session
 */
export const ResetSessionSchema = z.object({
  // Body is optional for reset
  reason: z.string().optional(),
});
