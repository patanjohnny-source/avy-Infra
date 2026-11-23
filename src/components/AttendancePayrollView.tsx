import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  CalendarRange,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  IdCard,
  Lock,
  LogOut,
  MessageSquare,
  Pencil,
  Plus,
  Printer,
  QrCode,
  ReceiptIndianRupee,
  ScanText,
  Search,
  Sparkles,
  Trash2,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import type {
  AdvanceEntry,
  AdvanceType,
  AttendanceRecord,
  AttendanceStatus,
  Employee,
  PaymentMode,
  WhatsappMessagePayload,
} from '../types/avy';
import {
  canViewEmployeeFixedSalary,
  getScopedAdvances,
  getScopedAssignments,
  getScopedAttendance,
  getScopedEmployees,
  getScopedProjects,
  getScopedTowers,
  isAdminSession,
  isSupervisorSession,
} from '../utils/authAccess';
import {
  buildEmployeeAttendanceCardPdfBlob,
  buildEmployeePayrollExpensePdfBlob,
  buildExpenseReportPdfBlob,
  buildTowerAttendancePdfBlob,
} from '../utils/idCardPdf';
import {
  computeSingleEmployeeAttendanceCard,
  computeTowerAttendanceSummary,
  computeTowerFoodExpenseBreakdown,
  computeWorkedHoursFromInOut,
  formatDurationBreakdown,
  formatTowerAttendanceWhatsappMessage,
  getCurrentHHMM,
  isSundayDate,
  normalizeHHMM,
} from '../utils/operations';
import {
  ATTENDANCE_STATUS_LABELS,
  buildEmployeePayrollExpenseCsv,
  buildMonthlyAttendanceAndPayrollCsv,
  computeEmployeePayroll,
  computeMonthlyAttendanceMatrix,
  computePayrollLedgerOverview,
  formatAdvanceWhatsappMessage,
  formatAttendanceWhatsappMessage,
  formatINR,
  formatMonthlyAttendanceWhatsappMessage,
  formatPaymentSummaryWhatsappMessage,
  getAdvanceCategoryLabel,
  type PayrollLedgerSortKey,
} from '../utils/payroll';
import { evaluateWeeklyFoodAdvance, formatElapsedDurationLabel } from '../utils/foodFollowUp';
import {
  buildWeeklyFoodDecisionWhatsappMessage,
  buildWhatsappDirectUrl,
  getEffectiveAdvanceApprovalStatus,
  groupWeeklyFoodApprovalBatches,
  resolveAdminApprovalContact,
} from '../utils/weeklyFoodApproval';
import {
  getWorkStatusBadgeClass,
  getWorkStatusLabel,
  isActiveWorkStatus,
} from '../utils/tileZones';
import { AdvanceScreenshotImportModal } from './AdvanceScreenshotImportModal';
import {
  ImageProofLightboxModal,
  type ProofLightboxPayload,
} from './ImageProofLightboxModal';
import { IndividualPaymentDetailsModal } from './IndividualPaymentDetailsModal';
import { PaymentProofUploadBox, type PaymentProofState } from './PaymentProofUploadBox';
import { PrintPreviewOverlay } from './PrintPreviewOverlay';
import { PrintableAttendanceCardSheet } from './PrintableAttendanceCardSheet';
import { QuickScanAttendanceModal } from './QuickScanAttendanceModal';
import { SupervisorAnalyticsPanel } from './SupervisorAnalyticsPanel';
import {
  WeeklyFoodApprovalWhatsappModal,
  type WeeklyFoodApprovalModalPayload,
} from './WeeklyFoodApprovalWhatsappModal';

type PayrollTab = 'attendance' | 'employee_card' | 'monthly' | 'advances' | 'payroll' | 'history';

interface AttendancePayrollViewProps {
  preselectedEmployeeCard?: { employeeId: string; nonce: number };
  onOpenGiveAdvance: (employeeId?: string) => void;
  onTriggerWhatsapp: (payload: WhatsappMessagePayload) => void;
}

function triggerDownloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function AttendancePayrollView({
  preselectedEmployeeCard,
  onOpenGiveAdvance,
  onTriggerWhatsapp,
}: AttendancePayrollViewProps) {
  const {
    session,
    companyProfile,
    projects: rawProjects,
    towers: rawTowers,
    employees: rawEmployees,
    assignments: rawAssignments,
    attendance: rawAttendance,
    advances: rawAdvances,
    settlements,
    markAttendance,
    editLockedAttendance,
    punchAttendanceOut,
    bulkMarkAttendancePresent,
    deleteAttendanceRecord,
    addSundayWeeklyFoodBatch,
    reviewWeeklyFoodApproval,
    completeAssignment,
    recordSettlement,
    acknowledgeAdvance,
    updateAdvance,
    deleteAdvance,
  } = useStore();

  const isAdmin = isAdminSession(session);
  const isSupervisor = isSupervisorSession(session);
  const hideSalary = !canViewEmployeeFixedSalary(session);

  const projects = useMemo(
    () => getScopedProjects(session, rawProjects, rawTowers),
    [session, rawProjects, rawTowers]
  );
  const towers = useMemo(() => getScopedTowers(session, rawTowers), [session, rawTowers]);
  const employees = useMemo(
    () => getScopedEmployees(session, rawEmployees),
    [session, rawEmployees]
  );
  const assignments = useMemo(
    () => getScopedAssignments(session, rawAssignments),
    [session, rawAssignments]
  );
  const attendance = useMemo(
    () => getScopedAttendance(session, rawAttendance, rawEmployees),
    [session, rawAttendance, rawEmployees]
  );
  const advances = useMemo(
    () => getScopedAdvances(session, rawAdvances, rawEmployees),
    [session, rawAdvances, rawEmployees]
  );

  const today = getTodayIso();
  const [activeTab, setActiveTab] = useState<PayrollTab>('attendance');
  useEffect(() => {
    if (!isAdmin && activeTab === 'payroll') {
      setActiveTab('attendance');
    }
  }, [isAdmin, activeTab]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || 'all');
  const [selectedTowerId, setSelectedTowerId] = useState<string>('all');
  const [monthlyProjectFilter, setMonthlyProjectFilter] = useState<string>('all');
  const [monthlySearch, setMonthlySearch] = useState('');
  const [attActionError, setAttActionError] = useState('');

  // Edit Locked Attendance Modal state
  const [editingAttModal, setEditingAttModal] = useState<{
    employee: Employee;
    date: string;
    record: AttendanceRecord;
  } | null>(null);
  const [editAttStatus, setEditAttStatus] = useState<AttendanceStatus>('present');
  const [editAttInTime, setEditAttInTime] = useState('');
  const [editAttOutTime, setEditAttOutTime] = useState('');
  const [editAttOt, setEditAttOt] = useState('0');
  const [editAttNotes, setEditAttNotes] = useState('');
  const [editAttReason, setEditAttReason] = useState('');
  const [editAttAdminPin, setEditAttAdminPin] = useState('');
  const [editAttError, setEditAttError] = useState('');
  const [editAttSaving, setEditAttSaving] = useState(false);

  // Employee-Wise Attendance Card state
  const [cardEmpId, setCardEmpId] = useState<string>(employees[0]?.id || '');
  const [cardMonth, setCardMonth] = useState<string>(today.slice(0, 7));
  const [cardSelectedDate, setCardSelectedDate] = useState<string>(today);
  const [cardStatus, setCardStatus] = useState<AttendanceStatus>('present');
  const [cardProjectId, setCardProjectId] = useState<string>(employees[0]?.currentProjectId || projects[0]?.id || '');
  const [cardTowerId, setCardTowerId] = useState<string>(employees[0]?.currentTowerId || '');
  const [cardInTime, setCardInTime] = useState<string>('');
  const [cardOutTime, setCardOutTime] = useState<string>('');
  const [cardOtHours, setCardOtHours] = useState<string>('0');
  const [cardNotes, setCardNotes] = useState<string>('');
  const [cardSavedMsg, setCardSavedMsg] = useState<string>('');
  const [cardError, setCardError] = useState<string>('');
  const [cardSaving, setCardSaving] = useState(false);

  // Admin-only Edit Advance Modal state
  const [editingAdvance, setEditingAdvance] = useState<AdvanceEntry | null>(null);
  const [editAdvDate, setEditAdvDate] = useState('');
  const [editAdvType, setEditAdvType] = useState<AdvanceType>('daily_food');
  const [editAdvCustomCategory, setEditAdvCustomCategory] = useState('');
  const [editAdvAmount, setEditAdvAmount] = useState('');
  const [editAdvMode, setEditAdvMode] = useState<PaymentMode>('cash');
  const [editAdvNotes, setEditAdvNotes] = useState('');
  const [editAdvError, setEditAdvError] = useState('');
  const [editAdvSaving, setEditAdvSaving] = useState(false);

  // Food & Cash Advances filters + Sunday Weekly Food Batch
  const [advTypeFilter, setAdvTypeFilter] = useState<'all' | AdvanceType>('all');
  const [advProjectFilter, setAdvProjectFilter] = useState<string>('all');
  const [advTowerFilter, setAdvTowerFilter] = useState<string>('all');
  const [advRefDate, setAdvRefDate] = useState<string>(today);
  const [showSundayBatchModal, setShowSundayBatchModal] = useState(false);
  const [sundayBatchDate, setSundayBatchDate] = useState(today);
  const [sundayBatchProjectId, setSundayBatchProjectId] = useState(projects[0]?.id || '');
  const [sundayBatchTowerId, setSundayBatchTowerId] = useState<string>('all');
  const [sundayBatchMode, setSundayBatchMode] = useState<PaymentMode>('cash');
  const [sundayBatchNotes, setSundayBatchNotes] = useState('Sunday Weekly Food Advance Run');
  const [sundayAmounts, setSundayAmounts] = useState<Record<string, { checked: boolean; amount: string }>>({});
  const [sundayRequireAdminApproval, setSundayRequireAdminApproval] = useState(true);
  const [savingSundayBatch, setSavingSundayBatch] = useState(false);
  const [weeklyFoodWaModal, setWeeklyFoodWaModal] =
    useState<WeeklyFoodApprovalModalPayload | null>(null);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const pendingFoodBatches = useMemo(
    () => groupWeeklyFoodApprovalBatches(rawAdvances, 'pending_admin'),
    [rawAdvances]
  );

  const [historySearch, setHistorySearch] = useState('');

  // Period filter & unified Employee-Wise Advances + Expenses filters for Payroll
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [payrollSearch, setPayrollSearch] = useState('');
  const [payrollProjectFilter, setPayrollProjectFilter] = useState('all');
  const [payrollTowerFilter, setPayrollTowerFilter] = useState('all');
  const [payrollOnlyActivity, setPayrollOnlyActivity] = useState(false);
  const [payrollSortBy, setPayrollSortBy] = useState<PayrollLedgerSortKey>('expenses_desc');
  const [expandedPayrollEmpIds, setExpandedPayrollEmpIds] = useState<Record<string, boolean>>({});
  const [settlingEmpId, setSettlingEmpId] = useState<string | null>(null);
  const [settleMode, setSettleMode] = useState<PaymentMode>('upi');
  const [settlePaymentApp, setSettlePaymentApp] = useState('');
  const [settleTransactionId, setSettleTransactionId] = useState('');
  const [settleUpiId, setSettleUpiId] = useState('');
  const [settleProofImageDataUrl, setSettleProofImageDataUrl] = useState('');
  const [settleNotes, setSettleNotes] = useState('');

  const [showOcrImportModal, setShowOcrImportModal] = useState(false);
  const [importSuccessMsg, setImportSuccessMsg] = useState('');
  const [proofLightbox, setProofLightbox] = useState<ProofLightboxPayload | null>(null);
  const [indivDetailsEmpId, setIndivDetailsEmpId] = useState<string | null>(null);
  const [showPrintCardPreview, setShowPrintCardPreview] = useState(false);
  const [showQuickScanModal, setShowQuickScanModal] = useState(false);

  const companyName = companyProfile?.companyName || 'AVY INFRA';

  useEffect(() => {
    if (!isAdmin && activeTab === 'payroll') {
      setActiveTab('attendance');
    }
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (selectedProjectId !== 'all' && !projects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(projects[0]?.id || 'all');
      setSelectedTowerId('all');
    }
  }, [projects, selectedProjectId]);

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === 'active'),
    [employees]
  );

  useEffect(() => {
    if (preselectedEmployeeCard?.employeeId) {
      setCardEmpId(preselectedEmployeeCard.employeeId);
      setActiveTab('employee_card');
    }
  }, [preselectedEmployeeCard]);

  const cardEmployee = useMemo(
    () =>
      employees.find((e) => e.id === cardEmpId) ||
      activeEmployees[0] ||
      employees[0] ||
      null,
    [employees, activeEmployees, cardEmpId]
  );

  const employeeCardData = useMemo(() => {
    if (!cardEmployee) return null;
    return computeSingleEmployeeAttendanceCard({
      employee: cardEmployee,
      yearMonth: cardMonth,
      attendance,
      advances,
    });
  }, [cardEmployee, cardMonth, attendance, advances]);

  const cardDayRecord = useMemo(
    () =>
      cardEmployee
        ? attendance.find((a) => a.employeeId === cardEmployee.id && a.date === cardSelectedDate)
        : undefined,
    [cardEmployee, attendance, cardSelectedDate]
  );

  const todayCardRecord = useMemo(
    () =>
      cardEmployee
        ? attendance.find((a) => a.employeeId === cardEmployee.id && a.date === today)
        : undefined,
    [cardEmployee, attendance, today]
  );

  const openEditAttendanceModal = (emp: Employee, date: string, record: AttendanceRecord) => {
    setEditingAttModal({ employee: emp, date, record });
    setEditAttStatus(record.status);
    setEditAttInTime(record.inTime || '');
    setEditAttOutTime(record.outTime || '');
    setEditAttOt(String(record.overtimeHours || 0));
    setEditAttNotes(record.notes || '');
    setEditAttReason('');
    setEditAttAdminPin('');
    setEditAttError('');
  };

  const handleSaveEditedAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAttModal) return;
    setEditAttError('');
    setEditAttSaving(true);
    try {
      await editLockedAttendance({
        date: editingAttModal.date,
        employeeId: editingAttModal.employee.id,
        projectId:
          editingAttModal.record.projectId ||
          editingAttModal.employee.currentProjectId ||
          projects[0]?.id ||
          '',
        towerId: editingAttModal.record.towerId || editingAttModal.employee.currentTowerId || undefined,
        status: editAttStatus,
        inTime: editAttStatus === 'absent' ? '' : normalizeHHMM(editAttInTime),
        outTime: editAttStatus === 'absent' ? '' : normalizeHHMM(editAttOutTime),
        overtimeHours: editAttStatus === 'absent' ? 0 : Number(editAttOt) || 0,
        notes: editAttNotes.trim(),
        editReason: editAttReason.trim(),
        adminPin: editAttAdminPin.trim() || undefined,
      });
      setEditingAttModal(null);
      setCardSavedMsg(
        `Updated attendance for ${editingAttModal.employee.fullName} on ${editingAttModal.date}`
      );
    } catch (err) {
      setEditAttError(err instanceof Error ? err.message : 'Could not update attendance.');
    } finally {
      setEditAttSaving(false);
    }
  };

  const openEditAdvanceModal = (adv: AdvanceEntry) => {
    if (!isAdmin || hideSalary) return;
    setEditingAdvance(adv);
    setEditAdvDate(adv.date);
    setEditAdvType(adv.advanceType);
    setEditAdvCustomCategory(adv.customCategory || '');
    setEditAdvAmount(String(adv.amount));
    setEditAdvMode(adv.paymentMode);
    setEditAdvNotes(adv.notes || '');
    setEditAdvError('');
  };

  const handleSaveEditedAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAdvance || !isAdmin || hideSalary) return;
    const numericAmount = Number(editAdvAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setEditAdvError('Enter a valid amount greater than 0.');
      return;
    }
    setEditAdvError('');
    setEditAdvSaving(true);
    try {
      await updateAdvance(editingAdvance.id, {
        date: editAdvDate || editingAdvance.date,
        advanceType: editAdvType,
        customCategory: editAdvType === 'custom' ? editAdvCustomCategory.trim() : '',
        amount: numericAmount,
        paymentMode: editAdvMode,
        notes: editAdvNotes.trim(),
      });
      setEditingAdvance(null);
    } catch (err) {
      setEditAdvError(err instanceof Error ? err.message : 'Unable to update advance.');
    } finally {
      setEditAdvSaving(false);
    }
  };

  useEffect(() => {
    if (!cardEmployee) return;
    if (cardDayRecord) {
      setCardStatus(cardDayRecord.status);
      setCardProjectId(cardDayRecord.projectId || cardEmployee.currentProjectId || projects[0]?.id || '');
      setCardTowerId(cardDayRecord.towerId || cardEmployee.currentTowerId || '');
      setCardInTime(cardDayRecord.inTime || '');
      setCardOutTime(cardDayRecord.outTime || '');
      setCardOtHours(String(cardDayRecord.overtimeHours || 0));
      setCardNotes(cardDayRecord.notes || '');
    } else {
      setCardStatus('present');
      setCardProjectId(cardEmployee.currentProjectId || projects[0]?.id || '');
      setCardTowerId(cardEmployee.currentTowerId || '');
      setCardInTime('');
      setCardOutTime('');
      setCardOtHours('0');
      setCardNotes('');
    }
  }, [cardEmployee?.id, cardSelectedDate, cardDayRecord]);

  const availableAttendanceTowers = useMemo(() => {
    if (selectedProjectId === 'all') return towers;
    return towers.filter((t) => t.projectId === selectedProjectId);
  }, [towers, selectedProjectId]);

  const selectedProjectObj = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const selectedTowerObj = useMemo(
    () => towers.find((t) => t.id === selectedTowerId),
    [towers, selectedTowerId]
  );

  const dateAttendanceRecords = useMemo(
    () => attendance.filter((a) => a.date === selectedDate),
    [attendance, selectedDate]
  );

  // Scoped crew for Daily Attendance table
  const scopedDailyEmployees = useMemo(() => {
    if (selectedProjectId === 'all' && selectedTowerId === 'all') return activeEmployees;
    return activeEmployees.filter((emp) => {
      if (selectedProjectId !== 'all' && emp.currentProjectId !== selectedProjectId) {
        const hasRec = dateAttendanceRecords.some(
          (a) => a.employeeId === emp.id && a.projectId === selectedProjectId
        );
        if (!hasRec) return false;
      }
      if (selectedTowerId !== 'all' && emp.currentTowerId !== selectedTowerId) {
        const hasRec = dateAttendanceRecords.some(
          (a) => a.employeeId === emp.id && a.towerId === selectedTowerId
        );
        if (!hasRec) return false;
      }
      return true;
    });
  }, [activeEmployees, selectedProjectId, selectedTowerId, dateAttendanceRecords]);

  // Live Tower/Project Attendance Summary
  const towerAttendanceSummary = useMemo(
    () =>
      computeTowerAttendanceSummary({
        date: selectedDate,
        projectId: selectedProjectId,
        towerId: selectedTowerId,
        employees,
        attendance,
      }),
    [selectedDate, selectedProjectId, selectedTowerId, employees, attendance]
  );

  const monthlyMatrix = useMemo(
    () =>
      computeMonthlyAttendanceMatrix(
        activeEmployees,
        attendance,
        selectedMonth,
        monthlyProjectFilter
      ),
    [activeEmployees, attendance, selectedMonth, monthlyProjectFilter]
  );

  const filteredMonthlyRows = useMemo(() => {
    if (!monthlySearch.trim()) return monthlyMatrix.rows;
    const q = monthlySearch.trim().toLowerCase();
    return monthlyMatrix.rows.filter(
      (r) =>
        r.employee.fullName.toLowerCase().includes(q) ||
        r.employee.empCode.toLowerCase().includes(q) ||
        r.employee.role.toLowerCase().includes(q)
    );
  }, [monthlyMatrix, monthlySearch]);

  const availableAdvTowers = useMemo(() => {
    if (advProjectFilter === 'all') return towers;
    return towers.filter((t) => t.projectId === advProjectFilter);
  }, [towers, advProjectFilter]);

  const filteredAdvances = useMemo(() => {
    return advances
      .filter((a) => {
        if (advTypeFilter !== 'all' && a.advanceType !== advTypeFilter) return false;
        const emp = employees.find((e) => e.id === a.employeeId);
        const pId = a.projectId || emp?.currentProjectId || '';
        const tId = a.towerId || emp?.currentTowerId || '';
        if (advProjectFilter !== 'all' && pId !== advProjectFilter) return false;
        if (advTowerFilter !== 'all' && tId !== advTowerFilter) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [advances, employees, advTypeFilter, advProjectFilter, advTowerFilter]);

  const foodBreakdown = useMemo(
    () =>
      computeTowerFoodExpenseBreakdown({
        referenceDate: advRefDate,
        advances,
        employees,
        projectId: advProjectFilter,
        towerId: advTowerFilter,
      }),
    [advRefDate, advances, employees, advProjectFilter, advTowerFilter]
  );

  const payrollSummaries = useMemo(() => {
    return employees.map((emp) =>
      computeEmployeePayroll(
        emp,
        attendance,
        advances,
        settlements,
        periodStart || periodEnd
          ? { start: periodStart || undefined, end: periodEnd || undefined }
          : undefined
      )
    );
  }, [employees, attendance, advances, settlements, periodStart, periodEnd]);

  const payrollTowersForFilter = useMemo(() => {
    if (payrollProjectFilter === 'all') return towers;
    return towers.filter((t) => t.projectId === payrollProjectFilter);
  }, [towers, payrollProjectFilter]);

  const payrollLedgerOverview = useMemo(
    () =>
      computePayrollLedgerOverview({
        employees,
        attendance,
        advances,
        settlements,
        dateRange:
          periodStart || periodEnd
            ? { start: periodStart || undefined, end: periodEnd || undefined }
            : undefined,
        projectId: payrollProjectFilter,
        towerId: payrollTowerFilter,
        search: payrollSearch,
        onlyWithActivity: payrollOnlyActivity,
        sortBy: payrollSortBy,
      }),
    [
      employees,
      attendance,
      advances,
      settlements,
      periodStart,
      periodEnd,
      payrollProjectFilter,
      payrollTowerFilter,
      payrollSearch,
      payrollOnlyActivity,
      payrollSortBy,
    ]
  );

  const filteredHistory = useMemo(() => {
    return assignments
      .filter((a) => {
        if (!historySearch.trim()) return true;
        const q = historySearch.trim().toLowerCase();
        return (
          a.unitNumber.toLowerCase().includes(q) ||
          a.zoneLabel.toLowerCase().includes(q) ||
          a.employeeName.toLowerCase().includes(q) ||
          a.empCode.toLowerCase().includes(q) ||
          a.projectName.toLowerCase().includes(q) ||
          a.towerName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.assignedDate.localeCompare(a.assignedDate) || b.createdAt.localeCompare(a.createdAt));
  }, [assignments, historySearch]);

  const handleExportAttendancePdf = () => {
    const projectName = selectedProjectObj?.name || 'All Projects';
    const towerName = selectedTowerObj?.name || 'All Towers';
    const formatItem = (item: typeof towerAttendanceSummary.presentList[number]) =>
      `${item.employee.empCode} — ${item.employee.fullName} (${item.employee.role})${
        item.record?.overtimeHours ? ` [+${item.record.overtimeHours}h OT]` : ''
      }`;

    const { blob, fileName } = buildTowerAttendancePdfBlob({
      companyName,
      projectName,
      towerName,
      date: selectedDate,
      inchargeInfo: selectedTowerObj?.inchargeName
        ? `Incharge: ${selectedTowerObj.inchargeName} (${selectedTowerObj.inchargePhone || '-'})`
        : undefined,
      supervisorInfo: selectedTowerObj?.supervisorName
        ? `Supervisor: ${selectedTowerObj.supervisorName} (${selectedTowerObj.supervisorPhone || '-'})`
        : undefined,
      engineerInfo: selectedTowerObj?.engineerName
        ? `Engineer: ${selectedTowerObj.engineerName} (${selectedTowerObj.engineerPhone || '-'})`
        : undefined,
      presentNames: towerAttendanceSummary.presentList.map(formatItem),
      halfDayNames: towerAttendanceSummary.halfDayList.map(formatItem),
      absentNames: towerAttendanceSummary.absentList.map(formatItem),
      unmarkedNames: towerAttendanceSummary.unmarkedList.map(formatItem),
      totalWageText: formatINR(towerAttendanceSummary.dailyWageTotal),
      hideWages: hideSalary,
    });

    triggerDownloadBlob(blob, fileName);
  };

  const handleShareTowerAttendanceWhatsapp = (recipientRole: 'supervisor' | 'incharge' | 'engineer' | 'default' = 'supervisor') => {
    const projectName = selectedProjectObj?.name || `All ${companyName} Sites`;
    const towerName = selectedTowerObj?.name || 'All Towers';

    let recipientName = 'Tower Supervisor';
    let recipientPhone = '';
    if (selectedTowerObj) {
      if (recipientRole === 'supervisor' && selectedTowerObj.supervisorPhone) {
        recipientName = `${selectedTowerObj.supervisorName || 'Tower Supervisor'} (${towerName})`;
        recipientPhone = selectedTowerObj.supervisorPhone;
      } else if (recipientRole === 'incharge' && selectedTowerObj.inchargePhone) {
        recipientName = `${selectedTowerObj.inchargeName || 'Tower Incharge'} (${towerName})`;
        recipientPhone = selectedTowerObj.inchargePhone;
      } else if (recipientRole === 'engineer' && selectedTowerObj.engineerPhone) {
        recipientName = `${selectedTowerObj.engineerName || 'Site Engineer'} (${towerName})`;
        recipientPhone = selectedTowerObj.engineerPhone;
      } else if (selectedTowerObj.supervisorPhone) {
        recipientName = `${selectedTowerObj.supervisorName || 'Supervisor'} (${towerName})`;
        recipientPhone = selectedTowerObj.supervisorPhone;
      }
    } else if (selectedProjectObj?.engineerPhone) {
      recipientName = selectedProjectObj.engineerName || 'Site Engineer';
      recipientPhone = selectedProjectObj.engineerPhone;
    }

    const message = formatTowerAttendanceWhatsappMessage({
      companyName,
      projectName,
      towerName,
      summary: towerAttendanceSummary,
      recipientLabel: recipientName,
    });

    onTriggerWhatsapp({
      title: 'Share Present/Absent Attendance to Tower Supervisor',
      recipientName,
      recipientPhone,
      recipientEmail: companyProfile?.hrEmail || '',
      emailSubject: `${companyName} Tower Attendance — ${projectName} / ${towerName} (${selectedDate})`,
      message,
    });
  };

  const handleShareDailyAttendanceWhatsapp = () => {
    if (selectedTowerObj || selectedProjectObj) {
      handleShareTowerAttendanceWhatsapp('supervisor');
      return;
    }
    const project = projects.find((p) => p.id === selectedProjectId);
    const recordsForDate =
      dateAttendanceRecords.length > 0
        ? dateAttendanceRecords
        : activeEmployees.map((emp) => ({
            id: `temp_${emp.id}`,
            ownerId: emp.ownerId,
            date: selectedDate,
            employeeId: emp.id,
            empCode: emp.empCode,
            employeeName: emp.fullName,
            employeeRole: emp.role,
            projectId: project?.id || '',
            projectName: project?.name || 'All Sites',
            status: 'absent' as AttendanceStatus,
            overtimeHours: 0,
            dailyWageEarned: 0,
            overtimePayEarned: 0,
            notes: '',
            createdAt: '',
            updatedAt: '',
          }));

    const message = formatAttendanceWhatsappMessage(
      selectedDate,
      project?.name || `All ${companyName} Sites`,
      recordsForDate,
      companyName
    );

    onTriggerWhatsapp({
      title: 'Share Daily Attendance (WhatsApp & Email)',
      recipientName: 'Site Management / Group',
      recipientPhone: '',
      recipientEmail: companyProfile?.hrEmail || '',
      emailSubject: `${companyName} Daily Attendance — ${selectedDate}`,
      message,
    });
  };

  const handleShareMonthlyAttendance = (singleEmployeeId?: string) => {
    const siteName =
      monthlyProjectFilter === 'all'
        ? 'All Sites'
        : projects.find((p) => p.id === monthlyProjectFilter)?.name || 'Site';
    const targetEmp = singleEmployeeId
      ? employees.find((e) => e.id === singleEmployeeId)
      : undefined;

    const message = formatMonthlyAttendanceWhatsappMessage(
      monthlyMatrix,
      siteName,
      companyName,
      singleEmployeeId,
      { hideWages: hideSalary }
    );

    onTriggerWhatsapp({
      title: targetEmp
        ? `Share Monthly Attendance (${monthlyMatrix.monthLabel})`
        : `Share Team Monthly Sheet (${monthlyMatrix.monthLabel})`,
      recipientName: targetEmp
        ? `${targetEmp.fullName} (${targetEmp.empCode})`
        : `${siteName} Crew Summary`,
      recipientPhone: targetEmp?.phone || '',
      recipientEmail: targetEmp?.email || companyProfile?.hrEmail || '',
      emailSubject: `${companyName} Monthly Attendance (${monthlyMatrix.monthLabel})${
        targetEmp ? ` — ${targetEmp.fullName}` : ''
      }`,
      message,
    });
  };

  const handleDownloadMonthlyPayrollCsv = () => {
    const exportMonth = activeTab === 'employee_card' ? cardMonth : selectedMonth;
    const projectFilterForExport =
      activeTab === 'monthly'
        ? monthlyProjectFilter
        : activeTab === 'payroll'
          ? payrollProjectFilter
          : selectedProjectId;
    const { csv, fileName } = buildMonthlyAttendanceAndPayrollCsv({
      yearMonth: exportMonth,
      employees,
      attendance,
      advances,
      settlements,
      projectIdFilter: projectFilterForExport,
      hideSalary,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    triggerDownloadBlob(blob, fileName);
  };

  const openSundayBatchModal = () => {
    const pId = advProjectFilter !== 'all' ? advProjectFilter : projects[0]?.id || '';
    const tId = advTowerFilter !== 'all' ? advTowerFilter : 'all';
    setSundayBatchProjectId(pId);
    setSundayBatchTowerId(tId);
    setSundayBatchDate(advRefDate);
    setSundayBatchMode('cash');
    setSundayBatchNotes('Sunday Weekly Food Advance Run');

    const map: Record<string, { checked: boolean; amount: string }> = {};
    for (const emp of activeEmployees) {
      const inProj = !pId || emp.currentProjectId === pId;
      const inTwr = tId === 'all' || emp.currentTowerId === tId;
      map[emp.id] = {
        checked: inProj && inTwr,
        amount: String((emp.foodAllowanceDaily || 150) * 6),
      };
    }
    setSundayAmounts(map);
    setSundayRequireAdminApproval(true);
    setShowSundayBatchModal(true);
  };

  const sundayBatchCrew = useMemo(() => {
    return activeEmployees.filter((emp) => {
      if (sundayBatchProjectId && emp.currentProjectId !== sundayBatchProjectId) return false;
      if (sundayBatchTowerId !== 'all' && emp.currentTowerId !== sundayBatchTowerId) return false;
      return true;
    });
  }, [activeEmployees, sundayBatchProjectId, sundayBatchTowerId]);

  const handleConfirmSundayBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const entries = sundayBatchCrew
      .filter((emp) => sundayAmounts[emp.id]?.checked)
      .map((emp) => ({
        employeeId: emp.id,
        amount: Number(sundayAmounts[emp.id]?.amount) || 0,
      }))
      .filter((entry) => entry.amount > 0);

    if (entries.length === 0) return;

    const batchId = `wfr_${Date.now().toString(36)}`;
    const approvalStatus = sundayRequireAdminApproval ? 'pending_admin' : 'approved';
    const projName =
      projects.find((p) => p.id === sundayBatchProjectId)?.name || 'All Projects';
    const twrName =
      sundayBatchTowerId !== 'all'
        ? towers.find((t) => t.id === sundayBatchTowerId)?.name || ''
        : '';
    const siteLabel = twrName ? `${projName} (${twrName})` : projName;

    setSavingSundayBatch(true);
    try {
      const createdEntries = await addSundayWeeklyFoodBatch({
        date: sundayBatchDate,
        projectId: sundayBatchProjectId || undefined,
        towerId: sundayBatchTowerId !== 'all' ? sundayBatchTowerId : undefined,
        entries,
        paymentMode: sundayBatchMode,
        notes: sundayBatchNotes,
        approvalStatus,
        approvalBatchId: batchId,
      });
      setShowSundayBatchModal(false);
      setWeeklyFoodWaModal({
        batchId,
        date: sundayBatchDate,
        siteLabel,
        submittedByName: session?.displayName || (isSupervisor ? 'Supervisor' : 'Admin'),
        submittedByRole: isSupervisor ? 'supervisor' : 'admin',
        entries: createdEntries,
        requiresAdminApproval: sundayRequireAdminApproval,
      });
    } finally {
      setSavingSundayBatch(false);
    }
  };

  const handleExportFoodCsv = () => {
    const headers = [
      'Date',
      'Employee ID',
      'Employee Name',
      'Project',
      'Tower',
      'Advance Type',
      'Sunday Run',
      'Mode',
      'Amount',
      'Notes',
    ];
    const rows = filteredAdvances.map((adv) => {
      const emp = employees.find((e) => e.id === adv.employeeId);
      const proj = projects.find((p) => p.id === (adv.projectId || emp?.currentProjectId));
      const twr = towers.find((t) => t.id === (adv.towerId || emp?.currentTowerId));
      return [
        adv.date,
        adv.empCode,
        `"${adv.employeeName.replace(/"/g, '""')}"`,
        `"${(proj?.name || emp?.currentProjectName || '').replace(/"/g, '""')}"`,
        `"${(twr?.name || emp?.currentTowerName || '').replace(/"/g, '""')}"`,
        `"${getAdvanceCategoryLabel(adv).replace(/"/g, '""')}"`,
        adv.isSundayRun || (adv.advanceType === 'weekly_food' && isSundayDate(adv.date))
          ? 'Yes'
          : 'No',
        adv.paymentMode.toUpperCase(),
        String(adv.amount),
        `"${(adv.notes || '').replace(/"/g, '""')}"`,
      ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    triggerDownloadBlob(blob, `${companyName.replace(/\s+/g, '_')}_Food_Cash_Advances_${advRefDate}.csv`);
  };

  const handleExportFoodPdf = () => {
    const scopeProj =
      advProjectFilter === 'all'
        ? 'All Projects'
        : projects.find((p) => p.id === advProjectFilter)?.name || 'Project';
    const scopeTwr =
      advTowerFilter === 'all'
        ? 'All Towers'
        : towers.find((t) => t.id === advTowerFilter)?.name || 'Tower';

    const towerScoped = towers.filter(
      (t) =>
        (advProjectFilter === 'all' || t.projectId === advProjectFilter) &&
        (advTowerFilter === 'all' || t.id === advTowerFilter)
    );

    const rows = towerScoped.map((twr) => {
      const proj = projects.find((p) => p.id === twr.projectId);
      const br = computeTowerFoodExpenseBreakdown({
        referenceDate: advRefDate,
        advances,
        employees,
        projectId: twr.projectId,
        towerId: twr.id,
      });
      return {
        label: `${proj?.name || 'Project'} — ${twr.name}`,
        sublabel: `Daily: ${formatINR(br.dailyFoodTotal)} | Week (${br.weeklyRange.start}..${br.weeklyRange.end}): ${formatINR(br.weeklyFoodTotal)}`,
        wages: formatINR(br.dailyFoodTotal),
        food: formatINR(br.weeklyFoodTotal),
        cash: formatINR(br.sundayWeeklyFoodTotal),
        siteExp: formatINR(br.monthlyFoodTotal),
        total: formatINR(br.monthlyFoodTotal + br.cashAdvanceTotal),
      };
    });

    const { blob, fileName } = buildExpenseReportPdfBlob({
      companyName,
      reportTitle: 'Tower-Wise Daily, Weekly & Monthly Food Advance Report',
      periodLabel: `${scopeProj} / ${scopeTwr} | Ref Date: ${advRefDate}`,
      rows:
        rows.length > 0
          ? rows
          : [
              {
                label: `${scopeProj} — ${scopeTwr}`,
                sublabel: `Daily / Weekly / Monthly Food Summary`,
                wages: formatINR(foodBreakdown.dailyFoodTotal),
                food: formatINR(foodBreakdown.weeklyFoodTotal),
                cash: formatINR(foodBreakdown.sundayWeeklyFoodTotal),
                siteExp: formatINR(foodBreakdown.monthlyFoodTotal),
                total: formatINR(foodBreakdown.grandAdvanceTotal),
              },
            ],
      grandTotal: formatINR(foodBreakdown.monthlyFoodTotal),
    });

    triggerDownloadBlob(blob, fileName);
  };

  const handleShareFoodSummaryWhatsapp = () => {
    const scopeProj = projects.find((p) => p.id === advProjectFilter);
    const scopeTwr = towers.find((t) => t.id === advTowerFilter);
    const msg = [
      `*${companyName} — Tower Food Expense Summary*`,
      `Site: ${scopeProj?.name || 'All Projects'} | Tower: ${scopeTwr?.name || 'All Towers'}`,
      `Reference Date: ${advRefDate}${isSundayDate(advRefDate) ? ' (SUNDAY WEEKLY FOOD RUN)' : ''}`,
      `Daily Food (${advRefDate}): ${formatINR(foodBreakdown.dailyFoodTotal)}`,
      `Weekly Food (${foodBreakdown.weeklyRange.start} to ${foodBreakdown.weeklyRange.end}): ${formatINR(foodBreakdown.weeklyFoodTotal)}`,
      `Sunday Weekly Food Run Total: ${formatINR(foodBreakdown.sundayWeeklyFoodTotal)}`,
      `Monthly Food (${foodBreakdown.monthPrefix}): ${formatINR(foodBreakdown.monthlyFoodTotal)}`,
      `Cash Advances in Scope: ${formatINR(foodBreakdown.cashAdvanceTotal)}`,
      `— ${companyName} Accounts`,
    ].join('\n');

    onTriggerWhatsapp({
      title: 'Share Tower Food Expense Report (WhatsApp / Mail)',
      recipientName:
        scopeTwr?.supervisorName ||
        scopeTwr?.inchargeName ||
        scopeProj?.managerName ||
        'Site Supervisor / Accounts',
      recipientPhone:
        scopeTwr?.supervisorPhone ||
        scopeTwr?.inchargePhone ||
        scopeProj?.managerPhone ||
        '',
      recipientEmail: companyProfile?.hrEmail || '',
      emailSubject: `${companyName} Food Expense Report — ${scopeTwr?.name || scopeProj?.name || 'All Sites'} (${advRefDate})`,
      message: msg,
    });
  };

  const handleSettleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlingEmpId) return;
    await recordSettlement({
      employeeId: settlingEmpId,
      periodStart: periodStart || '2026-01-01',
      periodEnd: periodEnd || today,
      paymentMode: settleMode,
      paymentApp: settlePaymentApp.trim() || undefined,
      transactionId: settleTransactionId.trim() || undefined,
      upiId: settleUpiId.trim() || undefined,
      proofImageDataUrl: settleProofImageDataUrl || undefined,
      notes: settleNotes,
    });
    setSettlingEmpId(null);
    setSettlePaymentApp('');
    setSettleTransactionId('');
    setSettleUpiId('');
    setSettleProofImageDataUrl('');
    setSettleNotes('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {hideSalary
              ? 'Tower Attendance & Food Advances'
              : 'Attendance, Monthly Register & Payroll'}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {hideSalary
              ? 'Tower-wise daily & monthly attendance with Present/Absent PDF export and Sunday weekly food advances.'
              : 'Tower-wise daily & monthly attendance with Present/Absent PDF export, Sunday weekly food advances, and payroll settlement.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleDownloadMonthlyPayrollCsv}
            data-testid="download-csv-btn"
            title={`Download ${monthlyMatrix.monthLabel} attendance register and payroll CSV`}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="w-4 h-4 text-orange-700" aria-hidden="true" />
            <span>Download CSV</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'monthly') handleShareMonthlyAttendance();
              else if (activeTab === 'employee_card' && cardEmployee) {
                const matrix = computeMonthlyAttendanceMatrix(
                  [cardEmployee],
                  attendance,
                  cardMonth,
                  'all'
                );
                const msg = formatMonthlyAttendanceWhatsappMessage(
                  matrix,
                  cardEmployee.currentProjectName || 'All Sites',
                  companyName,
                  cardEmployee.id,
                  { hideWages: hideSalary }
                );
                onTriggerWhatsapp({
                  title: `Share Employee Attendance Card (${matrix.monthLabel})`,
                  recipientName: `${cardEmployee.fullName} (${cardEmployee.empCode})`,
                  recipientPhone: cardEmployee.phone,
                  recipientEmail: cardEmployee.email || companyProfile?.hrEmail || '',
                  emailSubject: `${companyName} Attendance Card (${matrix.monthLabel}) — ${cardEmployee.fullName}`,
                  message: msg,
                });
              } else if (activeTab === 'advances') handleShareFoodSummaryWhatsapp();
              else handleShareDailyAttendanceWhatsapp();
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap"
          >
            <MessageSquare className="w-4 h-4" aria-hidden="true" />
            <span>
              {activeTab === 'monthly'
                ? 'Share Monthly Report'
                : activeTab === 'employee_card'
                  ? 'Share Card (WA / Mail)'
                  : activeTab === 'advances'
                    ? 'Share Food Report'
                    : 'Share to Supervisor (WA)'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onOpenGiveAdvance()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Give Advance</span>
          </button>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/80 rounded-lg w-fit">
        {[
          { id: 'attendance' as const, label: 'Tower Attendance', icon: CalendarCheck },
          { id: 'employee_card' as const, label: 'Employee Attendance Card', icon: IdCard },
          { id: 'monthly' as const, label: 'Monthly Sheet', icon: CalendarRange },
          { id: 'advances' as const, label: 'Food & Cash Advances', icon: Wallet },
          ...(isAdmin
            ? [{ id: 'payroll' as const, label: 'Payroll & Settlements', icon: CheckCheck }]
            : []),
          { id: 'history' as const, label: 'Work History', icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
                active
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-700 hover:bg-white/60 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: DAILY ATTENDANCE (TOWER-WISE) */}
      {activeTab === 'attendance' && (
        <section className="space-y-4">
          {/* Controls + Tower Filter */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="att-date" className="block text-xs font-medium text-slate-500 mb-1">
                    Attendance Date
                  </label>
                  <input
                    id="att-date"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label htmlFor="att-proj" className="block text-xs font-medium text-slate-500 mb-1">
                    Site / Project
                  </label>
                  <select
                    id="att-proj"
                    value={selectedProjectId}
                    onChange={(e) => {
                      setSelectedProjectId(e.target.value);
                      setSelectedTowerId('all');
                    }}
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
                  <label htmlFor="att-tower" className="block text-xs font-medium text-slate-500 mb-1">
                    Tower / Block
                  </label>
                  <select
                    id="att-tower"
                    value={selectedTowerId}
                    onChange={(e) => setSelectedTowerId(e.target.value)}
                    className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    <option value="all">All Towers ({availableAttendanceTowers.length})</option>
                    {availableAttendanceTowers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {session?.role !== 'employee' && (
                  <button
                    type="button"
                    onClick={() => setShowQuickScanModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap"
                  >
                    <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Quick Scan Attendance</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleExportAttendancePdf}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                  <span>Export Present/Absent PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleShareTowerAttendanceWhatsapp('supervisor')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap"
                >
                  <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Share to Supervisor</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    bulkMarkAttendancePresent(
                      selectedDate,
                      selectedProjectId === 'all' ? projects[0]?.id || '' : selectedProjectId,
                      selectedTowerId !== 'all' ? selectedTowerId : undefined,
                      getCurrentHHMM()
                    )
                  }
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap"
                >
                  Mark Tower Crew Present
                </button>
              </div>
            </div>

            {/* Tower Attendance Status Strip + Present/Absent Quick List */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <div
                className={`grid grid-cols-2 ${
                  hideSalary ? 'sm:grid-cols-4' : 'sm:grid-cols-5'
                } gap-3`}
              >
                <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-md">
                  <div className="text-[11px] font-medium text-emerald-800">Present Crew</div>
                  <div className="text-lg font-mono font-bold text-emerald-900 tabular-nums">
                    {towerAttendanceSummary.presentCount}
                  </div>
                </div>
                <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-md">
                  <div className="text-[11px] font-medium text-amber-800">Half-Day</div>
                  <div className="text-lg font-mono font-bold text-amber-900 tabular-nums">
                    {towerAttendanceSummary.halfDayCount}
                  </div>
                </div>
                <div className="p-2.5 bg-red-50/70 border border-red-200 rounded-md">
                  <div className="text-[11px] font-medium text-red-800">Absent Crew</div>
                  <div className="text-lg font-mono font-bold text-red-900 tabular-nums">
                    {towerAttendanceSummary.absentCount}
                  </div>
                </div>
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-md">
                  <div className="text-[11px] font-medium text-slate-600">Unmarked</div>
                  <div className="text-lg font-mono font-bold text-slate-900 tabular-nums">
                    {towerAttendanceSummary.unmarkedCount}
                  </div>
                </div>
                {!hideSalary && (
                  <div className="p-2.5 bg-slate-900 text-white rounded-md">
                    <div className="text-[11px] text-slate-300">Day Wage Total</div>
                    <div className="text-lg font-mono font-bold tabular-nums">
                      {formatINR(towerAttendanceSummary.dailyWageTotal)}
                    </div>
                  </div>
                )}
              </div>

              {/* Present vs Absent Name Lists & Tower Contacts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                  <span className="font-semibold text-emerald-800">
                    Present ({towerAttendanceSummary.presentCount + towerAttendanceSummary.halfDayCount}):
                  </span>{' '}
                  <span className="text-slate-700">
                    {[...towerAttendanceSummary.presentList, ...towerAttendanceSummary.halfDayList]
                      .map((x) => `${x.employee.fullName}${x.status === 'half_day' ? ' (HD)' : ''}`)
                      .join(', ') || 'None marked yet'}
                  </span>
                </div>
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-red-800">
                      Absent ({towerAttendanceSummary.absentCount}):
                    </span>{' '}
                    <span className="text-slate-700">
                      {towerAttendanceSummary.absentList.map((x) => x.employee.fullName).join(', ') || 'None'}
                    </span>
                  </div>
                  {selectedTowerObj && (selectedTowerObj.supervisorName || selectedTowerObj.inchargeName) && (
                    <div className="text-[11px] text-slate-500 font-mono">
                      Sup: {selectedTowerObj.supervisorName || '—'} ({selectedTowerObj.supervisorPhone || 'No Ph'})
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <SupervisorAnalyticsPanel
            projects={projects}
            towers={towers}
            employees={employees}
            attendance={attendance}
            assignments={assignments}
            referenceDate={selectedDate}
            projectId={selectedProjectId}
            towerId={selectedTowerId}
          />

          {attActionError && (
            <div
              role="alert"
              className="p-3 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md flex items-center justify-between gap-2"
            >
              <span>{attActionError}</span>
              <button
                type="button"
                onClick={() => setAttActionError('')}
                className="text-red-700 hover:text-red-900 font-semibold"
              >
                Dismiss
              </button>
            </div>
          )}

          {isSupervisor && (
            <div className="p-3 text-xs text-slate-700 bg-amber-50/70 border border-amber-200 rounded-md flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
              <span>
                <strong>Supervisor Attendance Lock:</strong> Unmarked dates can be marked freely. Once marked, attendance is locked—use the <strong>Edit</strong> action button (with Edit Reason{companyProfile.supervisorCanEditAttendance ? '' : ' & Admin Edit PIN'}) to revise a marked entry.
              </span>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Employee ID</th>
                    <th className="py-2.5 px-3">Name, Role &amp; Tower</th>
                    <th className="py-2.5 px-3">Attendance Status</th>
                    <th className="py-2.5 px-3">In / Out Time</th>
                    <th className="py-2.5 px-3 text-right">OT Hours</th>
                    {!hideSalary && <th className="py-2.5 px-3 text-right">Day Wage Earned</th>}
                    <th className="py-2.5 px-4 text-right">Lock / Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {scopedDailyEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={hideSalary ? 6 : 7} className="py-10 text-center text-slate-500">
                        No active crew currently allocated to this Project / Tower filter. Use &ldquo;Allocate Crew to Tower&rdquo; in Workforce or select &ldquo;All Towers&rdquo;.
                      </td>
                    </tr>
                  ) : (
                    scopedDailyEmployees.map((emp) => {
                      const rec = dateAttendanceRecords.find((a) => a.employeeId === emp.id);
                      const currentStatus = rec?.status;
                      const otHours = rec?.overtimeHours ?? 0;
                      const earned = (rec?.dailyWageEarned ?? 0) + (rec?.overtimePayEarned ?? 0);
                      const isLockedForUser = Boolean(rec) && isSupervisor;
                      const effectiveProjId =
                        selectedProjectId !== 'all'
                          ? selectedProjectId
                          : emp.currentProjectId || projects[0]?.id || '';
                      const effectiveTowerId =
                        selectedTowerId !== 'all' ? selectedTowerId : emp.currentTowerId || undefined;
                      const workedInfo = computeWorkedHoursFromInOut(rec?.inTime, rec?.outTime);

                      return (
                        <tr key={emp.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                            {emp.empCode}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-slate-900">{emp.fullName}</div>
                            <div className="text-xs text-slate-500">
                              {emp.role}
                              {!hideSalary ? ` · Rate ${formatINR(emp.dailyRate)}/day` : ''}
                              {emp.currentTowerName ? ` · ${emp.currentTowerName}` : ''}
                            </div>
                            {rec?.editReason && (
                              <div className="text-[11px] text-amber-800 mt-0.5">
                                Edited: {rec.editReason}
                                {rec.editedByName ? ` (${rec.editedByName})` : ''}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="inline-flex items-center gap-1.5">
                              {(
                                [
                                  { id: 'present', label: 'Present', cls: 'bg-emerald-700 text-white border-emerald-700' },
                                  { id: 'half_day', label: 'Half Day', cls: 'bg-amber-600 text-white border-amber-600' },
                                  { id: 'absent', label: 'Absent', cls: 'bg-red-700 text-white border-red-700' },
                                ] as const
                              ).map((btn) => {
                                const selected = currentStatus === btn.id;
                                return (
                                  <button
                                    key={btn.id}
                                    type="button"
                                    disabled={isLockedForUser}
                                    title={
                                      isLockedForUser
                                        ? 'Locked once marked — click Edit to revise'
                                        : undefined
                                    }
                                    aria-label={`Mark ${emp.fullName} as ${btn.label}`}
                                    onClick={async () => {
                                      setAttActionError('');
                                      try {
                                        await markAttendance({
                                          date: selectedDate,
                                          employeeId: emp.id,
                                          projectId: effectiveProjId,
                                          towerId: effectiveTowerId,
                                          status: btn.id,
                                          inTime:
                                            btn.id === 'absent'
                                              ? ''
                                              : rec?.inTime || getCurrentHHMM(),
                                          outTime: btn.id === 'absent' ? '' : rec?.outTime || '',
                                          overtimeHours: btn.id === 'absent' ? 0 : otHours,
                                        });
                                      } catch (err) {
                                        setAttActionError(
                                          err instanceof Error ? err.message : 'Attendance action blocked.'
                                        );
                                      }
                                    }}
                                    className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap disabled:opacity-65 disabled:cursor-not-allowed ${
                                      selected
                                        ? btn.cls
                                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                                    }`}
                                  >
                                    {btn.label}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {rec && currentStatus !== 'absent' ? (
                              <div className="space-y-1">
                                <div className="inline-flex items-center gap-1.5">
                                  <input
                                    type="time"
                                    aria-label={`In time for ${emp.fullName}`}
                                    value={rec.inTime || ''}
                                    disabled={isLockedForUser}
                                    onChange={async (e) => {
                                      setAttActionError('');
                                      try {
                                        await markAttendance({
                                          date: selectedDate,
                                          employeeId: emp.id,
                                          projectId: effectiveProjId,
                                          towerId: effectiveTowerId,
                                          status: currentStatus || 'present',
                                          inTime: e.target.value,
                                          outTime: rec.outTime || '',
                                          overtimeHours: otHours,
                                        });
                                      } catch (err) {
                                        setAttActionError(
                                          err instanceof Error ? err.message : 'Attendance action blocked.'
                                        );
                                      }
                                    }}
                                    className="px-1.5 py-0.5 text-[11px] font-mono border border-slate-300 rounded disabled:bg-slate-100"
                                  />
                                  <span className="text-[10px] text-slate-400">→</span>
                                  <input
                                    type="time"
                                    aria-label={`Out time for ${emp.fullName}`}
                                    value={rec.outTime || ''}
                                    disabled={isLockedForUser}
                                    onChange={async (e) => {
                                      setAttActionError('');
                                      try {
                                        await markAttendance({
                                          date: selectedDate,
                                          employeeId: emp.id,
                                          projectId: effectiveProjId,
                                          towerId: effectiveTowerId,
                                          status: currentStatus || 'present',
                                          inTime: rec.inTime || '',
                                          outTime: e.target.value,
                                          overtimeHours: otHours,
                                        });
                                      } catch (err) {
                                        setAttActionError(
                                          err instanceof Error ? err.message : 'Attendance action blocked.'
                                        );
                                      }
                                    }}
                                    className="px-1.5 py-0.5 text-[11px] font-mono border border-slate-300 rounded disabled:bg-slate-100"
                                  />
                                  {!rec.outTime && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        setAttActionError('');
                                        try {
                                          await punchAttendanceOut({
                                            attendanceId: rec.id,
                                            employeeId: emp.id,
                                            date: selectedDate,
                                            outTime: getCurrentHHMM(),
                                          });
                                        } catch (err) {
                                          setAttActionError(
                                            err instanceof Error ? err.message : 'Could not punch out.'
                                          );
                                        }
                                      }}
                                      aria-label={`Check Out ${emp.fullName}`}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-amber-900 bg-amber-100 border border-amber-300 rounded hover:bg-amber-200"
                                    >
                                      <LogOut className="w-3 h-3" aria-hidden="true" />
                                      <span>Check Out</span>
                                    </button>
                                  )}
                                </div>
                                {workedInfo.valid && (
                                  <div className="text-[10px] font-mono text-slate-500">
                                    Shift: {workedInfo.totalHours}h
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400">
                                {currentStatus === 'absent' ? 'Absent' : 'Mark status first'}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <input
                              type="number"
                              min="0"
                              max="16"
                              step="0.5"
                              aria-label={`Overtime hours for ${emp.fullName}`}
                              value={otHours}
                              disabled={!currentStatus || currentStatus === 'absent' || isLockedForUser}
                              onChange={async (e) => {
                                setAttActionError('');
                                try {
                                  await markAttendance({
                                    date: selectedDate,
                                    employeeId: emp.id,
                                    projectId: effectiveProjId,
                                    towerId: effectiveTowerId,
                                    status: currentStatus || 'present',
                                    inTime: rec?.inTime || '',
                                    outTime: rec?.outTime || '',
                                    overtimeHours: Number(e.target.value) || 0,
                                  });
                                } catch (err) {
                                  setAttActionError(
                                    err instanceof Error ? err.message : 'Attendance action blocked.'
                                  );
                                }
                              }}
                              className="w-16 px-2 py-1 text-right text-xs font-mono tabular-nums border border-slate-300 rounded disabled:bg-slate-100"
                            />
                          </td>
                          {!hideSalary && (
                            <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                              {formatINR(earned)}
                            </td>
                          )}
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {rec ? (
                              <div className="inline-flex items-center gap-1.5">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border ${
                                    rec.editReason
                                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                                      : 'bg-slate-100 text-slate-700 border-slate-200'
                                  }`}
                                >
                                  <Lock className="w-3 h-3" aria-hidden="true" />
                                  <span>{rec.editReason ? 'Edited' : 'Locked'}</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openEditAttendanceModal(emp, selectedDate, rec)}
                                  aria-label={`Edit attendance for ${emp.fullName}`}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                                >
                                  <Pencil className="w-3 h-3" aria-hidden="true" />
                                  <span>Edit</span>
                                </button>
                              </div>
                            ) : (
                              <span className="text-[11px] font-medium text-emerald-700">Open to Mark</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* TAB 1B: EMPLOYEE-WISE ATTENDANCE CARD */}
      {activeTab === 'employee_card' && (
        <section className="space-y-4">
          {!cardEmployee || !employeeCardData ? (
            <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-500">
              Add an employee in Workforce &amp; IDs to use the Employee Attendance Card.
            </div>
          ) : (
            <>
              {/* Selector Bar + Employee Summary Card */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label htmlFor="card-emp-select" className="block text-xs font-medium text-slate-500 mb-1">
                        Select Employee
                      </label>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label="Previous employee"
                          onClick={() => {
                            const idx = employees.findIndex((e) => e.id === cardEmployee.id);
                            if (idx > 0) setCardEmpId(employees[idx - 1].id);
                            else if (employees.length > 0) setCardEmpId(employees[employees.length - 1].id);
                          }}
                          className="p-1.5 text-slate-600 bg-slate-50 border border-slate-300 rounded-md hover:bg-slate-100"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <select
                          id="card-emp-select"
                          value={cardEmployee.id}
                          onChange={(e) => setCardEmpId(e.target.value)}
                          className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md min-w-[240px]"
                        >
                          {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {emp.empCode} · {emp.fullName} ({emp.role})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label="Next employee"
                          onClick={() => {
                            const idx = employees.findIndex((e) => e.id === cardEmployee.id);
                            if (idx >= 0 && idx < employees.length - 1) setCardEmpId(employees[idx + 1].id);
                            else if (employees.length > 0) setCardEmpId(employees[0].id);
                          }}
                          className="p-1.5 text-slate-600 bg-slate-50 border border-slate-300 rounded-md hover:bg-slate-100"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="card-month" className="block text-xs font-medium text-slate-500 mb-1">
                        Card Month
                      </label>
                      <input
                        id="card-month"
                        type="month"
                        value={cardMonth}
                        onChange={(e) => {
                          const nextMonth = e.target.value;
                          setCardMonth(nextMonth);
                          if (!cardSelectedDate.startsWith(nextMonth)) {
                            setCardSelectedDate(`${nextMonth}-01`);
                          }
                        }}
                        className="px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-md"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={Boolean(todayCardRecord) && isSupervisor}
                      title={
                        todayCardRecord && isSupervisor
                          ? 'Today attendance is already marked and locked'
                          : undefined
                      }
                      onClick={async () => {
                        setCardError('');
                        setCardSavedMsg('');
                        try {
                          const projId = cardEmployee.currentProjectId || projects[0]?.id || '';
                          const twrId = cardEmployee.currentTowerId || undefined;
                          await markAttendance({
                            date: today,
                            employeeId: cardEmployee.id,
                            projectId: projId,
                            towerId: twrId,
                            status: 'present',
                            inTime: getCurrentHHMM(),
                            overtimeHours: 0,
                            notes: 'Marked from Employee Attendance Card',
                          });
                          setCardMonth(today.slice(0, 7));
                          setCardSelectedDate(today);
                          setCardSavedMsg(`Marked Present for Today (${today})`);
                        } catch (err) {
                          setCardError(
                            err instanceof Error ? err.message : 'Unable to mark today present.'
                          );
                        }
                      }}
                      className="px-3 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      {todayCardRecord && isSupervisor ? 'Today Locked' : 'Mark Today Present'}
                    </button>
                    {todayCardRecord &&
                      todayCardRecord.status !== 'absent' &&
                      !todayCardRecord.outTime && (
                        <button
                          type="button"
                          onClick={async () => {
                            setCardError('');
                            setCardSavedMsg('');
                            try {
                              const outNow = getCurrentHHMM();
                              await punchAttendanceOut({
                                attendanceId: todayCardRecord.id,
                                employeeId: cardEmployee.id,
                                date: today,
                                outTime: outNow,
                              });
                              setCardSavedMsg(`Checked out for Today (${today}) at ${outNow}`);
                            } catch (err) {
                              setCardError(
                                err instanceof Error ? err.message : 'Unable to punch out.'
                              );
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-950 bg-amber-100 border border-amber-300 rounded-md hover:bg-amber-200 whitespace-nowrap"
                        >
                          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Punch Out Today</span>
                        </button>
                      )}
                    <button
                      type="button"
                      onClick={() => setShowPrintCardPreview(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap"
                    >
                      <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Print Attendance Card</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const siteStr = cardEmployee.currentProjectName
                          ? `${cardEmployee.currentProjectName}${
                              cardEmployee.currentTowerName ? ` (${cardEmployee.currentTowerName})` : ''
                            }`
                          : 'Unassigned';
                        const { blob, fileName } = buildEmployeeAttendanceCardPdfBlob({
                          companyName,
                          empCode: cardEmployee.empCode,
                          employeeName: cardEmployee.fullName,
                          role: cardEmployee.role,
                          phone: cardEmployee.phone,
                          siteLabel: siteStr,
                          dailyRateText: `${formatINR(cardEmployee.dailyRate)}/day`,
                          monthLabel: employeeCardData.monthLabel,
                          presentDays: employeeCardData.presentDays,
                          halfDays: employeeCardData.halfDays,
                          absentDays: employeeCardData.absentDays,
                          effectiveDays: employeeCardData.effectiveDays,
                          overtimeHours: employeeCardData.overtimeHours,
                          totalWagesEarnedText: formatINR(employeeCardData.totalWagesEarned),
                          monthAdvancesText: formatINR(employeeCardData.monthAdvancesTotal),
                          hideSalaryRates: hideSalary,
                          days: employeeCardData.days.map((d) => ({
                            day: d.day,
                            date: d.date,
                            weekdayShort: d.weekdayShort,
                            statusLabel: d.status ? ATTENDANCE_STATUS_LABELS[d.status] : 'Unmarked',
                            siteLabel: d.projectName
                              ? `${d.projectName}${d.towerName ? ` / ${d.towerName}` : ''}`
                              : siteStr,
                            otHours: d.overtimeHours,
                            earnedText: d.earned > 0 ? formatINR(d.earned) : '-',
                            notes: d.record?.notes || '',
                          })),
                        });
                        triggerDownloadBlob(blob, fileName);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                      <span>Export Card PDF</span>
                    </button>
                  </div>
                </div>

                {/* Employee Profile + Monthly Stats Row */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-12 h-14 rounded-md border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                      {cardEmployee.photoDataUrl ? (
                        <img
                          src={cardEmployee.photoDataUrl}
                          alt={cardEmployee.fullName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="font-mono font-bold text-sm text-slate-500">
                          {cardEmployee.fullName
                            .split(' ')
                            .map((s) => s[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-mono font-semibold text-orange-700">
                        {cardEmployee.empCode} · {cardEmployee.role}
                      </div>
                      <h2 className="text-lg font-semibold text-slate-900 truncate">
                        {cardEmployee.fullName}
                      </h2>
                      <div className="text-xs text-slate-600 truncate">
                        {cardEmployee.currentProjectName
                          ? `${cardEmployee.currentProjectName}${
                              cardEmployee.currentTowerName ? ` · ${cardEmployee.currentTowerName}` : ''
                            }`
                          : 'No site assigned'}
                        {!hideSalary &&
                          ` · Rate ${formatINR(cardEmployee.dailyRate)}/day · OT ${formatINR(
                            cardEmployee.overtimeRate
                          )}/hr`}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`grid grid-cols-2 ${
                      hideSalary ? 'sm:grid-cols-4' : 'sm:grid-cols-5'
                    } gap-2.5 shrink-0`}
                  >
                    <div className="px-3 py-2 bg-emerald-50/70 border border-emerald-200 rounded-md">
                      <div className="text-[11px] font-medium text-emerald-800">Present</div>
                      <div className="text-base font-mono font-bold text-emerald-900 tabular-nums">
                        {employeeCardData.presentDays}d
                      </div>
                    </div>
                    <div className="px-3 py-2 bg-amber-50/70 border border-amber-200 rounded-md">
                      <div className="text-[11px] font-medium text-amber-800">Half-Day</div>
                      <div className="text-base font-mono font-bold text-amber-900 tabular-nums">
                        {employeeCardData.halfDays}d
                      </div>
                    </div>
                    <div className="px-3 py-2 bg-red-50/70 border border-red-200 rounded-md">
                      <div className="text-[11px] font-medium text-red-800">Absent</div>
                      <div className="text-base font-mono font-bold text-red-900 tabular-nums">
                        {employeeCardData.absentDays}d
                      </div>
                    </div>
                    <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-md">
                      <div className="text-[11px] font-medium text-slate-600">Eff / OT</div>
                      <div className="text-base font-mono font-bold text-slate-900 tabular-nums">
                        {employeeCardData.effectiveDays}d · {employeeCardData.overtimeHours}h
                      </div>
                    </div>
                    {!hideSalary && (
                      <div className="px-3 py-2 bg-slate-900 text-white rounded-md">
                        <div className="text-[11px] text-slate-300">Month Wages</div>
                        <div className="text-base font-mono font-bold tabular-nums">
                          {formatINR(employeeCardData.totalWagesEarned)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 2-Column Interactive Card Grid + Day Entry Form */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
                {/* Calendar Card Grid */}
                <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {employeeCardData.monthLabel} — Daily Attendance Card
                      </h3>
                      <p className="text-xs text-slate-500">
                        Click any date to mark or update Present, Half-Day, Absent, OT hours, or Tower.
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 text-[11px] font-mono text-slate-600">
                      <span className="text-emerald-700 font-semibold">P=Present</span>
                      <span className="text-amber-700 font-semibold">HD=Half</span>
                      <span className="text-red-700 font-semibold">A=Absent</span>
                    </div>
                  </div>

                  {/* Weekday Header */}
                  <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-slate-500 pb-1">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((wd) => (
                      <div key={wd} className={wd === 'Sun' ? 'text-amber-700' : ''}>
                        {wd}
                      </div>
                    ))}
                  </div>

                  {/* Day Tiles */}
                  <div className="grid grid-cols-7 gap-1.5">
                    {Array.from({ length: employeeCardData.mondayOffset }).map((_, i) => (
                      <div key={`pad_${i}`} className="min-h-[84px] rounded-md bg-slate-50/40" aria-hidden="true" />
                    ))}
                    {employeeCardData.days.map((cell) => {
                      const isSelected = cell.date === cardSelectedDate;
                      const statusBg =
                        cell.status === 'present'
                          ? 'bg-emerald-50/80 border-emerald-300 text-emerald-900'
                          : cell.status === 'half_day'
                            ? 'bg-amber-50/80 border-amber-300 text-amber-900'
                            : cell.status === 'absent'
                              ? 'bg-red-50/80 border-red-300 text-red-900'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50';
                      const shortTag =
                        cell.status === 'present'
                          ? 'P'
                          : cell.status === 'half_day'
                            ? 'HD'
                            : cell.status === 'absent'
                              ? 'A'
                              : '—';

                      return (
                        <button
                          key={cell.date}
                          type="button"
                          onClick={() => {
                            setCardSelectedDate(cell.date);
                            setCardSavedMsg('');
                          }}
                          aria-label={`Select ${cell.date} (${cell.status || 'unmarked'})`}
                          className={`min-h-[84px] p-1.5 rounded-md border text-left flex flex-col justify-between transition-all ${statusBg} ${
                            isSelected ? 'ring-2 ring-orange-700 ring-offset-1' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="font-mono text-xs font-bold tabular-nums">{cell.day}</span>
                            <span
                              className={`font-mono text-[10px] font-bold px-1 rounded ${
                                cell.status === 'present'
                                  ? 'bg-emerald-700 text-white'
                                  : cell.status === 'half_day'
                                    ? 'bg-amber-600 text-white'
                                    : cell.status === 'absent'
                                      ? 'bg-red-700 text-white'
                                      : 'text-slate-400'
                              }`}
                            >
                              {shortTag}
                            </span>
                          </div>
                          <div className="space-y-0.5 w-full overflow-hidden">
                            {(cell.record?.inTime || cell.record?.outTime) && (
                              <div className="text-[9.5px] font-mono text-slate-600 truncate">
                                {cell.record.inTime || '--:--'}→{cell.record.outTime || '--:--'}
                              </div>
                            )}
                            {cell.overtimeHours > 0 && (
                              <div className="text-[10px] font-mono text-orange-800 font-semibold truncate">
                                +{cell.overtimeHours}h OT
                              </div>
                            )}
                            <div className="text-[10px] font-mono tabular-nums truncate opacity-85">
                              {!hideSalary && cell.earned > 0
                                ? formatINR(cell.earned)
                                : cell.isSunday
                                  ? 'Sun'
                                  : cell.towerName || ''}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Day Entry Form & Quick Actions */}
                <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div>
                      <div className="text-xs font-mono text-orange-700 font-semibold">
                        DAY ATTENDANCE ENTRY
                      </div>
                      <h3 className="text-base font-semibold text-slate-900 font-mono">
                        {cardSelectedDate}
                      </h3>
                    </div>
                    <span className="text-xs font-medium text-slate-600">
                      {cardDayRecord ? `Current: ${ATTENDANCE_STATUS_LABELS[cardDayRecord.status]}` : 'Not Marked'}
                    </span>
                  </div>

                  {cardSavedMsg && (
                    <div className="p-2.5 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md">
                      {cardSavedMsg}
                    </div>
                  )}

                  {cardError && (
                    <div className="p-2.5 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md">
                      {cardError}
                    </div>
                  )}

                  {cardDayRecord && isSupervisor && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-md space-y-2">
                      <div className="flex items-start gap-2 text-xs text-amber-900">
                        <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                        <div>
                          <strong>Attendance Locked for {cardSelectedDate}.</strong> Once marked, direct inline updates are disabled. Use the Edit Attendance modal to make corrections.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditAttendanceModal(cardEmployee, cardSelectedDate, cardDayRecord)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-amber-300 rounded hover:bg-amber-100"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Edit Locked Attendance</span>
                      </button>
                    </div>
                  )}

                  {(() => {
                    const cardLocked = Boolean(cardDayRecord) && isSupervisor;
                    return (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          setCardSaving(true);
                          setCardSavedMsg('');
                          setCardError('');
                          try {
                            await markAttendance({
                              date: cardSelectedDate,
                              employeeId: cardEmployee.id,
                              projectId: cardProjectId,
                              towerId: cardTowerId || undefined,
                              status: cardStatus,
                              inTime: cardStatus === 'absent' ? '' : normalizeHHMM(cardInTime),
                              outTime: cardStatus === 'absent' ? '' : normalizeHHMM(cardOutTime),
                              overtimeHours: cardStatus === 'absent' ? 0 : Number(cardOtHours) || 0,
                              notes: cardNotes,
                            });
                            setCardSavedMsg(
                              `Saved ${ATTENDANCE_STATUS_LABELS[cardStatus]} for ${cardEmployee.fullName} on ${cardSelectedDate}`
                            );
                          } catch (err) {
                            setCardError(
                              err instanceof Error ? err.message : 'Unable to save attendance.'
                            );
                          } finally {
                            setCardSaving(false);
                          }
                        }}
                        className="space-y-3.5"
                      >
                        <div>
                          <span className="block text-xs font-medium text-slate-700 mb-1.5">
                            Attendance Status
                          </span>
                          <div className="grid grid-cols-3 gap-2">
                            {(
                              [
                                { id: 'present', label: 'Present', cls: 'bg-emerald-700 text-white border-emerald-700' },
                                { id: 'half_day', label: 'Half Day', cls: 'bg-amber-600 text-white border-amber-600' },
                                { id: 'absent', label: 'Absent', cls: 'bg-red-700 text-white border-red-700' },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                disabled={cardLocked}
                                onClick={() => setCardStatus(opt.id)}
                                className={`py-2 text-xs font-semibold rounded-md border transition-colors disabled:opacity-60 ${
                                  cardStatus === opt.id
                                    ? opt.cls
                                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label htmlFor="card-proj" className="block text-xs font-medium text-slate-700 mb-1">
                              Project Site Worked
                            </label>
                            <select
                              id="card-proj"
                              disabled={cardLocked}
                              value={cardProjectId}
                              onChange={(e) => {
                                const nextP = e.target.value;
                                setCardProjectId(nextP);
                                const firstT = towers.find((t) => t.projectId === nextP);
                                setCardTowerId(firstT?.id || '');
                              }}
                              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md disabled:bg-slate-100"
                            >
                              <option value="">Select Project</option>
                              {projects.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label htmlFor="card-twr" className="block text-xs font-medium text-slate-700 mb-1">
                              Tower / Block Worked
                            </label>
                            <select
                              id="card-twr"
                              disabled={cardLocked}
                              value={cardTowerId}
                              onChange={(e) => setCardTowerId(e.target.value)}
                              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md disabled:bg-slate-100"
                            >
                              {!isSupervisor && <option value="">Any / General Site</option>}
                              {towers
                                .filter((t) => !cardProjectId || t.projectId === cardProjectId)
                                .map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label htmlFor="card-in-time" className="block text-xs font-medium text-slate-700 mb-1">
                              In Time (Check-In)
                            </label>
                            <input
                              id="card-in-time"
                              type="time"
                              disabled={cardLocked || cardStatus === 'absent'}
                              value={cardStatus === 'absent' ? '' : cardInTime}
                              onChange={(e) => setCardInTime(e.target.value)}
                              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md disabled:bg-slate-100"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label htmlFor="card-out-time" className="block text-xs font-medium text-slate-700">
                                Out Time (Check-Out)
                              </label>
                              {cardDayRecord && cardDayRecord.status !== 'absent' && !cardDayRecord.outTime && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const outNow = getCurrentHHMM();
                                    await punchAttendanceOut({
                                      attendanceId: cardDayRecord.id,
                                      employeeId: cardEmployee.id,
                                      date: cardSelectedDate,
                                      outTime: outNow,
                                    });
                                    setCardOutTime(outNow);
                                    setCardSavedMsg(`Checked out on ${cardSelectedDate} at ${outNow}`);
                                  }}
                                  className="text-[10.5px] font-semibold text-amber-800 hover:underline"
                                >
                                  Punch Out Now
                                </button>
                              )}
                            </div>
                            <input
                              id="card-out-time"
                              type="time"
                              disabled={cardLocked || cardStatus === 'absent'}
                              value={cardStatus === 'absent' ? '' : cardOutTime}
                              onChange={(e) => setCardOutTime(e.target.value)}
                              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md disabled:bg-slate-100"
                            />
                          </div>
                        </div>

                        {(() => {
                          const dur = computeWorkedHoursFromInOut(cardInTime, cardOutTime);
                          if (!dur.valid || cardStatus === 'absent') return null;
                          return (
                            <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-600 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
                              <Clock className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                              <span>
                                Shift duration: <strong>{dur.totalHours}h</strong>
                                {dur.overtimeHoursEstimate > 0 ? ` (Est. +${dur.overtimeHoursEstimate}h OT over 9h)` : ''}
                              </span>
                            </div>
                          );
                        })()}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label htmlFor="card-ot" className="block text-xs font-medium text-slate-700 mb-1">
                              Overtime Hours (OT)
                            </label>
                            <input
                              id="card-ot"
                              type="number"
                              min="0"
                              max="16"
                              step="0.5"
                              disabled={cardLocked || cardStatus === 'absent'}
                              value={cardStatus === 'absent' ? '0' : cardOtHours}
                              onChange={(e) => setCardOtHours(e.target.value)}
                              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md disabled:bg-slate-100"
                            />
                          </div>
                          <div>
                            <label htmlFor="card-date-input" className="block text-xs font-medium text-slate-700 mb-1">
                              Selected Date
                            </label>
                            <input
                              id="card-date-input"
                              type="date"
                              value={cardSelectedDate}
                              onChange={(e) => {
                                const d = e.target.value;
                                setCardSelectedDate(d);
                                if (d.length >= 7) setCardMonth(d.slice(0, 7));
                              }}
                              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                            />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="card-notes" className="block text-xs font-medium text-slate-700 mb-1">
                            Work / Shift Note (Optional)
                          </label>
                          <input
                            id="card-notes"
                            type="text"
                            disabled={cardLocked}
                            value={cardNotes}
                            onChange={(e) => setCardNotes(e.target.value)}
                            placeholder="e.g. Night flooring shift in Flat 301"
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md disabled:bg-slate-100"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={cardSaving || cardLocked}
                          className="w-full py-2.5 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                        >
                          {cardLocked ? 'Attendance Locked (Use Edit Above)' : cardSaving ? 'Saving...' : 'Save Day Attendance'}
                        </button>
                      </form>
                    );
                  })()}

                  <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-slate-600">
                      Month Advances:{' '}
                      <strong className="font-mono text-red-700">
                        {formatINR(employeeCardData.monthAdvancesTotal)}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenGiveAdvance(cardEmployee.id)}
                      className="text-orange-700 font-semibold hover:underline"
                    >
                      + Give Advance to {cardEmployee.fullName.split(' ')[0]}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {/* TAB 2: MONTHLY ATTENDANCE CALENDAR MATRIX + WHATSAPP & EMAIL SHARE */}
      {activeTab === 'monthly' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="att-month" className="block text-xs font-medium text-slate-500 mb-1">
                  Month
                </label>
                <input
                  id="att-month"
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <label htmlFor="att-month-proj" className="block text-xs font-medium text-slate-500 mb-1">
                  Site / Project
                </label>
                <select
                  id="att-month-proj"
                  value={monthlyProjectFilter}
                  onChange={(e) => setMonthlyProjectFilter(e.target.value)}
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

              <div className="relative">
                <label htmlFor="att-month-search" className="block text-xs font-medium text-slate-500 mb-1">
                  Search Employee
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
                  <input
                    id="att-month-search"
                    type="text"
                    value={monthlySearch}
                    onChange={(e) => setMonthlySearch(e.target.value)}
                    placeholder="Name, ID, or role..."
                    className="pl-8 pr-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                <span>
                  <span className="text-emerald-700 font-semibold">P</span>=Present
                </span>
                <span>·</span>
                <span>
                  <span className="text-amber-700 font-semibold">HD</span>=Half Day
                </span>
                <span>·</span>
                <span>
                  <span className="text-red-700 font-semibold">A</span>=Absent
                </span>
              </div>
              <button
                type="button"
                onClick={handleDownloadMonthlyPayrollCsv}
                data-testid="monthly-download-csv-btn"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                <span>Download CSV</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 px-3 sticky left-0 bg-slate-50 z-10 min-w-[155px] border-r border-slate-200">
                    Employee
                  </th>
                  {Array.from({ length: monthlyMatrix.daysInMonth }, (_, i) => i + 1).map((day) => (
                    <th key={day} className="py-2 px-0.5 text-center font-mono min-w-[22px] text-[11px]">
                      {day}
                    </th>
                  ))}
                  <th className="py-2 px-1.5 text-right font-mono border-l border-slate-200">P</th>
                  <th className="py-2 px-1.5 text-right font-mono">HD</th>
                  <th className="py-2 px-1.5 text-right font-mono">A</th>
                  <th className="py-2 px-1.5 text-right font-mono">Eff</th>
                  {!hideSalary && <th className="py-2 px-2 text-right font-mono">Earned</th>}
                  <th className="py-2 px-2.5 text-right sticky right-0 bg-slate-50 z-10 border-l border-slate-200">
                    Share
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMonthlyRows.map((row) => (
                  <tr key={row.employee.id} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3 sticky left-0 bg-white z-10 border-r border-slate-200">
                      <button
                        type="button"
                        onClick={() => {
                          setCardEmpId(row.employee.id);
                          setCardMonth(selectedMonth);
                          setActiveTab('employee_card');
                        }}
                        className="text-left group"
                      >
                        <div className="font-medium text-slate-900 truncate max-w-[145px] group-hover:text-orange-700 underline decoration-slate-300 underline-offset-2">
                          {row.employee.fullName}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {row.employee.empCode} · {row.employee.role}
                        </div>
                      </button>
                    </td>
                    {Array.from({ length: monthlyMatrix.daysInMonth }, (_, i) => i + 1).map((day) => {
                      const st = row.dayStatuses[day];
                      return (
                        <td
                          key={day}
                          className={`py-2 px-0.5 text-center font-mono font-semibold text-[11px] ${
                            st === 'present'
                              ? 'text-emerald-700 bg-emerald-50/60'
                              : st === 'half_day'
                                ? 'text-amber-700 bg-amber-50/70'
                                : st === 'absent'
                                  ? 'text-red-700 bg-red-50/70'
                                  : 'text-slate-300'
                          }`}
                        >
                          {st === 'present' ? 'P' : st === 'half_day' ? 'HD' : st === 'absent' ? 'A' : '·'}
                        </td>
                      );
                    })}
                    <td className="py-2 px-1.5 text-right font-mono tabular-nums text-emerald-700 font-semibold border-l border-slate-200">
                      {row.presentDays}
                    </td>
                    <td className="py-2 px-1.5 text-right font-mono tabular-nums text-amber-700">
                      {row.halfDays}
                    </td>
                    <td className="py-2 px-1.5 text-right font-mono tabular-nums text-red-700">
                      {row.absentDays}
                    </td>
                    <td className="py-2 px-1.5 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {row.effectiveDays}d
                    </td>
                    {!hideSalary && (
                      <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        {formatINR(row.totalWagesEarned)}
                      </td>
                    )}
                    <td className="py-2 px-2.5 text-right whitespace-nowrap sticky right-0 bg-white z-10 border-l border-slate-200">
                      <button
                        type="button"
                        onClick={() => handleShareMonthlyAttendance(row.employee.id)}
                        aria-label={`Share monthly attendance for ${row.employee.fullName}`}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                      >
                        <MessageSquare className="w-3 h-3" aria-hidden="true" />
                        <span>Share</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 3: FOOD & CASH ADVANCES (TOWER-WISE DAILY/WEEKLY/MONTHLY + SUNDAY WEEKLY FOOD RUN) */}
      {activeTab === 'advances' && (
        <section className="space-y-4">
          {/* Sunday Highlight & Daily/Weekly/Monthly Food Summary Cards */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="adv-ref-date" className="block text-xs font-medium text-slate-500 mb-1">
                    Reference Date {isSundayDate(advRefDate) && '(Sunday)'}
                  </label>
                  <input
                    id="adv-ref-date"
                    type="date"
                    value={advRefDate}
                    onChange={(e) => setAdvRefDate(e.target.value)}
                    className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="adv-proj-filter" className="block text-xs font-medium text-slate-500 mb-1">
                    Project Scope
                  </label>
                  <select
                    id="adv-proj-filter"
                    value={advProjectFilter}
                    onChange={(e) => {
                      setAdvProjectFilter(e.target.value);
                      setAdvTowerFilter('all');
                    }}
                    className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
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
                  <label htmlFor="adv-twr-filter" className="block text-xs font-medium text-slate-500 mb-1">
                    Tower Scope
                  </label>
                  <select
                    id="adv-twr-filter"
                    value={advTowerFilter}
                    onChange={(e) => setAdvTowerFilter(e.target.value)}
                    className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                  >
                    <option value="all">All Towers</option>
                    {availableAdvTowers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setImportSuccessMsg('');
                    setShowOcrImportModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap"
                >
                  <ScanText className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
                  <span>Scan Advance Sheet (OCR)</span>
                </button>
                <button
                  type="button"
                  onClick={openSundayBatchModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-900 bg-amber-100 border border-amber-300 rounded-md hover:bg-amber-200 whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
                  <span>Sunday Weekly Food Run</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportFoodPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                  <span>Export Food PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportFoodCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {importSuccessMsg && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs font-medium text-emerald-900 flex items-center justify-between gap-2">
                <span>{importSuccessMsg}</span>
                <button
                  type="button"
                  onClick={() => setImportSuccessMsg('')}
                  className="text-emerald-800 font-semibold hover:underline"
                >
                  Dismiss
                </button>
              </div>
            )}

            {isSundayDate(advRefDate) && (
              <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-md text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>Sunday Weekly Food Advance Day:</strong> Most site crews receive weekly food mess advance on Sundays. Use &ldquo;Sunday Weekly Food Run&rdquo; to disburse to a full tower crew at once.
                </span>
              </div>
            )}

            {isAdmin && pendingFoodBatches.length > 0 && (
              <div
                data-testid="payroll-admin-pending-food-approvals"
                className="p-3.5 bg-amber-50/70 border border-amber-300 rounded-md space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-amber-950">
                    Admin Weekly Food Run Approval Queue ({pendingFoodBatches.length} batch
                    {pendingFoodBatches.length === 1 ? '' : 'es'})
                  </div>
                </div>
                <div className="space-y-2">
                  {pendingFoodBatches.map((batch) => {
                    const adminContact = resolveAdminApprovalContact(companyProfile);
                    const supPhone =
                      rawEmployees.find((e) => e.fullName === batch.submittedByName)?.phone ||
                      adminContact.adminPhone;
                    const approveWaUrl = buildWhatsappDirectUrl(
                      supPhone,
                      buildWeeklyFoodDecisionWhatsappMessage({
                        companyName,
                        decision: 'approved',
                        batch,
                        reviewedByName: session?.displayName || adminContact.adminName,
                      })
                    );
                    const busy = approvalBusyId === batch.batchId;

                    return (
                      <div
                        key={batch.batchId}
                        className="p-2.5 bg-white border border-amber-200 rounded flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">
                            {batch.projectName} · {batch.towerName} ({batch.date})
                          </div>
                          <div className="text-slate-600">
                            Submitted by <strong>{batch.submittedByName}</strong> ·{' '}
                            {batch.entries.length} worker(s) ·{' '}
                            <span className="font-mono font-semibold text-slate-900">
                              {formatINR(batch.totalAmount)}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={async () => {
                              setApprovalBusyId(batch.batchId);
                              try {
                                await reviewWeeklyFoodApproval({
                                  advanceIds: batch.entries.map((e) => e.id),
                                  decision: 'approved',
                                });
                              } finally {
                                setApprovalBusyId(null);
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 font-semibold text-white bg-emerald-700 rounded hover:bg-emerald-800 disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                            <span>Approve</span>
                          </button>
                          <a
                            href={approveWaUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                          >
                            <MessageSquare className="w-3 h-3" aria-hidden="true" />
                            <span>Send WA</span>
                          </a>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={async () => {
                              setApprovalBusyId(batch.batchId);
                              try {
                                await reviewWeeklyFoodApproval({
                                  advanceIds: batch.entries.map((e) => e.id),
                                  decision: 'rejected',
                                });
                              } finally {
                                setApprovalBusyId(null);
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-red-700 bg-white border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                          >
                            <XCircle className="w-3 h-3" aria-hidden="true" />
                            <span>Reject</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                <div className="text-[11px] font-medium text-slate-500">
                  Daily Food ({advRefDate})
                </div>
                <div className="mt-1 text-lg font-mono font-bold text-slate-900 tabular-nums">
                  {formatINR(foodBreakdown.dailyFoodTotal)}
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                <div className="text-[11px] font-medium text-slate-500">
                  Weekly Food ({foodBreakdown.weeklyRange.start} to {foodBreakdown.weeklyRange.end})
                </div>
                <div className="mt-1 text-lg font-mono font-bold text-slate-900 tabular-nums">
                  {formatINR(foodBreakdown.weeklyFoodTotal)}
                </div>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-md">
                <div className="text-[11px] font-semibold text-amber-800">
                  Sunday Weekly Food Run Highlight
                </div>
                <div className="mt-1 text-lg font-mono font-bold text-amber-900 tabular-nums">
                  {formatINR(foodBreakdown.sundayWeeklyFoodTotal)}
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                <div className="text-[11px] font-medium text-slate-500">
                  Monthly Food ({foodBreakdown.monthPrefix})
                </div>
                <div className="mt-1 text-lg font-mono font-bold text-orange-800 tabular-nums">
                  {formatINR(foodBreakdown.monthlyFoodTotal)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-md">
                {[
                  { id: 'all' as const, label: 'All Advances' },
                  { id: 'daily_food' as const, label: 'Daily Food' },
                  { id: 'weekly_food' as const, label: 'Weekly Food' },
                  { id: 'cash_advance' as const, label: 'Cash Advance' },
                  { id: 'custom' as const, label: 'Custom Category' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAdvTypeFilter(opt.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
                      advTypeFilter === opt.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="text-xs font-mono tabular-nums text-slate-700">
                Filtered Total:{' '}
                <strong>
                  {formatINR(filteredAdvances.reduce((s, a) => s + a.amount, 0))}
                </strong>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-3">Employee &amp; Tower</th>
                    <th className="py-2.5 px-3">Advance Type</th>
                    <th className="py-2.5 px-3">Notes</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredAdvances.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">
                        No advance entries found for this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredAdvances.map((adv) => {
                      const emp = employees.find((e) => e.id === adv.employeeId);
                      const proj = projects.find((p) => p.id === (adv.projectId || emp?.currentProjectId));
                      const twr = towers.find((t) => t.id === (adv.towerId || emp?.currentTowerId));
                      const sundayTag =
                        adv.isSundayRun || (adv.advanceType === 'weekly_food' && isSundayDate(adv.date));

                      return (
                        <tr
                          key={adv.id}
                          className={sundayTag ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-slate-50/70'}
                        >
                          <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                            <div>{adv.date}</div>
                            {sundayTag && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300 rounded">
                                Sunday Run
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-slate-900">{adv.employeeName}</div>
                            <div className="text-xs font-mono text-slate-500">
                              {adv.empCode}
                              {proj ? ` · ${proj.name}` : ''}
                              {twr ? ` (${twr.name})` : ''}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-slate-700">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-slate-900">
                                {getAdvanceCategoryLabel(adv)}
                              </span>
                              {adv.advanceType === 'weekly_food' &&
                                (() => {
                                  const appStatus = getEffectiveAdvanceApprovalStatus(adv);
                                  if (appStatus === 'pending_admin') {
                                    return (
                                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300 rounded">
                                        Pending Admin Approval
                                      </span>
                                    );
                                  }
                                  if (appStatus === 'rejected') {
                                    return (
                                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-red-100 text-red-900 border border-red-300 rounded">
                                        Rejected
                                      </span>
                                    );
                                  }
                                  return (
                                    <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                                      Admin Approved
                                    </span>
                                  );
                                })()}
                              {adv.advanceType === 'weekly_food' &&
                                (() => {
                                  const evalRes = evaluateWeeklyFoodAdvance(adv);
                                  if (evalRes.status === 'acknowledged') {
                                    return (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                                        <CheckCircle2 className="w-2.5 h-2.5" aria-hidden="true" />
                                        <span>Ack</span>
                                      </span>
                                    );
                                  }
                                  if (evalRes.status === 'overdue_unacknowledged') {
                                    return (
                                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-red-50 text-red-800 border border-red-200 rounded">
                                        Unack &gt;24h ({formatElapsedDurationLabel(evalRes.elapsedHours)})
                                      </span>
                                    );
                                  }
                                  return (
                                    <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200 rounded">
                                      Pending Ack ({Math.ceil(evalRes.remainingHours)}h left)
                                    </span>
                                  );
                                })()}
                            </div>
                            <div className="text-xs text-slate-500 uppercase font-mono">
                              {adv.paymentMode}
                              {adv.paymentApp ? ` · ${adv.paymentApp}` : ''}
                            </div>
                            {(adv.transactionId || adv.upiId) && (
                              <div className="text-[10px] font-mono text-slate-500">
                                {adv.transactionId ? `UTR: ${adv.transactionId}` : ''}
                                {adv.transactionId && adv.upiId ? ' · ' : ''}
                                {adv.upiId ? `UPI: ${adv.upiId}` : ''}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-600 max-w-xs truncate">
                            {adv.notes || '—'}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-red-700 whitespace-nowrap">
                            {formatINR(adv.amount)}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {adv.proofImageDataUrl && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setProofLightbox({
                                      title: `Advance Proof — ${getAdvanceCategoryLabel(adv)}`,
                                      subtitle: `${adv.employeeName} (${adv.empCode}) · ${adv.date}`,
                                      imageDataUrl: adv.proofImageDataUrl!,
                                      paymentMode: adv.paymentMode,
                                      paymentApp: adv.paymentApp,
                                      transactionId: adv.transactionId,
                                      upiId: adv.upiId,
                                      amount: adv.amount,
                                      date: adv.date,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                                >
                                  <Eye className="w-3 h-3" aria-hidden="true" />
                                  <span>Proof</span>
                                </button>
                              )}
                              {adv.advanceType === 'weekly_food' && !adv.acknowledged && (
                                <button
                                  type="button"
                                  onClick={() => acknowledgeAdvance(adv.id)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                                >
                                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                                  <span>Mark Ack</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setIndivDetailsEmpId(adv.employeeId)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                              >
                                <ReceiptIndianRupee className="w-3 h-3 text-orange-700" aria-hidden="true" />
                                <span>Details</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!emp) return;
                                  const payroll = computeEmployeePayroll(
                                    emp,
                                    attendance,
                                    advances,
                                    settlements
                                  );
                                  onTriggerWhatsapp({
                                    title: 'Send Advance Receipt (WhatsApp / Email)',
                                    recipientName: `${emp.fullName} (${emp.empCode})`,
                                    recipientPhone: emp.phone,
                                    recipientEmail: emp.email || '',
                                    emailSubject: `${companyName} Advance Receipt — ${adv.date}`,
                                    message: formatAdvanceWhatsappMessage(
                                      adv,
                                      payroll.netPayable,
                                      companyName,
                                      { hideNetBalance: hideSalary }
                                    ),
                                    advanceId: adv.id,
                                  });
                                }}
                                aria-label={`Send WhatsApp or Email receipt for ${adv.employeeName}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                              >
                                <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>WA / Mail</span>
                              </button>
                              {isAdmin && !hideSalary && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEditAdvanceModal(adv)}
                                    aria-label={`Edit advance for ${adv.employeeName} on ${adv.date}`}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                                  >
                                    <Pencil className="w-3 h-3" aria-hidden="true" />
                                    <span>Edit</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteAdvance(adv.id)}
                                    aria-label={`Delete advance for ${adv.employeeName} on ${adv.date}`}
                                    className="p-1.5 text-slate-400 hover:text-red-700 rounded hover:bg-red-50"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* TAB 4: UNIFIED EMPLOYEE-WISE PAYROLL, ADVANCES & TOTAL EXPENSES (ADMIN ONLY) */}
      {activeTab === 'payroll' && isAdmin && (() => {
        const { rows: ledgerRows, totals } = payrollLedgerOverview;
        const periodLabel =
          periodStart || periodEnd
            ? `${periodStart || 'Start'} to ${periodEnd || 'Today'}`
            : 'All Recorded Days';
        const scopeProjName =
          payrollProjectFilter === 'all'
            ? 'All Projects'
            : projects.find((p) => p.id === payrollProjectFilter)?.name || 'Selected Project';
        const scopeTowerName =
          payrollTowerFilter === 'all'
            ? 'All Towers'
            : towers.find((t) => t.id === payrollTowerFilter)?.name || 'Selected Tower';
        const scopeLabel = `${scopeProjName} · ${scopeTowerName}`;
        const hasPayrollFilters = Boolean(
          periodStart ||
            periodEnd ||
            payrollSearch.trim() ||
            payrollProjectFilter !== 'all' ||
            payrollTowerFilter !== 'all' ||
            payrollOnlyActivity
        );

        const handleExportPayrollCsv = () => {
          const csv = buildEmployeePayrollExpenseCsv(payrollLedgerOverview, periodLabel);
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          triggerDownloadBlob(blob, 'AVY_Employee_Payroll_Advances_Expenses.csv');
        };

        const handleExportPayrollPdf = () => {
          const { blob, fileName } = buildEmployeePayrollExpensePdfBlob({
            companyName,
            periodLabel,
            scopeLabel,
            rows: ledgerRows.map(({ summary: s }) => ({
              empCode: s.employee.empCode,
              fullName: s.employee.fullName,
              role: s.employee.role,
              siteLabel: `${s.employee.currentProjectName || 'Unassigned'}${
                s.employee.currentTowerName ? ` / ${s.employee.currentTowerName}` : ''
              }`,
              effectiveDays: s.effectiveDaysWorked,
              overtimeHours: s.overtimeHours,
              totalEarned: s.totalEarned,
              dailyFoodAdvance: s.dailyFoodAdvance,
              weeklyFoodAdvance: s.weeklyFoodAdvance,
              cashAndCustomAdvance: s.cashAdvance + s.customAdvance,
              totalAdvances: s.totalAdvances,
              advanceCount: s.advanceCount,
              totalSettled: s.totalSettled,
              totalDisbursed: s.totalDisbursed,
              totalEmployeeExpenses: s.totalEmployeeExpenses,
              netPayable: s.netPayable,
            })),
            totals: {
              workerCount: totals.workerCount,
              totalDaysWorked: totals.totalDaysWorked,
              totalOvertimeHours: totals.totalOvertimeHours,
              totalWagesEarned: totals.totalWagesEarned,
              totalFoodAdvance: totals.totalFoodAdvance,
              totalCashAndCustom: totals.totalCashAdvance + totals.totalCustomAdvance,
              totalAdvances: totals.totalAdvances,
              totalAdvanceEntries: totals.totalAdvanceEntries,
              totalSettled: totals.totalSettled,
              totalDisbursed: totals.totalDisbursed,
              totalEmployeeExpenses: totals.totalEmployeeExpenses,
              totalNetPayable: totals.totalNetPayable,
            },
          });
          triggerDownloadBlob(blob, fileName);
        };

        return (
          <section className="space-y-4">
            {/* Unified Header, Filters & Exports */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex-1 min-w-[260px]">
                  <h2 className="text-base font-semibold text-slate-900">
                    Employee-Wise Payroll, Advances &amp; Total Expenses
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    View every worker&apos;s wages, food/cash/custom advances, total worker cost
                    (Wages + Advances), settlements, and net payable in one place. Click any row
                    arrow to inspect itemized advance entries inline.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenGiveAdvance()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Give Advance</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPayrollCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                    <span>Export CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPayrollPdf}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                    <span>Export PDF</span>
                  </button>
                </div>
              </div>

              {/* Filter Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 pt-3 border-t border-slate-100">
                <div className="lg:col-span-2">
                  <label htmlFor="pay-search" className="block text-[11px] font-medium text-slate-500 mb-1">
                    Search Worker
                  </label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
                    <input
                      id="pay-search"
                      type="text"
                      value={payrollSearch}
                      onChange={(e) => setPayrollSearch(e.target.value)}
                      placeholder="Name, AVY ID, role, tower..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="pay-project" className="block text-[11px] font-medium text-slate-500 mb-1">
                    Project
                  </label>
                  <select
                    id="pay-project"
                    value={payrollProjectFilter}
                    onChange={(e) => {
                      setPayrollProjectFilter(e.target.value);
                      setPayrollTowerFilter('all');
                    }}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
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
                  <label htmlFor="pay-tower" className="block text-[11px] font-medium text-slate-500 mb-1">
                    Tower
                  </label>
                  <select
                    id="pay-tower"
                    value={payrollTowerFilter}
                    onChange={(e) => setPayrollTowerFilter(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                  >
                    <option value="all">All Towers</option>
                    {payrollTowersForFilter.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="pay-start" className="block text-[11px] font-medium text-slate-500 mb-1">
                    From Date
                  </label>
                  <input
                    id="pay-start"
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label htmlFor="pay-end" className="block text-[11px] font-medium text-slate-500 mb-1">
                    To Date
                  </label>
                  <input
                    id="pay-end"
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              {/* Secondary Controls: Sort, Only Activity Toggle, Clear */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={payrollOnlyActivity}
                      onChange={(e) => setPayrollOnlyActivity(e.target.checked)}
                      className="rounded border-slate-300 text-orange-700 focus:ring-orange-600"
                    />
                    <span>Show only workers with wages or advances</span>
                  </label>

                  <div className="inline-flex items-center gap-1.5">
                    <label htmlFor="pay-sort" className="text-slate-500">
                      Sort:
                    </label>
                    <select
                      id="pay-sort"
                      value={payrollSortBy}
                      onChange={(e) => setPayrollSortBy(e.target.value as PayrollLedgerSortKey)}
                      className="px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                    >
                      <option value="expenses_desc">Highest Total Expenses</option>
                      <option value="advances_desc">Highest Advances</option>
                      <option value="net_desc">Highest Net Payable</option>
                      <option value="name_asc">Employee Name (A–Z)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-slate-500 font-mono">
                    {totals.workerCount} worker{totals.workerCount !== 1 ? 's' : ''} · {periodLabel}
                  </span>
                  {hasPayrollFilters && (
                    <button
                      type="button"
                      onClick={() => {
                        setPeriodStart('');
                        setPeriodEnd('');
                        setPayrollSearch('');
                        setPayrollProjectFilter('all');
                        setPayrollTowerFilter('all');
                        setPayrollOnlyActivity(false);
                      }}
                      className="text-xs font-medium text-orange-700 hover:text-orange-900 underline"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 6-Card Employee-Wise Advance & Total Expenses KPI Strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <div className="bg-white border border-slate-200 rounded-lg p-3.5">
                <div className="text-[11px] font-medium text-slate-500">Wages + OT Earned</div>
                <div className="mt-1 text-lg font-mono font-bold text-slate-900 tabular-nums">
                  {formatINR(totals.totalWagesEarned)}
                </div>
                <div className="mt-0.5 text-[10.5px] font-mono text-slate-500 whitespace-nowrap">
                  {totals.totalDaysWorked}d worked · {totals.totalOvertimeHours}h OT
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-3.5">
                <div className="text-[11px] font-medium text-slate-500">Food Advances (D + W)</div>
                <div className="mt-1 text-lg font-mono font-bold text-amber-800 tabular-nums">
                  {formatINR(totals.totalFoodAdvance)}
                </div>
                <div className="mt-0.5 text-[10.5px] font-mono text-slate-500 whitespace-nowrap">
                  D {formatINR(totals.totalDailyFood)} · W {formatINR(totals.totalWeeklyFood)}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-3.5">
                <div className="text-[11px] font-medium text-slate-500">Cash &amp; Custom Adv</div>
                <div className="mt-1 text-lg font-mono font-bold text-orange-800 tabular-nums">
                  {formatINR(totals.totalCashAdvance + totals.totalCustomAdvance)}
                </div>
                <div className="mt-0.5 text-[10.5px] font-mono text-slate-500 whitespace-nowrap">
                  Cash {formatINR(totals.totalCashAdvance)} · Cust {formatINR(totals.totalCustomAdvance)}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-3.5">
                <div className="text-[11px] font-medium text-slate-500">Total Advances Given</div>
                <div className="mt-1 text-lg font-mono font-bold text-red-700 tabular-nums">
                  {formatINR(totals.totalAdvances)}
                </div>
                <div className="mt-0.5 text-[10.5px] font-mono text-slate-500 whitespace-nowrap">
                  {totals.totalAdvanceEntries} advance entr{totals.totalAdvanceEntries === 1 ? 'y' : 'ies'}
                </div>
              </div>

              <div className="bg-orange-50/70 border border-orange-200 rounded-lg p-3.5">
                <div className="text-[11px] font-semibold text-orange-950">
                  Total Worker Expenses
                </div>
                <div className="mt-1 text-lg font-mono font-bold text-orange-800 tabular-nums">
                  {formatINR(totals.totalEmployeeExpenses)}
                </div>
                <div className="mt-0.5 text-[10.5px] font-mono text-orange-900/80 whitespace-nowrap">
                  Wages+Adv · Paid {formatINR(totals.totalDisbursed)}
                </div>
              </div>

              <div className="bg-slate-900 text-white rounded-lg p-3.5">
                <div className="text-[11px] text-slate-300">Net Payable Balance</div>
                <div className="mt-1 text-lg font-mono font-bold tabular-nums">
                  {formatINR(totals.totalNetPayable)}
                </div>
                <div className="mt-0.5 text-[10.5px] font-mono text-slate-300 whitespace-nowrap">
                  Settled {formatINR(totals.totalSettled)}
                </div>
              </div>
            </div>

            {/* Unified Employee-Wise Table + Expandable Inline Advance & Expense Breakdown */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                      <th className="py-2.5 px-2.5">Employee</th>
                      <th className="py-2.5 px-1.5 text-right">Days/OT</th>
                      <th className="py-2.5 px-1.5 text-right">Wages+OT</th>
                      <th className="py-2.5 px-1.5 text-right">Daily Food</th>
                      <th className="py-2.5 px-1.5 text-right">Weekly Food</th>
                      <th className="py-2.5 px-1.5 text-right">Cash/Cust</th>
                      <th className="py-2.5 px-1.5 text-right">Total Adv</th>
                      <th className="py-2.5 px-1.5 text-right">Settled</th>
                      <th className="py-2.5 px-2 text-right bg-orange-50/70 text-orange-950">
                        Total Exp
                      </th>
                      <th className="py-2.5 px-2 text-right">Net Payable</th>
                      <th className="py-2.5 px-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {ledgerRows.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-10 text-center text-sm text-slate-500">
                          No employees match the current filter criteria.
                        </td>
                      </tr>
                    ) : (
                      ledgerRows.map(({ summary: sum, advanceEntries, settlementEntries }) => {
                        const isExpanded = Boolean(expandedPayrollEmpIds[sum.employee.id]);
                        const cashAndCustom = sum.cashAdvance + sum.customAdvance;
                        return (
                          <React.Fragment key={sum.employee.id}>
                            <tr className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-2.5">
                                <div className="flex items-start gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedPayrollEmpIds((prev) => ({
                                        ...prev,
                                        [sum.employee.id]: !prev[sum.employee.id],
                                      }))
                                    }
                                    aria-expanded={isExpanded}
                                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} advances and expenses for ${sum.employee.fullName}`}
                                    className="mt-0.5 p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded border border-slate-200 shrink-0"
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setIndivDetailsEmpId(sum.employee.id)}
                                    className="text-left group min-w-0"
                                  >
                                    <div className="font-semibold text-[13px] text-slate-900 group-hover:text-orange-700 underline decoration-slate-300 underline-offset-2 whitespace-nowrap">
                                      {sum.employee.fullName}
                                    </div>
                                    <div className="text-[10.5px] font-mono text-slate-500 leading-tight">
                                      {sum.employee.empCode} · {sum.employee.role}
                                    </div>
                                    <div className="text-[10.5px] font-mono text-slate-400 leading-tight">
                                      {sum.employee.currentTowerName ||
                                        sum.employee.currentProjectName ||
                                        'Unassigned'}{' '}
                                      · {formatINR(sum.employee.dailyRate)}/d
                                    </div>
                                  </button>
                                </div>
                              </td>

                              <td className="py-2.5 px-1.5 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                                <div>{sum.effectiveDaysWorked}d</div>
                                {sum.overtimeHours > 0 && (
                                  <div className="text-[10px] text-slate-500">+{sum.overtimeHours}h OT</div>
                                )}
                              </td>

                              <td className="py-2.5 px-1.5 text-right font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                                {formatINR(sum.totalEarned)}
                              </td>

                              <td className="py-2.5 px-1.5 text-right font-mono tabular-nums text-amber-800 whitespace-nowrap">
                                {formatINR(sum.dailyFoodAdvance)}
                              </td>

                              <td className="py-2.5 px-1.5 text-right font-mono tabular-nums text-amber-800 whitespace-nowrap">
                                {formatINR(sum.weeklyFoodAdvance)}
                              </td>

                              <td className="py-2.5 px-1.5 text-right font-mono tabular-nums text-red-700 whitespace-nowrap">
                                <div>{formatINR(cashAndCustom)}</div>
                                {sum.customAdvanceBreakdown.length > 0 && (
                                  <div className="text-[10px] font-sans text-slate-500 truncate max-w-[85px] ml-auto">
                                    {sum.customAdvanceBreakdown.map((b) => b.label).join(', ')}
                                  </div>
                                )}
                              </td>

                              <td className="py-2.5 px-1.5 text-right font-mono tabular-nums whitespace-nowrap">
                                <div className="font-semibold text-red-700">
                                  {formatINR(sum.totalAdvances)}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {sum.advanceCount} entr{sum.advanceCount === 1 ? 'y' : 'ies'}
                                </div>
                              </td>

                              <td className="py-2.5 px-1.5 text-right font-mono tabular-nums text-emerald-800 whitespace-nowrap">
                                {formatINR(sum.totalSettled)}
                              </td>

                              <td className="py-2.5 px-2 text-right font-mono tabular-nums bg-orange-50/40 whitespace-nowrap">
                                <div className="font-bold text-orange-800">
                                  {formatINR(sum.totalEmployeeExpenses)}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  Paid: {formatINR(sum.totalDisbursed)}
                                </div>
                              </td>

                              <td className="py-2.5 px-2 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                                {formatINR(sum.netPayable)}
                              </td>

                              <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => onOpenGiveAdvance(sum.employee.id)}
                                    title={`Give advance to ${sum.employee.fullName}`}
                                    aria-label={`Give advance to ${sum.employee.fullName}`}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100 whitespace-nowrap"
                                  >
                                    <Plus className="w-3 h-3" aria-hidden="true" />
                                    <span>Adv</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setIndivDetailsEmpId(sum.employee.id)}
                                    aria-label={`View individual payment details for ${sum.employee.fullName}`}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200 whitespace-nowrap"
                                  >
                                    <ReceiptIndianRupee className="w-3 h-3 text-orange-700" aria-hidden="true" />
                                    <span>Details</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onTriggerWhatsapp({
                                        title: 'Share Payment Breakdown (WhatsApp / Email)',
                                        recipientName: `${sum.employee.fullName} (${sum.employee.empCode})`,
                                        recipientPhone: sum.employee.phone,
                                        recipientEmail: sum.employee.email || '',
                                        emailSubject: `${companyName} Payment Statement — ${sum.employee.fullName}`,
                                        message: formatPaymentSummaryWhatsappMessage(
                                          sum,
                                          periodLabel,
                                          companyName
                                        ),
                                      })
                                    }
                                    aria-label={`Share payment statement for ${sum.employee.fullName}`}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 whitespace-nowrap"
                                  >
                                    <MessageSquare className="w-3 h-3" aria-hidden="true" />
                                    <span>Share</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={sum.netPayable <= 0}
                                    onClick={() => {
                                      setSettleMode('upi');
                                      setSettlePaymentApp('');
                                      setSettleTransactionId('');
                                      setSettleUpiId('');
                                      setSettleProofImageDataUrl('');
                                      setSettleNotes('');
                                      setSettlingEmpId(sum.employee.id);
                                    }}
                                    className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
                                  >
                                    Settle
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {/* Expandable Inline Advance & Worker Expense Breakdown Row */}
                            {isExpanded && (
                              <tr className="bg-slate-50/90">
                                <td colSpan={11} className="px-4 py-3.5 border-t border-slate-200">
                                  <div className="space-y-3">
                                    {/* Equation + Quick Action Bar */}
                                    <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-md px-3.5 py-2.5 text-xs">
                                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
                                        <span className="text-slate-600">
                                          Wages + OT:{' '}
                                          <strong className="text-slate-900">
                                            {formatINR(sum.totalEarned)}
                                          </strong>
                                        </span>
                                        <span className="text-slate-400">+</span>
                                        <span className="text-slate-600">
                                          Total Advances ({sum.advanceCount}):{' '}
                                          <strong className="text-red-700">
                                            {formatINR(sum.totalAdvances)}
                                          </strong>
                                        </span>
                                        <span className="text-slate-400">=</span>
                                        <span className="text-orange-950 font-semibold">
                                          Total Worker Expense:{' '}
                                          <strong className="text-orange-800">
                                            {formatINR(sum.totalEmployeeExpenses)}
                                          </strong>
                                        </span>
                                        <span className="text-slate-300">|</span>
                                        <span className="text-slate-600">
                                          Cash Paid Out (Adv + Settled):{' '}
                                          <strong className="text-slate-900">
                                            {formatINR(sum.totalDisbursed)}
                                          </strong>
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => onOpenGiveAdvance(sum.employee.id)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-orange-700 rounded hover:bg-orange-800 whitespace-nowrap"
                                      >
                                        <Plus className="w-3 h-3" aria-hidden="true" />
                                        <span>Record Advance</span>
                                      </button>
                                    </div>

                                    {/* Employee-wise Advance Entries Table */}
                                    <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
                                      <div className="px-3 py-2 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-[11px] font-semibold text-slate-700">
                                        <span>
                                          Itemized Advances for {sum.employee.fullName} ({advanceEntries.length})
                                        </span>
                                        <span className="font-mono text-red-700">
                                          Total Advances: {formatINR(sum.totalAdvances)}
                                        </span>
                                      </div>

                                      {advanceEntries.length === 0 ? (
                                        <div className="px-3 py-4 text-xs text-slate-500 text-center">
                                          No advance entries recorded for {sum.employee.fullName} in{' '}
                                          {periodLabel}.
                                        </div>
                                      ) : (
                                        <div className="overflow-x-auto">
                                          <table className="w-full text-left border-collapse text-xs">
                                            <thead>
                                              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                                                <th className="py-1.5 px-3">Date</th>
                                                <th className="py-1.5 px-3">Category</th>
                                                <th className="py-1.5 px-3">Mode / App / UTR</th>
                                                <th className="py-1.5 px-3">Notes</th>
                                                <th className="py-1.5 px-3 text-right">Amount</th>
                                                <th className="py-1.5 px-3 text-right">Proof &amp; Actions</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                              {advanceEntries.map((adv) => (
                                                <tr key={adv.id} className="hover:bg-slate-50/70">
                                                  <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                                                    {adv.date}
                                                  </td>
                                                  <td className="py-2 px-3 font-medium text-slate-900">
                                                    {adv.categoryLabel}
                                                  </td>
                                                  <td className="py-2 px-3 text-slate-700">
                                                    <span className="uppercase font-medium">
                                                      {adv.paymentMode}
                                                      {adv.paymentApp ? ` · ${adv.paymentApp}` : ''}
                                                    </span>
                                                    {(adv.transactionId || adv.upiId) && (
                                                      <span className="block text-[11px] font-mono text-slate-500">
                                                        {adv.transactionId ? `UTR: ${adv.transactionId}` : ''}
                                                        {adv.transactionId && adv.upiId ? ' · ' : ''}
                                                        {adv.upiId ? `UPI: ${adv.upiId}` : ''}
                                                      </span>
                                                    )}
                                                  </td>
                                                  <td className="py-2 px-3 text-slate-600">
                                                    {adv.notes || '—'}
                                                  </td>
                                                  <td className="py-2 px-3 text-right font-mono font-semibold text-red-700 whitespace-nowrap">
                                                    {formatINR(adv.amount)}
                                                  </td>
                                                  <td className="py-2 px-3 text-right whitespace-nowrap">
                                                    <div className="inline-flex items-center gap-1.5">
                                                      {adv.proofImageDataUrl ? (
                                                        <button
                                                          type="button"
                                                          onClick={() =>
                                                            setProofLightbox({
                                                              title: `${sum.employee.fullName} — ${adv.categoryLabel}`,
                                                              subtitle: `${adv.date} · ${sum.employee.empCode}`,
                                                              imageDataUrl: adv.proofImageDataUrl!,
                                                              paymentMode: adv.paymentMode,
                                                              paymentApp: adv.paymentApp,
                                                              transactionId: adv.transactionId,
                                                              upiId: adv.upiId,
                                                              amount: adv.amount,
                                                              date: adv.date,
                                                            })
                                                          }
                                                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                                                        >
                                                          <Eye className="w-3 h-3" aria-hidden="true" />
                                                          <span>Proof</span>
                                                        </button>
                                                      ) : null}
                                                      {isAdmin && !hideSalary && (
                                                        <>
                                                          <button
                                                            type="button"
                                                            onClick={() => openEditAdvanceModal(adv)}
                                                            aria-label={`Edit advance ${adv.categoryLabel} on ${adv.date}`}
                                                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                                                          >
                                                            <Pencil className="w-3 h-3" aria-hidden="true" />
                                                            <span>Edit</span>
                                                          </button>
                                                          <button
                                                            type="button"
                                                            onClick={() => deleteAdvance(adv.id)}
                                                            aria-label={`Remove advance ${adv.categoryLabel} on ${adv.date}`}
                                                            className="p-1 text-slate-400 hover:text-red-700 rounded hover:bg-red-50"
                                                          >
                                                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                                          </button>
                                                        </>
                                                      )}
                                                      {!adv.proofImageDataUrl && (!isAdmin || hideSalary) && (
                                                        <span className="text-slate-400">—</span>
                                                      )}
                                                    </div>
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                    </div>

                                    {settlementEntries.length > 0 && (
                                      <div className="bg-white border border-slate-200 rounded-md px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-semibold text-emerald-800">
                                          Salary Settlements ({settlementEntries.length}):
                                        </span>
                                        <span className="font-mono text-slate-700">
                                          {settlementEntries
                                            .map(
                                              (s) =>
                                                `${s.settledDate}: ${formatINR(s.netPaid)} (${s.paymentMode.toUpperCase()})`
                                            )
                                            .join(' · ')}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                  {ledgerRows.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-900 text-white text-xs font-mono tabular-nums font-semibold">
                        <td className="py-2.5 px-2.5 font-sans whitespace-nowrap">
                          Total ({totals.workerCount} worker{totals.workerCount !== 1 ? 's' : ''})
                        </td>
                        <td className="py-2.5 px-1.5 text-right whitespace-nowrap">
                          {totals.totalDaysWorked}d
                          {totals.totalOvertimeHours > 0 ? ` +${totals.totalOvertimeHours}h` : ''}
                        </td>
                        <td className="py-2.5 px-1.5 text-right whitespace-nowrap">{formatINR(totals.totalWagesEarned)}</td>
                        <td className="py-2.5 px-1.5 text-right whitespace-nowrap">{formatINR(totals.totalDailyFood)}</td>
                        <td className="py-2.5 px-1.5 text-right whitespace-nowrap">{formatINR(totals.totalWeeklyFood)}</td>
                        <td className="py-2.5 px-1.5 text-right whitespace-nowrap">
                          {formatINR(totals.totalCashAdvance + totals.totalCustomAdvance)}
                        </td>
                        <td className="py-2.5 px-1.5 text-right text-red-200 whitespace-nowrap">
                          {formatINR(totals.totalAdvances)} ({totals.totalAdvanceEntries})
                        </td>
                        <td className="py-2.5 px-1.5 text-right text-emerald-200 whitespace-nowrap">
                          {formatINR(totals.totalSettled)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-orange-200 whitespace-nowrap">
                          {formatINR(totals.totalEmployeeExpenses)}
                        </td>
                        <td className="py-2.5 px-2 text-right whitespace-nowrap">{formatINR(totals.totalNetPayable)}</td>
                        <td className="py-2.5 px-2.5 text-right font-sans text-[11px] text-slate-300 whitespace-nowrap">
                          Out: {formatINR(totals.totalDisbursed)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </section>
        );
      })()}

      {/* TAB 5: WORK ASSIGNMENT HISTORY LOG WITH DURATION & COMPLETION */}
      {activeTab === 'history' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Complete Flat &amp; Room Work History ({filteredHistory.length})
            </h2>
            <input
              type="text"
              aria-label="Filter work history by flat, room, or employee"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Filter by flat (101, 5001), tower, room, or employee ID..."
              className="w-full sm:w-80 px-3 py-1.5 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Start / Finish &amp; Duration</th>
                  <th className="py-2.5 px-3">Project / Tower</th>
                  <th className="py-2.5 px-3">Flat &amp; Room</th>
                  <th className="py-2.5 px-3">Employee</th>
                  <th className="py-2.5 px-3 text-right">Sq.Ft</th>
                  <th className="py-2.5 px-4 text-right">Status &amp; Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500">
                      No matching work history records.
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((item) => {
                    const dur = formatDurationBreakdown(item.assignedDate, item.completedDate, today);
                    const isOpen = isActiveWorkStatus(item.status);
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                          <div>Start: {item.assignedDate}</div>
                          {item.completedDate && (
                            <div className="text-emerald-700">Finish: {item.completedDate}</div>
                          )}
                          <div className="text-[11px] font-semibold text-slate-800">{dur.label}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-700">
                          <div>{item.projectName}</div>
                          <div className="text-xs text-slate-500">{item.towerName}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-900">
                            Flat <span className="font-mono">{item.unitNumber}</span> · {item.zoneLabel}
                          </div>
                          {item.notes && <div className="text-xs text-slate-500">{item.notes}</div>}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-900">{item.employeeName}</div>
                          <div className="text-xs font-mono text-slate-500">
                            {item.empCode} · {item.employeeRole}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                          {item.targetSqft}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded border ${getWorkStatusBadgeClass(
                                item.status
                              )}`}
                            >
                              {getWorkStatusLabel(item.status)}
                            </span>
                            {isOpen && (
                              <button
                                type="button"
                                onClick={() => completeAssignment(item.id, today)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                              >
                                <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                                <span>Mark Completed</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Sunday Weekly Food Run Batch Modal */}
      {showSundayBatchModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sunday-food-title"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-600" aria-hidden="true" />
                <h2 id="sunday-food-title" className="text-base font-semibold text-slate-900">
                  Sunday Weekly Food Advance Run (Tower Batch)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowSundayBatchModal(false)}
                aria-label="Close Sunday weekly food batch modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmSundayBatch} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="sun-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Disbursement Date
                  </label>
                  <input
                    id="sun-date"
                    type="date"
                    required
                    value={sundayBatchDate}
                    onChange={(e) => setSundayBatchDate(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-md"
                  />
                  {!isSundayDate(sundayBatchDate) && (
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Selected date is not Sunday; still tagged as weekly Sunday food run.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="sun-proj" className="block text-xs font-medium text-slate-700 mb-1">
                    Project
                  </label>
                  <select
                    id="sun-proj"
                    value={sundayBatchProjectId}
                    onChange={(e) => {
                      setSundayBatchProjectId(e.target.value);
                      setSundayBatchTowerId('all');
                    }}
                    className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    <option value="">All Projects</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="sun-twr" className="block text-xs font-medium text-slate-700 mb-1">
                    Tower
                  </label>
                  <select
                    id="sun-twr"
                    value={sundayBatchTowerId}
                    onChange={(e) => setSundayBatchTowerId(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    <option value="all">All Towers in Project</option>
                    {towers
                      .filter((t) => !sundayBatchProjectId || t.projectId === sundayBatchProjectId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="border border-slate-200 rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-medium text-slate-600">
                  <span>Tower Crew ({sundayBatchCrew.length})</span>
                  <span>Pre-filled at 6 × Daily Food Allowance</span>
                </div>
                <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {sundayBatchCrew.map((emp) => {
                    const st = sundayAmounts[emp.id] || {
                      checked: true,
                      amount: String((emp.foodAllowanceDaily || 150) * 6),
                    };
                    return (
                      <div key={emp.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                        <label className="flex items-center gap-2.5 cursor-pointer min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={st.checked}
                            onChange={(e) =>
                              setSundayAmounts((prev) => ({
                                ...prev,
                                [emp.id]: { ...st, checked: e.target.checked },
                              }))
                            }
                            className="rounded border-slate-300 text-orange-700"
                          />
                          <span className="font-mono text-slate-500">{emp.empCode}</span>
                          <span className="font-medium text-slate-900 truncate">{emp.fullName}</span>
                          <span className="text-slate-500">({emp.role})</span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          aria-label={`Weekly food amount for ${emp.fullName}`}
                          value={st.amount}
                          disabled={!st.checked}
                          onChange={(e) =>
                            setSundayAmounts((prev) => ({
                              ...prev,
                              [emp.id]: { ...st, amount: e.target.value },
                            }))
                          }
                          className="w-24 px-2 py-1 text-right font-mono border border-slate-300 rounded disabled:bg-slate-100"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sun-mode" className="block text-xs font-medium text-slate-700 mb-1">
                    Payment Mode
                  </label>
                  <select
                    id="sun-mode"
                    value={sundayBatchMode}
                    onChange={(e) => setSundayBatchMode(e.target.value as PaymentMode)}
                    className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    <option value="cash">Cash on Site</option>
                    <option value="upi">UPI</option>
                    <option value="bank_transfer">Bank Transfer</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="sun-notes" className="block text-xs font-medium text-slate-700 mb-1">
                    Notes
                  </label>
                  <input
                    id="sun-notes"
                    type="text"
                    value={sundayBatchNotes}
                    onChange={(e) => setSundayBatchNotes(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-md cursor-pointer">
                <input
                  type="checkbox"
                  checked={sundayRequireAdminApproval}
                  onChange={(e) => setSundayRequireAdminApproval(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-orange-700 focus:ring-orange-600"
                />
                <span className="text-xs text-amber-950">
                  <strong>Send to Admin for Approval &amp; Dispatch WhatsApp Simultaneously</strong> — queues batch for Admin approval and opens WhatsApp alerts for Admin &amp; crew right after submit
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowSundayBatchModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSundayBatch}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {savingSundayBatch
                    ? 'Submitting...'
                    : sundayRequireAdminApproval
                      ? 'Submit Approval & Send WhatsApp'
                      : 'Disburse Sunday Weekly Food Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settle Payment Modal */}
      {settlingEmpId && isAdmin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settle-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <h2 id="settle-title" className="text-base font-semibold text-slate-900">
              Confirm Payroll Settlement
            </h2>
            {(() => {
              const target = payrollSummaries.find((s) => s.employee.id === settlingEmpId);
              if (!target) return null;
              return (
                <p className="text-sm text-slate-600">
                  Record payout of{' '}
                  <strong className="font-mono text-slate-900">{formatINR(target.netPayable)}</strong>{' '}
                  to <strong>{target.employee.fullName}</strong> ({target.employee.empCode})?
                </p>
              );
            })()}
            <form onSubmit={handleSettleSubmit} className="space-y-4">
              <div>
                <label htmlFor="settle-mode" className="block text-xs font-medium text-slate-700 mb-1">
                  Payment Mode
                </label>
                <select
                  id="settle-mode"
                  value={settleMode}
                  onChange={(e) => setSettleMode(e.target.value as PaymentMode)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                >
                  <option value="upi">UPI (GPay / PhonePe / Paytm)</option>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
              </div>
              <div>
                <label htmlFor="settle-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Reference / Notes
                </label>
                <input
                  id="settle-notes"
                  type="text"
                  value={settleNotes}
                  onChange={(e) => setSettleNotes(e.target.value)}
                  placeholder="e.g. Weekly settlement UTR #..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <PaymentProofUploadBox
                value={{
                  paymentMode: settleMode,
                  paymentApp: settlePaymentApp,
                  transactionId: settleTransactionId,
                  upiId: settleUpiId,
                  proofImageDataUrl: settleProofImageDataUrl,
                }}
                onChange={(next: PaymentProofState) => {
                  setSettleMode(next.paymentMode);
                  setSettlePaymentApp(next.paymentApp);
                  setSettleTransactionId(next.transactionId);
                  setSettleUpiId(next.upiId);
                  setSettleProofImageDataUrl(next.proofImageDataUrl);
                }}
              />

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSettlingEmpId(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
                >
                  Confirm Settlement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Locked Attendance Modal */}
      {editingAttModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-att-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-orange-700" aria-hidden="true" />
                <h2 id="edit-att-title" className="text-base font-semibold text-slate-900">
                  Edit Locked Attendance
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingAttModal(null)}
                aria-label="Close edit attendance modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditedAttendance} className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs">
                <div className="font-semibold text-slate-900">
                  {editingAttModal.employee.fullName} ({editingAttModal.employee.empCode})
                </div>
                <div className="text-slate-500 font-mono mt-0.5">
                  Date: {editingAttModal.date} · Marked:{' '}
                  {ATTENDANCE_STATUS_LABELS[editingAttModal.record.status]}
                </div>
              </div>

              {editAttError && (
                <div
                  role="alert"
                  className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md"
                >
                  {editAttError}
                </div>
              )}

              <div>
                <span className="block text-xs font-medium text-slate-700 mb-1.5">
                  Revised Attendance Status
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'present', label: 'Present', cls: 'bg-emerald-700 text-white border-emerald-700' },
                      { id: 'half_day', label: 'Half Day', cls: 'bg-amber-600 text-white border-amber-600' },
                      { id: 'absent', label: 'Absent', cls: 'bg-red-700 text-white border-red-700' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setEditAttStatus(opt.id)}
                      className={`py-2 text-xs font-semibold rounded-md border transition-colors ${
                        editAttStatus === opt.id
                          ? opt.cls
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-att-in" className="block text-xs font-medium text-slate-700 mb-1">
                    In Time
                  </label>
                  <input
                    id="edit-att-in"
                    type="time"
                    disabled={editAttStatus === 'absent'}
                    value={editAttStatus === 'absent' ? '' : editAttInTime}
                    onChange={(e) => setEditAttInTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="edit-att-out" className="block text-xs font-medium text-slate-700 mb-1">
                    Out Time
                  </label>
                  <input
                    id="edit-att-out"
                    type="time"
                    disabled={editAttStatus === 'absent'}
                    value={editAttStatus === 'absent' ? '' : editAttOutTime}
                    onChange={(e) => setEditAttOutTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md disabled:bg-slate-100"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="edit-att-ot" className="block text-xs font-medium text-slate-700 mb-1">
                  Overtime Hours (OT)
                </label>
                <input
                  id="edit-att-ot"
                  type="number"
                  min="0"
                  max="16"
                  step="0.5"
                  disabled={editAttStatus === 'absent'}
                  value={editAttStatus === 'absent' ? '0' : editAttOt}
                  onChange={(e) => setEditAttOt(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md disabled:bg-slate-100"
                />
              </div>

              <div>
                <label htmlFor="edit-att-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Shift Notes (Optional)
                </label>
                <input
                  id="edit-att-notes"
                  type="text"
                  value={editAttNotes}
                  onChange={(e) => setEditAttNotes(e.target.value)}
                  placeholder="Optional shift note"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <label htmlFor="edit-att-reason" className="block text-xs font-medium text-slate-700 mb-1">
                  Reason for Attendance Edit (Required)
                </label>
                <input
                  id="edit-att-reason"
                  type="text"
                  required
                  value={editAttReason}
                  onChange={(e) => setEditAttReason(e.target.value)}
                  placeholder="e.g. Worker worked half day only / afternoon shift"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              {isSupervisor && !companyProfile.supervisorCanEditAttendance && (
                <div>
                  <label htmlFor="edit-att-pin" className="block text-xs font-medium text-slate-700 mb-1">
                    Admin Edit Override PIN
                  </label>
                  <input
                    id="edit-att-pin"
                    type="password"
                    required
                    value={editAttAdminPin}
                    onChange={(e) => setEditAttAdminPin(e.target.value)}
                    placeholder="Enter 4-digit Admin Edit PIN"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Supervisor attendance edits require Admin Edit PIN authorization.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingAttModal(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editAttSaving}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {editAttSaving ? 'Saving...' : 'Update Attendance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* OCR Written Advance Sheet Reader Modal */}
      <AdvanceScreenshotImportModal
        isOpen={showOcrImportModal}
        onClose={() => setShowOcrImportModal(false)}
        onImported={(count) => {
          setImportSuccessMsg(`Approved & added ${count} advance entr${count === 1 ? 'y' : 'ies'} from scanned sheet.`);
        }}
      />

      {/* Individual Employee Payment Details Modal */}
      <IndividualPaymentDetailsModal
        employeeId={indivDetailsEmpId}
        initialPeriodStart={periodStart}
        initialPeriodEnd={periodEnd}
        onClose={() => setIndivDetailsEmpId(null)}
        onTriggerWhatsapp={onTriggerWhatsapp}
      />

      {/* Payment Screenshot Lightbox */}
      {proofLightbox && (
        <ImageProofLightboxModal
          payload={proofLightbox}
          onClose={() => setProofLightbox(null)}
        />
      )}

      {/* Admin-Only Edit Advance Modal */}
      {editingAdvance && isAdmin && !hideSalary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-adv-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-orange-700" aria-hidden="true" />
                <h2 id="edit-adv-title" className="text-base font-semibold text-slate-900">
                  Edit Advance Entry (Admin)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingAdvance(null)}
                aria-label="Close edit advance modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditedAdvance} className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs">
                <div className="font-semibold text-slate-900">
                  {editingAdvance.employeeName} ({editingAdvance.empCode})
                </div>
                <div className="text-slate-500 font-mono mt-0.5">
                  Recorded: {editingAdvance.date} · {formatINR(editingAdvance.amount)}
                </div>
              </div>

              {editAdvError && (
                <div
                  role="alert"
                  className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md"
                >
                  {editAdvError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-adv-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Date
                  </label>
                  <input
                    id="edit-adv-date"
                    type="date"
                    required
                    value={editAdvDate}
                    onChange={(e) => setEditAdvDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="edit-adv-amount" className="block text-xs font-medium text-slate-700 mb-1">
                    Corrected Amount (INR)
                  </label>
                  <input
                    id="edit-adv-amount"
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={editAdvAmount}
                    onChange={(e) => setEditAdvAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-adv-type" className="block text-xs font-medium text-slate-700 mb-1">
                    Advance Type
                  </label>
                  <select
                    id="edit-adv-type"
                    value={editAdvType}
                    onChange={(e) => setEditAdvType(e.target.value as AdvanceType)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    <option value="daily_food">Daily Food</option>
                    <option value="weekly_food">Weekly Food</option>
                    <option value="cash_advance">Cash Advance</option>
                    <option value="custom">Custom Category</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-adv-mode" className="block text-xs font-medium text-slate-700 mb-1">
                    Payment Mode
                  </label>
                  <select
                    id="edit-adv-mode"
                    value={editAdvMode}
                    onChange={(e) => setEditAdvMode(e.target.value as PaymentMode)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="bank_transfer">Bank Transfer</option>
                  </select>
                </div>
              </div>

              {editAdvType === 'custom' && (
                <div>
                  <label htmlFor="edit-adv-custom" className="block text-xs font-medium text-slate-700 mb-1">
                    Custom Category Label
                  </label>
                  <input
                    id="edit-adv-custom"
                    type="text"
                    required
                    value={editAdvCustomCategory}
                    onChange={(e) => setEditAdvCustomCategory(e.target.value)}
                    placeholder="e.g. Room Rent / Medical / Travel"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              )}

              <div>
                <label htmlFor="edit-adv-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Notes / Correction Reason
                </label>
                <input
                  id="edit-adv-notes"
                  type="text"
                  value={editAdvNotes}
                  onChange={(e) => setEditAdvNotes(e.target.value)}
                  placeholder="Optional note or correction remark"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingAdvance(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editAdvSaving}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {editAdvSaving ? 'Saving...' : 'Save Corrected Advance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Scan Attendance Session Modal */}
      <QuickScanAttendanceModal
        open={showQuickScanModal}
        onClose={() => setShowQuickScanModal(false)}
        session={session}
        projects={projects}
        towers={towers}
        employees={employees}
        attendance={attendance}
        defaultDate={selectedDate}
        defaultProjectId={selectedProjectId}
        defaultTowerId={selectedTowerId}
        onMarkAttendance={markAttendance}
        onPunchOut={punchAttendanceOut}
        onUndoAttendanceScan={deleteAttendanceRecord}
      />

      {/* Isolated Vertical Print Preview: Individual Worker Attendance Card */}
      {cardEmployee && employeeCardData && companyProfile && (
        <PrintPreviewOverlay
          open={showPrintCardPreview}
          mode="attendance_card_a4"
          title={`${cardEmployee.empCode} ${cardEmployee.fullName} — Worker Attendance Card`}
          subtitle={`${employeeCardData.monthLabel} · ${cardEmployee.role}`}
          onClose={() => setShowPrintCardPreview(false)}
          onDownloadPdf={() => {
            const siteStr = cardEmployee.currentProjectName
              ? `${cardEmployee.currentProjectName}${
                  cardEmployee.currentTowerName ? ` (${cardEmployee.currentTowerName})` : ''
                }`
              : 'Unassigned';
            const { blob, fileName } = buildEmployeeAttendanceCardPdfBlob({
              companyName,
              empCode: cardEmployee.empCode,
              employeeName: cardEmployee.fullName,
              role: cardEmployee.role,
              phone: cardEmployee.phone,
              siteLabel: siteStr,
              dailyRateText: `${formatINR(cardEmployee.dailyRate)}/day`,
              monthLabel: employeeCardData.monthLabel,
              presentDays: employeeCardData.presentDays,
              halfDays: employeeCardData.halfDays,
              absentDays: employeeCardData.absentDays,
              effectiveDays: employeeCardData.effectiveDays,
              overtimeHours: employeeCardData.overtimeHours,
              totalWagesEarnedText: formatINR(employeeCardData.totalWagesEarned),
              monthAdvancesText: formatINR(employeeCardData.monthAdvancesTotal),
              hideSalaryRates: hideSalary,
              days: employeeCardData.days.map((d) => ({
                day: d.day,
                date: d.date,
                weekdayShort: d.weekdayShort,
                statusLabel: d.status ? ATTENDANCE_STATUS_LABELS[d.status] : 'Unmarked',
                siteLabel: d.projectName
                  ? `${d.projectName}${d.towerName ? ` / ${d.towerName}` : ''}`
                  : siteStr,
                otHours: d.overtimeHours,
                earnedText: d.earned > 0 ? formatINR(d.earned) : '-',
                notes: d.record?.notes || '',
              })),
            });
            triggerDownloadBlob(blob, fileName);
          }}
          renderPrintContent={() => {
            const siteStr = cardEmployee.currentProjectName
              ? `${cardEmployee.currentProjectName}${
                  cardEmployee.currentTowerName ? ` (${cardEmployee.currentTowerName})` : ''
                }`
              : 'Unassigned';
            return (
              <PrintableAttendanceCardSheet
                company={companyProfile}
                card={employeeCardData}
                siteLabel={siteStr}
                hideSalaryRates={hideSalary}
              />
            );
          }}
        />
      )}

      <WeeklyFoodApprovalWhatsappModal
        payload={weeklyFoodWaModal}
        onClose={() => setWeeklyFoodWaModal(null)}
      />
    </div>
  );
}
