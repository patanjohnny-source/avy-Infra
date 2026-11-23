import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedWorkspace } from '../data/seedData';
import {
  buildEmployeeBackupExportPayload,
  buildRemovedEmployeeBackup,
  filterRemovedEmployeeBackups,
  parseEmployeeBackupJson,
  prepareEmployeeRestorePayload,
  trimEmployeeBackupDocumentsForCloud,
} from './employeeBackup';

test('buildRemovedEmployeeBackup captures full employee snapshot, docs, and payroll/attendance summary', () => {
  const ws = createSeedWorkspace('local-avy-infra');
  const raju = ws.employees.find((e) => e.empCode === 'AVY-MSN-001');
  assert.ok(raju);

  const mockDoc = {
    id: 'doc_raju_aadhar',
    ownerId: 'local-avy-infra',
    employeeId: raju.id,
    docCategory: 'aadhar_pdf' as const,
    title: 'Aadhaar Card PDF',
    fileName: 'raju-aadhaar.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 12000,
    dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK',
    createdAt: '2026-01-10T09:00:00.000Z',
    updatedAt: '2026-01-10T09:00:00.000Z',
  };

  const backup = buildRemovedEmployeeBackup({
    employee: raju,
    ownerId: 'local-avy-infra',
    removedByName: 'Admin',
    removalReason: 'Completed Skyline project contract',
    employeeDocuments: [mockDoc],
    attendance: ws.attendance,
    advances: ws.advances,
    settlements: ws.settlements,
    deployments: ws.deployments,
    assignments: ws.assignments,
    nowIso: '2026-11-23T15:00:00.000Z',
  });

  assert.equal(backup.employeeId, raju.id);
  assert.equal(backup.empCode, raju.empCode);
  assert.equal(backup.fullName, raju.fullName);
  assert.equal(backup.removalReason, 'Completed Skyline project contract');
  assert.equal(backup.documents.length, 1);
  assert.equal(backup.summary.documentsCount, 1);
  assert.ok(backup.summary.attendanceCount >= 1);
  assert.deepEqual(backup.employeeSnapshot.skillTags, raju.skillTags);
});

test('export & parse JSON backup bundle round-trips and filters cleanly', () => {
  const ws = createSeedWorkspace('local-avy-infra');
  const raju = ws.employees[0];
  const imran = ws.employees[1];

  const bak1 = buildRemovedEmployeeBackup({
    employee: raju,
    ownerId: 'owner_1',
    removedByName: 'Admin',
    removalReason: 'Relocated to native village',
    employeeDocuments: [],
    attendance: ws.attendance,
    advances: ws.advances,
    settlements: ws.settlements,
    deployments: ws.deployments,
    assignments: ws.assignments,
    backupId: 'bak_1',
  });
  const bak2 = buildRemovedEmployeeBackup({
    employee: imran,
    ownerId: 'owner_1',
    removedByName: 'Admin',
    removalReason: 'Project completed',
    employeeDocuments: [],
    attendance: ws.attendance,
    advances: ws.advances,
    settlements: ws.settlements,
    deployments: ws.deployments,
    assignments: ws.assignments,
    backupId: 'bak_2',
  });

  const singleExport = buildEmployeeBackupExportPayload({
    backups: [bak1],
    companyName: 'AVY INFRA',
    exportedAt: '2026-11-23T15:00:00.000Z',
  });
  assert.equal(singleExport.filename, `avy-worker-backup-${raju.empCode}-2026-11-23.json`);

  const allExport = buildEmployeeBackupExportPayload({
    backups: [bak1, bak2],
    companyName: 'AVY INFRA',
    exportedAt: '2026-11-23T15:00:00.000Z',
  });
  assert.equal(allExport.filename, 'avy-removed-workers-backup-2026-11-23.json');

  const parsed = parseEmployeeBackupJson(allExport.json, 'owner_2');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.backups.length, 2);
  assert.equal(parsed.backups[0].ownerId, 'owner_2');

  const filtered = filterRemovedEmployeeBackups(parsed.backups, 'village', 'All');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].empCode, raju.empCode);
});

test('prepareEmployeeRestorePayload restores ID when available and reassigns if code collides', () => {
  const ws = createSeedWorkspace('local-avy-infra');
  const raju = ws.employees.find((e) => e.empCode === 'AVY-MSN-001')!;
  const backup = buildRemovedEmployeeBackup({
    employee: raju,
    ownerId: 'local-avy-infra',
    removedByName: 'Admin',
    removalReason: 'Temporary leave',
    employeeDocuments: [
      {
        id: 'doc_1',
        ownerId: 'local-avy-infra',
        employeeId: raju.id,
        docCategory: 'aadhar_pdf',
        title: 'Aadhaar',
        fileName: 'aadhaar.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4096,
        dataUrl: 'data:application/pdf;base64,AAAA',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    attendance: ws.attendance,
    advances: ws.advances,
    settlements: ws.settlements,
    deployments: ws.deployments,
    assignments: ws.assignments,
  });

  // Case 1: Original worker removed from roster -> preserves original ID and empCode
  const remainingEmployees = ws.employees.filter((e) => e.id !== raju.id);
  const restoredClean = prepareEmployeeRestorePayload({
    backup,
    existingEmployees: remainingEmployees,
    existingDocuments: [],
    projects: ws.projects,
    towers: ws.towers,
    ownerId: 'local-avy-infra',
  });
  assert.equal(restoredClean.codeReassigned, false);
  assert.equal(restoredClean.employee.empCode, raju.empCode);
  assert.equal(restoredClean.employee.id, raju.id);
  assert.equal(restoredClean.documentsToRestore.length, 1);
  assert.equal(restoredClean.documentsToRestore[0].employeeId, raju.id);

  // Case 2: Another active employee now holds AVY-MSN-001 -> assigns next unique code
  const restoredConflict = prepareEmployeeRestorePayload({
    backup,
    existingEmployees: ws.employees,
    existingDocuments: [],
    projects: ws.projects,
    towers: ws.towers,
    ownerId: 'local-avy-infra',
  });
  assert.equal(restoredConflict.codeReassigned, true);
  assert.notEqual(restoredConflict.employee.empCode, raju.empCode);
  assert.notEqual(restoredConflict.employee.id, raju.id);
});

test('trimEmployeeBackupDocumentsForCloud enforces cloud payload size cap safely', () => {
  const bigData = `data:application/pdf;base64,${'A'.repeat(400_000)}`;
  const docs = [
    {
      id: 'd1',
      ownerId: 'o1',
      employeeId: 'e1',
      docCategory: 'aadhar_pdf' as const,
      title: 'Doc 1',
      fileName: 'd1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 300000,
      dataUrl: bigData,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'd2',
      ownerId: 'o1',
      employeeId: 'e1',
      docCategory: 'other' as const,
      title: 'Doc 2',
      fileName: 'd2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 300000,
      dataUrl: bigData,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const trimmed = trimEmployeeBackupDocumentsForCloud(docs);
  assert.equal(trimmed.cloudDocuments.length, 1);
  assert.deepEqual(trimmed.archivedDocIds, ['d1']);
  assert.equal(trimmed.omittedCount, 1);
});
