import { BRAND } from '../brand';

export const appConfig = {
  companyName: import.meta.env.VITE_COMPANY_NAME ?? "UCAL ELECTRONICS PVT.LTD.",
  companyShort: import.meta.env.VITE_COMPANY_SHORT ?? "UCAL",
  systemTitle: import.meta.env.VITE_SYSTEM_TITLE ?? "SMT Changeover Verification System",
  version: import.meta.env.VITE_SYSTEM_VERSION ?? BRAND.version,
  logoUrl: import.meta.env.VITE_LOGO_URL ?? "/assets/ucal-logo.png",
  copyright: BRAND.copyright,
  founder: BRAND.founder,
  website: BRAND.website,
  supportEmail: BRAND.supportEmail,
} as const;
