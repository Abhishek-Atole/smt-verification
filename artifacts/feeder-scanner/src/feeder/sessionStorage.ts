import type { FeederSession } from './types';

const SESSIONS_KEY = 'feeder_sessions';
const MAX_SESSIONS = 500;

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadSessions(): FeederSession[] {
  return loadJSON<FeederSession[]>(SESSIONS_KEY, []);
}

export function saveSessions(sessions: FeederSession[]): void {
  const trimmed = sessions.slice(-MAX_SESSIONS);
  saveJSON(SESSIONS_KEY, trimmed);
}

export function addSession(session: FeederSession): void {
  const existing = loadSessions();
  existing.push(session);
  saveSessions(existing);
}

export function updateSession(updated: FeederSession): void {
  const existing = loadSessions();
  const idx = existing.findIndex(s => s.id === updated.id);
  if (idx >= 0) {
    existing[idx] = updated;
  } else {
    existing.push(updated);
  }
  saveSessions(existing);
}

export function deleteSession(sessionId: string): void {
  const existing = loadSessions();
  saveSessions(existing.filter(s => s.id !== sessionId));
}

export function getSession(sessionId: string): FeederSession | undefined {
  return loadSessions().find(s => s.id === sessionId);
}

export function getActiveSession(): FeederSession | undefined {
  return loadSessions()
    .filter(s => s.status === 'running' || s.status === 'setup')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}
