import { z } from "zod";

/**
 * Report Schema Validation
 * Validates all report and export-related request bodies
 */

/**
 * POST /api/reports/generate - Generate report
 */
export const GenerateReportSchema = z.object({
  sessionId: z.number().int().positive("Session ID is required"),
  format: z.enum(["pdf", "xlsx", "csv"]).default("pdf"),
  includeMetadata: z.boolean().optional().default(true),
  logoUrl: z.string().url().optional().nullable(),
});

/**
 * POST /api/reports/export - Export session report
 */
export const ExportReportSchema = z.object({
  sessionId: z.number().int().positive("Session ID is required"),
  format: z.enum(["pdf", "xlsx", "csv"]).default("pdf"),
  fileName: z.string().optional(),
  includeAudit: z.boolean().optional().default(false),
});

/**
 * POST /api/audit/log - Record audit log entry
 */
export const AuditLogSchema = z.object({
  entityType: z.string().min(1, "Entity type is required"),
  entityId: z.union([z.number(), z.string()]),
  action: z.string().min(1, "Action is required"),
  changedBy: z.string().min(1, "Changed by is required"),
  oldValue: z.any().optional().nullable(),
  newValue: z.any().optional().nullable(),
  description: z.string().optional(),
});

/**
 * POST /api/trash/:type/:id/recover - Recover item from trash
 * No body required, parameters in URL
 */
export const RecoverTrashItemSchema = z.object({});

/**
 * POST /api/trash/empty - Empty entire trash
 */
export const EmptyTrashSchema = z.object({
  confirmPassword: z.string().min(1, "Password confirmation required").optional(),
});

/**
 * GET /api/analytics/dashboard - Get dashboard analytics
 * No body, but schema for consistency
 */
export const AnalyticsQuerySchema = z.object({
  startDate: z.union([z.string().datetime(), z.date()]).optional(),
  endDate: z.union([z.string().datetime(), z.date()]).optional(),
  bomId: z.number().int().positive().optional(),
  sessionId: z.number().int().positive().optional(),
});

/**
 * POST /api/components - Create component
 */
export const CreateComponentSchema = z.object({
  mpn: z.string().min(1, "MPN is required"),
  description: z.string().optional(),
  manufacturer: z.string().optional(),
  category: z.string().optional(),
});

/**
 * POST /api/components/:id/alternates - Add alternate component
 */
export const AddAlternateComponentSchema = z.object({
  alternateMpn: z.string().min(1, "Alternate MPN is required"),
  reason: z.string().optional(),
  approvedBy: z.string().optional(),
});
