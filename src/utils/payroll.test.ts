import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmployeePayrollExpenseCsv,
  buildMailtoUrl,
  buildWhatsappUrl,
  computeDailyWage,
  computeEmployeePayroll,
  computeIndividualEmployeePaymentDetails,
  computeMonthlyAttendanceMatrix,
  computePayrollLedgerOverview,
  formatAdvanceWhatsappMessage,
  formatMonthlyAttendanceWhatsappMessage,
  formatPaymentSummaryWhatsappMessage,
  generateEmployeeCode,
  getAdvanceCategoryLabel,
  sanitizeWhatsappPhone,
} from './payroll';
import type { AdvanceEntry, AttendanceRecord, Employee, SettlementEntry } from '../types/avy';

const sampleEmployee: Employee = {
  id: 'emp-1',
  ownerId: 'owner-1',
  empCode: 'AVY-MSN-001',
  fullName: 'Raju Mistri',
  role: 'Mason',
  phone: '9876543210',
  email: 'raju@example.com',
  joiningDate: '2026-01-10',
  dailyRate: 1000,
  overtimeRate: 150,
  foodAllowanceDaily: 150,
  aadharRef: 'XXXX-4412',
  pfNumber: 'PF-HYD-1122',
  esiNumber: 'ESI-8899',
  bloodGroup: 'O+',
  emergencyContact: '9988776655',
  currentProjectId: 'p1',
  currentProjectName: 'Skyline',
  currentTowerId: 't1',
  currentTowerName: 'Tower A',
  status: 'active',
  notes: '',
  createdAt: '2026-01-10T00:00:00Z',
  updatedAt: '2026-01-10T00:00:00Z',
};

const secondEmployee: Employee = {
  ...sampleEmployee,
  id: 'emp-2',
  empCode: 'AVY-HLP-002',
  fullName: 'Suresh Kumar',
  role: 'Helper',
  dailyRate: 650,
  overtimeRate: 90,
  currentProjectId: 'p2',
  currentProjectName: 'Emerald Heights',
  currentTowerId: 't2',
  currentTowerName: 'Tower B',
};

test('generateEmployeeCode increments sequence by role prefix', () => {
  const code = generateEmployeeCode('Helper', [sampleEmployee]);
  assert.equal(code, 'AVY-HLP-002');
});

test('computeDailyWage handles present, half_day, absent, and overtime', () => {
  assert.deepEqual(computeDailyWage(1000, 150, 'present', 2), {
    dailyWageEarned: 1000,
    overtimePayEarned: 300,
    totalEarned: 1300,
  });
  assert.deepEqual(computeDailyWage(1000, 150, 'half_day', 1), {
    dailyWageEarned: 500,
    overtimePayEarned: 150,
    totalEarned: 650,
  });
  assert.deepEqual(computeDailyWage(1000, 150, 'absent', 3), {
    dailyWageEarned: 0,
    overtimePayEarned: 0,
    totalEarned: 0,
  });
});

test('computeEmployeePayroll deducts daily food, weekly food, cash advances, custom advances, and settlements and calculates total worker expenses', () => {
  const attendance: AttendanceRecord[] = [
    {
      id: 'att-1',
      ownerId: 'owner-1',
      date: '2026-11-14',
      employeeId: 'emp-1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Mistri',
      employeeRole: 'Mason',
      projectId: 'p1',
      projectName: 'Skyline',
      status: 'present',
      overtimeHours: 2,
      dailyWageEarned: 1000,
      overtimePayEarned: 300,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'att-2',
      ownerId: 'owner-1',
      date: '2026-11-15',
      employeeId: 'emp-1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Mistri',
      employeeRole: 'Mason',
      projectId: 'p1',
      projectName: 'Skyline',
      status: 'half_day',
      overtimeHours: 0,
      dailyWageEarned: 500,
      overtimePayEarned: 0,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const advances: AdvanceEntry[] = [
    {
      id: 'adv-1',
      ownerId: 'owner-1',
      date: '2026-11-14',
      employeeId: 'emp-1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Mistri',
      employeePhone: '9876543210',
      advanceType: 'daily_food',
      amount: 150,
      paymentMode: 'cash',
      notes: 'Lunch',
      whatsappShared: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'adv-2',
      ownerId: 'owner-1',
      date: '2026-11-15',
      employeeId: 'emp-1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Mistri',
      employeePhone: '9876543210',
      advanceType: 'weekly_food',
      amount: 500,
      paymentMode: 'upi',
      paymentApp: 'GPay',
      transactionId: 'UTR12345678',
      upiId: 'raju@okicici',
      notes: 'Weekly mess',
      whatsappShared: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'adv-3',
      ownerId: 'owner-1',
      date: '2026-11-16',
      employeeId: 'emp-1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Mistri',
      employeePhone: '9876543210',
      advanceType: 'custom',
      customCategory: 'Medical Support',
      amount: 200,
      paymentMode: 'upi',
      paymentApp: 'PhonePe',
      transactionId: 'PP99887766',
      upiId: 'raju@ybl',
      proofImageDataUrl: 'data:image/jpeg;base64,abc',
      notes: 'Clinic medicine',
      whatsappShared: false,
      createdAt: '',
      updatedAt: '',
    },
  ];

  const settlements: SettlementEntry[] = [
    {
      id: 'stl-1',
      ownerId: 'owner-1',
      employeeId: 'emp-1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Mistri',
      periodStart: '2026-11-14',
      periodEnd: '2026-11-16',
      daysWorked: 1.5,
      grossWages: 1500,
      overtimePay: 300,
      totalAdvances: 850,
      netPaid: 450,
      paymentMode: 'upi',
      settledDate: '2026-11-16',
      notes: 'Partial settlement',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const summary = computeEmployeePayroll(sampleEmployee, attendance, advances, settlements);
  assert.equal(summary.effectiveDaysWorked, 1.5);
  assert.equal(summary.grossWages, 1500);
  assert.equal(summary.overtimePay, 300);
  assert.equal(summary.totalEarned, 1800);
  assert.equal(summary.dailyFoodAdvance, 150);
  assert.equal(summary.weeklyFoodAdvance, 500);
  assert.equal(summary.foodAdvanceTotal, 650);
  assert.equal(summary.customAdvance, 200);
  assert.equal(summary.customAdvanceBreakdown[0]?.label, 'Medical Support');
  assert.equal(summary.advanceCount, 3);
  assert.equal(summary.settlementCount, 1);
  assert.equal(summary.totalAdvances, 850);
  assert.equal(summary.totalSettled, 450);
  assert.equal(summary.totalDisbursed, 1300);
  assert.equal(summary.totalEmployeeExpenses, 2650);
  assert.equal(summary.netPayable, 500);

  const details = computeIndividualEmployeePaymentDetails({
    employee: sampleEmployee,
    attendance,
    advances,
    settlements,
  });
  assert.equal(details.attendanceEntries.length, 2);
  assert.equal(details.advanceEntries.length, 3);
  assert.equal(details.advanceEntries[0].categoryLabel, 'Medical Support');
  assert.equal(details.digitalTxnCount, 3);
  assert.equal(details.proofsCount, 1);
  assert.equal(getAdvanceCategoryLabel(advances[2]), 'Medical Support');

  const waStatement = formatPaymentSummaryWhatsappMessage(summary, 'Nov 14–16');
  assert.ok(waStatement.includes('Total Advances Given: ₹850'));
  assert.ok(waStatement.includes('Total Worker Expenses (Wages + Adv): ₹2,650'));
});

test('computePayrollLedgerOverview aggregates employee-wise advances and total expenses with project/tower/search filters and builds CSV', () => {
  const attendance: AttendanceRecord[] = [
    {
      id: 'att-1',
      ownerId: 'owner-1',
      date: '2026-11-14',
      employeeId: 'emp-1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Mistri',
      employeeRole: 'Mason',
      projectId: 'p1',
      projectName: 'Skyline',
      status: 'present',
      overtimeHours: 2,
      dailyWageEarned: 1000,
      overtimePayEarned: 300,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'att-2',
      ownerId: 'owner-1',
      date: '2026-11-14',
      employeeId: 'emp-2',
      empCode: 'AVY-HLP-002',
      employeeName: 'Suresh Kumar',
      employeeRole: 'Helper',
      projectId: 'p2',
      projectName: 'Emerald Heights',
      status: 'present',
      overtimeHours: 0,
      dailyWageEarned: 650,
      overtimePayEarned: 0,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const advances: AdvanceEntry[] = [
    {
      id: 'adv-1',
      ownerId: 'owner-1',
      date: '2026-11-14',
      employeeId: 'emp-1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Mistri',
      employeePhone: '9876543210',
      advanceType: 'cash_advance',
      amount: 500,
      paymentMode: 'cash',
      notes: 'Cash advance',
      whatsappShared: true,
      createdAt: '2026-11-14T10:00:00Z',
      updatedAt: '',
    },
    {
      id: 'adv-2',
      ownerId: 'owner-1',
      date: '2026-11-14',
      employeeId: 'emp-2',
      empCode: 'AVY-HLP-002',
      employeeName: 'Suresh Kumar',
      employeePhone: '9876543210',
      advanceType: 'daily_food',
      amount: 120,
      paymentMode: 'cash',
      notes: 'Lunch',
      whatsappShared: false,
      createdAt: '2026-11-14T11:00:00Z',
      updatedAt: '',
    },
  ];

  const allOverview = computePayrollLedgerOverview({
    employees: [sampleEmployee, secondEmployee],
    attendance,
    advances,
    settlements: [],
  });
  assert.equal(allOverview.rows.length, 2);
  assert.equal(allOverview.rows[0].summary.employee.id, 'emp-1'); // higher expenses (1800 vs 770)
  assert.equal(allOverview.totals.totalWagesEarned, 1950);
  assert.equal(allOverview.totals.totalAdvances, 620);
  assert.equal(allOverview.totals.totalEmployeeExpenses, 2570);
  assert.equal(allOverview.totals.totalNetPayable, 1330);

  const filteredOverview = computePayrollLedgerOverview({
    employees: [sampleEmployee, secondEmployee],
    attendance,
    advances,
    settlements: [],
    projectId: 'p2',
    towerId: 't2',
    search: 'suresh',
  });
  assert.equal(filteredOverview.rows.length, 1);
  assert.equal(filteredOverview.rows[0].advanceEntries.length, 1);
  assert.equal(filteredOverview.totals.totalEmployeeExpenses, 770);

  const csv = buildEmployeePayrollExpenseCsv(allOverview, 'All Days');
  assert.ok(csv.includes('Total Worker Expenses (Wages + Advances)'));
  assert.ok(csv.includes('AVY-MSN-001'));
  assert.ok(csv.includes('2570'));
});

test('computeMonthlyAttendanceMatrix aggregates monthly attendance and builds WhatsApp & Mailto links', () => {
  const attendance: AttendanceRecord[] = [
    {
      id: 'att-1',
      ownerId: 'owner-1',
      date: '2026-11-14',
      employeeId: 'emp-1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Mistri',
      employeeRole: 'Mason',
      projectId: 'p1',
      projectName: 'Skyline',
      status: 'present',
      overtimeHours: 2,
      dailyWageEarned: 1000,
      overtimePayEarned: 300,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'att-2',
      ownerId: 'owner-1',
      date: '2026-11-15',
      employeeId: 'emp-1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Mistri',
      employeeRole: 'Mason',
      projectId: 'p1',
      projectName: 'Skyline',
      status: 'half_day',
      overtimeHours: 0,
      dailyWageEarned: 500,
      overtimePayEarned: 0,
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const matrix = computeMonthlyAttendanceMatrix([sampleEmployee], attendance, '2026-11', 'p1');
  assert.equal(matrix.daysInMonth, 30);
  assert.equal(matrix.rows[0].presentDays, 1);
  assert.equal(matrix.rows[0].halfDays, 1);
  assert.equal(matrix.rows[0].effectiveDays, 1.5);
  assert.equal(matrix.rows[0].dayStatuses[14], 'present');
  assert.equal(matrix.rows[0].dayStatuses[15], 'half_day');
  assert.equal(matrix.rows[0].totalWagesEarned, 1800);

  const report = formatMonthlyAttendanceWhatsappMessage(matrix, 'Skyline', 'AVY INFRA', 'emp-1');
  assert.ok(report.includes('Monthly Attendance Report'));
  assert.ok(report.includes('14:P, 15:HD'));

  const mailUrl = buildMailtoUrl('raju@example.com', 'November Attendance', report);
  assert.ok(mailUrl.startsWith('mailto:raju%40example.com?subject='));
});

test('WhatsApp phone sanitization and advance message formatting include custom category and UPI Txn ID', () => {
  assert.equal(sanitizeWhatsappPhone('98765-43210'), '919876543210');
  const msg = formatAdvanceWhatsappMessage(
    {
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju Mistri',
      advanceType: 'custom',
      customCategory: 'Travel Advance',
      amount: 200,
      date: '2026-11-16',
      paymentMode: 'upi',
      paymentApp: 'GPay',
      transactionId: 'UTR778899',
      upiId: 'raju@okaxis',
      notes: 'Bus ticket',
    },
    1150
  );
  assert.ok(msg.includes('AVY-MSN-001'));
  assert.ok(msg.includes('Travel Advance'));
  assert.ok(msg.includes('GPay'));
  assert.ok(msg.includes('UTR778899'));
  assert.ok(msg.includes('raju@okaxis'));
  assert.ok(msg.includes('₹200'));
  const url = buildWhatsappUrl('9876543210', msg);
  assert.ok(url.startsWith('https://wa.me/919876543210?text='));
});
