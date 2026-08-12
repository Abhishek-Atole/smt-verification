export type LicenseType =
  | 'trial'
  | 'standard'
  | 'professional'
  | 'expired';

export type LicenseStatus =
  | 'active'
  | 'trial_active'
  | 'expired'
  | 'not_activated'
  | 'invalid_schema'
  | 'wrong_machine'
  | 'invalid_signature';

export interface LicenseInfo {
  licenseKey: string;
  licenseType: LicenseType;
  status: LicenseStatus;
  customerId: string;
  customerName: string;
  customerContact?: string;
  activatedAt: string;
  expiresAt: string;
  daysRemaining: number;
  features: LicenseFeatures;
  issuedBy: string;
  issuedTo: string;
  machineId: string;
  signature: string;
  schemaVersion: number;
}

export interface LicenseFeatures {
  maxLines: number;
  feederModule: boolean;
  locationVerification: boolean;
  adminDashboard: boolean;
  exportPDF: boolean;
  exportXLSX: boolean;
  exportCSV: boolean;
  exportJSON: boolean;
  finalReport: boolean;
  spliceTracking: boolean;
  qaSignOff: boolean;
  maxSessionHistory: number;
}

export interface LicenseCustomer {
  id: string;
  name: string;
  address?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  logoPath?: string;
}

export const TRIAL_FEATURES: LicenseFeatures = {
  maxLines: 1,
  feederModule: true,
  locationVerification: true,
  adminDashboard: true,
  exportPDF: true,
  exportXLSX: true,
  exportCSV: true,
  exportJSON: true,
  finalReport: true,
  spliceTracking: true,
  qaSignOff: true,
  maxSessionHistory: 50,
};

export const STANDARD_FEATURES: LicenseFeatures = {
  maxLines: 2,
  feederModule: true,
  locationVerification: true,
  adminDashboard: true,
  exportPDF: true,
  exportXLSX: true,
  exportCSV: true,
  exportJSON: true,
  finalReport: true,
  spliceTracking: true,
  qaSignOff: true,
  maxSessionHistory: 200,
};

export const PROFESSIONAL_FEATURES: LicenseFeatures = {
  maxLines: -1,
  feederModule: true,
  locationVerification: true,
  adminDashboard: true,
  exportPDF: true,
  exportXLSX: true,
  exportCSV: true,
  exportJSON: true,
  finalReport: true,
  spliceTracking: true,
  qaSignOff: true,
  maxSessionHistory: -1,
};

export const LEGACY_GRACE_PERIOD_DAYS = 30;
