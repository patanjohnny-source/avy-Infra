import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Wallet, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import type { AdvanceType, PaymentMode, WhatsappMessagePayload } from '../types/avy';
import { isSundayDate } from '../utils/operations';
import {
  getScopedEmployees,
  getScopedProjects,
  getScopedTowers,
  isAdminSession,
  isSupervisorSession,
} from '../utils/authAccess';
import { PaymentProofUploadBox, type PaymentProofState } from './PaymentProofUploadBox';

interface GiveAdvanceModalProps {
  isOpen: boolean;
  preselectedEmployeeId?: string;
  onClose: () => void;
  onTriggerWhatsapp: (payload: WhatsappMessagePayload) => void;
}

export function GiveAdvanceModal({
  isOpen,
  preselectedEmployeeId,
  onClose,
  onTriggerWhatsapp,
}: GiveAdvanceModalProps) {
  const {
    session,
    companyProfile,
    employees: allEmployees,
    projects: allProjects,
    towers: allTowers,
    advances,
    addAdvance,
    updateCompanyProfile,
  } = useStore();
  const isAdmin = isAdminSession(session);
  const isSupervisor = isSupervisorSession(session);
  const employees = useMemo(
    () => getScopedEmployees(session, allEmployees),
    [session, allEmployees]
  );
  const projects = useMemo(
    () => getScopedProjects(session, allProjects, allTowers),
    [session, allProjects, allTowers]
  );
  const towers = useMemo(() => getScopedTowers(session, allTowers), [session, allTowers]);
  const activeEmployees = employees.filter((e) => e.status === 'active');

  const customPresets = useMemo(() => {
    const set = new Set<string>(companyProfile?.customAdvanceCategories || []);
    for (const adv of advances) {
      if (adv.advanceType === 'custom' && adv.customCategory?.trim()) {
        set.add(adv.customCategory.trim());
      }
    }
    return Array.from(set).sort();
  }, [companyProfile?.customAdvanceCategories, advances]);

  const [employeeId, setEmployeeId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [towerId, setTowerId] = useState('');
  const [advanceType, setAdvanceType] = useState<AdvanceType>('daily_food');
  const [customCategory, setCustomCategory] = useState('');
  const [saveCustomPreset, setSaveCustomPreset] = useState(true);
  const [amount, setAmount] = useState('150');
  const [date, setDate] = useState(getTodayIso());
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [paymentApp, setPaymentApp] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [upiId, setUpiId] = useState('');
  const [proofImageDataUrl, setProofImageDataUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [sendWhatsappAfter, setSendWhatsappAfter] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const defaultEmp = preselectedEmployeeId || activeEmployees[0]?.id || '';
    setEmployeeId(defaultEmp);
    const emp = employees.find((e) => e.id === defaultEmp);
    const todayIso = getTodayIso();
    const isSun = isSundayDate(todayIso);

    setProjectId(emp?.currentProjectId || projects[0]?.id || '');
    setTowerId(emp?.currentTowerId || '');
    setDate(todayIso);
    if (isSun) {
      setAdvanceType('weekly_food');
      setAmount(String((emp?.foodAllowanceDaily || 150) * 6));
      setNotes('Sunday weekly food advance');
    } else {
      setAdvanceType('daily_food');
      setAmount(emp ? String(emp.foodAllowanceDaily || 150) : '150');
      setNotes('');
    }
    setCustomCategory('');
    setSaveCustomPreset(true);
    setPaymentMode('cash');
    setPaymentApp('');
    setTransactionId('');
    setUpiId('');
    setProofImageDataUrl('');
    setError('');
    setSendWhatsappAfter(true);
  }, [isOpen, preselectedEmployeeId]);

  const projectTowers = useMemo(
    () => towers.filter((t) => t.projectId === projectId),
    [towers, projectId]
  );

  if (!isOpen) return null;

  const selectedEmployee = employees.find((e) => e.id === employeeId);
  const dateIsSunday = isSundayDate(date);
  const weeklyPresetAmt = (selectedEmployee?.foodAllowanceDaily || 150) * 6;

  const handleEmployeeChange = (nextEmpId: string) => {
    setEmployeeId(nextEmpId);
    const emp = employees.find((e) => e.id === nextEmpId);
    if (emp) {
      if (emp.currentProjectId) setProjectId(emp.currentProjectId);
      if (emp.currentTowerId) setTowerId(emp.currentTowerId);
      if (advanceType === 'daily_food') {
        setAmount(String(emp.foodAllowanceDaily || 150));
      } else if (advanceType === 'weekly_food') {
        setAmount(String((emp.foodAllowanceDaily || 150) * 6));
      }
    }
  };

  const handleTypeChange = (nextType: AdvanceType) => {
    setAdvanceType(nextType);
    if (selectedEmployee) {
      if (nextType === 'daily_food') {
        setAmount(String(selectedEmployee.foodAllowanceDaily || 150));
      } else if (nextType === 'weekly_food') {
        setAmount(String((selectedEmployee.foodAllowanceDaily || 150) * 6));
        if (dateIsSunday && !notes.trim()) {
          setNotes('Sunday weekly food advance');
        }
      }
    }
  };

  const handleDateChange = (nextDate: string) => {
    setDate(nextDate);
    if (isSundayDate(nextDate) && advanceType === 'daily_food') {
      setAdvanceType('weekly_food');
      setAmount(String(weeklyPresetAmt));
      if (!notes.trim()) setNotes('Sunday weekly food advance');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!employeeId) {
      setError('Please select an employee.');
      return;
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid advance amount greater than 0.');
      return;
    }

    if (advanceType === 'custom' && !customCategory.trim()) {
      setError('Please enter or select a custom advance category name.');
      return;
    }

    setSubmitting(true);
    try {
      const cleanCustomCat = advanceType === 'custom' ? customCategory.trim() : undefined;
      const result = await addAdvance({
        date,
        employeeId,
        advanceType,
        customCategory: cleanCustomCat,
        amount: parsedAmount,
        paymentMode,
        paymentApp: paymentApp.trim() || undefined,
        transactionId: transactionId.trim() || undefined,
        upiId: upiId.trim() || undefined,
        proofImageDataUrl: proofImageDataUrl || undefined,
        projectId,
        towerId,
        isSundayRun: advanceType === 'weekly_food' && dateIsSunday,
        notes,
      });

      if (isAdmin && saveCustomPreset && cleanCustomCat) {
        const existing = companyProfile?.customAdvanceCategories || [];
        if (!existing.some((c) => c.toLowerCase() === cleanCustomCat.toLowerCase())) {
          updateCompanyProfile({
            customAdvanceCategories: [...existing, cleanCustomCat],
          }).catch(() => undefined);
        }
      }

      onClose();
      if (sendWhatsappAfter) {
        onTriggerWhatsapp({
          title: 'Send Advance Receipt (WhatsApp / Email)',
          recipientName: `${result.advance.employeeName} (${result.advance.empCode})`,
          recipientPhone: result.advance.employeePhone,
          recipientEmail: selectedEmployee?.email || '',
          emailSubject: `Advance Payment Receipt — ${result.advance.date}`,
          message: result.whatsappMessage,
          advanceId: result.advance.id,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record advance.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="give-advance-title"
    >
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <Wallet className="w-5 h-5 text-orange-700" aria-hidden="true" />
            <h2 id="give-advance-title" className="text-base font-semibold text-slate-900">
              Record Food / Cash Advance
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close advance modal"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          {dateIsSunday && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-md flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-amber-950">
                <CalendarDays className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
                <span>
                  <strong>Sunday Weekly Food Day</strong> — Weekly food advances are highlighted &amp; grouped for site reporting.
                </span>
              </div>
              {advanceType !== 'weekly_food' && (
                <button
                  type="button"
                  onClick={() => handleTypeChange('weekly_food')}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-amber-700 text-white rounded hover:bg-amber-800 whitespace-nowrap shrink-0"
                >
                  Use ₹{weeklyPresetAmt}
                </button>
              )}
            </div>
          )}

          <div>
            <label htmlFor="adv-employee" className="block text-xs font-medium text-slate-700 mb-1.5">
              Employee
            </label>
            <select
              id="adv-employee"
              value={employeeId}
              onChange={(e) => handleEmployeeChange(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-600/20 focus:border-orange-600"
            >
              {activeEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} — {emp.fullName} ({emp.role})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3 p-2.5 bg-slate-50 border border-slate-200 rounded-md">
            <div>
              <label htmlFor="adv-project" className="block text-[11px] font-medium text-slate-600 mb-1">
                Project Attribution
              </label>
              <select
                id="adv-project"
                value={projectId}
                onChange={(e) => {
                  const pId = e.target.value;
                  setProjectId(pId);
                  setTowerId(towers.find((t) => t.projectId === pId)?.id || '');
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
              >
                {!isSupervisor && <option value="">General</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="adv-tower" className="block text-[11px] font-medium text-slate-600 mb-1">
                Tower Attribution
              </label>
              <select
                id="adv-tower"
                value={towerId}
                onChange={(e) => setTowerId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
              >
                {!isSupervisor && <option value="">All / Project</option>}
                {projectTowers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-700 mb-1.5">Advance Category</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'daily_food' as const, label: 'Daily Food' },
                { id: 'weekly_food' as const, label: 'Weekly Food' },
                { id: 'cash_advance' as const, label: 'Cash Advance' },
                { id: 'custom' as const, label: 'Custom Category' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleTypeChange(opt.id)}
                  className={`px-2.5 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                    advanceType === opt.id
                      ? 'bg-orange-700 text-white border-orange-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {advanceType === 'custom' && (
              <div className="mt-2.5 p-3 bg-orange-50/60 border border-orange-200 rounded-md space-y-2">
                {customPresets.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-slate-600">Saved Presets:</span>
                    {customPresets.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setCustomCategory(preset)}
                        className={`px-2 py-0.5 text-[11px] font-medium rounded border ${
                          customCategory.trim().toLowerCase() === preset.toLowerCase()
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
                  <label htmlFor="adv-custom-cat" className="block text-[11px] font-medium text-slate-700 mb-1">
                    Custom Category Name (e.g. Medical, Gas, Travel, Room Rent)
                  </label>
                  <input
                    id="adv-custom-cat"
                    type="text"
                    required
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="Enter custom category name..."
                    className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                  />
                </div>
                {isAdmin && (
                  <label className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveCustomPreset}
                      onChange={(e) => setSaveCustomPreset(e.target.checked)}
                      className="rounded border-slate-300 text-orange-700"
                    />
                    <span>Save as reusable custom advance category preset</span>
                  </label>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="adv-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
                Amount (₹)
              </label>
              <input
                id="adv-amount"
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-600/20 focus:border-orange-600"
              />
            </div>

            <div>
              <label htmlFor="adv-date" className="block text-xs font-medium text-slate-700 mb-1.5">
                Date
              </label>
              <input
                id="adv-date"
                type="date"
                value={date}
                onChange={(e) => handleDateChange(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-600/20 focus:border-orange-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="adv-mode" className="block text-xs font-medium text-slate-700 mb-1.5">
                Payment Mode
              </label>
              <select
                id="adv-mode"
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-600/20 focus:border-orange-600"
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI (GPay / PhonePe / Paytm)</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
            </div>
            <div>
              <label htmlFor="adv-notes" className="block text-xs font-medium text-slate-700 mb-1.5">
                Note (Optional)
              </label>
              <input
                id="adv-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Mess / Sunday ration"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-600/20 focus:border-orange-600"
              />
            </div>
          </div>

          <PaymentProofUploadBox
            value={{
              paymentMode,
              paymentApp,
              transactionId,
              upiId,
              proofImageDataUrl,
            }}
            onChange={(next: PaymentProofState) => {
              setPaymentMode(next.paymentMode);
              setPaymentApp(next.paymentApp);
              setTransactionId(next.transactionId);
              setUpiId(next.upiId);
              setProofImageDataUrl(next.proofImageDataUrl);
            }}
            onDetectedAmount={(amt) => {
              if (amt > 0) setAmount(String(amt));
            }}
            onDetectedDate={(isoDate) => {
              if (isoDate) setDate(isoDate);
            }}
          />

          <label className="flex items-center gap-2.5 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={sendWhatsappAfter}
              onChange={(e) => setSendWhatsappAfter(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-orange-700 focus:ring-orange-600"
            />
            <span className="text-xs text-slate-700">
              Prepare WhatsApp message for{' '}
              <strong className="text-slate-900">
                {selectedEmployee?.fullName || 'employee'}
              </strong>{' '}
              immediately after saving
            </span>
          </label>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {submitting ? 'Saving...' : 'Save Advance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
