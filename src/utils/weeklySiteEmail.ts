import type {
  AdvanceEntry,
  AttendanceRecord,
  CompanyProfile,
  DailySiteLog,
  FlatUnit,
  Project,
  SiteExpense,
  TileZoneDefinition,
  Tower,
} from '../types/avy';
import { formatINR } from './payroll';
import { computeProjectCompletionSeries } from './operations';

export interface WeeklySiteEmailMetrics {
  projectId: string;
  projectName: string;
  location: string;
  weekStart: string;
  weekEnd: string;
  completionPct: number;
  completedZones: number;
  totalZones: number;
  completedFlats: number;
  totalFlats: number;
  siteLogCount: number;
  siteLogEntries: Array<{
    date: string;
    towerName: string;
    loggedByName: string;
    notes: string;
  }>;
  attendanceRecordsCount: number;
  presentDaysCount: number;
  halfDaysCount: number;
  wagesEarned: number;
  overtimeEarned: number;
  foodAdvancesTotal: number;
  otherAdvancesTotal: number;
  totalAdvances: number;
  siteExpensesTotal: number;
  siteExpensesCount: number;
  expenseByCategory: Array<{ category: string; amount: number }>;
  totalWeeklyCost: number;
}

export interface WeeklySitePerformanceEmailDraft {
  recipientEmail: string;
  subject: string;
  body: string;
  mailtoUrl: string;
  whatsappMessage: string;
  metrics: WeeklySiteEmailMetrics;
}

export function buildWeeklySitePerformanceReport(params: {
  project: Project;
  towers: Tower[];
  flats: FlatUnit[];
  dailySiteLogs: DailySiteLog[];
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  expenses: SiteExpense[];
  companyProfile: CompanyProfile;
  weekStart: string;
  weekEnd: string;
  recipientEmail?: string;
  tileZoneCatalog?: TileZoneDefinition[];
}): WeeklySitePerformanceEmailDraft {
  const {
    project,
    towers,
    flats,
    dailySiteLogs,
    attendance,
    advances,
    expenses,
    companyProfile,
    weekStart,
    weekEnd,
    tileZoneCatalog,
  } = params;

  const projectTowers = towers.filter((t) => t.projectId === project.id);
  const projectTowerIds = new Set(projectTowers.map((t) => t.id));

  const completionRows = computeProjectCompletionSeries({
    projects: [project],
    towers: projectTowers,
    flats,
    tileZoneCatalog,
    onlyActive: false,
  });
  const completion = completionRows[0] || {
    completionPct: 0,
    completedZones: 0,
    totalZones: 0,
    completedFlats: 0,
    totalFlats: 0,
  };

  const inRange = (d?: string) => Boolean(d && d >= weekStart && d <= weekEnd);

  const siteLogs = dailySiteLogs
    .filter(
      (log) =>
        (log.projectId === project.id || projectTowerIds.has(log.towerId)) &&
        inRange(log.date)
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const siteAttendance = attendance.filter(
    (rec) =>
      (rec.projectId === project.id || (rec.towerId && projectTowerIds.has(rec.towerId))) &&
      inRange(rec.date)
  );

  let presentDaysCount = 0;
  let halfDaysCount = 0;
  let wagesEarned = 0;
  let overtimeEarned = 0;
  for (const rec of siteAttendance) {
    if (rec.status === 'present') presentDaysCount += 1;
    if (rec.status === 'half_day') halfDaysCount += 1;
    wagesEarned += Number(rec.dailyWageEarned) || 0;
    overtimeEarned += Number(rec.overtimePayEarned) || 0;
  }

  const siteAdvances = advances.filter(
    (adv) =>
      (adv.projectId === project.id || (adv.towerId && projectTowerIds.has(adv.towerId))) &&
      adv.approvalStatus !== 'rejected' &&
      inRange(adv.date)
  );

  let foodAdvancesTotal = 0;
  let otherAdvancesTotal = 0;
  for (const adv of siteAdvances) {
    const amt = Number(adv.amount) || 0;
    if (adv.advanceType === 'daily_food' || adv.advanceType === 'weekly_food') {
      foodAdvancesTotal += amt;
    } else {
      otherAdvancesTotal += amt;
    }
  }
  const totalAdvances = foodAdvancesTotal + otherAdvancesTotal;

  const siteExpenses = expenses.filter(
    (exp) =>
      (exp.projectId === project.id || (exp.towerId && projectTowerIds.has(exp.towerId))) &&
      inRange(exp.date)
  );

  let siteExpensesTotal = 0;
  const catMap = new Map<string, number>();
  for (const exp of siteExpenses) {
    const amt = Number(exp.amount) || 0;
    siteExpensesTotal += amt;
    const label =
      exp.category === 'custom' && exp.customCategory?.trim()
        ? exp.customCategory.trim()
        : exp.category.replace(/_/g, ' ');
    catMap.set(label, (catMap.get(label) || 0) + amt);
  }
  const expenseByCategory = Array.from(catMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const totalWeeklyCost = wagesEarned + overtimeEarned + totalAdvances + siteExpensesTotal;

  const metrics: WeeklySiteEmailMetrics = {
    projectId: project.id,
    projectName: project.name,
    location: project.location,
    weekStart,
    weekEnd,
    completionPct: completion.completionPct,
    completedZones: completion.completedZones,
    totalZones: completion.totalZones,
    completedFlats: completion.completedFlats,
    totalFlats: completion.totalFlats,
    siteLogCount: siteLogs.length,
    siteLogEntries: siteLogs.map((l) => ({
      date: l.date,
      towerName: l.towerName,
      loggedByName: l.loggedByName,
      notes: l.notes,
    })),
    attendanceRecordsCount: siteAttendance.length,
    presentDaysCount,
    halfDaysCount,
    wagesEarned,
    overtimeEarned,
    foodAdvancesTotal,
    otherAdvancesTotal,
    totalAdvances,
    siteExpensesTotal,
    siteExpensesCount: siteExpenses.length,
    expenseByCategory,
    totalWeeklyCost,
  };

  const recipientEmail = (params.recipientEmail || companyProfile.hrEmail || '').trim();
  const subject = `[${companyProfile.companyName}] Weekly Performance & Expense Summary — ${project.name} (${weekStart} to ${weekEnd})`;

  const lines: string[] = [
    `${companyProfile.companyName} — Weekly Site Performance & Expense Summary`,
    `Project Site: ${project.name} (${project.location || 'Site'})`,
    `Client: ${project.clientName || 'N/A'}`,
    `Reporting Week: ${weekStart} to ${weekEnd}`,
    ``,
    `1. TILE COMPLETION & WORK PROGRESS`,
    `- Overall Tile Completion: ${metrics.completionPct}% (${metrics.completedZones}/${metrics.totalZones} zones completed)`,
    `- Completed Flats: ${metrics.completedFlats} / ${metrics.totalFlats} flats`,
    `- Towers Covered: ${projectTowers.map((t) => t.name).join(', ') || 'None'}`,
    ``,
    `2. PAYROLL, ATTENDANCE & ADVANCES (FROM PAYROLL)`,
    `- Attendance Logged: ${metrics.attendanceRecordsCount} entries (${metrics.presentDaysCount} Present, ${metrics.halfDaysCount} Half-Day)`,
    `- Base Wages Earned: ${formatINR(metrics.wagesEarned)}`,
    `- Overtime Pay Earned: ${formatINR(metrics.overtimeEarned)}`,
    `- Food Advances Disbursed: ${formatINR(metrics.foodAdvancesTotal)}`,
    `- Other / Cash Advances: ${formatINR(metrics.otherAdvancesTotal)}`,
    `- Total Advances: ${formatINR(metrics.totalAdvances)}`,
    ``,
    `3. SITE EXPENSES (FROM EXPENSE LEDGER)`,
    `- Site Expenses Logged: ${metrics.siteExpensesCount} entries (${formatINR(metrics.siteExpensesTotal)})`,
  ];

  if (expenseByCategory.length > 0) {
    for (const c of expenseByCategory) {
      lines.push(`  • ${c.category}: ${formatINR(c.amount)}`);
    }
  } else {
    lines.push(`  • No site material/mess expenses recorded in this window.`);
  }

  lines.push(``);
  lines.push(`TOTAL WEEKLY SITE OUTFLOW (Wages + OT + Advances + Expenses): ${formatINR(metrics.totalWeeklyCost)}`);
  lines.push(``);
  lines.push(`4. DAILY SITE LOG HIGHLIGHTS (${siteLogs.length} entries)`);

  if (siteLogs.length > 0) {
    for (const log of siteLogs.slice(0, 12)) {
      lines.push(`- [${log.date}] ${log.towerName} (${log.loggedByName}): ${log.notes}`);
    }
    if (siteLogs.length > 12) {
      lines.push(`  ...and ${siteLogs.length - 12} more log entries.`);
    }
  } else {
    lines.push(`- No daily site logs recorded for ${weekStart} to ${weekEnd}.`);
  }

  lines.push(``);
  lines.push(`Generated by ${companyProfile.signatoryName || companyProfile.companyName} · ${companyProfile.hrContact}`);

  const body = lines.join('\n');
  const mailtoUrl = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const whatsappMessage = [
    `*${companyProfile.companyName} — Weekly Site Summary*`,
    `Site: *${project.name}* (${weekStart} to ${weekEnd})`,
    `Completion: *${metrics.completionPct}%* (${metrics.completedZones}/${metrics.totalZones} zones)`,
    `Attendance: ${metrics.presentDaysCount} Present · ${metrics.halfDaysCount} Half-Day`,
    `Wages + OT: ${formatINR(metrics.wagesEarned + metrics.overtimeEarned)}`,
    `Food Advances: ${formatINR(metrics.foodAdvancesTotal)} | Other Adv: ${formatINR(metrics.otherAdvancesTotal)}`,
    `Site Expenses: ${formatINR(metrics.siteExpensesTotal)}`,
    `*Total Weekly Outflow:* ${formatINR(metrics.totalWeeklyCost)}`,
    `Daily Site Logs: ${metrics.siteLogCount} logged`,
  ].join('\n');

  return {
    recipientEmail,
    subject,
    body,
    mailtoUrl,
    whatsappMessage,
    metrics,
  };
}
