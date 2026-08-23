import type { NextFunction, Request, Response } from "express";
import { getDevices, getActiveDevices, getSecuritySettings } from "../lib/deviceStore";
import { matchesIp, normalizeIp, isLoopback } from "../lib/ipMatch";
import { auditLog } from "../lib/auditLogger";
import { logger } from "../lib/logger";
import type { DeviceType } from "@workspace/db/schema";

// Module 10.2 — per-request device/IP enforcement. Every /api request is
// checked against the registered device allow-list BEFORE authentication:
//   - loopback (the host itself) is always trusted → device_type "server"
//   - if NO devices are registered yet, run in bootstrap allow-all mode so the
//     first admin can log in and register devices (logged, not silent)
//   - otherwise the request IP must match an ACTIVE device, else 403 + a
//     SECURITY_DEVICE_BLOCKED audit event
//   - maintenance/lockdown mode (10.3) blocks every non-admin device
//
// The matched device_type is attached to the request so the login handlers can
// enforce the role↔device binding (10.4).

export interface DeviceRequest extends Request {
  deviceType?: DeviceType;
  deviceId?: string;
}

let bootstrapWarnedAt = 0;
function warnBootstrapOccasionally(): void {
  const now = Date.now();
  if (now - bootstrapWarnedAt > 60_000) {
    bootstrapWarnedAt = now;
    logger.warn(
      "Device allow-list is empty — running in bootstrap allow-all mode. Register devices in the admin Control Panel to enforce IP restriction (Module 10.2).",
    );
  }
}

export async function deviceGuard(req: DeviceRequest, res: Response, next: NextFunction): Promise<void> {
  // CORS preflight carries no credentials and cannot be an attack vector.
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  const ip = normalizeIp(req.ip ?? "");

  // The host administering itself over loopback is always allowed.
  if (isLoopback(ip)) {
    req.deviceType = "server";
    next();
    return;
  }

  const allDevices = await getDevices();
  if (allDevices.length === 0) {
    warnBootstrapOccasionally();
    next();
    return;
  }

  const active = await getActiveDevices();
  const matched = active.find((d) => matchesIp(ip, d.allowedIp));

  if (!matched) {
    // Distinguish "known but blocked/pending" from "unknown" for the audit trail.
    const known = allDevices.find((d) => matchesIp(ip, d.allowedIp));
    const reason = known ? `device_${known.status}` : "unregistered_device";
    void auditLog({
      event: "SECURITY_DEVICE_BLOCKED",
      detail: `ip=${ip} reason=${reason} method=${req.method} path=${req.path}`,
      ip,
    });
    res.status(403).json({
      error: "device_not_allowed",
      message: "This device is not permitted to access the system. Contact your administrator.",
    });
    return;
  }

  // Module 10.3 — maintenance/lockdown blocks all non-admin devices.
  const settings = await getSecuritySettings();
  if (settings.maintenanceMode && matched.deviceType !== "admin_device") {
    void auditLog({
      event: "SECURITY_MAINTENANCE_BLOCK",
      detail: `ip=${ip} device_type=${matched.deviceType} path=${req.path}`,
      ip,
    });
    res.status(503).json({
      error: "maintenance_mode",
      message: "The system is in maintenance mode. Please try again later.",
    });
    return;
  }

  req.deviceType = matched.deviceType;
  req.deviceId = matched.id;
  next();
}
