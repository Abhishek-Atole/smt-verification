export type UserRole = "operator" | "qa" | "engineer" | "admin";

export type MatchType = "mpn1" | "mpn2" | "mpn3" | "ucal_part_number";

export interface AppUser {
  id: string;
  name: string;
  employeeId: string;
  role: UserRole;
}

export interface VerificationScanView {
  id: string;
  scannedMpn: string;
  scannedLotCode: string | null;
  matchType: MatchType;
  isAlternate: boolean;
  scannedAt: string;
  lineItem: {
    feederNumber: string;
    description: string | null;
    packageDesc: string | null;
  };
  alternative: {
    make: string;
    mpn: string;
    rank: number;
  };
}
