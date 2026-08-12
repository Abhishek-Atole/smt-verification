import { useState, useEffect } from 'react';
import { useLicenseContext } from '../../licensing/license-context';
import { getMachineId } from '../../licensing/machineId';
import { BRAND } from '../../brand';

export default function LicensePage() {
  const { license, customer, status, activateLicense, updateCustomer } = useLicenseContext();
  const [activationStr, setActivationStr] = useState('');
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [machineId, setMachineId] = useState<string>('Loading...');

  useEffect(() => {
    getMachineId().then(setMachineId);
  }, []);

  const handleActivate = async () => {
    if (!activationStr.trim()) {
      setMsgType('error');
      setMsg('Paste the activation string from your license issuer.');
      return;
    }
    setMsg('');
    const result = await activateLicense(activationStr.trim());
    if (result === null) {
      setMsgType('success');
      setMsg('License activated successfully.');
      setActivationStr('');
    } else {
      setMsgType('error');
      const messages: Record<string, string> = {
        wrong_machine: 'This license was issued for a different machine. Contact support for a license tied to this machine ID.',
        expired: 'This license has already expired.',
        invalid_signature: 'Invalid or tampered activation string. Please verify and try again.',
        invalid_schema: 'This license format is outdated. Please contact Infizent Technology for a new activation key.',
      };
      setMsg(messages[result] || `Activation failed: ${result}`);
    }
  };

  const statusLabel =
    status === 'expired' ? 'Expired' :
    status === 'trial_active' ? 'Active (trial)' :
    status === 'active' ? 'Active' :
    status === 'invalid_schema' ? 'Update Required' :
    status === 'wrong_machine' ? 'Wrong Machine' :
    status === 'invalid_signature' ? 'Invalid License' :
    'Not Activated';

  const statusColor =
    status === 'expired' ? 'text-red-500' :
    status === 'trial_active' ? 'text-amber-500' :
    status === 'active' ? 'text-emerald-500' :
    status === 'invalid_schema' ? 'text-purple-500' :
    status === 'wrong_machine' ? 'text-orange-500' :
    status === 'invalid_signature' ? 'text-red-500' :
    'text-slate-400';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">License Management</h1>
        <p className="text-sm text-muted-foreground">{BRAND.company} — License Control</p>
      </div>

      {/* Machine ID */}
      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="font-bold text-sm">MACHINE ID</h2>
        <p className="text-xs text-muted-foreground">
          Send this ID to Infizent Technology to receive a license tied to this machine.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 bg-muted rounded text-sm font-mono break-all">{machineId}</code>
          <button
            onClick={() => navigator.clipboard.writeText(machineId)}
            className="px-3 py-2 bg-secondary text-secondary-foreground rounded text-xs font-medium shrink-0"
          >
            Copy
          </button>
        </div>
      </div>

      {/* Current license */}
      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="font-bold text-sm">CURRENT LICENSE</h2>
        <div className="grid grid-cols-2 gap-3 text-sm font-mono">
          <div><span className="text-muted-foreground">Type:</span> {license.licenseType}</div>
          <div><span className="text-muted-foreground">Status:</span> <span className={statusColor}>● {statusLabel}</span></div>
          <div><span className="text-muted-foreground">Customer:</span> {license.customerName}</div>
          <div><span className="text-muted-foreground">Expires:</span> {new Date(license.expiresAt).toLocaleDateString('en-GB')} ({license.daysRemaining}d)</div>
          <div className="col-span-2"><span className="text-muted-foreground">Key:</span> {license.licenseKey}</div>
        </div>

        {status === 'invalid_schema' && (
          <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded p-3 text-sm">
            Your license format is outdated. Please contact{' '}
            <strong>Infizent Technology</strong> for a new activation key.
          </div>
        )}
      </div>

      {/* Activate */}
      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="font-bold text-sm">ACTIVATE LICENSE</h2>
        <p className="text-xs text-muted-foreground">
          Paste the base64 activation string received from Infizent Technology.
        </p>
        <textarea
          value={activationStr}
          onChange={(e) => setActivationStr(e.target.value)}
          placeholder="Paste your activation string here..."
          className="w-full px-3 py-2 border rounded text-sm font-mono min-h-[80px]"
        />
        {msg && (
          <p className={`text-sm ${msgType === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>{msg}</p>
        )}
        <button
          onClick={handleActivate}
          className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium"
        >
          Activate
        </button>
      </div>

      {/* Customer profile */}
      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="font-bold text-sm">CUSTOMER PROFILE (shown on reports)</h2>
        <input
          type="text"
          value={customer.name}
          onChange={(e) => updateCustomer({ name: e.target.value })}
          placeholder="Company name"
          className="w-full px-3 py-2 border rounded text-sm"
        />
        <input
          type="text"
          value={customer.address || ''}
          onChange={(e) => updateCustomer({ address: e.target.value })}
          placeholder="Address"
          className="w-full px-3 py-2 border rounded text-sm"
        />
        <input
          type="text"
          value={customer.contactPerson || ''}
          onChange={(e) => updateCustomer({ contactPerson: e.target.value })}
          placeholder="Contact person"
          className="w-full px-3 py-2 border rounded text-sm"
        />
      </div>
    </div>
  );
}
