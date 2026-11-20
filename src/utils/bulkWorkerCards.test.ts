import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AdvanceEntry,
  AttendanceRecord,
  CompanyProfile,
  Employee,
} from '../types/avy';
import {
  buildBulkWorkerCardModels,
  getBulkCardLayoutSpec,
  getBulkPaperSpec,
  paginateBulkWorkerCards,
  resolveBulkWorkerSiteLabel,
  setBulkWorkersSelection,
  toggleBulkWorkerSelection,
} from './bulkWorkerCards';

function makeEmployee(id: string, name: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    ownerId: 'owner-1',
    empCode: `AVY-${id.toUpperCase()}`,
    fullName: name,
    role: 'Mason',
    phone: '9876543210',
    joiningDate: '2026-01-10',
    dailyRate: 950,
    overtimeRate: 140,
    foodAllowanceDaily: 150,
    aadharRef: 'XXXX-XXXX-1234',
    bloodGroup: 'O+',
    emergencyContact: '9876500000',
    currentProjectId: 'proj-1',
    currentProjectName: 'Skyline Residency',
    currentTowerId: 'twr-1',
    currentTowerName: 'Tower A',
    status: 'active',
    notes: '',
    createdAt: '2026-01-10T00:00:00Z',
    updatedAt: '2026-01-10T00:00:00Z',
    ...overrides,
  };
}

const SAMPLE_COMPANY: CompanyProfile = {
  id: 'co-1',
  ownerId: 'owner-1',
  companyName: 'AVY INFRASTRUCTURE',
  tagline: 'Tile Laying & Stone Finishing Contractors',
  address: 'Pune, MH',
  hrContact: '9999900000',
  hrEmail: 'hr@avy.example',
  gstNumber: '27AAAAA0000A1Z5',
  pfEstCode: 'PF-01',
  esiCode: 'ESI-01',
  signatoryName: 'Project Director',
  tileZoneCatalog: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

test('getBulkPaperSpec and getBulkCardLayoutSpec provide accurate A4/Letter dimensions and capacities', () => {
  const a4 = getBulkPaperSpec('a4');
  assert.equal(a4.pageWidthMm, 210);
  assert.equal(a4.pageHeightMm, 297);
  assert.equal(a4.contentWidthMm, 194);

  const letter = getBulkPaperSpec('letter');
  assert.equal(letter.pageWidthMm, 215.9);
  assert.equal(letter.pageHeightMm, 279.4);
  assert.equal(letter.contentWidthMm, 199.9);

  assert.equal(getBulkCardLayoutSpec('profile_attendance_2up').cardsPerPage, 2);
  assert.equal(getBulkCardLayoutSpec('id_grid_4up').cardsPerPage, 4);
  assert.equal(getBulkCardLayoutSpec('id_grid_6up').cardsPerPage, 6);
});

test('paginateBulkWorkerCards splits workers cleanly across pages without splitting cards', () => {
  const workers = ['1', '2', '3', '4', '5'].map((id) => makeEmployee(id, `Worker ${id}`));

  assert.deepEqual(paginateBulkWorkerCards([], 2), []);

  const pages2Up = paginateBulkWorkerCards(workers, 2);
  assert.equal(pages2Up.length, 3);
  assert.equal(pages2Up[0].pageNumber, 1);
  assert.equal(pages2Up[0].totalPages, 3);
  assert.equal(pages2Up[0].cards.length, 2);
  assert.equal(pages2Up[0].emptySlots, 0);
  assert.equal(pages2Up[2].cards.length, 1);
  assert.equal(pages2Up[2].emptySlots, 1);

  const pages4Up = paginateBulkWorkerCards(workers, 4);
  assert.equal(pages4Up.length, 2);
  assert.equal(pages4Up[0].cards.length, 4);
  assert.equal(pages4Up[1].cards.length, 1);
  assert.equal(pages4Up[1].emptySlots, 3);

  const pages6Up = paginateBulkWorkerCards(workers, 6);
  assert.equal(pages6Up.length, 1);
  assert.equal(pages6Up[0].cards.length, 5);
  assert.equal(pages6Up[0].emptySlots, 1);
});

test('selection helpers toggle, add, replace, and clear selected workers cleanly', () => {
  const e1 = makeEmployee('e1', 'Raju');
  const e2 = makeEmployee('e2', 'Suresh');
  const e3 = makeEmployee('e3', 'Mohan');

  let selected = toggleBulkWorkerSelection([], 'e1');
  assert.deepEqual(selected, ['e1']);
  selected = toggleBulkWorkerSelection(selected, 'e2');
  assert.deepEqual(selected, ['e1', 'e2']);
  selected = toggleBulkWorkerSelection(selected, 'e1');
  assert.deepEqual(selected, ['e2']);

  selected = setBulkWorkersSelection(selected, [e1, e3], 'add');
  assert.deepEqual(selected, ['e2', 'e1', 'e3']);

  selected = setBulkWorkersSelection(selected, [e1, e2], 'remove');
  assert.deepEqual(selected, ['e3']);

  selected = setBulkWorkersSelection(selected, [e1, e2], 'replace');
  assert.deepEqual(selected, ['e1', 'e2']);

  selected = setBulkWorkersSelection(selected, [e1, e2], 'clear');
  assert.deepEqual(selected, []);
});

test('buildBulkWorkerCardModels computes initials, site labels, QR URLs, and monthly attendance counts', () => {
  const emp = makeEmployee('e1', 'Ramesh Kumar', { currentTowerName: 'Tower B' });
  const unassigned = makeEmployee('e2', 'Vikram', {
    currentProjectName: '',
    currentTowerName: '',
  });

  assert.equal(resolveBulkWorkerSiteLabel(emp), 'Skyline Residency · Tower B');
  assert.equal(resolveBulkWorkerSiteLabel(unassigned), 'Unassigned / Standby');

  const attendance: AttendanceRecord[] = [
    {
      id: 'att-1',
      ownerId: 'owner-1',
      date: '2026-04-02',
      employeeId: 'e1',
      empCode: emp.empCode,
      employeeName: emp.fullName,
      employeeRole: emp.role,
      projectId: 'proj-1',
      projectName: 'Skyline Residency',
      towerId: 'twr-1',
      towerName: 'Tower B',
      status: 'present',
      overtimeHours: 2,
      dailyWageEarned: 950,
      overtimePayEarned: 280,
      notes: '',
      createdAt: '2026-04-02T00:00:00Z',
      updatedAt: '2026-04-02T00:00:00Z',
    },
  ];

  const advances: AdvanceEntry[] = [
    {
      id: 'adv-1',
      ownerId: 'owner-1',
      date: '2026-04-03',
      employeeId: 'e1',
      empCode: emp.empCode,
      employeeName: emp.fullName,
      employeePhone: emp.phone,
      advanceType: 'daily_food',
      amount: 150,
      paymentMode: 'cash',
      notes: '',
      whatsappShared: false,
      createdAt: '2026-04-03T00:00:00Z',
      updatedAt: '2026-04-03T00:00:00Z',
    },
  ];

  const models = buildBulkWorkerCardModels({
    employees: [emp, unassigned],
    company: SAMPLE_COMPANY,
    projects: [],
    towers: [],
    deployments: [],
    assignments: [],
    attendance,
    advances,
    settlements: [],
    yearMonth: '2026-04',
    origin: 'https://avy.example',
  });

  assert.equal(models.length, 2);
  assert.equal(models[0].initials, 'RK');
  assert.equal(models[0].attendanceCard.presentDays, 1);
  assert.equal(models[0].attendanceCard.overtimeHours, 2);
  assert.equal(models[0].attendanceCard.monthAdvancesTotal, 150);
  assert.ok(models[0].scanUrl.startsWith('https://avy.example/?'));
  assert.equal(models[1].siteLabel, 'Unassigned / Standby');
});
