import type {
  AdvanceEntry,
  AttendanceRecord,
  Employee,
  ExpenseCategory,
  FlatUnit,
  Project,
  TileZoneDefinition,
  TileZoneState,
  Tower,
  WorkAssignment,
  SiteExpense,
  ZoneStatus,
} from '../types/avy';
import { formatINR } from './payroll';
import { TILE_ZONES, ZONE_LABEL_MAP, calculateFlatProgress } from './tileZones';

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  food_mess: 'Food & Mess Kitchen Expense',
  daily_expense: 'Daily Site Expense',
  special_expense: 'Special / Specified Expense',
  gas_payment: 'Gas Payment',
  medical: 'Medical',
  travel_advance: 'Travel Advance',
  material: 'Tiles & Stone Material',
  adhesive_grout: 'Adhesive, Epoxy & Grout',
  shifting_transport: 'Material Shifting & Transport',
  tools_equipment: 'Tools, Spacers & Blades',
  contractor_misc: 'Miscellaneous Site Expense',
  custom: 'Custom Expense Category',
};

export function getExpenseCategoryLabel(
  exp: Pick<SiteExpense, 'category' | 'customCategory'>
): string {
  if (exp.category === 'custom' && exp.customCategory?.trim()) {
    return exp.customCategory.trim();
  }
  return EXPENSE_CATEGORY_LABELS[exp.category] || 'Site Expense';
}

export interface DurationBreakdown {
  totalDays: number;
  years: number;
  months: number;
  days: number;
  label: string;
  compactLabel: string;
  isOngoing: boolean;
}

function parseIsoDateLocal(dateStr: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return null;
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * Formats elapsed work duration in years, months, and days between startDate and endDate (or referenceDate).
 */
export function formatDurationBreakdown(
  startDate?: string,
  endDate?: string,
  referenceDate?: string
): DurationBreakdown {
  const start = parseIsoDateLocal(startDate || '');
  const end = parseIsoDateLocal(endDate || '') || parseIsoDateLocal(referenceDate || '') || new Date();
  const isOngoing = !parseIsoDateLocal(endDate || '');

  if (!start) {
    return {
      totalDays: 0,
      years: 0,
      months: 0,
      days: 0,
      label: 'Start date not set',
      compactLabel: '—',
      isOngoing,
    };
  }

  if (end < start) {
    return {
      totalDays: 0,
      years: 0,
      months: 0,
      days: 0,
      label: '0 days (Scheduled)',
      compactLabel: '0d',
      isOngoing,
    };
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const totalDays = Math.round((end.getTime() - start.getTime()) / msPerDay);

  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  let days = end.getDate() - start.getDate();

  if (days < 0) {
    const prevMonthLastDay = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    days += prevMonthLastDay;
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }

  const parts: string[] = [];
  if (years > 0) parts.push(`${years} yr${years > 1 ? 's' : ''}`);
  if (months > 0) parts.push(`${months} mo${months > 1 ? 's' : ''}`);
  if (days > 0 || parts.length === 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);

  const compactParts: string[] = [];
  if (years > 0) compactParts.push(`${years}y`);
  if (months > 0) compactParts.push(`${months}m`);
  compactParts.push(`${days}d`);

  const human = parts.join(' ');
  const label =
    years > 0 || months > 0 ? `${human} (${totalDays} days)` : `${totalDays} day${totalDays !== 1 ? 's' : ''}`;

  return {
    totalDays,
    years,
    months,
    days,
    label,
    compactLabel: compactParts.join(' '),
    isOngoing,
  };
}

/**
 * Returns true when an ISO date (YYYY-MM-DD) falls on a Sunday (primary weekly food advance day).
 */
export function isSundayDate(dateStr: string): boolean {
  const dt = parseIsoDateLocal(dateStr);
  if (!dt) return false;
  return dt.getDay() === 0;
}

/**
 * Returns the 7-day window [weekStart, weekEnd] containing dateStr (Mon-Sun week, where Sunday ends the week).
 */
export function getWeeklyWindowForDate(dateStr: string): { start: string; end: string } {
  const dt = parseIsoDateLocal(dateStr) || new Date();
  const dayOfWeek = dt.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const startDt = new Date(dt);
  startDt.setDate(dt.getDate() + diffToMon);
  const endDt = new Date(startDt);
  endDt.setDate(startDt.getDate() + 6);

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return { start: fmt(startDt), end: fmt(endDt) };
}

export interface ActiveUnfinishedTask {
  assignmentId?: string;
  flatId: string;
  unitNumber: string;
  zoneKey: string;
  zoneLabel: string;
  projectName: string;
  towerName: string;
  assignedDate: string;
  status: 'assigned' | 'prechecking' | 'in_progress' | 'cleaning_in_progress';
  source: 'assignment' | 'flat_zone';
}

/**
 * Checks whether an employee currently has an unfinished tile-laying or cleaning task.
 */
export function findActiveUnfinishedAssignment(
  employeeId: string,
  assignments: WorkAssignment[],
  flats: FlatUnit[],
  projects: Project[] = [],
  towers: Tower[] = []
): ActiveUnfinishedTask | null {
  if (!employeeId) return null;

  const openAssignment = assignments.find(
    (a) =>
      a.employeeId === employeeId &&
      (a.status === 'assigned' ||
        a.status === 'prechecking' ||
        a.status === 'in_progress' ||
        a.status === 'cleaning_in_progress')
  );
  if (openAssignment) {
    return {
      assignmentId: openAssignment.id,
      flatId: openAssignment.flatId,
      unitNumber: openAssignment.unitNumber,
      zoneKey: openAssignment.zoneKey,
      zoneLabel: openAssignment.zoneLabel,
      projectName: openAssignment.projectName,
      towerName: openAssignment.towerName,
      assignedDate: openAssignment.assignedDate,
      status: openAssignment.status as ActiveUnfinishedTask['status'],
      source: 'assignment',
    };
  }

  for (const flat of flats) {
    for (const [zoneKey, zState] of Object.entries(flat.zones || {})) {
      if (
        zState.assignedEmployeeId === employeeId &&
        (zState.status === 'prechecking' ||
          zState.status === 'in_progress' ||
          zState.status === 'cleaning_in_progress')
      ) {
        const proj = projects.find((p) => p.id === flat.projectId);
        const twr = towers.find((t) => t.id === flat.towerId);
        return {
          flatId: flat.id,
          unitNumber: flat.unitNumber,
          zoneKey,
          zoneLabel: zState.label || ZONE_LABEL_MAP[zoneKey] || zoneKey,
          projectName: proj?.name || 'Project',
          towerName: twr?.name || 'Tower',
          assignedDate: zState.updatedDate || '',
          status: zState.status,
          source: 'flat_zone',
        };
      }
    }
  }

  return null;
}

export interface TowerAttendanceEmployeeItem {
  employee: Employee;
  record?: AttendanceRecord;
  status: 'present' | 'half_day' | 'absent' | 'unmarked';
}

export interface TowerAttendanceSummary {
  date: string;
  projectId: string;
  towerId: string;
  totalAllocated: number;
  presentList: TowerAttendanceEmployeeItem[];
  halfDayList: TowerAttendanceEmployeeItem[];
  absentList: TowerAttendanceEmployeeItem[];
  unmarkedList: TowerAttendanceEmployeeItem[];
  presentCount: number;
  halfDayCount: number;
  absentCount: number;
  unmarkedCount: number;
  dailyWageTotal: number;
}

export function computeTowerAttendanceSummary(params: {
  date: string;
  projectId?: string;
  towerId?: string;
  employees: Employee[];
  attendance: AttendanceRecord[];
}): TowerAttendanceSummary {
  const { date, projectId = 'all', towerId = 'all', employees, attendance } = params;
  const activeEmployees = employees.filter((e) => e.status === 'active');

  // Filter employees matching selected project & tower
  const scopedEmployees = activeEmployees.filter((emp) => {
    if (projectId !== 'all' && emp.currentProjectId !== projectId) {
      // Also include if they have an attendance record on this date tagged with projectId
      const hasRecOnProj = attendance.some(
        (a) => a.date === date && a.employeeId === emp.id && a.projectId === projectId
      );
      if (!hasRecOnProj) return false;
    }
    if (towerId !== 'all' && emp.currentTowerId !== towerId) {
      const hasRecOnTwr = attendance.some(
        (a) => a.date === date && a.employeeId === emp.id && a.towerId === towerId
      );
      if (!hasRecOnTwr) return false;
    }
    return true;
  });

  const dateRecords = attendance.filter((a) => a.date === date);

  const presentList: TowerAttendanceEmployeeItem[] = [];
  const halfDayList: TowerAttendanceEmployeeItem[] = [];
  const absentList: TowerAttendanceEmployeeItem[] = [];
  const unmarkedList: TowerAttendanceEmployeeItem[] = [];
  let dailyWageTotal = 0;

  for (const emp of scopedEmployees) {
    const rec = dateRecords.find((r) => r.employeeId === emp.id);
    if (!rec) {
      unmarkedList.push({ employee: emp, status: 'unmarked' });
    } else if (rec.status === 'present') {
      presentList.push({ employee: emp, record: rec, status: 'present' });
      dailyWageTotal += (rec.dailyWageEarned || 0) + (rec.overtimePayEarned || 0);
    } else if (rec.status === 'half_day') {
      halfDayList.push({ employee: emp, record: rec, status: 'half_day' });
      dailyWageTotal += (rec.dailyWageEarned || 0) + (rec.overtimePayEarned || 0);
    } else {
      absentList.push({ employee: emp, record: rec, status: 'absent' });
    }
  }

  return {
    date,
    projectId,
    towerId,
    totalAllocated: scopedEmployees.length,
    presentList,
    halfDayList,
    absentList,
    unmarkedList,
    presentCount: presentList.length,
    halfDayCount: halfDayList.length,
    absentCount: absentList.length,
    unmarkedCount: unmarkedList.length,
    dailyWageTotal,
  };
}

export interface FoodExpenseBreakdown {
  dailyFoodTotal: number;
  weeklyFoodTotal: number;
  monthlyFoodTotal: number;
  sundayWeeklyFoodTotal: number;
  cashAdvanceTotal: number;
  grandAdvanceTotal: number;
  weeklyRange: { start: string; end: string };
  monthPrefix: string;
}

export function computeTowerFoodExpenseBreakdown(params: {
  referenceDate: string;
  advances: AdvanceEntry[];
  employees: Employee[];
  projectId?: string;
  towerId?: string;
}): FoodExpenseBreakdown {
  const { referenceDate, advances, employees, projectId = 'all', towerId = 'all' } = params;
  const weeklyRange = getWeeklyWindowForDate(referenceDate);
  const monthPrefix = referenceDate.slice(0, 7);

  let dailyFoodTotal = 0;
  let weeklyFoodTotal = 0;
  let monthlyFoodTotal = 0;
  let sundayWeeklyFoodTotal = 0;
  let cashAdvanceTotal = 0;
  let grandAdvanceTotal = 0;

  for (const adv of advances) {
    const emp = employees.find((e) => e.id === adv.employeeId);
    const advProjId = adv.projectId || emp?.currentProjectId || '';
    const advTwrId = adv.towerId || emp?.currentTowerId || '';

    if (projectId !== 'all' && advProjId !== projectId) continue;
    if (towerId !== 'all' && advTwrId !== towerId) continue;

    grandAdvanceTotal += adv.amount;
    if (adv.advanceType === 'cash_advance' || adv.advanceType === 'custom') {
      cashAdvanceTotal += adv.amount;
      continue;
    }

    // Food expense (daily_food or weekly_food)
    if (adv.date === referenceDate) {
      dailyFoodTotal += adv.amount;
    }
    if (adv.date >= weeklyRange.start && adv.date <= weeklyRange.end) {
      weeklyFoodTotal += adv.amount;
    }
    if (adv.date.startsWith(monthPrefix)) {
      monthlyFoodTotal += adv.amount;
    }
    if (adv.advanceType === 'weekly_food' && (adv.isSundayRun || isSundayDate(adv.date))) {
      sundayWeeklyFoodTotal += adv.amount;
    }
  }

  return {
    dailyFoodTotal,
    weeklyFoodTotal,
    monthlyFoodTotal,
    sundayWeeklyFoodTotal,
    cashAdvanceTotal,
    grandAdvanceTotal,
    weeklyRange,
    monthPrefix,
  };
}

export interface TowerCostRow {
  tower: Tower;
  projectName: string;
  wagesCost: number;
  dailyFoodCost: number;
  weeklyFoodCost: number;
  cashAdvanceCost: number;
  siteExpensesCost: number;
  totalExpenseCost: number;
  crewCount: number;
}

export interface ProjectCostSummary {
  project: Project;
  wagesCost: number;
  foodAdvanceCost: number;
  cashAdvanceCost: number;
  siteExpensesCost: number;
  totalCost: number;
  towerCount: number;
  towers: TowerCostRow[];
}

export function computeProjectAndTowerExpenses(params: {
  projects: Project[];
  towers: Tower[];
  employees: Employee[];
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  expenses: SiteExpense[];
  dateStart?: string;
  dateEnd?: string;
}): { projectSummaries: ProjectCostSummary[]; towerRows: TowerCostRow[]; grandTotal: number } {
  const { projects, towers, employees, attendance, advances, expenses, dateStart, dateEnd } = params;

  const inRange = (d: string) => {
    if (dateStart && d < dateStart) return false;
    if (dateEnd && d > dateEnd) return false;
    return true;
  };

  const empMap = new Map(employees.map((e) => [e.id, e]));

  const towerRows: TowerCostRow[] = towers.map((tower) => {
    const project = projects.find((p) => p.id === tower.projectId);
    let wagesCost = 0;
    let dailyFoodCost = 0;
    let weeklyFoodCost = 0;
    let cashAdvanceCost = 0;
    let siteExpensesCost = 0;

    for (const att of attendance) {
      if (!inRange(att.date)) continue;
      const emp = empMap.get(att.employeeId);
      const tId = att.towerId || emp?.currentTowerId || '';
      if (tId === tower.id) {
        wagesCost += (att.dailyWageEarned || 0) + (att.overtimePayEarned || 0);
      }
    }

    for (const adv of advances) {
      if (!inRange(adv.date)) continue;
      const emp = empMap.get(adv.employeeId);
      const tId = adv.towerId || emp?.currentTowerId || '';
      if (tId === tower.id) {
        if (adv.advanceType === 'daily_food') dailyFoodCost += adv.amount;
        else if (adv.advanceType === 'weekly_food') weeklyFoodCost += adv.amount;
        else cashAdvanceCost += adv.amount;
      }
    }

    for (const exp of expenses) {
      if (!inRange(exp.date)) continue;
      if (exp.towerId === tower.id) {
        siteExpensesCost += exp.amount;
      }
    }

    const crewCount = employees.filter((e) => e.status === 'active' && e.currentTowerId === tower.id).length;

    return {
      tower,
      projectName: project?.name || 'Project',
      wagesCost,
      dailyFoodCost,
      weeklyFoodCost,
      cashAdvanceCost,
      siteExpensesCost,
      totalExpenseCost: wagesCost + dailyFoodCost + weeklyFoodCost + cashAdvanceCost + siteExpensesCost,
      crewCount,
    };
  });

  const projectSummaries: ProjectCostSummary[] = projects.map((project) => {
    const projTowers = towerRows.filter((tr) => tr.tower.projectId === project.id);
    // Include project-wide attendance/advances/expenses that don't specify a towerId or match tower
    let wagesCost = 0;
    let foodAdvanceCost = 0;
    let cashAdvanceCost = 0;
    let siteExpensesCost = 0;

    for (const att of attendance) {
      if (!inRange(att.date)) continue;
      const emp = empMap.get(att.employeeId);
      const pId = att.projectId || emp?.currentProjectId || '';
      if (pId === project.id) {
        wagesCost += (att.dailyWageEarned || 0) + (att.overtimePayEarned || 0);
      }
    }

    for (const adv of advances) {
      if (!inRange(adv.date)) continue;
      const emp = empMap.get(adv.employeeId);
      const pId = adv.projectId || emp?.currentProjectId || '';
      if (pId === project.id) {
        if (adv.advanceType === 'cash_advance' || adv.advanceType === 'custom') {
          cashAdvanceCost += adv.amount;
        } else {
          foodAdvanceCost += adv.amount;
        }
      }
    }

    for (const exp of expenses) {
      if (!inRange(exp.date)) continue;
      if (exp.projectId === project.id) {
        siteExpensesCost += exp.amount;
      }
    }

    return {
      project,
      wagesCost,
      foodAdvanceCost,
      cashAdvanceCost,
      siteExpensesCost,
      totalCost: wagesCost + foodAdvanceCost + cashAdvanceCost + siteExpensesCost,
      towerCount: projTowers.length,
      towers: projTowers,
    };
  });

  const grandTotal = projectSummaries.reduce((s, p) => s + p.totalCost, 0);

  return { projectSummaries, towerRows, grandTotal };
}

export function formatTowerAttendanceWhatsappMessage(params: {
  companyName: string;
  projectName: string;
  towerName: string;
  summary: TowerAttendanceSummary;
  recipientLabel?: string;
}): string {
  const { companyName, projectName, towerName, summary, recipientLabel } = params;
  const lines = [
    `*${companyName} — Tower Daily Attendance Status*`,
    `Project: ${projectName} | Tower: ${towerName}`,
    `Date: ${summary.date}${recipientLabel ? ` | Attn: ${recipientLabel}` : ''}`,
    `Present: ${summary.presentCount} | Half-Day: ${summary.halfDayCount} | Absent: ${summary.absentCount} | Unmarked: ${summary.unmarkedCount}`,
    `Today's Wage Cost: ${formatINR(summary.dailyWageTotal)}`,
    `---`,
  ];

  if (summary.presentList.length > 0) {
    lines.push(`*PRESENT (${summary.presentList.length}):*`);
    for (const item of summary.presentList) {
      const ot = item.record?.overtimeHours ? ` (+${item.record.overtimeHours}h OT)` : '';
      lines.push(`• ${item.employee.empCode} ${item.employee.fullName} (${item.employee.role})${ot}`);
    }
  }
  if (summary.halfDayList.length > 0) {
    lines.push(`*HALF-DAY (${summary.halfDayList.length}):*`);
    for (const item of summary.halfDayList) {
      lines.push(`• ${item.employee.empCode} ${item.employee.fullName} (${item.employee.role})`);
    }
  }
  if (summary.absentList.length > 0) {
    lines.push(`*ABSENT (${summary.absentList.length}):*`);
    for (const item of summary.absentList) {
      lines.push(`• ${item.employee.empCode} ${item.employee.fullName} (${item.employee.role})`);
    }
  }
  if (summary.unmarkedList.length > 0) {
    lines.push(`*UNMARKED (${summary.unmarkedList.length}):*`);
    for (const item of summary.unmarkedList) {
      lines.push(`• ${item.employee.empCode} ${item.employee.fullName} (${item.employee.role})`);
    }
  }

  lines.push(`— Sent via ${companyName} Operations`);
  return lines.join('\n');
}

export function formatTowerProjectStatusWhatsappMessage(params: {
  companyName: string;
  project: Project;
  tower?: Tower;
  flatsCount: number;
  completedZones: number;
  totalZones: number;
  inProgressZones: number;
  attendanceSummary: TowerAttendanceSummary;
  foodDaily: number;
  foodMonthly: number;
  totalTowerExpense: number;
  durationLabel: string;
}): string {
  const {
    companyName,
    project,
    tower,
    flatsCount,
    completedZones,
    totalZones,
    inProgressZones,
    attendanceSummary,
    foodDaily,
    foodMonthly,
    totalTowerExpense,
    durationLabel,
  } = params;
  const pct = totalZones > 0 ? Math.round((completedZones / totalZones) * 100) : 0;

  return [
    `*${companyName} — ${tower ? `${tower.name} Site` : 'Project'} Status Report*`,
    `Project: ${project.name}${tower ? ` | Tower: ${tower.name}` : ''}`,
    `Timeline Duration: ${durationLabel}`,
    `Tile Work Progress: ${completedZones}/${totalZones} areas completed (${pct}%) · ${inProgressZones} running across ${flatsCount} units`,
    `Today's Crew (${attendanceSummary.date}): Present ${attendanceSummary.presentCount} | Half-Day ${attendanceSummary.halfDayCount} | Absent ${attendanceSummary.absentCount}`,
    `Food Advance: Today ${formatINR(foodDaily)} | This Month ${formatINR(foodMonthly)}`,
    `Total Tower/Site Expense: ${formatINR(totalTowerExpense)}`,
    `— ${companyName} Operations`,
  ].join('\n');
}

export interface EmployeeCardDayCell {
  day: number;
  date: string;
  weekdayShort: string;
  isSunday: boolean;
  record?: AttendanceRecord;
  status?: 'present' | 'half_day' | 'absent';
  overtimeHours: number;
  earned: number;
  projectName: string;
  towerName: string;
}

export interface SingleEmployeeAttendanceCard {
  employee: Employee;
  yearMonth: string;
  monthLabel: string;
  daysInMonth: number;
  mondayOffset: number;
  days: EmployeeCardDayCell[];
  presentDays: number;
  halfDays: number;
  absentDays: number;
  unmarkedDays: number;
  effectiveDays: number;
  overtimeHours: number;
  grossWagesEarned: number;
  overtimePayEarned: number;
  totalWagesEarned: number;
  monthAdvancesTotal: number;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Computes a complete monthly Attendance Card (day 1..daysInMonth + calendar offset + stats)
 * for a single employee.
 */
export function computeSingleEmployeeAttendanceCard(params: {
  employee: Employee;
  yearMonth: string;
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
}): SingleEmployeeAttendanceCard {
  const { employee, yearMonth, attendance, advances } = params;
  const [yStr, mStr] = yearMonth.split('-');
  const year = Number(yStr) || new Date().getFullYear();
  const month = Number(mStr) || 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDate = new Date(year, month - 1, 1);
  const mondayOffset = (firstDate.getDay() + 6) % 7; // Mon=0 ... Sun=6
  const monthLabel = firstDate.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const recByDate = new Map<string, AttendanceRecord>();
  for (const rec of attendance) {
    if (rec.employeeId === employee.id && rec.date.startsWith(yearMonth)) {
      recByDate.set(rec.date, rec);
    }
  }

  let presentDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  let unmarkedDays = 0;
  let overtimeHours = 0;
  let grossWagesEarned = 0;
  let overtimePayEarned = 0;

  const days: EmployeeCardDayCell[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month - 1, d);
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = dt.getDay();
    const rec = recByDate.get(dateStr);

    if (rec) {
      if (rec.status === 'present') presentDays += 1;
      else if (rec.status === 'half_day') halfDays += 1;
      else absentDays += 1;

      overtimeHours += rec.overtimeHours || 0;
      grossWagesEarned += rec.dailyWageEarned || 0;
      overtimePayEarned += rec.overtimePayEarned || 0;
    } else {
      unmarkedDays += 1;
    }

    days.push({
      day: d,
      date: dateStr,
      weekdayShort: WEEKDAY_SHORT[dow],
      isSunday: dow === 0,
      record: rec,
      status: rec?.status,
      overtimeHours: rec?.overtimeHours || 0,
      earned: (rec?.dailyWageEarned || 0) + (rec?.overtimePayEarned || 0),
      projectName: rec?.projectName || '',
      towerName: rec?.towerName || '',
    });
  }

  const monthAdvancesTotal = advances
    .filter((a) => a.employeeId === employee.id && a.date.startsWith(yearMonth))
    .reduce((sum, a) => sum + a.amount, 0);

  return {
    employee,
    yearMonth,
    monthLabel,
    daysInMonth,
    mondayOffset,
    days,
    presentDays,
    halfDays,
    absentDays,
    unmarkedDays,
    effectiveDays: presentDays + halfDays * 0.5,
    overtimeHours,
    grossWagesEarned,
    overtimePayEarned,
    totalWagesEarned: grossWagesEarned + overtimePayEarned,
    monthAdvancesTotal,
  };
}

export interface TowerDeploymentSummary {
  tower: Tower;
  projectName: string;
  activeCrewCount: number;
}

export function getTowerDeploymentCounts(params: {
  employees: Employee[];
  towers: Tower[];
  projects: Project[];
}): { byTower: TowerDeploymentSummary[]; unassignedCount: number } {
  const { employees, towers, projects } = params;
  const active = employees.filter((e) => e.status === 'active');
  const byTower: TowerDeploymentSummary[] = towers.map((tower) => {
    const project = projects.find((p) => p.id === tower.projectId);
    const activeCrewCount = active.filter((e) => e.currentTowerId === tower.id).length;
    return {
      tower,
      projectName: project?.name || 'Project',
      activeCrewCount,
    };
  });
  const unassignedCount = active.filter((e) => !e.currentTowerId).length;
  return { byTower, unassignedCount };
}

export type WorkStatusFilter =
  | 'all'
  | 'pending'
  | 'prechecking'
  | 'in_progress'
  | 'cleaning_in_progress'
  | 'cleaning_done'
  | 'completed';
export type WorkBreakdownLevel = 'tower' | 'floor' | 'flat';
export type WorkAreaFilter =
  | 'all'
  | 'balcony'
  | 'main_flooring'
  | 'skirting'
  | 'electrical'
  | 'lift_lobby'
  | 'corridor'
  | 'dado'
  | 'custom';

export const WORK_AREA_FILTER_OPTIONS: Array<{ id: WorkAreaFilter; label: string }> = [
  { id: 'all', label: 'All Tile Areas' },
  { id: 'balcony', label: 'Balcony Areas' },
  { id: 'main_flooring', label: 'Main Flooring' },
  { id: 'skirting', label: 'Skirting' },
  { id: 'electrical', label: 'Electrical Room (1 / 2)' },
  { id: 'lift_lobby', label: 'Lift Lobby' },
  { id: 'corridor', label: 'Corridor, Staircase & Common' },
  { id: 'dado', label: 'Dado (Bath / Kitchen)' },
  { id: 'custom', label: 'Custom Added Areas' },
];

const DEFAULT_ZONE_KEYS_SET = new Set(TILE_ZONES.map((z) => z.key));
const DEFAULT_ZONE_CATEGORY_MAP = new Map(TILE_ZONES.map((z) => [z.key, z.category]));

export function matchesWorkAreaFilter(
  zoneKey: string,
  zState: TileZoneState,
  areaFilter: WorkAreaFilter = 'all',
  areaSearch = ''
): boolean {
  const label = (zState.label || ZONE_LABEL_MAP[zoneKey] || zoneKey).toLowerCase();
  const keyLow = zoneKey.toLowerCase();
  const category = zState.category || DEFAULT_ZONE_CATEGORY_MAP.get(zoneKey) || 'Flooring';

  if (areaSearch.trim()) {
    const q = areaSearch.trim().toLowerCase();
    if (!label.includes(q) && !keyLow.includes(q) && !category.toLowerCase().includes(q)) {
      return false;
    }
  }

  if (areaFilter === 'all') return true;
  if (areaFilter === 'balcony') {
    return keyLow.includes('balcony') || label.includes('balcony');
  }
  if (areaFilter === 'skirting') {
    return category === 'Skirting' || keyLow.includes('skirting') || label.includes('skirting');
  }
  if (areaFilter === 'electrical') {
    return keyLow.includes('electrical') || label.includes('electrical');
  }
  if (areaFilter === 'lift_lobby') {
    return (
      keyLow.includes('lift') ||
      label.includes('lift lobby') ||
      label.includes('lift')
    );
  }
  if (areaFilter === 'corridor') {
    return (
      keyLow.includes('corridor') ||
      keyLow.includes('lobby') ||
      keyLow.includes('staircase') ||
      keyLow.includes('meter') ||
      keyLow.includes('shaft') ||
      keyLow.includes('refuge') ||
      label.includes('corridor') ||
      label.includes('lobby') ||
      label.includes('staircase') ||
      label.includes('meter') ||
      label.includes('shaft') ||
      label.includes('refuge') ||
      category === 'Common'
    );
  }
  if (areaFilter === 'dado') {
    return category === 'Wall / Wet' || keyLow.includes('dado') || label.includes('dado');
  }
  if (areaFilter === 'main_flooring') {
    if (
      keyLow.includes('balcony') ||
      label.includes('balcony') ||
      category === 'Skirting' ||
      keyLow.includes('skirting') ||
      label.includes('skirting') ||
      keyLow.includes('electrical') ||
      label.includes('electrical') ||
      category === 'Common' ||
      keyLow.includes('corridor') ||
      label.includes('corridor') ||
      keyLow.includes('lobby') ||
      label.includes('lobby') ||
      keyLow.includes('lift') ||
      label.includes('lift') ||
      keyLow.includes('staircase') ||
      label.includes('staircase') ||
      keyLow.includes('meter') ||
      label.includes('meter') ||
      keyLow.includes('refuge') ||
      label.includes('refuge') ||
      keyLow.includes('duct') ||
      label.includes('duct')
    ) {
      return false;
    }
    return (
      keyLow === 'main_flooring_hall' ||
      keyLow === 'hall_flooring' ||
      keyLow.includes('flooring') ||
      category === 'Flooring'
    );
  }
  if (areaFilter === 'custom') {
    return !DEFAULT_ZONE_KEYS_SET.has(zoneKey);
  }
  return true;
}

export interface FlatMatchingZoneDetail {
  zoneKey: string;
  label: string;
  category: string;
  sqft: number;
  status: ZoneStatus;
  assignedEmployeeName?: string;
}

export interface TowerWorkStatusRow {
  tower: Tower;
  projectName: string;
  flatCount: number;
  totalZones: number;
  pendingZones: number;
  precheckingZones: number;
  inProgressZones: number;
  cleaningInProgressZones: number;
  cleaningDoneZones: number;
  completedZones: number;
  pendingFlats: number;
  inProgressFlats: number;
  completedFlats: number;
  progressPct: number;
  matchingZonesCount: number;
  matchingSqft: number;
}

export interface FloorWorkStatusRow {
  key: string;
  projectId: string;
  projectName: string;
  towerId: string;
  towerName: string;
  floorNumber: number;
  floorLabel: string;
  flatCount: number;
  totalZones: number;
  pendingZones: number;
  precheckingZones: number;
  inProgressZones: number;
  cleaningInProgressZones: number;
  cleaningDoneZones: number;
  completedZones: number;
  progressPct: number;
  matchingZonesCount: number;
  matchingSqft: number;
  flats: FlatUnit[];
}

export interface FlatWorkStatusRow {
  flat: FlatUnit;
  projectName: string;
  towerName: string;
  floorLabel: string;
  totalZones: number;
  pendingZones: number;
  precheckingZones: number;
  inProgressZones: number;
  cleaningInProgressZones: number;
  cleaningDoneZones: number;
  completedZones: number;
  overallStatus: 'pending' | 'in_progress' | 'completed';
  progressPct: number;
  matchingZonesCount: number;
  matchingSqft: number;
  matchingZoneLabels: string[];
  matchingZoneDetails: FlatMatchingZoneDetail[];
}

export interface ProjectWorkStatusOverview {
  totalFlats: number;
  totalZones: number;
  pendingZones: number;
  precheckingZones: number;
  inProgressZones: number;
  cleaningInProgressZones: number;
  cleaningDoneZones: number;
  completedZones: number;
  pendingFlats: number;
  inProgressFlats: number;
  completedFlats: number;
  overallProgressPct: number;
  matchingZonesTotal: number;
  matchingSqftTotal: number;
  towerRows: TowerWorkStatusRow[];
  floorRows: FloorWorkStatusRow[];
  flatRows: FlatWorkStatusRow[];
}

function doesZoneMatchStatusFilter(
  status: ZoneStatus,
  statusFilter: WorkStatusFilter
): boolean {
  if (statusFilter === 'all') return true;
  if (statusFilter === 'pending') return status === 'not_started';
  if (statusFilter === 'prechecking') return status === 'prechecking';
  if (statusFilter === 'in_progress') {
    return status === 'in_progress' || status === 'cleaning_in_progress';
  }
  if (statusFilter === 'cleaning_in_progress') return status === 'cleaning_in_progress';
  if (statusFilter === 'cleaning_done') return status === 'cleaning_done';
  if (statusFilter === 'completed') {
    return status === 'completed' || status === 'qc_approved' || status === 'cleaning_done';
  }
  return true;
}

function summarizeFlatZoneStatuses(
  flat: FlatUnit,
  areaFilter: WorkAreaFilter = 'all',
  areaSearch = '',
  statusFilter: WorkStatusFilter = 'all'
): {
  totalZones: number;
  pendingZones: number;
  precheckingZones: number;
  inProgressZones: number;
  cleaningInProgressZones: number;
  cleaningDoneZones: number;
  completedZones: number;
  pendingLabels: string[];
  precheckingLabels: string[];
  inProgressLabels: string[];
  cleaningInProgressLabels: string[];
  cleaningDoneLabels: string[];
  completedLabels: string[];
  matchingZoneDetails: FlatMatchingZoneDetail[];
  matchingSqft: number;
  overallStatus: 'pending' | 'in_progress' | 'completed';
} {
  let totalZones = 0;
  let pendingZones = 0;
  let precheckingZones = 0;
  let inProgressZones = 0;
  let cleaningInProgressZones = 0;
  let cleaningDoneZones = 0;
  let completedZones = 0;
  const pendingLabels: string[] = [];
  const precheckingLabels: string[] = [];
  const inProgressLabels: string[] = [];
  const cleaningInProgressLabels: string[] = [];
  const cleaningDoneLabels: string[] = [];
  const completedLabels: string[] = [];
  const matchingZoneDetails: FlatMatchingZoneDetail[] = [];
  let matchingSqft = 0;

  for (const [zoneKey, zState] of Object.entries(flat.zones || {})) {
    if (!zState) continue;
    if (!matchesWorkAreaFilter(zoneKey, zState, areaFilter, areaSearch)) continue;
    totalZones += 1;
    const label = zState.label || ZONE_LABEL_MAP[zoneKey] || zoneKey;
    const category = zState.category || DEFAULT_ZONE_CATEGORY_MAP.get(zoneKey) || 'Flooring';
    const sqft = Number(zState.sqft) || 0;

    if (doesZoneMatchStatusFilter(zState.status, statusFilter)) {
      matchingSqft += sqft;
      matchingZoneDetails.push({
        zoneKey,
        label,
        category,
        sqft,
        status: zState.status,
        assignedEmployeeName: zState.assignedEmployeeName || undefined,
      });
    }

    if (zState.status === 'completed' || zState.status === 'qc_approved') {
      completedZones += 1;
      completedLabels.push(label);
    } else if (zState.status === 'cleaning_done') {
      cleaningDoneZones += 1;
      completedZones += 1;
      cleaningDoneLabels.push(label);
      completedLabels.push(label);
    } else if (zState.status === 'cleaning_in_progress') {
      cleaningInProgressZones += 1;
      inProgressZones += 1;
      cleaningInProgressLabels.push(label);
      inProgressLabels.push(label);
    } else if (zState.status === 'in_progress') {
      inProgressZones += 1;
      inProgressLabels.push(label);
    } else if (zState.status === 'prechecking') {
      precheckingZones += 1;
      precheckingLabels.push(label);
    } else {
      pendingZones += 1;
      pendingLabels.push(label);
    }
  }

  let overallStatus: 'pending' | 'in_progress' | 'completed' = 'pending';
  if (totalZones > 0 && completedZones === totalZones) {
    overallStatus = 'completed';
  } else if (inProgressZones > 0 || completedZones > 0 || precheckingZones > 0) {
    overallStatus = 'in_progress';
  }

  return {
    totalZones,
    pendingZones,
    precheckingZones,
    inProgressZones,
    cleaningInProgressZones,
    cleaningDoneZones,
    completedZones,
    pendingLabels,
    precheckingLabels,
    inProgressLabels,
    cleaningInProgressLabels,
    cleaningDoneLabels,
    completedLabels,
    matchingZoneDetails,
    matchingSqft,
    overallStatus,
  };
}

function getMatchingCountForFilter(
  counts: {
    totalZones: number;
    pendingZones: number;
    precheckingZones: number;
    inProgressZones: number;
    cleaningInProgressZones: number;
    cleaningDoneZones: number;
    completedZones: number;
  },
  statusFilter: WorkStatusFilter
): number {
  if (statusFilter === 'pending') return counts.pendingZones;
  if (statusFilter === 'prechecking') return counts.precheckingZones;
  if (statusFilter === 'in_progress') return counts.inProgressZones;
  if (statusFilter === 'cleaning_in_progress') return counts.cleaningInProgressZones;
  if (statusFilter === 'cleaning_done') return counts.cleaningDoneZones;
  if (statusFilter === 'completed') return counts.completedZones;
  return counts.totalZones;
}

export function computeProjectWorkStatusOverview(params: {
  projects: Project[];
  towers: Tower[];
  flats: FlatUnit[];
  projectId?: string;
  towerId?: string;
  floorNumber?: number | 'all';
  floorNumbers?: number[] | 'all';
  areaFilter?: WorkAreaFilter;
  areaSearch?: string;
  statusFilter?: WorkStatusFilter;
}): ProjectWorkStatusOverview {
  const {
    projects,
    towers,
    flats,
    projectId = 'all',
    towerId = 'all',
    floorNumber = 'all',
    floorNumbers = 'all',
    areaFilter = 'all',
    areaSearch = '',
    statusFilter = 'all',
  } = params;

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const towerMap = new Map(towers.map((t) => [t.id, t]));
  const hasMultiFloors = Array.isArray(floorNumbers) && floorNumbers.length > 0;
  const floorSet = hasMultiFloors ? new Set(floorNumbers) : null;

  const scopedFlats = flats.filter((f) => {
    if (projectId !== 'all' && f.projectId !== projectId) return false;
    if (towerId !== 'all' && f.towerId !== towerId) return false;
    if (floorSet) {
      if (!floorSet.has(f.floorNumber)) return false;
    } else if (floorNumber !== 'all' && f.floorNumber !== floorNumber) {
      return false;
    }
    return true;
  });

  let totalZones = 0;
  let pendingZones = 0;
  let precheckingZones = 0;
  let inProgressZones = 0;
  let cleaningInProgressZones = 0;
  let cleaningDoneZones = 0;
  let completedZones = 0;
  let pendingFlats = 0;
  let inProgressFlats = 0;
  let completedFlats = 0;
  let matchingZonesTotal = 0;
  let matchingSqftTotal = 0;

  const allFlatRows: FlatWorkStatusRow[] = [];

  for (const flat of scopedFlats) {
    const stats = summarizeFlatZoneStatuses(flat, areaFilter, areaSearch, statusFilter);
    totalZones += stats.totalZones;
    pendingZones += stats.pendingZones;
    precheckingZones += stats.precheckingZones;
    inProgressZones += stats.inProgressZones;
    cleaningInProgressZones += stats.cleaningInProgressZones;
    cleaningDoneZones += stats.cleaningDoneZones;
    completedZones += stats.completedZones;

    if (stats.totalZones > 0) {
      if (stats.overallStatus === 'completed') completedFlats += 1;
      else if (stats.overallStatus === 'in_progress') inProgressFlats += 1;
      else pendingFlats += 1;
    }

    const matchingZonesCount = getMatchingCountForFilter(stats, statusFilter);
    if (matchingZonesCount > 0) {
      matchingZonesTotal += matchingZonesCount;
      matchingSqftTotal += stats.matchingSqft;
    }

    const matchingZoneLabels =
      statusFilter === 'pending'
        ? stats.pendingLabels
        : statusFilter === 'prechecking'
          ? stats.precheckingLabels
          : statusFilter === 'in_progress'
            ? stats.inProgressLabels
            : statusFilter === 'cleaning_in_progress'
              ? stats.cleaningInProgressLabels
              : statusFilter === 'cleaning_done'
                ? stats.cleaningDoneLabels
                : statusFilter === 'completed'
                  ? stats.completedLabels
                  : [
                      ...stats.inProgressLabels,
                      ...stats.precheckingLabels,
                      ...stats.pendingLabels,
                      ...stats.completedLabels,
                    ];

    const proj = projectMap.get(flat.projectId);
    const twr = towerMap.get(flat.towerId);
    const progressPct =
      stats.totalZones > 0 ? Math.round((stats.completedZones / stats.totalZones) * 100) : 0;

    allFlatRows.push({
      flat,
      projectName: proj?.name || 'Project',
      towerName: twr?.name || 'Tower',
      floorLabel: flat.floorLabel || `Floor ${flat.floorNumber}`,
      totalZones: stats.totalZones,
      pendingZones: stats.pendingZones,
      precheckingZones: stats.precheckingZones,
      inProgressZones: stats.inProgressZones,
      cleaningInProgressZones: stats.cleaningInProgressZones,
      cleaningDoneZones: stats.cleaningDoneZones,
      completedZones: stats.completedZones,
      overallStatus: stats.overallStatus,
      progressPct,
      matchingZonesCount,
      matchingSqft: stats.matchingSqft,
      matchingZoneLabels,
      matchingZoneDetails: stats.matchingZoneDetails,
    });
  }

  const scopedTowers = towers.filter((t) => {
    if (projectId !== 'all' && t.projectId !== projectId) return false;
    if (towerId !== 'all' && t.id !== towerId) return false;
    return true;
  });

  const requireZoneMatch =
    statusFilter !== 'all' || areaFilter !== 'all' || areaSearch.trim().length > 0;

  const towerRows: TowerWorkStatusRow[] = scopedTowers
    .map((twr) => {
      const tFlats = allFlatRows.filter((fr) => fr.flat.towerId === twr.id);
      const tZones = tFlats.reduce((s, r) => s + r.totalZones, 0);
      const tPend = tFlats.reduce((s, r) => s + r.pendingZones, 0);
      const tPre = tFlats.reduce((s, r) => s + r.precheckingZones, 0);
      const tProg = tFlats.reduce((s, r) => s + r.inProgressZones, 0);
      const tCleanProg = tFlats.reduce((s, r) => s + r.cleaningInProgressZones, 0);
      const tCleanDone = tFlats.reduce((s, r) => s + r.cleaningDoneZones, 0);
      const tComp = tFlats.reduce((s, r) => s + r.completedZones, 0);
      const tMatchSqft = tFlats.reduce((s, r) => s + r.matchingSqft, 0);
      const matchingZonesCount = getMatchingCountForFilter(
        {
          totalZones: tZones,
          pendingZones: tPend,
          precheckingZones: tPre,
          inProgressZones: tProg,
          cleaningInProgressZones: tCleanProg,
          cleaningDoneZones: tCleanDone,
          completedZones: tComp,
        },
        statusFilter
      );
      return {
        tower: twr,
        projectName: projectMap.get(twr.projectId)?.name || 'Project',
        flatCount: tFlats.filter((r) => !requireZoneMatch || r.matchingZonesCount > 0).length,
        totalZones: tZones,
        pendingZones: tPend,
        precheckingZones: tPre,
        inProgressZones: tProg,
        cleaningInProgressZones: tCleanProg,
        cleaningDoneZones: tCleanDone,
        completedZones: tComp,
        pendingFlats: tFlats.filter((r) => r.pendingZones > 0).length,
        inProgressFlats: tFlats.filter((r) => r.inProgressZones > 0).length,
        completedFlats: tFlats.filter((r) => r.completedZones > 0).length,
        progressPct: tZones > 0 ? Math.round((tComp / tZones) * 100) : 0,
        matchingZonesCount,
        matchingSqft: tMatchSqft,
      };
    })
    .filter((row) => (requireZoneMatch ? row.matchingZonesCount > 0 : true));

  const floorMap = new Map<string, FloorWorkStatusRow>();
  for (const fr of allFlatRows) {
    if (requireZoneMatch && fr.matchingZonesCount === 0) continue;
    const key = `${fr.flat.towerId}::${fr.flat.floorNumber}`;
    const existing = floorMap.get(key) || {
      key,
      projectId: fr.flat.projectId,
      projectName: fr.projectName,
      towerId: fr.flat.towerId,
      towerName: fr.towerName,
      floorNumber: fr.flat.floorNumber,
      floorLabel: fr.floorLabel,
      flatCount: 0,
      totalZones: 0,
      pendingZones: 0,
      precheckingZones: 0,
      inProgressZones: 0,
      cleaningInProgressZones: 0,
      cleaningDoneZones: 0,
      completedZones: 0,
      progressPct: 0,
      matchingZonesCount: 0,
      matchingSqft: 0,
      flats: [],
    };
    existing.flatCount += 1;
    existing.totalZones += fr.totalZones;
    existing.pendingZones += fr.pendingZones;
    existing.precheckingZones += fr.precheckingZones;
    existing.inProgressZones += fr.inProgressZones;
    existing.cleaningInProgressZones += fr.cleaningInProgressZones;
    existing.cleaningDoneZones += fr.cleaningDoneZones;
    existing.completedZones += fr.completedZones;
    existing.matchingSqft += fr.matchingSqft;
    existing.flats.push(fr.flat);
    floorMap.set(key, existing);
  }

  const floorRows = Array.from(floorMap.values())
    .map((fl) => {
      const matchingZonesCount = getMatchingCountForFilter(fl, statusFilter);
      return {
        ...fl,
        progressPct: fl.totalZones > 0 ? Math.round((fl.completedZones / fl.totalZones) * 100) : 0,
        matchingZonesCount,
      };
    })
    .filter((fl) => (requireZoneMatch ? fl.matchingZonesCount > 0 : true))
    .sort((a, b) => a.towerName.localeCompare(b.towerName) || b.floorNumber - a.floorNumber);

  const flatRows = allFlatRows
    .filter((fr) => (requireZoneMatch ? fr.matchingZonesCount > 0 : true))
    .sort(
      (a, b) =>
        a.towerName.localeCompare(b.towerName) ||
        a.flat.floorNumber - b.flat.floorNumber ||
        a.flat.unitNumber.localeCompare(b.flat.unitNumber, undefined, { numeric: true })
    );

  return {
    totalFlats: requireZoneMatch ? flatRows.length : scopedFlats.length,
    totalZones,
    pendingZones,
    precheckingZones,
    inProgressZones,
    cleaningInProgressZones,
    cleaningDoneZones,
    completedZones,
    pendingFlats,
    inProgressFlats,
    completedFlats,
    overallProgressPct: totalZones > 0 ? Math.round((completedZones / totalZones) * 100) : 0,
    matchingZonesTotal,
    matchingSqftTotal,
    towerRows,
    floorRows,
    flatRows,
  };
}

export interface ExecutiveTaskStagePoint {
  stage: string;
  key: string;
  count: number;
  color: string;
}

export interface ExecutiveUtilizationPoint {
  towerId: string;
  label: string;
  projectName: string;
  assignedCrew: number;
  presentToday: number;
  utilizedCrew: number;
  utilizationPct: number;
}

export interface ExecutiveBurnSeriesPoint {
  date: string;
  shortLabel: string;
  wages: number;
  advances: number;
  siteExpenses: number;
  total: number;
}

export const DEFAULT_WEEKLY_EXPENSE_BUDGET = 50000;

export type BurnBudgetStatus = 'exceeded' | 'warning' | 'healthy' | 'unconfigured';

export interface ExecutiveSummaryMetrics {
  totalTasks: number;
  totalPendingTasks: number;
  notStartedTasks: number;
  precheckingTasks: number;
  inProgressTasks: number;
  cleaningInProgressTasks: number;
  cleaningDoneTasks: number;
  completedTasks: number;
  taskCompletionPct: number;
  taskPipelineStages: ExecutiveTaskStagePoint[];
  activeWorkersCount: number;
  utilizedWorkersCount: number;
  presentTodayCount: number;
  assignedWorkersCount: number;
  workforceUtilizationPct: number;
  towerUtilizationRows: ExecutiveUtilizationPoint[];
  totalSiteSpend: number;
  wagesTotal: number;
  advancesTotal: number;
  siteExpensesTotal: number;
  activeSpendDays: number;
  dailyBurnRate: number;
  projectedMonthlyBurn: number;
  projectedWeeklyBurn: number;
  weeklyExpenseBudget: number;
  dailyBurnThreshold: number;
  currentWeekSpend: number;
  currentWeekStart: string;
  currentWeekEnd: string;
  burnBudgetStatus: BurnBudgetStatus;
  burnPaceRatioPct: number;
  burnThresholdVariancePct: number;
  projectedWeeklyExcess: number;
  weeklyActualExcess: number;
  burnAlertTriggered: boolean;
  dailyBurnSeries: ExecutiveBurnSeriesPoint[];
}

export function computeExecutiveSummaryMetrics(params: {
  projects: Project[];
  towers: Tower[];
  flats: FlatUnit[];
  employees: Employee[];
  assignments: WorkAssignment[];
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  expenses: SiteExpense[];
  weeklyExpenseBudget?: number;
  referenceDate?: string;
}): ExecutiveSummaryMetrics {
  const {
    projects,
    towers,
    flats,
    employees,
    assignments,
    attendance,
    advances,
    expenses,
    weeklyExpenseBudget,
    referenceDate,
  } = params;
  const now = new Date();
  const fallbackToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const today = referenceDate || fallbackToday;

  let notStartedTasks = 0;
  let precheckingTasks = 0;
  let inProgressTasks = 0;
  let cleaningInProgressTasks = 0;
  let cleaningDoneTasks = 0;
  let pureCompletedTasks = 0;

  const activeAssignedWorkerIds = new Set<string>();
  for (const flat of flats) {
    for (const zState of Object.values(flat.zones || {})) {
      if (!zState) continue;
      if (zState.status === 'not_started') {
        notStartedTasks += 1;
      } else if (zState.status === 'prechecking') {
        precheckingTasks += 1;
        if (zState.assignedEmployeeId) activeAssignedWorkerIds.add(zState.assignedEmployeeId);
      } else if (zState.status === 'in_progress') {
        inProgressTasks += 1;
        if (zState.assignedEmployeeId) activeAssignedWorkerIds.add(zState.assignedEmployeeId);
      } else if (zState.status === 'cleaning_in_progress') {
        cleaningInProgressTasks += 1;
        if (zState.assignedEmployeeId) activeAssignedWorkerIds.add(zState.assignedEmployeeId);
      } else if (zState.status === 'cleaning_done') {
        cleaningDoneTasks += 1;
      } else {
        pureCompletedTasks += 1;
      }
    }
  }

  for (const a of assignments) {
    if (
      a.status === 'assigned' ||
      a.status === 'prechecking' ||
      a.status === 'in_progress' ||
      a.status === 'cleaning_in_progress'
    ) {
      if (a.employeeId) activeAssignedWorkerIds.add(a.employeeId);
    }
  }

  const totalPendingTasks =
    notStartedTasks + precheckingTasks + inProgressTasks + cleaningInProgressTasks;
  const completedTasks = pureCompletedTasks + cleaningDoneTasks;
  const totalTasks = totalPendingTasks + completedTasks;
  const taskCompletionPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const taskPipelineStages: ExecutiveTaskStagePoint[] = [
    { stage: 'Not Started', key: 'not_started', count: notStartedTasks, color: '#64748b' },
    { stage: 'Prechecking', key: 'prechecking', count: precheckingTasks, color: '#6366f1' },
    { stage: 'In Progress', key: 'in_progress', count: inProgressTasks, color: '#d97706' },
    { stage: 'Cleaning Run', key: 'cleaning_in_progress', count: cleaningInProgressTasks, color: '#0891b2' },
    { stage: 'Cleaning Done', key: 'cleaning_done', count: cleaningDoneTasks, color: '#0d9488' },
    { stage: 'Completed/QC', key: 'completed', count: pureCompletedTasks, color: '#059669' },
  ];

  // Workforce utilization across active employees
  const activeEmployees = employees.filter((e) => e.status === 'active');
  const presentTodayIds = new Set<string>();
  const latestAttendanceDate =
    attendance.some((a) => a.date === today)
      ? today
      : attendance.map((a) => a.date).sort((a, b) => b.localeCompare(a))[0] || today;

  for (const att of attendance) {
    if (att.date === latestAttendanceDate && (att.status === 'present' || att.status === 'half_day')) {
      presentTodayIds.add(att.employeeId);
    }
  }

  const utilizedIds = new Set<string>();
  for (const emp of activeEmployees) {
    if (
      presentTodayIds.has(emp.id) ||
      activeAssignedWorkerIds.has(emp.id) ||
      Boolean(emp.currentTowerId)
    ) {
      if (presentTodayIds.has(emp.id) || activeAssignedWorkerIds.has(emp.id)) {
        utilizedIds.add(emp.id);
      }
    }
  }

  const activeWorkersCount = activeEmployees.length;
  const utilizedWorkersCount = utilizedIds.size;
  const presentTodayCount = presentTodayIds.size;
  const assignedWorkersCount = activeEmployees.filter((e) => activeAssignedWorkerIds.has(e.id)).length;
  const workforceUtilizationPct =
    activeWorkersCount > 0 ? Math.min(100, Math.round((utilizedWorkersCount / activeWorkersCount) * 100)) : 0;

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const towerUtilizationRows: ExecutiveUtilizationPoint[] = towers.map((twr) => {
    const crew = activeEmployees.filter((e) => e.currentTowerId === twr.id);
    const present = crew.filter((e) => presentTodayIds.has(e.id)).length;
    const utilized = crew.filter(
      (e) => presentTodayIds.has(e.id) || activeAssignedWorkerIds.has(e.id)
    ).length;
    const denom = Math.max(crew.length, 1);
    return {
      towerId: twr.id,
      label: twr.name,
      projectName: projectMap.get(twr.projectId)?.name || 'Project',
      assignedCrew: crew.length,
      presentToday: present,
      utilizedCrew: utilized,
      utilizationPct: crew.length > 0 ? Math.round((utilized / denom) * 100) : 0,
    };
  });

  // Expense Burn Rate across all dates (Wages + Advances + Site Expenses)
  const daySpendMap = new Map<string, { wages: number; advances: number; siteExpenses: number }>();
  const ensureDay = (date: string) => {
    const d = (date || '').slice(0, 10) || today;
    const cur = daySpendMap.get(d) || { wages: 0, advances: 0, siteExpenses: 0 };
    daySpendMap.set(d, cur);
    return cur;
  };

  let wagesTotal = 0;
  let advancesTotal = 0;
  let siteExpensesTotal = 0;

  for (const att of attendance) {
    const amt = (Number(att.dailyWageEarned) || 0) + (Number(att.overtimePayEarned) || 0);
    if (amt <= 0) continue;
    wagesTotal += amt;
    ensureDay(att.date).wages += amt;
  }
  for (const adv of advances) {
    const amt = Number(adv.amount) || 0;
    if (amt <= 0) continue;
    advancesTotal += amt;
    ensureDay(adv.date).advances += amt;
  }
  for (const exp of expenses) {
    const amt = Number(exp.amount) || 0;
    if (amt <= 0) continue;
    siteExpensesTotal += amt;
    ensureDay(exp.date).siteExpenses += amt;
  }

  const totalSiteSpend = wagesTotal + advancesTotal + siteExpensesTotal;
  const sortedDates = Array.from(daySpendMap.keys()).sort((a, b) => a.localeCompare(b));
  const activeSpendDays = Math.max(1, sortedDates.length);
  const dailyBurnRate = sortedDates.length > 0 ? Math.round(totalSiteSpend / activeSpendDays) : 0;
  const projectedMonthlyBurn = dailyBurnRate * 30;
  const projectedWeeklyBurn = dailyBurnRate * 7;

  // Weekly budget threshold evaluation (Mon-Sun week containing referenceDate/today)
  const weekWindow = getWeeklyWindowForDate(today);
  let currentWeekSpend = 0;
  for (const [dStr, row] of daySpendMap.entries()) {
    if (dStr >= weekWindow.start && dStr <= weekWindow.end) {
      currentWeekSpend += row.wages + row.advances + row.siteExpenses;
    }
  }

  const resolvedWeeklyBudget =
    typeof weeklyExpenseBudget === 'number' &&
    Number.isFinite(weeklyExpenseBudget) &&
    weeklyExpenseBudget > 0
      ? Math.round(weeklyExpenseBudget)
      : 0;
  const dailyBurnThreshold = resolvedWeeklyBudget > 0 ? Math.round(resolvedWeeklyBudget / 7) : 0;

  let burnBudgetStatus: BurnBudgetStatus = 'unconfigured';
  if (resolvedWeeklyBudget > 0) {
    if (dailyBurnRate > dailyBurnThreshold || currentWeekSpend > resolvedWeeklyBudget) {
      burnBudgetStatus = 'exceeded';
    } else if (
      dailyBurnRate >= Math.round(dailyBurnThreshold * 0.85) ||
      currentWeekSpend >= Math.round(resolvedWeeklyBudget * 0.85)
    ) {
      burnBudgetStatus = 'warning';
    } else {
      burnBudgetStatus = 'healthy';
    }
  }

  const pacePct = dailyBurnThreshold > 0 ? Math.round((dailyBurnRate / dailyBurnThreshold) * 100) : 0;
  const weekSpendPct =
    resolvedWeeklyBudget > 0 ? Math.round((currentWeekSpend / resolvedWeeklyBudget) * 100) : 0;
  const burnPaceRatioPct = Math.max(pacePct, weekSpendPct);
  const burnThresholdVariancePct =
    dailyBurnThreshold > 0
      ? Math.round(((dailyBurnRate - dailyBurnThreshold) / dailyBurnThreshold) * 100)
      : 0;
  const projectedWeeklyExcess =
    resolvedWeeklyBudget > 0 ? Math.max(0, projectedWeeklyBurn - resolvedWeeklyBudget) : 0;
  const weeklyActualExcess =
    resolvedWeeklyBudget > 0 ? Math.max(0, currentWeekSpend - resolvedWeeklyBudget) : 0;
  const burnAlertTriggered = burnBudgetStatus === 'exceeded';

  const recentDates = sortedDates.slice(-10);
  const dailyBurnSeries: ExecutiveBurnSeriesPoint[] = recentDates.map((d) => {
    const row = daySpendMap.get(d) || { wages: 0, advances: 0, siteExpenses: 0 };
    const [, m, day] = d.split('-');
    return {
      date: d,
      shortLabel: m && day ? `${day}/${m}` : d,
      wages: row.wages,
      advances: row.advances,
      siteExpenses: row.siteExpenses,
      total: row.wages + row.advances + row.siteExpenses,
    };
  });

  return {
    totalTasks,
    totalPendingTasks,
    notStartedTasks,
    precheckingTasks,
    inProgressTasks,
    cleaningInProgressTasks,
    cleaningDoneTasks,
    completedTasks,
    taskCompletionPct,
    taskPipelineStages,
    activeWorkersCount,
    utilizedWorkersCount,
    presentTodayCount,
    assignedWorkersCount,
    workforceUtilizationPct,
    towerUtilizationRows,
    totalSiteSpend,
    wagesTotal,
    advancesTotal,
    siteExpensesTotal,
    activeSpendDays: sortedDates.length,
    dailyBurnRate,
    projectedMonthlyBurn,
    projectedWeeklyBurn,
    weeklyExpenseBudget: resolvedWeeklyBudget,
    dailyBurnThreshold,
    currentWeekSpend,
    currentWeekStart: weekWindow.start,
    currentWeekEnd: weekWindow.end,
    burnBudgetStatus,
    burnPaceRatioPct,
    burnThresholdVariancePct,
    projectedWeeklyExcess,
    weeklyActualExcess,
    burnAlertTriggered,
    dailyBurnSeries,
  };
}

export function formatBurnAlertWhatsappMessage(params: {
  companyName: string;
  scopeLabel: string;
  metrics: ExecutiveSummaryMetrics;
}): string {
  const { companyName, scopeLabel, metrics } = params;
  return [
    `*${companyName} — EXPENSE BURN RATE ALERT*`,
    `Scope: ${scopeLabel}`,
    `Weekly Budget Limit: ${formatINR(metrics.weeklyExpenseBudget)}/wk (Daily Threshold: ${formatINR(metrics.dailyBurnThreshold)}/day)`,
    `Current Expense Burn Rate: ${formatINR(metrics.dailyBurnRate)}/active day`,
    `Projected 7-Day Pace: ${formatINR(metrics.projectedWeeklyBurn)}/wk`,
    `This Week Spend (${metrics.currentWeekStart} to ${metrics.currentWeekEnd}): ${formatINR(metrics.currentWeekSpend)}`,
    metrics.projectedWeeklyExcess > 0
      ? `Projected Weekly Overrun: +${formatINR(metrics.projectedWeeklyExcess)} (${metrics.burnPaceRatioPct}% of budget)`
      : `Actual Weekly Overrun: +${formatINR(metrics.weeklyActualExcess)} (${metrics.burnPaceRatioPct}% of budget)`,
    `Action Required: Please review daily wages, advances & site expenses.`,
  ].join('\n');
}

export interface OverviewKpis {
  activeProjectsCount: number;
  totalProjectsCount: number;
  totalWorkforceCount: number;
  activeWorkforceCount: number;
  todayAttendancePct: number;
  todayAttendedCount: number;
  todayEligibleCount: number;
  pendingFoodAdvancesCount: number;
  pendingFoodAdvancesAmount: number;
  pendingApprovalFoodCount: number;
  pendingApprovalFoodAmount: number;
  unacknowledgedFoodCount: number;
  unacknowledgedFoodAmount: number;
}

export function computeOverviewKpis(params: {
  projects: Project[];
  employees: Employee[];
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  date: string;
}): OverviewKpis {
  const { projects, employees, attendance, advances, date } = params;
  const activeProjectsCount = projects.filter((p) => p.status === 'active').length;
  const totalProjectsCount = projects.length;

  const activeEmployees = employees.filter((e) => e.status === 'active');
  const activeWorkforceCount = activeEmployees.length;
  const totalWorkforceCount = employees.length;

  const activeEmpIds = new Set(activeEmployees.map((e) => e.id));
  const todayRecords = attendance.filter((a) => a.date === date);
  const attendedIds = new Set<string>();
  for (const rec of todayRecords) {
    if (rec.status === 'present' || rec.status === 'half_day') {
      attendedIds.add(rec.employeeId);
    }
  }
  const todayEligibleCount =
    activeWorkforceCount > 0 ? activeWorkforceCount : todayRecords.length;
  const todayAttendedCount =
    activeWorkforceCount > 0
      ? Array.from(attendedIds).filter((id) => activeEmpIds.has(id)).length
      : attendedIds.size;
  const todayAttendancePct =
    todayEligibleCount > 0
      ? Math.min(100, Math.round((todayAttendedCount / todayEligibleCount) * 100))
      : 0;

  const foodAdvances = advances.filter(
    (adv) => adv.advanceType === 'daily_food' || adv.advanceType === 'weekly_food'
  );
  let pendingApprovalFoodCount = 0;
  let pendingApprovalFoodAmount = 0;
  let unacknowledgedFoodCount = 0;
  let unacknowledgedFoodAmount = 0;
  let pendingFoodAdvancesCount = 0;
  let pendingFoodAdvancesAmount = 0;

  for (const adv of foodAdvances) {
    const amt = Number(adv.amount) || 0;
    const isPendingAdmin = adv.approvalStatus === 'pending_admin';
    const isRejected = adv.approvalStatus === 'rejected';
    const isUnacked = !adv.acknowledged && !isRejected;

    if (isPendingAdmin) {
      pendingApprovalFoodCount += 1;
      pendingApprovalFoodAmount += amt;
    }
    if (isUnacked) {
      unacknowledgedFoodCount += 1;
      unacknowledgedFoodAmount += amt;
    }
    if (isPendingAdmin || isUnacked) {
      pendingFoodAdvancesCount += 1;
      pendingFoodAdvancesAmount += amt;
    }
  }

  return {
    activeProjectsCount,
    totalProjectsCount,
    totalWorkforceCount,
    activeWorkforceCount,
    todayAttendancePct,
    todayAttendedCount,
    todayEligibleCount,
    pendingFoodAdvancesCount,
    pendingFoodAdvancesAmount,
    pendingApprovalFoodCount,
    pendingApprovalFoodAmount,
    unacknowledgedFoodCount,
    unacknowledgedFoodAmount,
  };
}

export type ProjectCompletionTier = 'high' | 'medium' | 'low';

export interface ProjectCompletionStyle {
  tier: ProjectCompletionTier;
  tierLabel: string;
  colorHex: string;
  borderHex: string;
  badgeClass: string;
}

export function getProjectCompletionColor(pct: number): ProjectCompletionStyle {
  if (pct >= 75) {
    return {
      tier: 'high',
      tierLabel: 'On Track (75%+)',
      colorHex: '#16a34a',
      borderHex: '#15803d',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }
  if (pct >= 35) {
    return {
      tier: 'medium',
      tierLabel: 'In Progress (35–74%)',
      colorHex: '#d97706',
      borderHex: '#b45309',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    };
  }
  return {
    tier: 'low',
    tierLabel: 'Early Stage (<35%)',
    colorHex: '#dc2626',
    borderHex: '#991b1b',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
  };
}

export interface ProjectCompletionPoint {
  projectId: string;
  projectName: string;
  shortName: string;
  location: string;
  placeId?: string;
  status: Project['status'];
  towersCount: number;
  totalFlats: number;
  completedFlats: number;
  inProgressFlats: number;
  totalZones: number;
  completedZones: number;
  completionPct: number;
  tier: ProjectCompletionTier;
  tierLabel: string;
  colorHex: string;
  borderHex: string;
  badgeClass: string;
}

export function computeProjectCompletionSeries(params: {
  projects: Project[];
  towers: Tower[];
  flats: FlatUnit[];
  tileZoneCatalog?: TileZoneDefinition[];
  onlyActive?: boolean;
}): ProjectCompletionPoint[] {
  const {
    projects,
    towers,
    flats,
    tileZoneCatalog = TILE_ZONES,
    onlyActive = true,
  } = params;

  const targetProjects = onlyActive
    ? projects.filter((p) => p.status === 'active')
    : projects;

  return targetProjects.map((project) => {
    const projTowers = towers.filter((t) => t.projectId === project.id);
    const projFlats = flats.filter((f) => f.projectId === project.id);

    let completedFlats = 0;
    let inProgressFlats = 0;
    let totalZones = 0;
    let completedZones = 0;

    for (const flat of projFlats) {
      const prog = calculateFlatProgress(flat, tileZoneCatalog);
      totalZones += prog.totalZones;
      completedZones += prog.completedCount;
      if (prog.totalZones > 0 && prog.completedCount === prog.totalZones) {
        completedFlats += 1;
      } else if (
        prog.inProgressCount > 0 ||
        prog.completedCount > 0 ||
        prog.precheckingCount > 0 ||
        prog.cleaningInProgressCount > 0
      ) {
        inProgressFlats += 1;
      }
    }

    const completionPct =
      totalZones > 0 ? Math.round((completedZones / totalZones) * 100) : 0;
    const style = getProjectCompletionColor(completionPct);
    const trimmedName = (project.name || 'Site').trim();
    const shortName =
      trimmedName.length > 18 ? `${trimmedName.slice(0, 16)}…` : trimmedName;

    return {
      projectId: project.id,
      projectName: project.name,
      shortName,
      location: project.location,
      placeId: project.placeId,
      status: project.status,
      towersCount: projTowers.length,
      totalFlats: projFlats.length,
      completedFlats,
      inProgressFlats,
      totalZones,
      completedZones,
      completionPct,
      tier: style.tier,
      tierLabel: style.tierLabel,
      colorHex: style.colorHex,
      borderHex: style.borderHex,
      badgeClass: style.badgeClass,
    };
  });
}

export const EMPLOYEE_PRESET_SKILL_TAGS = [
  'Marble Specialist',
  'Granite Cutter',
  'Vitrified Tile Layer',
  'Dado & Waterproofing',
  'Skirting Specialist',
  'Epoxy Grouting',
  'Acid Wash & Cleaning',
  'Italian Marble Polishing',
  'Balcony & Slope Tiling',
  'Floor Levelling',
] as const;

export function normalizeSkillTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of tags) {
    const t = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(t);
    if (cleaned.length >= 20) break;
  }
  return cleaned;
}

export function filterEmployeesBySkillTags(
  employees: Employee[],
  selectedSkills: string[],
  matchMode: 'any' | 'all' = 'any'
): Employee[] {
  const normalizedSelected = selectedSkills
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (normalizedSelected.length === 0) return employees;

  return employees.filter((emp) => {
    const empTags = new Set(
      (emp.skillTags || []).map((t) => t.trim().toLowerCase()).filter(Boolean)
    );
    if (empTags.size === 0) return false;
    if (matchMode === 'all') {
      return normalizedSelected.every((s) => empTags.has(s));
    }
    return normalizedSelected.some((s) => empTags.has(s));
  });
}

export function getCurrentHHMM(dateObj: Date = new Date()): string {
  const hh = String(dateObj.getHours()).padStart(2, '0');
  const mm = String(dateObj.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function normalizeHHMM(raw?: string): string {
  const cleaned = (raw || '').trim();
  const match = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hh = Math.min(23, Math.max(0, parseInt(match[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(match[2], 10)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function computeWorkedHoursFromInOut(
  inTime?: string,
  outTime?: string
): { valid: boolean; totalHours: number; overtimeHoursEstimate: number } {
  const normIn = normalizeHHMM(inTime);
  const normOut = normalizeHHMM(outTime);
  if (!normIn || !normOut) {
    return { valid: false, totalHours: 0, overtimeHoursEstimate: 0 };
  }
  const [inH, inM] = normIn.split(':').map(Number);
  const [outH, outM] = normOut.split(':').map(Number);
  let diffMins = outH * 60 + outM - (inH * 60 + inM);
  if (diffMins < 0) diffMins += 24 * 60; // overnight shift safety
  if (diffMins <= 0 || diffMins > 24 * 60) {
    return { valid: false, totalHours: 0, overtimeHoursEstimate: 0 };
  }
  const totalHours = Number((diffMins / 60).toFixed(2));
  const overtimeHoursEstimate = Number(Math.max(0, totalHours - 9).toFixed(1)); // 9h window including 1h lunch
  return { valid: true, totalHours, overtimeHoursEstimate };
}

export function formatAttendanceInOutSummary(rec?: Pick<AttendanceRecord, 'inTime' | 'outTime'>): string {
  if (!rec) return '—';
  const i = normalizeHHMM(rec.inTime);
  const o = normalizeHHMM(rec.outTime);
  if (i && o) return `In ${i} · Out ${o}`;
  if (i) return `In ${i} · Active`;
  if (o) return `Out ${o}`;
  return 'Time not logged';
}

export const SUPERVISOR_TOOL_PRESETS = [
  'Diamond Cutting Blade',
  'Tile Spacers & Leveling Wedges',
  'Notched Trowel / Epoxy Float',
  'Rubber Mallet & Spirit Level',
  'Grinder Wheel / Core Drill Bit',
  'Sponge, Acid Wash & Buckets',
  'Laser Level Battery / Tape',
] as const;

export interface SupervisorToolSpendSummary {
  totalCount: number;
  totalAmount: number;
  pendingCount: number;
  pendingAmount: number;
  approvedCount: number;
  approvedAmount: number;
  reimbursedCount: number;
  reimbursedAmount: number;
  rows: SiteExpense[];
}

export function summarizeSupervisorToolSpends(expenses: SiteExpense[]): SupervisorToolSpendSummary {
  const rows = expenses
    .filter((e) => e.recordedByRole === 'supervisor')
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  let totalAmount = 0;
  let pendingCount = 0;
  let pendingAmount = 0;
  let approvedCount = 0;
  let approvedAmount = 0;
  let reimbursedCount = 0;
  let reimbursedAmount = 0;

  for (const exp of rows) {
    const amt = Number(exp.amount) || 0;
    totalAmount += amt;
    const status = exp.reimbursementStatus || 'pending_admin';
    if (status === 'reimbursed') {
      reimbursedCount += 1;
      reimbursedAmount += amt;
    } else if (status === 'approved') {
      approvedCount += 1;
      approvedAmount += amt;
    } else {
      pendingCount += 1;
      pendingAmount += amt;
    }
  }

  return {
    totalCount: rows.length,
    totalAmount,
    pendingCount,
    pendingAmount,
    approvedCount,
    approvedAmount,
    reimbursedCount,
    reimbursedAmount,
    rows,
  };
}




