import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  MessageSquare,
  Plus,
  ReceiptIndianRupee,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import type { ExpenseCategory, PaymentMode, WhatsappMessagePayload } from '../types/avy';
import {
  getScopedAdvances,
  getScopedAttendance,
  getScopedEmployees,
  getScopedExpenses,
  getScopedFlats,
  getScopedProjects,
  getScopedTowers,
  isAdminSession,
  isSupervisorSession,
} from '../utils/authAccess';
import { buildExpenseReportPdfBlob } from '../utils/idCardPdf';
import {
  EXPENSE_CATEGORY_LABELS,
  computeProjectAndTowerExpenses,
  computeTowerAttendanceSummary,
  computeTowerFoodExpenseBreakdown,
  formatDurationBreakdown,
  formatTowerProjectStatusWhatsappMessage,
  getExpenseCategoryLabel,
} from '../utils/operations';
import { buildWhatsappUrl, formatINR, sanitizeWhatsappPhone } from '../utils/payroll';
import {
  DEFAULT_FOOD_FOLLOWUP_TEMPLATE,
  buildFoodAdvanceFollowUpMessage,
  computeWeeklyFoodFollowUpSummary,
  formatElapsedDurationLabel,
  loadFoodFollowUpSettings,
  saveFoodFollowUpSettings,
  type EvaluatedWeeklyFoodAdvance,
  type FoodFollowUpSettings,
} from '../utils/foodFollowUp';
import { calculateFlatProgress } from '../utils/tileZones';
import {
  ImageProofLightboxModal,
  type ProofLightboxPayload,
} from './ImageProofLightboxModal';
import { PaymentProofUploadBox, type PaymentProofState } from './PaymentProofUploadBox';

interface ExpensesReportsViewProps {
  onTriggerWhatsapp: (payload: WhatsappMessagePayload) => void;
  onOpenCompanySettings?: () => void;
}

export function ExpensesReportsView({
  onTriggerWhatsapp,
  onOpenCompanySettings,
}: ExpensesReportsViewProps) {
  const {
    session,
    companyProfile,
    projects: rawProjects,
    towers: rawTowers,
    flats: rawFlats,
    employees: rawEmployees,
    attendance: rawAttendance,
    advances: rawAdvances,
    expenses: rawExpenses,
    addExpense,
    deleteExpense,
    updateCompanyProfile,
    acknowledgeAdvance,
    recordAdvanceFollowUpSent,
  } = useStore();

  const isAdmin = isAdminSession(session);
  const isSupervisor = isSupervisorSession(session);

  const projects = useMemo(
    () => getScopedProjects(session, rawProjects, rawTowers),
    [session, rawProjects, rawTowers]
  );
  const towers = useMemo(() => getScopedTowers(session, rawTowers), [session, rawTowers]);
  const flats = useMemo(() => getScopedFlats(session, rawFlats), [session, rawFlats]);
  const employees = useMemo(
    () => getScopedEmployees(session, rawEmployees),
    [session, rawEmployees]
  );
  const attendance = useMemo(
    () => getScopedAttendance(session, rawAttendance, rawEmployees),
    [session, rawAttendance, rawEmployees]
  );
  const advances = useMemo(
    () => getScopedAdvances(session, rawAdvances, rawEmployees),
    [session, rawAdvances, rawEmployees]
  );
  const expenses = useMemo(() => getScopedExpenses(session, rawExpenses), [session, rawExpenses]);

  const companyName = companyProfile?.companyName || 'AVY INFRA';
  const today = getTodayIso();

  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [filterProjectId, setFilterProjectId] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [proofLightbox, setProofLightbox] = useState<ProofLightboxPayload | null>(null);

  // Weekly Food 24h Acknowledgment & Automated WhatsApp Follow-Up State
  const [followUpSettings, setFollowUpSettings] = useState<FoodFollowUpSettings>(() =>
    loadFoodFollowUpSettings()
  );
  const [followUpClockMs, setFollowUpClockMs] = useState<number>(() => Date.now());
  const [foodFollowUpFilter, setFoodFollowUpFilter] = useState<
    'all' | 'overdue' | 'within_window' | 'acknowledged'
  >('all');
  const [showFollowUpSettings, setShowFollowUpSettings] = useState(false);
  const [ackingAdvanceId, setAckingAdvanceId] = useState<string | null>(null);
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [queueAdvanceIds, setQueueAdvanceIds] = useState<string[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [queueDraftMessage, setQueueDraftMessage] = useState('');
  const [queueDispatchedCount, setQueueDispatchedCount] = useState(0);

  const updateFollowUpSettings = (
    updater: (prev: FoodFollowUpSettings) => FoodFollowUpSettings
  ) => {
    setFollowUpSettings((prev) => {
      const next = updater(prev);
      saveFoodFollowUpSettings(next);
      return next;
    });
  };

  useEffect(() => {
    if (!followUpSettings.autoMonitorEnabled) return;
    const sweepIso = new Date().toISOString();
    setFollowUpClockMs(Date.now());
    setFollowUpSettings((prev) => {
      const next = { ...prev, lastAutoSweepAt: sweepIso };
      saveFoodFollowUpSettings(next);
      return next;
    });
    const timer = window.setInterval(() => {
      const now = Date.now();
      setFollowUpClockMs(now);
      setFollowUpSettings((prev) => {
        const next = { ...prev, lastAutoSweepAt: new Date(now).toISOString() };
        saveFoodFollowUpSettings(next);
        return next;
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [followUpSettings.autoMonitorEnabled]);

  const scopedWeeklyFoodAdvances = useMemo(
    () =>
      advances.filter((adv) => {
        if (adv.advanceType !== 'weekly_food') return false;
        if (filterProjectId !== 'all') {
          const emp = employees.find((e) => e.id === adv.employeeId);
          const projId = adv.projectId || emp?.currentProjectId || '';
          if (projId !== filterProjectId) return false;
        }
        if (dateStart && adv.date < dateStart) return false;
        if (dateEnd && adv.date > dateEnd) return false;
        return true;
      }),
    [advances, employees, filterProjectId, dateStart, dateEnd]
  );

  const weeklyFoodSummary = useMemo(
    () =>
      computeWeeklyFoodFollowUpSummary(scopedWeeklyFoodAdvances, followUpClockMs, {
        thresholdHours: followUpSettings.thresholdHours,
        cooldownHours: followUpSettings.cooldownHours,
      }),
    [
      scopedWeeklyFoodAdvances,
      followUpClockMs,
      followUpSettings.thresholdHours,
      followUpSettings.cooldownHours,
    ]
  );

  const visibleFoodFollowUpRows = useMemo(() => {
    if (foodFollowUpFilter === 'overdue') return weeklyFoodSummary.overdueRows;
    if (foodFollowUpFilter === 'within_window') return weeklyFoodSummary.withinWindowRows;
    if (foodFollowUpFilter === 'acknowledged') return weeklyFoodSummary.acknowledgedRows;
    return weeklyFoodSummary.allRows;
  }, [foodFollowUpFilter, weeklyFoodSummary]);

  const activeQueueRow: EvaluatedWeeklyFoodAdvance | null = useMemo(() => {
    if (!queueModalOpen || queueIndex >= queueAdvanceIds.length) return null;
    const targetId = queueAdvanceIds[queueIndex];
    return weeklyFoodSummary.allRows.find((r) => r.advance.id === targetId) || null;
  }, [queueModalOpen, queueIndex, queueAdvanceIds, weeklyFoodSummary.allRows]);

  useEffect(() => {
    if (activeQueueRow) {
      setQueueDraftMessage(
        buildFoodAdvanceFollowUpMessage(activeQueueRow.advance, {
          companyName,
          elapsedHours: activeQueueRow.elapsedHours,
          template: followUpSettings.template,
        })
      );
    }
  }, [activeQueueRow, companyName, followUpSettings.template]);

  const handleRunManual24hScan = () => {
    const now = Date.now();
    setFollowUpClockMs(now);
    updateFollowUpSettings((prev) => ({
      ...prev,
      lastAutoSweepAt: new Date(now).toISOString(),
    }));
  };

  const handleOpenFollowUpQueue = () => {
    const ids = weeklyFoodSummary.dueNowRows.map((r) => r.advance.id);
    if (ids.length === 0) return;
    setQueueAdvanceIds(ids);
    setQueueIndex(0);
    setQueueDispatchedCount(0);
    setQueueModalOpen(true);
  };

  const handleOpenSinglePreviewFollowUp = (row: EvaluatedWeeklyFoodAdvance) => {
    const emp = employees.find((e) => e.id === row.advance.employeeId);
    const phone = row.advance.employeePhone || emp?.phone || '';
    const msg = buildFoodAdvanceFollowUpMessage(row.advance, {
      companyName,
      elapsedHours: row.elapsedHours,
      template: followUpSettings.template,
    });
    onTriggerWhatsapp({
      title: `WhatsApp 24h Follow-Up — ${row.advance.employeeName}`,
      recipientName: `${row.advance.employeeName} (${row.advance.empCode})`,
      recipientPhone: phone,
      recipientEmail: emp?.email || '',
      emailSubject: `${companyName} Weekly Food Advance Acknowledgment Reminder (${row.advance.date})`,
      message: msg,
      followUpAdvanceId: row.advance.id,
    });
  };

  const customExpensePresets = useMemo(() => {
    const set = new Set<string>(companyProfile?.customExpenseCategories || []);
    for (const exp of expenses) {
      if (exp.category === 'custom' && exp.customCategory?.trim()) {
        set.add(exp.customCategory.trim());
      }
    }
    return Array.from(set).sort();
  }, [companyProfile?.customExpenseCategories, expenses]);

  // Add Expense Modal
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expDate, setExpDate] = useState(today);
  const [expProjectId, setExpProjectId] = useState(projects[0]?.id || '');
  const [expTowerId, setExpTowerId] = useState(towers[0]?.id || '');
  const [expCategory, setExpCategory] = useState<ExpenseCategory>(
    isSupervisor ? 'daily_expense' : 'adhesive_grout'
  );
  const [expCustomCategory, setExpCustomCategory] = useState('');
  const [saveCustomExpPreset, setSaveCustomExpPreset] = useState(true);
  const [expDesc, setExpDesc] = useState('');
  const [expVendor, setExpVendor] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expMode, setExpMode] = useState<PaymentMode>('upi');
  const [expPaymentApp, setExpPaymentApp] = useState('');
  const [expTransactionId, setExpTransactionId] = useState('');
  const [expUpiId, setExpUpiId] = useState('');
  const [expProofImageDataUrl, setExpProofImageDataUrl] = useState('');
  const [expNotes, setExpNotes] = useState('');
  const [expError, setExpError] = useState('');
  const [savingExp, setSavingExp] = useState(false);

  const modalTowers = useMemo(
    () => towers.filter((t) => t.projectId === expProjectId),
    [towers, expProjectId]
  );

  const { projectSummaries, towerRows, grandTotal } = useMemo(
    () =>
      computeProjectAndTowerExpenses({
        projects,
        towers,
        employees,
        attendance,
        advances,
        expenses,
        dateStart: dateStart || undefined,
        dateEnd: dateEnd || undefined,
      }),
    [projects, towers, employees, attendance, advances, expenses, dateStart, dateEnd]
  );

  const scopedTowerRows = useMemo(
    () =>
      filterProjectId === 'all'
        ? towerRows
        : towerRows.filter((r) => r.tower.projectId === filterProjectId),
    [towerRows, filterProjectId]
  );

  const scopedExpenses = useMemo(
    () =>
      expenses
        .filter((e) => {
          if (filterProjectId !== 'all' && e.projectId !== filterProjectId) return false;
          if (dateStart && e.date < dateStart) return false;
          if (dateEnd && e.date > dateEnd) return false;
          if (categoryFilter === 'food_mess' && e.category !== 'food_mess') return false;
          if (categoryFilter === 'daily_expense' && e.category !== 'daily_expense') return false;
          if (categoryFilter === 'special_expense' && e.category !== 'special_expense') return false;
          if (categoryFilter === 'gas_payment' && e.category !== 'gas_payment') return false;
          if (categoryFilter === 'medical' && e.category !== 'medical') return false;
          if (categoryFilter === 'travel_advance' && e.category !== 'travel_advance') return false;
          if (categoryFilter === 'custom' && e.category !== 'custom') return false;
          if (categoryFilter.startsWith('custom::')) {
            const target = categoryFilter.slice('custom::'.length).toLowerCase();
            if (e.category !== 'custom' || (e.customCategory || '').trim().toLowerCase() !== target) {
              return false;
            }
          }
          if (
            categoryFilter === 'materials' &&
            (e.category === 'food_mess' ||
              e.category === 'daily_expense' ||
              e.category === 'special_expense' ||
              e.category === 'gas_payment' ||
              e.category === 'medical' ||
              e.category === 'travel_advance' ||
              e.category === 'custom')
          ) {
            return false;
          }
          return true;
        })
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [expenses, filterProjectId, dateStart, dateEnd, categoryFilter]
  );

  const totalWages = projectSummaries.reduce((s, p) => s + p.wagesCost, 0);
  const totalFood = projectSummaries.reduce((s, p) => s + p.foodAdvanceCost, 0);
  const totalSiteExp = projectSummaries.reduce((s, p) => s + p.siteExpensesCost, 0);

  const periodLabel =
    dateStart || dateEnd ? `${dateStart || 'Start'} to ${dateEnd || today}` : 'All Recorded Dates';

  const handleExportExpensesPdf = () => {
    const { blob, fileName } = buildExpenseReportPdfBlob({
      companyName,
      reportTitle: 'Project & Tower Expense Report',
      periodLabel,
      rows: scopedTowerRows.map((r) => ({
        label: `${r.projectName} — ${r.tower.name}`,
        sublabel: r.tower.startDate
          ? `Start ${r.tower.startDate} (${formatDurationBreakdown(r.tower.startDate, r.tower.finishDate, today).compactLabel})`
          : 'Timeline active',
        wages: formatINR(r.wagesCost),
        food: formatINR(r.dailyFoodCost + r.weeklyFoodCost),
        cash: formatINR(r.cashAdvanceCost),
        siteExp: formatINR(r.siteExpensesCost),
        total: formatINR(r.totalExpenseCost),
      })),
      grandTotal: formatINR(grandTotal),
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExportExpensesCsv = () => {
    const header = ['Project', 'Tower', 'StartDate', 'FinishDate', 'Wages', 'DailyFood', 'WeeklyFood', 'CashAdvance', 'SiteExpenses', 'TotalCost'];
    const rows = scopedTowerRows.map((r) => [
      `"${r.projectName.replace(/"/g, '""')}"`,
      `"${r.tower.name.replace(/"/g, '""')}"`,
      r.tower.startDate || '',
      r.tower.finishDate || 'Ongoing',
      r.wagesCost,
      r.dailyFoodCost,
      r.weeklyFoodCost,
      r.cashAdvanceCost,
      r.siteExpensesCost,
      r.totalExpenseCost,
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${companyName.replace(/[^a-zA-Z0-9]+/g, '_')}_Project_Tower_Expenses.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleShareTowerReport = (
    projectId: string,
    towerId: string | undefined,
    roleLabel: string,
    name?: string,
    phone?: string
  ) => {
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return;
    const twr = towerId ? towers.find((t) => t.id === towerId) : undefined;
    const relevantFlats = flats.filter((f) =>
      twr ? f.towerId === twr.id : f.projectId === proj.id
    );
    let totalZones = 0;
    let completedZones = 0;
    let inProgressZones = 0;
    for (const fl of relevantFlats) {
      const pr = calculateFlatProgress(fl, companyProfile?.tileZoneCatalog);
      totalZones += pr.totalZones;
      completedZones += pr.completedCount;
      inProgressZones += pr.inProgressCount;
    }

    const attSum = computeTowerAttendanceSummary({
      date: today,
      projectId: proj.id,
      towerId: twr?.id || 'all',
      employees,
      attendance,
    });
    const food = computeTowerFoodExpenseBreakdown({
      referenceDate: today,
      advances,
      employees,
      projectId: proj.id,
      towerId: twr?.id || 'all',
    });
    const twrCost = twr
      ? towerRows.find((r) => r.tower.id === twr.id)?.totalExpenseCost || 0
      : projectSummaries.find((p) => p.project.id === proj.id)?.totalCost || 0;
    const dur = formatDurationBreakdown(
      twr?.startDate || proj.startDate,
      twr?.finishDate || proj.finishDate,
      today
    );

    const msg = formatTowerProjectStatusWhatsappMessage({
      companyName,
      project: proj,
      tower: twr,
      flatsCount: relevantFlats.length,
      completedZones,
      totalZones,
      inProgressZones,
      attendanceSummary: attSum,
      foodDaily: food.dailyFoodTotal,
      foodMonthly: food.monthlyFoodTotal,
      totalTowerExpense: twrCost,
      durationLabel: dur.label,
    });

    onTriggerWhatsapp({
      title: `Share Status to ${roleLabel}`,
      recipientName: name ? `${name} (${roleLabel})` : roleLabel,
      recipientPhone: phone || '',
      recipientEmail: companyProfile?.hrEmail || '',
      emailSubject: `${companyName} Site Expense & Status — ${proj.name}${twr ? ` / ${twr.name}` : ''}`,
      message: msg,
    });
  };

  const handleOpenAddExpense = () => {
    const defProj = projects[0]?.id || '';
    const defTwr = towers.find((t) => t.projectId === defProj)?.id || towers[0]?.id || '';
    setExpDate(today);
    setExpProjectId(defProj);
    setExpTowerId(defTwr);
    setExpCategory(isSupervisor ? 'daily_expense' : 'adhesive_grout');
    setExpCustomCategory('');
    setSaveCustomExpPreset(true);
    setExpDesc('');
    setExpVendor('');
    setExpAmount('');
    setExpMode('upi');
    setExpPaymentApp('');
    setExpTransactionId('');
    setExpUpiId('');
    setExpProofImageDataUrl('');
    setExpNotes('');
    setExpError('');
    setShowAddExpense(true);
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setExpError('');
    const amt = Number(expAmount);
    if (!expProjectId || !expDesc.trim() || !Number.isFinite(amt) || amt <= 0) {
      setExpError('Please select a project, enter a description, and specify an amount > 0.');
      return;
    }
    if (expCategory === 'custom' && !expCustomCategory.trim()) {
      setExpError('Please enter or pick a custom expense category name.');
      return;
    }
    setSavingExp(true);
    try {
      const cleanCustomCat = expCategory === 'custom' ? expCustomCategory.trim() : undefined;
      await addExpense({
        date: expDate,
        projectId: expProjectId,
        towerId: expTowerId || undefined,
        category: expCategory,
        customCategory: cleanCustomCat,
        description: expDesc.trim(),
        vendorName: expVendor.trim(),
        amount: amt,
        paymentMode: expMode,
        paymentApp: expPaymentApp.trim() || undefined,
        transactionId: expTransactionId.trim() || undefined,
        upiId: expUpiId.trim() || undefined,
        proofImageDataUrl: expProofImageDataUrl || undefined,
        notes: expNotes.trim(),
      });
      if (isAdmin && saveCustomExpPreset && cleanCustomCat) {
        const existing = companyProfile?.customExpenseCategories || [];
        if (!existing.some((c) => c.toLowerCase() === cleanCustomCat.toLowerCase())) {
          updateCompanyProfile({
            customExpenseCategories: [...existing, cleanCustomCat],
          }).catch(() => undefined);
        }
      }
      setShowAddExpense(false);
    } catch (err) {
      setExpError(err instanceof Error ? err.message : 'Failed to save site expense.');
    } finally {
      setSavingExp(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Project &amp; Tower Expenses, Timelines &amp; Site Ledger
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Track project &amp; tower work durations (years / months / days), crew wages, food advances, and material/adhesive expenses with PDF &amp; CSV export.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isAdmin && onOpenCompanySettings && (
            <button
              type="button"
              onClick={onOpenCompanySettings}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Configure Categories</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleExportExpensesCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={handleExportExpensesPdf}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export PDF</span>
          </button>
          <button
            type="button"
            onClick={handleOpenAddExpense}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Add Site Expense</span>
          </button>
        </div>
      </div>

      {/* Filters + KPIs */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="exp-filter-proj" className="block text-xs font-medium text-slate-500 mb-1">
            Project Filter
          </label>
          <select
            id="exp-filter-proj"
            value={filterProjectId}
            onChange={(e) => setFilterProjectId(e.target.value)}
            className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="exp-start" className="block text-xs font-medium text-slate-500 mb-1">
            From Date
          </label>
          <input
            id="exp-start"
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
          />
        </div>
        <div>
          <label htmlFor="exp-end" className="block text-xs font-medium text-slate-500 mb-1">
            To Date
          </label>
          <input
            id="exp-end"
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
          />
        </div>
        {(dateStart || dateEnd) && (
          <button
            type="button"
            onClick={() => {
              setDateStart('');
              setDateEnd('');
            }}
            className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 underline"
          >
            Clear Dates
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Total Site &amp; Labor Cost</div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatINR(grandTotal)}
          </div>
          <p className="mt-1 text-xs text-slate-500">{periodLabel}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Crew Wages + OT Earned</div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatINR(totalWages)}
          </div>
          <p className="mt-1 text-xs text-slate-500">Based on marked site attendance</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Daily &amp; Sunday Food Advances</div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-amber-700">
            {formatINR(totalFood)}
          </div>
          <p className="mt-1 text-xs text-slate-500">Daily &amp; Sunday weekly food runs</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Material, Adhesive &amp; Site Exp.</div>
          <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-orange-700">
            {formatINR(totalSiteExp)}
          </div>
          <p className="mt-1 text-xs text-slate-500">{scopedExpenses.length} expense bills logged</p>
        </div>
      </div>

      {/* Weekly Food Advance — 24h Acknowledgment & Automated WhatsApp Follow-Up */}
      <section
        data-testid="weekly-food-followup-section"
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <BellRing className="w-4 h-4 text-orange-700 shrink-0 mt-1" aria-hidden="true" />
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Weekly Food Advance — 24h Acknowledgment &amp; Automated WhatsApp Follow-Up
                </h2>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded border whitespace-nowrap ${
                    followUpSettings.autoMonitorEnabled
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border-slate-300'
                  }`}
                >
                  <span>
                    {followUpSettings.autoMonitorEnabled
                      ? `Auto ${followUpSettings.thresholdHours}h Monitor ON`
                      : 'Auto Monitor Paused'}
                  </span>
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Automatically flags weekly food advances unacknowledged after{' '}
                {followUpSettings.thresholdHours} hours and queues templated WhatsApp follow-up reminders
                ({followUpSettings.cooldownHours}h repeat cooldown).
                {followUpSettings.lastAutoSweepAt
                  ? ` Last scan: ${new Date(followUpSettings.lastAutoSweepAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                updateFollowUpSettings((prev) => ({
                  ...prev,
                  autoMonitorEnabled: !prev.autoMonitorEnabled,
                }))
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap ${
                followUpSettings.autoMonitorEnabled
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                  : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {followUpSettings.autoMonitorEnabled ? 'Auto-Check: ON' : 'Auto-Check: OFF'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleRunManual24hScan}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Scan Overdue Now</span>
            </button>

            <button
              type="button"
              onClick={() => setShowFollowUpSettings((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap ${
                showFollowUpSettings
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Template &amp; Rules</span>
            </button>

            <button
              type="button"
              disabled={weeklyFoodSummary.dueNowCount === 0}
              onClick={handleOpenFollowUpQueue}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Send Follow-Up Queue ({weeklyFoodSummary.dueNowCount})</span>
            </button>
          </div>
        </div>

        {/* Auto-Monitor Overdue Alert Banner */}
        {followUpSettings.autoMonitorEnabled && weeklyFoodSummary.dueNowCount > 0 && (
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-start sm:items-center gap-2 text-xs text-amber-950">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
              <span>
                <strong>24h Follow-Up Alert:</strong> {weeklyFoodSummary.dueNowCount} worker
                {weeklyFoodSummary.dueNowCount === 1 ? ' has' : 's have'} unacknowledged weekly food
                advance entries older than {followUpSettings.thresholdHours}h awaiting WhatsApp confirmation.
              </span>
            </div>
            <button
              type="button"
              onClick={handleOpenFollowUpQueue}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap self-start sm:self-auto"
            >
              <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Dispatch {weeklyFoodSummary.dueNowCount} WA Reminder{weeklyFoodSummary.dueNowCount === 1 ? '' : 's'}</span>
            </button>
          </div>
        )}

        {/* Customizable Rules & Message Template Drawer */}
        {showFollowUpSettings && (
          <div
            data-testid="followup-template-editor"
            className="p-5 bg-slate-50 border-b border-slate-200 space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="followup-threshold-hours"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Acknowledgment Window (Hours)
                </label>
                <input
                  id="followup-threshold-hours"
                  type="number"
                  min={1}
                  max={168}
                  value={followUpSettings.thresholdHours}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(168, Number(e.target.value) || 24));
                    updateFollowUpSettings((prev) => ({ ...prev, thresholdHours: val }));
                  }}
                  className="w-full px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-md"
                />
                <p className="mt-1 text-[11px] text-slate-500">Default: 24 hours after recording.</p>
              </div>
              <div>
                <label
                  htmlFor="followup-cooldown-hours"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Repeat Reminder Cooldown (Hours)
                </label>
                <input
                  id="followup-cooldown-hours"
                  type="number"
                  min={1}
                  max={168}
                  value={followUpSettings.cooldownHours}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(168, Number(e.target.value) || 24));
                    updateFollowUpSettings((prev) => ({ ...prev, cooldownHours: val }));
                  }}
                  className="w-full px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-md"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Prevents duplicate reminders within cooldown window.
                </p>
              </div>
              <div className="flex flex-col justify-end">
                <button
                  type="button"
                  onClick={() =>
                    updateFollowUpSettings((prev) => ({
                      ...prev,
                      thresholdHours: 24,
                      cooldownHours: 24,
                      template: DEFAULT_FOOD_FOLLOWUP_TEMPLATE,
                    }))
                  }
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Reset Default 24h Template</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="followup-template-textarea"
                    className="text-xs font-medium text-slate-700"
                  >
                    WhatsApp Follow-Up Message Template
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {[
                      '{{workerName}}',
                      '{{amount}}',
                      '{{date}}',
                      '{{tower}}',
                      '{{hoursElapsed}}',
                    ].map((token) => (
                      <button
                        key={token}
                        type="button"
                        onClick={() =>
                          updateFollowUpSettings((prev) => ({
                            ...prev,
                            template: `${prev.template} ${token}`,
                          }))
                        }
                        className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-100"
                      >
                        +{token}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  id="followup-template-textarea"
                  rows={5}
                  value={followUpSettings.template}
                  onChange={(e) =>
                    updateFollowUpSettings((prev) => ({ ...prev, template: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs font-mono leading-relaxed bg-white border border-slate-300 rounded-md"
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-700">Live WhatsApp Message Preview</div>
                <div className="p-3 bg-white border border-slate-200 rounded-md text-xs font-mono whitespace-pre-wrap leading-relaxed text-slate-800 min-h-[120px]">
                  {(() => {
                    const sample =
                      weeklyFoodSummary.dueNowRows[0] ||
                      weeklyFoodSummary.allRows[0] ||
                      null;
                    if (!sample) {
                      return buildFoodAdvanceFollowUpMessage(
                        {
                          employeeName: 'Sample Worker',
                          empCode: 'AVY-MSN-001',
                          amount: 900,
                          date: today,
                          paymentMode: 'cash',
                          projectName: projects[0]?.name || 'Skyline Towers',
                          towerName: towers[0]?.name || 'Tower A',
                        },
                        {
                          companyName,
                          elapsedHours: 26,
                          template: followUpSettings.template,
                        }
                      );
                    }
                    return buildFoodAdvanceFollowUpMessage(sample.advance, {
                      companyName,
                      elapsedHours: Math.max(sample.elapsedHours, followUpSettings.thresholdHours),
                      template: followUpSettings.template,
                    });
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filter Tabs & Mini Counters */}
        <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-md">
            {(
              [
                { id: 'all', label: `All Weekly Food (${weeklyFoodSummary.allRows.length})` },
                { id: 'overdue', label: `Overdue >${followUpSettings.thresholdHours}h (${weeklyFoodSummary.overdueCount})` },
                { id: 'within_window', label: `Within Window (${weeklyFoodSummary.withinWindowCount})` },
                { id: 'acknowledged', label: `Acknowledged (${weeklyFoodSummary.acknowledgedCount})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFoodFollowUpFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap ${
                  foodFollowUpFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 font-mono tabular-nums">
            <span>
              Due Now:{' '}
              <strong className="text-red-700">{weeklyFoodSummary.dueNowCount}</strong>
            </span>
            <span>
              Cooldown:{' '}
              <strong className="text-amber-700">
                {Math.max(0, weeklyFoodSummary.overdueCount - weeklyFoodSummary.dueNowCount)}
              </strong>
            </span>
            <span>
              Acknowledged:{' '}
              <strong className="text-emerald-700">{weeklyFoodSummary.acknowledgedCount}</strong>
            </span>
          </div>
        </div>

        {/* Weekly Food Follow-Up Tracking Table */}
        <div className="overflow-x-auto">
          <table
            data-testid="weekly-food-followup-table"
            className="w-full text-left border-collapse"
          >
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Disbursed Date &amp; Age</th>
                <th className="py-2.5 px-3">Worker &amp; Site</th>
                <th className="py-2.5 px-3 text-right">Amount &amp; Mode</th>
                <th className="py-2.5 px-3">Acknowledgment Status</th>
                <th className="py-2.5 px-3">WhatsApp Follow-Up</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {visibleFoodFollowUpRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                    No weekly food advance entries match this filter.
                  </td>
                </tr>
              ) : (
                visibleFoodFollowUpRows.map((row) => {
                  const adv = row.advance;
                  const emp = employees.find((e) => e.id === adv.employeeId);
                  const phone = adv.employeePhone || emp?.phone || '';
                  const formattedPhone = sanitizeWhatsappPhone(phone);
                  const waMessage = buildFoodAdvanceFollowUpMessage(adv, {
                    companyName,
                    elapsedHours: row.elapsedHours,
                    template: followUpSettings.template,
                  });
                  const waUrl = buildWhatsappUrl(phone, waMessage);

                  return (
                    <tr
                      key={adv.id}
                      data-testid={`food-followup-row-${adv.id}`}
                      className={
                        row.status === 'overdue_unacknowledged'
                          ? 'bg-amber-50/40 hover:bg-amber-50/70'
                          : 'hover:bg-slate-50/70'
                      }
                    >
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        <div className="font-mono font-semibold text-slate-800">{adv.date}</div>
                        <div
                          className={`mt-0.5 font-mono text-[11px] ${
                            row.status === 'overdue_unacknowledged'
                              ? 'text-red-700 font-semibold'
                              : 'text-slate-500'
                          }`}
                        >
                          {formatElapsedDurationLabel(row.elapsedHours)} elapsed
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900">{adv.employeeName}</div>
                        <div className="text-xs font-mono text-slate-500">
                          {adv.empCode}
                          {formattedPhone ? ` · +${formattedPhone}` : ' · No phone'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {adv.projectName || emp?.currentProjectName || 'Site'}
                          {adv.towerName || emp?.currentTowerName
                            ? ` (${adv.towerName || emp?.currentTowerName})`
                            : ''}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="font-mono font-semibold tabular-nums text-slate-900">
                          {formatINR(adv.amount)}
                        </div>
                        <div className="text-[11px] font-mono uppercase text-slate-500">
                          {adv.paymentMode}
                          {adv.paymentApp ? ` · ${adv.paymentApp}` : ''}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-xs">
                        {row.status === 'acknowledged' ? (
                          <div>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>Acknowledged</span>
                            </span>
                            {adv.acknowledgedBy && (
                              <div className="mt-0.5 text-[11px] text-slate-500">
                                By {adv.acknowledgedBy}
                              </div>
                            )}
                          </div>
                        ) : row.status === 'overdue_unacknowledged' ? (
                          <div>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-red-50 text-red-800 border border-red-200 rounded">
                              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                              <span>Unack &gt;{followUpSettings.thresholdHours}h</span>
                            </span>
                            <div className="mt-0.5 text-[11px] text-red-700">
                              +{formatElapsedDurationLabel(row.hoursOverdue)} overdue
                            </div>
                          </div>
                        ) : (
                          <div>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 rounded">
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              <span>Within {followUpSettings.thresholdHours}h</span>
                            </span>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              {Math.ceil(row.remainingHours)}h until follow-up due
                            </div>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-xs">
                        {(adv.followUpCount ?? 0) > 0 ? (
                          <div>
                            <span className="inline-block px-2 py-0.5 text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200 rounded font-mono">
                              {adv.followUpCount}x Sent
                            </span>
                            {adv.followUpSentAt && (
                              <div className="mt-0.5 text-[11px] font-mono text-slate-500">
                                {new Date(adv.followUpSentAt).toLocaleString([], {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                            )}
                            {row.inCooldown && row.status === 'overdue_unacknowledged' && (
                              <div className="text-[10px] text-amber-700">
                                Cooldown: {Math.ceil(row.cooldownRemainingHours)}h left
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-500">Not sent yet</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {row.status === 'acknowledged' ? (
                          <span className="text-xs font-medium text-emerald-700">Confirmed</span>
                        ) : (
                          <div className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => {
                                recordAdvanceFollowUpSent(adv.id);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-700 rounded hover:bg-emerald-800 whitespace-nowrap"
                            >
                              <Send className="w-3 h-3" aria-hidden="true" />
                              <span>Send WA Follow-Up</span>
                            </a>
                            <button
                              type="button"
                              onClick={() => handleOpenSinglePreviewFollowUp(row)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
                            >
                              <Eye className="w-3 h-3" aria-hidden="true" />
                              <span>Preview</span>
                            </button>
                            <button
                              type="button"
                              disabled={ackingAdvanceId === adv.id}
                              onClick={async () => {
                                setAckingAdvanceId(adv.id);
                                try {
                                  await acknowledgeAdvance(adv.id);
                                } finally {
                                  setAckingAdvanceId(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap"
                            >
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>{ackingAdvanceId === adv.id ? '...' : 'Mark Ack'}</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Project-Wise Expenses & Work Timeline */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-orange-700" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-slate-900">
              Project-Wise Expenses &amp; Duration ({projectSummaries.length})
            </h2>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Project &amp; Leadership</th>
                <th className="py-2.5 px-3">Start / Finish &amp; Duration</th>
                <th className="py-2.5 px-3 text-right">Wages</th>
                <th className="py-2.5 px-3 text-right">Food Adv</th>
                <th className="py-2.5 px-3 text-right">Cash Adv</th>
                <th className="py-2.5 px-3 text-right">Site Material/Other</th>
                <th className="py-2.5 px-3 text-right">Total Cost</th>
                <th className="py-2.5 px-4 text-right">Share Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {projectSummaries.map((sum) => {
                const dur = formatDurationBreakdown(sum.project.startDate, sum.project.finishDate, today);
                return (
                  <tr key={sum.project.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{sum.project.name}</div>
                      <div className="text-xs text-slate-500">
                        {sum.project.location} · {sum.towerCount} towers
                      </div>
                      {(sum.project.managerName || sum.project.engineerName) && (
                        <div className="text-[11px] text-slate-600 mt-0.5">
                          {sum.project.managerName ? `PM: ${sum.project.managerName} (${sum.project.managerPhone || '—'})` : ''}
                          {sum.project.managerName && sum.project.engineerName ? ' · ' : ''}
                          {sum.project.engineerName ? `Eng: ${sum.project.engineerName}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs">
                      <div className="font-mono text-slate-700">
                        {sum.project.startDate || 'Not set'} → {sum.project.finishDate || 'Ongoing'}
                      </div>
                      <div className="font-medium text-orange-800 mt-0.5">{dur.label}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {formatINR(sum.wagesCost)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-amber-700">
                      {formatINR(sum.foodAdvanceCost)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {formatINR(sum.cashAdvanceCost)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {formatINR(sum.siteExpensesCost)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatINR(sum.totalCost)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            handleShareTowerReport(
                              sum.project.id,
                              undefined,
                              'Project Manager',
                              sum.project.managerName,
                              sum.project.managerPhone
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                        >
                          <MessageSquare className="w-3 h-3" aria-hidden="true" />
                          <span>PM</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleShareTowerReport(
                              sum.project.id,
                              undefined,
                              'Site Engineer',
                              sum.project.engineerName,
                              sum.project.engineerPhone
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                        >
                          <span>Eng</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Tower-Wise Expenses Breakdown */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Tower-Wise Expenses, Food &amp; Timeline ({scopedTowerRows.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Tower / Project</th>
                <th className="py-2.5 px-3">Work Timeline (Days / Mos / Yrs)</th>
                <th className="py-2.5 px-2 text-right">Crew</th>
                <th className="py-2.5 px-2 text-right">Wages</th>
                <th className="py-2.5 px-2 text-right">Daily Food</th>
                <th className="py-2.5 px-2 text-right">Weekly Food</th>
                <th className="py-2.5 px-2 text-right">Site Exp</th>
                <th className="py-2.5 px-3 text-right">Tower Total</th>
                <th className="py-2.5 px-4 text-right">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {scopedTowerRows.map((row) => {
                const dur = formatDurationBreakdown(row.tower.startDate, row.tower.finishDate, today);
                return (
                  <tr key={row.tower.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">
                        {row.tower.name}
                      </div>
                      <div className="text-xs text-slate-500">{row.projectName}</div>
                      {(row.tower.inchargeName || row.tower.supervisorName) && (
                        <div className="text-[11px] text-slate-500">
                          {row.tower.inchargeName ? `Incharge: ${row.tower.inchargeName}` : ''}
                          {row.tower.inchargeName && row.tower.supervisorName ? ' · ' : ''}
                          {row.tower.supervisorName ? `Sup: ${row.tower.supervisorName}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs">
                      <div className="font-mono text-slate-700">
                        {row.tower.startDate || 'Not set'} → {row.tower.finishDate || 'Ongoing'}
                      </div>
                      <div className="font-medium text-slate-900">{dur.label}</div>
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-xs text-slate-700">
                      {row.crewCount}
                    </td>
                    <td className="py-3 px-2 text-right font-mono tabular-nums text-slate-700">
                      {formatINR(row.wagesCost)}
                    </td>
                    <td className="py-3 px-2 text-right font-mono tabular-nums text-amber-700">
                      {formatINR(row.dailyFoodCost)}
                    </td>
                    <td className="py-3 px-2 text-right font-mono tabular-nums text-amber-700">
                      {formatINR(row.weeklyFoodCost)}
                    </td>
                    <td className="py-3 px-2 text-right font-mono tabular-nums text-slate-700">
                      {formatINR(row.siteExpensesCost)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatINR(row.totalExpenseCost)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() =>
                          handleShareTowerReport(
                            row.tower.projectId,
                            row.tower.id,
                            'Site Engineer',
                            row.tower.engineerName,
                            row.tower.engineerPhone
                          )
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                      >
                        <MessageSquare className="w-3 h-3" aria-hidden="true" />
                        <span>Status WA</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Site Expenses Ledger */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ReceiptIndianRupee className="w-4 h-4 text-orange-700" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-slate-900">
              Site Food, Daily, Special &amp; Material Expense Ledger ({scopedExpenses.length})
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-md">
              {[
                { id: 'all', label: 'All Bills' },
                { id: 'food_mess', label: 'Food / Mess' },
                { id: 'daily_expense', label: 'Daily Site' },
                { id: 'special_expense', label: 'Special' },
                { id: 'gas_payment', label: 'Gas Payment' },
                { id: 'medical', label: 'Medical' },
                { id: 'travel_advance', label: 'Travel Advance' },
                { id: 'materials', label: 'Materials' },
                { id: 'custom', label: 'All Custom' },
                ...customExpensePresets.map((preset) => ({
                  id: `custom::${preset}`,
                  label: preset,
                })),
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap ${
                    categoryFilter === cat.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleOpenAddExpense}
              className="text-xs font-semibold text-orange-700 hover:text-orange-800 whitespace-nowrap"
            >
              + Add Bill
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Date</th>
                <th className="py-2.5 px-3">Project / Tower</th>
                <th className="py-2.5 px-3">Category &amp; Description</th>
                <th className="py-2.5 px-3">Vendor / Mode</th>
                <th className="py-2.5 px-3 text-right">Amount</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {scopedExpenses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No site expense bills recorded for this filter.
                  </td>
                </tr>
              ) : (
                scopedExpenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {exp.date}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-900">{exp.projectName}</div>
                      <div className="text-xs text-slate-500">{exp.towerName || 'Project-Wide'}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-900">{exp.description}</div>
                      <div className="text-xs text-slate-500">
                        <span className="font-medium text-slate-700">{getExpenseCategoryLabel(exp)}</span>
                        {exp.notes ? ` · ${exp.notes}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-600">
                      <div>{exp.vendorName || 'Direct Site Purchase'}</div>
                      <div className="uppercase font-mono text-[11px] text-slate-500">
                        {exp.paymentMode}
                        {exp.paymentApp ? ` · ${exp.paymentApp}` : ''}
                      </div>
                      {(exp.transactionId || exp.upiId) && (
                        <div className="font-mono text-[10px] text-slate-500">
                          {exp.transactionId ? `UTR: ${exp.transactionId}` : ''}
                          {exp.transactionId && exp.upiId ? ' · ' : ''}
                          {exp.upiId ? `UPI: ${exp.upiId}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                      {formatINR(exp.amount)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {exp.proofImageDataUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setProofLightbox({
                                title: `Expense Proof — ${getExpenseCategoryLabel(exp)}`,
                                subtitle: `${exp.projectName} · ${exp.description}`,
                                imageDataUrl: exp.proofImageDataUrl!,
                                paymentMode: exp.paymentMode,
                                paymentApp: exp.paymentApp,
                                transactionId: exp.transactionId,
                                upiId: exp.upiId,
                                amount: exp.amount,
                                date: exp.date,
                              })
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                          >
                            <Eye className="w-3 h-3" aria-hidden="true" />
                            <span>Proof</span>
                          </button>
                        )}
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => deleteExpense(exp.id)}
                            aria-label={`Delete expense ${exp.description}`}
                            className="p-1.5 text-slate-400 hover:text-red-700 rounded hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        ) : (
                          !exp.proofImageDataUrl && (
                            <span className="text-[11px] font-mono text-slate-400">Logged</span>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Add Site Expense Modal */}
      {showAddExpense && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-expense-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 id="add-expense-title" className="text-base font-semibold text-slate-900">
                Record Tower / Project Site Expense
              </h2>
              <button
                type="button"
                onClick={() => setShowAddExpense(false)}
                aria-label="Close add expense modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateExpense} className="p-6 space-y-4">
              {expError && (
                <div className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
                  {expError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="exp-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Bill Date
                  </label>
                  <input
                    id="exp-date"
                    type="date"
                    required
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label htmlFor="exp-cat" className="block text-xs font-medium text-slate-700">
                      Expense Category
                    </label>
                    {isAdmin && onOpenCompanySettings && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddExpense(false);
                          onOpenCompanySettings();
                        }}
                        className="text-[11px] font-medium text-orange-700 hover:underline"
                      >
                        Manage Categories
                      </button>
                    )}
                  </div>
                  <select
                    id="exp-cat"
                    value={
                      expCategory === 'custom' &&
                      expCustomCategory.trim() &&
                      customExpensePresets.some(
                        (p) => p.toLowerCase() === expCustomCategory.trim().toLowerCase()
                      )
                        ? `custom::${
                            customExpensePresets.find(
                              (p) => p.toLowerCase() === expCustomCategory.trim().toLowerCase()
                            ) || expCustomCategory.trim()
                          }`
                        : expCategory
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.startsWith('custom::')) {
                        setExpCategory('custom');
                        setExpCustomCategory(val.slice('custom::'.length));
                      } else {
                        setExpCategory(val as ExpenseCategory);
                        if (val !== 'custom') setExpCustomCategory('');
                      }
                    }}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    <optgroup label="Standard Site Categories">
                      {Object.entries(EXPENSE_CATEGORY_LABELS)
                        .filter(([k]) => k !== 'custom')
                        .map(([k, lbl]) => (
                          <option key={k} value={k}>
                            {lbl}
                          </option>
                        ))}
                    </optgroup>
                    {customExpensePresets.length > 0 && (
                      <optgroup label="Configured Custom Categories">
                        {customExpensePresets.map((preset) => (
                          <option key={preset} value={`custom::${preset}`}>
                            {preset}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Ad-hoc">
                      <option value="custom">+ Create One-Off Custom Category...</option>
                    </optgroup>
                  </select>
                </div>
              </div>

              {expCategory === 'custom' && (
                <div className="p-3 bg-orange-50/60 border border-orange-200 rounded-md space-y-2">
                  {customExpensePresets.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-medium text-slate-600">Saved Custom Categories:</span>
                      {customExpensePresets.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setExpCustomCategory(preset)}
                          className={`px-2 py-0.5 text-[11px] font-medium rounded border ${
                            expCustomCategory.trim().toLowerCase() === preset.toLowerCase()
                              ? 'bg-orange-700 text-white border-orange-700'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  )}
                  <div>
                    <label htmlFor="exp-custom-cat" className="block text-[11px] font-medium text-slate-700 mb-1">
                      Custom Expense Category Name (e.g. Tea &amp; Snacks, Crane Rent, Welding)
                    </label>
                    <input
                      id="exp-custom-cat"
                      type="text"
                      required
                      value={expCustomCategory}
                      onChange={(e) => setExpCustomCategory(e.target.value)}
                      placeholder="Enter custom category..."
                      className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                  {isAdmin && (
                    <label className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={saveCustomExpPreset}
                        onChange={(e) => setSaveCustomExpPreset(e.target.checked)}
                        className="rounded border-slate-300 text-orange-700"
                      />
                      <span>Save as reusable custom expense category</span>
                    </label>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="exp-proj" className="block text-xs font-medium text-slate-700 mb-1">
                    Project
                  </label>
                  <select
                    id="exp-proj"
                    required
                    value={expProjectId}
                    onChange={(e) => {
                      const pId = e.target.value;
                      setExpProjectId(pId);
                      setExpTowerId(towers.find((t) => t.projectId === pId)?.id || '');
                    }}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="exp-twr" className="block text-xs font-medium text-slate-700 mb-1">
                    {isSupervisor ? 'Assigned Tower' : 'Tower (Optional)'}
                  </label>
                  <select
                    id="exp-twr"
                    required={isSupervisor}
                    value={expTowerId}
                    onChange={(e) => setExpTowerId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    {!isSupervisor && <option value="">Project-Wide</option>}
                    {modalTowers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="exp-desc" className="block text-xs font-medium text-slate-700 mb-1">
                  Item / Work Description
                </label>
                <input
                  id="exp-desc"
                  type="text"
                  required
                  value={expDesc}
                  onChange={(e) => setExpDesc(e.target.value)}
                  placeholder="e.g. Laticrete Adhesive 40 bags + Epoxy Grout"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="exp-vendor" className="block text-xs font-medium text-slate-700 mb-1">
                    Vendor / Supplier
                  </label>
                  <input
                    id="exp-vendor"
                    type="text"
                    value={expVendor}
                    onChange={(e) => setExpVendor(e.target.value)}
                    placeholder="Supplier name"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="exp-amt" className="block text-xs font-medium text-slate-700 mb-1">
                    Amount (₹)
                  </label>
                  <input
                    id="exp-amt"
                    type="number"
                    min="1"
                    required
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="exp-mode" className="block text-xs font-medium text-slate-700 mb-1">
                    Payment Mode
                  </label>
                  <select
                    id="exp-mode"
                    value={expMode}
                    onChange={(e) => setExpMode(e.target.value as PaymentMode)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    <option value="upi">UPI</option>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank Transfer</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="exp-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Bill / Site Notes
                </label>
                <input
                  id="exp-notes"
                  type="text"
                  value={expNotes}
                  onChange={(e) => setExpNotes(e.target.value)}
                  placeholder="Floor delivery details or invoice ref"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <PaymentProofUploadBox
                value={{
                  paymentMode: expMode,
                  paymentApp: expPaymentApp,
                  transactionId: expTransactionId,
                  upiId: expUpiId,
                  proofImageDataUrl: expProofImageDataUrl,
                }}
                onChange={(next: PaymentProofState) => {
                  setExpMode(next.paymentMode);
                  setExpPaymentApp(next.paymentApp);
                  setExpTransactionId(next.transactionId);
                  setExpUpiId(next.upiId);
                  setExpProofImageDataUrl(next.proofImageDataUrl);
                }}
                onDetectedAmount={(amt) => {
                  if (amt > 0) setExpAmount(String(amt));
                }}
                onDetectedDate={(isoDate) => {
                  if (isoDate) setExpDate(isoDate);
                }}
              />

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddExpense(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingExp}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {savingExp ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sequential Automated WhatsApp Follow-Up Queue Modal */}
      {queueModalOpen && (
        <div
          data-testid="auto-followup-queue-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="followup-queue-title"
        >
          <div className="w-full max-w-xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2.5">
                <BellRing className="w-5 h-5 text-emerald-700" aria-hidden="true" />
                <div>
                  <h2 id="followup-queue-title" className="text-base font-semibold text-slate-900">
                    Automated 24h WhatsApp Follow-Up Queue
                  </h2>
                  <p className="text-xs text-slate-500">
                    {activeQueueRow
                      ? `Worker ${Math.min(queueIndex + 1, queueAdvanceIds.length)} of ${queueAdvanceIds.length}`
                      : `Queue Complete (${queueDispatchedCount} sent)`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQueueModalOpen(false)}
                aria-label="Close follow-up queue modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeQueueRow ? (
              (() => {
                const adv = activeQueueRow.advance;
                const emp = employees.find((e) => e.id === adv.employeeId);
                const phone = adv.employeePhone || emp?.phone || '';
                const formattedPhone = sanitizeWhatsappPhone(phone);
                const waUrl = buildWhatsappUrl(phone, queueDraftMessage);

                const advanceStep = () => {
                  if (queueIndex + 1 < queueAdvanceIds.length) {
                    setQueueIndex((i) => i + 1);
                  } else {
                    setQueueIndex(queueAdvanceIds.length);
                  }
                };

                return (
                  <>
                    <div className="p-6 space-y-4 overflow-y-auto">
                      <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-md flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div>
                          <div className="font-semibold text-slate-900 text-sm">
                            {adv.employeeName} ({adv.empCode})
                          </div>
                          <div className="text-slate-600 mt-0.5">
                            {adv.projectName || 'Site'}
                            {adv.towerName ? ` (${adv.towerName})` : ''} · Disbursed {adv.date} (
                            {formatElapsedDurationLabel(activeQueueRow.elapsedHours)} ago)
                          </div>
                        </div>
                        <div className="text-right font-mono">
                          <div className="text-base font-bold text-slate-900">
                            {formatINR(adv.amount)}
                          </div>
                          <div className="text-[11px] text-slate-600">
                            {formattedPhone ? `+${formattedPhone}` : 'Pick contact in WhatsApp'}
                          </div>
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="queue-wa-msg"
                          className="block text-xs font-medium text-slate-700 mb-1.5"
                        >
                          Templated WhatsApp Reminder (Editable Before Sending)
                        </label>
                        <textarea
                          id="queue-wa-msg"
                          rows={7}
                          value={queueDraftMessage}
                          onChange={(e) => setQueueDraftMessage(e.target.value)}
                          className="w-full px-3 py-2.5 text-sm font-mono leading-relaxed bg-slate-50 border border-slate-300 rounded-md"
                        />
                      </div>
                    </div>

                    <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={advanceStep}
                          className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100"
                        >
                          Skip Worker
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await acknowledgeAdvance(adv.id);
                            advanceStep();
                          }}
                          className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-md hover:bg-emerald-100"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Already Confirmed</span>
                        </button>
                      </div>

                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={async () => {
                          await recordAdvanceFollowUpSent(adv.id);
                          setQueueDispatchedCount((c) => c + 1);
                          advanceStep();
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 whitespace-nowrap"
                      >
                        <span>Send in WhatsApp &amp; Next</span>
                        <ExternalLink className="w-4 h-4" aria-hidden="true" />
                      </a>
                    </div>
                  </>
                );
              })()
            ) : (
              <div className="p-8 text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6 text-emerald-700" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Follow-Up Queue Processed
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Dispatched {queueDispatchedCount} WhatsApp follow-up reminder
                    {queueDispatchedCount === 1 ? '' : 's'} from this queue.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setQueueModalOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {proofLightbox && (
        <ImageProofLightboxModal
          payload={proofLightbox}
          onClose={() => setProofLightbox(null)}
        />
      )}
    </div>
  );
}
