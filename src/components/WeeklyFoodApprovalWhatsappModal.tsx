import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Mail,
  MessageSquare,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { AdvanceEntry } from '../types/avy';
import { formatINR } from '../utils/payroll';
import {
  buildWeeklyFoodAdminApprovalWhatsappMessage,
  buildWhatsappDirectUrl,
  resolveAdminApprovalContact,
} from '../utils/weeklyFoodApproval';

export interface WeeklyFoodApprovalModalPayload {
  batchId: string;
  date: string;
  siteLabel: string;
  submittedByName: string;
  submittedByRole: 'admin' | 'supervisor';
  entries: AdvanceEntry[];
  requiresAdminApproval: boolean;
}

interface WeeklyFoodApprovalWhatsappModalProps {
  payload: WeeklyFoodApprovalModalPayload | null;
  onClose: () => void;
}

export function WeeklyFoodApprovalWhatsappModal({
  payload,
  onClose,
}: WeeklyFoodApprovalWhatsappModalProps) {
  const { companyProfile, employees, markAdvanceWhatsappShared } = useStore();
  const companyName = companyProfile?.companyName || 'AVY INFRA';
  const adminContact = resolveAdminApprovalContact(companyProfile);

  const [adminPhone, setAdminPhone] = useState(adminContact.adminPhone);
  const [copied, setCopied] = useState(false);
  const [sharedWorkerIds, setSharedWorkerIds] = useState<string[]>([]);

  useEffect(() => {
    if (!payload) return;
    setAdminPhone(adminContact.adminPhone);
    setCopied(false);
    setSharedWorkerIds([]);
  }, [payload, adminContact.adminPhone]);

  if (!payload) return null;

  const adminMessage = buildWeeklyFoodAdminApprovalWhatsappMessage({
    companyName,
    date: payload.date,
    submittedByName: payload.submittedByName,
    submittedByRole: payload.submittedByRole,
    siteLabel: payload.siteLabel,
    batchId: payload.batchId,
    entries: payload.entries.map((e) => ({
      employeeName: e.employeeName,
      empCode: e.empCode,
      amount: e.amount,
      paymentMode: e.paymentMode,
    })),
  });

  const totalAmount = payload.entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const adminWaUrl = buildWhatsappDirectUrl(adminPhone, adminMessage);
  const adminMailto = `mailto:${encodeURIComponent(
    adminContact.adminEmail
  )}?subject=${encodeURIComponent(
    `[${companyName}] Weekly Food Run Approval Request — ${payload.siteLabel} (${payload.date})`
  )}&body=${encodeURIComponent(adminMessage)}`;

  const handleCopyAdminMsg = async () => {
    try {
      await navigator.clipboard.writeText(adminMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="weekly-food-approval-wa-title"
      data-testid="weekly-food-approval-whatsapp-modal"
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <ShieldCheck className="w-5 h-5 text-orange-700 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2
                id="weekly-food-approval-wa-title"
                className="text-base font-semibold text-slate-900 truncate"
              >
                Weekly Food Run Sent for Admin Approval &amp; WhatsApp Dispatch
              </h2>
              <p className="text-xs text-slate-500 truncate">
                {payload.siteLabel} · {payload.date} · {payload.entries.length} worker(s) ·{' '}
                {formatINR(totalAmount)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close weekly food approval WhatsApp modal"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-md text-xs text-amber-950 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              {payload.requiresAdminApproval ? (
                <span>
                  <strong>Queued for Admin Approval ({payload.batchId}):</strong> Dispatch the Admin WhatsApp approval request below and notify the crew simultaneously.
                </span>
              ) : (
                <span>
                  <strong>Weekly Food Run Saved ({payload.batchId}):</strong> Send the simultaneous WhatsApp confirmation to Admin and crew members below.
                </span>
              )}
            </div>
          </div>

          {/* Section 1: Admin Approval WhatsApp Dispatch */}
          <div className="border border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50/60">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">
                1. Send Approval Request to Admin ({adminContact.adminName})
              </div>
              <span className="text-xs font-mono text-slate-600">
                Total: {formatINR(totalAmount)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="wf-admin-phone" className="block text-xs font-medium text-slate-700 mb-1">
                  Admin WhatsApp Number
                </label>
                <input
                  id="wf-admin-phone"
                  type="text"
                  value={adminPhone}
                  onChange={(e) => setAdminPhone(e.target.value)}
                  placeholder="+91 9876543210"
                  className="w-full px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div className="flex items-end gap-2">
                <a
                  href={adminWaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="weekly-food-send-admin-wa-link"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 whitespace-nowrap"
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Send Admin WhatsApp</span>
                </a>
                {adminContact.adminEmail && (
                  <a
                    href={adminMailto}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 whitespace-nowrap"
                  >
                    <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Email</span>
                  </a>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-slate-600">
                  Admin WhatsApp Approval Message Preview
                </span>
                <button
                  type="button"
                  onClick={handleCopyAdminMsg}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-800 hover:underline"
                >
                  {copied ? (
                    <Check className="w-3 h-3" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3 h-3" aria-hidden="true" />
                  )}
                  <span>{copied ? 'Copied' : 'Copy Text'}</span>
                </button>
              </div>
              <pre className="p-3 bg-white border border-slate-200 rounded text-[11px] font-mono whitespace-pre-wrap leading-relaxed text-slate-800 max-h-40 overflow-y-auto">
                {adminMessage}
              </pre>
            </div>
          </div>

          {/* Section 2: Simultaneous Crew Member WhatsApp Alerts */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-800">
              <span>2. Crew WhatsApp Notifications ({payload.entries.length})</span>
              <span className="font-mono text-slate-500">1-Click Worker Alert</span>
            </div>
            <div className="divide-y divide-slate-100 max-h-52 overflow-y-auto">
              {payload.entries.map((entry) => {
                const emp = employees.find((e) => e.id === entry.employeeId);
                const workerPhone = entry.employeePhone || emp?.phone || '';
                const workerMsg = [
                  `*${companyName} — Weekly Food Allowance Update*`,
                  `Worker: ${entry.employeeName} (${entry.empCode})`,
                  `Date: ${entry.date} | Amount: ${formatINR(entry.amount)} [${entry.paymentMode.toUpperCase()}]`,
                  `Status: ${
                    entry.approvalStatus === 'pending_admin'
                      ? 'Submitted for Admin Approval'
                      : 'Approved & Recorded'
                  }`,
                ].join('\n');
                const workerWaUrl = buildWhatsappDirectUrl(workerPhone, workerMsg);
                const alreadyShared =
                  entry.whatsappShared || sharedWorkerIds.includes(entry.id);

                return (
                  <div
                    key={entry.id}
                    className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">
                        {entry.employeeName}{' '}
                        <span className="font-mono text-slate-500">({entry.empCode})</span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {formatINR(entry.amount)} · {entry.paymentMode.toUpperCase()}
                        {workerPhone ? ` · ${workerPhone}` : ''}
                      </div>
                    </div>
                    <a
                      href={workerWaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        setSharedWorkerIds((prev) =>
                          prev.includes(entry.id) ? prev : [...prev, entry.id]
                        );
                        void markAdvanceWhatsappShared(entry.id);
                      }}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded border whitespace-nowrap ${
                        alreadyShared
                          ? 'bg-slate-100 text-slate-700 border-slate-300'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                      }`}
                    >
                      <MessageSquare className="w-3 h-3" aria-hidden="true" />
                      <span>{alreadyShared ? 'Notified' : 'Send Worker WA'}</span>
                    </a>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
