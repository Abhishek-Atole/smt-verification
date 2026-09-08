import rateLimit from "express-rate-limit";

// PRD §2.5 — scan write cap: 60 requests / minute / IP.
// Lives here (not inline in app.ts) so it can be applied both at the app
// level (/api/verification/scan) and at the route level for the live legacy
// scan route (POST /api/sessions/:id/scans) without a circular import — a
// bare `app.use("/api/sessions", scanLimiter)` prefix would wrongly throttle
// every other /api/sessions route (list/detail/create/patch) to 60/min.
export const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Scan rate limit exceeded." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Manual-override password gate (POST /api/auth/verify-override). Its OWN
// bucket rather than the shared login bucket: verify-override is a supervisor/
// QA password check that happens mid-shift, often right after several real
// logins on the same IP, and the shared 20/15-min login bucket would 429 a
// legitimate override as if the password were wrong. A dedicated per-IP cap
// still bounds bcrypt guessing (the password is checked against the active
// approver set) without making legit overrides collateral of login traffic.
export const overrideLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: "rate_limit_override", message: "Too many override attempts from this PC. Please wait 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});
