import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rawPort = process.env.PORT || "5173";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// For Electron packaging, use relative paths (base: './')
// For web deployment, use BASE_PATH env var (default '/')
const isElectron = process.env.BUILD_TARGET === 'electron';
const basePath = isElectron ? './' : (process.env.BASE_PATH || "/");

const apiTarget = process.env.API_TARGET ?? process.env.VITE_API_URL ?? "http://localhost:3000";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, isElectron ? "dist" : "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
    headers: {
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' http://localhost:* https://localhost:* ws://localhost:*; frame-ancestors 'none'",
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: {
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' http://localhost:* https://localhost:* ws://localhost:*; frame-ancestors 'none'",
    },
  },
});