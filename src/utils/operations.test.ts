import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeExecutiveSummaryMetrics,
  computeOverviewKpis,
  computeProjectAndTowerExpenses,
  computeProjectCompletionSeries,
  computeProjectWorkStatusOverview,
  computeSingleEmployeeAttendanceCard,
  computeTowerAttendanceSummary,
  computeTowerFoodExpenseBreakdown,
  computeWorkedHoursFromInOut,
  filterEmployeesBySkillTags,
  findActiveUnfinishedAssignment,
  formatAttendanceInOutSummary,
  formatDurationBreakdown,
  getExpenseCategoryLabel,
  getProjectCompletionColor,
  getTowerDeploymentCounts,
  getWeeklyWindowForDate,
  isSundayDate,
  normalizeHHMM,
  normalizeSkillTags,
  summarizeSupervisorToolSpends,
} from './operations';
import type {
  AdvanceEntry,
  AttendanceRecord,
  Employee,
  FlatUnit,
  Project,
  SiteExpense,
  Tower,
  WorkAssignment,
} from '../types/avy';

test('formatDurationBreakdown computes days, months, and years accurately', () => {
  const shortRun = formatDurationBreakdown('2026-11-01', '2026-11-16');
  assert.equal(shortRun.totalDays, 15);
  assert.equal(shortRun.label, '15 days');

  const multiYear = formatDurationBreakdown('2025-01-10', '2026-11-16');
  assert.equal(multiYear.years, 1);
  assert.equal(multiYear.months, 10);
  assert.equal(multiYear.days, 6);
  assert.match(multiYear.label, /^1 yr 10 mos 6 days \(\d+ days\)$/);
});

test('isSundayDate and getWeeklyWindowForDate identify Sunday weekly runs', () => {
  // 2026-11-15 is a Sunday; 2026-11-16 is Monday
  assert.equal(isSundayDate('2026-11-15'), true);
  assert.equal(isSundayDate('2026-11-16'), false);

  const sundayWindow = getWeeklyWindowForDate('2026-11-15');
  assert.deepEqual(sundayWindow, { start: '2026-11-09', end: '2026-11-15' });
});

test('findActiveUnfinishedAssignment blocks new assignment while unfinished work exists', () => {
  const openAsgn: WorkAssignment = {
    id: 'a1',
    ownerId: 'u1',
    projectId: 'p1',
    projectName: 'Skyline',
    towerId: 't1',
    towerName: 'Tower A',
    flatId: 'f1',
    unitNumber: '101',
    zoneKey: 'hall_skirting',
    zoneLabel: 'Hall Skirting',
    employeeId: 'emp1',
    empCode: 'AVY-MSN-001',
    employeeName: 'Raju',
    employeeRole: 'Mason',
    assignedDate: '2026-11-15',
    completedDate: '',
    targetSqft: 68,
    status: 'in_progress',
    notes: '',
    createdAt: '',
    updatedAt: '',
  };

  const completedAsgn: WorkAssignment = {
    ...openAsgn,
    id: 'a2',
    status: 'completed',
    completedDate: '2026-11-16',
  };

  const flats: FlatUnit[] = [];

  const foundOpen = findActiveUnfinishedAssignment('emp1', [openAsgn], flats);
  assert.ok(foundOpen);
  assert.equal(foundOpen?.unitNumber, '101');
  assert.equal(foundOpen?.zoneLabel, 'Hall Skirting');

  const cleared = findActiveUnfinishedAssignment('emp1', [completedAsgn], flats);
  assert.equal(cleared, null);
});

test('computeTowerAttendanceSummary and computeTowerFoodExpenseBreakdown & expenses aggregate tower-wise data', () => {
  const projects: Project[] = [
    {
      id: 'p1',
      ownerId: 'u1',
      name: 'Skyline',
      location: 'Hyd',
      clientName: 'Client',
      status: 'active',
      startDate: '2025-10-01',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const towers: Tower[] = [
    {
      id: 't1',
      ownerId: 'u1',
      projectId: 'p1',
      name: 'Tower A',
      totalFloors: 10,
      unitsPerFloor: 3,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 't2',
      ownerId: 'u1',
      projectId: 'p1',
      name: 'Tower B',
      totalFloors: 10,
      unitsPerFloor: 3,
      createdAt: '',
      updatedAt: '',
    },
  ];
  const employees: Employee[] = [
    {
      id: 'e1',
      ownerId: 'u1',
      empCode: 'AVY-MSN-001',
      fullName: 'Raju',
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
      status: 'active',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'e2',
      ownerId: 'u1',
      empCode: 'AVY-HLP-002',
      fullName: 'Suresh',
      role: 'Helper',
      phone: '9848011224',
      joiningDate: '2025-01-01',
      dailyRate: 600,
      overtimeRate: 80,
      foodAllowanceDaily: 120,
      aadharRef: '',
      emergencyContact: '',
      currentProjectId: 'p1',
      currentProjectName: 'Skyline',
      currentTowerId: 't1',
      currentTowerName: 'Tower A',
      status: 'active',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const attendance: AttendanceRecord[] = [
    {
      id: 'att1',
      ownerId: 'u1',
      date: '2026-11-15',
      employeeId: 'e1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju',
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
    {
      id: 'att2',
      ownerId: 'u1',
      date: '2026-11-15',
      employeeId: 'e2',
      empCode: 'AVY-HLP-002',
      employeeName: 'Suresh',
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
  ];
  const advances: AdvanceEntry[] = [
    {
      id: 'adv1',
      ownerId: 'u1',
      date: '2026-11-15', // Sunday
      employeeId: 'e1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju',
      employeePhone: '9848011223',
      projectId: 'p1',
      projectName: 'Skyline',
      towerId: 't1',
      towerName: 'Tower A',
      isSundayRun: true,
      advanceType: 'weekly_food',
      amount: 900,
      paymentMode: 'cash',
      notes: 'Sunday weekly food',
      whatsappShared: false,
      createdAt: '',
      updatedAt: '',
    },
  ];
  const expenses: SiteExpense[] = [
    {
      id: 'exp1',
      ownerId: 'u1',
      date: '2026-11-15',
      projectId: 'p1',
      projectName: 'Skyline',
      towerId: 't1',
      towerName: 'Tower A',
      category: 'adhesive_grout',
      description: 'Laticrete 20 bags',
      vendorName: 'Sri Sai Traders',
      amount: 8500,
      paymentMode: 'upi',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const attSum = computeTowerAttendanceSummary({
    date: '2026-11-15',
    projectId: 'p1',
    towerId: 't1',
    employees,
    attendance,
  });
  assert.equal(attSum.presentCount, 1);
  assert.equal(attSum.absentCount, 1);
  assert.equal(attSum.dailyWageTotal, 1000);

  const foodSum = computeTowerFoodExpenseBreakdown({
    referenceDate: '2026-11-15',
    advances,
    employees,
    projectId: 'p1',
    towerId: 't1',
  });
  assert.equal(foodSum.dailyFoodTotal, 900);
  assert.equal(foodSum.weeklyFoodTotal, 900);
  assert.equal(foodSum.sundayWeeklyFoodTotal, 900);
  assert.equal(foodSum.monthlyFoodTotal, 900);

  const costReport = computeProjectAndTowerExpenses({
    projects,
    towers,
    employees,
    attendance,
    advances,
    expenses,
  });
  assert.equal(costReport.grandTotal, 10400); // 1000 wage + 900 food + 8500 site expense
  assert.equal(costReport.towerRows[0].totalExpenseCost, 10400);
  assert.equal(costReport.towerRows[1].totalExpenseCost, 0);
});

test('computeSingleEmployeeAttendanceCard and getTowerDeploymentCounts compute card calendar and site counts accurately', () => {
  const emp: Employee = {
    id: 'e1',
    ownerId: 'u1',
    empCode: 'AVY-MSN-001',
    fullName: 'Raju',
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
    status: 'active',
    notes: '',
    createdAt: '',
    updatedAt: '',
  };

  const empBench: Employee = {
    ...emp,
    id: 'e2',
    empCode: 'AVY-HLP-002',
    fullName: 'Kiran',
    role: 'Helper',
    currentProjectId: '',
    currentProjectName: '',
    currentTowerId: '',
    currentTowerName: '',
  };

  const attendance: AttendanceRecord[] = [
    {
      id: 'att1',
      ownerId: 'u1',
      date: '2026-11-01',
      employeeId: 'e1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju',
      employeeRole: 'Mason',
      projectId: 'p1',
      projectName: 'Skyline',
      towerId: 't1',
      towerName: 'Tower A',
      status: 'present',
      overtimeHours: 2,
      dailyWageEarned: 1000,
      overtimePayEarned: 300,
      notes: 'Double shift',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'att2',
      ownerId: 'u1',
      date: '2026-11-02',
      employeeId: 'e1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju',
      employeeRole: 'Mason',
      projectId: 'p1',
      projectName: 'Skyline',
      towerId: 't1',
      towerName: 'Tower A',
      status: 'half_day',
      overtimeHours: 0,
      dailyWageEarned: 500,
      overtimePayEarned: 0,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'att3',
      ownerId: 'u1',
      date: '2026-11-03',
      employeeId: 'e1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju',
      employeeRole: 'Mason',
      projectId: 'p1',
      projectName: 'Skyline',
      towerId: 't1',
      towerName: 'Tower A',
      status: 'absent',
      overtimeHours: 0,
      dailyWageEarned: 0,
      overtimePayEarned: 0,
      notes: 'Leave',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const advances: AdvanceEntry[] = [
    {
      id: 'adv1',
      ownerId: 'u1',
      date: '2026-11-03',
      employeeId: 'e1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju',
      employeePhone: '9848011223',
      advanceType: 'weekly_food',
      amount: 900,
      paymentMode: 'cash',
      notes: '',
      whatsappShared: false,
      createdAt: '',
      updatedAt: '',
    },
  ];

  const card = computeSingleEmployeeAttendanceCard({
    employee: emp,
    yearMonth: '2026-11',
    attendance,
    advances,
  });

  assert.equal(card.daysInMonth, 30);
  // Nov 1, 2026 is Sunday -> Monday-based offset is 6
  assert.equal(card.mondayOffset, 6);
  assert.equal(card.presentDays, 1);
  assert.equal(card.halfDays, 1);
  assert.equal(card.absentDays, 1);
  assert.equal(card.unmarkedDays, 27);
  assert.equal(card.effectiveDays, 1.5);
  assert.equal(card.overtimeHours, 2);
  assert.equal(card.totalWagesEarned, 1800);
  assert.equal(card.monthAdvancesTotal, 900);
  assert.equal(card.days[0].status, 'present');
  assert.equal(card.days[0].earned, 1300);
  assert.equal(card.days[1].status, 'half_day');
  assert.equal(card.days[2].status, 'absent');

  const projects: Project[] = [
    {
      id: 'p1',
      ownerId: 'u1',
      name: 'Skyline',
      location: 'Hyd',
      clientName: 'Client',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const towers: Tower[] = [
    { id: 't1', ownerId: 'u1', projectId: 'p1', name: 'Tower A', totalFloors: 10, unitsPerFloor: 3, createdAt: '', updatedAt: '' },
    { id: 't2', ownerId: 'u1', projectId: 'p1', name: 'Tower B', totalFloors: 10, unitsPerFloor: 3, createdAt: '', updatedAt: '' },
  ];

  const counts = getTowerDeploymentCounts({ employees: [emp, empBench], towers, projects });
  assert.equal(counts.byTower[0].activeCrewCount, 1);
  assert.equal(counts.byTower[1].activeCrewCount, 0);
  assert.equal(counts.unassignedCount, 1);
});

test('getExpenseCategoryLabel and computeProjectWorkStatusOverview filter tower/floor/flat statuses accurately', () => {
  assert.equal(getExpenseCategoryLabel({ category: 'gas_payment' }), 'Gas Payment');
  assert.equal(getExpenseCategoryLabel({ category: 'medical' }), 'Medical');
  assert.equal(getExpenseCategoryLabel({ category: 'travel_advance' }), 'Travel Advance');
  assert.equal(
    getExpenseCategoryLabel({ category: 'custom', customCategory: 'Diesel Generator' }),
    'Diesel Generator'
  );

  const projects: Project[] = [
    {
      id: 'p1',
      ownerId: 'u1',
      name: 'Skyline',
      location: 'Hyd',
      clientName: 'Client',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const towers: Tower[] = [
    { id: 't1', ownerId: 'u1', projectId: 'p1', name: 'Tower A', totalFloors: 2, unitsPerFloor: 2, createdAt: '', updatedAt: '' },
    { id: 't2', ownerId: 'u1', projectId: 'p1', name: 'Tower B', totalFloors: 2, unitsPerFloor: 2, createdAt: '', updatedAt: '' },
  ];
  const flats: FlatUnit[] = [
    {
      id: 'f1',
      ownerId: 'u1',
      projectId: 'p1',
      towerId: 't1',
      floorNumber: 1,
      floorLabel: 'Floor 1',
      unitNumber: '101',
      unitType: '2 BHK',
      zones: {
        hall_flooring: { status: 'completed', sqft: 200 },
        dado: { status: 'in_progress', sqft: 120 },
        balcony_flooring: { status: 'not_started', sqft: 80 },
      },
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'f2',
      ownerId: 'u1',
      projectId: 'p1',
      towerId: 't2',
      floorNumber: 2,
      floorLabel: 'Floor 2',
      unitNumber: '201',
      unitType: '3 BHK',
      zones: {
        hall_flooring: { status: 'completed', sqft: 250 },
        dado: { status: 'qc_approved', sqft: 140 },
      },
      createdAt: '',
      updatedAt: '',
    },
  ];

  const allOverview = computeProjectWorkStatusOverview({ projects, towers, flats, statusFilter: 'all' });
  assert.equal(allOverview.totalFlats, 2);
  assert.equal(allOverview.totalZones, 5);
  assert.equal(allOverview.pendingZones, 1);
  assert.equal(allOverview.inProgressZones, 1);
  assert.equal(allOverview.completedZones, 3);

  const pendingOverview = computeProjectWorkStatusOverview({
    projects,
    towers,
    flats,
    statusFilter: 'pending',
  });
  assert.equal(pendingOverview.towerRows.length, 1);
  assert.equal(pendingOverview.towerRows[0].tower.id, 't1');
  assert.equal(pendingOverview.floorRows.length, 1);
  assert.equal(pendingOverview.flatRows.length, 1);
  assert.equal(pendingOverview.flatRows[0].flat.unitNumber, '101');
  assert.deepEqual(pendingOverview.flatRows[0].matchingZoneLabels, ['Balcony Flooring']);

  const completedOverview = computeProjectWorkStatusOverview({
    projects,
    towers,
    flats,
    statusFilter: 'completed',
  });
  assert.equal(completedOverview.towerRows.length, 2);
  assert.equal(completedOverview.flatRows.length, 2);
});

test('computeProjectWorkStatusOverview and computeExecutiveSummaryMetrics support prechecking/cleaning stages and KPI burn rate', () => {
  const projects: Project[] = [
    {
      id: 'p1',
      ownerId: 'u1',
      name: 'Skyline',
      location: 'Hyd',
      clientName: 'Client',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const towers: Tower[] = [
    { id: 't1', ownerId: 'u1', projectId: 'p1', name: 'Tower A', totalFloors: 2, unitsPerFloor: 2, createdAt: '', updatedAt: '' },
  ];
  const employees: Employee[] = [
    {
      id: 'e1',
      ownerId: 'u1',
      empCode: 'AVY-MSN-001',
      fullName: 'Raju',
      role: 'Mason',
      phone: '9848011223',
      joiningDate: '2025-01-01',
      dailyRate: 1000,
      overtimeRate: 150,
      foodAllowanceDaily: 150,
      aadharRef: '',
      emergencyContact: '',
      currentProjectId: 'p1',
      currentTowerId: 't1',
      status: 'active',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'e2',
      ownerId: 'u1',
      empCode: 'AVY-HLP-002',
      fullName: 'Suresh',
      role: 'Helper',
      phone: '9848011224',
      joiningDate: '2025-01-01',
      dailyRate: 650,
      overtimeRate: 90,
      foodAllowanceDaily: 120,
      aadharRef: '',
      emergencyContact: '',
      currentProjectId: 'p1',
      currentTowerId: 't1',
      status: 'active',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const flats: FlatUnit[] = [
    {
      id: 'f1',
      ownerId: 'u1',
      projectId: 'p1',
      towerId: 't1',
      floorNumber: 1,
      unitNumber: '101',
      unitType: '3 BHK',
      zones: {
        hall_flooring: { status: 'prechecking', sqft: 250, assignedEmployeeId: 'e1' },
        dado: { status: 'cleaning_in_progress', sqft: 180 },
        balcony_flooring: { status: 'cleaning_done', sqft: 90 },
        utility_flooring: { status: 'not_started', sqft: 55 },
        lobby_area: { status: 'completed', sqft: 140 },
      },
      createdAt: '',
      updatedAt: '',
    },
  ];
  const attendance: AttendanceRecord[] = [
    {
      id: 'att1',
      ownerId: 'u1',
      date: '2026-11-17',
      employeeId: 'e1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju',
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
  const advances: AdvanceEntry[] = [
    {
      id: 'adv1',
      ownerId: 'u1',
      date: '2026-11-18',
      employeeId: 'e2',
      empCode: 'AVY-HLP-002',
      employeeName: 'Suresh',
      employeePhone: '9848011224',
      advanceType: 'daily_food',
      amount: 200,
      paymentMode: 'cash',
      notes: '',
      whatsappShared: false,
      createdAt: '',
      updatedAt: '',
    },
  ];
  const expenses: SiteExpense[] = [
    {
      id: 'exp1',
      ownerId: 'u1',
      date: '2026-11-18',
      projectId: 'p1',
      projectName: 'Skyline',
      towerId: 't1',
      towerName: 'Tower A',
      category: 'gas_payment',
      description: 'Gas cylinder',
      amount: 1800,
      paymentMode: 'upi',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const preOverview = computeProjectWorkStatusOverview({
    projects,
    towers,
    flats,
    statusFilter: 'prechecking',
  });
  assert.equal(preOverview.precheckingZones, 1);
  assert.equal(preOverview.cleaningInProgressZones, 1);
  assert.equal(preOverview.cleaningDoneZones, 1);
  assert.equal(preOverview.flatRows[0].matchingZoneLabels[0], 'Hall Flooring');

  const exec = computeExecutiveSummaryMetrics({
    projects,
    towers,
    flats,
    employees,
    assignments: [],
    attendance,
    advances,
    expenses,
    weeklyExpenseBudget: 14000, // daily threshold = 2000; dailyBurnRate = 1500 -> 75% (healthy)
    referenceDate: '2026-11-18',
  });
  assert.equal(exec.totalPendingTasks, 3); // not_started + prechecking + cleaning_in_progress
  assert.equal(exec.precheckingTasks, 1);
  assert.equal(exec.cleaningInProgressTasks, 1);
  assert.equal(exec.cleaningDoneTasks, 1);
  assert.equal(exec.completedTasks, 2); // completed + cleaning_done
  assert.equal(exec.workforceUtilizationPct, 50); // 1 of 2 active utilized
  assert.equal(exec.totalSiteSpend, 3000);
  assert.equal(exec.activeSpendDays, 2);
  assert.equal(exec.dailyBurnRate, 1500);
  assert.equal(exec.dailyBurnSeries.length, 2);
  assert.equal(exec.dailyBurnThreshold, 2000);
  assert.equal(exec.burnBudgetStatus, 'healthy');
  assert.equal(exec.burnAlertTriggered, false);

  // Warning state (>= 85% of threshold: 1500 / 1700 = 88%)
  const execWarn = computeExecutiveSummaryMetrics({
    projects,
    towers,
    flats,
    employees,
    assignments: [],
    attendance,
    advances,
    expenses,
    weeklyExpenseBudget: 11900, // daily threshold = 1700
    referenceDate: '2026-11-18',
  });
  assert.equal(execWarn.burnBudgetStatus, 'warning');
  assert.equal(execWarn.burnAlertTriggered, false);

  // Exceeded state (daily burn rate exceeds weeklyBudget / 7)
  const execExceeded = computeExecutiveSummaryMetrics({
    projects,
    towers,
    flats,
    employees,
    assignments: [],
    attendance,
    advances,
    expenses,
    weeklyExpenseBudget: 7000, // daily threshold = 1000 < 1500 dailyBurnRate
    referenceDate: '2026-11-18',
  });
  assert.equal(execExceeded.dailyBurnThreshold, 1000);
  assert.equal(execExceeded.burnBudgetStatus, 'exceeded');
  assert.equal(execExceeded.burnAlertTriggered, true);
  assert.equal(execExceeded.projectedWeeklyExcess, 3500);

  // Unconfigured state (budget 0 disables alert)
  const execDisabled = computeExecutiveSummaryMetrics({
    projects,
    towers,
    flats,
    employees,
    assignments: [],
    attendance,
    advances,
    expenses,
    weeklyExpenseBudget: 0,
    referenceDate: '2026-11-18',
  });
  assert.equal(execDisabled.burnBudgetStatus, 'unconfigured');
  assert.equal(execDisabled.burnAlertTriggered, false);
});

test('computeProjectWorkStatusOverview supports areaFilter (balcony, main_flooring, skirting, electrical, corridor) and multi-floor custom selection', () => {
  const projects: Project[] = [
    {
      id: 'p1',
      ownerId: 'u1',
      name: 'Skyline',
      location: 'Hyd',
      clientName: 'Client',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const towers: Tower[] = [
    { id: 't1', ownerId: 'u1', projectId: 'p1', name: 'Tower A', totalFloors: 3, unitsPerFloor: 2, createdAt: '', updatedAt: '' },
  ];
  const flats: FlatUnit[] = [
    {
      id: 'f1',
      ownerId: 'u1',
      projectId: 'p1',
      towerId: 't1',
      floorNumber: 1,
      floorLabel: 'Floor 1',
      unitNumber: '101',
      unitType: '3 BHK',
      zones: {
        main_flooring_hall: { status: 'not_started', sqft: 320, label: 'Main Flooring Hall', category: 'Flooring' },
        balcony_flooring: { status: 'not_started', sqft: 85, label: 'Balcony Flooring', category: 'Flooring' },
        balcony_skirting: { status: 'completed', sqft: 38, label: 'Balcony Skirting', category: 'Skirting' },
        hall_skirting: { status: 'not_started', sqft: 68, label: 'Hall Skirting', category: 'Skirting' },
        electrical_room_flooring: { status: 'not_started', sqft: 110, label: 'Electrical Room Flooring', category: 'Flooring' },
      },
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'f2',
      ownerId: 'u1',
      projectId: 'p1',
      towerId: 't1',
      floorNumber: 2,
      floorLabel: 'Floor 2',
      unitNumber: '201',
      unitType: '2 BHK',
      zones: {
        main_flooring_hall: { status: 'completed', sqft: 280, label: 'Main Flooring Hall', category: 'Flooring' },
        balcony_flooring: { status: 'not_started', sqft: 75, label: 'Balcony Flooring', category: 'Flooring' },
        corridor_skirting: { status: 'not_started', sqft: 65, label: 'Corridor Skirting', category: 'Skirting' },
      },
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'f3',
      ownerId: 'u1',
      projectId: 'p1',
      towerId: 't1',
      floorNumber: 3,
      floorLabel: 'Floor 3',
      unitNumber: '301',
      unitType: '4 BHK',
      zones: {
        balcony_flooring: { status: 'completed', sqft: 95, label: 'Balcony Flooring', category: 'Flooring' },
        hall_skirting: { status: 'not_started', sqft: 72, label: 'Hall Skirting', category: 'Skirting' },
        corridor_flooring: { status: 'not_started', sqft: 185, label: 'Corridor Flooring', category: 'Common' },
      },
      createdAt: '',
      updatedAt: '',
    },
  ];

  // Pending Balcony Areas across all floors -> f1 (balcony_flooring 85) and f2 (balcony_flooring 75), excludes f3 (completed)
  const pendingBalcony = computeProjectWorkStatusOverview({
    projects,
    towers,
    flats,
    areaFilter: 'balcony',
    statusFilter: 'pending',
  });
  assert.equal(pendingBalcony.matchingZonesTotal, 2);
  assert.equal(pendingBalcony.matchingSqftTotal, 160);
  assert.equal(pendingBalcony.flatRows.length, 2);
  assert.deepEqual(
    pendingBalcony.flatRows.map((r) => r.flat.unitNumber),
    ['101', '201']
  );

  // Pending Skirting on custom floors [1, 3] -> excludes Floor 2 (corridor_skirting)
  const customFloorSkirting = computeProjectWorkStatusOverview({
    projects,
    towers,
    flats,
    floorNumbers: [1, 3],
    areaFilter: 'skirting',
    statusFilter: 'pending',
  });
  assert.equal(customFloorSkirting.matchingZonesTotal, 2);
  assert.equal(customFloorSkirting.matchingSqftTotal, 140);
  assert.deepEqual(
    customFloorSkirting.flatRows.map((r) => r.flat.unitNumber),
    ['101', '301']
  );

  // Main Flooring pending -> f1 main_flooring_hall (320 sqft) only (excludes balcony, skirting, electrical)
  const mainFloorPending = computeProjectWorkStatusOverview({
    projects,
    towers,
    flats,
    areaFilter: 'main_flooring',
    statusFilter: 'pending',
  });
  assert.equal(mainFloorPending.matchingZonesTotal, 1);
  assert.equal(mainFloorPending.matchingSqftTotal, 320);
  assert.equal(mainFloorPending.flatRows[0].flat.unitNumber, '101');

  // Electrical Room pending
  const electricalPending = computeProjectWorkStatusOverview({
    projects,
    towers,
    flats,
    areaFilter: 'electrical',
    statusFilter: 'pending',
  });
  assert.equal(electricalPending.matchingZonesTotal, 1);
  assert.equal(electricalPending.flatRows[0].matchingZoneDetails[0].label, 'Electrical Room Flooring');
});

test('computeProjectWorkStatusOverview filters Electrical Room 1/2 and Lift Lobby accurately on dedicated Floor Common units', () => {
  const projects: Project[] = [
    {
      id: 'p1',
      ownerId: 'u1',
      name: 'Skyline',
      location: 'Hyd',
      clientName: 'Client',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const towers: Tower[] = [
    { id: 't1', ownerId: 'u1', projectId: 'p1', name: 'Tower A', totalFloors: 2, unitsPerFloor: 2, createdAt: '', updatedAt: '' },
  ];
  const flats: FlatUnit[] = [
    {
      id: 'f101',
      ownerId: 'u1',
      projectId: 'p1',
      towerId: 't1',
      floorNumber: 1,
      floorLabel: 'Floor 1',
      unitNumber: '101',
      unitType: '3 BHK',
      zones: {
        main_flooring_hall: { status: 'not_started', sqft: 320, label: 'Main Flooring Hall', category: 'Flooring' },
      },
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'fl1_common',
      ownerId: 'u1',
      projectId: 'p1',
      towerId: 't1',
      floorNumber: 1,
      floorLabel: 'Floor 1',
      unitNumber: 'FL1-Common',
      unitType: 'Floor Common Area',
      zones: {
        electrical_room_1_flooring: { status: 'not_started', sqft: 110, label: 'Electrical Room 1 Flooring', category: 'Flooring' },
        electrical_room_1_skirting: { status: 'not_started', sqft: 42, label: 'Electrical Room 1 Skirting', category: 'Skirting' },
        electrical_room_2_flooring: { status: 'completed', sqft: 110, label: 'Electrical Room 2 Flooring', category: 'Flooring' },
        electrical_room_2_skirting: { status: 'not_started', sqft: 42, label: 'Electrical Room 2 Skirting', category: 'Skirting' },
        lift_lobby_flooring: { status: 'in_progress', sqft: 165, label: 'Lift Lobby Flooring', category: 'Common' },
        lift_lobby_skirting: { status: 'not_started', sqft: 52, label: 'Lift Lobby Skirting', category: 'Skirting' },
      },
      createdAt: '',
      updatedAt: '',
    },
  ];

  // Electrical pending -> matches Electrical Room 1 Flooring, Electrical Room 1 Skirting, Electrical Room 2 Skirting (excludes completed Room 2 Flooring)
  const electricalPending = computeProjectWorkStatusOverview({
    projects,
    towers,
    flats,
    areaFilter: 'electrical',
    statusFilter: 'pending',
  });
  assert.equal(electricalPending.matchingZonesTotal, 3);
  assert.equal(electricalPending.matchingSqftTotal, 194);
  assert.equal(electricalPending.flatRows.length, 1);
  assert.equal(electricalPending.flatRows[0].flat.unitNumber, 'FL1-Common');

  // Lift Lobby all statuses -> Lift Lobby Flooring + Lift Lobby Skirting
  const liftLobbyAll = computeProjectWorkStatusOverview({
    projects,
    towers,
    flats,
    areaFilter: 'lift_lobby',
    statusFilter: 'all',
  });
  assert.equal(liftLobbyAll.matchingZonesTotal, 2);
  assert.equal(liftLobbyAll.matchingSqftTotal, 217);
  assert.deepEqual(
    liftLobbyAll.flatRows[0].matchingZoneDetails.map((d) => d.label),
    ['Lift Lobby Flooring', 'Lift Lobby Skirting']
  );
});

test('computeOverviewKpis aggregates active projects, workforce, today attendance pct, and pending food advances', () => {
  const projects: Project[] = [
    { id: 'p1', ownerId: 'u1', name: 'Site A', location: 'Hyd', clientName: 'C1', status: 'active', createdAt: '', updatedAt: '' },
    { id: 'p2', ownerId: 'u1', name: 'Site B', location: 'Hyd', clientName: 'C2', status: 'completed', createdAt: '', updatedAt: '' },
  ];
  const employees: Employee[] = [
    { id: 'e1', ownerId: 'u1', empCode: 'E1', fullName: 'Raju', role: 'Mason', phone: '9999999991', joiningDate: '', dailyRate: 900, overtimeRate: 120, foodAllowanceDaily: 150, aadharRef: '', emergencyContact: '', status: 'active', notes: '', createdAt: '', updatedAt: '' },
    { id: 'e2', ownerId: 'u1', empCode: 'E2', fullName: 'Suresh', role: 'Helper', phone: '9999999992', joiningDate: '', dailyRate: 600, overtimeRate: 90, foodAllowanceDaily: 150, aadharRef: '', emergencyContact: '', status: 'active', notes: '', createdAt: '', updatedAt: '' },
    { id: 'e3', ownerId: 'u1', empCode: 'E3', fullName: 'Inactive', role: 'Helper', phone: '9999999993', joiningDate: '', dailyRate: 600, overtimeRate: 90, foodAllowanceDaily: 150, aadharRef: '', emergencyContact: '', status: 'inactive', notes: '', createdAt: '', updatedAt: '' },
  ];
  const attendance: AttendanceRecord[] = [
    { id: 'a1', ownerId: 'u1', date: '2026-11-22', employeeId: 'e1', empCode: 'E1', employeeName: 'Raju', employeeRole: 'Mason', projectId: 'p1', projectName: 'Site A', status: 'present', overtimeHours: 0, dailyWageEarned: 900, overtimePayEarned: 0, notes: '', createdAt: '', updatedAt: '' },
  ];
  const advances: AdvanceEntry[] = [
    { id: 'adv1', ownerId: 'u1', date: '2026-11-22', employeeId: 'e1', empCode: 'E1', employeeName: 'Raju', employeePhone: '9999999991', advanceType: 'weekly_food', amount: 1200, paymentMode: 'upi', notes: '', whatsappShared: true, approvalStatus: 'pending_admin', acknowledged: false, createdAt: '', updatedAt: '' },
    { id: 'adv2', ownerId: 'u1', date: '2026-11-21', employeeId: 'e2', empCode: 'E2', employeeName: 'Suresh', employeePhone: '9999999992', advanceType: 'daily_food', amount: 200, paymentMode: 'cash', notes: '', whatsappShared: false, acknowledged: true, approvalStatus: 'approved', createdAt: '', updatedAt: '' },
    { id: 'adv3', ownerId: 'u1', date: '2026-11-20', employeeId: 'e2', empCode: 'E2', employeeName: 'Suresh', employeePhone: '9999999992', advanceType: 'weekly_food', amount: 800, paymentMode: 'cash', notes: '', whatsappShared: false, acknowledged: false, approvalStatus: 'rejected', createdAt: '', updatedAt: '' },
  ];

  const kpis = computeOverviewKpis({
    projects,
    employees,
    attendance,
    advances,
    date: '2026-11-22',
  });

  assert.equal(kpis.activeProjectsCount, 1);
  assert.equal(kpis.totalProjectsCount, 2);
  assert.equal(kpis.activeWorkforceCount, 2);
  assert.equal(kpis.totalWorkforceCount, 3);
  assert.equal(kpis.todayAttendedCount, 1);
  assert.equal(kpis.todayEligibleCount, 2);
  assert.equal(kpis.todayAttendancePct, 50);
  assert.equal(kpis.pendingFoodAdvancesCount, 1);
  assert.equal(kpis.pendingFoodAdvancesAmount, 1200);
  assert.equal(kpis.pendingApprovalFoodCount, 1);
});

test('computeProjectCompletionSeries computes completion percentages and color-coded status tiers accurately', () => {
  assert.equal(getProjectCompletionColor(80).tier, 'high');
  assert.equal(getProjectCompletionColor(50).tier, 'medium');
  assert.equal(getProjectCompletionColor(15).tier, 'low');

  const projects: Project[] = [
    { id: 'p_high', ownerId: 'u1', name: 'Green Site', location: 'Hyd', clientName: 'C1', status: 'active', createdAt: '', updatedAt: '' },
    { id: 'p_med', ownerId: 'u1', name: 'Amber Site', location: 'Hyd', clientName: 'C2', status: 'active', createdAt: '', updatedAt: '' },
    { id: 'p_low', ownerId: 'u1', name: 'Red Site', location: 'Hyd', clientName: 'C3', status: 'active', createdAt: '', updatedAt: '' },
  ];
  const towers: Tower[] = [
    { id: 't1', ownerId: 'u1', projectId: 'p_high', name: 'T1', totalFloors: 1, unitsPerFloor: 1, createdAt: '', updatedAt: '' },
    { id: 't2', ownerId: 'u1', projectId: 'p_med', name: 'T2', totalFloors: 1, unitsPerFloor: 1, createdAt: '', updatedAt: '' },
    { id: 't3', ownerId: 'u1', projectId: 'p_low', name: 'T3', totalFloors: 1, unitsPerFloor: 1, createdAt: '', updatedAt: '' },
  ];
  const flats: FlatUnit[] = [
    {
      id: 'f1', ownerId: 'u1', projectId: 'p_high', towerId: 't1', floorNumber: 1, unitNumber: '101', unitType: '3 BHK',
      zones: { a: { status: 'completed', sqft: 100 }, b: { status: 'completed', sqft: 100 }, c: { status: 'qc_approved', sqft: 100 }, d: { status: 'completed', sqft: 100 } },
      createdAt: '', updatedAt: '',
    },
    {
      id: 'f2', ownerId: 'u1', projectId: 'p_med', towerId: 't2', floorNumber: 1, unitNumber: '101', unitType: '3 BHK',
      zones: { a: { status: 'completed', sqft: 100 }, b: { status: 'in_progress', sqft: 100 } },
      createdAt: '', updatedAt: '',
    },
    {
      id: 'f3', ownerId: 'u1', projectId: 'p_low', towerId: 't3', floorNumber: 1, unitNumber: '101', unitType: '3 BHK',
      zones: { a: { status: 'not_started', sqft: 100 }, b: { status: 'not_started', sqft: 100 }, c: { status: 'not_started', sqft: 100 }, d: { status: 'not_started', sqft: 100 } },
      createdAt: '', updatedAt: '',
    },
  ];

  const series = computeProjectCompletionSeries({
    projects,
    towers,
    flats,
    tileZoneCatalog: [],
  });
  assert.equal(series.length, 3);
  assert.equal(series[0].completionPct, 100);
  assert.equal(series[0].tier, 'high');
  assert.equal(series[0].completedFlats, 1);
  assert.equal(series[1].completionPct, 50);
  assert.equal(series[1].tier, 'medium');
  assert.equal(series[2].completionPct, 0);
  assert.equal(series[2].tier, 'low');
});

test('normalizeSkillTags and filterEmployeesBySkillTags filter workers accurately by proficiencies', () => {
  const tags = normalizeSkillTags([' Marble Specialist ', 'Granite Cutter', 'marble specialist', '  ']);
  assert.deepEqual(tags, ['Marble Specialist', 'Granite Cutter']);

  const e1: Employee = {
    id: 'e1',
    ownerId: 'u1',
    empCode: 'AVY-MSN-001',
    fullName: 'Raju Mistri',
    role: 'Mason',
    phone: '9876543210',
    joiningDate: '',
    dailyRate: 950,
    overtimeRate: 118.75,
    foodAllowanceDaily: 0,
    aadharRef: '',
    emergencyContact: '',
    skillTags: ['Marble Specialist', 'Skirting Specialist'],
    status: 'active',
    notes: '',
    createdAt: '',
    updatedAt: '',
  };
  const e2: Employee = {
    ...e1,
    id: 'e2',
    empCode: 'AVY-MSN-002',
    fullName: 'Imran',
    skillTags: ['Granite Cutter', 'Epoxy Grouting'],
  };
  const e3: Employee = {
    ...e1,
    id: 'e3',
    empCode: 'AVY-HLP-003',
    fullName: 'Kiran',
    role: 'Helper',
    skillTags: [],
  };

  assert.equal(filterEmployeesBySkillTags([e1, e2, e3], []).length, 3);
  assert.deepEqual(
    filterEmployeesBySkillTags([e1, e2, e3], ['Marble Specialist']).map((e) => e.id),
    ['e1']
  );
  assert.deepEqual(
    filterEmployeesBySkillTags([e1, e2, e3], ['Granite Cutter', 'Marble Specialist'], 'any').map((e) => e.id),
    ['e1', 'e2']
  );
  assert.equal(
    filterEmployeesBySkillTags([e1, e2, e3], ['Marble Specialist', 'Epoxy Grouting'], 'all').length,
    0
  );
});

test('normalizeHHMM, computeWorkedHoursFromInOut, and formatAttendanceInOutSummary handle In/Out timestamps', () => {
  assert.equal(normalizeHHMM('9:05'), '09:05');
  assert.equal(normalizeHHMM('invalid'), '');
  const hrs = computeWorkedHoursFromInOut('09:00', '20:30');
  assert.equal(hrs.valid, true);
  assert.equal(hrs.totalHours, 11.5);
  assert.equal(hrs.overtimeHoursEstimate, 2.5);

  assert.equal(formatAttendanceInOutSummary({ inTime: '09:05', outTime: '18:30' }), 'In 09:05 · Out 18:30');
  assert.equal(formatAttendanceInOutSummary({ inTime: '09:05' }), 'In 09:05 · Active');
  assert.equal(formatAttendanceInOutSummary({}), 'Time not logged');
});

test('summarizeSupervisorToolSpends aggregates supervisor tool & site expenses by approval status', () => {
  const expenses: SiteExpense[] = [
    {
      id: 'exp_adm',
      ownerId: 'u1',
      date: '2026-11-20',
      projectId: 'p1',
      projectName: 'Skyline',
      category: 'material',
      description: 'Adhesive bulk',
      amount: 12000,
      paymentMode: 'bank_transfer',
      recordedByRole: 'admin',
      notes: '',
      createdAt: '2026-11-20T09:00:00Z',
      updatedAt: '',
    },
    {
      id: 'exp_sup_1',
      ownerId: 'u1',
      date: '2026-11-22',
      projectId: 'p1',
      projectName: 'Skyline',
      towerId: 't1',
      towerName: 'Tower A',
      category: 'tools_equipment',
      description: 'Diamond blades',
      toolItemsSummary: 'Diamond Cutting Blade',
      billReceiptNumber: 'BILL-881',
      amount: 1450,
      paymentMode: 'upi',
      recordedByRole: 'supervisor',
      recordedByName: 'Prakash Reddy',
      reimbursementStatus: 'pending_admin',
      notes: '',
      createdAt: '2026-11-22T10:00:00Z',
      updatedAt: '',
    },
    {
      id: 'exp_sup_2',
      ownerId: 'u1',
      date: '2026-11-21',
      projectId: 'p1',
      projectName: 'Skyline',
      towerId: 't1',
      towerName: 'Tower A',
      category: 'tools_equipment',
      description: 'Tile spacers 4mm',
      amount: 600,
      paymentMode: 'cash',
      recordedByRole: 'supervisor',
      recordedByName: 'Prakash Reddy',
      reimbursementStatus: 'reimbursed',
      notes: '',
      createdAt: '2026-11-21T12:00:00Z',
      updatedAt: '',
    },
  ];

  const sum = summarizeSupervisorToolSpends(expenses);
  assert.equal(sum.totalCount, 2);
  assert.equal(sum.totalAmount, 2050);
  assert.equal(sum.pendingCount, 1);
  assert.equal(sum.pendingAmount, 1450);
  assert.equal(sum.reimbursedCount, 1);
  assert.equal(sum.reimbursedAmount, 600);
});








