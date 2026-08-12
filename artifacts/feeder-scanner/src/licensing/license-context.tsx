import { createContext, useContext, type ReactNode } from 'react';
import { useLicense } from './use-license';
import type { LicenseInfo, LicenseCustomer, LicenseStatus } from './types';

interface LicenseContextValue {
  license: LicenseInfo;
  customer: LicenseCustomer;
  status: LicenseStatus;
  loading: boolean;
  activateLicense: (activationString: string) => Promise<string | null>;
  updateCustomer: (updates: Partial<LicenseCustomer>) => void;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

export function LicenseProvider({ children }: { children: ReactNode }) {
  const value = useLicense();
  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}

export function useLicenseContext(): LicenseContextValue {
  const ctx = useContext(LicenseContext);
  if (!ctx) throw new Error('useLicenseContext must be used within LicenseProvider');
  return ctx;
}
