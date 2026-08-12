import { copyFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

// Clean and create api-server folder
const apiServerDir = resolve('api-server');

if (existsSync(apiServerDir)) {
  rmSync(apiServerDir, { recursive: true, force: true });
}
mkdirSync(apiServerDir, { recursive: true });
mkdirSync(join(apiServerDir, 'node_modules'), { recursive: true });

// Copy dist files
copyFileSync(join('..', 'api-server', 'dist', 'index.mjs'), join(apiServerDir, 'index.mjs'));
copyFileSync(join('..', 'api-server', 'dist', 'index.mjs.map'), join(apiServerDir, 'index.mjs.map'));

// Create minimal package.json with only external deps needed at runtime
const runtimeDeps = {
  name: "api-server-runtime",
  private: true,
  type: "module",
  dependencies: {
    "pdfkit": "^0.13.0",
    "fontkit": "^2.0.2",
    "express": "^5",
    "cors": "^2",
    "helmet": "^8.1.0",
    "cookie-parser": "^1.4.7",
    "express-rate-limit": "^8.5.0",
    "bcryptjs": "^3.0.3",
    "jsonwebtoken": "^9.0.3",
    "pg": "^8.20.0",
    "pg-cursor": "^2.20.0",
    "drizzle-orm": "0.45.2",
    "pino": "^9",
    "pino-http": "^10",
    "pino-pretty": "^13",
    "qrcode": "^1.5.4",
    "exceljs": "^4.4.0",
    "zod": "^3.25.76",
    "fuse.js": "^7.0.0"
  }
};

writeFileSync(join(apiServerDir, 'package.json'), JSON.stringify(runtimeDeps, null, 2));

console.log('Created minimal api-server with runtime deps.');
console.log('Run: cd api-server && pnpm install --prod --ignore-scripts');