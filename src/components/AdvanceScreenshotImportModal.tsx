import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Plus,
  ScanText,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import type {
  AdvanceType,
  OcrAdvanceSheetResult,
  PaymentMode,
} from '../types/avy';
import {
  getScopedEmployees,
  getScopedProjects,
  getScopedTowers,
  isAdminSession,
} from '../utils/authAccess';
import { compressBoundedScreenshotDataUrl } from '../utils/idCardPdf';
import {
  matchOcrEmployeeRow,
  normalizeOcrAdvanceCategory,
  normalizeOcrPaymentMode,
  sanitizeIsoDateInput,
} from '../utils/ocrMatching';
import { formatINR } from '../utils/payroll';

interface AdvanceScreenshotImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported?: (count: number) => void;
}

interface ReviewRow {
  rowKey: string;
  approved: boolean;
  rawName: string;
  rawEmpCode: string;
  matchReason: string;
  employeeId: string;
  amount: string;
  advanceType: AdvanceType;
  customCategory: string;
  date: string;
  paymentMode: PaymentMode;
  paymentApp: string;
  notes: string;
  confidence: string;
}

export function AdvanceScreenshotImportModal({
  isOpen,
  onClose,
  onImported,
}: AdvanceScreenshotImportModalProps) {
  const {
    session,
    companyProfile,
    employees: rawEmployees,
    projects: rawProjects,
    towers: rawTowers,
    advances,
    bulkAddAdvances,
    updateCompanyProfile,
  } = useStore();

  const isAdmin = isAdminSession(session);
  const employees = useMemo(
    () => getScopedEmployees(session, rawEmployees),
    [session, rawEmployees]
  );
  const projects = useMemo(
    () => getScopedProjects(session, rawProjects, rawTowers),
    [session, rawProjects, rawTowers]
  );
  const towers = useMemo(() => getScopedTowers(session, rawTowers), [session, rawTowers]);

  const today = getTodayIso();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [defaultDate, setDefaultDate] = useState(today);
  const [defaultProjectId, setDefaultProjectId] = useState(projects[0]?.id || '');
  const [defaultTowerId, setDefaultTowerId] = useState('');
  const [previewDataUrl, setPreviewDataUrl] = useState('');
  const [sheetTitle, setSheetTitle] = useState('');
  const [reading, setReading] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const knownCustomCategories = useMemo(() => {
    const set = new Set<string>(companyProfile?.customAdvanceCategories || []);
    for (const adv of advances) {
      if (adv.advanceType === 'custom' && adv.customCategory?.trim()) {
        set.add(adv.customCategory.trim());
      }
    }
    return Array.from(set).sort();
  }, [companyProfile?.customAdvanceCategories, advances]);

  if (!isOpen) return null;

  const handleUploadSheet = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrError('');
    setSubmitError('');
    setReading(true);

    try {
      const dbPreview = await compressBoundedScreenshotDataUrl(file, {
        maxWidth: 680,
        maxHeight: 1050,
        quality: 0.68,
        maxChars: 220000,
      });
      setPreviewDataUrl(dbPreview);

      const ocrImage = await compressBoundedScreenshotDataUrl(file, {
        maxWidth: 1100,
        maxHeight: 1600,
        quality: 0.84,
        maxChars: 900000,
      });

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 30000);
      let resp: Response;
      try {
        resp = await fetch('/api/ocr/advance-sheet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageDataUrl: ocrImage,
            hintDate: defaultDate,
            employees: employees.map((emp) => ({
              empCode: emp.empCode,
              fullName: emp.fullName,
              role: emp.role,
            })),
          }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      const body = (await resp.json().catch(() => ({}))) as Partial<OcrAdvanceSheetResult> & {
        error?: string;
      };

      if (!resp.ok) {
        setOcrError(
          body.error ||
            'Could not auto-read this advance sheet screenshot. You can still add rows manually below.'
        );
        return;
      }

      const detectedDate = sanitizeIsoDateInput(body.detectedDate, defaultDate);
      setSheetTitle(body.sheetTitle || 'Extracted Written Advance Sheet');

      const mapped: ReviewRow[] = (body.rows || []).map((r, idx) => {
        const match = matchOcrEmployeeRow(r.rawName || '', r.rawEmpCode || '', employees);
        const cat = normalizeOcrAdvanceCategory(
          r.categoryText || '',
          knownCustomCategories
        );
        const modeInfo = normalizeOcrPaymentMode(r.paymentModeText || '');
        const amtNum = Number(r.amount) || 0;
        return {
          rowKey: `ocr_${Date.now()}_${idx}`,
          approved: Boolean(match.employee && amtNum > 0),
          rawName: r.rawName || '',
          rawEmpCode: r.rawEmpCode || '',
          matchReason: match.employee
            ? `${match.matchReason.replace('_', ' ')} (${match.score}%)`
            : 'Unmatched',
          employeeId: match.employee?.id || '',
          amount: amtNum > 0 ? String(Math.round(amtNum)) : '',
          advanceType: cat.advanceType,
          customCategory: cat.customCategory,
          date: sanitizeIsoDateInput(r.date, detectedDate),
          paymentMode: modeInfo.paymentMode,
          paymentApp: modeInfo.paymentApp,
          notes: r.notes || '',
          confidence: r.confidence || 'medium',
        };
      });

      setRows(mapped);
      if (mapped.length === 0) {
        setOcrError('No advance rows were detected in the image. You can add rows manually below.');
      }
    } catch (err) {
      setOcrError(
        err instanceof Error ? err.message : 'Failed to process advance sheet image.'
      );
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleAddBlankRow = () => {
    setRows((prev) => [
      ...prev,
      {
        rowKey: `manual_${Date.now()}_${prev.length}`,
        approved: true,
        rawName: 'Manual Row',
        rawEmpCode: '',
        matchReason: 'Manual',
        employeeId: employees[0]?.id || '',
        amount: '',
        advanceType: 'cash_advance',
        customCategory: '',
        date: defaultDate,
        paymentMode: 'cash',
        paymentApp: '',
        notes: '',
        confidence: 'manual',
      },
    ]);
  };

  const updateRow = (rowKey: string, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));
  };

  const approvedValidRows = rows.filter(
    (r) => r.approved && r.employeeId && Number(r.amount) > 0
  );
  const approvedTotalAmount = approvedValidRows.reduce(
    (s, r) => s + (Number(r.amount) || 0),
    0
  );

  const handleApproveAndAdd = async () => {
    setSubmitError('');
    if (approvedValidRows.length === 0) {
      setSubmitError('Please approve at least one row with a matched employee and valid amount.');
      return;
    }

    const invalidCustom = approvedValidRows.find(
      (r) => r.advanceType === 'custom' && !r.customCategory.trim()
    );
    if (invalidCustom) {
      setSubmitError('Please enter a Custom Category name for every approved custom-type row.');
      return;
    }

    setSubmitting(true);
    try {
      await bulkAddAdvances(
        approvedValidRows.map((r) => {
          const emp = employees.find((e) => e.id === r.employeeId);
          return {
            date: r.date || defaultDate,
            employeeId: r.employeeId,
            advanceType: r.advanceType,
            customCategory:
              r.advanceType === 'custom' ? r.customCategory.trim() : undefined,
            amount: Math.round(Number(r.amount)),
            paymentMode: r.paymentMode,
            paymentApp: r.paymentApp.trim() || undefined,
            proofImageDataUrl: previewDataUrl || undefined,
            projectId: emp?.currentProjectId || defaultProjectId || undefined,
            towerId: emp?.currentTowerId || defaultTowerId || undefined,
            notes: r.notes.trim() || 'Scanned Advance Sheet',
          };
        })
      );

      // Persist any new custom categories into company presets when Admin
      if (isAdmin && companyProfile) {
        const existing = companyProfile.customAdvanceCategories || [];
        const newCustoms = Array.from(
          new Set(
            approvedValidRows
              .filter((r) => r.advanceType === 'custom' && r.customCategory.trim())
              .map((r) => r.customCategory.trim())
          )
        ).filter((lbl) => !existing.some((e) => e.toLowerCase() === lbl.toLowerCase()));
        if (newCustoms.length > 0) {
          updateCompanyProfile({
            customAdvanceCategories: [...existing, ...newCustoms],
          }).catch(() => undefined);
        }
      }

      onImported?.(approvedValidRows.length);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save approved advances.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ocr-sheet-title"
    >
      <div className="w-full max-w-6xl bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <ScanText className="w-5 h-5 text-orange-700" aria-hidden="true" />
            <div>
              <h2 id="ocr-sheet-title" className="text-base font-semibold text-slate-900">
                Read Written Advance Screenshot &amp; Approve List
              </h2>
              <p className="text-xs text-slate-500">
                Upload a photo or screenshot of a handwritten/printed advance list. Review worker matches &amp; approve to post directly into Advances.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close written advance reader modal"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Controls & Upload */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="ocr-def-date" className="block text-xs font-medium text-slate-600 mb-1">
                  Fallback Date
                </label>
                <input
                  id="ocr-def-date"
                  type="date"
                  value={defaultDate}
                  onChange={(e) => setDefaultDate(e.target.value)}
                  className="px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="ocr-def-proj" className="block text-xs font-medium text-slate-600 mb-1">
                  Fallback Project
                </label>
                <select
                  id="ocr-def-proj"
                  value={defaultProjectId}
                  onChange={(e) => {
                    setDefaultProjectId(e.target.value);
                    setDefaultTowerId('');
                  }}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                >
                  <option value="">Employee Site Default</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ocr-def-twr" className="block text-xs font-medium text-slate-600 mb-1">
                  Fallback Tower
                </label>
                <select
                  id="ocr-def-twr"
                  value={defaultTowerId}
                  onChange={(e) => setDefaultTowerId(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                >
                  <option value="">Employee Tower Default</option>
                  {towers
                    .filter((t) => !defaultProjectId || t.projectId === defaultProjectId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddBlankRow}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add Manual Row</span>
              </button>
              <label
                htmlFor="ocr-sheet-upload"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 cursor-pointer whitespace-nowrap"
              >
                {reading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{reading ? 'Reading Sheet...' : 'Upload Written Advance Screenshot'}</span>
              </label>
              <input
                ref={fileRef}
                id="ocr-sheet-upload"
                type="file"
                accept="image/*"
                onChange={handleUploadSheet}
                className="sr-only"
              />
            </div>
          </div>

          {ocrError && (
            <div
              role="alert"
              className="p-3 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-300 rounded-md"
            >
              {ocrError}
            </div>
          )}
          {submitError && (
            <div
              role="alert"
              className="p-3 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md"
            >
              {submitError}
            </div>
          )}

          {/* Split Preview + Review List */}
          {(previewDataUrl || rows.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {previewDataUrl && (
                <div className="lg:col-span-3 min-w-0 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                  <div
                    className="text-xs font-semibold text-slate-800 truncate"
                    title={sheetTitle || 'Uploaded Advance Sheet'}
                  >
                    Uploaded Advance Sheet {sheetTitle ? `· ${sheetTitle}` : ''}
                  </div>
                  <img
                    src={previewDataUrl}
                    alt="Uploaded advance register screenshot"
                    className="w-full max-h-80 object-contain rounded border border-slate-200 bg-white"
                  />
                  <div className="text-[11px] text-slate-500">
                    Sheet image is attached as proof on approved advance entries.
                  </div>
                </div>
              )}

              <div className={previewDataUrl ? 'lg:col-span-9 min-w-0' : 'lg:col-span-12 min-w-0'}>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="font-semibold text-slate-800">
                      Review &amp; Approve List ({rows.length} rows detected)
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setRows((prev) => prev.map((r) => ({ ...r, approved: Boolean(r.employeeId && Number(r.amount) > 0) })))
                        }
                        className="text-orange-700 font-semibold hover:underline"
                      >
                        Approve Matched
                      </button>
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.map((r) => ({ ...r, approved: false })))}
                        className="text-slate-600 hover:underline"
                      >
                        Uncheck All
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-medium text-slate-500">
                          <th className="py-2 px-2.5">Approve</th>
                          <th className="py-2 px-2.5">Read Name / ID</th>
                          <th className="py-2 px-2.5">Matched Employee</th>
                          <th className="py-2 px-2.5">Category</th>
                          <th className="py-2 px-2.5">Amount (₹)</th>
                          <th className="py-2 px-2.5">Date &amp; Mode</th>
                          <th className="py-2 px-2.5"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-slate-500">
                              Upload a written screenshot above or click &ldquo;Add Manual Row&rdquo;.
                            </td>
                          </tr>
                        ) : (
                          rows.map((r) => (
                            <tr
                              key={r.rowKey}
                              className={r.approved ? 'bg-emerald-50/40' : 'bg-white'}
                            >
                              <td className="py-2.5 px-2.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={r.approved}
                                  aria-label={`Approve row ${r.rawName || r.rowKey}`}
                                  onChange={(e) =>
                                    updateRow(r.rowKey, { approved: e.target.checked })
                                  }
                                  className="w-4 h-4 rounded border-slate-300 text-orange-700"
                                />
                              </td>
                              <td className="py-2.5 px-2 max-w-[130px]">
                                <div className="font-medium text-slate-900 truncate">
                                  {r.rawName || '—'}
                                </div>
                                <div className="text-[10px] font-mono text-slate-500 truncate">
                                  ID: {r.rawEmpCode || '—'} · {r.matchReason}
                                </div>
                              </td>
                              <td className="py-2.5 px-2 min-w-[155px]">
                                <select
                                  value={r.employeeId}
                                  onChange={(e) =>
                                    updateRow(r.rowKey, {
                                      employeeId: e.target.value,
                                      approved: Boolean(e.target.value && Number(r.amount) > 0),
                                    })
                                  }
                                  className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                                >
                                  <option value="">-- Select Employee --</option>
                                  {employees.map((emp) => (
                                    <option key={emp.id} value={emp.id}>
                                      {emp.empCode} — {emp.fullName}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2.5 px-2 min-w-[130px] space-y-1">
                                <select
                                  value={r.advanceType}
                                  onChange={(e) =>
                                    updateRow(r.rowKey, {
                                      advanceType: e.target.value as AdvanceType,
                                    })
                                  }
                                  className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                                >
                                  <option value="daily_food">Daily Food</option>
                                  <option value="weekly_food">Weekly Food</option>
                                  <option value="cash_advance">Cash Advance</option>
                                  <option value="custom">Custom Category</option>
                                </select>
                                {r.advanceType === 'custom' && (
                                  <input
                                    type="text"
                                    value={r.customCategory}
                                    onChange={(e) =>
                                      updateRow(r.rowKey, { customCategory: e.target.value })
                                    }
                                    placeholder="e.g. Medical / Gas"
                                    className="w-full px-2 py-1 text-[11px] bg-white border border-orange-300 rounded"
                                  />
                                )}
                              </td>
                              <td className="py-2.5 px-2">
                                <input
                                  type="number"
                                  min="1"
                                  value={r.amount}
                                  onChange={(e) =>
                                    updateRow(r.rowKey, { amount: e.target.value })
                                  }
                                  className="w-20 px-2 py-1 text-xs font-mono text-right bg-white border border-slate-300 rounded"
                                />
                              </td>
                              <td className="py-2.5 px-2 space-y-1 min-w-[118px]">
                                <input
                                  type="date"
                                  value={r.date}
                                  onChange={(e) => updateRow(r.rowKey, { date: e.target.value })}
                                  className="w-full px-2 py-1 text-[11px] font-mono bg-white border border-slate-300 rounded"
                                />
                                <select
                                  value={r.paymentMode}
                                  onChange={(e) =>
                                    updateRow(r.rowKey, {
                                      paymentMode: e.target.value as PaymentMode,
                                    })
                                  }
                                  className="w-full px-2 py-1 text-[11px] bg-white border border-slate-300 rounded"
                                >
                                  <option value="cash">Cash</option>
                                  <option value="upi">UPI</option>
                                  <option value="bank_transfer">Bank Transfer</option>
                                </select>
                              </td>
                              <td className="py-2.5 px-2 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRows((prev) => prev.filter((x) => x.rowKey !== r.rowKey))
                                  }
                                  aria-label="Remove row"
                                  className="p-1 text-slate-400 hover:text-red-700"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!previewDataUrl && rows.length === 0 && (
            <div className="py-12 border-2 border-dashed border-slate-200 rounded-lg text-center space-y-2">
              <ScanText className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
              <div className="text-sm font-medium text-slate-700">
                Upload a written / printed advance notebook screenshot
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                AI Vision reads each worker&apos;s Name, Employee ID, Amount &amp; Category, matches them against your workforce, and lets you approve before saving to Advances.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs font-mono text-slate-700">
            Approved: <strong>{approvedValidRows.length}</strong> entries · Total{' '}
            <strong className="text-red-700">{formatINR(approvedTotalAmount)}</strong>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || approvedValidRows.length === 0}
              onClick={handleApproveAndAdd}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              <span>
                {submitting
                  ? 'Adding Advances...'
                  : `Approve & Add Selected Advances (${approvedValidRows.length})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
