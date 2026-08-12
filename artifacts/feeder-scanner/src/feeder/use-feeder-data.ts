import { useState, useCallback } from 'react';
import type { FeederSession } from './types';
import { loadSessions, addSession, updateSession, deleteSession } from './sessionStorage';

export function useFeederData() {
  const [sessions, setSessions] = useState<FeederSession[]>(() => loadSessions());

  const activeSession = sessions
    .filter(s => s.status === 'running' || s.status === 'setup')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;

  const refresh = useCallback(() => {
    setSessions(loadSessions());
  }, []);

  const createSession = useCallback((session: FeederSession) => {
    addSession(session);
    setSessions(loadSessions());
  }, []);

  const modifySession = useCallback((updated: FeederSession) => {
    updateSession(updated);
    setSessions(loadSessions());
  }, []);

  const removeSession = useCallback((sessionId: string) => {
    deleteSession(sessionId);
    setSessions(loadSessions());
  }, []);

  const getHistory = useCallback(() => {
    return sessions
      .filter(s => s.status === 'complete' || s.status === 'aborted')
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [sessions]);

  return {
    sessions,
    activeSession,
    refresh,
    createSession,
    modifySession,
    removeSession,
    getHistory,
  };
}
