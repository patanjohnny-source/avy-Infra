import type {
  AdvanceEntry,
  AttendanceRecord,
  DailySiteLog,
  DeploymentRecord,
  Project,
  SiteExpense,
  Tower,
  WorkAssignment,
} from '../types/avy';
import { getExpenseCategoryLabel } from './operations';
import { formatINR, getAdvanceCategoryLabel } from './payroll';
import { getWorkStatusLabel } from './tileZones';

export type ProjectLogCategory =
  | 'site_log'
  | 'work_assignment'
  | 'attendance'
  | 'advance'
  | 'expense'
  | 'deployment';

export const PROJECT_LOG_CATEGORY_LABELS: Record<ProjectLogCategory, string> = {
  site_log: 'Daily Site Log',
  work_assignment: 'Work Assignment',
  attendance: 'Attendance Muster',
  advance: 'Worker Advance',
  expense: 'Site Expense',
  deployment: 'Crew Deployment',
};

export const ALL_PROJECT_LOG_CATEGORIES: ProjectLogCategory[] = [
  'site_log',
  'work_assignment',
  'attendance',
  'advance',
  'expense',
  'deployment',
];

export interface UnifiedProjectLogEntry {
  id: string;
  date: string;
  category: ProjectLogCategory;
  categoryLabel: string;
  towerName: string;
  subject: string;
  details: string;
  actor: string;
  metricOrAmount: string;
  statusLabel: string;
}

export interface ProjectLogsSummaryReport {
  project: Project;
  fromDate: string;
  toDate: string;
  totalEntries: number;
  countsByCategory: Record<ProjectLogCategory, number>;
  totalAdvanceAmount: number;
  totalSiteExpenseAmount: number;
  totalWagesLogged: number;
  totalWorkSqftLogged: number;
  towersCovered: string[];
  entries: UnifiedProjectLogEntry[];
}

function isWithinDateRange(dateStr: string, fromDate: string, toDate: string): boolean {
  if (!dateStr) return true;
  if (fromDate && dateStr < fromDate) return false;
  if (toDate && dateStr > toDate) return false;
  return true;
}

export function buildProjectLogsSummaryReport(params: {
  project: Project;
  towers: Tower[];
  dailySiteLogs: DailySiteLog[];
  assignments: WorkAssignment[];
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  expenses: SiteExpense[];
  deployments: DeploymentRecord[];
  fromDate?: string;
  toDate?: string;
  categories?: ProjectLogCategory[];
}): ProjectLogsSummaryReport {
  const {
    project,
    towers,
    dailySiteLogs,
    assignments,
    attendance,
    advances,
    expenses,
    deployments,
  } = params;
  const fromDate = (params.fromDate || '').trim();
  const toDate = (params.toDate || '').trim();
  const allowedCategories = new Set<ProjectLogCategory>(
    params.categories && params.categories.length > 0
      ? params.categories
      : ALL_PROJECT_LOG_CATEGORIES
  );

  const projectTowers = towers.filter((t) => t.projectId === project.id);
  const projectTowerIds = new Set(projectTowers.map((t) => t.id));
  const towerNameMap = new Map(projectTowers.map((t) => [t.id, t.name]));

  const matchesProject = (itemProjectId?: string, itemTowerId?: string): boolean => {
    if (itemProjectId === project.id) return true;
    if (itemTowerId && projectTowerIds.has(itemTowerId)) return true;
    return false;
  };

  const resolveTowerName = (towerId?: string, explicitName?: string): string => {
    if (explicitName?.trim()) return explicitName.trim();
    if (towerId && towerNameMap.has(towerId)) return towerNameMap.get(towerId) || 'Tower';
    return 'Project-Wide';
  };

  const countsByCategory: Record<ProjectLogCategory, number> = {
    site_log: 0,
    work_assignment: 0,
    attendance: 0,
    advance: 0,
    expense: 0,
    deployment: 0,
  };

  let totalAdvanceAmount = 0;
  let totalSiteExpenseAmount = 0;
  let totalWagesLogged = 0;
  let totalWorkSqftLogged = 0;

  const entries: UnifiedProjectLogEntry[] = [];

  if (allowedCategories.has('site_log')) {
    for (const log of dailySiteLogs) {
      if (!matchesProject(log.projectId, log.towerId)) continue;
      if (!isWithinDateRange(log.date, fromDate, toDate)) continue;
      countsByCategory.site_log += 1;
      entries.push({
        id: `slog:${log.id}`,
        date: log.date,
        category: 'site_log',
        categoryLabel: PROJECT_LOG_CATEGORY_LABELS.site_log,
        towerName: resolveTowerName(log.towerId, log.towerName),
        subject: 'Tower Progress Journal',
        details: log.notes || 'Daily site observation',
        actor: `${log.loggedByName} (${log.loggedByRole === 'supervisor' ? 'Supervisor' : 'Admin'})`,
        metricOrAmount: log.photoDataUrl ? 'Photo Attached' : 'Text Note',
        statusLabel: 'Logged',
      });
    }
  }

  if (allowedCategories.has('work_assignment')) {
    for (const work of assignments) {
      if (!matchesProject(work.projectId, work.towerId)) continue;
      if (!isWithinDateRange(work.assignedDate, fromDate, toDate)) continue;
      countsByCategory.work_assignment += 1;
      totalWorkSqftLogged += Number(work.targetSqft) || 0;
      entries.push({
        id: `work:${work.id}`,
        date: work.assignedDate,
        category: 'work_assignment',
        categoryLabel: PROJECT_LOG_CATEGORY_LABELS.work_assignment,
        towerName: resolveTowerName(work.towerId, work.towerName),
        subject: `Unit ${work.unitNumber} · ${work.zoneLabel}`,
        details: work.notes || `Assigned to ${work.employeeName} (${work.empCode})`,
        actor: `${work.employeeName} (${work.empCode})`,
        metricOrAmount: `${Math.round(Number(work.targetSqft) || 0)} Sq.Ft`,
        statusLabel: getWorkStatusLabel(work.status),
      });
    }
  }

  if (allowedCategories.has('attendance')) {
    for (const att of attendance) {
      if (!matchesProject(att.projectId, att.towerId)) continue;
      if (!isWithinDateRange(att.date, fromDate, toDate)) continue;
      countsByCategory.attendance += 1;
      const earned = (Number(att.dailyWageEarned) || 0) + (Number(att.overtimePayEarned) || 0);
      totalWagesLogged += earned;
      const statusText =
        att.status === 'present'
          ? 'Present'
          : att.status === 'half_day'
            ? 'Half Day'
            : 'Absent';
      entries.push({
        id: `att:${att.id}`,
        date: att.date,
        category: 'attendance',
        categoryLabel: PROJECT_LOG_CATEGORY_LABELS.attendance,
        towerName: resolveTowerName(att.towerId, att.towerName),
        subject: `${att.employeeName} (${att.empCode})`,
        details:
          att.notes ||
          `${att.employeeRole}${att.overtimeHours > 0 ? ` · ${att.overtimeHours}h OT` : ''}`,
        actor: att.markedByName || 'Site Supervisor',
        metricOrAmount: formatINR(earned),
        statusLabel: att.overtimeHours > 0 ? `${statusText} + ${att.overtimeHours}h OT` : statusText,
      });
    }
  }

  if (allowedCategories.has('advance')) {
    for (const adv of advances) {
      if (!matchesProject(adv.projectId, adv.towerId)) continue;
      if (!isWithinDateRange(adv.date, fromDate, toDate)) continue;
      countsByCategory.advance += 1;
      const amt = Number(adv.amount) || 0;
      totalAdvanceAmount += amt;
      const catLabel = getAdvanceCategoryLabel(adv);
      entries.push({
        id: `adv:${adv.id}`,
        date: adv.date,
        category: 'advance',
        categoryLabel: PROJECT_LOG_CATEGORY_LABELS.advance,
        towerName: resolveTowerName(adv.towerId, adv.towerName),
        subject: `${adv.employeeName} (${adv.empCode}) · ${catLabel}`,
        details: adv.notes || `${adv.paymentMode.toUpperCase()}${adv.transactionId ? ` · Ref ${adv.transactionId}` : ''}`,
        actor: adv.paymentMode.toUpperCase(),
        metricOrAmount: formatINR(amt),
        statusLabel: adv.acknowledged ? 'Acknowledged' : adv.whatsappShared ? 'WhatsApp Sent' : 'Recorded',
      });
    }
  }

  if (allowedCategories.has('expense')) {
    for (const exp of expenses) {
      if (!matchesProject(exp.projectId, exp.towerId)) continue;
      if (!isWithinDateRange(exp.date, fromDate, toDate)) continue;
      countsByCategory.expense += 1;
      const amt = Number(exp.amount) || 0;
      totalSiteExpenseAmount += amt;
      const catLabel = getExpenseCategoryLabel(exp);
      entries.push({
        id: `exp:${exp.id}`,
        date: exp.date,
        category: 'expense',
        categoryLabel: PROJECT_LOG_CATEGORY_LABELS.expense,
        towerName: resolveTowerName(exp.towerId, exp.towerName),
        subject: `${catLabel} — ${exp.description}`,
        details: [exp.vendorName ? `Vendor: ${exp.vendorName}` : '', exp.notes]
          .filter(Boolean)
          .join(' · ') || 'Site expense voucher',
        actor: exp.vendorName || exp.paymentMode.toUpperCase(),
        metricOrAmount: formatINR(amt),
        statusLabel: exp.paymentMode.toUpperCase(),
      });
    }
  }

  if (allowedCategories.has('deployment')) {
    for (const dep of deployments) {
      if (!matchesProject(dep.projectId, dep.towerId)) continue;
      if (!isWithinDateRange(dep.assignedDate, fromDate, toDate)) continue;
      countsByCategory.deployment += 1;
      entries.push({
        id: `dep:${dep.id}`,
        date: dep.assignedDate,
        category: 'deployment',
        categoryLabel: PROJECT_LOG_CATEGORY_LABELS.deployment,
        towerName: resolveTowerName(dep.towerId, dep.towerName),
        subject: `${dep.employeeName} (${dep.empCode})`,
        details: dep.notes || `${dep.employeeRole} deployed to ${dep.towerName}`,
        actor: dep.fromTowerName ? `From ${dep.fromTowerName}` : 'Site Allocation',
        metricOrAmount: dep.employeeRole,
        statusLabel: 'Deployed',
      });
    }
  }

  entries.sort((a, b) => b.date.localeCompare(a.date) || a.categoryLabel.localeCompare(b.categoryLabel));

  return {
    project,
    fromDate,
    toDate,
    totalEntries: entries.length,
    countsByCategory,
    totalAdvanceAmount,
    totalSiteExpenseAmount,
    totalWagesLogged,
    totalWorkSqftLogged,
    towersCovered: projectTowers.map((t) => t.name),
    entries,
  };
}

function escapeCsvCell(value: string | number | undefined | null): string {
  const str = String(value ?? '').replace(/\r?\n/g, ' ');
  if (/[",]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildProjectLogsReportCsv(report: ProjectLogsSummaryReport): string {
  const header = [
    'Project',
    'Date',
    'Log Category',
    'Tower',
    'Subject',
    'Details',
    'Worker / Logged By',
    'Metric / Amount',
    'Status',
  ];

  const rows = report.entries.map((entry) =>
    [
      report.project.name,
      entry.date,
      entry.categoryLabel,
      entry.towerName,
      entry.subject,
      entry.details,
      entry.actor,
      entry.metricOrAmount,
      entry.statusLabel,
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return [header.map(escapeCsvCell).join(','), ...rows].join('\n');
}
