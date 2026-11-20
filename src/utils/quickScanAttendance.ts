import type { AttendanceRecord, Employee } from '../types/avy';
import type { AuthRole, WorkspaceSession } from './authAccess';
import { canSupervisorUpdateEmployee } from './authAccess';
import { decodeQrSnapshot, parseQrScanParams } from './qrProfile';

export interface QuickScanMatchResult {
  ok: boolean;
  employee?: Employee;
  matchedBy?: 'qr_token' | 'qr_emp_id' | 'qr_snapshot' | 'emp_code' | 'phone' | 'suffix';
  reason?: string;
}

/**
 * Resolves any scanned QR payload (full ID card scan URL, qrToken, raw empCode like AVY-MSN-001,
 * internal employee id, or phone number) against active workspace employees.
 */
export function resolveQuickScanInput(
  rawInput: string,
  employees: Employee[]
): QuickScanMatchResult {
  const cleaned = (rawInput || '').trim();
  if (!cleaned) {
    return { ok: false, reason: 'Scan an employee QR code or enter an Employee ID code.' };
  }

  // 1. Check if input is a full URL or query string carrying QR params (?qrToken=...&qrEmp=...&qr=...)
  let searchPart = '';
  if (cleaned.includes('qrToken=') || cleaned.includes('qrEmp=') || cleaned.includes('qr=')) {
    const qIndex = cleaned.indexOf('?');
    searchPart = qIndex >= 0 ? cleaned.slice(qIndex) : `?${cleaned}`;
  }

  if (searchPart) {
    const scanParams = parseQrScanParams(searchPart);
    if (scanParams.qrToken) {
      const byToken = employees.find((e) => e.qrToken === scanParams.qrToken);
      if (byToken) return { ok: true, employee: byToken, matchedBy: 'qr_token' };
    }
    if (scanParams.qrEmp) {
      const byIdOrCode = employees.find(
        (e) =>
          e.id === scanParams.qrEmp ||
          e.empCode.toLowerCase() === scanParams.qrEmp.toLowerCase()
      );
      if (byIdOrCode) return { ok: true, employee: byIdOrCode, matchedBy: 'qr_emp_id' };
    }
    if (scanParams.qrEncoded) {
      const decoded = decodeQrSnapshot(scanParams.qrEncoded);
      if (decoded) {
        const bySnapshot = employees.find(
          (e) =>
            (decoded.employeeId && e.id === decoded.employeeId) ||
            (decoded.empCode && e.empCode.toLowerCase() === decoded.empCode.toLowerCase())
        );
        if (bySnapshot) return { ok: true, employee: bySnapshot, matchedBy: 'qr_snapshot' };
      }
    }
  }

  // 2. Match exact qrToken directly
  const byDirectToken = employees.find((e) => e.qrToken && e.qrToken === cleaned);
  if (byDirectToken) {
    return { ok: true, employee: byDirectToken, matchedBy: 'qr_token' };
  }

  // 3. Match exact Employee ID or empCode (case-insensitive)
  const lower = cleaned.toLowerCase();
  const byExactCode = employees.find(
    (e) => e.empCode.toLowerCase() === lower || e.id.toLowerCase() === lower
  );
  if (byExactCode) {
    return { ok: true, employee: byExactCode, matchedBy: 'emp_code' };
  }

  // 4. Match exact 10-digit phone number
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length >= 10) {
    const tail10 = digitsOnly.slice(-10);
    const byPhone = employees.find(
      (e) => e.phone.replace(/\D/g, '').slice(-10) === tail10
    );
    if (byPhone) {
      return { ok: true, employee: byPhone, matchedBy: 'phone' };
    }
  }

  // 5. Unique trailing numeric ID suffix match (e.g. "001" -> AVY-MSN-001 if unambiguous)
  if (/^\d{2,4}$/.test(cleaned)) {
    const suffixMatches = employees.filter((e) =>
      e.empCode.toLowerCase().endsWith(`-${lower}`)
    );
    if (suffixMatches.length === 1) {
      return { ok: true, employee: suffixMatches[0], matchedBy: 'suffix' };
    }
    if (suffixMatches.length > 1) {
      return {
        ok: false,
        reason: `Multiple workers end with "${cleaned}". Scan QR or enter full code (e.g. ${suffixMatches[0].empCode}).`,
      };
    }
  }

  return {
    ok: false,
    reason: `No registered worker matched "${cleaned.slice(0, 48)}".`,
  };
}

export interface QuickScanValidationResult {
  canLog: boolean;
  issue?: 'duplicate_in_session' | 'already_marked_today' | 'inactive_employee' | 'out_of_tower_scope';
  existingRecord?: AttendanceRecord;
  message?: string;
}

/**
 * Pure validation guard for a scanned worker during a Quick Scan Attendance session.
 * Prevents duplicate scans, respects inactive status, and enforces supervisor tower scope.
 */
export function validateQuickScanCandidate(params: {
  employee: Employee;
  date: string;
  existingAttendance: AttendanceRecord[];
  sessionLoggedIds: Set<string>;
  session?: { role: AuthRole; assignedTowerIds: string[] } | WorkspaceSession | null;
}): QuickScanValidationResult {
  const { employee, date, existingAttendance, sessionLoggedIds, session } = params;

  if (employee.status !== 'active') {
    return {
      canLog: false,
      issue: 'inactive_employee',
      message: `${employee.fullName} (${employee.empCode}) is marked inactive.`,
    };
  }

  if (session && session.role === 'supervisor') {
    const fakeSession: WorkspaceSession = {
      role: 'supervisor',
      displayName: 'Supervisor',
      assignedTowerIds: session.assignedTowerIds || [],
      loginAt: '',
    };
    if (!canSupervisorUpdateEmployee(fakeSession, employee)) {
      return {
        canLog: false,
        issue: 'out_of_tower_scope',
        message: `${employee.fullName} is not assigned to your tower(s).`,
      };
    }
  }

  if (sessionLoggedIds.has(employee.id)) {
    return {
      canLog: false,
      issue: 'duplicate_in_session',
      message: `${employee.fullName} (${employee.empCode}) already scanned in this session.`,
    };
  }

  const existing = existingAttendance.find(
    (a) => a.date === date && a.employeeId === employee.id
  );
  if (existing) {
    return {
      canLog: false,
      issue: 'already_marked_today',
      existingRecord: existing,
      message: `${employee.fullName} already marked ${existing.status.replace('_', ' ')} on ${date}.`,
    };
  }

  return { canLog: true };
}

export interface QuickScanSessionItem {
  id: string;
  timestamp: string;
  scanDate: string;
  rawInput: string;
  employeeId?: string;
  empCode?: string;
  employeeName: string;
  role?: string;
  status: AttendanceRecord['status'];
  overtimeHours?: number;
  outcome: 'logged' | 'duplicate' | 'blocked' | 'undone';
  message: string;
}

/**
 * Returns active successfully logged scans from the current Quick Scan session (newest first)
 * so supervisors can quickly inspect Recent Scans and undo accidental double/wrong scans.
 */
export function getRecentLoggedScans(logs: QuickScanSessionItem[]): QuickScanSessionItem[] {
  return logs.filter((item) => item.outcome === 'logged' && Boolean(item.employeeId));
}

/**
 * Pure session state transition when a supervisor clicks "Undo" on a Recent Scan entry.
 * Marks the entry as undone and removes the employee from sessionLoggedIds so they can be re-scanned.
 */
export function applyUndoScanToSession(params: {
  logs: QuickScanSessionItem[];
  scannedEmployeeIds: string[];
  logId: string;
}): {
  nextLogs: QuickScanSessionItem[];
  nextScannedEmployeeIds: string[];
  undoneItem: QuickScanSessionItem | null;
} {
  const target = params.logs.find((l) => l.id === params.logId && l.outcome === 'logged');
  if (!target) {
    return {
      nextLogs: params.logs,
      nextScannedEmployeeIds: params.scannedEmployeeIds,
      undoneItem: null,
    };
  }

  const nextLogs: QuickScanSessionItem[] = params.logs.map((item) =>
    item.id === params.logId
      ? {
          ...item,
          outcome: 'undone',
          message: `Undone — ${item.empCode ? `${item.empCode} ` : ''}${item.employeeName} reverted and ready to re-scan.`,
        }
      : item
  );

  const stillLoggedForEmp = target.employeeId
    ? nextLogs.some((item) => item.outcome === 'logged' && item.employeeId === target.employeeId)
    : false;

  const nextScannedEmployeeIds =
    target.employeeId && !stillLoggedForEmp
      ? params.scannedEmployeeIds.filter((id) => id !== target.employeeId)
      : params.scannedEmployeeIds;

  return {
    nextLogs,
    nextScannedEmployeeIds,
    undoneItem: target,
  };
}

