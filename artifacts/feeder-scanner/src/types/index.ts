export interface BOMEntry {
  feederId: string;
  alternatives: ComponentOption[];
  isOptional?: boolean;
}

export interface ComponentOption {
  mpn: string;
  partId: string;
  description: string;
}

export interface FeederScan {
  feederId: string;
  mpn: string;
  partId: string;
  lotCode?: string;
  scannedAt: Date;
  status: "verified" | "error";
  matchedAlternative: ComponentOption;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  type: "info" | "success" | "warning" | "error";
  feederId?: string;
  message: string;
  details?: Record<string, string>;
}

export interface SplicingRecord {
  feederId: string;
  oldSpoolMPN: string;
  newSpoolMPN: string;
  splicedAt: Date;
  verifiedAgainstBOM: boolean;
}

export interface NotificationPayload {
  type: "success" | "error" | "warning" | "info" | "alternative";
  title: string;
  message: string;
  autoCloseDuration?: number;
  feederId?: string;
}

export interface ProgressResult {
  verifiedCount: number;
  totalRequired: number;
  percentage: number;
  remainingFeeders: string[];
  isComplete: boolean;
}
