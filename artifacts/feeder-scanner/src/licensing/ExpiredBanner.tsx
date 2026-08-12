import { useLicenseContext } from './license-context';

export function ExpiredBanner() {
  const { license, status } = useLicenseContext();

  if (status !== 'expired') return null;

  const expiredDate = new Date(license.expiresAt).toLocaleDateString('en-GB');

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80">
      <div className="bg-white dark:bg-slate-900 border-2 border-red-500 rounded-lg p-8 max-w-md text-center shadow-2xl">
        <div className="text-red-500 text-5xl font-black mb-4">EXPIRED</div>
        <h2 className="text-xl font-bold mb-2">License Expired</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Your license expired on <strong>{expiredDate}</strong>.
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          Contact <strong>Infizent Technology</strong> to renew your license.
        </p>
        <p className="text-xs text-muted-foreground">
          infizent.io · info@infizent.io
        </p>
      </div>
    </div>
  );
}
