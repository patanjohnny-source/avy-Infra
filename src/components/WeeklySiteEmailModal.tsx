import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Mail,
  MessageSquare,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import { getWeeklyWindowForDate } from '../utils/operations';
import { formatINR } from '../utils/payroll';
import { buildWhatsappDirectUrl } from '../utils/weeklyFoodApproval';
import { buildWeeklySitePerformanceReport } from '../utils/weeklySiteEmail';

interface WeeklySiteEmailModalProps {
  isOpen: boolean;
  initialProjectId?: string;
  onClose: () => void;
}

export function WeeklySiteEmailModal({
  isOpen,
  initialProjectId,
  onClose,
}: WeeklySiteEmailModalProps) {
  const {
    companyProfile,
    projects,
    towers,
    flats,
    dailySiteLogs,
    attendance,
    advances,
    expenses,
  } = useStore();

  const today = getTodayIso();
  const defaultWeek = useMemo(() => getWeeklyWindowForDate(today), [today]);

  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    initialProjectId || projects[0]?.id || ''
  );
  const [weekStart, setWeekStart] = useState<string>(defaultWeek.start);
  const [weekEnd, setWeekEnd] = useState<string>(defaultWeek.end);
  const [recipientEmail, setRecipientEmail] = useState<string>(
    companyProfile?.hrEmail || ''
  );
  const [customSubject, setCustomSubject] = useState<string>('');
  const [customBody, setCustomBody] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedProjectId((prev) => initialProjectId || prev || projects[0]?.id || '');
    setWeekStart(defaultWeek.start);
    setWeekEnd(defaultWeek.end);
    setRecipientEmail(companyProfile?.hrEmail || '');
    setCopied(false);
  }, [isOpen, initialProjectId, projects, defaultWeek, companyProfile?.hrEmail]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || projects[0] || null,
    [projects, selectedProjectId]
  );

  const report = useMemo(() => {
    if (!selectedProject) return null;
    return buildWeeklySitePerformanceReport({
      project: selectedProject,
      towers,
      flats,
      dailySiteLogs,
      attendance,
      advances,
      expenses,
      companyProfile,
      weekStart,
      weekEnd,
      recipientEmail,
      tileZoneCatalog: companyProfile?.tileZoneCatalog,
    });
  }, [
    selectedProject,
    towers,
    flats,
    dailySiteLogs,
    attendance,
    advances,
    expenses,
    companyProfile,
    weekStart,
    weekEnd,
    recipientEmail,
  ]);

  useEffect(() => {
    if (!report) return;
    setCustomSubject(report.subject);
    setCustomBody(report.body);
  }, [report?.subject, report?.body]);

  if (!isOpen) return null;

  const effectiveSubject = customSubject || report?.subject || '';
  const effectiveBody = customBody || report?.body || '';
  const mailtoHref = `mailto:${encodeURIComponent(recipientEmail.trim())}?subject=${encodeURIComponent(
    effectiveSubject
  )}&body=${encodeURIComponent(effectiveBody)}`;
  const waHref = buildWhatsappDirectUrl(
    companyProfile?.hrContact || '',
    report?.whatsappMessage || effectiveBody
  );

  const handleCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(`${effectiveSubject}\n\n${effectiveBody}`);
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
      aria-labelledby="weekly-site-email-title"
      data-testid="weekly-site-email-modal"
    >
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Mail className="w-5 h-5 text-orange-700 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2
                id="weekly-site-email-title"
                className="text-base font-semibold text-slate-900 truncate"
              >
                Weekly Site Performance &amp; Expense Summary Email
              </h2>
              <p className="text-xs text-slate-500">
                Aggregates live Daily Site Logs, Attendance Wages, Food Advances, Expenses &amp; Tile Completion % per project.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close weekly site email modal"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {!selectedProject || !report ? (
            <div className="p-6 text-center text-sm text-slate-500 border border-slate-200 rounded-md">
              Add at least one project to generate a weekly performance &amp; expense email summary.
            </div>
          ) : (
            <>
              {/* Controls Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="wse-project" className="block text-xs font-medium text-slate-700 mb-1">
                    Project Site
                  </label>
                  <select
                    id="wse-project"
                    value={selectedProject.id}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
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
                  <label htmlFor="wse-start" className="block text-xs font-medium text-slate-700 mb-1">
                    Week Start
                  </label>
                  <input
                    id="wse-start"
                    type="date"
                    value={weekStart}
                    onChange={(e) => setWeekStart(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="wse-end" className="block text-xs font-medium text-slate-700 mb-1">
                    Week End
                  </label>
                  <input
                    id="wse-end"
                    type="date"
                    value={weekEnd}
                    onChange={(e) => setWeekEnd(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              {/* Aggregated Live Data Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                  <div className="text-[11px] text-slate-500">Site Completion</div>
                  <div className="mt-1 text-lg font-mono font-bold tabular-nums text-slate-900">
                    {report.metrics.completionPct}%
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {report.metrics.completedZones}/{report.metrics.totalZones} zones
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                  <div className="text-[11px] text-slate-500">Daily Site Logs</div>
                  <div className="mt-1 text-lg font-mono font-bold tabular-nums text-slate-900">
                    {report.metrics.siteLogCount}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {report.metrics.presentDaysCount}P · {report.metrics.halfDaysCount}HD att
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                  <div className="text-[11px] text-slate-500">Wages + Advances</div>
                  <div className="mt-1 text-lg font-mono font-bold tabular-nums text-slate-900">
                    {formatINR(
                      report.metrics.wagesEarned +
                        report.metrics.overtimeEarned +
                        report.metrics.totalAdvances
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    Food: {formatINR(report.metrics.foodAdvancesTotal)}
                  </div>
                </div>
                <div className="p-3 bg-orange-50/70 border border-orange-200 rounded-md">
                  <div className="text-[11px] text-orange-800 font-medium">Total Weekly Cost</div>
                  <div className="mt-1 text-lg font-mono font-bold tabular-nums text-orange-950">
                    {formatINR(report.metrics.totalWeeklyCost)}
                  </div>
                  <div className="text-[11px] text-orange-800 font-mono">
                    Site Exp: {formatINR(report.metrics.siteExpensesTotal)}
                  </div>
                </div>
              </div>

              {/* Email Recipient & Subject */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="wse-recipient" className="block text-xs font-medium text-slate-700 mb-1">
                    Recipient Email Address
                  </label>
                  <input
                    id="wse-recipient"
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="client-or-director@company.com"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="wse-subject" className="block text-xs font-medium text-slate-700 mb-1">
                    Email Subject
                  </label>
                  <input
                    id="wse-subject"
                    type="text"
                    value={effectiveSubject}
                    onChange={(e) => setCustomSubject(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              {/* Editable Email Body */}
              <div>
                <label htmlFor="wse-body" className="block text-xs font-medium text-slate-700 mb-1">
                  Weekly Summary Content (Pulled from Daily Site Logs &amp; Payroll)
                </label>
                <textarea
                  id="wse-body"
                  rows={10}
                  value={effectiveBody}
                  onChange={(e) => setCustomBody(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono leading-relaxed bg-slate-50 border border-slate-300 rounded-md"
                />
              </div>

              {/* Dispatch Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleCopyReport}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{copied ? 'Copied Full Report' : 'Copy Email Text'}</span>
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-md hover:bg-emerald-100 whitespace-nowrap"
                  >
                    <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Send via WhatsApp</span>
                  </a>
                  <a
                    href={mailtoHref}
                    data-testid="weekly-site-email-mailto-link"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap"
                  >
                    <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Open Email Draft (Send)</span>
                  </a>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
