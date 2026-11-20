import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  Building2,
  ClipboardList,
  MessageSquare,
  Phone,
  ReceiptIndianRupee,
  ScrollText,
  SlidersHorizontal,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import type { WhatsappMessagePayload } from '../types/avy';
import {
  DEFAULT_WEEKLY_EXPENSE_BUDGET,
  computeExecutiveSummaryMetrics,
  computeProjectAndTowerExpenses,
  computeTowerAttendanceSummary,
  computeTowerFoodExpenseBreakdown,
  formatBurnAlertWhatsappMessage,
  formatDurationBreakdown,
  formatTowerProjectStatusWhatsappMessage,
} from '../utils/operations';
import {
  computeEmployeePayroll,
  formatAdvanceWhatsappMessage,
  formatINR,
  getAdvanceCategoryLabel,
} from '../utils/payroll';
import {
  calculateFlatProgress,
  getWorkStatusBadgeClass,
  getWorkStatusLabel,
} from '../utils/tileZones';
import {
  getScopedAdvances,
  getScopedAssignments,
  getScopedAttendance,
  getScopedEmployees,
  getScopedExpenses,
  getScopedFlats,
  getScopedProjects,
  getScopedTowers,
  isSupervisorSession,
} from '../utils/authAccess';
import { ExecutiveSummarySection } from './ExecutiveSummarySection';

export type AppSection =
  | 'overview'
  | 'projects'
  | 'workforce'
  | 'payroll'
  | 'expenses'
  | 'sitelogs'
  | 'billing'
  | 'documents';

interface DashboardViewProps {
  onNavigate: (section: AppSection) => void;
  onOpenGiveAdvance: (employeeId?: string) => void;
  onOpenAssignWork: () => void;
  onOpenCompanySettings?: () => void;
  onTriggerWhatsapp: (payload: WhatsappMessagePayload) => void;
}

export function DashboardView({
  onNavigate,
  onOpenGiveAdvance,
  onOpenAssignWork,
  onOpenCompanySettings,
  onTriggerWhatsapp,
}: DashboardViewProps) {
  const {
    session,
    companyProfile,
    projects: allProjects,
    towers: allTowers,
    flats: allFlats,
    employees: allEmployees,
    assignments: allAssignments,
    attendance: allAttendance,
    advances: allAdvances,
    expenses: allExpenses,
    settlements,
    dailySiteLogs: allDailySiteLogs,
  } = useStore();

  const isSupervisor = isSupervisorSession(session);
  const towers = getScopedTowers(session, allTowers);
  const projects = getScopedProjects(session, allProjects, allTowers);
  const flats = getScopedFlats(session, allFlats);
  const employees = getScopedEmployees(session, allEmployees);
  const assignments = getScopedAssignments(session, allAssignments);
  const attendance = getScopedAttendance(session, allAttendance, allEmployees);
  const advances = getScopedAdvances(session, allAdvances, allEmployees);
  const expenses = getScopedExpenses(session, allExpenses);
  const dailySiteLogs = isSupervisor
    ? allDailySiteLogs.filter((l) => towers.some((t) => t.id === l.towerId))
    : allDailySiteLogs;
  const recentSiteLogs = [...dailySiteLogs]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);

  const today = getTodayIso();
  const activeEmployees = employees.filter((e) => e.status === 'active');
  const zoneCatalog = companyProfile?.tileZoneCatalog;
  const companyName = companyProfile?.companyName || 'AVY INFRA';

  let totalZones = 0;
  let completedZones = 0;
  let inProgressZones = 0;
  for (const flat of flats) {
    const prog = calculateFlatProgress(flat, zoneCatalog);
    totalZones += prog.totalZones;
    completedZones += prog.completedCount;
    inProgressZones += prog.inProgressCount;
  }

  const todayPresent = attendance.filter(
    (a) => a.date === today && (a.status === 'present' || a.status === 'half_day')
  ).length;

  const totalNetPayable = activeEmployees.reduce((sum, emp) => {
    const p = computeEmployeePayroll(emp, attendance, advances, settlements);
    return sum + p.netPayable;
  }, 0);

  const expenseBreakdown = computeProjectAndTowerExpenses({
    projects,
    towers,
    employees,
    attendance,
    advances,
    expenses,
  });

  const weeklyExpenseBudget =
    typeof companyProfile?.weeklyExpenseBudget === 'number' &&
    Number.isFinite(companyProfile.weeklyExpenseBudget)
      ? companyProfile.weeklyExpenseBudget
      : DEFAULT_WEEKLY_EXPENSE_BUDGET;

  const execMetrics = useMemo(
    () =>
      computeExecutiveSummaryMetrics({
        projects,
        towers,
        flats,
        employees,
        assignments,
        attendance,
        advances,
        expenses,
        weeklyExpenseBudget,
      }),
    [
      projects,
      towers,
      flats,
      employees,
      assignments,
      attendance,
      advances,
      expenses,
      weeklyExpenseBudget,
    ]
  );

  const [dismissedAlertKey, setDismissedAlertKey] = useState<string | null>(null);
  const burnAlertKey = `${execMetrics.burnBudgetStatus}:${execMetrics.dailyBurnRate}:${execMetrics.weeklyExpenseBudget}:${execMetrics.currentWeekSpend}`;
  const hasActiveBudgetNotice =
    execMetrics.burnBudgetStatus === 'exceeded' || execMetrics.burnBudgetStatus === 'warning';
  const showBurnAlertBanner = hasActiveBudgetNotice && dismissedAlertKey !== burnAlertKey;

  const handleNotifyBurnAlert = () => {
    const scopeLabel = isSupervisor
      ? towers.map((t) => t.name).join(', ') || 'Assigned Tower Scope'
      : 'All Projects';
    onTriggerWhatsapp({
      title: 'Send Expense Burn Rate Alert (WhatsApp / Email)',
      recipientName: `Accounts & Project Management (${companyName})`,
      recipientPhone: companyProfile?.hrContact || '',
      recipientEmail: companyProfile?.hrEmail || '',
      emailSubject: `[ALERT] ${companyName} Expense Burn Rate Exceeded Weekly Budget (${today})`,
      message: formatBurnAlertWhatsappMessage({
        companyName,
        scopeLabel,
        metrics: execMetrics,
      }),
    });
  };

  const recentAssignments = [...assignments]
    .sort((a, b) => b.assignedDate.localeCompare(a.assignedDate) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  const recentAdvances = [...advances]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const handleResendAdvanceWhatsapp = (advId: string) => {
    const adv = advances.find((a) => a.id === advId);
    const emp = employees.find((e) => e.id === adv?.employeeId);
    if (!adv || !emp) return;
    const payroll = computeEmployeePayroll(emp, attendance, advances, settlements);
    onTriggerWhatsapp({
      title: 'Send Advance Receipt (WhatsApp / Email)',
      recipientName: `${emp.fullName} (${emp.empCode})`,
      recipientPhone: emp.phone,
      recipientEmail: emp.email || '',
      emailSubject: `${companyName} Advance Receipt — ${adv.date}`,
      message: formatAdvanceWhatsappMessage(adv, payroll.netPayable, companyName),
      advanceId: adv.id,
    });
  };

  const handleShareTowerDailyStatus = (
    towerId: string,
    role: 'supervisor' | 'engineer' | 'manager' | 'incharge'
  ) => {
    const tower = towers.find((t) => t.id === towerId);
    const project = projects.find((p) => p.id === tower?.projectId);
    if (!tower || !project) return;

    const towerFlats = flats.filter((f) => f.towerId === tower.id);
    let tTotal = 0;
    let tDone = 0;
    let tRun = 0;
    for (const fl of towerFlats) {
      const pr = calculateFlatProgress(fl, zoneCatalog);
      tTotal += pr.totalZones;
      tDone += pr.completedCount;
      tRun += pr.inProgressCount;
    }

    const attSum = computeTowerAttendanceSummary({
      date: today,
      projectId: project.id,
      towerId: tower.id,
      employees,
      attendance,
    });
    const foodSum = computeTowerFoodExpenseBreakdown({
      referenceDate: today,
      advances,
      employees,
      projectId: project.id,
      towerId: tower.id,
    });
    const expRow = expenseBreakdown.towerRows.find((r) => r.tower.id === tower.id);
    const dur = formatDurationBreakdown(
      tower.startDate || project.startDate,
      tower.finishDate || project.finishDate,
      today
    );

    const roleContact =
      role === 'supervisor'
        ? { name: tower.supervisorName || 'Tower Supervisor', phone: tower.supervisorPhone || '' }
        : role === 'incharge'
          ? { name: tower.inchargeName || 'Tower Incharge', phone: tower.inchargePhone || '' }
          : role === 'engineer'
            ? {
                name: tower.engineerName || project.engineerName || 'Site Engineer',
                phone: tower.engineerPhone || project.engineerPhone || '',
              }
            : {
                name: tower.managerName || project.managerName || 'Project Manager',
                phone: tower.managerPhone || project.managerPhone || '',
              };

    const message = formatTowerProjectStatusWhatsappMessage({
      companyName,
      project,
      tower,
      flatsCount: towerFlats.length,
      completedZones: tDone,
      totalZones: tTotal,
      inProgressZones: tRun,
      attendanceSummary: attSum,
      foodDaily: foodSum.dailyFoodTotal,
      foodMonthly: foodSum.monthlyFoodTotal,
      totalTowerExpense: expRow?.totalExpenseCost || 0,
      durationLabel: dur.label,
    });

    onTriggerWhatsapp({
      title: `Share ${tower.name} Daily Status (${role.toUpperCase()})`,
      recipientName: `${roleContact.name} — ${project.name} / ${tower.name}`,
      recipientPhone: roleContact.phone,
      recipientEmail: companyProfile?.hrEmail || '',
      emailSubject: `${companyName} Tower Daily Status — ${project.name} / ${tower.name} (${today})`,
      message,
    });
  };

  return (
    <div className="space-y-8">
      {/* Page Intro + Primary Action Strip */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 text-balance">
            {isSupervisor ? 'Assigned Tower Operations Overview' : 'Site Operations Overview'}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {isSupervisor
              ? `Live view for your assigned tower crew (${activeEmployees.length} workers): daily attendance, flat work allotment, food & site expenses.`
              : `Live database view of tower-wise daily attendance, flat tile laying, food expenses, and project timelines across ${companyName}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {hasActiveBudgetNotice && !showBurnAlertBanner && (
            <button
              type="button"
              onClick={() => setDismissedAlertKey(null)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border whitespace-nowrap ${
                execMetrics.burnBudgetStatus === 'exceeded'
                  ? 'bg-red-50 text-red-800 border-red-300 hover:bg-red-100'
                  : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
              }`}
            >
              <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
              <span>1 Burn Alert Active</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('sitelogs')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <ScrollText className="w-4 h-4 text-orange-700" aria-hidden="true" />
            <span>Daily Site Log</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('expenses')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <ReceiptIndianRupee className="w-4 h-4 text-orange-700" aria-hidden="true" />
            <span>Expenses &amp; Timelines</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('payroll')}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            Mark Attendance
          </button>
          <button
            type="button"
            onClick={onOpenAssignWork}
            className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 transition-colors whitespace-nowrap"
          >
            Assign Flat Work
          </button>
        </div>
      </div>

      {/* Expense Burn Rate Threshold Notification System */}
      {showBurnAlertBanner && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="burn-rate-alert-banner"
          className={`rounded-lg border p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-sm ${
            execMetrics.burnBudgetStatus === 'exceeded'
              ? 'bg-red-50 border-red-300 text-red-950'
              : 'bg-amber-50 border-amber-300 text-amber-950'
          }`}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`p-2 rounded-md shrink-0 mt-0.5 ${
                execMetrics.burnBudgetStatus === 'exceeded'
                  ? 'bg-red-100 text-red-700 border border-red-200'
                  : 'bg-amber-100 text-amber-800 border border-amber-200'
              }`}
            >
              {execMetrics.burnBudgetStatus === 'exceeded' ? (
                <BellRing className="w-5 h-5" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              )}
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">
                  {execMetrics.burnBudgetStatus === 'exceeded'
                    ? 'Budget Threshold Alert: Expense Burn Rate Exceeds Weekly Budget'
                    : 'Budget Watch: Expense Burn Rate Approaching Weekly Limit'}
                </span>
                <span
                  className={`px-2 py-0.5 text-[11px] font-mono font-bold rounded border ${
                    execMetrics.burnBudgetStatus === 'exceeded'
                      ? 'bg-white text-red-800 border-red-300'
                      : 'bg-white text-amber-900 border-amber-300'
                  }`}
                >
                  {execMetrics.burnPaceRatioPct}% of Weekly Budget
                </span>
              </div>
              <p className="text-xs leading-relaxed">
                Current daily burn rate is{' '}
                <strong className="font-mono">{formatINR(execMetrics.dailyBurnRate)}/active day</strong>{' '}
                (projected 7-day pace{' '}
                <strong className="font-mono">{formatINR(execMetrics.projectedWeeklyBurn)}/wk</strong>) against the
                configured weekly budget of{' '}
                <strong className="font-mono">{formatINR(execMetrics.weeklyExpenseBudget)}/wk</strong>{' '}
                (daily threshold{' '}
                <strong className="font-mono">{formatINR(execMetrics.dailyBurnThreshold)}/day</strong>).{' '}
                {execMetrics.projectedWeeklyExcess > 0 && (
                  <span>
                    Projected weekly overrun:{' '}
                    <strong className="font-mono text-red-800">
                      +{formatINR(execMetrics.projectedWeeklyExcess)}
                    </strong>{' '}
                    ({execMetrics.burnThresholdVariancePct > 0 ? `+${execMetrics.burnThresholdVariancePct}%` : ''}{' '}
                    above daily pace).{' '}
                  </span>
                )}
                Actual spend this week ({execMetrics.currentWeekStart} to {execMetrics.currentWeekEnd}):{' '}
                <strong className="font-mono">{formatINR(execMetrics.currentWeekSpend)}</strong>
                {execMetrics.weeklyActualExcess > 0 && (
                  <span className="font-mono font-semibold text-red-800">
                    {' '}
                    (+{formatINR(execMetrics.weeklyActualExcess)} actual overrun)
                  </span>
                )}
                .
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('expenses')}
              className="px-3 py-1.5 text-xs font-semibold bg-white text-slate-900 border border-slate-300 rounded-md hover:bg-slate-100 whitespace-nowrap"
            >
              Inspect Expenses
            </button>
            {!isSupervisor && onOpenCompanySettings && (
              <button
                type="button"
                onClick={onOpenCompanySettings}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white text-slate-900 border border-slate-300 rounded-md hover:bg-slate-100 whitespace-nowrap"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Adjust Weekly Budget</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleNotifyBurnAlert}
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white rounded-md whitespace-nowrap ${
                execMetrics.burnBudgetStatus === 'exceeded'
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-amber-700 hover:bg-amber-800'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Notify PM / Accounts</span>
            </button>
            <button
              type="button"
              onClick={() => setDismissedAlertKey(burnAlertKey)}
              aria-label="Dismiss burn rate alert"
              className="p-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-white/70"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Executive Summary (D3 KPIs & Interactive Charts) */}
      <ExecutiveSummarySection
        projects={projects}
        towers={towers}
        flats={flats}
        employees={employees}
        assignments={assignments}
        attendance={attendance}
        advances={advances}
        expenses={expenses}
        weeklyExpenseBudget={weeklyExpenseBudget}
        metricsOverride={execMetrics}
        isSupervisor={isSupervisor}
        onOpenBudgetSettings={onOpenCompanySettings}
      />

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Flats Tracked</span>
            <Building2 className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {flats.length}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {projects.length} projects · {towers.length} towers
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Tile Zones Completed</span>
            <ClipboardList className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {completedZones} <span className="text-sm font-normal text-slate-500">/ {totalZones}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {inProgressZones} zones actively in progress
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Today&apos;s Attendance</span>
            <Users className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {todayPresent} <span className="text-sm font-normal text-slate-500">/ {activeEmployees.length}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {today} · Active crew on site
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Net Payable Balance</span>
            <Wallet className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatINR(totalNetPayable)}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Total Site Spend: {formatINR(expenseBreakdown.grandTotal)}
          </p>
        </div>
      </div>

      {/* Live Tower-Wise Daily Status Board (From Live Database) */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Tower-Wise Daily Status Board ({today})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live attendance, tile laying progress, food expenses, duration, and 1-click WhatsApp status sharing to Supervisors, Engineers &amp; Managers.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('projects')}
            className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 hover:text-orange-800 whitespace-nowrap"
          >
            <span>Manage Towers &amp; Contacts</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {towers.length === 0 ? (
          <p className="py-6 text-sm text-slate-500">No towers configured yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {towers.map((tower) => {
              const project = projects.find((p) => p.id === tower.projectId);
              const towerFlats = flats.filter((f) => f.towerId === tower.id);
              let tTotal = 0;
              let tDone = 0;
              for (const fl of towerFlats) {
                const pr = calculateFlatProgress(fl, zoneCatalog);
                tTotal += pr.totalZones;
                tDone += pr.completedCount;
              }
              const pct = tTotal > 0 ? Math.round((tDone / tTotal) * 100) : 0;

              const attSum = computeTowerAttendanceSummary({
                date: today,
                projectId: tower.projectId,
                towerId: tower.id,
                employees,
                attendance,
              });
              const foodSum = computeTowerFoodExpenseBreakdown({
                referenceDate: today,
                advances,
                employees,
                projectId: tower.projectId,
                towerId: tower.id,
              });
              const expRow = expenseBreakdown.towerRows.find((r) => r.tower.id === tower.id);
              const dur = formatDurationBreakdown(
                tower.startDate || project?.startDate,
                tower.finishDate || project?.finishDate,
                today
              );

              return (
                <div
                  key={tower.id}
                  className="p-4 bg-slate-50/60 border border-slate-200 rounded-lg space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {project?.name || 'Project'} — {tower.name}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 font-mono">
                        Duration: {dur.label}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 text-xs font-mono font-semibold bg-white border border-slate-200 rounded text-slate-900 shrink-0">
                      {pct}% Tiles
                    </span>
                  </div>

                  <div className="h-1.5 w-full bg-slate-200 rounded-sm overflow-hidden">
                    <div
                      className="h-full bg-orange-700 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2 bg-white border border-slate-200 rounded">
                      <div className="text-[10px] text-slate-500">Today Attendance</div>
                      <div className="font-mono font-semibold text-slate-900 mt-0.5">
                        <span className="text-emerald-700">{attSum.presentCount}P</span> /{' '}
                        <span className="text-amber-700">{attSum.halfDayCount}H</span> /{' '}
                        <span className="text-red-700">{attSum.absentCount}A</span>
                      </div>
                    </div>
                    <div className="p-2 bg-white border border-slate-200 rounded">
                      <div className="text-[10px] text-slate-500">Food (Day / Month)</div>
                      <div className="font-mono font-semibold text-slate-900 mt-0.5 truncate">
                        {formatINR(foodSum.dailyFoodTotal)} / {formatINR(foodSum.monthlyFoodTotal)}
                      </div>
                    </div>
                    <div className="p-2 bg-white border border-slate-200 rounded">
                      <div className="text-[10px] text-slate-500">Total Tower Cost</div>
                      <div className="font-mono font-semibold text-slate-900 mt-0.5">
                        {formatINR(expRow?.totalExpenseCost || 0)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 text-[11px] text-slate-600">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {tower.supervisorName && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" aria-hidden="true" />
                          Sup: <strong className="text-slate-800">{tower.supervisorName}</strong>
                        </span>
                      )}
                      {(tower.engineerName || project?.engineerName) && (
                        <span>
                          Eng:{' '}
                          <strong className="text-slate-800">
                            {tower.engineerName || project?.engineerName}
                          </strong>
                        </span>
                      )}
                    </div>

                    <div className="inline-flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleShareTowerDailyStatus(tower.id, 'supervisor')}
                        className="inline-flex items-center gap-1 px-2 py-1 font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                      >
                        <MessageSquare className="w-3 h-3" aria-hidden="true" />
                        <span>WA Supervisor</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleShareTowerDailyStatus(tower.id, 'engineer')}
                        className="inline-flex items-center gap-1 px-2 py-1 font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100"
                      >
                        <span>WA Eng/PM</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent Assignments & Recent Advances */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">Recent Work Assignment History</h2>
            <button
              type="button"
              onClick={() => onNavigate('payroll')}
              className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 hover:text-orange-800 whitespace-nowrap"
            >
              <span>Full History</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pr-3">Date &amp; Duration</th>
                  <th className="py-2.5 px-3">Unit &amp; Room</th>
                  <th className="py-2.5 px-3">Employee</th>
                  <th className="py-2.5 pl-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {recentAssignments.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      No work assignments recorded yet.
                    </td>
                  </tr>
                ) : (
                  recentAssignments.map((asgn) => {
                    const dur = formatDurationBreakdown(asgn.assignedDate, asgn.completedDate, today);
                    return (
                      <tr key={asgn.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 pr-3 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                          <div>{asgn.assignedDate}</div>
                          <div className="text-[10px] text-slate-500">{dur.compactLabel}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-900">
                            Flat {asgn.unitNumber} · {asgn.zoneLabel}
                          </div>
                          <div className="text-xs text-slate-500">
                            {asgn.projectName} / {asgn.towerName}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="text-slate-900 font-medium">{asgn.employeeName}</div>
                          <div className="text-xs font-mono text-slate-500">
                            {asgn.empCode} · {asgn.employeeRole}
                          </div>
                        </td>
                        <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${getWorkStatusBadgeClass(
                              asgn.status
                            )}`}
                          >
                            {getWorkStatusLabel(asgn.status)}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Recent Food &amp; Cash Advances</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Sunday weekly food runs &amp; instant WhatsApp receipts
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenGiveAdvance()}
              className="text-xs font-semibold text-orange-700 hover:text-orange-800 whitespace-nowrap"
            >
              + Record
            </button>
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 px-2">Employee</th>
                  <th className="py-2 px-2 text-right">Amount</th>
                  <th className="py-2 pl-2 text-right">WA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {recentAdvances.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      No advances recorded yet.
                    </td>
                  </tr>
                ) : (
                  recentAdvances.map((adv) => (
                    <tr key={adv.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 pr-2 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {adv.date}
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="font-medium text-slate-900">{adv.employeeName}</div>
                        <div className="text-[11px] text-slate-500">
                          {getAdvanceCategoryLabel(adv)}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {formatINR(adv.amount)}
                      </td>
                      <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleResendAdvanceWhatsapp(adv.id)}
                          aria-label={`Send WhatsApp advance message to ${adv.employeeName}`}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 transition-colors"
                        >
                          <MessageSquare className="w-3 h-3" aria-hidden="true" />
                          <span>{adv.whatsappShared ? 'Resent' : 'Send'}</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Latest Daily Site Logs */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Recent Daily Site Logs</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tower-level daily field observations, inspection notes, and site photos posted by supervisors
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('sitelogs')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:text-orange-800 whitespace-nowrap"
          >
            <span>Open Daily Site Log ({dailySiteLogs.length})</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {recentSiteLogs.length === 0 ? (
          <p className="text-sm text-slate-500">
            No daily site logs recorded yet. Open Daily Site Log to post today&apos;s tower note &amp; photo.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recentSiteLogs.map((log) => (
              <div
                key={log.id}
                className="p-3.5 bg-slate-50/70 border border-slate-200 rounded-md space-y-2"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-semibold text-slate-700">{log.date}</span>
                  <span className="px-2 py-0.5 text-[11px] font-medium bg-white border border-slate-200 rounded text-slate-700 truncate">
                    {log.towerName}
                  </span>
                </div>
                <p className="text-xs text-slate-700 line-clamp-3">{log.notes}</p>
                <div className="text-[11px] text-slate-500 flex items-center justify-between">
                  <span className="truncate">{log.projectName}</span>
                  <span className="font-medium text-slate-700 shrink-0">{log.loggedByName}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
