import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// PRD §2.8 — backend CSRF middleware (artifacts/api-server/src/middleware/csrf.ts)
// rejects any state-changing /api/* request without `X-Requested-With:
// XMLHttpRequest`. The central fetch wrappers in src/lib/api.ts and
// src/admin/api.ts set it, but the codebase has 20+ pages that call
// `fetch()` raw — patching window.fetch here adds the header at the
// network layer so no caller can forget and any future raw fetch is
// covered automatically.
const originalFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has("X-Requested-With")) headers.set("X-Requested-With", "XMLHttpRequest");
  return originalFetch(input, { ...init, headers });
};

// Resolve API base URL with safe fallbacks:
// 1) explicit env var (VITE_API_BASE_URL)
// 2) ngrok same host
// 3) local dev default to same origin (empty string uses Vite /api proxy)
const envApiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  "";

let apiBaseUrl = envApiBaseUrl;

if (!apiBaseUrl) {
  const currentUrl = window.location.href;
  const current = new URL(currentUrl);

  if (currentUrl.includes("ngrok")) {
    apiBaseUrl = `${current.protocol}//${current.host}`;
  } else if ((current.hostname === "localhost" || current.hostname === "127.0.0.1") && import.meta.env.PROD) {
    // Only use direct API_TARGET in production mode
    apiBaseUrl = "";
  }
  // For dev (non-PROD), leave apiBaseUrl empty to use Vite proxy
}

// Always set the base URL explicitly. Passing `null` clears any previously
// configured base and ensures local dev uses the Vite proxy (same-origin).
setBaseUrl(apiBaseUrl || null);

createRoot(document.getElementById("root")!).render(<App />);
