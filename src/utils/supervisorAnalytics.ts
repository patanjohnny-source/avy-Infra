import type {
  AttendanceRecord,
  Employee,
  Project,
  Tower,
  WorkAssignment,
} from '../types/avy';

export const TOWER_CHART_COLORS = [
  '#c2410c', // Burnt orange (primary)
  '#0284c7', // Steel blue
  '#059669', // Site emerald
  '#7c3aed', // Indigo-violet
  '#d97706', // Amber gold
  '#0f766e', // Deep teal
];

export interface TowerSeriesMeta {
  towerId: string;
  towerName: string;
  projectId: string;
  projectName: string;
  chartLabel: string;
  countKey: string;
  pctKey: string;
  color: string;
}

export interface DailyTowerTrendRow {
  date: string;
  shortDate: string;
  totalPresent: number;
  totalHalfDay: number;
  totalAbsent: number;
  totalMarkedPresentEq: number;
  overallAttendancePct: number;
  [dynamicKey: string]: string | number;
}

export interface TowerAnalyticsBreakdown {
  towerId: string;
  towerName: string;
  projectId: string;
  projectName: string;
  shortLabel: string;
  allocatedCrew: number;
  activeDeployed: number;
  pendingDeployment: number;
  absentCount: number;
  zoneAssignedCount: number;
  standbyNoZoneCount: number;
  attendancePctToday: number;
  weeklyRetentionPct: number;
  retainedWorkersCount: number;
  retentionDenominator: number;
  retentionBasis: 'week_over_week' | 'rolling_7d_continuity';
}

export interface DeploymentChartRow {
  id: string;
  label: string;
  sublabel: string;
  activeDeployed: number;
  pendingDeployment: number;
  absentCount: number;
  weeklyRetentionPct: number;
}

export interface SupervisorAnalyticsResult {
  referenceDate: string;
  windowDays: 7 | 14;
  windowStart: string;
  windowEnd: string;
  towerSeries: TowerSeriesMeta[];
  dailyTrendRows: DailyTowerTrendRow[];
  towerBreakdown: TowerAnalyticsBreakdown[];
  deploymentRows: DeploymentChartRow[];
  totalAllocatedCrew: number;
  totalActiveDeployed: number;
  totalPendingDeployment: number;
  unassignedPoolCount: number;
  totalAbsent: number;
  avgAttendanceRatePct: number;
  todayAttendanceRatePct: number;
  overallWeeklyRetentionPct: number;
  retentionBasis: 'week_over_week' | 'rolling_7d_continuity';
  returningCrewTotal: number;
  cohortTotal: number;
}

function parseIsoDateLocal(dateStr: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return null;
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDateIsoLocal(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysIso(dateStr: string, offset: number): string {
  const base = parseIsoDateLocal(dateStr) || new Date();
  const copy = new Date(base);
  copy.setDate(copy.getDate() + offset);
  return formatDateIsoLocal(copy);
}

function formatShortDate(dateStr: string): string {
  const parts = dateStr.slice(0, 10).split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

function isAttendedStatus(status: AttendanceRecord['status']): boolean {
  return status === 'present' || status === 'half_day';
}

export function computeSupervisorAnalytics(params: {
  projects: Project[];
  towers: Tower[];
  employees: Employee[];
  attendance: AttendanceRecord[];
  assignments: WorkAssignment[];
  referenceDate: string;
  projectId?: string;
  towerId?: string;
  windowDays?: 7 | 14;
}): SupervisorAnalyticsResult {
  const {
    projects,
    towers,
    employees,
    attendance,
    assignments,
    referenceDate,
    projectId = 'all',
    towerId = 'all',
    windowDays = 7,
  } = params;

  const refDate = (referenceDate || formatDateIsoLocal(new Date())).slice(0, 10);
  const resolvedWindow: 7 | 14 = windowDays === 14 ? 14 : 7;
  const windowStart = addDaysIso(refDate, -(resolvedWindow - 1));
  const windowEnd = refDate;

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const scopedTowers = towers.filter((t) => {
    if (projectId !== 'all' && t.projectId !== projectId) return false;
    if (towerId !== 'all' && t.id !== towerId) return false;
    return true;
  });

  const activeEmployees = employees.filter((e) => e.status === 'active');
  const empById = new Map(activeEmployees.map((e) => [e.id, e]));

  // Active flat-zone assignments per employee
  const activeAssignedWorkerIds = new Set<string>();
  for (const asgn of assignments) {
    if (
      asgn.status === 'assigned' ||
      asgn.status === 'prechecking' ||
      asgn.status === 'in_progress' ||
      asgn.status === 'cleaning_in_progress'
    ) {
      if (asgn.employeeId) activeAssignedWorkerIds.add(asgn.employeeId);
    }
  }

  // Build tower metadata for chart lines
  const duplicateTowerNames = new Set<string>();
  const seenNames = new Set<string>();
  for (const t of scopedTowers) {
    if (seenNames.has(t.name)) duplicateTowerNames.add(t.name);
    seenNames.add(t.name);
  }

  const towerSeries: TowerSeriesMeta[] = scopedTowers.map((twr, idx) => {
    const pName = projectMap.get(twr.projectId)?.name || 'Project';
    const chartLabel = duplicateTowerNames.has(twr.name)
      ? `${twr.name} (${pName.split(' ')[0]})`
      : twr.name;
    return {
      towerId: twr.id,
      towerName: twr.name,
      projectId: twr.projectId,
      projectName: pName,
      chartLabel,
      countKey: `count_${twr.id}`,
      pctKey: `pct_${twr.id}`,
      color: TOWER_CHART_COLORS[idx % TOWER_CHART_COLORS.length],
    };
  });

  // Index attendance by date -> towerId -> records
  const resolveRecordTowerId = (rec: AttendanceRecord): string | undefined => {
    if (rec.towerId && scopedTowers.some((t) => t.id === rec.towerId)) {
      return rec.towerId;
    }
    const emp = empById.get(rec.employeeId);
    if (emp?.currentTowerId && scopedTowers.some((t) => t.id === emp.currentTowerId)) {
      return emp.currentTowerId;
    }
    return undefined;
  };

  const allocatedByTower = new Map<string, Employee[]>();
  for (const twr of scopedTowers) {
    allocatedByTower.set(
      twr.id,
      activeEmployees.filter((e) => e.currentTowerId === twr.id)
    );
  }

  // Dates list [windowStart .. windowEnd]
  const dateList: string[] = [];
  for (let i = resolvedWindow - 1; i >= 0; i--) {
    dateList.push(addDaysIso(refDate, -i));
  }

  const scopedTowerIdSet = new Set(scopedTowers.map((t) => t.id));
  const dailyTrendRows: DailyTowerTrendRow[] = dateList.map((d) => {
    const recsForDay = attendance.filter((a) => a.date === d);
    let totalPresent = 0;
    let totalHalfDay = 0;
    let totalAbsent = 0;
    let totalMarkedPresentEq = 0;

    const row: DailyTowerTrendRow = {
      date: d,
      shortDate: formatShortDate(d),
      totalPresent: 0,
      totalHalfDay: 0,
      totalAbsent: 0,
      totalMarkedPresentEq: 0,
      overallAttendancePct: 0,
    };

    const perTowerRecs = new Map<string, AttendanceRecord[]>();
    for (const twr of scopedTowers) {
      perTowerRecs.set(twr.id, []);
    }

    for (const rec of recsForDay) {
      const tId = resolveRecordTowerId(rec);
      if (!tId || !scopedTowerIdSet.has(tId)) continue;
      perTowerRecs.get(tId)?.push(rec);
    }

    let totalCapacityForDay = 0;

    for (const meta of towerSeries) {
      const twrRecs = perTowerRecs.get(meta.towerId) || [];
      const allocCount = allocatedByTower.get(meta.towerId)?.length || 0;

      // Deduplicate by employeeId for accurate daily headcounts
      const byEmp = new Map<string, AttendanceRecord>();
      for (const r of twrRecs) byEmp.set(r.employeeId, r);

      let tPresent = 0;
      let tHalf = 0;
      let tAbsent = 0;
      for (const r of byEmp.values()) {
        if (r.status === 'present') tPresent += 1;
        else if (r.status === 'half_day') tHalf += 1;
        else if (r.status === 'absent') tAbsent += 1;
      }

      const tHeadcount = tPresent + tHalf;
      const tEq = tPresent + tHalf * 0.5;
      const denom = Math.max(allocCount, byEmp.size);
      const tPct = denom > 0 ? Math.min(100, Math.round((tEq / denom) * 100)) : 0;

      row[meta.countKey] = tHeadcount;
      row[meta.pctKey] = tPct;

      totalPresent += tPresent;
      totalHalfDay += tHalf;
      totalAbsent += tAbsent;
      totalMarkedPresentEq += tEq;
      totalCapacityForDay += denom;
    }

    row.totalPresent = totalPresent;
    row.totalHalfDay = totalHalfDay;
    row.totalAbsent = totalAbsent;
    row.totalMarkedPresentEq = Number(totalMarkedPresentEq.toFixed(1));
    row.overallAttendancePct =
      totalCapacityForDay > 0
        ? Math.min(100, Math.round((totalMarkedPresentEq / totalCapacityForDay) * 100))
        : 0;

    return row;
  });

  // Retention windows: Current 7 days [refDate-6..refDate] vs Prior 7 days [refDate-13..refDate-7]
  const curr7Start = addDaysIso(refDate, -6);
  const prior7Start = addDaysIso(refDate, -13);
  const prior7End = addDaysIso(refDate, -7);

  let anyPrior7ExistsInScope = false;
  for (const a of attendance) {
    if (a.date >= prior7Start && a.date <= prior7End && isAttendedStatus(a.status)) {
      const tId = resolveRecordTowerId(a);
      if (tId && scopedTowerIdSet.has(tId)) {
        anyPrior7ExistsInScope = true;
        break;
      }
    }
  }
  const retentionBasis: 'week_over_week' | 'rolling_7d_continuity' = anyPrior7ExistsInScope
    ? 'week_over_week'
    : 'rolling_7d_continuity';

  // Attendance lookup on referenceDate across ALL towers (in case worker was marked today)
  const refDateRecByEmp = new Map<string, AttendanceRecord>();
  for (const rec of attendance) {
    if (rec.date === refDate) {
      refDateRecByEmp.set(rec.employeeId, rec);
    }
  }

  let totalAllocatedCrew = 0;
  let totalActiveDeployed = 0;
  let totalPendingTowerMuster = 0;
  let totalAbsent = 0;
  let returningCrewTotal = 0;
  let cohortTotal = 0;

  const towerBreakdown: TowerAnalyticsBreakdown[] = scopedTowers.map((twr) => {
    const pName = projectMap.get(twr.projectId)?.name || 'Project';
    const crew = allocatedByTower.get(twr.id) || [];

    // Also include employees marked directly on this tower on refDate even if reassigned later
    const crewIdSet = new Set(crew.map((c) => c.id));
    for (const rec of attendance) {
      if (rec.date === refDate && rec.towerId === twr.id && empById.has(rec.employeeId)) {
        crewIdSet.add(rec.employeeId);
      }
    }

    let activeDeployed = 0;
    let pendingDeployment = 0;
    let absentCount = 0;
    let zoneAssignedCount = 0;
    let standbyNoZoneCount = 0;
    let presentEqToday = 0;

    for (const empId of crewIdSet) {
      const rec = refDateRecByEmp.get(empId);
      const isAllocatedToThisTower = empById.get(empId)?.currentTowerId === twr.id;
      const hasZone = activeAssignedWorkerIds.has(empId);

      if (rec && (rec.towerId === twr.id || (!rec.towerId && isAllocatedToThisTower) || isAllocatedToThisTower)) {
        if (rec.status === 'present') {
          activeDeployed += 1;
          presentEqToday += 1;
          if (hasZone) zoneAssignedCount += 1;
          else standbyNoZoneCount += 1;
        } else if (rec.status === 'half_day') {
          activeDeployed += 1;
          presentEqToday += 0.5;
          if (hasZone) zoneAssignedCount += 1;
          else standbyNoZoneCount += 1;
        } else if (rec.status === 'absent') {
          absentCount += 1;
        }
      } else if (isAllocatedToThisTower) {
        // Allocated to tower but unmarked on referenceDate -> pending deployment / muster
        pendingDeployment += 1;
      }
    }

    const allocatedCount = crewIdSet.size;
    const attendancePctToday =
      allocatedCount > 0 ? Math.min(100, Math.round((presentEqToday / allocatedCount) * 100)) : 0;

    // Retention per tower
    const currAttendedDaysByEmp = new Map<string, Set<string>>();
    const currTowerDates = new Set<string>();
    const priorAttendedEmpIds = new Set<string>();

    for (const rec of attendance) {
      const tId = resolveRecordTowerId(rec);
      if (tId !== twr.id || !isAttendedStatus(rec.status)) continue;

      if (rec.date >= curr7Start && rec.date <= refDate) {
        currTowerDates.add(rec.date);
        const set = currAttendedDaysByEmp.get(rec.employeeId) || new Set<string>();
        set.add(rec.date);
        currAttendedDaysByEmp.set(rec.employeeId, set);
      } else if (rec.date >= prior7Start && rec.date <= prior7End) {
        priorAttendedEmpIds.add(rec.employeeId);
      }
    }

    let retainedWorkersCount = 0;
    let retentionDenominator = 0;

    if (retentionBasis === 'week_over_week' && priorAttendedEmpIds.size > 0) {
      retentionDenominator = priorAttendedEmpIds.size;
      for (const empId of priorAttendedEmpIds) {
        // Check if worker attended anywhere in scope during current 7-day window
        const attendedInCurrWeek = attendance.some(
          (a) =>
            a.employeeId === empId &&
            a.date >= curr7Start &&
            a.date <= refDate &&
            isAttendedStatus(a.status)
        );
        if (attendedInCurrWeek) {
          retainedWorkersCount += 1;
        }
      }
    } else {
      const cohortSet = new Set<string>([...crewIdSet, ...currAttendedDaysByEmp.keys()]);
      retentionDenominator = cohortSet.size;
      const minDaysForContinuity = currTowerDates.size >= 2 ? 2 : 1;
      for (const empId of cohortSet) {
        const attendedDays = currAttendedDaysByEmp.get(empId)?.size || 0;
        if (attendedDays >= minDaysForContinuity) {
          retainedWorkersCount += 1;
        }
      }
    }

    const weeklyRetentionPct =
      retentionDenominator > 0
        ? Math.min(100, Math.round((retainedWorkersCount / retentionDenominator) * 100))
        : 0;

    totalAllocatedCrew += allocatedCount;
    totalActiveDeployed += activeDeployed;
    totalPendingTowerMuster += pendingDeployment;
    totalAbsent += absentCount;
    returningCrewTotal += retainedWorkersCount;
    cohortTotal += retentionDenominator;

    return {
      towerId: twr.id,
      towerName: twr.name,
      projectId: twr.projectId,
      projectName: pName,
      shortLabel: duplicateTowerNames.has(twr.name)
        ? `${twr.name} · ${pName.split(' ')[0]}`
        : twr.name,
      allocatedCrew: allocatedCount,
      activeDeployed,
      pendingDeployment,
      absentCount,
      zoneAssignedCount,
      standbyNoZoneCount,
      attendancePctToday,
      weeklyRetentionPct,
      retainedWorkersCount,
      retentionDenominator,
      retentionBasis,
    };
  });

  // Unassigned active workers waiting for tower deployment (visible when viewing All Towers)
  const unassignedEmployees = activeEmployees.filter((e) => {
    if (towerId !== 'all') return false;
    if (!e.currentTowerId) {
      if (projectId !== 'all' && e.currentProjectId && e.currentProjectId !== projectId) {
        return false;
      }
      return true;
    }
    return false;
  });
  const unassignedPoolCount = unassignedEmployees.length;
  const totalPendingDeployment = totalPendingTowerMuster + unassignedPoolCount;

  const deploymentRows: DeploymentChartRow[] = towerBreakdown.map((tb) => ({
    id: tb.towerId,
    label: tb.shortLabel,
    sublabel: tb.projectName,
    activeDeployed: tb.activeDeployed,
    pendingDeployment: tb.pendingDeployment,
    absentCount: tb.absentCount,
    weeklyRetentionPct: tb.weeklyRetentionPct,
  }));

  if (unassignedPoolCount > 0 && towerId === 'all') {
    deploymentRows.push({
      id: 'unassigned_pool',
      label: 'Unassigned Pool',
      sublabel: 'Awaiting Tower Deployment',
      activeDeployed: 0,
      pendingDeployment: unassignedPoolCount,
      absentCount: 0,
      weeklyRetentionPct: 0,
    });
  }

  const activeDaysWithRecords = dailyTrendRows.filter(
    (r) => r.totalPresent + r.totalHalfDay + r.totalAbsent > 0
  );
  const avgAttendanceRatePct =
    activeDaysWithRecords.length > 0
      ? Math.round(
          activeDaysWithRecords.reduce((sum, r) => sum + r.overallAttendancePct, 0) /
            activeDaysWithRecords.length
        )
      : 0;

  const todayRow = dailyTrendRows[dailyTrendRows.length - 1];
  const todayAttendanceRatePct = todayRow ? todayRow.overallAttendancePct : 0;

  const overallWeeklyRetentionPct =
    cohortTotal > 0 ? Math.min(100, Math.round((returningCrewTotal / cohortTotal) * 100)) : 0;

  return {
    referenceDate: refDate,
    windowDays: resolvedWindow,
    windowStart,
    windowEnd,
    towerSeries,
    dailyTrendRows,
    towerBreakdown,
    deploymentRows,
    totalAllocatedCrew,
    totalActiveDeployed,
    totalPendingDeployment,
    unassignedPoolCount,
    totalAbsent,
    avgAttendanceRatePct,
    todayAttendanceRatePct,
    overallWeeklyRetentionPct,
    retentionBasis,
    returningCrewTotal,
    cohortTotal,
  };
}
