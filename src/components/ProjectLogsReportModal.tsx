import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  ScrollText,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import {
  getScopedAdvances,
  getScopedAssignments,
  getScopedAttendance,
  getScopedEmployees,
  getScopedExpenses,
  getScopedProjects,
  getScopedTowers,
} from '../utils/authAccess';
import {
  buildProjectLogsSummaryPdfBlob,
  triggerBlobDownload,
} from '../utils/idCardPdf';
import {
  ALL_PROJECT_LOG_CATEGORIES,
  PROJECT_LOG_CATEGORY_LABELS,
  type ProjectLogCategory,
  buildProjectLogsReportCsv,
  buildProjectLogsSummaryReport,
} from '../utils/projectLogsReport';

interface ProjectLogsReportModalProps {
  isOpen: boolean;
  initialProjectId?: string;
  onClose: () => void;
}

export function ProjectLogsReportModal({
  isOpen,
  initialProjectId,
  onClose,
}: ProjectLogsReportModalProps) {
  const {
    session,
    companyProfile,
    projects: rawProjects,
    towers: rawTowers,
    employees: rawEmployees,
    dailySiteLogs,
    assignments: rawAssignments,
    attendance: rawAttendance,
    advances: rawAdvances,
    expenses: rawExpenses,
    deployments: rawDeployments,
  } = useStore();

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
  const expenses = useMemo(() => getScopedExpenses(session, rawExpenses), [session, rawExpenses]);
  const deployments = useMemo(() => {
    const allowedEmpIds = new Set(employees.map((e) => e.id));
    return rawDeployments.filter((d) => allowedEmpIds.has(d.employeeId));
  }, [rawDeployments, employees]);

  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    initialProjectId || projects[0]?.id || ''
  );
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<ProjectLogCategory[]>(
    ALL_PROJECT_LOG_CATEGORIES
  );
  const [fetchNonce, setFetchNonce] = useState(1);
  const [statusFeedback, setStatusFeedback] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (initialProjectId && projects.some((p) => p.id === initialProjectId)) {
      setSelectedProjectId(initialProjectId);
    } else if (!projects.some((p) => p.id === selectedProjectId) && projects[0]) {
      setSelectedProjectId(projects[0].id);
    }
    setStatusFeedback('');
  }, [isOpen, initialProjectId, projects, selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || projects[0] || null,
    [projects, selectedProjectId]
  );

  const report = useMemo(() => {
    if (!selectedProject) return null;
    void fetchNonce;
    return buildProjectLogsSummaryReport({
      project: selectedProject,
      towers,
      dailySiteLogs,
      assignments,
      attendance,
      advances,
      expenses,
      deployments,
      fromDate,
      toDate,
      categories: selectedCategories,
    });
  }, [
    selectedProject,
    towers,
    dailySiteLogs,
    assignments,
    attendance,
    advances,
    expenses,
    deployments,
    fromDate,
    toDate,
    selectedCategories,
    fetchNonce,
  ]);

  if (!isOpen) return null;

  const toggleCategory = (cat: ProjectLogCategory) => {
    setSelectedCategories((prev) => {
      if (prev.includes(cat)) {
        return prev.length > 1 ? prev.filter((c) => c !== cat) : prev;
      }
      return [...prev, cat];
    });
  };

  const handleFetchLogs = () => {
    setFetchNonce((n) => n + 1);
    if (report) {
      setStatusFeedback(
        `Fetched ${report.totalEntries} log entries for ${report.project.name}.`
      );
    }
  };

  const handleDownloadCsv = () => {
    if (!report) return;
    const csv = buildProjectLogsReportCsv(report);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const safeName = report.project.name.replace(/[^a-zA-Z0-9]+/g, '_');
    const fileName = `${safeName}_Project_Logs_Summary.csv`;
    triggerBlobDownload(blob, fileName);
    setStatusFeedback(`Downloaded CSV report (${fileName}).`);
  };

  const handleDownloadPdf = () => {
    if (!report) return;
    const { blob, fileName } = buildProjectLogsSummaryPdfBlob({
      company: companyProfile,
      report,
    });
    triggerBlobDownload(blob, fileName);
    setStatusFeedback(`Downloaded PDF report (${fileName}).`);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-logs-report-title"
      data-testid="project-logs-report-modal"
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ScrollText className="w-5 h-5 text-orange-700 shrink-0" aria-hidden="true" />
              <h2
                id="project-logs-report-title"
                className="text-base font-semibold text-slate-900 truncate"
              >
                Project Logs Summary Report
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Aggregate daily site notes, work allotment logs, attendance muster, advances, site expenses, and crew deployments into CSV or PDF.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close project logs report modal"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter Controls */}
        <div className="px-5 py-4 border-b border-slate-200 space-y-3 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-5">
              <label
                htmlFor="proj-report-project"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Selected Project
              </label>
              <select
                id="proj-report-project"
                data-testid="project-logs-project-select"
                value={selectedProject?.id || ''}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  setStatusFeedback('');
                }}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              >
                {projects.length === 0 ? (
                  <option value="">No projects available</option>
                ) : (
                  projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.location})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="proj-report-from"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                From Date
              </label>
              <input
                id="proj-report-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="proj-report-to"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                To Date
              </label>
              <input
                id="proj-report-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md"
              />
            </div>

            <div className="sm:col-span-3 flex items-center gap-2">
              <button
                type="button"
                data-testid="fetch-project-logs-btn"
                onClick={handleFetchLogs}
                disabled={!selectedProject}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Fetch Logs</span>
              </button>
              {(fromDate || toDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setFromDate('');
                    setToDate('');
                  }}
                  className="px-2.5 py-2 text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 whitespace-nowrap"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Category Filter Toggles */}
          <div className="flex flex-wrap items-center gap-1.5">
            {ALL_PROJECT_LOG_CATEGORIES.map((cat) => {
              const active = selectedCategories.includes(cat);
              const count = report ? report.countsByCategory[cat] : 0;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-orange-50 text-orange-900 border-orange-300'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {PROJECT_LOG_CATEGORY_LABELS[cat]}{' '}
                  <span className="font-mono tabular-nums">({count})</span>
                </button>
              );
            })}
          </div>

          {statusFeedback && (
            <div
              role="status"
              className="px-3 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md flex items-center gap-2"
            >
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{statusFeedback}</span>
            </div>
          )}
        </div>

        {/* Summary KPI Strip & Log Table */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {report ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-[11px] text-slate-500">Total Logs Fetched</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    {report.totalEntries}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-[11px] text-slate-500">Daily Site Journal</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    {report.countsByCategory.site_log}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-[11px] text-slate-500">Work Area Logged</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    {Math.round(report.totalWorkSqftLogged).toLocaleString('en-IN')} Sq.Ft
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-[11px] text-slate-500">Wages Recorded</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    ₹{Math.round(report.totalWagesLogged).toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="text-[11px] text-orange-800">Advances + Expenses</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-orange-900 mt-0.5">
                    ₹
                    {Math.round(
                      report.totalAdvanceAmount + report.totalSiteExpenseAmount
                    ).toLocaleString('en-IN')}
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                        <th className="py-2.5 px-3 whitespace-nowrap">Date</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">Category</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">Tower</th>
                        <th className="py-2.5 px-3">Subject &amp; Details</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">Worker / By</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Metric / Amount</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.entries.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-10 text-center text-slate-500">
                            No logs found for {report.project.name} in the selected filter range.
                          </td>
                        </tr>
                      ) : (
                        report.entries.map((entry) => (
                          <tr key={entry.id} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                              {entry.date}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-orange-800 whitespace-nowrap">
                              {entry.categoryLabel}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                              {entry.towerName}
                            </td>
                            <td className="py-2.5 px-3 min-w-[220px]">
                              <div className="font-semibold text-slate-900">{entry.subject}</div>
                              <div className="text-[11px] text-slate-500 line-clamp-2">
                                {entry.details}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                              {entry.actor}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                              {entry.metricOrAmount}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-600 whitespace-nowrap">
                              {entry.statusLabel}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-sm text-slate-500">
              Select a project to inspect and export its logs.
            </div>
          )}
        </div>

        {/* Footer Export Actions */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            {report
              ? `${report.project.name} · ${report.totalEntries} log entries ready`
              : 'No project selected'}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100"
            >
              Close
            </button>
            <button
              type="button"
              data-testid="project-logs-download-csv-btn"
              onClick={handleDownloadCsv}
              disabled={!report || report.totalEntries === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              <span>Download CSV</span>
            </button>
            <button
              type="button"
              data-testid="project-logs-download-pdf-btn"
              onClick={handleDownloadPdf}
              disabled={!report}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download PDF</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
