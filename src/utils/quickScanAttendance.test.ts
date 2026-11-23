import test from 'node:test';
import assert from 'node:assert/strict';
import type { AttendanceRecord, Employee, Project, Tower } from '../types/avy';
import {
  buildEmployeeQrPassData,
  buildEmployeeQrScanUrl,
  buildSiteQrPassData,
  buildSiteQrScanUrl,
} from './qrProfile';
import {
  resolveQuickScanInput,
  resolveSiteQrScanInput,
  validateQuickScanCandidate,
} from './quickScanAttendance';

const mkEmp = (overrides: Partial<Employee> = {}): Employee => ({
  id: 'emp_raju',
  ownerId: 'u1',
  empCode: 'AVY-MSN-001',
  fullName: 'Raju Kumar',
  role: 'Mason',
  phone: '9848011223',
  joiningDate: '2025-01-01',
  dailyRate: 1000,
  overtimeRate: 150,
  foodAllowanceDaily: 150,
  aadharRef: '',
  emergencyContact: '',
  currentProjectId: 'p1',
  currentProjectName: 'Skyline',
  currentTowerId: 't1',
  currentTowerName: 'Tower A',
  qrToken: 'qrp_abc123456789xyz987',
  status: 'active',
  notes: '',
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

test('resolveQuickScanInput matches QR pass URLs, raw qrToken, empCode, phone, and unambiguous numeric suffix', () => {
  const raju = mkEmp();
  const kiran = mkEmp({
    id: 'emp_kiran',
    empCode: 'AVY-HLP-002',
    fullName: 'Kiran Rao',
    role: 'Helper',
    phone: '9848099887',
    qrToken: 'qrp_kiran998877665544',
    currentTowerId: 't2',
    currentTowerName: 'Tower B',
  });
  const roster = [raju, kiran];

  const passData = buildEmployeeQrPassData({
    employee: raju,
    companyName: 'AVY INFRA',
    projects: [],
    towers: [],
    deployments: [],
    assignments: [],
    attendance: [],
    todayIso: '2026-11-19',
  });
  const qrUrl = buildEmployeeQrScanUrl({
    origin: 'https://avy-site.app',
    passData,
    qrToken: raju.qrToken,
  });

  const fromUrl = resolveQuickScanInput(qrUrl, roster);
  assert.equal(fromUrl.ok, true);
  assert.equal(fromUrl.employee?.id, 'emp_raju');
  assert.equal(fromUrl.matchedBy, 'qr_token');

  const fromToken = resolveQuickScanInput('qrp_kiran998877665544', roster);
  assert.equal(fromToken.ok, true);
  assert.equal(fromToken.employee?.id, 'emp_kiran');

  const fromCode = resolveQuickScanInput('avy-msn-001', roster);
  assert.equal(fromCode.ok, true);
  assert.equal(fromCode.employee?.id, 'emp_raju');
  assert.equal(fromCode.matchedBy, 'emp_code');

  const fromPhone = resolveQuickScanInput('+91 9848099887', roster);
  assert.equal(fromPhone.ok, true);
  assert.equal(fromPhone.employee?.id, 'emp_kiran');

  const fromSuffix = resolveQuickScanInput('002', roster);
  assert.equal(fromSuffix.ok, true);
  assert.equal(fromSuffix.employee?.id, 'emp_kiran');

  const missing = resolveQuickScanInput('UNKNOWN-999', roster);
  assert.equal(missing.ok, false);
});

test('validateQuickScanCandidate prevents duplicate scans, unmarked/inactive workers, and out-of-tower supervisor scans', () => {
  const raju = mkEmp();
  const inactiveEmp = mkEmp({ id: 'emp_old', empCode: 'AVY-MSN-009', status: 'inactive' });
  const towerBEmp = mkEmp({
    id: 'emp_twrB',
    empCode: 'AVY-HLP-005',
    currentTowerId: 't2',
  });

  const existingAttendance: AttendanceRecord[] = [
    {
      id: 'att_raju',
      ownerId: 'u1',
      date: '2026-11-19',
      employeeId: 'emp_raju',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Kumar',
      employeeRole: 'Mason',
      projectId: 'p1',
      projectName: 'Skyline',
      towerId: 't1',
      towerName: 'Tower A',
      status: 'present',
      overtimeHours: 0,
      dailyWageEarned: 1000,
      overtimePayEarned: 0,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];

  // Clean scan for unmarked worker
  const okRes = validateQuickScanCandidate({
    employee: towerBEmp,
    date: '2026-11-19',
    existingAttendance,
    sessionLoggedIds: new Set(),
    session: { role: 'admin', assignedTowerIds: [] },
  });
  assert.equal(okRes.canLog, true);

  // Duplicate in same session
  const dupRes = validateQuickScanCandidate({
    employee: towerBEmp,
    date: '2026-11-19',
    existingAttendance,
    sessionLoggedIds: new Set(['emp_twrB']),
    session: { role: 'admin', assignedTowerIds: [] },
  });
  assert.equal(dupRes.canLog, false);
  assert.equal(dupRes.issue, 'duplicate_in_session');

  // Already marked earlier today
  const markedRes = validateQuickScanCandidate({
    employee: raju,
    date: '2026-11-19',
    existingAttendance,
    sessionLoggedIds: new Set(),
    session: { role: 'admin', assignedTowerIds: [] },
  });
  assert.equal(markedRes.canLog, false);
  assert.equal(markedRes.issue, 'already_marked_today');

  // Inactive employee blocked
  const inactiveRes = validateQuickScanCandidate({
    employee: inactiveEmp,
    date: '2026-11-19',
    existingAttendance,
    sessionLoggedIds: new Set(),
  });
  assert.equal(inactiveRes.canLog, false);
  assert.equal(inactiveRes.issue, 'inactive_employee');

  // Supervisor restricted to assignedTowerIds ['t1'] cannot scan Tower B worker
  const scopeRes = validateQuickScanCandidate({
    employee: towerBEmp,
    date: '2026-11-19',
    existingAttendance,
    sessionLoggedIds: new Set(),
    session: { role: 'supervisor', assignedTowerIds: ['t1'] },
  });
  assert.equal(scopeRes.canLog, false);
  assert.equal(scopeRes.issue, 'out_of_tower_scope');
});

import {
  applyUndoScanToSession,
  getRecentLoggedScans,
  type QuickScanSessionItem,
} from './quickScanAttendance';

test('getRecentLoggedScans and applyUndoScanToSession revert accidental scans and restore re-scan eligibility', () => {
  const kiran = mkEmp({
    id: 'emp_kiran',
    empCode: 'AVY-HLP-002',
    fullName: 'Kiran Rao',
    role: 'Helper',
  });
  const logs: QuickScanSessionItem[] = [
    {
      id: 'scan_2',
      timestamp: '09:05:10',
      scanDate: '2026-11-20',
      rawInput: 'AVY-HLP-002',
      employeeId: 'emp_kiran',
      empCode: 'AVY-HLP-002',
      employeeName: 'Kiran Rao',
      role: 'Helper',
      status: 'present',
      overtimeHours: 0,
      outcome: 'logged',
      message: 'Logged Present for AVY-HLP-002 Kiran Rao',
    },
    {
      id: 'scan_1',
      timestamp: '09:04:00',
      scanDate: '2026-11-20',
      rawInput: 'BAD-CODE',
      employeeName: 'Unrecognized Scan',
      status: 'present',
      outcome: 'blocked',
      message: 'No registered worker matched BAD-CODE',
    },
  ];

  const recentBefore = getRecentLoggedScans(logs);
  assert.equal(recentBefore.length, 1);
  assert.equal(recentBefore[0].id, 'scan_2');

  const undone = applyUndoScanToSession({
    logs,
    scannedEmployeeIds: ['emp_kiran'],
    logId: 'scan_2',
  });

  assert.ok(undone.undoneItem);
  assert.equal(undone.undoneItem?.employeeId, 'emp_kiran');
  assert.equal(undone.nextScannedEmployeeIds.length, 0);
  assert.equal(getRecentLoggedScans(undone.nextLogs).length, 0);
  assert.equal(undone.nextLogs[0].outcome, 'undone');

  // After attendance deletion in store + undo in session, worker can immediately be re-scanned
  const recheck = validateQuickScanCandidate({
    employee: kiran,
    date: '2026-11-20',
    existingAttendance: [],
    sessionLoggedIds: new Set(undone.nextScannedEmployeeIds),
    session: { role: 'admin', assignedTowerIds: [] },
  });
  assert.equal(recheck.canLog, true);
});

test('resolveSiteQrScanInput extracts project, tower, and checkpoint from generated site QR URLs', () => {
  const proj: Project = {
    id: 'proj_skyline',
    ownerId: 'u1',
    name: 'Skyline Heights Residency',
    location: 'Jubilee Hills, Hyderabad',
    clientName: 'Skyline Builders',
    startDate: '2026-01-01',
    finishDate: '2026-12-31',
    status: 'active',
    managerName: 'Srinivas',
    managerPhone: '9848000001',
    engineerName: 'Anil',
    engineerPhone: '9848000002',
    createdAt: '',
    updatedAt: '',
  };
  const towerA: Tower = {
    id: 'twr_a',
    ownerId: 'u1',
    projectId: 'proj_skyline',
    name: 'Tower A',
    totalFloors: 10,
    unitsPerFloor: 4,
    supervisorName: 'Prakash Reddy',
    supervisorPhone: '9848011229',
    createdAt: '',
    updatedAt: '',
  };

  const pass = buildSiteQrPassData({
    project: proj,
    tower: towerA,
    companyName: 'AVY INFRA',
    checkpointLabel: 'Attendance Check-In',
    employees: [],
    flats: [],
    attendance: [],
    todayIso: '2026-11-20',
  });
  const url = buildSiteQrScanUrl({
    origin: 'https://avy-site.app',
    passData: pass,
  });

  const matched = resolveSiteQrScanInput(url, [proj], [towerA]);
  assert.equal(matched.ok, true);
  assert.equal(matched.projectId, 'proj_skyline');
  assert.equal(matched.towerId, 'twr_a');
  assert.equal(matched.towerName, 'Tower A');
  assert.equal(matched.checkpointLabel, 'Attendance Check-In');

  const nonSite = resolveSiteQrScanInput('AVY-MSN-001', [proj], [towerA]);
  assert.equal(nonSite.ok, false);
});

test('validateQuickScanCandidate handles check_out mode for unmarked, absent, checked-in, and already checked-out workers', () => {
  const raju = mkEmp({ id: 'emp_raju' });
  const kiran = mkEmp({ id: 'emp_kiran', empCode: 'AVY-HLP-002' });
  const absentWorker = mkEmp({ id: 'emp_absent', empCode: 'AVY-HLP-003' });
  const checkedOutWorker = mkEmp({ id: 'emp_out', empCode: 'AVY-MSN-004' });

  const attendance: AttendanceRecord[] = [
    {
      id: 'att_raju',
      ownerId: 'u1',
      date: '2026-11-22',
      employeeId: 'emp_raju',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Kumar',
      employeeRole: 'Mason',
      projectId: 'p1',
      projectName: 'Skyline',
      towerId: 't1',
      towerName: 'Tower A',
      status: 'present',
      inTime: '09:05',
      overtimeHours: 0,
      dailyWageEarned: 1000,
      overtimePayEarned: 0,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'att_abs',
      ownerId: 'u1',
      date: '2026-11-22',
      employeeId: 'emp_absent',
      empCode: 'AVY-HLP-003',
      employeeName: 'Absent Worker',
      employeeRole: 'Helper',
      projectId: 'p1',
      projectName: 'Skyline',
      towerId: 't1',
      towerName: 'Tower A',
      status: 'absent',
      overtimeHours: 0,
      dailyWageEarned: 0,
      overtimePayEarned: 0,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'att_out',
      ownerId: 'u1',
      date: '2026-11-22',
      employeeId: 'emp_out',
      empCode: 'AVY-MSN-004',
      employeeName: 'Done Worker',
      employeeRole: 'Mason',
      projectId: 'p1',
      projectName: 'Skyline',
      towerId: 't1',
      towerName: 'Tower A',
      status: 'present',
      inTime: '09:00',
      outTime: '18:30',
      overtimeHours: 0,
      dailyWageEarned: 1000,
      overtimePayEarned: 0,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];

  // Checked in worker can check out
  const rajuOut = validateQuickScanCandidate({
    employee: raju,
    date: '2026-11-22',
    existingAttendance: attendance,
    sessionLoggedIds: new Set(),
    mode: 'check_out',
  });
  assert.equal(rajuOut.canLog, true);
  assert.equal(rajuOut.existingRecord?.id, 'att_raju');

  // Unmarked worker cannot check out
  const kiranOut = validateQuickScanCandidate({
    employee: kiran,
    date: '2026-11-22',
    existingAttendance: attendance,
    sessionLoggedIds: new Set(),
    mode: 'check_out',
  });
  assert.equal(kiranOut.canLog, false);
  assert.equal(kiranOut.issue, 'not_checked_in_yet');

  // Absent worker cannot check out
  const absOut = validateQuickScanCandidate({
    employee: absentWorker,
    date: '2026-11-22',
    existingAttendance: attendance,
    sessionLoggedIds: new Set(),
    mode: 'check_out',
  });
  assert.equal(absOut.canLog, false);
  assert.equal(absOut.issue, 'absent_cannot_checkout');

  // Already checked out worker blocked
  const doneOut = validateQuickScanCandidate({
    employee: checkedOutWorker,
    date: '2026-11-22',
    existingAttendance: attendance,
    sessionLoggedIds: new Set(),
    mode: 'check_out',
  });
  assert.equal(doneOut.canLog, false);
  assert.equal(doneOut.issue, 'already_checked_out');
});


