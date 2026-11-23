import React, { useMemo, useState } from 'react';
import {
  CalendarCheck,
  Eye,
  MessageSquare,
  Printer,
  ReceiptIndianRupee,
  Wallet,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { WhatsappMessagePayload } from '../types/avy';
import { canViewEmployeeFixedSalary } from '../utils/authAccess';
import {
  ATTENDANCE_STATUS_LABELS,
  computeIndividualEmployeePaymentDetails,
  formatINR,
  formatPaymentSummaryWhatsappMessage,
} from '../utils/payroll';
import {
  ImageProofLightboxModal,
  type ProofLightboxPayload,
} from './ImageProofLightboxModal';

interface IndividualPaymentDetailsModalProps {
  employeeId: string | null;
  initialPeriodStart?: string;
  initialPeriodEnd?: string;
  onClose: () => void;
  onTriggerWhatsapp?: (payload: WhatsappMessagePayload) => void;
}

export function IndividualPaymentDetailsModal({
  employeeId,
  initialPeriodStart = '',
  initialPeriodEnd = '',
  onClose,
  onTriggerWhatsapp,
}: IndividualPaymentDetailsModalProps) {
  const {
    session,
    companyProfile,
    employees,
    attendance,
    advances,
    settlements,
  } = useStore();
  const hideSalary = !canViewEmployeeFixedSalary(session);

  const [periodStart, setPeriodStart] = useState(initialPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(initialPeriodEnd);
  const [activeTab, setActiveTab] = useState<'advances' | 'attendance' | 'settlements'>('advances');
  const [proofLightbox, setProofLightbox] = useState<ProofLightboxPayload | null>(null);

  const employee = useMemo(
    () => employees.find((e) => e.id === employeeId) || null,
    [employees, employeeId]
  );

  const details = useMemo(() => {
    if (!employee) return null;
    return computeIndividualEmployeePaymentDetails({
      employee,
      attendance,
      advances,
      settlements,
      dateRange:
        periodStart || periodEnd
          ? { start: periodStart || undefined, end: periodEnd || undefined }
          : undefined,
    });
  }, [employee, attendance, advances, settlements, periodStart, periodEnd]);

  if (!employeeId || !employee || !details) return null;

  const { summary, attendanceEntries, advanceEntries, settlementEntries, categoryTotals } =
    details;
  const companyName = companyProfile?.companyName || 'AVY INFRA';
  const periodLabel =
    periodStart || periodEnd
      ? `${periodStart || 'Start'} to ${periodEnd || 'Today'}`
      : 'All Recorded Days';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="indiv-payment-title"
    >
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <div className="text-xs font-mono font-semibold text-orange-700">
              INDIVIDUAL EMPLOYEE PAYMENT DETAILS · {employee.empCode}
            </div>
            <h2 id="indiv-payment-title" className="text-lg font-semibold text-slate-900 truncate">
              {employee.fullName}{' '}
              <span className="text-sm font-normal text-slate-500">
                {hideSalary
                  ? `(${employee.role})`
                  : `(${employee.role} · ${formatINR(employee.dailyRate)}/day · OT ${formatINR(
                      employee.overtimeRate
                    )}/hr)`}
              </span>
            </h2>
            <p className="text-xs text-slate-500">
              {employee.currentProjectName || 'All Sites'}
              {employee.currentTowerName ? ` (${employee.currentTowerName})` : ''} ·{' '}
              {details.digitalTxnCount} Digital Txns · {details.proofsCount} Stored Proofs
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onTriggerWhatsapp && !hideSalary && (
              <button
                type="button"
                onClick={() =>
                  onTriggerWhatsapp({
                    title: 'Share Individual Payment Statement (WhatsApp / Email)',
                    recipientName: `${employee.fullName} (${employee.empCode})`,
                    recipientPhone: employee.phone,
                    recipientEmail: employee.email || '',
                    emailSubject: `${companyName} Individual Payment Details — ${employee.fullName}`,
                    message: formatPaymentSummaryWhatsappMessage(
                      summary,
                      periodLabel,
                      companyName
                    ),
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100"
              >
                <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Share WA / Mail</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Print</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close individual payment details modal"
              className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Date Filter Bar */}
          <div className="flex flex-wrap items-end justify-between gap-3 bg-slate-50 border border-slate-200 rounded-md p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="ind-start" className="block text-[11px] font-medium text-slate-600 mb-0.5">
                  From Date
                </label>
                <input
                  id="ind-start"
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="px-2.5 py-1 text-xs font-mono bg-white border border-slate-300 rounded"
                />
              </div>
              <div>
                <label htmlFor="ind-end" className="block text-[11px] font-medium text-slate-600 mb-0.5">
                  To Date
                </label>
                <input
                  id="ind-end"
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="px-2.5 py-1 text-xs font-mono bg-white border border-slate-300 rounded"
                />
              </div>
              {(periodStart || periodEnd) && (
                <button
                  type="button"
                  onClick={() => {
                    setPeriodStart('');
                    setPeriodEnd('');
                  }}
                  className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 underline"
                >
                  Show All Days
                </button>
              )}
            </div>
            <div className="text-xs font-mono text-slate-600">
              Showing: <strong className="text-slate-900">{periodLabel}</strong>
            </div>
          </div>

          {/* Summary Cards */}
          {hideSalary ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                <div className="text-[11px] font-medium text-slate-500">Days Attended</div>
                <div className="mt-1 text-xl font-mono font-bold text-slate-900 tabular-nums">
                  {summary.effectiveDaysWorked}d
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 font-mono">
                  {summary.presentDays}P · {summary.halfDays}HD · {summary.overtimeHours}h OT
                </div>
              </div>

              <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                <div className="text-[11px] font-medium text-slate-500">Total Advances</div>
                <div className="mt-1 text-xl font-mono font-bold text-red-700 tabular-nums">
                  {formatINR(summary.totalAdvances)}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 font-mono">
                  {summary.advanceCount} advance entr{summary.advanceCount === 1 ? 'y' : 'ies'}
                </div>
              </div>

              <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                <div className="text-[11px] font-medium text-slate-500">Food Advances</div>
                <div className="mt-1 text-xl font-mono font-bold text-amber-800 tabular-nums">
                  {formatINR(summary.dailyFoodAdvance + summary.weeklyFoodAdvance)}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 font-mono">
                  Daily + Weekly Food
                </div>
              </div>

              <div className="p-3.5 bg-slate-900 text-white rounded-lg">
                <div className="text-[11px] text-slate-300">Cash &amp; Custom Adv</div>
                <div className="mt-1 text-xl font-mono font-bold tabular-nums">
                  {formatINR(summary.cashAdvance + summary.customAdvance)}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-300 font-mono">
                  Cash {formatINR(summary.cashAdvance)} · Cust {formatINR(summary.customAdvance)}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                  <div className="text-[11px] font-medium text-slate-500">Gross Wages + OT Earned</div>
                  <div className="mt-1 text-xl font-mono font-bold text-slate-900 tabular-nums">
                    {formatINR(summary.totalEarned)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 font-mono">
                    {summary.effectiveDaysWorked}d ({summary.presentDays}P · {summary.halfDays}HD) +{' '}
                    {summary.overtimeHours}h OT
                  </div>
                </div>

                <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                  <div className="text-[11px] font-medium text-slate-500">Total Advances Deducted</div>
                  <div className="mt-1 text-xl font-mono font-bold text-red-700 tabular-nums">
                    {formatINR(summary.totalAdvances)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 font-mono">
                    Food {formatINR(summary.dailyFoodAdvance + summary.weeklyFoodAdvance)} · Cash{' '}
                    {formatINR(summary.cashAdvance)}
                    {summary.customAdvance > 0 ? ` · Custom ${formatINR(summary.customAdvance)}` : ''}
                  </div>
                </div>

                <div className="p-3.5 bg-white border border-slate-200 rounded-lg">
                  <div className="text-[11px] font-medium text-slate-500">Salary Settled / Paid</div>
                  <div className="mt-1 text-xl font-mono font-bold text-emerald-800 tabular-nums">
                    {formatINR(summary.totalSettled)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 font-mono">
                    {settlementEntries.length} settlement payout{settlementEntries.length !== 1 ? 's' : ''}
                  </div>
                </div>

                <div className="p-3.5 bg-slate-900 text-white rounded-lg">
                  <div className="text-[11px] text-slate-300">Net Payable Balance</div>
                  <div className="mt-1 text-xl font-mono font-bold tabular-nums">
                    {formatINR(summary.netPayable)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-300">
                    Earned - Advances - Settled
                  </div>
                </div>
              </div>

              {/* Total Employee Expenses & Cash Outflow Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-orange-50/70 border border-orange-200 rounded-lg p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-orange-950">
                      Total Worker Expenses (Wages + All Advances)
                    </div>
                    <div className="text-[11px] text-orange-800/80 font-mono">
                      {formatINR(summary.totalEarned)} wages + {formatINR(summary.totalAdvances)} advances ({summary.advanceCount} entries)
                    </div>
                  </div>
                  <div className="text-lg font-mono font-bold text-orange-800 tabular-nums shrink-0">
                    {formatINR(summary.totalEmployeeExpenses)}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:border-l sm:border-orange-200 sm:pl-4">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      Cash / UPI Paid Out So Far (Adv + Settled)
                    </div>
                    <div className="text-[11px] text-slate-600 font-mono">
                      {formatINR(summary.totalAdvances)} advances + {formatINR(summary.totalSettled)} settled
                    </div>
                  </div>
                  <div className="text-lg font-mono font-bold text-slate-900 tabular-nums shrink-0">
                    {formatINR(summary.totalDisbursed)}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Advance Category Totals Breakdown */}
          {categoryTotals.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-700">
                Advance Category Breakdown (Including Custom Categories)
              </div>
              <div className="flex flex-wrap gap-2">
                {categoryTotals.map((cat) => (
                  <div
                    key={cat.key}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded text-xs flex items-center gap-2"
                  >
                    <span className="font-medium text-slate-800">{cat.label}</span>
                    <span className="text-[11px] text-slate-500">({cat.count})</span>
                    <span className="font-mono font-semibold text-red-700">
                      {formatINR(cat.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sub-Tabs */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md w-fit">
            {[
              {
                id: 'advances' as const,
                label: `Advances & Receipts (${advanceEntries.length})`,
                icon: Wallet,
              },
              {
                id: 'attendance' as const,
                label: hideSalary
                  ? `Attendance Log (${attendanceEntries.length})`
                  : `Wages & Attendance (${attendanceEntries.length})`,
                icon: CalendarCheck,
              },
              ...(!hideSalary
                ? [
                    {
                      id: 'settlements' as const,
                      label: `Salary Settlements (${settlementEntries.length})`,
                      icon: ReceiptIndianRupee,
                    },
                  ]
                : []),
            ].map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tab 1: Advances Ledger with Txn ID, UPI ID & Stored Proof */}
          {activeTab === 'advances' && (
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Mode / App / Txn ID &amp; UPI</th>
                    <th className="py-2.5 px-3">Notes</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                    <th className="py-2.5 px-3 text-right">Screenshot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {advanceEntries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No advance entries in this period.
                      </td>
                    </tr>
                  ) : (
                    advanceEntries.map((adv) => (
                      <tr key={adv.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                          {adv.date}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {adv.categoryLabel}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-800 uppercase">
                            {adv.paymentMode}
                            {adv.paymentApp ? ` · ${adv.paymentApp}` : ''}
                          </div>
                          {(adv.transactionId || adv.upiId) && (
                            <div className="text-[11px] font-mono text-slate-500">
                              {adv.transactionId ? `UTR: ${adv.transactionId}` : ''}
                              {adv.transactionId && adv.upiId ? ' · ' : ''}
                              {adv.upiId ? `UPI: ${adv.upiId}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{adv.notes || '—'}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-red-700 whitespace-nowrap">
                          {formatINR(adv.amount)}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {adv.proofImageDataUrl ? (
                            <button
                              type="button"
                              onClick={() =>
                                setProofLightbox({
                                  title: `${employee.fullName} — ${adv.categoryLabel}`,
                                  subtitle: `${adv.date} · ${employee.empCode}`,
                                  imageDataUrl: adv.proofImageDataUrl!,
                                  paymentMode: adv.paymentMode,
                                  paymentApp: adv.paymentApp,
                                  transactionId: adv.transactionId,
                                  upiId: adv.upiId,
                                  amount: adv.amount,
                                  date: adv.date,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                            >
                              <Eye className="w-3 h-3" aria-hidden="true" />
                              <span>Proof</span>
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 2: Attendance & Daily Wages */}
          {activeTab === 'attendance' && (
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Site / Tower</th>
                    <th className="py-2.5 px-3">Status</th>
                    {!hideSalary && (
                      <>
                        <th className="py-2.5 px-3 text-right">Wage</th>
                        <th className="py-2.5 px-3 text-right">OT Pay</th>
                        <th className="py-2.5 px-3 text-right">Total Earned</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attendanceEntries.length === 0 ? (
                    <tr>
                      <td colSpan={hideSalary ? 3 : 6} className="py-8 text-center text-slate-500">
                        No attendance logs in this period.
                      </td>
                    </tr>
                  ) : (
                    attendanceEntries.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                          {rec.date}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">
                          {rec.projectName || '—'}
                          {rec.towerName ? ` (${rec.towerName})` : ''}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-medium text-slate-900">
                            {ATTENDANCE_STATUS_LABELS[rec.status]}
                          </span>
                          {rec.overtimeHours > 0 ? ` (+${rec.overtimeHours}h OT)` : ''}
                        </td>
                        {!hideSalary && (
                          <>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {formatINR(rec.dailyWageEarned)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                              {formatINR(rec.overtimePayEarned)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                              {formatINR(rec.dailyWageEarned + rec.overtimePayEarned)}
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 3: Settlements History */}
          {!hideSalary && activeTab === 'settlements' && (
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 px-3">Settled Date</th>
                    <th className="py-2.5 px-3">Period</th>
                    <th className="py-2.5 px-3">Mode / App / Txn ID &amp; UPI</th>
                    <th className="py-2.5 px-3 text-right">Net Paid</th>
                    <th className="py-2.5 px-3 text-right">Screenshot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {settlementEntries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        No salary settlements recorded yet.
                      </td>
                    </tr>
                  ) : (
                    settlementEntries.map((stl) => (
                      <tr key={stl.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                          {stl.settledDate}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          {stl.periodStart} → {stl.periodEnd}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="uppercase font-medium text-slate-800">
                            {stl.paymentMode}
                            {stl.paymentApp ? ` · ${stl.paymentApp}` : ''}
                          </div>
                          {(stl.transactionId || stl.upiId) && (
                            <div className="text-[11px] font-mono text-slate-500">
                              {stl.transactionId ? `UTR: ${stl.transactionId}` : ''}
                              {stl.transactionId && stl.upiId ? ' · ' : ''}
                              {stl.upiId ? `UPI: ${stl.upiId}` : ''}
                            </div>
                          )}
                          {stl.notes && <div className="text-slate-500">{stl.notes}</div>}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-800 whitespace-nowrap">
                          {formatINR(stl.netPaid)}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {stl.proofImageDataUrl ? (
                            <button
                              type="button"
                              onClick={() =>
                                setProofLightbox({
                                  title: `${employee.fullName} — Salary Settlement Proof`,
                                  subtitle: `${stl.settledDate} · ${employee.empCode}`,
                                  imageDataUrl: stl.proofImageDataUrl!,
                                  paymentMode: stl.paymentMode,
                                  paymentApp: stl.paymentApp,
                                  transactionId: stl.transactionId,
                                  upiId: stl.upiId,
                                  amount: stl.netPaid,
                                  date: stl.settledDate,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                            >
                              <Eye className="w-3 h-3" aria-hidden="true" />
                              <span>Proof</span>
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {proofLightbox && (
        <ImageProofLightboxModal
          payload={proofLightbox}
          onClose={() => setProofLightbox(null)}
        />
      )}
    </div>
  );
}
