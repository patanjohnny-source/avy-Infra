import QRCode from 'qrcode';
import { getTodayIso } from '../data/seedData';
import type { WorkspaceSnapshot } from '../data/seedData';
import { clampString, sanitizeId, stripUndefinedDeep } from '../lib/firebase';
import type {
  AssignmentStatus,
  AttendanceRecord,
  AttendanceStatus,
  DeploymentRecord,
  Employee,
  EmployeeRole,
  Project,
  QrActiveAssignmentSummary,
  QrDeploymentSummary,
  QrPassRecord,
  QrScannedProfile,
  Tower,
  WorkAssignment,
} from '../types/avy';

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateQrPassToken(length = 20): string {
  const safeLen = Math.max(16, Math.min(32, length));
  let chars = '';
  const globalCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(safeLen);
    globalCrypto.getRandomValues(bytes);
    for (let i = 0; i < safeLen; i++) {
      chars += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
    }
  } else {
    for (let i = 0; i < safeLen; i++) {
      chars += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
    }
  }
  return `qrp_${chars}`;
}

export function buildEmployeeQrPassData(params: {
  employee: Employee;
  companyName: string;
  projects: Project[];
  towers: Tower[];
  deployments: DeploymentRecord[];
  assignments: WorkAssignment[];
  attendance: AttendanceRecord[];
  todayIso?: string;
}): Omit<QrPassRecord, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'> {
  const { employee, companyName, projects, towers, deployments, assignments, attendance } = params;
  const today = params.todayIso || getTodayIso();

  const currentProject = projects.find((p) => p.id === employee.currentProjectId);
  const currentTower = towers.find((t) => t.id === employee.currentTowerId);

  const empDeployments = deployments
    .filter((d) => d.employeeId === employee.id)
    .sort((a, b) => b.assignedDate.localeCompare(a.assignedDate));

  const recentDeployments: QrDeploymentSummary[] = empDeployments.slice(0, 5).map((d) => ({
    projectName: clampString(d.projectName, 120) || 'Site',
    towerName: clampString(d.towerName, 80) || 'Tower',
    assignedDate: clampString(d.assignedDate, 24) || employee.joiningDate,
    notes: clampString(d.notes, 160),
  }));

  const deployedSince = empDeployments[0]?.assignedDate || employee.joiningDate || today;

  const empAssignments = assignments
    .filter((a) => a.employeeId === employee.id)
    .sort((a, b) => {
      const rank = (s: AssignmentStatus) =>
        s === 'in_progress'
          ? 0
          : s === 'cleaning_in_progress'
            ? 1
            : s === 'prechecking'
              ? 2
              : s === 'assigned'
                ? 3
                : 4;
      const diff = rank(a.status) - rank(b.status);
      return diff !== 0 ? diff : b.assignedDate.localeCompare(a.assignedDate);
    });

  const activeAssignments: QrActiveAssignmentSummary[] = empAssignments
    .filter(
      (a) =>
        a.status === 'assigned' ||
        a.status === 'prechecking' ||
        a.status === 'in_progress' ||
        a.status === 'cleaning_in_progress'
    )
    .slice(0, 10)
    .map((a) => ({
      unitNumber: clampString(a.unitNumber, 24) || 'Unit',
      projectName: clampString(a.projectName, 120) || 'Project',
      towerName: clampString(a.towerName, 80) || 'Tower',
      zoneLabel: clampString(a.zoneLabel, 80) || 'Tile Work',
      status: a.status,
      assignedDate: clampString(a.assignedDate, 24) || today,
      targetSqft: Math.max(0, Math.min(100000, Number(a.targetSqft) || 0)),
    }));

  const completedZonesCount = empAssignments.filter(
    (a) => a.status === 'completed' || a.status === 'cleaning_done' || a.status === 'qc_approved'
  ).length;

  const todayAttendance = attendance.find(
    (a) => a.employeeId === employee.id && a.date === today
  );

  return stripUndefinedDeep({
    employeeId: employee.id,
    empCode: clampString(employee.empCode, 32) || 'AVY-EMP',
    fullName: clampString(employee.fullName, 100) || 'Worker',
    role: employee.role,
    status: employee.status,
    companyName: clampString(companyName, 120) || 'AVY INFRA',
    joiningDate: clampString(employee.joiningDate, 24) || today,
    currentProjectName: clampString(
      currentProject?.name || employee.currentProjectName,
      120
    ),
    currentTowerName: clampString(
      currentTower?.name || employee.currentTowerName,
      80
    ),
    deployedSince: clampString(deployedSince, 24) || today,
    todayAttendanceStatus: (todayAttendance?.status || 'unmarked') as AttendanceStatus | 'unmarked',
    todayAttendanceDate: today,
    completedZonesCount,
    activeAssignments,
    recentDeployments,
  });
}

// Compact payload v1 for short, fast-scanning QR URLs
interface CompactQrPayloadV1 {
  v: 1;
  id: string;
  c: string; // empCode
  n: string; // fullName
  r: EmployeeRole;
  s: 'a' | 'i'; // active | inactive
  co: string; // companyName
  j: string; // joiningDate
  p: string; // currentProjectName
  t: string; // currentTowerName
  ds: string; // deployedSince
  att: 'p' | 'h' | 'a' | 'u'; // present | half_day | absent | unmarked
  ad: string; // todayAttendanceDate
  cc: number; // completedZonesCount
  w: Array<[string, string, string, string, 'a' | 'p' | 'k' | 'c', string, number]>; // unit, proj, twr, zone, status, date, sqft
  dp: Array<[string, string, string]>; // proj, twr, date
}

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(encoded: string): string {
  const padLen = (4 - (encoded.length % 4)) % 4;
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  if (typeof atob === 'function') {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function encodeQrSnapshot(
  pass: Omit<QrPassRecord, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): string {
  const attCode =
    pass.todayAttendanceStatus === 'present'
      ? 'p'
      : pass.todayAttendanceStatus === 'half_day'
        ? 'h'
        : pass.todayAttendanceStatus === 'absent'
          ? 'a'
          : 'u';

  const compact: CompactQrPayloadV1 = {
    v: 1,
    id: pass.employeeId,
    c: pass.empCode,
    n: pass.fullName,
    r: pass.role,
    s: pass.status === 'active' ? 'a' : 'i',
    co: pass.companyName,
    j: pass.joiningDate,
    p: pass.currentProjectName,
    t: pass.currentTowerName,
    ds: pass.deployedSince,
    att: attCode,
    ad: pass.todayAttendanceDate,
    cc: pass.completedZonesCount,
    w: pass.activeAssignments.slice(0, 4).map((w) => [
      w.unitNumber,
      w.projectName,
      w.towerName,
      w.zoneLabel,
      w.status === 'in_progress'
        ? 'p'
        : w.status === 'prechecking'
          ? 'k'
          : w.status === 'cleaning_in_progress'
            ? 'c'
            : 'a',
      w.assignedDate,
      w.targetSqft,
    ]),
    dp: pass.recentDeployments.slice(0, 3).map((d) => [
      d.projectName,
      d.towerName,
      d.assignedDate,
    ]),
  };

  return toBase64Url(JSON.stringify(compact));
}

export function decodeQrSnapshot(encoded: string): QrScannedProfile | null {
  if (!encoded || typeof encoded !== 'string') return null;
  try {
    const raw = JSON.parse(fromBase64Url(encoded.trim())) as Partial<CompactQrPayloadV1>;
    if (!raw || raw.v !== 1 || !raw.c || !raw.n) return null;

    const attStatus: AttendanceStatus | 'unmarked' =
      raw.att === 'p'
        ? 'present'
        : raw.att === 'h'
          ? 'half_day'
          : raw.att === 'a'
            ? 'absent'
            : 'unmarked';

    return {
      employeeId: String(raw.id || ''),
      empCode: String(raw.c),
      fullName: String(raw.n),
      role: (raw.r || 'Mason') as EmployeeRole,
      status: raw.s === 'i' ? 'inactive' : 'active',
      companyName: String(raw.co || 'AVY INFRA'),
      joiningDate: String(raw.j || ''),
      currentProjectName: String(raw.p || ''),
      currentTowerName: String(raw.t || ''),
      deployedSince: String(raw.ds || raw.j || ''),
      todayAttendanceStatus: attStatus,
      todayAttendanceDate: String(raw.ad || ''),
      completedZonesCount: Number(raw.cc) || 0,
      activeAssignments: Array.isArray(raw.w)
        ? raw.w.map((item) => ({
            unitNumber: String(item[0] || ''),
            projectName: String(item[1] || ''),
            towerName: String(item[2] || ''),
            zoneLabel: String(item[3] || ''),
            status:
              item[4] === 'p'
                ? 'in_progress'
                : item[4] === 'k'
                  ? 'prechecking'
                  : item[4] === 'c'
                    ? 'cleaning_in_progress'
                    : 'assigned',
            assignedDate: String(item[5] || ''),
            targetSqft: Number(item[6]) || 0,
          }))
        : [],
      recentDeployments: Array.isArray(raw.dp)
        ? raw.dp.map((item) => ({
            projectName: String(item[0] || ''),
            towerName: String(item[1] || ''),
            assignedDate: String(item[2] || ''),
            notes: '',
          }))
        : [],
      updatedAt: String(raw.ad || ''),
    };
  } catch {
    return null;
  }
}

export interface QrScanParams {
  qrToken: string;
  qrEmp: string;
  qrEncoded: string;
  hasQrScanRoute: boolean;
}

export function parseQrScanParams(search: string): QrScanParams {
  const sp = new URLSearchParams(search || '');
  const rawToken = sp.get('qrToken')?.trim() || '';
  const qrToken = rawToken ? sanitizeId(rawToken) : '';
  const qrEmp = sp.get('qrEmp')?.trim() || '';
  const qrEncoded = sp.get('qr')?.trim() || '';
  const hasQrScanRoute = Boolean(
    (qrToken && qrToken.length >= 16) || qrEmp || qrEncoded
  );
  return {
    qrToken,
    qrEmp,
    qrEncoded,
    hasQrScanRoute,
  };
}

export function buildEmployeeQrScanUrl(params: {
  origin: string;
  passData: Omit<QrPassRecord, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>;
  qrToken?: string;
}): string {
  const base = params.origin.replace(/\/$/, '');
  const search = new URLSearchParams();
  if (params.qrToken && params.qrToken.length >= 16) {
    search.set('qrToken', params.qrToken);
  }
  search.set('qrEmp', params.passData.employeeId);
  search.set('qr', encodeQrSnapshot(params.passData));
  return `${base}/?${search.toString()}`;
}

export function resolveScannedQrProfile(params: {
  scanParams: QrScanParams;
  liveWorkspace?: WorkspaceSnapshot | null;
  remoteQrPass?: QrPassRecord | null;
  todayIso?: string;
}): {
  profile: QrScannedProfile | null;
  source: 'live_workspace' | 'cloud_pass' | 'qr_snapshot' | 'none';
} {
  const { scanParams, liveWorkspace, remoteQrPass, todayIso } = params;

  // 1. Live workspace state takes highest precedence (when opened on admin/supervisor device or logged-in browser)
  if (liveWorkspace && liveWorkspace.employees.length > 0) {
    const matchedEmp = liveWorkspace.employees.find(
      (e) =>
        (scanParams.qrEmp &&
          (e.id === scanParams.qrEmp ||
            e.empCode.toLowerCase() === scanParams.qrEmp.toLowerCase())) ||
        (scanParams.qrToken && e.qrToken === scanParams.qrToken)
    );

    if (matchedEmp) {
      const liveData = buildEmployeeQrPassData({
        employee: matchedEmp,
        companyName: liveWorkspace.companyProfile?.companyName || 'AVY INFRA',
        projects: liveWorkspace.projects,
        towers: liveWorkspace.towers,
        deployments: liveWorkspace.deployments,
        assignments: liveWorkspace.assignments,
        attendance: liveWorkspace.attendance,
        todayIso,
      });
      return {
        source: 'live_workspace',
        profile: {
          ...liveData,
          photoDataUrl: matchedEmp.photoDataUrl,
          updatedAt: matchedEmp.updatedAt || todayIso || getTodayIso(),
        },
      };
    }
  }

  // 2. Remote Firestore non-PII public QR Pass (always up-to-date across phones when Cloud Sync is used)
  if (remoteQrPass) {
    return {
      source: 'cloud_pass',
      profile: {
        employeeId: remoteQrPass.employeeId,
        empCode: remoteQrPass.empCode,
        fullName: remoteQrPass.fullName,
        role: remoteQrPass.role,
        status: remoteQrPass.status,
        companyName: remoteQrPass.companyName,
        joiningDate: remoteQrPass.joiningDate,
        currentProjectName: remoteQrPass.currentProjectName,
        currentTowerName: remoteQrPass.currentTowerName,
        deployedSince: remoteQrPass.deployedSince,
        todayAttendanceStatus: remoteQrPass.todayAttendanceStatus,
        todayAttendanceDate: remoteQrPass.todayAttendanceDate,
        completedZonesCount: remoteQrPass.completedZonesCount,
        activeAssignments: remoteQrPass.activeAssignments || [],
        recentDeployments: remoteQrPass.recentDeployments || [],
        updatedAt: remoteQrPass.updatedAt,
      },
    };
  }

  // 3. Embedded compact QR snapshot fallback (works offline or in standalone local/demo mode)
  const decoded = decodeQrSnapshot(scanParams.qrEncoded);
  if (decoded) {
    return {
      source: 'qr_snapshot',
      profile: decoded,
    };
  }

  return { profile: null, source: 'none' };
}

export async function generateQrSvgString(value: string): Promise<string> {
  return QRCode.toString(value, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}

export async function generateQrPngDataUrl(value: string, width = 280): Promise<string> {
  return QRCode.toDataURL(value, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}
