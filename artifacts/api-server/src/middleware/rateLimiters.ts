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
