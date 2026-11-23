import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedWorkspace } from '../data/seedData';
import {
  buildNamespacedCloudSeedPayload,
  namespaceDocId,
} from './cloudSync';

test('namespaceDocId creates isolated per-user valid Firestore IDs under 128 chars', () => {
  const uidA = 'patanJohnUid123456789';
  const uidB = 'nw0qQ2SA6JYGszu1FmmOg7lS7Y03';

  const idA = namespaceDocId(uidA, 'proj_skyline_heights');
  const idB = namespaceDocId(uidB, 'proj_skyline_heights');

  assert.notEqual(idA, idB);
  assert.match(idA, /^[a-zA-Z0-9_\-]+$/);
  assert.match(idB, /^[a-zA-Z0-9_\-]+$/);
  assert.ok(idB.length <= 120);
  // Idempotent when called twice
  assert.equal(namespaceDocId(uidB, idB), idB);
});

test('buildNamespacedCloudSeedPayload remaps all foreign keys and supervisor assignedTowerIds consistently', () => {
  const uid = 'nw0qQ2SA6JYGszu1FmmOg7lS7Y03';
  const seed = createSeedWorkspace('local-avy-infra');

  const payload = buildNamespacedCloudSeedPayload(uid, seed, {
    adminUsername: 'admin',
    adminPassword: 'admin123',
    adminEditPin: '1234',
    userPin: '1234',
  });

  const projectIds = new Set(payload.projects.map((p) => p.id));
  const towerIds = new Set(payload.towers.map((t) => t.id));
  const flatIds = new Set(payload.flats.map((f) => f.id));
  const empIds = new Set(payload.employees.map((e) => e.id));

  assert.ok(projectIds.size > 0);
  assert.ok(towerIds.size > 0);
  assert.ok(flatIds.size > 0);
  assert.ok(empIds.size > 0);

  // Company profile docId uses uid
  assert.equal(payload.companyProfile.docId, `company_${uid}`);
  assert.equal(payload.companyProfile.ownerId, uid);

  // Towers reference mapped project IDs
  for (const t of payload.towers) {
    assert.ok(projectIds.has(String(t.data.projectId)));
    assert.equal(t.data.ownerId, uid);
  }

  // Supervisor assignedTowerIds and currentTowerId match mapped tower IDs
  const supervisor = payload.employees.find((e) => e.data.empCode === 'AVY-SUP-005');
  assert.ok(supervisor);
  const supTowers = supervisor.data.assignedTowerIds as string[];
  assert.equal(supTowers.length, 1);
  assert.ok(towerIds.has(supTowers[0]));
  assert.equal(supervisor.data.currentTowerId, supTowers[0]);

  // Flat zones assignedEmployeeId references mapped employee IDs
  const flat101 = payload.flats.find((f) => f.data.unitNumber === '101');
  assert.ok(flat101);
  const zones = flat101.data.zones as Record<string, { assignedEmployeeId?: string }>;
  assert.ok(zones.master_bedroom_flooring?.assignedEmployeeId);
  assert.ok(empIds.has(zones.master_bedroom_flooring.assignedEmployeeId!));

  // Deployments, assignments, attendance, advances, expenses reference mapped IDs
  for (const dep of payload.deployments) {
    assert.ok(empIds.has(String(dep.data.employeeId)));
    assert.ok(projectIds.has(String(dep.data.projectId)));
    assert.ok(towerIds.has(String(dep.data.towerId)));
  }
  for (const asgn of payload.assignments) {
    assert.ok(empIds.has(String(asgn.data.employeeId)));
    assert.ok(projectIds.has(String(asgn.data.projectId)));
    assert.ok(towerIds.has(String(asgn.data.towerId)));
    assert.ok(flatIds.has(String(asgn.data.flatId)));
  }
  for (const att of payload.attendance) {
    assert.ok(empIds.has(String(att.data.employeeId)));
  }
  for (const adv of payload.advances) {
    assert.ok(empIds.has(String(adv.data.employeeId)));
    assert.ok(Number(adv.data.amount) > 0);
  }
  for (const exp of payload.expenses) {
    assert.ok(projectIds.has(String(exp.data.projectId)));
    assert.ok(Number(exp.data.amount) > 0);
  }
});

test('buildNamespacedCloudSeedPayload filters orphan child records whose parent project or employee is missing', () => {
  const uid = 'userAlpha99';
  const seed = createSeedWorkspace('local-avy-infra');
  // Remove one project and one employee locally
  seed.projects = seed.projects.filter((p) => p.id !== 'proj_emerald_courtyard');
  seed.employees = seed.employees.filter((e) => e.id !== 'emp_avy_msn_002');

  const payload = buildNamespacedCloudSeedPayload(uid, seed, {
    adminUsername: 'admin',
    adminPassword: 'admin123',
    adminEditPin: '1234',
    userPin: '1234',
  });

  const projectIds = new Set(payload.projects.map((p) => p.id));
  const empIds = new Set(payload.employees.map((e) => e.id));

  assert.ok(payload.towers.every((t) => projectIds.has(String(t.data.projectId))));
  assert.ok(payload.expenses.every((e) => projectIds.has(String(e.data.projectId))));
  assert.ok(payload.attendance.every((a) => empIds.has(String(a.data.employeeId))));
  assert.ok(payload.advances.every((a) => empIds.has(String(a.data.employeeId))));
});

test('buildNamespacedCloudSeedPayload namespaces removedEmployees backups cleanly', () => {
  const uid = 'ownerCloudUid999';
  const seed = createSeedWorkspace('local-avy-infra');
  const sampleEmp = seed.employees[0];
  seed.removedEmployees = [
    {
      id: 'bak_001',
      ownerId: 'local-avy-infra',
      employeeId: sampleEmp.id,
      empCode: sampleEmp.empCode,
      fullName: sampleEmp.fullName,
      role: sampleEmp.role,
      phone: sampleEmp.phone,
      joiningDate: sampleEmp.joiningDate,
      removedAt: '2026-11-23T10:00:00.000Z',
      removedByName: 'Admin',
      removalReason: 'Site completed',
      employeeSnapshot: sampleEmp,
      documents: [],
      summary: {
        attendanceCount: 2,
        presentDays: 2,
        halfDays: 0,
        absentDays: 0,
        totalWagesEarned: 2100,
        totalAdvances: 150,
        totalSettled: 0,
        netPayable: 1950,
        deploymentsCount: 1,
        assignmentsCount: 1,
        documentsCount: 0,
      },
      createdAt: '2026-11-23T10:00:00.000Z',
      updatedAt: '2026-11-23T10:00:00.000Z',
    },
  ];

  const payload = buildNamespacedCloudSeedPayload(uid, seed, {
    adminUsername: 'admin',
    adminPassword: 'admin123',
    adminEditPin: '1234',
    userPin: '1234',
  });

  assert.equal(payload.removedEmployees.length, 1);
  assert.equal(payload.removedEmployees[0].data.ownerId, uid);
  assert.equal(payload.removedEmployees[0].data.employeeId, namespaceDocId(uid, sampleEmp.id));
  assert.equal(payload.removedEmployees[0].data.removalReason, 'Site completed');
});
