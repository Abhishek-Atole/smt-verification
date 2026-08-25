import type { LicenseInfo, LicenseStatus } from './types';
import { LEGACY_GRACE_PERIOD_DAYS } from './types';
import { getMachineId } from './machineId';

const SCHEMA_VERSION = 2;

function buildPayload(
  info: Omit<LicenseInfo, 'signature'> | Partial<LicenseInfo>
): string {
  return [
    info.licenseKey,
    info.licenseType,
    info.customerId,
    info.activatedAt,
    info.expiresAt,
    info.issuedBy,
    info.machineId || '',
    info.schemaVersion ?? SCHEMA_VERSION,
  ].join('|');
}

export async function computeLicenseSignature(
  info: Omit<LicenseInfo, 'signature'> | Partial<LicenseInfo>,
  hmacKey?: string
): Promise<string> {
  const key = hmacKey || import.meta.env.VITE_LICENSE_HMAC_KEY || '';
  if (!key) {
    throw new Error('VITE_LICENSE_HMAC_KEY is not set');
  }

  const payload = buildPayload(info);
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const msgData = encoder.encode(payload);

  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function validateLicense(info: LicenseInfo): Promise<LicenseStatus> {
  if (!info.schemaVersion || info.schemaVersion < SCHEMA_VERSION) {
    const activated = new Date(info.activatedAt);
    const graceEnd = new Date(activated.getTime() + LEGACY_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    if (new Date() > graceEnd) {
      return 'invalid_schema';
    }
    return info.status === 'trial_active' ? 'trial_active' : info.status === 'active' ? 'active' : 'not_activated';
  }

  const currentMachineId = await getMachineId();
  if (info.machineId && info.machineId !== currentMachineId) {
    return 'wrong_machine';
  }

  if (new Date(info.expiresAt) < new Date()) {
    return 'expired';
  }

  const hmacKey = import.meta.env.VITE_LICENSE_HMAC_KEY;
  if (!hmacKey) {
    console.error('[License] VITE_LICENSE_HMAC_KEY not set — cannot validate license');
    return 'invalid_signature';
  }

  const expectedSig = await computeLicenseSignature(info, hmacKey);
  if (info.signature !== expectedSig) {
    return 'invalid_signature';
  }

  if (info.status === 'trial_active') return 'trial_active';
  if (info.status === 'active') return 'active';
  return 'not_activated';
}

export function generateUUID(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  arr[6] = (arr[6] & 0x0f) | 0x40;
  arr[8] = (arr[8] & 0x3f) | 0x80;
  return Array.from(arr)
    .map((b, i) =>
      [4, 6, 8, 10].includes(i) ? '-' + b.toString(16).padStart(2, '0') : b.toString(16).padStart(2, '0')
    )
    .join('');
}

export async function computeSignature(info: Omit<LicenseInfo, 'signature'> | Partial<LicenseInfo>): Promise<string> {
  return computeLicenseSignature(info);
}

/**
 * Display-only expiry warning for paid (active) licenses. Does NOT affect
 * validation or when the license expires — it only drives the banner/badge.
 * Window: total validity > 15 days → warn at ≤10 days left; else ≤3 days left
 * (so a short license doesn't warn from almost day one).
 */
export function getExpiryWarning(info: LicenseInfo): { show: boolean; days: number } {
  const days = info.daysRemaining;
  const totalValidityDays = Math.ceil(
    (new Date(info.expiresAt).getTime() - new Date(info.activatedAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  const threshold = totalValidityDays > 15 ? 10 : 3;
  return { show: days > 0 && days <= threshold, days };
}
