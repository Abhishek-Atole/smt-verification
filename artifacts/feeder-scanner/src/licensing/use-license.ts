import { useState, useCallback, useEffect } from 'react';
import type { LicenseInfo, LicenseCustomer, LicenseStatus } from './types';
import { TRIAL_FEATURES } from './types';
import { generateUUID, computeSignature, validateLicense } from './licenseGuard';
import { getMachineId } from './machineId';
import { BRAND } from '../brand';

const LICENSE_KEY = 'lic_info';
const CUSTOMER_KEY = 'lic_customer';
const SCHEMA_VERSION = 2;

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

function computeDaysRemaining(expiresAt: string): number {
  const now = new Date();
  const exp = new Date(expiresAt);
  const diff = exp.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

async function getOrCreateTrialMarker(): Promise<{ firstActivated: string; machineId: string } | null> {
  const fileData = await window.electronAPI?.trialRead?.();
  if (fileData) {
    try { return JSON.parse(fileData); } catch {}
  }
  const regData = await window.electronAPI?.trialReadRegistry?.();
  if (regData) {
    try { return JSON.parse(regData); } catch {}
  }
  return null;
}

async function writeTrialMarker(machineId: string): Promise<void> {
  const marker = JSON.stringify({
    firstActivated: new Date().toISOString(),
    machineId,
  });
  await window.electronAPI?.trialWrite?.(marker);
  await window.electronAPI?.trialWriteRegistry?.(marker);
}

async function generateTrialLicense(): Promise<LicenseInfo> {
  const marker = await getOrCreateTrialMarker();
  const activatedAt = marker ? marker.firstActivated : new Date().toISOString();
  const firstMachineId = marker ? marker.machineId : await getMachineId();
  const now = new Date(activatedAt);
  const expiry = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  if (!marker) {
    await writeTrialMarker(firstMachineId);
  }

  const partial: Omit<LicenseInfo, 'signature'> = {
    licenseKey: generateUUID(),
    licenseType: 'trial',
    status: 'trial_active',
    customerId: 'TRIAL',
    customerName: 'Trial User',
    activatedAt,
    expiresAt: expiry.toISOString(),
    daysRemaining: computeDaysRemaining(expiry.toISOString()),
    features: TRIAL_FEATURES,
    issuedBy: BRAND.company,
    issuedTo: 'Trial User',
    machineId: firstMachineId,
    schemaVersion: SCHEMA_VERSION,
  };

  return { ...partial, signature: await computeSignature(partial) };
}

export function useLicense() {
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [status, setStatus] = useState<LicenseStatus>('not_activated');
  const [loading, setLoading] = useState(true);

  const [customer, setCustomer] = useState<LicenseCustomer>(() =>
    loadJSON<LicenseCustomer>(CUSTOMER_KEY, {
      id: 'TRIAL',
      name: 'Trial User',
    })
  );

  useEffect(() => {
    (async () => {
      const stored = loadJSON<LicenseInfo | null>(LICENSE_KEY, null);
      if (!stored) {
        const trial = await generateTrialLicense();
        saveJSON(LICENSE_KEY, trial);
        setLicense(trial);
        setStatus(await validateLicense(trial));
      } else {
        stored.daysRemaining = computeDaysRemaining(stored.expiresAt);
        setLicense(stored);
        setStatus(await validateLicense(stored));
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (license) saveJSON(LICENSE_KEY, license);
  }, [license]);

  useEffect(() => {
    saveJSON(CUSTOMER_KEY, customer);
  }, [customer]);

  const activateLicense = useCallback(
    async (activationString: string) => {
      try {
        const parsed: LicenseInfo = JSON.parse(atob(activationString));
        parsed.daysRemaining = computeDaysRemaining(parsed.expiresAt);
        const result = await validateLicense(parsed);
        if (result === 'active') {
          setLicense(parsed);
          setStatus('active');
          setCustomer({
            id: parsed.customerId,
            name: parsed.customerName,
          });
          return null;
        }
        return result;
      } catch {
        return 'invalid_signature';
      }
    },
    []
  );

  const updateCustomer = useCallback((updates: Partial<LicenseCustomer>) => {
    setCustomer((prev) => ({ ...prev, ...updates }));
  }, []);

  return {
    license: license!,
    customer,
    status,
    loading,
    activateLicense,
    updateCustomer,
  };
}
