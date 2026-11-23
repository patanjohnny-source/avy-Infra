import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedWorkspace } from '../data/seedData';
import {
  authenticateWorkspaceUser,
  canAccessWorkspaceSection,
  canSupervisorUpdateEmployee,
  canViewEmployeeFixedSalary,
  evaluateAttendanceMutation,
  getScopedEmployees,
  getScopedExpenses,
  getScopedFlats,
  getScopedProjects,
  getScopedTowers,
} from './authAccess';

test('authenticates admin, supervisor, and employee accounts with clear rejections', () => {
  const seed = createSeedWorkspace('test-owner');
  // Ensure Tower A assignment matches Prakash Reddy
  const employees = seed.employees.map((e) =>
    e.id === 'emp_avy_sup_005' ? { ...e, assignedTowerIds: ['twr_skyline_a'], loginPin: '1234' } : { ...e, loginPin: '1234' }
  );

  // Admin login success
  const adminOk = authenticateWorkspaceUser({
    role: 'admin',
    identifier: 'admin',
    secret: 'admin123',
    companyProfile: seed.companyProfile,
    employees,
    towers: seed.towers,
  });
  assert.equal(adminOk.ok, true);
  if (adminOk.ok) {
    assert.equal(adminOk.session.role, 'admin');
  }

  // Admin wrong password
  const adminBad = authenticateWorkspaceUser({
    role: 'admin',
    identifier: 'admin',
    secret: 'wrongpass',
    companyProfile: seed.companyProfile,
    employees,
    towers: seed.towers,
  });
  assert.equal(adminBad.ok, false);

  // Supervisor login by empCode & phone
  const supOk = authenticateWorkspaceUser({
    role: 'supervisor',
    identifier: 'avy-sup-005',
    secret: '1234',
    companyProfile: seed.companyProfile,
    employees,
    towers: seed.towers,
  });
  assert.equal(supOk.ok, true);
  if (supOk.ok) {
    assert.equal(supOk.session.role, 'supervisor');
    assert.deepEqual(supOk.session.assignedTowerIds, ['twr_skyline_a']);
  }

  // Non-supervisor rejected on supervisor login
  const supRejectMason = authenticateWorkspaceUser({
    role: 'supervisor',
    identifier: 'AVY-MSN-001',
    secret: '1234',
    companyProfile: seed.companyProfile,
    employees,
    towers: seed.towers,
  });
  assert.equal(supRejectMason.ok, false);

  // Employee login by phone
  const empOk = authenticateWorkspaceUser({
    role: 'employee',
    identifier: '9848011223',
    secret: '1234',
    companyProfile: seed.companyProfile,
    employees,
    towers: seed.towers,
  });
  assert.equal(empOk.ok, true);
  if (empOk.ok) {
    assert.equal(empOk.session.role, 'employee');
    assert.equal(empOk.session.employeeId, 'emp_avy_msn_001');
  }
});

test('supervisor sees only assigned tower projects, flats, under-employees, and expenses', () => {
  const seed = createSeedWorkspace('test-owner');
  const employees = seed.employees.map((e) =>
    e.id === 'emp_avy_sup_005' ? { ...e, assignedTowerIds: ['twr_skyline_a'], loginPin: '1234' } : { ...e, loginPin: '1234' }
  );
  const auth = authenticateWorkspaceUser({
    role: 'supervisor',
    identifier: 'AVY-SUP-005',
    secret: '1234',
    companyProfile: seed.companyProfile,
    employees,
    towers: seed.towers,
  });
  assert.equal(auth.ok, true);
  if (!auth.ok) return;

  const scopedTowers = getScopedTowers(auth.session, seed.towers);
  assert.deepEqual(scopedTowers.map((t) => t.id), ['twr_skyline_a']);

  const scopedProjects = getScopedProjects(auth.session, seed.projects, seed.towers);
  assert.deepEqual(scopedProjects.map((p) => p.id), ['proj_skyline_heights']);

  const scopedEmps = getScopedEmployees(auth.session, employees);
  const scopedEmpIds = scopedEmps.map((e) => e.id);
  assert.ok(scopedEmpIds.includes('emp_avy_msn_001')); // Raju Tower A
  assert.ok(scopedEmpIds.includes('emp_avy_hlp_003')); // Suresh Tower A
  assert.ok(scopedEmpIds.includes('emp_avy_msh_004')); // Venkatesh Tower A
  assert.equal(scopedEmpIds.includes('emp_avy_msn_002'), false); // Imran Tower B excluded
  assert.equal(scopedEmpIds.includes('emp_avy_eng_006'), false); // Anil Block C excluded

  const imran = employees.find((e) => e.id === 'emp_avy_msn_002')!;
  const raju = employees.find((e) => e.id === 'emp_avy_msn_001')!;
  assert.equal(canSupervisorUpdateEmployee(auth.session, raju), true);
  assert.equal(canSupervisorUpdateEmployee(auth.session, imran), false);

  const scopedFlats = getScopedFlats(auth.session, seed.flats);
  assert.ok(scopedFlats.every((f) => f.towerId === 'twr_skyline_a'));

  const scopedExps = getScopedExpenses(auth.session, seed.expenses);
  assert.ok(scopedExps.every((e) => e.towerId === 'twr_skyline_a'));
});

test('supervisor cannot directly edit already-marked attendance without Edit feature and PIN/permission', () => {
  const seed = createSeedWorkspace('test-owner');
  const existing = seed.attendance[0];
  const supSession = {
    role: 'supervisor' as const,
    displayName: 'Prakash Reddy',
    employeeId: 'emp_avy_sup_005',
    empCode: 'AVY-SUP-005',
    assignedTowerIds: ['twr_skyline_a'],
    loginAt: '2026-01-01T00:00:00.000Z',
  };

  // Unmarked date can be marked directly
  const unmarkedEval = evaluateAttendanceMutation({
    session: supSession,
    existingRecord: undefined,
    companyProfile: seed.companyProfile,
  });
  assert.equal(unmarkedEval.allowed, true);
  assert.equal(unmarkedEval.mode, 'mark');

  // Already marked record is locked against direct inline overwrite
  const inlineOverwrite = evaluateAttendanceMutation({
    session: supSession,
    existingRecord: existing,
    companyProfile: seed.companyProfile,
    isExplicitEdit: false,
  });
  assert.equal(inlineOverwrite.allowed, false);
  assert.equal(inlineOverwrite.locked, true);

  // Explicit Edit with wrong PIN fails
  const wrongPinEdit = evaluateAttendanceMutation({
    session: supSession,
    existingRecord: existing,
    companyProfile: { ...seed.companyProfile, adminEditPin: '9999', supervisorCanEditAttendance: false },
    isExplicitEdit: true,
    adminPinInput: '1234',
    editReason: 'Worker arrived after lunch',
  });
  assert.equal(wrongPinEdit.allowed, false);
  assert.equal(wrongPinEdit.requiresAdminPin, true);

  // Explicit Edit with right PIN + reason succeeds
  const validPinEdit = evaluateAttendanceMutation({
    session: supSession,
    existingRecord: existing,
    companyProfile: { ...seed.companyProfile, adminEditPin: '9999', supervisorCanEditAttendance: false },
    isExplicitEdit: true,
    adminPinInput: '9999',
    editReason: 'Corrected from absent to half-day',
  });
  assert.equal(validPinEdit.allowed, true);
  assert.equal(validPinEdit.mode, 'edit');

  // When Admin unlocks supervisor editing globally, reason alone suffices
  const unlockedEdit = evaluateAttendanceMutation({
    session: supSession,
    existingRecord: existing,
    companyProfile: { ...seed.companyProfile, supervisorCanEditAttendance: true },
    isExplicitEdit: true,
    editReason: 'Corrected OT hours',
  });
  assert.equal(unlockedEdit.allowed, true);

  // Admin can edit directly
  const adminEdit = evaluateAttendanceMutation({
    session: { role: 'admin', displayName: 'Admin', assignedTowerIds: [], loginAt: '' },
    existingRecord: existing,
    companyProfile: seed.companyProfile,
    isExplicitEdit: false,
  });
  assert.equal(adminEdit.allowed, true);

  // Employee is read-only
  const empBlocked = evaluateAttendanceMutation({
    session: { role: 'employee', displayName: 'Raju', employeeId: 'emp_avy_msn_001', assignedTowerIds: [], loginAt: '' },
    existingRecord: undefined,
    companyProfile: seed.companyProfile,
  });
  assert.equal(empBlocked.allowed, false);
});

test('supervisor cannot access Docs & Letters or Invoices & Quotes and cannot view employee fixed salaries', () => {
  const adminSession = {
    role: 'admin' as const,
    displayName: 'Admin',
    assignedTowerIds: [],
    loginAt: '2026-01-01T00:00:00.000Z',
  };
  const supSession = {
    role: 'supervisor' as const,
    displayName: 'Prakash Reddy',
    employeeId: 'emp_avy_sup_005',
    empCode: 'AVY-SUP-005',
    assignedTowerIds: ['twr_skyline_a'],
    loginAt: '2026-01-01T00:00:00.000Z',
  };
  const empSession = {
    role: 'employee' as const,
    displayName: 'Raju',
    employeeId: 'emp_avy_msn_001',
    assignedTowerIds: [],
    loginAt: '2026-01-01T00:00:00.000Z',
  };

  assert.equal(canAccessWorkspaceSection(adminSession, 'billing'), true);
  assert.equal(canAccessWorkspaceSection(adminSession, 'documents'), true);
  assert.equal(canAccessWorkspaceSection(supSession, 'billing'), false);
  assert.equal(canAccessWorkspaceSection(supSession, 'documents'), false);

  for (const allowed of ['overview', 'projects', 'workforce', 'payroll', 'expenses', 'sitelogs', 'messenger'] as const) {
    assert.equal(canAccessWorkspaceSection(supSession, allowed), true);
    assert.equal(canAccessWorkspaceSection(adminSession, allowed), true);
  }

  assert.equal(canAccessWorkspaceSection(empSession, 'overview'), false);
  assert.equal(canAccessWorkspaceSection(null, 'overview'), false);

  assert.equal(canViewEmployeeFixedSalary(adminSession), true);
  assert.equal(canViewEmployeeFixedSalary(supSession), false);
  assert.equal(canViewEmployeeFixedSalary(empSession), false);
  assert.equal(canViewEmployeeFixedSalary(null), false);
});
