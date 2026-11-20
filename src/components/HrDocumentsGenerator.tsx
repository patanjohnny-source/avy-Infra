import React, { useMemo, useState } from 'react';
import {
  BadgeCheck,
  Briefcase,
  CheckCircle2,
  Download,
  FileCheck2,
  FileDown,
  FilePenLine,
  FolderOpen,
  MessageSquare,
  Printer,
  ReceiptIndianRupee,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { getTodayIso } from '../data/seedData';
import type {
  AdvanceEntry,
  AttendanceRecord,
  CompanyDocument,
  CompanyDocumentApprovalStatus,
  CompanyDocumentFormat,
  CompanyProfile,
  Employee,
  Project,
  SettlementEntry,
  Tower,
  WhatsappMessagePayload,
} from '../types/avy';
import {
  buildAutoEmployeeDocument,
  buildLetterheadPdfBlob,
  buildWordDocumentBlob,
  formatHumanDate,
  maskAadhaarRef,
  type EmployeeLetterType,
} from '../utils/hrDocuments';
import { formatINR } from '../utils/payroll';
import { LetterheadPreviewSheet } from './LetterheadPreviewSheet';
import { PrintPreviewOverlay } from './PrintPreviewOverlay';
import type { WordEditorSeedDraft } from './WordLetterheadEditor';

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

export interface SaveCompanyDocInput {
  id?: string;
  source: CompanyDocument['source'];
  docCategory: CompanyDocument['docCategory'];
  fileFormat: CompanyDocumentFormat;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  approvalStatus?: CompanyDocumentApprovalStatus;
  approvedByName?: string;
  employeeId?: string;
  empCode?: string;
  employeeName?: string;
  refNumber?: string;
  issueDate: string;
  recipient?: string;
  subject?: string;
  bodyHtml?: string;
  plainTextSummary?: string;
  deckJson?: string;
  dataUrl?: string;
}

interface HrDocumentsGeneratorProps {
  company: CompanyProfile;
  employees: Employee[];
  projects: Project[];
  towers: Tower[];
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  settlements: SettlementEntry[];
  userDisplayName?: string;
  readOnly?: boolean;
  onCustomizeInWord: (draft: WordEditorSeedDraft) => void;
  onTriggerWhatsapp: (payload: WhatsappMessagePayload) => void;
  onSaveToDrive?: (input: SaveCompanyDocInput) => Promise<CompanyDocument>;
  onOpenDriveTab?: () => void;
}

const DOC_TYPES: Array<{
  id: EmployeeLetterType;
  label: string;
  shortDesc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'employment_proof',
    label: 'Employment Proof',
    shortDesc: 'Bonafide job & wage certificate',
    icon: FileCheck2,
  },
  {
    id: 'payslip',
    label: 'Salary Payslip',
    shortDesc: 'Monthly wages, OT & deductions',
    icon: ReceiptIndianRupee,
  },
  {
    id: 'joining_letter',
    label: 'Joining Letter',
    shortDesc: 'Appointment, rate & KYC terms',
    icon: Briefcase,
  },
  {
    id: 'relieving_letter',
    label: 'Relieving Letter',
    shortDesc: 'Tenure, clearance & experience',
    icon: BadgeCheck,
  },
  {
    id: 'travel_security_letter',
    label: 'Travel & Security',
    shortDesc: 'Transit, police & gate verification',
    icon: ShieldCheck,
  },
];

export function HrDocumentsGenerator({
  company,
  employees,
  projects,
  towers,
  attendance,
  advances,
  settlements,
  userDisplayName = 'Admin',
  readOnly = false,
  onCustomizeInWord,
  onTriggerWhatsapp,
  onSaveToDrive,
  onOpenDriveTab,
}: HrDocumentsGeneratorProps) {
  const today = getTodayIso();
  const [docType, setDocType] = useState<EmployeeLetterType>('employment_proof');
  const [selectedEmpId, setSelectedEmpId] = useState<string>(employees[0]?.id || '');
  const [issueDate, setIssueDate] = useState(today);
  const [monthKey, setMonthKey] = useState(today.slice(0, 7));

  // Relieving Letter optional controls
  const [relievingDate, setRelievingDate] = useState(today);
  const [conductRemark, setConductRemark] = useState(
    'sincere, disciplined, and skilled in floor/wall tiling and site execution standards'
  );

  // Travel & Security Verification controls
  const [travelRoute, setTravelRoute] = useState('');
  const [travelPurpose, setTravelPurpose] = useState(
    'Official Site Construction & Tiling Duty Transit / Security Verification'
  );
  const [travelValidFrom, setTravelValidFrom] = useState(today);
  const [travelValidTo, setTravelValidTo] = useState(() => {
    const dt = new Date(`${today}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + 15);
    return dt.toISOString().slice(0, 10);
  });

  const [showPrintOverlay, setShowPrintOverlay] = useState(false);
  const [savedDriveIds, setSavedDriveIds] = useState<Record<string, string>>({});
  const [driveStatusMsg, setDriveStatusMsg] = useState<string>('');
  const [savingDrive, setSavingDrive] = useState(false);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === selectedEmpId) || employees[0] || null,
    [employees, selectedEmpId]
  );

  const generatedDoc = useMemo(() => {
    if (!selectedEmployee) return null;
    return buildAutoEmployeeDocument({
      docType,
      employee: selectedEmployee,
      company,
      attendance,
      advances,
      settlements,
      projects,
      towers,
      issueDate,
      monthKey,
      relievingDate,
      conductRemark,
      travelRoute,
      travelPurpose,
      travelValidFrom,
      travelValidTo,
    });
  }, [
    selectedEmployee,
    docType,
    company,
    attendance,
    advances,
    settlements,
    projects,
    towers,
    issueDate,
    monthKey,
    relievingDate,
    conductRemark,
    travelRoute,
    travelPurpose,
    travelValidFrom,
    travelValidTo,
  ]);

  if (!selectedEmployee || !generatedDoc) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-600">
        No employees available in your scope. Add workers in <strong>Workforce &amp; IDs</strong> to auto-generate payslips and company letters.
      </div>
    );
  }

  const assignedProject = projects.find((p) => p.id === selectedEmployee.currentProjectId);
  const assignedTower = towers.find((t) => t.id === selectedEmployee.currentTowerId);
  const estMonthlyWage = Math.round((Number(selectedEmployee.dailyRate) || 0) * 26);

  const docInstanceKey = `${docType}:${selectedEmployee.id}:${issueDate}:${
    docType === 'payslip' ? monthKey : ''
  }`;

  const persistSmartDocToDrive = async (
    approvalStatus: CompanyDocumentApprovalStatus,
    format: CompanyDocumentFormat = 'doc',
    overrideFileName?: string,
    overrideSizeBytes?: number,
    overrideMime?: string
  ) => {
    if (!onSaveToDrive || readOnly) return null;
    setSavingDrive(true);
    try {
      const slug = (generatedDoc.subject || generatedDoc.refNumber || 'employee_doc')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 48);

      const fileName =
        overrideFileName || `${slug}.${format === 'pdf' ? 'pdf' : 'doc'}`;
      const mimeType =
        overrideMime ||
        (format === 'pdf' ? 'application/pdf' : 'application/msword;charset=utf-8');
      const sizeBytes =
        overrideSizeBytes ?? new Blob([generatedDoc.htmlBody]).size + 1200;

      const saved = await onSaveToDrive({
        id: savedDriveIds[docInstanceKey],
        source: 'smart_generator',
        docCategory: docType,
        fileFormat: format,
        title: `${generatedDoc.title} — ${selectedEmployee.fullName}`,
        fileName,
        mimeType,
        sizeBytes,
        approvalStatus,
        approvedByName: approvalStatus === 'approved' ? userDisplayName : undefined,
        employeeId: selectedEmployee.id,
        empCode: selectedEmployee.empCode,
        employeeName: selectedEmployee.fullName,
        refNumber: generatedDoc.refNumber,
        issueDate: generatedDoc.issueDate,
        recipient: generatedDoc.recipientBlock,
        subject: generatedDoc.subject,
        bodyHtml: generatedDoc.htmlBody,
        plainTextSummary: generatedDoc.plainTextLines.slice(0, 4).join(' '),
      });
      setSavedDriveIds((prev) => ({ ...prev, [docInstanceKey]: saved.id }));
      setDriveStatusMsg(
        approvalStatus === 'approved'
          ? `Approved & saved "${saved.title}" (${saved.refNumber}) to Documents Drive.`
          : `Auto-saved draft "${saved.title}" (${saved.refNumber}) to Documents Drive.`
      );
      return saved;
    } finally {
      setSavingDrive(false);
    }
  };

  const handleApproveAndSave = async () => {
    await persistSmartDocToDrive('approved', 'doc');
  };

  const handleApproveAndPrint = async () => {
    await persistSmartDocToDrive('approved', 'doc');
    setShowPrintOverlay(true);
  };

  const handleDownloadPdf = async () => {
    const { blob, fileName } = buildLetterheadPdfBlob({
      company,
      refNumber: generatedDoc.refNumber,
      issueDate: generatedDoc.issueDate,
      recipient: generatedDoc.recipientBlock,
      subject: generatedDoc.subject,
      plainTextLines: generatedDoc.plainTextLines,
      payslip: generatedDoc.payslip,
      travelMeta: generatedDoc.travelMeta,
      employee: selectedEmployee,
    });
    triggerDownloadBlob(blob, fileName);
    await persistSmartDocToDrive('approved', 'pdf', fileName, blob.size, 'application/pdf');
  };

  const handleDownloadWord = async () => {
    const { blob, fileName } = buildWordDocumentBlob({
      company,
      refNumber: generatedDoc.refNumber,
      issueDate: generatedDoc.issueDate,
      recipient: generatedDoc.recipientBlock,
      subject: generatedDoc.subject,
      bodyHtml: generatedDoc.htmlBody,
    });
    triggerDownloadBlob(blob, fileName);
    await persistSmartDocToDrive(
      'approved',
      'doc',
      fileName,
      blob.size,
      'application/msword;charset=utf-8'
    );
  };

  return (
    <div data-testid="hr-documents-generator" className="space-y-5">
      {/* Smart Generator 3-Step Intro Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Sparkles className="w-4 h-4 text-orange-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Smart Document Generator — Select Employee · Auto-Fill · Approve &amp; Save
            </h2>
            <p className="text-xs text-slate-500">
              Pick a worker and document type to auto-fill Name, Designation, Salary, Project, Joining Date &amp; KYC. Preview, approve, print, and auto-archive into Documents Drive.
            </p>
          </div>
        </div>
        {onOpenDriveTab && (
          <button
            type="button"
            onClick={onOpenDriveTab}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200"
          >
            <FolderOpen className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
            <span>Open Documents Drive</span>
          </button>
        )}
      </div>

      {/* 5-Way Document Type Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {DOC_TYPES.map((dt) => {
          const Icon = dt.icon;
          const active = docType === dt.id;
          return (
            <button
              key={dt.id}
              type="button"
              data-testid={`hr-doc-tab-${dt.id}`}
              onClick={() => setDocType(dt.id)}
              className={`text-left p-3.5 rounded-lg border transition-colors ${
                active
                  ? 'bg-orange-50 border-orange-600 text-slate-900'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-sm">
                <Icon
                  className={`w-4 h-4 shrink-0 ${active ? 'text-orange-700' : 'text-slate-500'}`}
                  aria-hidden="true"
                />
                <span>{dt.label}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">{dt.shortDesc}</p>
            </button>
          );
        })}
      </div>

      {driveStatusMsg && (
        <div
          role="status"
          data-testid="smart-drive-status"
          className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900"
        >
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>{driveStatusMsg}</span>
          </div>
          {onOpenDriveTab && (
            <button
              type="button"
              onClick={onOpenDriveTab}
              className="px-2.5 py-1 text-[11px] font-semibold text-emerald-900 bg-white border border-emerald-300 rounded hover:bg-emerald-100"
            >
              View in Drive
            </button>
          )}
        </div>
      )}

      {/* Config + Action Split */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left: Auto-Fill Controls */}
        <div className="xl:col-span-4 bg-white border border-slate-200 rounded-lg p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">1. Select Employee &amp; Parameters</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Automatically pulls wage rates, attendance, advances, Aadhaar ref &amp; site tower on company letterhead.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label htmlFor="hr-emp-select" className="block font-medium text-slate-700 mb-1">
                Select Worker / Employee ({employees.length})
              </label>
              <select
                id="hr-emp-select"
                data-testid="hr-employee-select"
                value={selectedEmployee.id}
                onChange={(e) => setSelectedEmpId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.empCode} — {emp.fullName} ({emp.role})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="hr-issue-date" className="block font-medium text-slate-700 mb-1">
                  Letter Date
                </label>
                <input
                  id="hr-issue-date"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-md"
                />
              </div>

              {docType === 'payslip' && (
                <div>
                  <label htmlFor="hr-payslip-month" className="block font-medium text-slate-700 mb-1">
                    Payslip Month
                  </label>
                  <input
                    id="hr-payslip-month"
                    type="month"
                    value={monthKey}
                    onChange={(e) => setMonthKey(e.target.value)}
                    className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-md"
                  />
                </div>
              )}

              {docType === 'relieving_letter' && (
                <div>
                  <label htmlFor="hr-relieving-date" className="block font-medium text-slate-700 mb-1">
                    Last Working Day
                  </label>
                  <input
                    id="hr-relieving-date"
                    type="date"
                    value={relievingDate}
                    onChange={(e) => setRelievingDate(e.target.value)}
                    className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-md"
                  />
                </div>
              )}
            </div>

            {docType === 'relieving_letter' && (
              <div>
                <label htmlFor="hr-conduct-remark" className="block font-medium text-slate-700 mb-1">
                  Work &amp; Conduct Remark
                </label>
                <textarea
                  id="hr-conduct-remark"
                  rows={2}
                  value={conductRemark}
                  onChange={(e) => setConductRemark(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md"
                />
              </div>
            )}

            {docType === 'travel_security_letter' && (
              <div className="space-y-2.5 pt-2 border-t border-slate-100">
                <div>
                  <label htmlFor="hr-travel-route" className="block font-medium text-slate-700 mb-1">
                    Travel Route / Destination (optional custom override)
                  </label>
                  <input
                    id="hr-travel-route"
                    type="text"
                    value={travelRoute}
                    onChange={(e) => setTravelRoute(e.target.value)}
                    placeholder={`Home Residence <-> ${selectedEmployee.currentProjectName || 'Site'}`}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="hr-travel-purpose" className="block font-medium text-slate-700 mb-1">
                    Travel / Security Purpose
                  </label>
                  <input
                    id="hr-travel-purpose"
                    type="text"
                    value={travelPurpose}
                    onChange={(e) => setTravelPurpose(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="hr-valid-from" className="block font-medium text-slate-700 mb-1">
                      Valid From
                    </label>
                    <input
                      id="hr-valid-from"
                      type="date"
                      value={travelValidFrom}
                      onChange={(e) => setTravelValidFrom(e.target.value)}
                      className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label htmlFor="hr-valid-to" className="block font-medium text-slate-700 mb-1">
                      Valid Until
                    </label>
                    <input
                      id="hr-valid-to"
                      type="date"
                      value={travelValidTo}
                      onChange={(e) => setTravelValidTo(e.target.value)}
                      className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-md"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Approve, Print, Auto-Save & Share Actions */}
          <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2">
            {!readOnly && onSaveToDrive && (
              <button
                type="button"
                data-testid="smart-approve-save-btn"
                disabled={savingDrive}
                onClick={handleApproveAndSave}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{savingDrive ? 'Saving to Drive...' : 'Approve & Save to Drive'}</span>
              </button>
            )}

            <button
              type="button"
              data-testid="hr-print-a4-btn"
              onClick={handleApproveAndPrint}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Approve &amp; Print A4 Letterhead</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="hr-download-pdf-btn"
                onClick={handleDownloadPdf}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                data-testid="hr-download-word-btn"
                onClick={handleDownloadWord}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100"
              >
                <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Word (.doc)</span>
              </button>
            </div>

            <button
              type="button"
              data-testid="hr-customize-word-btn"
              onClick={() =>
                onCustomizeInWord({
                  nonce: Date.now(),
                  driveDocId: savedDriveIds[docInstanceKey],
                  employeeId: selectedEmployee.id,
                  empCode: selectedEmployee.empCode,
                  employeeName: selectedEmployee.fullName,
                  docCategory: docType,
                  refNumber: generatedDoc.refNumber,
                  issueDate: generatedDoc.issueDate,
                  recipient: generatedDoc.recipientBlock,
                  subject: generatedDoc.subject,
                  bodyHtml: generatedDoc.htmlBody,
                })
              }
              className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200"
            >
              <FilePenLine className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Customize in Word Editor</span>
            </button>

            <button
              type="button"
              onClick={() =>
                onTriggerWhatsapp({
                  title: generatedDoc.title,
                  recipientName: selectedEmployee.fullName,
                  recipientPhone: selectedEmployee.phone,
                  recipientEmail: selectedEmployee.email,
                  emailSubject: generatedDoc.subject,
                  message: generatedDoc.whatsappMessage,
                })
              }
              className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100"
            >
              <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Share Summary on WhatsApp</span>
            </button>
          </div>
        </div>

        {/* Right: Auto-Filled Verification Strip + Live A4 Official Company Letterhead */}
        <div className="xl:col-span-8 space-y-3">
          <div
            data-testid="smart-autofill-strip"
            className="bg-white border border-slate-200 rounded-lg p-3.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs"
          >
            <div>
              <div className="text-[11px] text-slate-500">Employee</div>
              <div className="font-semibold text-slate-900 truncate">{selectedEmployee.fullName}</div>
              <div className="text-[11px] font-mono text-slate-500">{selectedEmployee.empCode}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Designation</div>
              <div className="font-semibold text-slate-900 truncate">{selectedEmployee.role}</div>
              <div className="text-[11px] text-slate-500 capitalize">{selectedEmployee.status}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Wage / Est. Salary</div>
              <div className="font-mono font-semibold text-slate-900 tabular-nums">
                {formatINR(selectedEmployee.dailyRate)}/d
              </div>
              <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                ~{formatINR(estMonthlyWage)}/mo
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Project &amp; Tower</div>
              <div className="font-semibold text-slate-900 truncate">
                {selectedEmployee.currentProjectName || assignedProject?.name || 'Company Pool'}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {selectedEmployee.currentTowerName || assignedTower?.name || 'All Towers'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Joining Date</div>
              <div className="font-mono font-semibold text-slate-900">
                {formatHumanDate(selectedEmployee.joiningDate)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Aadhaar KYC</div>
              <div className="font-mono font-semibold text-slate-900">
                {maskAadhaarRef(selectedEmployee.aadharRef)}
              </div>
            </div>
          </div>

          <div className="bg-slate-100 border border-slate-200 rounded-lg p-4 sm:p-6 overflow-x-auto">
            <LetterheadPreviewSheet
              company={company}
              refNumber={generatedDoc.refNumber}
              issueDate={generatedDoc.issueDate}
              recipient={generatedDoc.recipientBlock}
              subject={generatedDoc.subject}
              bodyHtml={generatedDoc.htmlBody}
              employee={selectedEmployee}
              payslip={generatedDoc.payslip}
              travelMeta={generatedDoc.travelMeta}
            />
          </div>
        </div>
      </div>

      {/* Isolated A4 Print Preview */}
      <PrintPreviewOverlay
        open={showPrintOverlay}
        mode="report_a4"
        title={`${generatedDoc.title} — ${selectedEmployee.empCode} ${selectedEmployee.fullName}`}
        subtitle={`Ref: ${generatedDoc.refNumber}`}
        onClose={() => setShowPrintOverlay(false)}
        onDownloadPdf={handleDownloadPdf}
        renderPrintContent={() => (
          <LetterheadPreviewSheet
            company={company}
            refNumber={generatedDoc.refNumber}
            issueDate={generatedDoc.issueDate}
            recipient={generatedDoc.recipientBlock}
            subject={generatedDoc.subject}
            bodyHtml={generatedDoc.htmlBody}
            employee={selectedEmployee}
            payslip={generatedDoc.payslip}
            travelMeta={generatedDoc.travelMeta}
          />
        )}
      />
    </div>
  );
}

