import { useLicenseContext } from './license-context';

export function LicenseBadge() {
  const { license, status } = useLicenseContext();

  const label =
    status === 'expired' ? 'EXPIRED' :
    status === 'trial_active' ? `TRIAL ${license.daysRemaining}d` :
    status === 'active' ? 'Licensed' :
    status === 'invalid_schema' ? 'UPDATE REQUIRED' :
    status === 'wrong_machine' ? 'WRONG MACHINE' :
    status === 'invalid_signature' ? 'INVALID' :
    'No License';

  const colorClass =
    status === 'expired' ? 'bg-red-900/60 text-red-300 border-red-700' :
    status === 'trial_active' ? 'bg-amber-900/60 text-amber-300 border-amber-700' :
    status === 'active' ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700' :
    status === 'invalid_schema' ? 'bg-purple-900/60 text-purple-300 border-purple-700' :
    status === 'wrong_machine' ? 'bg-orange-900/60 text-orange-300 border-orange-700' :
    status === 'invalid_signature' ? 'bg-red-900/60 text-red-300 border-red-700' :
    'bg-slate-700 text-slate-400 border-slate-600';

  return (
    <span className={`inline-block text-[10px] font-mono font-bold px-1.5 py-0.5 border rounded ${colorClass}`}>
      {label}
    </span>
  );
}
