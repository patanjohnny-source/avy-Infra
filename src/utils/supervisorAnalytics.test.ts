import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSupervisorAnalytics } from './supervisorAnalytics';
import type {
  AttendanceRecord,
  Employee,
  Project,
  Tower,
  WorkAssignment,
} from '../types/avy';

const PROJECTS: Project[] = [
  {
    id: 'p1',
    ownerId: 'o1',
    name: 'Skyline Heights',
    location: 'Hyderabad',
    clientName: 'Client A',
    status: 'active',
    createdAt: '',
    updatedAt: '',
  },
];

const TOWERS: Tower[] = [
  {
    id: 't1',
    ownerId: 'o1',
    projectId: 'p1',
    name: 'Tower A',
    totalFloors: 10,
    unitsPerFloor: 3,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 't2',
    ownerId: 'o1',
    projectId: 'p1',
    name: 'Tower B',
    totalFloors: 8,
    unitsPerFloor: 2,
    createdAt: '',
    updatedAt: '',
  },
];

const EMPLOYEES: Employee[] = [
  {
    id: 'e1',
    ownerId: 'o1',
    empCode: 'AVY-001',
    fullName: 'Raju',
    role: 'Mason',
    phone: '9000000001',
    joiningDate: '2025-01-01',
    dailyRate: 1000,
    overtimeRate: 150,
    foodAllowanceDaily: 150,
    aadharRef: '1111',
    emergencyContact: '9000000000',
    currentProjectId: 'p1',
    currentTowerId: 't1',
    currentTowerName: 'Tower A',
    status: 'active',
    notes: '',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'e2',
    ownerId: 'o1',
    empCode: 'AVY-002',
    fullName: 'Suresh',
    role: 'Helper',
    phone: '9000000002',
    joiningDate: '2025-01-01',
    dailyRate: 650,
    overtimeRate: 100,
    foodAllowanceDaily: 120,
    aadharRef: '2222',
    emergencyContact: '9000000000',
    currentProjectId: 'p1',
    currentTowerId: 't1',
    currentTowerName: 'Tower A',
    status: 'active',
    notes: '',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'e3',
    ownerId: 'o1',
    empCode: 'AVY-003',
    fullName: 'Imran',
    role: 'Mason',
    phone: '9000000003',
    joiningDate: '2025-01-01',
    dailyRate: 950,
    overtimeRate: 140,
    foodAllowanceDaily: 150,
    aadharRef: '3333',
    emergencyContact: '9000000000',
    currentProjectId: 'p1',
    currentTowerId: 't2',
    currentTowerName: 'Tower B',
    status: 'active',
    notes: '',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'e4',
    ownerId: 'o1',
    empCode: 'AVY-004',
    fullName: 'Kiran (Unassigned)',
    role: 'Helper',
    phone: '9000000004',
    joiningDate: '2025-01-01',
    dailyRate: 600,
    overtimeRate: 90,
    foodAllowanceDaily: 120,
    aadharRef: '4444',
    emergencyContact: '9000000000',
    status: 'active',
    notes: '',
    createdAt: '',
    updatedAt: '',
  },
];

const ASSIGNMENTS: WorkAssignment[] = [
  {
    id: 'as1',
    ownerId: 'o1',
    projectId: 'p1',
    projectName: 'Skyline Heights',
    towerId: 't1',
    towerName: 'Tower A',
    flatId: 'f1',
    unitNumber: '101',
    zoneKey: 'hall_flooring',
    zoneLabel: 'Hall Flooring',
    employeeId: 'e1',
    empCode: 'AVY-001',
    employeeName: 'Raju',
    employeeRole: 'Mason',
    assignedDate: '2026-11-18',
    completedDate: '',
    targetSqft: 200,
    status: 'in_progress',
    notes: '',
    createdAt: '',
    updatedAt: '',
  },
];

function mkAtt(
  date: string,
  empId: string,
  towerId: string,
  status: AttendanceRecord['status']
): AttendanceRecord {
  return {
    id: `att_${date}_${empId}`,
    ownerId: 'o1',
    date,
    employeeId: empId,
    empCode: empId,
    employeeName: empId,
    employeeRole: 'Mason',
    projectId: 'p1',
    projectName: 'Skyline Heights',
    towerId,
    towerName: towerId === 't1' ? 'Tower A' : 'Tower B',
    status,
    overtimeHours: 0,
    dailyWageEarned: status === 'absent' ? 0 : 900,
    overtimePayEarned: 0,
    notes: '',
    createdAt: '',
    updatedAt: '',
  };
}

test('computeSupervisorAnalytics computes rolling 7d trends, active vs pending deployment, and continuity retention', () => {
  const attendance: AttendanceRecord[] = [
    mkAtt('2026-11-17', 'e1', 't1', 'present'),
    mkAtt('2026-11-18', 'e1', 't1', 'present'),
    mkAtt('2026-11-18', 'e2', 't1', 'present'),
    mkAtt('2026-11-18', 'e3', 't2', 'half_day'),
    mkAtt('2026-11-19', 'e1', 't1', 'present'),
    // e2 unmarked on 2026-11-19 -> pendingDeployment on Tower A = 1
    // e3 absent on 2026-11-19 -> absentCount on Tower B = 1
    mkAtt('2026-11-19', 'e3', 't2', 'absent'),
  ];

  const res = computeSupervisorAnalytics({
    projects: PROJECTS,
    towers: TOWERS,
    employees: EMPLOYEES,
    attendance,
    assignments: ASSIGNMENTS,
    referenceDate: '2026-11-19',
    windowDays: 7,
  });

  assert.equal(res.dailyTrendRows.length, 7);
  assert.equal(res.windowStart, '2026-11-13');
  assert.equal(res.windowEnd, '2026-11-19');
  assert.equal(res.retentionBasis, 'rolling_7d_continuity');

  const todayRow = res.dailyTrendRows[res.dailyTrendRows.length - 1];
  assert.equal(todayRow.date, '2026-11-19');
  assert.equal(todayRow['count_t1'], 1);
  assert.equal(todayRow['pct_t1'], 50); // 1 of 2 Tower A crew
  assert.equal(todayRow['count_t2'], 0);
  assert.equal(todayRow.totalAbsent, 1);

  const twrA = res.towerBreakdown.find((b) => b.towerId === 't1')!;
  assert.equal(twrA.allocatedCrew, 2);
  assert.equal(twrA.activeDeployed, 1);
  assert.equal(twrA.pendingDeployment, 1); // e2 unmarked on refDate
  assert.equal(twrA.zoneAssignedCount, 1); // e1 has open assignment
  assert.equal(twrA.weeklyRetentionPct, 50); // e1 attended 3d (>=2), e2 attended 1d (<2) => 1/2 = 50%
});

test('computeSupervisorAnalytics switches to week-over-week retention when prior 7-day attendance exists and scopes by towerId', () => {
  const attendance: AttendanceRecord[] = [
    // Prior 7d window (2026-11-06..2026-11-12)
    mkAtt('2026-11-10', 'e1', 't1', 'present'),
    mkAtt('2026-11-10', 'e2', 't1', 'present'),
    // Current 7d window (2026-11-13..2026-11-19): only e1 returned, e2 dropped out
    mkAtt('2026-11-19', 'e1', 't1', 'present'),
    mkAtt('2026-11-19', 'e3', 't2', 'present'),
  ];

  const allRes = computeSupervisorAnalytics({
    projects: PROJECTS,
    towers: TOWERS,
    employees: EMPLOYEES,
    attendance,
    assignments: ASSIGNMENTS,
    referenceDate: '2026-11-19',
    windowDays: 14,
  });

  assert.equal(allRes.dailyTrendRows.length, 14);
  assert.equal(allRes.retentionBasis, 'week_over_week');
  const twrA = allRes.towerBreakdown.find((b) => b.towerId === 't1')!;
  assert.equal(twrA.retainedWorkersCount, 1);
  assert.equal(twrA.retentionDenominator, 2);
  assert.equal(twrA.weeklyRetentionPct, 50);
  // Unassigned Pool bar included when viewing all towers
  assert.equal(allRes.unassignedPoolCount, 1);
  assert.ok(allRes.deploymentRows.some((r) => r.id === 'unassigned_pool' && r.pendingDeployment === 1));

  // Tower-scoped filter hides unassigned pool and other towers
  const t2Res = computeSupervisorAnalytics({
    projects: PROJECTS,
    towers: TOWERS,
    employees: EMPLOYEES,
    attendance,
    assignments: ASSIGNMENTS,
    referenceDate: '2026-11-19',
    towerId: 't2',
  });
  assert.equal(t2Res.towerBreakdown.length, 1);
  assert.equal(t2Res.towerBreakdown[0].towerId, 't2');
  assert.equal(t2Res.unassignedPoolCount, 0);
});
