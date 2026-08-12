import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
const app = express();
app.use(pinoHttp({
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
}));
// CORS configuration - allow all origins for now
app.use(cors());
// Security headers (but allow Chrome DevTools probes in development)
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    // Allow resources in development: images, scripts, styles, connections
    res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' http: https: ws: wss:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self';");
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Root route - explains API structure
app.get("/", (req, res) => {
    res.json({
        name: "SMT Verification API",
        version: "1.0.0",
        message: "Backend API for SMT Feeder Scanning & Verification System",
        endpoints: {
            bom: "/api/bom - Bill of Materials management",
            sessions: "/api/sessions - Production session management",
            analytics: "/api/analytics - System analytics",
        },
        frontend: "http://localhost:5173 (when running React dev server)",
        docs: "Refer to backend routes for API documentation",
    });
});
// Diagnostic endpoint
app.get("/api/test-db", async (req, res) => {
    try {
        const dbUrl = process.env.DATABASE_URL || "NOT SET";
        const maskedUrl = dbUrl.replace(/:[^@]+@/, ":***@");
        const result = await db.execute(sql `SELECT 1 as test`);
        res.json({ status: "Database connection OK", databaseUrl: maskedUrl, result });
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const dbUrl = process.env.DATABASE_URL || "NOT SET";
        const maskedUrl = dbUrl.replace(/:[^@]+@/, ":***@");
        res.status(500).json({ status: "Database connection FAILED", databaseUrl: maskedUrl, error: errorMessage });
    }
});
// Handle common browser requests silently (no 404 logs)
app.use((req, res, next) => {
    const url = req.url;
    // Silently handle these common requests
    if (url === "/favicon.ico" ||
        url === "/robots.txt" ||
        url.startsWith("/.well-known/") ||
        url.startsWith("/apple-touch-icon")) {
        res.status(204).end();
        return;
    }
    next();
});
app.use("/api", router);
// 404 handler with proper CSP
app.use((req, res) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' http: https: ws: wss:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
    res.status(404).json({ error: "Not Found" });
});
// Error handler with proper CSP
app.use((err, req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' http: https: ws: wss:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: "Internal Server Error" });
});
export default app;
