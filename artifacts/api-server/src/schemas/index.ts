import { type Request, type Response, type NextFunction } from "express";
import { type ZodSchema } from "zod";

/**
 * Generic validation middleware factory
 * Validates request body against a Zod schema
 * Returns 400 with detailed error information if validation fails
 * Otherwise, replaces req.body with validated data and calls next()
 */
export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        details: result.error.flatten(),
      });
      return;
    }
    
    // Replace request body with validated data
    req.body = result.data;
    next();
  };
};
