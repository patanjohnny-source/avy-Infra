import type {
  AdvanceEntry,
  AttendanceRecord,
  CompanyProfile,
  Employee,
  FlatUnit,
  Project,
  SiteExpense,
  Tower,
  WorkAssignment,
} from '../types/avy';

export type AuthRole = 'admin' | 'supervisor' | 'employee';

export interface WorkspaceSession {
  role: AuthRole;
  displayName: string;
  employeeId?: string;
  empCode?: string;
  assignedTowerIds: string[];
  loginAt: string;
}

export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'admin123';
export const DEFAULT_ADMIN_EDIT_PIN = '1234';
export const DEFAULT_USER_PIN = '1234';

function normalizePhone(phone?: string): string {
  return (phone || '').replace(/\D/g, '').slice(-10);
}

export function resolveEmployeeLoginPin(emp: Pick<Employee, 'loginPin'>): string {
  return emp.loginPin?.trim() || DEFAULT_USER_PIN;
}

export function resolveSupervisorTowerIds(emp: Employee, towers: Tower[]): string[] {
  const validIds = new Set(towers.map((t) => t.id));
  if (Array.isArray(emp.assignedTowerIds) && emp.assignedTowerIds.length > 0) {
    const filtered =
      towers.length > 0
        ? emp.assignedTowerIds.filter((id) => validIds.has(id))
        : emp.assignedTowerIds;
    if (filtered.length > 0) return Array.from(new Set(filtered));
  }
  if (emp.currentTowerId && (towers.length === 0 || validIds.has(emp.currentTowerId))) {
    return [emp.currentTowerId];
  }
  const empPhone = normalizePhone(emp.phone);
  const empName = emp.fullName.trim().toLowerCase();
  const matched = towers
    .filter(
      (t) =>
        (empPhone && normalizePhone(t.supervisorPhone) === empPhone) ||
        (empName && t.supervisorName?.trim().toLowerCase() === empName)
    )
    .map((t) => t.id);
  return Array.from(new Set(matched));
}

export type AuthResult =
  | { ok: true; session: WorkspaceSession }
  | { ok: false; error: string };

export function authenticateWorkspaceUser(params: {
  role: AuthRole;
  identifier: string;
  secret: string;
  companyProfile: CompanyProfile;
  employees: Employee[];
  towers: Tower[];
  nowIso?: string;
}): AuthResult {
  const { role, identifier, secret, companyProfile, employees, towers } = params;
  const cleanId = identifier.trim();
  const cleanSecret = secret.trim();
  const nowIso = params.nowIso || new Date().toISOString();

  if (!cleanId) {
    return {
      ok: false,
      error:
        role === 'admin'
          ? 'Enter your Admin username or HR email.'
          : 'Enter your Employee ID (e.g. AVY-SUP-005) or registered mobile number.',
    };
  }
  if (!cleanSecret) {
    return {
      ok: false,
      error: role === 'admin' ? 'Enter the Admin password.' : 'Enter your 4-digit login PIN.',
    };
  }

  if (role === 'admin') {
    const expectedUser = (companyProfile.adminUsername || DEFAULT_ADMIN_USERNAME)
      .trim()
      .toLowerCase();
    const hrEmail = (companyProfile.hrEmail || '').trim().toLowerCase();
    const expectedPass = (companyProfile.adminPassword || DEFAULT_ADMIN_PASSWORD).trim();
    const idLower = cleanId.toLowerCase();

    if (idLower !== expectedUser && (!hrEmail || idLower !== hrEmail)) {
      return { ok: false, error: 'Invalid Admin username or email.' };
    }
    if (cleanSecret !== expectedPass) {
      return { ok: false, error: 'Incorrect Admin password.' };
    }

    return {
      ok: true,
      session: {
        role: 'admin',
        displayName: companyProfile.signatoryName || 'AVY INFRA Admin',
        assignedTowerIds: [],
        loginAt: nowIso,
      },
    };
  }

  const idLower = cleanId.toLowerCase();
  const idDigits = normalizePhone(cleanId);

  const matchedEmp = employees.find((emp) => {
    const codeMatch = emp.empCode.trim().toLowerCase() === idLower;
    const phoneMatch = Boolean(idDigits && normalizePhone(emp.phone) === idDigits);
    return codeMatch || phoneMatch;
  });

  if (!matchedEmp) {
    return {
      ok: false,
      error: 'No employee found with that Employee ID or mobile number.',
    };
  }

  if (matchedEmp.status !== 'active') {
    return {
      ok: false,
      error: `${matchedEmp.fullName} (${matchedEmp.empCode}) is marked inactive. Contact Admin.`,
    };
  }

  if (role === 'supervisor') {
    const hasSupAccess =
      matchedEmp.role === 'Supervisor' ||
      (Array.isArray(matchedEmp.assignedTowerIds) && matchedEmp.assignedTowerIds.length > 0);
    if (!hasSupAccess) {
      return {
        ok: false,
        error: `${matchedEmp.fullName} is a ${matchedEmp.role}. Use Employee Login or ask Admin to assign Supervisor access.`,
      };
    }

    if (cleanSecret !== resolveEmployeeLoginPin(matchedEmp)) {
      return { ok: false, error: 'Incorrect Supervisor PIN.' };
    }

    const assignedTowerIds = resolveSupervisorTowerIds(matchedEmp, towers);
    if (assignedTowerIds.length === 0) {
      return {
        ok: false,
        error: 'No tower is currently assigned to this Supervisor. Ask Admin to assign a tower.',
      };
    }

    return {
      ok: true,
      session: {
        role: 'supervisor',
        displayName: matchedEmp.fullName,
        employeeId: matchedEmp.id,
        empCode: matchedEmp.empCode,
        assignedTowerIds,
        loginAt: nowIso,
      },
    };
  }

  // Employee login
  if (cleanSecret !== resolveEmployeeLoginPin(matchedEmp)) {
    return { ok: false, error: 'Incorrect Employee PIN.' };
  }

  return {
    ok: true,
    session: {
      role: 'employee',
      displayName: matchedEmp.fullName,
      employeeId: matchedEmp.id,
      empCode: matchedEmp.empCode,
      assignedTowerIds: matchedEmp.currentTowerId ? [matchedEmp.currentTowerId] : [],
      loginAt: nowIso,
    },
  };
}

export function isAdminSession(session: WorkspaceSession | null): boolean {
  return session?.role === 'admin';
}

export function isSupervisorSession(session: WorkspaceSession | null): boolean {
  return session?.role === 'supervisor';
}

export function isEmployeeSession(session: WorkspaceSession | null): boolean {
  return session?.role === 'employee';
}

export type WorkspaceSectionId =
  | 'overview'
  | 'projects'
  | 'workforce'
  | 'payroll'
  | 'expenses'
  | 'sitelogs'
  | 'messenger'
  | 'billing'
  | 'documents';

const SUPERVISOR_BLOCKED_SECTIONS = new Set<WorkspaceSectionId>(['billing', 'documents']);

export function canAccessWorkspaceSection(
  session: WorkspaceSession | null,
  section: WorkspaceSectionId
): boolean {
  if (!session) return false;
  if (session.role === 'admin') return true;
  if (session.role === 'supervisor') {
    return !SUPERVISOR_BLOCKED_SECTIONS.has(section);
  }
  return false;
}

export function canViewEmployeeFixedSalary(session: WorkspaceSession | null): boolean {
  return session?.role === 'admin';
}

export function canAccessTower(session: WorkspaceSession | null, towerId?: string): boolean {
  if (!session) return false;
  if (session.role === 'admin') return true;
  if (session.role === 'supervisor') {
    return Boolean(towerId && session.assignedTowerIds.includes(towerId));
  }
  return false;
}

export function getScopedTowers(session: WorkspaceSession | null, towers: Tower[]): Tower[] {
  if (!session) return [];
  if (session.role === 'admin') return towers;
  if (session.role === 'supervisor') {
    const allowed = new Set(session.assignedTowerIds);
    return towers.filter((t) => allowed.has(t.id));
  }
  return [];
}

export function getScopedProjects(
  session: WorkspaceSession | null,
  projects: Project[],
  towers: Tower[]
): Project[] {
  if (!session) return [];
  if (session.role === 'admin') return projects;
  if (session.role === 'supervisor') {
    const scopedTowers = getScopedTowers(session, towers);
    const projectIds = new Set(scopedTowers.map((t) => t.projectId));
    return projects.filter((p) => projectIds.has(p.id));
  }
  return [];
}

export function getScopedEmployees(session: WorkspaceSession | null, employees: Employee[]): Employee[] {
  if (!session) return [];
  if (session.role === 'admin') return employees;
  if (session.role === 'supervisor') {
    const allowed = new Set(session.assignedTowerIds);
    return employees.filter(
      (e) =>
        (e.currentTowerId && allowed.has(e.currentTowerId)) ||
        (session.employeeId && e.id === session.employeeId)
    );
  }
  if (session.role === 'employee') {
    return employees.filter((e) => e.id === session.employeeId);
  }
  return [];
}

export function getScopedFlats(session: WorkspaceSession | null, flats: FlatUnit[]): FlatUnit[] {
  if (!session) return [];
  if (session.role === 'admin') return flats;
  if (session.role === 'supervisor') {
    const allowed = new Set(session.assignedTowerIds);
    return flats.filter((f) => allowed.has(f.towerId));
  }
  return [];
}

export function getScopedAssignments(
  session: WorkspaceSession | null,
  assignments: WorkAssignment[]
): WorkAssignment[] {
  if (!session) return [];
  if (session.role === 'admin') return assignments;
  if (session.role === 'supervisor') {
    const allowed = new Set(session.assignedTowerIds);
    return assignments.filter((a) => allowed.has(a.towerId));
  }
  if (session.role === 'employee') {
    return assignments.filter((a) => a.employeeId === session.employeeId);
  }
  return [];
}

export function getScopedAttendance(
  session: WorkspaceSession | null,
  attendance: AttendanceRecord[],
  employees: Employee[]
): AttendanceRecord[] {
  if (!session) return [];
  if (session.role === 'admin') return attendance;
  if (session.role === 'supervisor') {
    const scopedIds = new Set(getScopedEmployees(session, employees).map((e) => e.id));
    const allowed = new Set(session.assignedTowerIds);
    return attendance.filter(
      (a) => (a.towerId && allowed.has(a.towerId)) || scopedIds.has(a.employeeId)
    );
  }
  if (session.role === 'employee') {
    return attendance.filter((a) => a.employeeId === session.employeeId);
  }
  return [];
}

export function getScopedAdvances(
  session: WorkspaceSession | null,
  advances: AdvanceEntry[],
  employees: Employee[]
): AdvanceEntry[] {
  if (!session) return [];
  if (session.role === 'admin') return advances;
  if (session.role === 'supervisor') {
    const allowed = new Set(session.assignedTowerIds);
    const empTowerMap = new Map(employees.map((e) => [e.id, e.currentTowerId || '']));
    return advances.filter((adv) => {
      const tId = adv.towerId || empTowerMap.get(adv.employeeId) || '';
      return Boolean(tId && allowed.has(tId));
    });
  }
  if (session.role === 'employee') {
    return advances.filter((a) => a.employeeId === session.employeeId);
  }
  return [];
}

export function getScopedExpenses(
  session: WorkspaceSession | null,
  expenses: SiteExpense[]
): SiteExpense[] {
  if (!session) return [];
  if (session.role === 'admin') return expenses;
  if (session.role === 'supervisor') {
    const allowed = new Set(session.assignedTowerIds);
    return expenses.filter((e) => Boolean(e.towerId && allowed.has(e.towerId)));
  }
  return [];
}

export function canSupervisorUpdateEmployee(
  session: WorkspaceSession | null,
  employee: Employee
): boolean {
  if (!session) return false;
  if (session.role === 'admin') return true;
  if (session.role === 'supervisor') {
    return Boolean(
      employee.currentTowerId && session.assignedTowerIds.includes(employee.currentTowerId)
    );
  }
  return false;
}

export interface AttendanceMutationEvaluation {
  allowed: boolean;
  locked: boolean;
  requiresAdminPin: boolean;
  mode: 'mark' | 'edit' | 'blocked';
  reason?: string;
}

export function evaluateAttendanceMutation(params: {
  session: WorkspaceSession | null;
  existingRecord?: AttendanceRecord;
  companyProfile: CompanyProfile;
  isExplicitEdit?: boolean;
  adminPinInput?: string;
  editReason?: string;
}): AttendanceMutationEvaluation {
  const { session, existingRecord, companyProfile, isExplicitEdit, adminPinInput, editReason } =
    params;

  if (!session || session.role === 'employee') {
    return {
      allowed: false,
      locked: true,
      requiresAdminPin: false,
      mode: 'blocked',
      reason: 'Employee accounts have read-only access and cannot mark or edit attendance.',
    };
  }

  if (session.role === 'admin') {
    if (existingRecord && isExplicitEdit && !editReason?.trim()) {
      return {
        allowed: false,
        locked: false,
        requiresAdminPin: false,
        mode: 'blocked',
        reason: 'Please enter a brief edit reason for the audit log.',
      };
    }
    return {
      allowed: true,
      locked: false,
      requiresAdminPin: false,
      mode: existingRecord ? 'edit' : 'mark',
    };
  }

  // Supervisor rules:
  // 1. Unmarked attendance can be marked freely.
  if (!existingRecord) {
    return {
      allowed: true,
      locked: false,
      requiresAdminPin: false,
      mode: 'mark',
    };
  }

  // 2. Once marked, inline quick clicks cannot overwrite it.
  const needsPin = !companyProfile.supervisorCanEditAttendance;
  if (!isExplicitEdit) {
    return {
      allowed: false,
      locked: true,
      requiresAdminPin: needsPin,
      mode: 'blocked',
      reason:
        'Attendance is locked once marked. Use the Edit Attendance feature to update this record.',
    };
  }

  // 3. Explicit Edit Attendance feature
  if (!editReason?.trim()) {
    return {
      allowed: false,
      locked: true,
      requiresAdminPin: needsPin,
      mode: 'blocked',
      reason: 'Enter an edit reason before saving attendance changes.',
    };
  }

  if (companyProfile.supervisorCanEditAttendance) {
    return {
      allowed: true,
      locked: false,
      requiresAdminPin: false,
      mode: 'edit',
    };
  }

  const expectedPin = (companyProfile.adminEditPin || DEFAULT_ADMIN_EDIT_PIN).trim();
  if ((adminPinInput || '').trim() !== expectedPin) {
    return {
      allowed: false,
      locked: true,
      requiresAdminPin: true,
      mode: 'blocked',
      reason:
        'Invalid Admin Edit PIN. Enter the Admin Edit PIN or ask Admin to unlock supervisor attendance edits.',
    };
  }

  return {
    allowed: true,
    locked: false,
    requiresAdminPin: true,
    mode: 'edit',
  };
}
