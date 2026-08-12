import { createContext, useContext, type ReactNode } from 'react';
import { useFeederData } from './use-feeder-data';
import type { FeederSession } from './types';

interface FeederSessionContextValue {
  sessions: FeederSession[];
  activeSession: FeederSession | null;
  refresh: () => void;
  createSession: (session: FeederSession) => void;
  modifySession: (updated: FeederSession) => void;
  removeSession: (sessionId: string) => void;
  getHistory: () => FeederSession[];
}

const FeederSessionContext = createContext<FeederSessionContextValue | null>(null);

export function FeederSessionProvider({ children }: { children: ReactNode }) {
  const value = useFeederData();
  return <FeederSessionContext.Provider value={value}>{children}</FeederSessionContext.Provider>;
}

export function useFeederSessionContext(): FeederSessionContextValue {
  const ctx = useContext(FeederSessionContext);
  if (!ctx) throw new Error('useFeederSessionContext must be used within FeederSessionProvider');
  return ctx;
}
