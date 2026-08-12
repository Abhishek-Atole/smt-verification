import type { ReactNode } from 'react';
import { useLicenseContext } from './license-context';
import type { LicenseFeatures } from './types';

interface Props {
  feature: keyof LicenseFeatures;
  children: ReactNode;
  fallback?: ReactNode;
}

export function LicenseGuard({ feature, children, fallback }: Props) {
  const { license, status } = useLicenseContext();

  if (status === 'expired' || status === 'invalid_signature' || status === 'wrong_machine') {
    return <>{fallback ?? null}</>;
  }

  if (!license.features[feature]) {
    return <>{fallback ?? null}</>;
  }

  return <>{children}</>;
}
