// PRD §2.8 — CSRF defence via X-Requested-With header.
//
// The cookies are `SameSite=Strict` (set in routes/auth.ts), which is the
// primary defence. This header check is the second line: browsers cannot
// set custom request headers on cross-origin form submissions or `<img>` /
// `<link>` GETs without a CORS preflight, so a request with this header
// proves it originated from JS code running in an allowed origin.
//
// Safe methods (GET / HEAD / OPTIONS) bypass — a cross-origin GET cannot
// mutate state, and OPTIONS is the CORS preflight itself.
//
// PRD §2.8 has no exemption list; this fires on every state-changing
// `/api/*` request, login included. The two fetch wrappers under
// artifacts/feeder-scanner/src/ (lib/api.ts + admin/api.ts) attach the
// header on every request so legitimate UI traffic always passes.

import type { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const XHR_HEADER_VALUE = "XMLHttpRequest";

export function requireXmlHttpRequest(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.get("X-Requested-With") === XHR_HEADER_VALUE) {
    next();
    return;
  }
  res.status(403).json({
    error: "csrf_header_missing",
    message: "Request rejected: missing X-Requested-With header.",
  });
}
