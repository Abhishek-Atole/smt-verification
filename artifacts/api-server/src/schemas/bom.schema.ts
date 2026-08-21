import { z } from "zod";

/**
 * BOM Schema Validation
 * Validates all BOM-related request bodies
 */

/**
 * POST /api/bom - Create new BOM
 */
export const CreateBomSchema = z.object({
  name: z.string().min(1, "BOM name is required").trim(),
  description: z.string().optional().nullable(),
  // Module 5: required cavity count, min 1.
  cavityCount: z.number().int().min(1, "cavityCount must be an integer >= 1"),
});

/**
 * PATCH /api/bom/:bomId - Update BOM metadata
 */
export const UpdateBomSchema = z.object({
  name: z.string().min(1).trim().optional(),
  description: z.string().optional().nullable(),
  cavityCount: z.number().int().min(1).optional(),
});

/**
 * POST /api/bom/:bomId/items - Add BOM item
 */
export const CreateBomItemSchema = z.object({
  feederNumber: z.string().min(1, "Feeder number is required"),
  partNumber: z.string().optional().nullable(),
  internalPartNumber: z.string().optional().nullable(),
  mpn1: z.string().optional().nullable(),
  mpn2: z.string().optional().nullable(),
  mpn3: z.string().optional().nullable(),
  mpn4: z.string().optional().nullable(),
  mpn5: z.string().optional().nullable(),
  mpn6: z.string().optional().nullable(),
  mpn7: z.string().optional().nullable(),
  mpn8: z.string().optional().nullable(),
  make1: z.string().optional().nullable(),
  make2: z.string().optional().nullable(),
  make3: z.string().optional().nullable(),
  make4: z.string().optional().nullable(),
  make5: z.string().optional().nullable(),
  make6: z.string().optional().nullable(),
  make7: z.string().optional().nullable(),
  make8: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  quantity: z.union([z.number().positive(), z.string()]).optional(),
  itemName: z.string().optional().nullable(),
  srNo: z.string().optional().nullable(),
  rdeplyPartNo: z.string().optional().nullable(),
  referenceDesignator: z.string().optional().nullable(),
  packageDescription: z.string().optional().nullable(),
  dnpParts: z.string().optional().nullable(),
  supplier1: z.string().optional().nullable(),
  partNo1: z.string().optional().nullable(),
  supplier2: z.string().optional().nullable(),
  partNo2: z.string().optional().nullable(),
  supplier3: z.string().optional().nullable(),
  partNo3: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  values: z.string().optional().nullable(),
});

/**
 * POST /api/bom/:bomId/import - Import BOM from CSV
 */
export const ImportBomSchema = z.object({
  csv: z.string().min(1, "CSV content is required"),
  // Either CSV string or JSON array of items
  items: z
    .array(
      z.object({
        feederNumber: z.string().min(1),
        partNumber: z.string().optional(),
        internalPartNumber: z.string().optional(),
        mpn1: z.string().optional(),
        mpn2: z.string().optional(),
        mpn3: z.string().optional(),
        mpn4: z.string().optional(),
        mpn5: z.string().optional(),
        mpn6: z.string().optional(),
        mpn7: z.string().optional(),
        mpn8: z.string().optional(),
        make1: z.string().optional(),
        make2: z.string().optional(),
        make3: z.string().optional(),
        make4: z.string().optional(),
        make5: z.string().optional(),
        make6: z.string().optional(),
        make7: z.string().optional(),
        make8: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        quantity: z.union([z.number(), z.string()]).optional(),
      })
    )
    .optional(),
});

/**
 * PATCH /api/bom/:bomId/delete - Soft delete BOM
 * No body required, but schema allows empty object
 */
export const DeleteBomSchema = z.object({});

/**
 * PATCH /api/bom/:bomId/restore - Restore BOM from trash
 * No body required
 */
export const RestoreBomSchema = z.object({});

/**
 * POST /api/bom-items - Create new BOM item
 */
export const CreateBomItemDetailedSchema = z.object({
  bomId: z.number().int().positive("BOM ID must be a positive integer"),
  feederNumber: z.string().min(1, "Feeder number is required"),
  partNumber: z.string().optional().nullable(),
  internalPartNumber: z.string().optional().nullable(),
  mpn1: z.string().optional().nullable(),
  mpn2: z.string().optional().nullable(),
  mpn3: z.string().optional().nullable(),
  mpn4: z.string().optional().nullable(),
  mpn5: z.string().optional().nullable(),
  mpn6: z.string().optional().nullable(),
  mpn7: z.string().optional().nullable(),
  mpn8: z.string().optional().nullable(),
  make1: z.string().optional().nullable(),
  make2: z.string().optional().nullable(),
  make3: z.string().optional().nullable(),
  make4: z.string().optional().nullable(),
  make5: z.string().optional().nullable(),
  make6: z.string().optional().nullable(),
  make7: z.string().optional().nullable(),
  make8: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  quantity: z.union([z.number().positive(), z.string()]).optional(),
  itemName: z.string().optional().nullable(),
});

/**
 * PATCH /api/bom-items/:id - Update BOM item
 */
export const UpdateBomItemSchema = z.object({
  feederNumber: z.string().min(1).optional(),
  partNumber: z.string().optional().nullable(),
  internalPartNumber: z.string().optional().nullable(),
  mpn1: z.string().optional().nullable(),
  mpn2: z.string().optional().nullable(),
  mpn3: z.string().optional().nullable(),
  mpn4: z.string().optional().nullable(),
  mpn5: z.string().optional().nullable(),
  mpn6: z.string().optional().nullable(),
  mpn7: z.string().optional().nullable(),
  mpn8: z.string().optional().nullable(),
  make1: z.string().optional().nullable(),
  make2: z.string().optional().nullable(),
  make3: z.string().optional().nullable(),
  make4: z.string().optional().nullable(),
  make5: z.string().optional().nullable(),
  make6: z.string().optional().nullable(),
  make7: z.string().optional().nullable(),
  make8: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  quantity: z.union([z.number().positive(), z.string()]).optional().nullable(),
  itemName: z.string().optional().nullable(),
});

/**
 * PATCH /api/bom-items/:id/restore - Restore BOM item from trash
 */
export const RestoreBomItemSchema = z.object({});
