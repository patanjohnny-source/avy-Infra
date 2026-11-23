import type {
  AdvanceEntry,
  AdvanceType,
  AttendanceRecord,
  AttendanceStatus,
  Employee,
  EmployeeRole,
  SettlementEntry,
} from '../types/avy';

const ROLE_PREFIX: Record<EmployeeRole, string> = {
  Mason: 'MSN',
  Helper: 'HLP',
  'Material Shifting': 'MSH',
  Supervisor: 'SUP',
  Engineer: 'ENG',
};

export const ADVANCE_TYPE_LABELS: Record<AdvanceType, string> = {
  daily_food: 'Daily Food Advance',
  weekly_food: 'Weekly Food Advance',
  cash_advance: 'Cash / Work Advance',
  custom: 'Custom Category',
};

export function getAdvanceCategoryLabel(
  adv: Pick<AdvanceEntry, 'advanceType' | 'customCategory'>
): string {
  if (adv.advanceType === 'custom' && adv.customCategory?.trim()) {
    return adv.customCategory.trim();
  }
  return ADVANCE_TYPE_LABELS[adv.advanceType] || 'Advance';
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  half_day: 'Half Day',
  absent: 'Absent',
};

/**
 * Generates a unique AVY INFRA employee ID like AVY-MSN-001.
 */
export function generateEmployeeCode(role: EmployeeRole, existingEmployees: Employee[]): string {
  const prefix = `AVY-${ROLE_PREFIX[role]}-`;
  let maxSeq = 0;
  for (const emp of existingEmployees) {
    const match = emp.empCode.match(/(\d+)$/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `${prefix}${nextSeq}`;
}

/**
 * Converts a worker's daily wage rate into the default 1-hour OT rate (Daily Rate ÷ 8 hours).
 */
export function computeDefaultHourlyOtRate(dailyRate: number): number {
  const safeDaily = Math.max(0, Number(dailyRate) || 0);
  if (safeDaily <= 0) return 0;
  return Number((safeDaily / 8).toFixed(2));
}

/**
 * Computes daily wage + overtime earned for an attendance entry.
 */
export function computeDailyWage(
  dailyRate: number,
  overtimeRate: number,
  status: AttendanceStatus,
  overtimeHours: number
): { dailyWageEarned: number; overtimePayEarned: number; totalEarned: number } {
  const safeDailyRate = Math.max(0, Number(dailyRate) || 0);
  const safeOtRate = Math.max(0, Number(overtimeRate) || 0);
  const safeOtHours = Math.max(0, Number(overtimeHours) || 0);

  let multiplier = 0;
  if (status === 'present') multiplier = 1;
  else if (status === 'half_day') multiplier = 0.5;

  const dailyWageEarned = Math.round(safeDailyRate * multiplier);
  const overtimePayEarned = status === 'absent' ? 0 : Math.round(safeOtRate * safeOtHours);

  return {
    dailyWageEarned,
    overtimePayEarned,
    totalEarned: dailyWageEarned + overtimePayEarned,
  };
}

export interface EmployeePayrollSummary {
  employee: Employee;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  effectiveDaysWorked: number;
  grossWages: number;
  overtimeHours: number;
  overtimePay: number;
  totalEarned: number;
  dailyFoodAdvance: number;
  weeklyFoodAdvance: number;
  foodAdvanceTotal: number;
  cashAdvance: number;
  customAdvance: number;
  customAdvanceBreakdown: Array<{ label: string; amount: number }>;
  advanceCount: number;
  settlementCount: number;
  totalAdvances: number;
  totalSettled: number;
  totalDisbursed: number;
  totalEmployeeExpenses: number;
  netPayable: number;
}

export function computeEmployeePayroll(
  employee: Employee,
  attendanceRecords: AttendanceRecord[],
  advances: AdvanceEntry[],
  settlements: SettlementEntry[],
  dateRange?: { start?: string; end?: string }
): EmployeePayrollSummary {
  const inRange = (dateStr: string) => {
    if (dateRange?.start && dateStr < dateRange.start) return false;
    if (dateRange?.end && dateStr > dateRange.end) return false;
    return true;
  };

  let presentDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  let grossWages = 0;
  let overtimeHours = 0;
  let overtimePay = 0;

  for (const rec of attendanceRecords) {
    if (rec.employeeId !== employee.id || !inRange(rec.date)) continue;
    if (rec.status === 'present') presentDays += 1;
    else if (rec.status === 'half_day') halfDays += 1;
    else absentDays += 1;

    grossWages += rec.dailyWageEarned;
    overtimeHours += rec.overtimeHours;
    overtimePay += rec.overtimePayEarned;
  }

  let dailyFoodAdvance = 0;
  let weeklyFoodAdvance = 0;
  let cashAdvance = 0;
  let customAdvance = 0;
  let advanceCount = 0;
  const customMap = new Map<string, number>();

  for (const adv of advances) {
    if (adv.employeeId !== employee.id || !inRange(adv.date)) continue;
    advanceCount += 1;
    if (adv.advanceType === 'daily_food') {
      dailyFoodAdvance += adv.amount;
    } else if (adv.advanceType === 'weekly_food') {
      weeklyFoodAdvance += adv.amount;
    } else if (adv.advanceType === 'custom') {
      customAdvance += adv.amount;
      const lbl = getAdvanceCategoryLabel(adv);
      customMap.set(lbl, (customMap.get(lbl) || 0) + adv.amount);
    } else {
      cashAdvance += adv.amount;
    }
  }

  let totalSettled = 0;
  let settlementCount = 0;
  for (const stl of settlements) {
    if (stl.employeeId !== employee.id) continue;
    if (dateRange?.start && stl.settledDate < dateRange.start) continue;
    if (dateRange?.end && stl.settledDate > dateRange.end) continue;
    settlementCount += 1;
    totalSettled += stl.netPaid;
  }

  const effectiveDaysWorked = presentDays + halfDays * 0.5;
  const totalEarned = grossWages + overtimePay;
  const foodAdvanceTotal = dailyFoodAdvance + weeklyFoodAdvance;
  const totalAdvances = foodAdvanceTotal + cashAdvance + customAdvance;
  const totalDisbursed = totalAdvances + totalSettled;
  const totalEmployeeExpenses = totalEarned + totalAdvances;
  const netPayable = totalEarned - totalAdvances - totalSettled;
  const customAdvanceBreakdown = Array.from(customMap.entries())
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    employee,
    presentDays,
    halfDays,
    absentDays,
    effectiveDaysWorked,
    grossWages,
    overtimeHours,
    overtimePay,
    totalEarned,
    dailyFoodAdvance,
    weeklyFoodAdvance,
    foodAdvanceTotal,
    cashAdvance,
    customAdvance,
    customAdvanceBreakdown,
    advanceCount,
    settlementCount,
    totalAdvances,
    totalSettled,
    totalDisbursed,
    totalEmployeeExpenses,
    netPayable,
  };
}

export type PayrollLedgerSortKey = 'expenses_desc' | 'advances_desc' | 'net_desc' | 'name_asc';

export interface PayrollLedgerRow {
  summary: EmployeePayrollSummary;
  advanceEntries: Array<AdvanceEntry & { categoryLabel: string }>;
  settlementEntries: SettlementEntry[];
}

export interface PayrollLedgerTotals {
  workerCount: number;
  activeActivityCount: number;
  totalDaysWorked: number;
  totalOvertimeHours: number;
  totalWagesEarned: number;
  totalDailyFood: number;
  totalWeeklyFood: number;
  totalFoodAdvance: number;
  totalCashAdvance: number;
  totalCustomAdvance: number;
  totalAdvances: number;
  totalAdvanceEntries: number;
  totalSettled: number;
  totalDisbursed: number;
  totalEmployeeExpenses: number;
  totalNetPayable: number;
}

export interface PayrollLedgerOverview {
  rows: PayrollLedgerRow[];
  totals: PayrollLedgerTotals;
}

export function computePayrollLedgerOverview(params: {
  employees: Employee[];
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  settlements: SettlementEntry[];
  dateRange?: { start?: string; end?: string };
  projectId?: string;
  towerId?: string;
  search?: string;
  onlyWithActivity?: boolean;
  sortBy?: PayrollLedgerSortKey;
}): PayrollLedgerOverview {
  const {
    employees,
    attendance,
    advances,
    settlements,
    dateRange,
    projectId = 'all',
    towerId = 'all',
    search = '',
    onlyWithActivity = false,
    sortBy = 'expenses_desc',
  } = params;

  const q = search.trim().toLowerCase();
  const inRange = (dateStr: string) => {
    if (dateRange?.start && dateStr < dateRange.start) return false;
    if (dateRange?.end && dateStr > dateRange.end) return false;
    return true;
  };

  const filteredEmployees = employees.filter((emp) => {
    if (projectId !== 'all' && emp.currentProjectId !== projectId) return false;
    if (towerId !== 'all' && emp.currentTowerId !== towerId) return false;
    if (q) {
      const hay = `${emp.fullName} ${emp.empCode} ${emp.role} ${emp.currentProjectName || ''} ${
        emp.currentTowerName || ''
      }`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const rowsRaw: PayrollLedgerRow[] = [];

  for (const emp of filteredEmployees) {
    const summary = computeEmployeePayroll(emp, attendance, advances, settlements, dateRange);
    const hasActivity =
      summary.effectiveDaysWorked > 0 ||
      summary.totalEarned > 0 ||
      summary.totalAdvances > 0 ||
      summary.totalSettled > 0;
    if (onlyWithActivity && !hasActivity) continue;

    const empAdvances = advances
      .filter((adv) => adv.employeeId === emp.id && inRange(adv.date))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map((adv) => ({
        ...adv,
        categoryLabel: getAdvanceCategoryLabel(adv),
      }));

    const empSettlements = settlements
      .filter((stl) => stl.employeeId === emp.id && inRange(stl.settledDate))
      .sort((a, b) => b.settledDate.localeCompare(a.settledDate) || b.createdAt.localeCompare(a.createdAt));

    rowsRaw.push({
      summary,
      advanceEntries: empAdvances,
      settlementEntries: empSettlements,
    });
  }

  const rows = [...rowsRaw].sort((a, b) => {
    if (sortBy === 'advances_desc') {
      return (
        b.summary.totalAdvances - a.summary.totalAdvances ||
        b.summary.totalEmployeeExpenses - a.summary.totalEmployeeExpenses ||
        a.summary.employee.fullName.localeCompare(b.summary.employee.fullName)
      );
    }
    if (sortBy === 'net_desc') {
      return (
        b.summary.netPayable - a.summary.netPayable ||
        b.summary.totalEmployeeExpenses - a.summary.totalEmployeeExpenses ||
        a.summary.employee.fullName.localeCompare(b.summary.employee.fullName)
      );
    }
    if (sortBy === 'name_asc') {
      return a.summary.employee.fullName.localeCompare(b.summary.employee.fullName);
    }
    // Default: expenses_desc
    return (
      b.summary.totalEmployeeExpenses - a.summary.totalEmployeeExpenses ||
      b.summary.totalAdvances - a.summary.totalAdvances ||
      a.summary.employee.fullName.localeCompare(b.summary.employee.fullName)
    );
  });

  const totals: PayrollLedgerTotals = {
    workerCount: rows.length,
    activeActivityCount: 0,
    totalDaysWorked: 0,
    totalOvertimeHours: 0,
    totalWagesEarned: 0,
    totalDailyFood: 0,
    totalWeeklyFood: 0,
    totalFoodAdvance: 0,
    totalCashAdvance: 0,
    totalCustomAdvance: 0,
    totalAdvances: 0,
    totalAdvanceEntries: 0,
    totalSettled: 0,
    totalDisbursed: 0,
    totalEmployeeExpenses: 0,
    totalNetPayable: 0,
  };

  for (const row of rows) {
    const s = row.summary;
    if (s.totalEmployeeExpenses > 0 || s.totalSettled > 0) {
      totals.activeActivityCount += 1;
    }
    totals.totalDaysWorked += s.effectiveDaysWorked;
    totals.totalOvertimeHours += s.overtimeHours;
    totals.totalWagesEarned += s.totalEarned;
    totals.totalDailyFood += s.dailyFoodAdvance;
    totals.totalWeeklyFood += s.weeklyFoodAdvance;
    totals.totalFoodAdvance += s.foodAdvanceTotal;
    totals.totalCashAdvance += s.cashAdvance;
    totals.totalCustomAdvance += s.customAdvance;
    totals.totalAdvances += s.totalAdvances;
    totals.totalAdvanceEntries += s.advanceCount;
    totals.totalSettled += s.totalSettled;
    totals.totalDisbursed += s.totalDisbursed;
    totals.totalEmployeeExpenses += s.totalEmployeeExpenses;
    totals.totalNetPayable += s.netPayable;
  }

  return { rows, totals };
}

function escapeCsvCell(val: string | number): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildEmployeePayrollExpenseCsv(
  overview: PayrollLedgerOverview,
  periodLabel: string
): string {
  const header = [
    'Period',
    'Emp Code',
    'Employee Name',
    'Role',
    'Project',
    'Tower',
    'Daily Rate (INR)',
    'Days Worked',
    'OT Hours',
    'Wages + OT (INR)',
    'Daily Food Adv (INR)',
    'Weekly Food Adv (INR)',
    'Total Food Adv (INR)',
    'Cash Adv (INR)',
    'Custom Adv (INR)',
    'Advance Count',
    'Total Advances (INR)',
    'Salary Settled (INR)',
    'Total Paid Outflow (Adv + Settled)',
    'Total Worker Expenses (Wages + Advances)',
    'Net Payable (INR)',
  ];

  const lines = [header.map(escapeCsvCell).join(',')];

  for (const { summary: s } of overview.rows) {
    lines.push(
      [
        periodLabel,
        s.employee.empCode,
        s.employee.fullName,
        s.employee.role,
        s.employee.currentProjectName || 'Unassigned',
        s.employee.currentTowerName || 'All Towers',
        s.employee.dailyRate,
        s.effectiveDaysWorked,
        s.overtimeHours,
        s.totalEarned,
        s.dailyFoodAdvance,
        s.weeklyFoodAdvance,
        s.foodAdvanceTotal,
        s.cashAdvance,
        s.customAdvance,
        s.advanceCount,
        s.totalAdvances,
        s.totalSettled,
        s.totalDisbursed,
        s.totalEmployeeExpenses,
        s.netPayable,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }

  const t = overview.totals;
  lines.push(
    [
      periodLabel,
      'TOTAL',
      `${t.workerCount} Workers`,
      '',
      '',
      '',
      '',
      t.totalDaysWorked,
      t.totalOvertimeHours,
      t.totalWagesEarned,
      t.totalDailyFood,
      t.totalWeeklyFood,
      t.totalFoodAdvance,
      t.totalCashAdvance,
      t.totalCustomAdvance,
      t.totalAdvanceEntries,
      t.totalAdvances,
      t.totalSettled,
      t.totalDisbursed,
      t.totalEmployeeExpenses,
      t.totalNetPayable,
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return lines.join('\n');
}

export function buildMonthlyAttendanceAndPayrollCsv(params: {
  yearMonth: string;
  employees: Employee[];
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  settlements: SettlementEntry[];
  projectIdFilter?: string;
  hideSalary?: boolean;
}): { csv: string; fileName: string; rowCount: number; monthLabel: string } {
  const {
    yearMonth,
    employees,
    attendance,
    advances,
    settlements,
    projectIdFilter = 'all',
    hideSalary = false,
  } = params;

  const daysInMonth = getDaysInYearMonth(yearMonth);
  const monthLabel = formatYearMonthLabel(yearMonth);
  const monthStart = `${yearMonth}-01`;
  const monthEnd = `${yearMonth}-${String(daysInMonth).padStart(2, '0')}`;

  const scopedEmployees =
    projectIdFilter !== 'all'
      ? employees.filter((e) => e.currentProjectId === projectIdFilter)
      : employees;

  const filteredAttendance =
    projectIdFilter !== 'all'
      ? attendance.filter((a) => a.projectId === projectIdFilter)
      : attendance;

  const matrix = computeMonthlyAttendanceMatrix(
    scopedEmployees,
    filteredAttendance,
    yearMonth,
    projectIdFilter
  );

  const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => `Day ${String(i + 1).padStart(2, '0')}`);

  const header: string[] = [
    'Month',
    'Emp Code',
    'Employee Name',
    'Role',
    'Project',
    'Tower',
    ...dayHeaders,
    'Present Days',
    'Half Days',
    'Absent Days',
    'Effective Days Worked',
    'OT Hours',
    ...(hideSalary
      ? []
      : [
          'Daily Rate (INR)',
          'OT Rate/Hr (INR)',
          'Gross Wages (INR)',
          'Overtime Pay (INR)',
          'Total Wages Earned (INR)',
        ]),
    'Daily Food Adv (INR)',
    'Weekly Food Adv (INR)',
    'Cash Adv (INR)',
    'Custom Adv (INR)',
    'Total Advances (INR)',
    ...(hideSalary ? [] : ['Salary Settled (INR)', 'Net Payable (INR)']),
  ];

  const lines = [header.map(escapeCsvCell).join(',')];

  let totalPresent = 0;
  let totalHalf = 0;
  let totalAbsent = 0;
  let totalEffective = 0;
  let totalOtHours = 0;
  let totalGrossWages = 0;
  let totalOvertimePay = 0;
  let totalEarned = 0;
  let totalDailyFood = 0;
  let totalWeeklyFood = 0;
  let totalCashAdv = 0;
  let totalCustomAdv = 0;
  let totalAdvances = 0;
  let totalSettled = 0;
  let totalNetPayable = 0;

  for (const row of matrix.rows) {
    const emp = row.employee;
    const pay = computeEmployeePayroll(
      emp,
      filteredAttendance,
      advances,
      settlements,
      { start: monthStart, end: monthEnd }
    );

    totalPresent += row.presentDays;
    totalHalf += row.halfDays;
    totalAbsent += row.absentDays;
    totalEffective += row.effectiveDays;
    totalOtHours += row.overtimeHours;
    totalGrossWages += pay.grossWages;
    totalOvertimePay += pay.overtimePay;
    totalEarned += pay.totalEarned;
    totalDailyFood += pay.dailyFoodAdvance;
    totalWeeklyFood += pay.weeklyFoodAdvance;
    totalCashAdv += pay.cashAdvance;
    totalCustomAdv += pay.customAdvance;
    totalAdvances += pay.totalAdvances;
    totalSettled += pay.totalSettled;
    totalNetPayable += pay.netPayable;

    const dayCells = Array.from({ length: daysInMonth }, (_, i) => {
      const st = row.dayStatuses[i + 1];
      if (st === 'present') return 'P';
      if (st === 'half_day') return 'HD';
      if (st === 'absent') return 'A';
      return '-';
    });

    const csvRow: Array<string | number> = [
      monthLabel,
      emp.empCode,
      emp.fullName,
      emp.role,
      emp.currentProjectName || 'Unassigned',
      emp.currentTowerName || 'All Towers',
      ...dayCells,
      row.presentDays,
      row.halfDays,
      row.absentDays,
      row.effectiveDays,
      row.overtimeHours,
      ...(hideSalary
        ? []
        : [
            emp.dailyRate,
            emp.overtimeRate,
            pay.grossWages,
            pay.overtimePay,
            pay.totalEarned,
          ]),
      pay.dailyFoodAdvance,
      pay.weeklyFoodAdvance,
      pay.cashAdvance,
      pay.customAdvance,
      pay.totalAdvances,
      ...(hideSalary ? [] : [pay.totalSettled, pay.netPayable]),
    ];

    lines.push(csvRow.map(escapeCsvCell).join(','));
  }

  const totalRow: Array<string | number> = [
    monthLabel,
    'TOTAL',
    `${matrix.rows.length} Employees`,
    '',
    '',
    '',
    ...Array.from({ length: daysInMonth }, () => ''),
    totalPresent,
    totalHalf,
    totalAbsent,
    totalEffective,
    totalOtHours,
    ...(hideSalary ? [] : ['', '', totalGrossWages, totalOvertimePay, totalEarned]),
    totalDailyFood,
    totalWeeklyFood,
    totalCashAdv,
    totalCustomAdv,
    totalAdvances,
    ...(hideSalary ? [] : [totalSettled, totalNetPayable]),
  ];

  lines.push(totalRow.map(escapeCsvCell).join(','));

  return {
    csv: `\uFEFF${lines.join('\n')}`,
    fileName: `AVY_INFRA_Attendance_Payroll_${yearMonth}.csv`,
    rowCount: matrix.rows.length,
    monthLabel,
  };
}

export interface IndividualPaymentDetails {
  summary: EmployeePayrollSummary;
  attendanceEntries: AttendanceRecord[];
  advanceEntries: Array<AdvanceEntry & { categoryLabel: string }>;
  settlementEntries: SettlementEntry[];
  categoryTotals: Array<{ key: string; label: string; amount: number; count: number }>;
  digitalTxnCount: number;
  proofsCount: number;
}

export function computeIndividualEmployeePaymentDetails(params: {
  employee: Employee;
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  settlements: SettlementEntry[];
  dateRange?: { start?: string; end?: string };
}): IndividualPaymentDetails {
  const { employee, attendance, advances, settlements, dateRange } = params;
  const inRange = (dateStr: string) => {
    if (dateRange?.start && dateStr < dateRange.start) return false;
    if (dateRange?.end && dateStr > dateRange.end) return false;
    return true;
  };

  const summary = computeEmployeePayroll(employee, attendance, advances, settlements, dateRange);

  const attendanceEntries = attendance
    .filter((rec) => rec.employeeId === employee.id && inRange(rec.date))
    .sort((a, b) => b.date.localeCompare(a.date));

  const advanceEntries = advances
    .filter((adv) => adv.employeeId === employee.id && inRange(adv.date))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .map((adv) => ({
      ...adv,
      categoryLabel: getAdvanceCategoryLabel(adv),
    }));

  const settlementEntries = settlements
    .filter((stl) => stl.employeeId === employee.id && inRange(stl.settledDate))
    .sort((a, b) => b.settledDate.localeCompare(a.settledDate) || b.createdAt.localeCompare(a.createdAt));

  const catMap = new Map<string, { key: string; label: string; amount: number; count: number }>();
  for (const adv of advanceEntries) {
    const key = adv.advanceType === 'custom' ? `custom:${adv.categoryLabel.toLowerCase()}` : adv.advanceType;
    const prev = catMap.get(key) || { key, label: adv.categoryLabel, amount: 0, count: 0 };
    prev.amount += adv.amount;
    prev.count += 1;
    catMap.set(key, prev);
  }

  const categoryTotals = Array.from(catMap.values()).sort((a, b) => b.amount - a.amount);

  const digitalTxnCount =
    advanceEntries.filter((a) => a.paymentMode !== 'cash' || Boolean(a.transactionId?.trim())).length +
    settlementEntries.filter((s) => s.paymentMode !== 'cash' || Boolean(s.transactionId?.trim())).length;

  const proofsCount =
    advanceEntries.filter((a) => Boolean(a.proofImageDataUrl)).length +
    settlementEntries.filter((s) => Boolean(s.proofImageDataUrl)).length;

  return {
    summary,
    attendanceEntries,
    advanceEntries,
    settlementEntries,
    categoryTotals,
    digitalTxnCount,
    proofsCount,
  };
}

export interface MonthlyEmployeeAttendanceRow {
  employee: Employee;
  dayStatuses: Record<number, AttendanceStatus | undefined>;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  effectiveDays: number;
  overtimeHours: number;
  totalWagesEarned: number;
}

export interface MonthlyAttendanceMatrix {
  yearMonth: string;
  monthLabel: string;
  daysInMonth: number;
  rows: MonthlyEmployeeAttendanceRow[];
}

export function getDaysInYearMonth(yearMonth: string): number {
  const [yStr, mStr] = yearMonth.split('-');
  const y = Number(yStr) || new Date().getFullYear();
  const m = Number(mStr) || 1;
  return new Date(y, m, 0).getDate();
}

export function formatYearMonthLabel(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return yearMonth;
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function computeMonthlyAttendanceMatrix(
  employees: Employee[],
  attendanceRecords: AttendanceRecord[],
  yearMonth: string,
  projectIdFilter?: string
): MonthlyAttendanceMatrix {
  const daysInMonth = getDaysInYearMonth(yearMonth);
  const monthLabel = formatYearMonthLabel(yearMonth);

  const monthRecords = attendanceRecords.filter((rec) => {
    if (!rec.date.startsWith(yearMonth)) return false;
    if (projectIdFilter && projectIdFilter !== 'all' && rec.projectId !== projectIdFilter) {
      return false;
    }
    return true;
  });

  const rows: MonthlyEmployeeAttendanceRow[] = employees.map((emp) => {
    const dayStatuses: Record<number, AttendanceStatus | undefined> = {};
    let presentDays = 0;
    let halfDays = 0;
    let absentDays = 0;
    let overtimeHours = 0;
    let totalWagesEarned = 0;

    for (const rec of monthRecords) {
      if (rec.employeeId !== emp.id) continue;
      const dayNum = parseInt(rec.date.slice(8, 10), 10);
      if (dayNum >= 1 && dayNum <= daysInMonth) {
        dayStatuses[dayNum] = rec.status;
      }
      if (rec.status === 'present') presentDays += 1;
      else if (rec.status === 'half_day') halfDays += 1;
      else absentDays += 1;
      overtimeHours += rec.overtimeHours || 0;
      totalWagesEarned += (rec.dailyWageEarned || 0) + (rec.overtimePayEarned || 0);
    }

    return {
      employee: emp,
      dayStatuses,
      presentDays,
      halfDays,
      absentDays,
      effectiveDays: presentDays + halfDays * 0.5,
      overtimeHours,
      totalWagesEarned,
    };
  });

  return {
    yearMonth,
    monthLabel,
    daysInMonth,
    rows,
  };
}

export function formatINR(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(Math.round(amount));
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

/**
 * Sanitizes phone numbers for WhatsApp deep links (defaults 10-digit Indian numbers to +91).
 */
export function sanitizeWhatsappPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

export function buildWhatsappUrl(phone: string, message: string): string {
  const cleanPhone = sanitizeWhatsappPhone(phone);
  const encoded = encodeURIComponent(message);
  return cleanPhone ? `https://wa.me/${cleanPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function buildMailtoUrl(email: string, subject: string, body: string): string {
  const cleanEmail = email.trim();
  const params = new URLSearchParams({
    subject: subject || 'AVY INFRA Operations Report',
    body,
  });
  return `mailto:${encodeURIComponent(cleanEmail)}?${params.toString().replace(/\+/g, '%20')}`;
}

export function formatAdvanceWhatsappMessage(
  advance: Pick<
    AdvanceEntry,
    | 'empCode'
    | 'employeeName'
    | 'advanceType'
    | 'customCategory'
    | 'amount'
    | 'date'
    | 'paymentMode'
    | 'paymentApp'
    | 'transactionId'
    | 'upiId'
    | 'notes'
  >,
  updatedNetBalance: number,
  companyName = 'AVY INFRA',
  options?: { hideNetBalance?: boolean }
): string {
  const modeLabel = advance.paymentApp?.trim()
    ? `${advance.paymentMode.toUpperCase()} · ${advance.paymentApp.trim()}`
    : advance.paymentMode.toUpperCase();
  const lines = [
    `*${companyName} — Advance Payment Receipt*`,
    `Employee: ${advance.employeeName} (${advance.empCode})`,
    `Date: ${advance.date}`,
    `Type: ${getAdvanceCategoryLabel(advance)}`,
    `Amount Given: ${formatINR(advance.amount)} (${modeLabel})`,
  ];
  if (advance.transactionId?.trim()) {
    lines.push(`Txn ID / UTR: ${advance.transactionId.trim()}`);
  }
  if (advance.upiId?.trim()) {
    lines.push(`UPI / Bank Ref: ${advance.upiId.trim()}`);
  }
  if (!options?.hideNetBalance) {
    lines.push(`Current Net Payable Balance: ${formatINR(updatedNetBalance)}`);
  }
  if (advance.notes?.trim()) {
    lines.push(`Note: ${advance.notes.trim()}`);
  }
  lines.push(`— ${companyName} Site Accounts`);
  return lines.join('\n');
}

export function formatPaymentSummaryWhatsappMessage(
  summary: EmployeePayrollSummary,
  periodLabel: string,
  companyName = 'AVY INFRA'
): string {
  const customTxt =
    summary.customAdvance > 0 ? ` | Custom Adv: ${formatINR(summary.customAdvance)}` : '';
  return [
    `*${companyName} — Payment Statement (${periodLabel})*`,
    `Employee: ${summary.employee.fullName} (${summary.employee.empCode})`,
    `Role: ${summary.employee.role} | Daily Rate: ${formatINR(summary.employee.dailyRate)}`,
    `Days Worked: ${summary.effectiveDaysWorked} days (P:${summary.presentDays} / HD:${summary.halfDays} / A:${summary.absentDays})`,
    `Gross Wages: ${formatINR(summary.grossWages)}`,
    `Overtime (${summary.overtimeHours} hrs): ${formatINR(summary.overtimePay)}`,
    `Total Earned: ${formatINR(summary.totalEarned)}`,
    `Advances (${summary.advanceCount}) — Daily Food: ${formatINR(summary.dailyFoodAdvance)} | Weekly Food: ${formatINR(summary.weeklyFoodAdvance)} | Cash Adv: ${formatINR(summary.cashAdvance)}${customTxt}`,
    `Total Advances Given: ${formatINR(summary.totalAdvances)}`,
    `Already Settled: ${formatINR(summary.totalSettled)}`,
    `Total Cash Paid Out (Adv + Settled): ${formatINR(summary.totalDisbursed)}`,
    `Total Worker Expenses (Wages + Adv): ${formatINR(summary.totalEmployeeExpenses)}`,
    `*Net Payable Balance: ${formatINR(summary.netPayable)}*`,
    `— ${companyName} Accounts`,
  ].join('\n');
}

export function formatAttendanceWhatsappMessage(
  date: string,
  projectName: string,
  records: AttendanceRecord[],
  companyName = 'AVY INFRA'
): string {
  const present = records.filter((r) => r.status === 'present').length;
  const halfDay = records.filter((r) => r.status === 'half_day').length;
  const absent = records.filter((r) => r.status === 'absent').length;

  const lines = [
    `*${companyName} — Daily Attendance Report*`,
    `Date: ${date} | Site: ${projectName || 'All Sites'}`,
    `Summary: Present ${present} | Half-Day ${halfDay} | Absent ${absent}`,
    `---`,
  ];

  for (const r of records) {
    const tag = r.status === 'present' ? 'P' : r.status === 'half_day' ? 'HD' : 'A';
    const ot = r.overtimeHours > 0 ? ` +${r.overtimeHours}h OT` : '';
    lines.push(`${r.empCode} ${r.employeeName} (${r.employeeRole}): ${tag}${ot}`);
  }

  lines.push(`— Sent via ${companyName} Operations`);
  return lines.join('\n');
}

export function formatMonthlyAttendanceWhatsappMessage(
  matrix: MonthlyAttendanceMatrix,
  siteLabel: string,
  companyName = 'AVY INFRA',
  singleEmployeeId?: string,
  options?: { hideWages?: boolean }
): string {
  const targetRows = singleEmployeeId
    ? matrix.rows.filter((r) => r.employee.id === singleEmployeeId)
    : matrix.rows;

  const lines = [
    `*${companyName} — Monthly Attendance Report (${matrix.monthLabel})*`,
    `Site: ${siteLabel || 'All Sites'}`,
    `---`,
  ];

  for (const row of targetRows) {
    const wageSuffix = options?.hideWages ? '' : ` | Earned ${formatINR(row.totalWagesEarned)}`;
    lines.push(
      `${row.employee.empCode} ${row.employee.fullName} (${row.employee.role}): ` +
        `Effective ${row.effectiveDays}d [P:${row.presentDays} HD:${row.halfDays} A:${row.absentDays}]` +
        `${row.overtimeHours > 0 ? ` +${row.overtimeHours}h OT` : ''}${wageSuffix}`
    );
  }

  if (singleEmployeeId && targetRows[0]) {
    const r = targetRows[0];
    const dayBreakdown: string[] = [];
    for (let d = 1; d <= matrix.daysInMonth; d++) {
      const st = r.dayStatuses[d];
      if (st) {
        const tag = st === 'present' ? 'P' : st === 'half_day' ? 'HD' : 'A';
        dayBreakdown.push(`${String(d).padStart(2, '0')}:${tag}`);
      }
    }
    if (dayBreakdown.length > 0) {
      lines.push(`Daily Log: ${dayBreakdown.join(', ')}`);
    }
  }

  lines.push(`— Sent via ${companyName} HR & Site Accounts`);
  return lines.join('\n');
}
