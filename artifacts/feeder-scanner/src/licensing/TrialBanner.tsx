import { useLicenseContext } from './license-context';

export function TrialBanner() {
  const { license, status } = useLicenseContext();

  if (status !== 'trial_active') return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-1.5 text-center">
      <span className="text-xs font-mono text-amber-700 dark:text-amber-300">
        TRIAL VERSION — {license.daysRemaining} day(s) remaining. Contact{' '}
        <span className="font-bold">Infizent Technology</span> to activate a full license.
      </span>
    </div>
  );
}
