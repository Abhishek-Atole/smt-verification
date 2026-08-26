#!/usr/bin/env node
// generate-license.js — Infizent License Issuance Tool
// Usage: node generate-license.js --customer "UCAL" --type standard --machine <machineId> --days 365
const crypto = require('crypto');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) {
    args[key] = process.argv[++i];
  } else {
    args[key] = true;
  }
}

const HMAC_KEY = process.env.LICENSE_HMAC_KEY;
if (!HMAC_KEY) {
  console.error('ERROR: LICENSE_HMAC_KEY env var is required');
  console.error('Set it to the same value as VITE_LICENSE_HMAC_KEY used in the app build.');
  console.error('Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

if (!args.customer || !args.machine) {
  console.error('Usage: node generate-license.js --customer "Customer Name" --type standard --machine <machineId> --days 365');
  console.error('  --customer  Required. Customer name (e.g. "UCAL")');
  console.error('  --type      License type: trial | standard | professional (default: standard)');
  console.error('  --machine   Required. Machine ID from the target machine\'s Admin > License page');
  console.error('  --days      License duration in days (default: 365)');
  process.exit(1);
}

function generateLicenseKey() {
  return crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g).join('-');
}

async function computeSignature(info) {
  const payload = [
    info.licenseKey,
    info.licenseType,
    info.customerId,
    info.activatedAt,
    info.expiresAt,
    info.issuedBy,
    info.machineId,
    info.schemaVersion,
  ].join('|');

  const key = await crypto.subtle.importKey(
    'raw', Buffer.from(HMAC_KEY, 'utf8'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, Buffer.from(payload));
  return Buffer.from(sig).toString('hex');
}

async function main() {
  const now = new Date();
  const days = parseInt(args.days, 10) || 365;

  const features = {
    feederVerification: true,
    solderPasteFifo: true,
    printerChangeover: args.type !== 'trial',
    reporting: true,
    adminDashboard: args.type === 'professional',
  };

  const license = {
    licenseKey: generateLicenseKey(),
    licenseType: args.type || 'standard',
    customerId: args.customer.toLowerCase().replace(/\s+/g, '-'),
    customerName: args.customer,
    activatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 86400000).toISOString(),
    issuedBy: 'Infizent Technology',
    issuedTo: args.customer,
    machineId: args.machine,
    features,
    schemaVersion: 2,
    status: 'active',
    daysRemaining: days,
  };

  license.signature = await computeSignature(license);

  const activationString = Buffer.from(JSON.stringify(license)).toString('base64');

  console.log('\n=== LICENSE GENERATED ===');
  console.log(JSON.stringify(license, null, 2));
  console.log('\n=== ACTIVATION STRING (base64) ===');
  console.log(activationString);
  console.log('\nDeliver the activation string above to the customer.');
  console.log('They paste it into Admin > License > Activate.');

  console.log('\n=== FALLBACK: LICENSE PAGE LOCKED (trial/license already expired) ===');
  console.log('The expiry overlay covers the whole app — including the Admin Portal —');
  console.log('so an expired install cannot reach License > Activate. Have the customer');
  console.log('open the app, press F12 > Console, paste this one line and press Enter:');
  console.log(`\n  localStorage.setItem('lic_info', atob('${activationString}')); location.reload()`);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
