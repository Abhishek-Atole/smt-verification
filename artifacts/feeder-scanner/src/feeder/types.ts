export type FeederSessionStatus =
  | 'draft'
  | 'setup'
  | 'running'
  | 'complete'
  | 'aborted';

export type MachineName = string;
export type LineName = string;
export type ShiftType = 'A' | 'B' | 'C' | 'GENERAL';

export interface FeederSession {
  id: string;
  lineId: LineName;
  machineName: MachineName;
  shift: ShiftType;
  operator: string;
  startedAt: string;
  completedAt?: string;
  status: FeederSessionStatus;
  notes?: string;
}
