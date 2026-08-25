import { useLicenseContext } from './license-context';
import { getExpiryWarning } from './licenseGuard';

export function ExpiringBanner() {
  const { license, status } = useLicenseContext();

  if (status !== 'active' || !license) return null;

  const { show, days } = getExpiryWarning(license);
  if (!show) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-1.5 text-center">
      <span className="text-xs font-mono text-amber-700 dark:text-amber-300">
        License expires in {days} day(s). Contact{' '}
        <span className="font-bold">Infizent Technology</span> to renew.
      </span>
    </div>
  );
}
