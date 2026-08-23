import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import compression from "compression";
import { existsSync } from "node:fs";
import path from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";
import { validateEnv } from "./lib/validateEnv";
import { requireXmlHttpRequest } from "./middleware/csrf";
import { scanLimiter } from "./middleware/rateLimiters";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import adminRouter from "./routes/admin";
import { deviceGuard } from "./middleware/deviceGuard";

validateEnv();

const app: Express = express();

// Module 10.2 / 10.5 — when the app runs behind a TLS-terminating reverse
// proxy, req.ip must reflect the real client (via X-Forwarded-For), not the
// proxy, or the device allow-list and audit IPs are meaningless. TRUST_PROXY:
//   unset/"false" → no proxy (req.ip is the socket IP; correct for direct LAN)
//   "true"        → trust all proxies
//   a number      → trust N hops
//   otherwise     → passed through to Express (IP/subnet/"loopback")
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy && trustProxy !== "false") {
  app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === "true" ? true : trustProxy);
}

const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// PRD §2.5 — per-IP cap. Per-username lockout (5/15min) is enforced
// inside the /auth/login handler via lib/lockoutStore.ts; this limiter
// is the outer safety net for scraper-style traffic.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "rate_limit_login", message: "Too many login attempts from this IP. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        workerSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// U10 — compress responses (gzip/brotli) for bandwidth efficiency
app.use(compression());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cookieParser());

// CORS only gates cross-origin browser callers. The LAN deployment serves
// the SPA and the API from the same Express origin, so the production
// browser→API path is same-origin and bypasses this list. The list still
// matters for: (a) dev (Vite on :5173 hitting the API on :PORT), (b)
// external tooling, (c) any non-renderer client.
const configuredOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
  .filter((origin) => origin !== "*");

const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : ["http://localhost:5173"];
const isDevelopment = process.env.NODE_ENV !== "production";
const localhostOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const localhostHostPattern = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  const requestHost = req.headers.host ?? "";

  cors({
    origin: (origin, callback) => {
      if (!requestOrigin) {
        // No Origin header = direct navigation, curl, health checks, or
        // same-origin requests. These cannot be cross-origin attacks (browsers
        // always send Origin on cross-origin requests), so always allow.
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(requestOrigin)) {
        callback(null, true);
        return;
      }

      if (isDevelopment) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked: ${requestOrigin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })(req, res, next);
});

// Custom CSP policy (managed separately from Helmet)
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", cspDirectives);
  next();
});

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// PRD §2.8 — every state-changing /api/* request must carry the
// X-Requested-With header. GET/HEAD/OPTIONS bypass. Mounted before rate
// limiters so a missing header trips this 403 before counting against the
// IP cap (and before any DB work).
app.use("/api/", requireXmlHttpRequest);

app.use("/api/auth/login", loginLimiter);
// verify-override is a password check too — same bucket as login so it can't
// be used as a side-channel to amortize bcrypt CPU cost past the login cap.
app.use("/api/auth/verify-override", loginLimiter);
// verify-password (step-up confirm for BOM writes) is also a bcrypt check — same bucket.
app.use("/api/auth/verify-password", loginLimiter);
app.use("/api/verification/scan", scanLimiter);
app.use("/api/", apiLimiter);

// Module 10.2 — per-request device/IP enforcement. Runs after the rate limiters
// (so flood traffic is capped first) but BEFORE any auth or route handler, so an
// unregistered/blocked device never reaches a credential check.
app.use("/api/", deviceGuard);

// Diagnostic endpoint - disabled in production
if (process.env.NODE_ENV !== "production") {
  app.get("/api/test-db", async (req, res) => {
    try {
      const dbUrl = process.env.DATABASE_URL || "NOT SET";
      const maskedUrl = dbUrl.replace(/:[^@]+@/, ":***@");
      const result = await db.execute(sql`SELECT 1 as test`);
      res.json({ status: "Database connection OK", databaseUrl: maskedUrl, result });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const dbUrl = process.env.DATABASE_URL || "NOT SET";
      const maskedUrl = dbUrl.replace(/:[^@]+@/, ":***@");
      res.status(500).json({ status: "Database connection FAILED", databaseUrl: maskedUrl, error: errorMessage });
    }
  });
}

// Handle common browser requests silently (no 404 logs)
app.use((req, res, next): void => {
  const url = req.url;
  // Silently handle these common requests
  if (
    url === "/favicon.ico" ||
    url === "/robots.txt" ||
    url.startsWith("/.well-known/") ||
    url.startsWith("/apple-touch-icon")
  ) {
    res.status(204).end();
    return;
  }
  next();
});

app.use("/api/admin", adminRouter);
app.use("/api", router);

// Serve the built renderer (LAN / single-server mode). The Express server
// runs both the API and the static SPA on the same origin so browser→API
// calls are same-origin (no CORS, no cookie-domain hoops) and clients on
// other LAN PCs only need one host:port.
//
// STATIC_ROOT overrides the default location for packagers that lay out
// the files differently. Default assumes the standard repo layout where
// api-server/ and feeder-scanner/ are siblings under artifacts/.
//
// SERVE_STATIC=false disables this entirely (Electron embedded mode, or
// an API-only deployment fronted by a separate reverse proxy).
const serveStatic = process.env.SERVE_STATIC !== "false";
const defaultStaticRoot = path.resolve(__dirname, "../../feeder-scanner/dist/public");
const staticRoot = process.env.STATIC_ROOT
  ? path.resolve(process.env.STATIC_ROOT)
  : defaultStaticRoot;

if (serveStatic && existsSync(path.join(staticRoot, "index.html"))) {
  logger.info({ staticRoot }, "Serving renderer static files");
  app.use(express.static(staticRoot, { index: false, fallthrough: true }));

  // SPA shell: any non-/api GET that didn't match a static file returns
  // the index, so React Router can resolve the route client-side.
  // Regex form (Express 5 dropped bare '*' as a path string).
  app.get(/^\/(?!api(\/|$)).*/, (req, res, next) => {
    if (req.method !== "GET") return next();
    res.setHeader("Content-Security-Policy", cspDirectives);
    res.sendFile(path.join(staticRoot, "index.html"));
  });
} else if (serveStatic) {
  logger.warn(
    { staticRoot },
    "Renderer static files not found at STATIC_ROOT; serving API only",
  );
}

// 404 handler with proper CSP — reachable for /api/* paths that no
// router matched, and for non-GET requests on non-/api paths.
app.use((req, res) => {
  res.setHeader("Content-Security-Policy", cspDirectives);
  res.status(404).json({ error: "Not Found" });
});

// Error handler with proper CSP
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    res.setHeader("Content-Security-Policy", cspDirectives);
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: "Internal Server Error" });
  },
);

export default app;
