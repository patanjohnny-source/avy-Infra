import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileDown,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  HardDriveUpload,
  Presentation,
  Printer,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { getTodayIso } from '../data/seedData';
import type {
  CompanyDocument,
  CompanyDocumentApprovalStatus,
  CompanyDocumentCategory,
  CompanyProfile,
  Employee,
} from '../types/avy';
import {
  ACCEPTED_DRIVE_EXTENSIONS,
  DRIVE_CATEGORY_LABELS,
  DRIVE_FORMAT_LABELS,
  type DriveCategoryGroupFilter,
  filterCompanyDocuments,
  formatFileSizeBytes,
  readCompanyUploadFile,
} from '../utils/documentDrive';
import {
  SLIDE_THEMES,
  buildLetterheadPdfBlob,
  buildPowerPointDocBlob,
  buildPresentationDeckPdfBlob,
  buildWordDocumentBlob,
  formatHumanDate,
  stripHtmlToLines,
  type PresentationDeck,
} from '../utils/hrDocuments';
import { LetterheadPreviewSheet } from './LetterheadPreviewSheet';
import { PrintPreviewOverlay } from './PrintPreviewOverlay';

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

function triggerDataUrlDownload(dataUrl: string, fileName: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export type OfficeStudioTarget = 'hr_letters' | 'word_letterhead' | 'slides_ppt';

interface DocumentsDriveViewProps {
  company: CompanyProfile;
  documents: CompanyDocument[];
  employees: Employee[];
  userDisplayName: string;
  readOnly?: boolean;
  onSaveUploadedDoc: (input: {
    source: 'uploaded';
    docCategory: CompanyDocumentCategory;
    fileFormat: CompanyDocument['fileFormat'];
    title: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    approvalStatus: CompanyDocumentApprovalStatus;
    approvedByName?: string;
    employeeId?: string;
    empCode?: string;
    employeeName?: string;
    issueDate: string;
    dataUrl: string;
    plainTextSummary?: string;
  }) => Promise<CompanyDocument>;
  onApproveDoc: (docId: string, approvedByName?: string) => Promise<void>;
  onDeleteDoc: (docId: string) => Promise<void>;
  onOpenInWord: (doc: CompanyDocument) => void;
  onOpenInPpt: (doc: CompanyDocument, deck: PresentationDeck) => void;
  onJumpToStudio: (tab: OfficeStudioTarget) => void;
}

export function DocumentsDriveView({
  company,
  documents,
  employees,
  userDisplayName,
  readOnly = false,
  onSaveUploadedDoc,
  onApproveDoc,
  onDeleteDoc,
  onOpenInWord,
  onOpenInPpt,
  onJumpToStudio,
}: DocumentsDriveViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [categoryGroup, setCategoryGroup] = useState<DriveCategoryGroupFilter>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | CompanyDocumentApprovalStatus>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Upload options
  const [uploadEmployeeId, setUploadEmployeeId] = useState<string>('');
  const [uploadApprovalStatus, setUploadApprovalStatus] =
    useState<CompanyDocumentApprovalStatus>('approved');
  const [uploading, setUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Preview, Print & 2-click Delete confirmation
  const [previewDoc, setPreviewDoc] = useState<CompanyDocument | null>(null);
  const [printDoc, setPrintDoc] = useState<CompanyDocument | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const scopedEmployeeIds = useMemo(
    () => new Set(employees.map((e) => e.id)),
    [employees]
  );

  const filteredDocs = useMemo(
    () =>
      filterCompanyDocuments(documents, {
        categoryGroup,
        statusFilter,
        employeeIdFilter: employeeFilter,
        searchQuery,
        scopedEmployeeIds,
      }),
    [documents, categoryGroup, statusFilter, employeeFilter, searchQuery, scopedEmployeeIds]
  );

  const stats = useMemo(() => {
    const visible = filterCompanyDocuments(documents, { scopedEmployeeIds });
    return {
      total: visible.length,
      approved: visible.filter((d) => d.approvalStatus === 'approved').length,
      drafts: visible.filter((d) => d.approvalStatus === 'draft').length,
      uploadedOrOffice: visible.filter(
        (d) =>
          d.source === 'uploaded' ||
          d.fileFormat === 'doc' ||
          d.fileFormat === 'docx' ||
          d.fileFormat === 'ppt' ||
          d.fileFormat === 'pptx'
      ).length,
    };
  }, [documents, scopedEmployeeIds]);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploading(true);
    setUploadFeedback(null);
    try {
      const parsed = await readCompanyUploadFile(file);
      const emp = employees.find((item) => item.id === uploadEmployeeId);
      const saved = await onSaveUploadedDoc({
        source: 'uploaded',
        docCategory: 'uploaded_office',
        fileFormat: parsed.fileFormat,
        title: parsed.title,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        sizeBytes: parsed.sizeBytes,
        approvalStatus: uploadApprovalStatus,
        approvedByName: uploadApprovalStatus === 'approved' ? userDisplayName : undefined,
        employeeId: emp?.id,
        empCode: emp?.empCode,
        employeeName: emp?.fullName,
        issueDate: getTodayIso(),
        dataUrl: parsed.dataUrl,
        plainTextSummary: `Uploaded ${DRIVE_FORMAT_LABELS[parsed.fileFormat]} file (${parsed.fileName})`,
      });
      setUploadFeedback({
        type: 'success',
        text: `Saved "${saved.fileName}" (${formatFileSizeBytes(saved.sizeBytes)}) to Documents Drive.`,
      });
    } catch (err) {
      setUploadFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to upload file to Drive.',
      });
    } finally {
      setUploading(false);
    }
  };

  const parseDeckFromDoc = (doc: CompanyDocument): PresentationDeck | null => {
    if (!doc.deckJson) return null;
    try {
      const parsed = JSON.parse(doc.deckJson) as PresentationDeck;
      if (parsed && Array.isArray(parsed.slides) && parsed.slides.length > 0) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  };

  const handleDownloadDocFile = (doc: CompanyDocument, formatOverride?: 'doc' | 'pdf' | 'ppt') => {
    if (doc.source === 'uploaded' && doc.dataUrl && !formatOverride) {
      triggerDataUrlDownload(doc.dataUrl, doc.fileName || `${doc.title}.${doc.fileFormat}`);
      return;
    }

    if (doc.docCategory === 'presentation_deck' || doc.source === 'ppt_slides') {
      const deck = parseDeckFromDoc(doc);
      if (deck) {
        if (formatOverride === 'pdf') {
          const { blob, fileName } = buildPresentationDeckPdfBlob({ deck, company });
          triggerDownloadBlob(blob, fileName);
        } else {
          const { blob, fileName } = buildPowerPointDocBlob({ deck, company });
          triggerDownloadBlob(blob, fileName);
        }
        return;
      }
    }

    if (doc.bodyHtml) {
      if (formatOverride === 'pdf') {
        const linkedEmp = employees.find((e) => e.id === doc.employeeId);
        const { blob, fileName } = buildLetterheadPdfBlob({
          company,
          refNumber: doc.refNumber || doc.id,
          issueDate: doc.issueDate,
          recipient: doc.recipient || '',
          subject: doc.subject || doc.title,
          plainTextLines: stripHtmlToLines(doc.bodyHtml),
          employee: linkedEmp,
        });
        triggerDownloadBlob(blob, fileName);
      } else {
        const { blob, fileName } = buildWordDocumentBlob({
          company,
          refNumber: doc.refNumber || doc.id,
          issueDate: doc.issueDate,
          recipient: doc.recipient || '',
          subject: doc.subject || doc.title,
          bodyHtml: doc.bodyHtml,
        });
        triggerDownloadBlob(blob, fileName);
      }
      return;
    }

    if (doc.dataUrl) {
      triggerDataUrlDownload(doc.dataUrl, doc.fileName || doc.title);
    }
  };

  const renderFormatIcon = (doc: CompanyDocument) => {
    if (doc.fileFormat === 'ppt' || doc.fileFormat === 'pptx' || doc.source === 'ppt_slides') {
      return <Presentation className="w-4 h-4 text-orange-700 shrink-0" aria-hidden="true" />;
    }
    if (doc.fileFormat === 'doc' || doc.fileFormat === 'docx') {
      return <FileText className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />;
    }
    if (doc.fileFormat === 'pdf') {
      return <FileSpreadsheet className="w-4 h-4 text-rose-700 shrink-0" aria-hidden="true" />;
    }
    return <FolderOpen className="w-4 h-4 text-slate-600 shrink-0" aria-hidden="true" />;
  };

  return (
    <div data-testid="documents-drive-view" className="space-y-5">
      {/* Top Upload & Quick-Create Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <HardDriveUpload className="w-4 h-4 text-orange-700" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-slate-900">
                Company Documents Drive (Word, PowerPoint, PDF &amp; HR Letters)
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              All letters from the Smart Document Generator, MS Word Letterhead Studio, and PowerPoint Slides are automatically archived here. You can also upload .doc, .docx, .ppt, .pptx, .pdf, or scanned images (max 450 KB).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onJumpToStudio('hr_letters')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Smart Generator</span>
            </button>
            <button
              type="button"
              onClick={() => onJumpToStudio('word_letterhead')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200"
            >
              <FilePenLine className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New Word Letter</span>
            </button>
            <button
              type="button"
              onClick={() => onJumpToStudio('slides_ppt')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200"
            >
              <Presentation className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New PPT Deck</span>
            </button>
          </div>
        </div>

        {!readOnly && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md flex flex-wrap items-end gap-3 text-xs">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="drive-upload-emp" className="block font-medium text-slate-700 mb-1">
                Link Upload to Worker (optional)
              </label>
              <select
                id="drive-upload-emp"
                value={uploadEmployeeId}
                onChange={(e) => setUploadEmployeeId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md"
              >
                <option value="">Company-Wide Document (No specific worker)</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.empCode} — {emp.fullName} ({emp.role})
                  </option>
                ))}
              </select>
            </div>

            <div className="w-48">
              <label htmlFor="drive-upload-status" className="block font-medium text-slate-700 mb-1">
                Initial Status
              </label>
              <select
                id="drive-upload-status"
                value={uploadApprovalStatus}
                onChange={(e) =>
                  setUploadApprovalStatus(e.target.value as CompanyDocumentApprovalStatus)
                }
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md"
              >
                <option value="approved">Save as Approved</option>
                <option value="draft">Save as Draft</option>
              </select>
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                data-testid="drive-file-upload-input"
                accept={ACCEPTED_DRIVE_EXTENSIONS.join(',')}
                onChange={handleFileSelected}
                className="hidden"
                aria-label="Upload Word, PowerPoint, PDF or image file to Documents Drive"
              />
              <button
                type="button"
                data-testid="drive-upload-trigger-btn"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{uploading ? 'Uploading...' : 'Upload Word / PPT / PDF'}</span>
              </button>
            </div>
          </div>
        )}

        {uploadFeedback && (
          <div
            role="status"
            data-testid="drive-upload-feedback"
            className={`px-3 py-2 text-xs font-medium rounded border ${
              uploadFeedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                : 'bg-red-50 text-red-900 border-red-200'
            }`}
          >
            {uploadFeedback.text}
          </div>
        )}
      </div>

      {/* KPI Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">Total Stored Documents</div>
          <div className="text-2xl font-display font-bold text-slate-900 tabular-nums mt-0.5">
            {stats.total}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Approved &amp; Ready</div>
          <div className="text-2xl font-display font-bold text-emerald-700 tabular-nums mt-0.5">
            {stats.approved}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Drafts Pending Approval</div>
          <div className="text-2xl font-display font-bold text-amber-700 tabular-nums mt-0.5">
            {stats.drafts}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Word / PPT / Uploaded Files</div>
          <div className="text-2xl font-display font-bold text-blue-700 tabular-nums mt-0.5">
            {stats.uploadedOrOffice}
          </div>
        </div>
      </div>

      {/* Filter Toolbar + Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label htmlFor="drive-search" className="block font-medium text-slate-700 mb-1">
              Search Drive
            </label>
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                id="drive-search"
                data-testid="drive-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Title, Ref No, employee, filename..."
                className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <div>
            <label htmlFor="drive-cat-filter" className="block font-medium text-slate-700 mb-1">
              Document Source / Group
            </label>
            <select
              id="drive-cat-filter"
              data-testid="drive-category-filter"
              value={categoryGroup}
              onChange={(e) => setCategoryGroup(e.target.value as DriveCategoryGroupFilter)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md"
            >
              <option value="all">All Stored Documents</option>
              <option value="smart_employee">Smart Employee Letters &amp; Payslips</option>
              <option value="word_letterhead">MS Word Letterheads</option>
              <option value="ppt_slides">PowerPoint Slide Decks</option>
              <option value="uploaded">Uploaded External Files</option>
            </select>
          </div>

          <div>
            <label htmlFor="drive-status-filter" className="block font-medium text-slate-700 mb-1">
              Approval Status
            </label>
            <select
              id="drive-status-filter"
              data-testid="drive-status-filter"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'all' | CompanyDocumentApprovalStatus)
              }
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md"
            >
              <option value="all">All Statuses</option>
              <option value="approved">Approved</option>
              <option value="draft">Draft</option>
            </select>
          </div>

          <div>
            <label htmlFor="drive-emp-filter" className="block font-medium text-slate-700 mb-1">
              Filter by Worker
            </label>
            <select
              id="drive-emp-filter"
              data-testid="drive-employee-filter"
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md"
            >
              <option value="all">All Workers &amp; Company Docs</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} — {emp.fullName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredDocs.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No matching documents in Documents Drive. Generate an employee document in{' '}
            <strong>Smart Generator</strong>, compose a <strong>Word Letterhead</strong> /{' '}
            <strong>PowerPoint Deck</strong>, or upload an Office/PDF file above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase text-[11px]">
                  <th className="py-3 px-4 font-semibold">Document &amp; Ref</th>
                  <th className="py-3 px-3 font-semibold">Type &amp; Format</th>
                  <th className="py-3 px-3 font-semibold">Linked Worker</th>
                  <th className="py-3 px-3 font-semibold">Date &amp; Size</th>
                  <th className="py-3 px-3 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredDocs.map((doc) => {
                  const isDeck =
                    doc.docCategory === 'presentation_deck' || doc.source === 'ppt_slides';
                  const parsedDeck = isDeck ? parseDeckFromDoc(doc) : null;
                  const canEditInWord = Boolean(doc.bodyHtml) && !isDeck;
                  const isConfirmingDelete = confirmDeleteId === doc.id;

                  return (
                    <tr
                      key={doc.id}
                      data-testid={`drive-doc-row-${doc.id}`}
                      className="hover:bg-slate-50/80"
                    >
                      <td className="py-3 px-4 max-w-[300px]">
                        <div className="flex items-start gap-2.5">
                          {renderFormatIcon(doc)}
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">
                              {doc.title}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 truncate">
                              {doc.refNumber || doc.fileName}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-medium text-slate-800">
                          {DRIVE_CATEGORY_LABELS[doc.docCategory] || doc.docCategory}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {DRIVE_FORMAT_LABELS[doc.fileFormat] || doc.fileFormat.toUpperCase()}
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        {doc.employeeName ? (
                          <div>
                            <div className="font-medium text-slate-900">{doc.employeeName}</div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {doc.empCode || '-'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">Company-Wide</span>
                        )}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap tabular-nums">
                        <div className="font-mono text-slate-800">
                          {formatHumanDate(doc.issueDate)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {formatFileSizeBytes(doc.sizeBytes)}
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        {doc.approvalStatus === 'approved' ? (
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded">
                            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                            <span>Approved</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded">
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            <span>Draft</span>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewDoc(doc)}
                            aria-label={`Preview ${doc.title}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100"
                          >
                            <Eye className="w-3 h-3" aria-hidden="true" />
                            <span>Preview</span>
                          </button>

                          {!readOnly && doc.approvalStatus === 'draft' && (
                            <button
                              type="button"
                              onClick={() => {
                                void onApproveDoc(doc.id, userDisplayName);
                              }}
                              aria-label={`Approve ${doc.title}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                            >
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>Approve</span>
                            </button>
                          )}

                          {canEditInWord && (
                            <button
                              type="button"
                              onClick={() => onOpenInWord(doc)}
                              aria-label={`Edit ${doc.title} in Word Studio`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100"
                            >
                              <FilePenLine className="w-3 h-3" aria-hidden="true" />
                              <span>Edit in Word</span>
                            </button>
                          )}

                          {parsedDeck && (
                            <button
                              type="button"
                              onClick={() => onOpenInPpt(doc, parsedDeck)}
                              aria-label={`Edit ${doc.title} in PowerPoint Studio`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                            >
                              <Presentation className="w-3 h-3" aria-hidden="true" />
                              <span>Edit PPT</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDownloadDocFile(doc)}
                            aria-label={`Download ${doc.title}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                          >
                            <Download className="w-3 h-3" aria-hidden="true" />
                            <span>Download</span>
                          </button>

                          {!readOnly && (
                            isConfirmingDelete ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void onDeleteDoc(doc.id);
                                    setConfirmDeleteId(null);
                                  }}
                                  aria-label={`Confirm delete ${doc.title}`}
                                  className="px-2 py-1 text-[11px] font-semibold text-white bg-red-600 rounded hover:bg-red-700"
                                >
                                  Confirm?
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-1.5 py-1 text-[11px] text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-100"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(doc.id)}
                                aria-label={`Delete ${doc.title}`}
                                className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drive Document Preview Dialog */}
      {previewDoc && (
        <div
          className="fixed inset-0 z-[75] bg-slate-950/75 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${previewDoc.title}`}
        >
          <div className="bg-white border border-slate-200 rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 truncate">{previewDoc.title}</h3>
                <p className="text-xs text-slate-500 font-mono truncate">
                  {previewDoc.refNumber || previewDoc.fileName} · {formatHumanDate(previewDoc.issueDate)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {previewDoc.bodyHtml && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const target = previewDoc;
                        setPreviewDoc(null);
                        setPrintDoc(target);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded hover:bg-orange-800"
                    >
                      <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Print A4</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadDocFile(previewDoc, 'doc')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100"
                    >
                      <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Word (.doc)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadDocFile(previewDoc, 'pdf')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>PDF</span>
                    </button>
                  </>
                )}

                {parseDeckFromDoc(previewDoc) && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDownloadDocFile(previewDoc, 'ppt')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                    >
                      <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>PowerPoint (.ppt)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadDocFile(previewDoc, 'pdf')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>16:9 PDF</span>
                    </button>
                  </>
                )}

                {previewDoc.source === 'uploaded' && (
                  <button
                    type="button"
                    onClick={() => handleDownloadDocFile(previewDoc)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Download File</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  aria-label="Close preview modal"
                  className="p-1.5 text-slate-500 hover:text-slate-900 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-5 bg-slate-100">
              {previewDoc.bodyHtml ? (
                <LetterheadPreviewSheet
                  company={company}
                  refNumber={previewDoc.refNumber || previewDoc.id}
                  issueDate={previewDoc.issueDate}
                  recipient={previewDoc.recipient || ''}
                  subject={previewDoc.subject || previewDoc.title}
                  bodyHtml={previewDoc.bodyHtml}
                  employee={employees.find((e) => e.id === previewDoc.employeeId)}
                />
              ) : (() => {
                const deck = parseDeckFromDoc(previewDoc);
                if (deck) {
                  const theme = SLIDE_THEMES[deck.theme] || SLIDE_THEMES.executive_slate;
                  return (
                    <div className="space-y-4 max-w-3xl mx-auto">
                      {deck.slides.map((slide, idx) => (
                        <div
                          key={slide.id}
                          className="no-dark-invert rounded-lg border p-6 space-y-3"
                          style={{
                            backgroundColor: theme.bgHex,
                            color: theme.textHex,
                            borderColor: theme.borderHex,
                          }}
                        >
                          <div className="flex items-center justify-between text-xs pb-2 border-b" style={{ borderColor: theme.borderHex }}>
                            <span className="font-bold uppercase" style={{ color: theme.accentHex }}>
                              {company.companyName || 'AVY INFRA'}
                            </span>
                            <span className="font-mono" style={{ color: theme.mutedHex }}>
                              Slide {idx + 1} / {deck.slides.length}
                            </span>
                          </div>
                          <h4 className="font-display text-lg font-bold">{slide.title}</h4>
                          {slide.subtitle && (
                            <p className="text-xs" style={{ color: theme.mutedHex }}>
                              {slide.subtitle}
                            </p>
                          )}
                          <ul className="list-disc pl-5 text-xs space-y-1">
                            {slide.bullets.filter(Boolean).map((b, bIdx) => (
                              <li key={bIdx}>{b}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  );
                }

                if (previewDoc.dataUrl && previewDoc.mimeType.startsWith('image/')) {
                  return (
                    <div className="flex justify-center">
                      <img
                        src={previewDoc.dataUrl}
                        alt={previewDoc.title}
                        className="max-w-full max-h-[70vh] rounded border border-slate-300 bg-white"
                      />
                    </div>
                  );
                }

                if (previewDoc.dataUrl && previewDoc.fileFormat === 'pdf') {
                  return (
                    <iframe
                      title={previewDoc.title}
                      src={previewDoc.dataUrl}
                      className="w-full h-[68vh] rounded border border-slate-300 bg-white"
                    />
                  );
                }

                return (
                  <div className="bg-white border border-slate-200 rounded-lg p-8 max-w-lg mx-auto text-center space-y-3">
                    <div className="flex justify-center">{renderFormatIcon(previewDoc)}</div>
                    <h4 className="text-sm font-semibold text-slate-900">{previewDoc.fileName}</h4>
                    <p className="text-xs text-slate-600">
                      {DRIVE_FORMAT_LABELS[previewDoc.fileFormat]} ·{' '}
                      {formatFileSizeBytes(previewDoc.sizeBytes)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Click <strong>Download File</strong> above to open this document in Microsoft Word or PowerPoint.
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* A4 Print Overlay for Letterhead Docs opened from Drive */}
      <PrintPreviewOverlay
        open={Boolean(printDoc && printDoc.bodyHtml)}
        mode="report_a4"
        title={printDoc ? printDoc.title : 'Document'}
        subtitle={printDoc?.refNumber || ''}
        onClose={() => setPrintDoc(null)}
        onDownloadPdf={() => {
          if (printDoc) handleDownloadDocFile(printDoc, 'pdf');
        }}
        renderPrintContent={() =>
          printDoc ? (
            <LetterheadPreviewSheet
              company={company}
              refNumber={printDoc.refNumber || printDoc.id}
              issueDate={printDoc.issueDate}
              recipient={printDoc.recipient || ''}
              subject={printDoc.subject || printDoc.title}
              bodyHtml={printDoc.bodyHtml || ''}
              employee={employees.find((e) => e.id === printDoc.employeeId)}
            />
          ) : null
        }
      />
    </div>
  );
}
