import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Eye,
  IndianRupee,
  MessageSquare,
  ReceiptIndianRupee,
  Volume2,
  Wallet,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import { countUnreadMessengerMessages } from '../utils/messenger';
import {
  computeSingleEmployeeAttendanceCard,
  computeWorkedHoursFromInOut,
  formatAttendanceInOutSummary,
} from '../utils/operations';
import { collectOpenZoneIssuesForFlats } from '../utils/tileZones';
import {
  ATTENDANCE_STATUS_LABELS,
  computeEmployeePayroll,
  formatINR,
  getAdvanceCategoryLabel,
} from '../utils/payroll';
import {
  ImageProofLightboxModal,
  type ProofLightboxPayload,
} from './ImageProofLightboxModal';
import { TeamMessengerView } from './TeamMessengerView';

export function EmployeePortalView() {
  const {
    session,
    projects,
    towers,
    flats,
    employees,
    attendance,
    advances,
    settlements,
    companyProfile,
    teamMessages,
    acknowledgeAdvance,
  } = useStore();
  const today = getTodayIso();
  const [activeTab, setActiveTab] = useState<'portal' | 'messenger'>('portal');
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [proofLightbox, setProofLightbox] = useState<ProofLightboxPayload | null>(null);
  const [ackingId, setAckingId] = useState<string | null>(null);
  const [dismissedPopupSignature, setDismissedPopupSignature] = useState<string>('');

  const unreadMessengerCount = useMemo(
    () =>
      countUnreadMessengerMessages({
        session,
        companyProfile,
        employees,
        messages: teamMessages,
      }),
    [session, companyProfile, employees, teamMessages]
  );

  const employee = useMemo(
    () => employees.find((e) => e.id === session?.employeeId) || null,
    [employees, session?.employeeId]
  );

  const payroll = useMemo(() => {
    if (!employee) return null;
    return computeEmployeePayroll(employee, attendance, advances, settlements);
  }, [employee, attendance, advances, settlements]);

  const monthCard = useMemo(() => {
    if (!employee) return null;
    return computeSingleEmployeeAttendanceCard({
      employee,
      yearMonth: selectedMonth,
      attendance,
      advances,
    });
  }, [employee, selectedMonth, attendance, advances]);

  const myAttendance = useMemo(() => {
    if (!employee) return [];
    return attendance
      .filter((a) => a.employeeId === employee.id)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [attendance, employee]);

  const myAdvances = useMemo(() => {
    if (!employee) return [];
    return advances
      .filter((a) => a.employeeId === employee.id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [advances, employee]);

  const mySettlements = useMemo(() => {
    if (!employee) return [];
    return settlements
      .filter((s) => s.employeeId === employee.id)
      .sort((a, b) => b.settledDate.localeCompare(a.settledDate));
  }, [settlements, employee]);

  const myOpenIssues = useMemo(() => {
    if (!employee) return [];
    return collectOpenZoneIssuesForFlats({
      flats,
      projects,
      towers,
      tileZoneCatalog: companyProfile?.tileZoneCatalog,
      employeeId: employee.id,
    });
  }, [employee, flats, projects, towers, companyProfile?.tileZoneCatalog]);

  const issueSignature = useMemo(
    () =>
      myOpenIssues
        .map((i) => `${i.flatId}:${i.zoneKey}:${i.notes}:${i.voiceNoteTranscript || ''}`)
        .join('|'),
    [myOpenIssues]
  );

  useEffect(() => {
    if (myOpenIssues.length === 0) {
      setDismissedPopupSignature('');
    }
  }, [myOpenIssues.length]);

  const showIssuePopup =
    activeTab === 'portal' &&
    myOpenIssues.length > 0 &&
    dismissedPopupSignature !== issueSignature;

  if (!employee || !payroll || !monthCard) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-600">
        Your employee profile could not be loaded. Please sign out and contact Admin.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Portal Mode Switcher: Self-Service vs Team Messenger */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 border border-slate-200 rounded-lg">
          <button
            type="button"
            data-testid="employee-tab-portal"
            onClick={() => setActiveTab('portal')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'portal'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarCheck className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
            <span>My Attendance &amp; Payroll</span>
          </button>
          <button
            type="button"
            data-testid="employee-tab-messenger"
            onClick={() => setActiveTab('messenger')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'messenger'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
            <span>Team Messenger</span>
            {unreadMessengerCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-orange-700 text-white rounded-full">
                {unreadMessengerCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'messenger' ? (
        <TeamMessengerView />
      ) : (
        <>
      {/* Personal Profile Banner */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-14 h-14 rounded-lg border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
            {employee.photoDataUrl ? (
              <img
                src={employee.photoDataUrl}
                alt={employee.fullName}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="font-mono font-bold text-base text-slate-600">
                {employee.fullName
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
              {employee.empCode} · {employee.role}
            </div>
            <h1 className="text-xl font-semibold text-slate-900 truncate">{employee.fullName}</h1>
            <div className="text-xs text-slate-600 mt-0.5 truncate">
              {employee.currentProjectName
                ? `${employee.currentProjectName}${employee.currentTowerName ? ` (${employee.currentTowerName})` : ''}`
                : companyProfile?.companyName || 'AVY INFRA'}{' '}
              · Rate {formatINR(employee.dailyRate)}/day · OT {formatINR(employee.overtimeRate)}/hr · Phone {employee.phone}
            </div>
          </div>
        </div>

        <div className="px-4 py-2.5 bg-slate-900 text-white rounded-lg shrink-0 text-right">
          <div className="text-[11px] text-slate-300">Current Net Payable Balance</div>
          <div className="text-xl font-mono font-bold tabular-nums">
            {formatINR(payroll.netPayable)}
          </div>
        </div>
      </section>

      {/* Persistent Supervisor Issue Alerts Banner (Active until rectified) */}
      {myOpenIssues.length > 0 && (
        <section
          data-testid="worker-open-issues-banner"
          className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-amber-950">
                Supervisor Issue Alerts Assigned to You ({myOpenIssues.length})
              </h2>
            </div>
            <span className="text-[11px] font-medium text-amber-900">
              Complete &amp; inform supervisor to rectify
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {myOpenIssues.map((issue) => (
              <div
                key={`${issue.flatId}_${issue.zoneKey}`}
                className="bg-white border border-amber-200 rounded-md p-3 space-y-1.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    Unit <span className="font-mono">{issue.unitNumber}</span> · {issue.zoneLabel}
                  </span>
                  <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase bg-red-50 text-red-800 border border-red-200 rounded">
                    Action Required
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {issue.projectName} · {issue.towerName}
                  {issue.issueReportedBy ? ` · Flagged by ${issue.issueReportedBy}` : ''}
                </div>
                {issue.notes && <div className="text-slate-800 font-medium">{issue.notes}</div>}
                {issue.voiceNoteTranscript && (
                  <div className="text-orange-950 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                    <Volume2 className="w-3 h-3 inline mr-1" aria-hidden="true" />
                    {issue.voiceNoteTranscript}
                  </div>
                )}
                {issue.voiceNoteDataUrl && (
                  <audio
                    controls
                    src={issue.voiceNoteDataUrl}
                    className="w-full h-8"
                    aria-label={`Voice alert for ${issue.unitNumber} ${issue.zoneLabel}`}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4 Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Days Worked</span>
            <CalendarCheck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-mono font-bold tabular-nums text-slate-900">
            {payroll.effectiveDaysWorked}d
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {payroll.presentDays} Full · {payroll.halfDays} Half · {payroll.overtimeHours}h OT
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Gross Wages + OT Earned</span>
            <IndianRupee className="w-4 h-4 text-slate-500" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-mono font-bold tabular-nums text-slate-900">
            {formatINR(payroll.totalEarned)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Wages {formatINR(payroll.grossWages)} + OT {formatINR(payroll.overtimePay)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Advances Taken</span>
            <Wallet className="w-4 h-4 text-red-700" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-mono font-bold tabular-nums text-red-700">
            {formatINR(payroll.totalAdvances)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Food {formatINR(payroll.dailyFoodAdvance + payroll.weeklyFoodAdvance)} · Cash{' '}
            {formatINR(payroll.cashAdvance)}
            {payroll.customAdvance > 0 ? ` · Custom ${formatINR(payroll.customAdvance)}` : ''}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Paid / Settled &amp; Balance</span>
            <CheckCircle2 className="w-4 h-4 text-orange-700" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-mono font-bold tabular-nums text-emerald-800">
            {formatINR(payroll.netPayable)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Already Paid: {formatINR(payroll.totalSettled)}
          </div>
        </div>
      </div>

      {/* Attendance Card + Payment Breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Monthly Attendance Card */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                My Monthly Attendance ({monthCard.monthLabel})
              </h2>
              <p className="text-xs text-slate-500">
                {monthCard.presentDays} Present · {monthCard.halfDays} Half-Day ·{' '}
                {monthCard.absentDays} Absent · Month Earned {formatINR(monthCard.totalWagesEarned)}
              </p>
            </div>
            <div>
              <label htmlFor="emp-portal-month" className="sr-only">
                Select Month
              </label>
              <input
                id="emp-portal-month"
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-slate-500">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((wd) => (
              <div key={wd} className={wd === 'Sun' ? 'text-amber-700' : ''}>
                {wd}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: monthCard.mondayOffset }).map((_, i) => (
              <div key={`pad_${i}`} className="min-h-[70px] rounded bg-slate-50/40" aria-hidden="true" />
            ))}
            {monthCard.days.map((cell) => {
              const cls =
                cell.status === 'present'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : cell.status === 'half_day'
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : cell.status === 'absent'
                      ? 'bg-red-50 border-red-300 text-red-900'
                      : 'bg-white border-slate-200 text-slate-500';
              const tag =
                cell.status === 'present'
                  ? 'P'
                  : cell.status === 'half_day'
                    ? 'HD'
                    : cell.status === 'absent'
                      ? 'A'
                      : '—';
              return (
                <div
                  key={cell.date}
                  className={`min-h-[70px] p-1.5 rounded border flex flex-col justify-between ${cls}`}
                >
                  <div className="flex items-center justify-between text-xs font-mono font-bold">
                    <span>{cell.day}</span>
                    <span>{tag}</span>
                  </div>
                  <div className="text-[10px] font-mono tabular-nums truncate">
                    {cell.earned > 0 ? formatINR(cell.earned) : cell.isSunday ? 'Sun' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Payment & Advance Breakdown Summary */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <ReceiptIndianRupee className="w-4 h-4 text-orange-700" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">
              Payment Status &amp; Advance Balance
            </h2>
          </div>

          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-600">Basic Wages Earned ({payroll.effectiveDaysWorked}d)</span>
              <span className="font-mono font-medium text-slate-900 tabular-nums">
                {formatINR(payroll.grossWages)}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-600">Overtime Pay ({payroll.overtimeHours} hrs)</span>
              <span className="font-mono font-medium text-slate-900 tabular-nums">
                {formatINR(payroll.overtimePay)}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-600">Less: Daily Food Advance</span>
              <span className="font-mono font-medium text-red-700 tabular-nums">
                -{formatINR(payroll.dailyFoodAdvance)}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-600">Less: Sunday / Weekly Food Advance</span>
              <span className="font-mono font-medium text-red-700 tabular-nums">
                -{formatINR(payroll.weeklyFoodAdvance)}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-600">Less: Cash Advance</span>
              <span className="font-mono font-medium text-red-700 tabular-nums">
                -{formatINR(payroll.cashAdvance)}
              </span>
            </div>
            {payroll.customAdvance > 0 && (
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-600">
                  Less: Custom Advances
                  {payroll.customAdvanceBreakdown.length > 0
                    ? ` (${payroll.customAdvanceBreakdown.map((b) => b.label).join(', ')})`
                    : ''}
                </span>
                <span className="font-mono font-medium text-red-700 tabular-nums">
                  -{formatINR(payroll.customAdvance)}
                </span>
              </div>
            )}
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-600">Less: Settled / Paid Out</span>
              <span className="font-mono font-medium text-slate-700 tabular-nums">
                -{formatINR(payroll.totalSettled)}
              </span>
            </div>
            <div className="flex justify-between pt-2 text-base font-semibold">
              <span className="text-slate-900">Net Payable Balance</span>
              <span className="font-mono text-emerald-800 tabular-nums">
                {formatINR(payroll.netPayable)}
              </span>
            </div>
          </div>

          {mySettlements.length > 0 && (
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Recent Salary Settlements
              </h3>
              {mySettlements.map((stl) => (
                <div
                  key={stl.id}
                  className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded text-xs flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-mono font-semibold text-emerald-950">{stl.settledDate}</div>
                    <div className="text-emerald-800">
                      {stl.paymentMode.toUpperCase()}
                      {stl.paymentApp ? ` · ${stl.paymentApp}` : ''} · {stl.notes || 'Payroll Settlement'}
                    </div>
                    {(stl.transactionId || stl.upiId) && (
                      <div className="text-[10px] font-mono text-emerald-700">
                        {stl.transactionId ? `UTR: ${stl.transactionId}` : ''}
                        {stl.transactionId && stl.upiId ? ' · ' : ''}
                        {stl.upiId ? `UPI: ${stl.upiId}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {stl.proofImageDataUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          setProofLightbox({
                            title: 'Salary Settlement Receipt',
                            subtitle: `${employee.fullName} · ${stl.settledDate}`,
                            imageDataUrl: stl.proofImageDataUrl!,
                            paymentMode: stl.paymentMode,
                            paymentApp: stl.paymentApp,
                            transactionId: stl.transactionId,
                            upiId: stl.upiId,
                            amount: stl.netPaid,
                            date: stl.settledDate,
                          })
                        }
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-white border border-emerald-300 text-emerald-900 rounded"
                      >
                        <Eye className="w-3 h-3" aria-hidden="true" />
                        <span>Proof</span>
                      </button>
                    )}
                    <div className="font-mono font-bold text-emerald-900 tabular-nums">
                      {formatINR(stl.netPaid)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Daily Attendance Log + Advance Ledger Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Daily Attendance Log ({myAttendance.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-3">Site / Tower</th>
                  <th className="py-2.5 px-3">In / Out</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-4 text-right">Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myAttendance.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 text-xs">
                      No attendance records logged yet.
                    </td>
                  </tr>
                ) : (
                  myAttendance.map((rec) => {
                    const dur = computeWorkedHoursFromInOut(rec.inTime, rec.outTime);
                    return (
                      <tr key={rec.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                          {rec.date}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-700">
                          <div>{rec.projectName || '—'}</div>
                          {rec.towerName && <div className="text-slate-500">{rec.towerName}</div>}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {rec.status === 'absent' ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <div>
                              <div>{formatAttendanceInOutSummary(rec)}</div>
                              {dur.valid && (
                                <div className="text-[10.5px] text-slate-500">
                                  Shift: {dur.totalHours}h
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-xs">
                          <span
                            className={`inline-block px-2 py-0.5 rounded font-medium ${
                              rec.status === 'present'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : rec.status === 'half_day'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'bg-red-50 text-red-800 border border-red-200'
                            }`}
                          >
                            {ATTENDANCE_STATUS_LABELS[rec.status]}
                            {rec.overtimeHours > 0 ? ` (+${rec.overtimeHours}h)` : ''}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatINR(rec.dailyWageEarned + rec.overtimePayEarned)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              My Advance &amp; Food Kharchi Ledger ({myAdvances.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-3">Type &amp; Mode</th>
                  <th className="py-2.5 px-3">Notes &amp; Receipt Ack</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myAdvances.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500 text-xs">
                      No advances recorded yet.
                    </td>
                  </tr>
                ) : (
                  myAdvances.map((adv) => (
                    <tr key={adv.id} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                        {adv.date}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-700">
                        <div>{getAdvanceCategoryLabel(adv)}</div>
                        <div className="text-[11px] font-mono text-slate-500 uppercase">
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
                      <td className="py-2.5 px-3 text-xs text-slate-600 space-y-1.5">
                        <div>{adv.notes || '—'}</div>
                        <div>
                          {adv.acknowledged ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>Acknowledged</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={ackingId === adv.id}
                              onClick={async () => {
                                setAckingId(adv.id);
                                try {
                                  await acknowledgeAdvance(
                                    adv.id,
                                    `${employee.fullName} (Employee Portal)`
                                  );
                                } finally {
                                  setAckingId(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-300 rounded hover:bg-orange-100 disabled:opacity-50 whitespace-nowrap"
                            >
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>
                                {ackingId === adv.id ? 'Confirming...' : 'Acknowledge Receipt'}
                              </span>
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold text-red-700 tabular-nums whitespace-nowrap">
                        <div>{formatINR(adv.amount)}</div>
                        {adv.proofImageDataUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setProofLightbox({
                                title: `Advance Receipt — ${getAdvanceCategoryLabel(adv)}`,
                                subtitle: `${employee.fullName} · ${adv.date}`,
                                imageDataUrl: adv.proofImageDataUrl!,
                                paymentMode: adv.paymentMode,
                                paymentApp: adv.paymentApp,
                                transactionId: adv.transactionId,
                                upiId: adv.upiId,
                                amount: adv.amount,
                                date: adv.date,
                              })
                            }
                            className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                          >
                            <Eye className="w-2.5 h-2.5" aria-hidden="true" />
                            <span>View Proof</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {proofLightbox && (
        <ImageProofLightboxModal
          payload={proofLightbox}
          onClose={() => setProofLightbox(null)}
        />
      )}

      {/* Automatic Assigned Worker Issue Popup Dialog */}
      {showIssuePopup && (
        <div
          data-testid="worker-issue-popup-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="worker-issue-popup-title"
        >
          <div className="w-full max-w-lg bg-white border border-amber-300 rounded-lg shadow-xl overflow-hidden max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 bg-amber-50 border-b border-amber-200 shrink-0">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-800" aria-hidden="true" />
                <h2 id="worker-issue-popup-title" className="text-sm font-semibold text-amber-950">
                  Attention: Supervisor Issue Alert ({myOpenIssues.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDismissedPopupSignature(issueSignature)}
                aria-label="Close issue alert popup"
                className="p-1.5 text-amber-800 hover:text-amber-950 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 overflow-y-auto">
              <p className="text-xs text-slate-600">
                Your supervisor flagged the following flat tile-laying remark(s) on your assigned work:
              </p>
              {myOpenIssues.map((issue) => (
                <div
                  key={`pop_${issue.flatId}_${issue.zoneKey}`}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1.5 text-xs"
                >
                  <div className="font-semibold text-slate-900">
                    Unit <span className="font-mono">{issue.unitNumber}</span> · {issue.zoneLabel}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {issue.projectName} · {issue.towerName}
                  </div>
                  {issue.notes && (
                    <div className="text-slate-800 font-medium">{issue.notes}</div>
                  )}
                  {issue.voiceNoteTranscript && (
                    <div className="text-orange-950 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                      <Volume2 className="w-3 h-3 inline mr-1" aria-hidden="true" />
                      {issue.voiceNoteTranscript}
                    </div>
                  )}
                  {issue.voiceNoteDataUrl && (
                    <audio controls src={issue.voiceNoteDataUrl} className="w-full h-8" />
                  )}
                </div>
              ))}
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setDismissedPopupSignature(issueSignature)}
                className="px-4 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
              >
                Acknowledge &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
