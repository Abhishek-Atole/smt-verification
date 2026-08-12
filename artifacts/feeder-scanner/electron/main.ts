import { app, BrowserWindow, dialog, shell, ipcMain } from 'electron';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { machineIdSync } from 'node-machine-id';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { isDev } from './util.js';

let mainWindow: BrowserWindow | null = null;
let apiServerProcess: ChildProcess | null = null;

const REQUIRED_ENV_VARS = ['JWT_SECRET', 'DATABASE_URL'] as const;

function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length === 0) return;

  const message = [
    `Cannot start ${app.getName()}.`,
    '',
    `Missing required environment variable(s): ${missing.join(', ')}.`,
    '',
    'Set these in the system environment (or a .env file loaded by the launcher) before launching the app.',
    'Generate JWT_SECRET with: openssl rand -hex 32',
  ].join('\n');

  dialog.showErrorBox('Configuration error', message);
  app.exit(1);
  process.exit(1);
}

function getApiServerPath(): string {
  if (isDev) {
    return join(__dirname, '../../api-server/dist/index.mjs');
  }
  // When asarUnpack is used, files are extracted to app.asar.unpacked/
  const unpackedPath = join(process.resourcesPath, 'app.asar.unpacked', 'api-server', 'index.mjs');
  const packedPath = join(process.resourcesPath, 'api-server', 'index.mjs');
  
  // Check if unpacked version exists (preferred for execution)
  if (existsSync(unpackedPath)) {
    return unpackedPath;
  }
  return packedPath;
}

function getApiServerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.NODE_ENV = isDev ? 'development' : 'production';
  env.PORT = '3001';
  env.ALLOWED_ORIGINS = env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173';
  return env;
}

function startApiServer(): void {
  const serverPath = getApiServerPath();
  const env = getApiServerEnv();

  console.log('[Electron] Starting API server:', serverPath);
  console.log('[Electron] NODE_ENV:', env.NODE_ENV);

  apiServerProcess = spawn('node', [serverPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  apiServerProcess.stdout?.on('data', (data) => {
    console.log('[API Server]', data.toString().trim());
  });

  apiServerProcess.stderr?.on('data', (data) => {
    console.error('[API Server ERROR]', data.toString().trim());
  });

  apiServerProcess.on('close', (code) => {
    console.log('[Electron] API server exited with code:', code);
    apiServerProcess = null;
  });

  apiServerProcess.on('error', (err) => {
    console.error('[Electron] Failed to start API server:', err);
  });
}

function stopApiServer(): void {
  if (apiServerProcess) {
    console.log('[Electron] Stopping API server...');
    apiServerProcess.kill('SIGTERM');
    apiServerProcess = null;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    show: false,
    autoHideMenuBar: true,
    title: 'Infizent Technology',
    icon: join(__dirname, '../build/icon.ico'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  assertRequiredEnv();

  if (!isDev) {
    startApiServer();
    // Wait a bit for API server to start before loading the window
    setTimeout(createWindow, 2000);
  } else {
    createWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopApiServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopApiServer();
});

// ── Machine ID (stable hardware-bound) ─────────────────────────────────
function getStableMachineId(): string {
  const raw = machineIdSync(true);
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

ipcMain.handle('get-machine-id', () => getStableMachineId());

// ── Trial tamper resistance: userData file + Windows Registry ──────────
const REGISTRY_KEY = 'HKCU\\Software\\InfizenTechnology\\Suite';

ipcMain.handle('trial:read', () => {
  const filePath = join(app.getPath('userData'), 'trial.dat');
  try {
    return existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  } catch { return null; }
});

ipcMain.handle('trial:write', (_event, data: string) => {
  const filePath = join(app.getPath('userData'), 'trial.dat');
  try {
    fs.writeFileSync(filePath, data, 'utf8');
    return true;
  } catch { return false; }
});

ipcMain.handle('trial:read-registry', () => {
  if (process.platform !== 'win32') return null;
  try {
    const result = execSync(
      `reg query "${REGISTRY_KEY}" /v TrialActivated 2>nul`,
      { encoding: 'utf8' }
    );
    const match = result.match(/TrialActivated\s+REG_SZ\s+(.+)/);
    return match ? match[1].trim() : null;
  } catch { return null; }
});

ipcMain.handle('trial:write-registry', (_event, data: string) => {
  if (process.platform !== 'win32') return false;
  try {
    execSync(`reg add "${REGISTRY_KEY}" /v TrialActivated /t REG_SZ /d "${data}" /f`);
    return true;
  } catch { return false; }
});

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-app-name', () => app.getName());
ipcMain.handle('get-api-status', () => {
  return { running: apiServerProcess !== null };
});