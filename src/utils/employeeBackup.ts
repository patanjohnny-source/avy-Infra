import type {
  AdvanceEntry,
  AttendanceRecord,
  DeploymentRecord,
  Employee,
  EmployeeBackupExportBundle,
  EmployeeBackupSummary,
  EmployeeDocument,
  EmployeeRole,
  Project,
  RemovedEmployeeBackup,
  SettlementEntry,
  Tower,
  WorkAssignment,
} from '../types/avy';
import { normalizeSkillTags } from './operations';
import { computeEmployeePayroll, generateEmployeeCode } from './payroll';
import { generateQrPassToken } from './qrProfile';

const MAX_CLOUD_BACKUP_DOCS = 5;
const MAX_CLOUD_BACKUP_DOC_DATA_CHARS = 550_000;

function sanitizeDocId(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || `id_${Date.now().toString(36)}`;
}

function clampText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

export function buildRemovedEmployeeBackup(params: {
  employee: Employee;
  ownerId: string;
  removedByName: string;
  removalReason?: string;
  employeeDocuments: EmployeeDocument[];
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  settlements: SettlementEntry[];
  deployments: DeploymentRecord[];
  assignments: WorkAssignment[];
  nowIso?: string;
  backupId?: string;
}): RemovedEmployeeBackup {
  const nowIso = params.nowIso || new Date().toISOString();
  const { employee } = params;
  const empDocs = (params.employeeDocuments || []).filter(
    (d) => d.employeeId === employee.id
  );
  const empAtt = (params.attendance || []).filter((a) => a.employeeId === employee.id);
  const empDeps = (params.deployments || []).filter((d) => d.employeeId === employee.id);
  const empAsgns = (params.assignments || []).filter((a) => a.employeeId === employee.id);

  const payroll = computeEmployeePayroll(
    employee,
    params.attendance || [],
    params.advances || [],
    params.settlements || []
  );

  const summary: EmployeeBackupSummary = {
    attendanceCount: empAtt.length,
    presentDays: payroll.presentDays,
    halfDays: payroll.halfDays,
    absentDays: payroll.absentDays,
    totalWagesEarned: Math.round(payroll.totalEarned),
    totalAdvances: Math.round(payroll.totalAdvances),
    totalSettled: Math.round(payroll.totalSettled),
    netPayable: Math.round(payroll.netPayable),
    deploymentsCount: empDeps.length,
    assignmentsCount: empAsgns.length,
    documentsCount: empDocs.length,
  };

  const id = sanitizeDocId(
    params.backupId ||
      `bak_${employee.empCode.toLowerCase()}_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 6)}`
  ).slice(0, 120);

  return {
    id,
    ownerId: clampText(params.ownerId, 128) || employee.ownerId || 'local-avy-infra',
    employeeId: employee.id,
    empCode: employee.empCode,
    fullName: employee.fullName,
    role: employee.role,
    phone: employee.phone,
    joiningDate: employee.joiningDate,
    removedAt: nowIso,
    removedByName: clampText(params.removedByName, 100) || 'Admin',
    removalReason: clampText(params.removalReason, 300),
    employeeSnapshot: {
      ...employee,
      skillTags: normalizeSkillTags(employee.skillTags),
      assignedTowerIds: Array.isArray(employee.assignedTowerIds)
        ? [...employee.assignedTowerIds]
        : [],
    },
    documents: empDocs.map((docItem) => ({ ...docItem })),
    summary,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function trimEmployeeBackupDocumentsForCloud(documents: EmployeeDocument[]): {
  cloudDocuments: EmployeeDocument[];
  archivedDocIds: string[];
  omittedCount: number;
} {
  const cloudDocuments: EmployeeDocument[] = [];
  const archivedDocIds: string[] = [];
  let remainingChars = MAX_CLOUD_BACKUP_DOC_DATA_CHARS;
  let omittedCount = 0;

  for (const docItem of documents) {
    const dataUrl = typeof docItem.dataUrl === 'string' ? docItem.dataUrl : '';
    if (
      cloudDocuments.length < MAX_CLOUD_BACKUP_DOCS &&
      dataUrl.length > 0 &&
      dataUrl.length <= remainingChars
    ) {
      cloudDocuments.push({
        ...docItem,
        title: clampText(docItem.title, 100) || 'Document',
        fileName: clampText(docItem.fileName, 160) || 'document.pdf',
        mimeType: clampText(docItem.mimeType, 80) || 'application/pdf',
      });
      archivedDocIds.push(docItem.id);
      remainingChars -= dataUrl.length;
    } else {
      omittedCount += 1;
    }
  }

  return { cloudDocuments, archivedDocIds, omittedCount };
}

export function buildEmployeeBackupExportPayload(params: {
  backups: RemovedEmployeeBackup[];
  companyName: string;
  exportedAt?: string;
}): { filename: string; bundle: EmployeeBackupExportBundle; json: string } {
  const exportedAt = params.exportedAt || new Date().toISOString();
  const datePart = exportedAt.slice(0, 10);
  const backups = params.backups || [];

  const filename =
    backups.length === 1
      ? `avy-worker-backup-${sanitizeDocId(backups[0].empCode)}-${datePart}.json`
      : `avy-removed-workers-backup-${datePart}.json`;

  const bundle: EmployeeBackupExportBundle = {
    format: 'avy_infra_worker_backup_v1',
    exportedAt,
    companyName: clampText(params.companyName, 120) || 'AVY INFRA',
    count: backups.length,
    backups,
  };

  return {
    filename,
    bundle,
    json: JSON.stringify(bundle, null, 2),
  };
}

const VALID_ROLES = new Set<EmployeeRole>([
  'Mason',
  'Helper',
  'Material Shifting',
  'Supervisor',
  'Engineer',
]);

function normalizeParsedBackup(
  raw: unknown,
  ownerId: string
): RemovedEmployeeBackup | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const snapRaw = (obj.employeeSnapshot || obj) as Record<string, unknown>;
  const fullName = clampText(snapRaw.fullName ?? obj.fullName, 100);
  const empCode = clampText(snapRaw.empCode ?? obj.empCode, 32);
  const phone = clampText(snapRaw.phone ?? obj.phone, 24);
  if (!fullName || !empCode || !phone) return null;

  const rawRole = String(snapRaw.role ?? obj.role ?? 'Mason') as EmployeeRole;
  const role: EmployeeRole = VALID_ROLES.has(rawRole) ? rawRole : 'Mason';
  const nowIso = new Date().toISOString();
  const joiningDate = clampText(snapRaw.joiningDate ?? obj.joiningDate, 24) || nowIso.slice(0, 10);
  const employeeId = sanitizeDocId(
    String(snapRaw.id ?? obj.employeeId ?? `emp_${empCode.toLowerCase()}`)
  ).slice(0, 120);

  const employeeSnapshot: Employee = {
    id: employeeId,
    ownerId,
    empCode,
    fullName,
    role,
    phone,
    alternatePhone: clampText(snapRaw.alternatePhone, 24),
    email: clampText(snapRaw.email, 120),
    joiningDate,
    dailyRate: Math.max(0, Number(snapRaw.dailyRate) || 0),
    overtimeRate: Math.max(0, Number(snapRaw.overtimeRate) || 0),
    foodAllowanceDaily: Math.max(0, Number(snapRaw.foodAllowanceDaily) || 0),
    aadharRef: clampText(snapRaw.aadharRef, 40),
    pfNumber: clampText(snapRaw.pfNumber, 60),
    esiNumber: clampText(snapRaw.esiNumber, 60),
    bloodGroup: clampText(snapRaw.bloodGroup, 12),
    emergencyContact: clampText(snapRaw.emergencyContact, 120),
    photoDataUrl:
      typeof snapRaw.photoDataUrl === 'string' ? snapRaw.photoDataUrl.slice(0, 120_000) : '',
    currentProjectId: clampText(snapRaw.currentProjectId, 128),
    currentProjectName: clampText(snapRaw.currentProjectName, 120),
    currentTowerId: clampText(snapRaw.currentTowerId, 128),
    currentTowerName: clampText(snapRaw.currentTowerName, 80),
    assignedTowerIds: Array.isArray(snapRaw.assignedTowerIds)
      ? snapRaw.assignedTowerIds.map((id) => clampText(id, 128)).filter(Boolean).slice(0, 30)
      : [],
    skillTags: normalizeSkillTags(
      Array.isArray(snapRaw.skillTags) ? (snapRaw.skillTags as string[]) : []
    ),
    loginPin: clampText(snapRaw.loginPin, 24) || '1234',
    qrToken: clampText(snapRaw.qrToken, 48),
    status: snapRaw.status === 'inactive' ? 'inactive' : 'active',
    notes: clampText(snapRaw.notes, 400),
    createdAt: clampText(snapRaw.createdAt, 40) || nowIso,
    updatedAt: clampText(snapRaw.updatedAt, 40) || nowIso,
  };

  const rawDocs = Array.isArray(obj.documents) ? obj.documents : [];
  const documents: EmployeeDocument[] = rawDocs
    .filter((d): d is Record<string, unknown> => Boolean(d && typeof d === 'object'))
    .slice(0, 10)
    .map((d, index) => ({
      id: sanitizeDocId(String(d.id || `doc_${employeeId}_${index}`)).slice(0, 120),
      ownerId,
      employeeId,
      docCategory: (d.docCategory === 'aadhar_pdf' ? 'aadhar_pdf' : 'other') as EmployeeDocument['docCategory'],
      title: clampText(d.title, 100) || 'Document',
      fileName: clampText(d.fileName, 160) || 'document.pdf',
      mimeType: clampText(d.mimeType, 80) || 'application/pdf',
      sizeBytes: Math.max(1, Number(d.sizeBytes) || 1),
      dataUrl: typeof d.dataUrl === 'string' ? d.dataUrl.slice(0, 850_000) : '',
      createdAt: clampText(d.createdAt, 40) || nowIso,
      updatedAt: clampText(d.updatedAt, 40) || nowIso,
    }))
    .filter((d) => Boolean(d.dataUrl));

  const rawSummary =
    obj.summary && typeof obj.summary === 'object'
      ? (obj.summary as Record<string, unknown>)
      : {};

  const summary: EmployeeBackupSummary = {
    attendanceCount: Math.max(0, Number(rawSummary.attendanceCount) || 0),
    presentDays: Math.max(0, Number(rawSummary.presentDays) || 0),
    halfDays: Math.max(0, Number(rawSummary.halfDays) || 0),
    absentDays: Math.max(0, Number(rawSummary.absentDays) || 0),
    totalWagesEarned: Math.max(0, Number(rawSummary.totalWagesEarned) || 0),
    totalAdvances: Math.max(0, Number(rawSummary.totalAdvances) || 0),
    totalSettled: Math.max(0, Number(rawSummary.totalSettled) || 0),
    netPayable: Number(rawSummary.netPayable) || 0,
    deploymentsCount: Math.max(0, Number(rawSummary.deploymentsCount) || 0),
    assignmentsCount: Math.max(0, Number(rawSummary.assignmentsCount) || 0),
    documentsCount: Math.max(documents.length, Number(rawSummary.documentsCount) || 0),
  };

  return {
    id: sanitizeDocId(String(obj.id || `bak_${empCode.toLowerCase()}_${Date.now().toString(36)}`)).slice(0, 120),
    ownerId,
    employeeId,
    empCode,
    fullName,
    role,
    phone,
    joiningDate,
    removedAt: clampText(obj.removedAt, 40) || nowIso,
    removedByName: clampText(obj.removedByName, 100) || 'Admin',
    removalReason: clampText(obj.removalReason, 300),
    employeeSnapshot,
    documents,
    summary,
    createdAt: clampText(obj.createdAt, 40) || nowIso,
    updatedAt: clampText(obj.updatedAt, 40) || nowIso,
  };
}

export function parseEmployeeBackupJson(
  jsonText: string,
  ownerId: string
): { ok: true; backups: RemovedEmployeeBackup[] } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const candidates: unknown[] = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { backups?: unknown[] }).backups)
        ? (parsed as { backups: unknown[] }).backups
        : [parsed];

    const backups = candidates
      .map((item) => normalizeParsedBackup(item, ownerId))
      .filter((b): b is RemovedEmployeeBackup => Boolean(b));

    if (backups.length === 0) {
      return {
        ok: false,
        error: 'No valid AVY INFRA worker backup records were found in that JSON file.',
      };
    }

    return { ok: true, backups };
  } catch {
    return {
      ok: false,
      error: 'Invalid JSON backup file. Please choose a valid .json worker backup exported from AVY INFRA.',
    };
  }
}

export function filterRemovedEmployeeBackups(
  backups: RemovedEmployeeBackup[],
  searchQuery: string,
  roleFilter: 'All' | EmployeeRole = 'All'
): RemovedEmployeeBackup[] {
  const q = searchQuery.trim().toLowerCase();
  return [...(backups || [])]
    .filter((b) => {
      if (roleFilter !== 'All' && b.role !== roleFilter) return false;
      if (!q) return true;
      const snap = b.employeeSnapshot;
      return (
        b.fullName.toLowerCase().includes(q) ||
        b.empCode.toLowerCase().includes(q) ||
        b.phone.toLowerCase().includes(q) ||
        (b.removalReason || '').toLowerCase().includes(q) ||
        (snap?.aadharRef || '').toLowerCase().includes(q) ||
        (snap?.pfNumber || '').toLowerCase().includes(q) ||
        (snap?.esiNumber || '').toLowerCase().includes(q) ||
        (snap?.currentProjectName || '').toLowerCase().includes(q) ||
        (snap?.skillTags || []).some((t) => t.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => (b.removedAt || b.createdAt).localeCompare(a.removedAt || a.createdAt));
}

export function prepareEmployeeRestorePayload(params: {
  backup: RemovedEmployeeBackup;
  existingEmployees: Employee[];
  existingDocuments: EmployeeDocument[];
  projects: Project[];
  towers: Tower[];
  ownerId: string;
  nowIso?: string;
}): {
  employee: Employee;
  documentsToRestore: EmployeeDocument[];
  codeReassigned: boolean;
} {
  const nowIso = params.nowIso || new Date().toISOString();
  const snap = params.backup.employeeSnapshot;
  const existingIds = new Set(params.existingEmployees.map((e) => e.id));
  const existingCodes = new Set(
    params.existingEmployees.map((e) => e.empCode.trim().toUpperCase())
  );

  const restoredId = existingIds.has(snap.id)
    ? sanitizeDocId(`${snap.id}_restored_${Date.now().toString(36)}`).slice(0, 120)
    : snap.id;

  const codeTaken = existingCodes.has(snap.empCode.trim().toUpperCase());
  const restoredEmpCode = codeTaken
    ? generateEmployeeCode(snap.role, params.existingEmployees)
    : snap.empCode;

  const projectMatch = params.projects.find((p) => p.id === snap.currentProjectId);
  const towerMatch = params.towers.find(
    (t) => t.id === snap.currentTowerId && (!projectMatch || t.projectId === projectMatch.id)
  );
  const validTowerIds = new Set(params.towers.map((t) => t.id));
  const assignedTowerIds = Array.isArray(snap.assignedTowerIds)
    ? snap.assignedTowerIds.filter((tid) => validTowerIds.has(tid)).slice(0, 30)
    : [];

  const existingQrTokens = new Set(
    params.existingEmployees.map((e) => e.qrToken).filter(Boolean)
  );
  const qrToken =
    snap.qrToken && snap.qrToken.length >= 16 && !existingQrTokens.has(snap.qrToken)
      ? snap.qrToken
      : generateQrPassToken();

  const employee: Employee = {
    ...snap,
    id: restoredId,
    ownerId: params.ownerId,
    empCode: restoredEmpCode,
    currentProjectId: projectMatch ? projectMatch.id : '',
    currentProjectName: projectMatch ? projectMatch.name : '',
    currentTowerId: towerMatch ? towerMatch.id : '',
    currentTowerName: towerMatch ? towerMatch.name : '',
    assignedTowerIds,
    skillTags: normalizeSkillTags(snap.skillTags),
    qrToken,
    status: 'active',
    createdAt: snap.createdAt || nowIso,
    updatedAt: nowIso,
  };

  const existingDocIds = new Set(params.existingDocuments.map((d) => d.id));
  const documentsToRestore: EmployeeDocument[] = (params.backup.documents || [])
    .filter((d) => Boolean(d.dataUrl))
    .map((d, idx) => {
      const nextDocId = existingDocIds.has(d.id)
        ? sanitizeDocId(`doc_${restoredId}_${Date.now().toString(36)}_${idx}`).slice(0, 120)
        : d.id;
      return {
        ...d,
        id: nextDocId,
        ownerId: params.ownerId,
        employeeId: restoredId,
        createdAt: d.createdAt || nowIso,
        updatedAt: nowIso,
      };
    });

  return {
    employee,
    documentsToRestore,
    codeReassigned: codeTaken,
  };
}
