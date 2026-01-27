export interface Shift {
  id: string;
  employeeId: string;
  employeeName: string;
  shiftCode: 'A' | 'B' | 'C';
  scheduledStart: string;
  scheduledEnd: string;
  actualClockIn?: string | null;
  actualClockOut?: string | null;
  workedMinutesInWindow?: number;
  scheduledMinutes?: number;
  compliancePercent?: number;
  flags?: {
    lateClockIn: boolean;
    earlyClockOut: boolean;
    missingClockOut: boolean;
    noShow: boolean;
  };
  status?: string;
  notes: string | null;
}

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  day: string; // YYYY-MM-DD
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  decidedAt: string | null;
}
