import { z } from "zod";

/**
 * Auth Schema Validation
 * Validates all authentication-related request bodies
 */

// Hard cap to keep bcrypt.compare() and lookahead-heavy regex validation
// bounded. bcrypt truncates internally at 72 bytes; this cap is above that
// to cover unicode-expanding inputs but well below what an attacker would
// need to weaponize CPU cost.
const PASSWORD_MAX = 128;

/**
 * POST /api/auth/login - User login
 */
export const LoginSchema = z.object({
  username: z.string().min(1, "Username is required").max(255, "Username too long").trim(),
  password: z.string().min(1, "Password is required").max(PASSWORD_MAX, "Password too long"),
});

/**
 * POST /api/auth/logout - User logout
 * No body typically required
 */
export const LogoutSchema = z.object({});

/**
 * POST /api/auth/change-password - Change user password
 */
export const ChangePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Current password is required")
      .max(PASSWORD_MAX, "Password too long"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters")
      .max(PASSWORD_MAX, "Password too long")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
        "Password must contain uppercase, lowercase, number, and special character"
      ),
    confirmPassword: z
      .string()
      .min(1, "Confirm password is required")
      .max(PASSWORD_MAX, "Password too long"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from current password",
    path: ["newPassword"],
  });

/**
 * POST /api/auth/verify-override - Override verification (MANUAL mode)
 */
export const VerifyOverrideSchema = z.object({
  sessionId: z.number().int().positive("Session ID is required"),
  password: z.string().min(1, "Password is required").max(PASSWORD_MAX, "Password too long"),
  reason: z.string().max(1000, "Reason too long").optional(),
});

/**
 * POST /api/users - Create new user (admin endpoint)
 */
export const CreateUserSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(255, "Username too long")
    .trim(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(PASSWORD_MAX, "Password too long")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain uppercase, lowercase, and number"
    ),
  email: z.string().email("Invalid email address").max(255, "Email too long"),
  firstName: z.string().max(255).optional(),
  lastName: z.string().max(255).optional(),
  role: z.enum(["admin", "engineer", "qa", "operator"]),
});
