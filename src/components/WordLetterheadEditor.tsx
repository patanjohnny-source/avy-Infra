import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CheckCircle2,
  Download,
  FileDown,
  FileText,
  FolderOpen,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Printer,
  RotateCcw,
  Save,
  Table,
  Trash2,
  Underline,
} from 'lucide-react';
import { getTodayIso } from '../data/seedData';
import type {
  CompanyDocument,
  CompanyDocumentApprovalStatus,
  CompanyDocumentCategory,
  CompanyDocumentFormat,
  CompanyProfile,
} from '../types/avy';
import {
  WORD_LETTERHEAD_TEMPLATES,
  buildLetterheadPdfBlob,
  buildOfficialDocumentRefNo,
  buildWordDocumentBlob,
  sanitizeRichHtml,
  stripHtmlToLines,
} from '../utils/hrDocuments';
import type { SaveCompanyDocInput } from './HrDocumentsGenerator';
import { LetterheadPreviewSheet } from './LetterheadPreviewSheet';
import { PrintPreviewOverlay } from './PrintPreviewOverlay';

export interface WordEditorSeedDraft {
  nonce: number;
  driveDocId?: string;
  employeeId?: string;
  empCode?: string;
  employeeName?: string;
  docCategory?: CompanyDocumentCategory;
  refNumber: string;
  issueDate: string;
  recipient: string;
  subject: string;
  bodyHtml: string;
}

interface SavedWordDraft {
  id: string;
  title: string;
  refNumber: string;
  issueDate: string;
  recipient: string;
  subject: string;
  bodyHtml: string;
  fontClass: string;
  updatedAt: string;
}

const STORAGE_KEY = 'avy_word_letterhead_drafts_v1';

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

interface WordLetterheadEditorProps {
  company: CompanyProfile;
  seedDraft?: WordEditorSeedDraft | null;
  userDisplayName?: string;
  readOnly?: boolean;
  onSaveToDrive?: (input: SaveCompanyDocInput) => Promise<CompanyDocument>;
  onOpenDriveTab?: () => void;
}

export function WordLetterheadEditor({
  company,
  seedDraft,
  userDisplayName = 'Admin',
  readOnly = false,
  onSaveToDrive,
  onOpenDriveTab,
}: WordLetterheadEditorProps) {
  const today = getTodayIso();
  const initialTpl = WORD_LETTERHEAD_TEMPLATES[0];

  const [refNumber, setRefNumber] = useState(() =>
    buildOfficialDocumentRefNo('custom', 'NOTICE', today)
  );
  const [issueDate, setIssueDate] = useState(today);
  const [recipient, setRecipient] = useState(initialTpl.recipient);
  const [subject, setSubject] = useState(initialTpl.subject);
  const [bodyHtml, setBodyHtml] = useState(initialTpl.htmlBody);
  const [fontClass, setFontClass] = useState<'font-sans' | 'font-serif' | 'font-mono'>('font-sans');
  const [showSeal, setShowSeal] = useState(true);
  const [showPrintOverlay, setShowPrintOverlay] = useState(false);
  const [statusNotice, setStatusNotice] = useState('');
  const [activeDriveDocId, setActiveDriveDocId] = useState<string | undefined>(undefined);
  const [linkedMeta, setLinkedMeta] = useState<{
    employeeId?: string;
    empCode?: string;
    employeeName?: string;
    docCategory?: CompanyDocumentCategory;
  }>({});

  const [savedDrafts, setSavedDrafts] = useState<SavedWordDraft[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SavedWordDraft[]) : [];
    } catch {
      return [];
    }
  });

  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== bodyHtml) {
      editorRef.current.innerHTML = sanitizeRichHtml(bodyHtml);
    }
  }, [bodyHtml]);

  useEffect(() => {
    if (!seedDraft) return;
    setRefNumber(seedDraft.refNumber);
    setIssueDate(seedDraft.issueDate);
    setRecipient(seedDraft.recipient);
    setSubject(seedDraft.subject);
    setActiveDriveDocId(seedDraft.driveDocId);
    setLinkedMeta({
      employeeId: seedDraft.employeeId,
      empCode: seedDraft.empCode,
      employeeName: seedDraft.employeeName,
      docCategory: seedDraft.docCategory,
    });
    const cleaned = sanitizeRichHtml(seedDraft.bodyHtml);
    setBodyHtml(cleaned);
    if (editorRef.current) {
      editorRef.current.innerHTML = cleaned;
    }
    setStatusNotice(`Loaded "${seedDraft.subject}" into MS Word Letterhead Editor.`);
  }, [seedDraft]);

  const persistDrafts = (next: SavedWordDraft[]) => {
    setSavedDrafts(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota issues cleanly
    }
  };

  const applyFormatCommand = (command: string, value?: string) => {
    editorRef.current?.focus();
    try {
      document.execCommand(command, false, value);
      if (editorRef.current) {
        setBodyHtml(sanitizeRichHtml(editorRef.current.innerHTML));
      }
    } catch {
      // Fallback safely if browser blocks execCommand
    }
  };

  const insertSampleTable = () => {
    const tableMarkup = `<p></p><table><thead><tr><th>Sr.</th><th>Particulars / Description</th><th>Remarks</th></tr></thead><tbody><tr><td>1</td><td>Item / Personnel Details</td><td>Verified</td></tr><tr><td>2</td><td>Tower / Floor Assignment</td><td>Active</td></tr></tbody></table><p></p>`;
    applyFormatCommand('insertHTML', tableMarkup);
  };

  const handleLoadTemplate = (tplId: string) => {
    const tpl = WORD_LETTERHEAD_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    setActiveDriveDocId(undefined);
    setLinkedMeta({});
    setRefNumber(buildOfficialDocumentRefNo('custom', tpl.id.slice(0, 6).toUpperCase(), issueDate));
    setRecipient(tpl.recipient);
    setSubject(tpl.subject);
    setBodyHtml(tpl.htmlBody);
    if (editorRef.current) editorRef.current.innerHTML = tpl.htmlBody;
    setStatusNotice(`Loaded "${tpl.label}" template on company letterhead.`);
  };

  const getCurrentSanitizedBody = () =>
    editorRef.current ? sanitizeRichHtml(editorRef.current.innerHTML) : bodyHtml;

  const syncWordDocToDrive = async (
    approvalStatus: CompanyDocumentApprovalStatus,
    format: CompanyDocumentFormat = 'doc',
    overrideFileName?: string,
    overrideSizeBytes?: number,
    overrideMime?: string
  ) => {
    if (!onSaveToDrive || readOnly) return null;
    const currentBody = getCurrentSanitizedBody();
    const slug = (subject || refNumber || 'avy_letterhead')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
    const fileName = overrideFileName || `${slug}.${format === 'pdf' ? 'pdf' : 'doc'}`;
    const mimeType =
      overrideMime ||
      (format === 'pdf' ? 'application/pdf' : 'application/msword;charset=utf-8');
    const sizeBytes = overrideSizeBytes ?? new Blob([currentBody]).size + 1200;

    const saved = await onSaveToDrive({
      id: activeDriveDocId,
      source: 'word_letterhead',
      docCategory: linkedMeta.docCategory || 'letterhead_doc',
      fileFormat: format,
      title: subject.trim() || refNumber || 'Word Letterhead Document',
      fileName,
      mimeType,
      sizeBytes,
      approvalStatus,
      approvedByName: approvalStatus === 'approved' ? userDisplayName : undefined,
      employeeId: linkedMeta.employeeId,
      empCode: linkedMeta.empCode,
      employeeName: linkedMeta.employeeName,
      refNumber,
      issueDate,
      recipient,
      subject,
      bodyHtml: currentBody,
      plainTextSummary: stripHtmlToLines(currentBody).slice(0, 4).join(' '),
    });
    setActiveDriveDocId(saved.id);
    return saved;
  };

  const handleSaveDraft = async () => {
    const currentBody = getCurrentSanitizedBody();
    const draft: SavedWordDraft = {
      id: `draft_${Date.now()}`,
      title: subject.trim() || refNumber,
      refNumber,
      issueDate,
      recipient,
      subject,
      bodyHtml: currentBody,
      fontClass,
      updatedAt: new Date().toISOString(),
    };
    persistDrafts([draft, ...savedDrafts].slice(0, 20));
    await syncWordDocToDrive('draft', 'doc');
    setStatusNotice(`Saved draft "${draft.title}" locally & to Documents Drive.`);
  };

  const handleApproveAndSave = async () => {
    const saved = await syncWordDocToDrive('approved', 'doc');
    if (saved) {
      setStatusNotice(`Approved & archived "${saved.title}" (${saved.refNumber}) in Documents Drive.`);
    }
  };

  const handleDownloadWord = async () => {
    const currentBody = getCurrentSanitizedBody();
    const { blob, fileName } = buildWordDocumentBlob({
      company,
      refNumber,
      issueDate,
      recipient,
      subject,
      bodyHtml: currentBody,
    });
    triggerDownloadBlob(blob, fileName);
    await syncWordDocToDrive(
      'approved',
      'doc',
      fileName,
      blob.size,
      'application/msword;charset=utf-8'
    );
    setStatusNotice(`Downloaded MS Word (${fileName}) & auto-saved to Documents Drive.`);
  };

  const handleDownloadPdf = async () => {
    const currentBody = getCurrentSanitizedBody();
    const { blob, fileName } = buildLetterheadPdfBlob({
      company,
      refNumber,
      issueDate,
      recipient,
      subject,
      plainTextLines: stripHtmlToLines(currentBody),
    });
    triggerDownloadBlob(blob, fileName);
    await syncWordDocToDrive('approved', 'pdf', fileName, blob.size, 'application/pdf');
    setStatusNotice(`Downloaded A4 Letterhead PDF (${fileName}) & auto-saved to Documents Drive.`);
  };

  const handlePrintA4 = async () => {
    await syncWordDocToDrive('approved', 'doc');
    setShowPrintOverlay(true);
  };

  return (
    <div data-testid="word-letterhead-editor" className="space-y-5">
      {/* MS Word Ribbon & Export Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="word-template-select" className="text-xs font-semibold text-slate-700">
              Template:
            </label>
            <select
              id="word-template-select"
              onChange={(e) => {
                if (e.target.value) handleLoadTemplate(e.target.value);
              }}
              defaultValue="general_notice"
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              {WORD_LETTERHEAD_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>

            <label htmlFor="word-font-select" className="text-xs font-semibold text-slate-700 ml-2">
              Font:
            </label>
            <select
              id="word-font-select"
              value={fontClass}
              onChange={(e) =>
                setFontClass(e.target.value as 'font-sans' | 'font-serif' | 'font-mono')
              }
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              <option value="font-sans">Sans-Serif (Calibri / Clean)</option>
              <option value="font-serif">Classic Serif (Formal Legal)</option>
              <option value="font-mono">Monospace (Technical)</option>
            </select>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 ml-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showSeal}
                onChange={(e) => setShowSeal(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Company Seal</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSaveDraft}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200"
            >
              <Save className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Save Draft</span>
            </button>
            {!readOnly && onSaveToDrive && (
              <button
                type="button"
                data-testid="word-approve-save-btn"
                onClick={handleApproveAndSave}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800"
              >
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Approve &amp; Save to Drive</span>
              </button>
            )}
            <button
              type="button"
              data-testid="word-download-doc-btn"
              onClick={handleDownloadWord}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100"
            >
              <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download Word (.doc)</span>
            </button>
            <button
              type="button"
              data-testid="word-download-pdf-btn"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export PDF</span>
            </button>
            <button
              type="button"
              data-testid="word-print-a4-btn"
              onClick={handlePrintA4}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Print Letterhead (A4)</span>
            </button>
          </div>
        </div>

        {/* Formatting Ribbon */}
        <div
          className="flex flex-wrap items-center gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-md"
          role="toolbar"
          aria-label="Word formatting controls"
        >
          <button
            type="button"
            onClick={() => applyFormatCommand('bold')}
            aria-label="Bold"
            className="p-1.5 text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatCommand('italic')}
            aria-label="Italic"
            className="p-1.5 text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatCommand('underline')}
            aria-label="Underline"
            className="p-1.5 text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
          >
            <Underline className="w-3.5 h-3.5" />
          </button>
          <span className="h-5 w-px bg-slate-300 mx-1" aria-hidden="true" />
          <button
            type="button"
            onClick={() => applyFormatCommand('formatBlock', '<h2>')}
            aria-label="Section Heading"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
          >
            <Heading2 className="w-3.5 h-3.5" />
            <span>Heading</span>
          </button>
          <button
            type="button"
            onClick={() => applyFormatCommand('insertUnorderedList')}
            aria-label="Bullet List"
            className="p-1.5 text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatCommand('insertOrderedList')}
            aria-label="Numbered List"
            className="p-1.5 text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </button>
          <span className="h-5 w-px bg-slate-300 mx-1" aria-hidden="true" />
          <button
            type="button"
            onClick={() => applyFormatCommand('justifyLeft')}
            aria-label="Align Left"
            className="p-1.5 text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatCommand('justifyCenter')}
            aria-label="Align Center"
            className="p-1.5 text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatCommand('justifyRight')}
            aria-label="Align Right"
            className="p-1.5 text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
          >
            <AlignRight className="w-3.5 h-3.5" />
          </button>
          <span className="h-5 w-px bg-slate-300 mx-1" aria-hidden="true" />
          <button
            type="button"
            onClick={insertSampleTable}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
          >
            <Table className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Insert Table</span>
          </button>
          <button
            type="button"
            onClick={() => applyFormatCommand('removeFormat')}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Clear Format</span>
          </button>
        </div>

        {statusNotice && (
          <div className="px-3 py-2 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded flex flex-wrap items-center justify-between gap-2">
            <span>{statusNotice}</span>
            {onOpenDriveTab && (
              <button
                type="button"
                onClick={onOpenDriveTab}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-white border border-emerald-300 rounded hover:bg-emerald-100"
              >
                <FolderOpen className="w-3 h-3" aria-hidden="true" />
                <span>View in Drive</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Workspace: Left Letterhead Metadata + Saved Drafts, Right Live Editable Paper */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-4 space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Letterhead Header Fields</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3 text-xs">
              <div>
                <label htmlFor="word-ref" className="block font-medium text-slate-700 mb-1">
                  Reference Number
                </label>
                <input
                  id="word-ref"
                  type="text"
                  value={refNumber}
                  onChange={(e) => setRefNumber(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="word-date" className="block font-medium text-slate-700 mb-1">
                  Issue Date
                </label>
                <input
                  id="word-date"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="word-recipient" className="block font-medium text-slate-700 mb-1">
                  Recipient / To Block
                </label>
                <textarea
                  id="word-recipient"
                  rows={3}
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="To, Project Security / Worker / Client..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="word-subject" className="block font-medium text-slate-700 mb-1">
                  Subject Line
                </label>
                <input
                  id="word-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md"
                />
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Editable Letter Body (Rich Text)
              </h3>
              <span className="text-[11px] text-slate-500">Live syncs to A4 paper</span>
            </div>
            <div
              ref={editorRef}
              data-testid="word-rich-editor-area"
              contentEditable
              suppressContentEditableWarning
              onInput={(e) => setBodyHtml(sanitizeRichHtml(e.currentTarget.innerHTML))}
              className="min-h-[240px] max-h-[380px] overflow-y-auto p-3 text-xs leading-relaxed border border-slate-300 rounded-md focus:outline-none focus:border-orange-600 bg-white text-slate-900 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1"
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
                Saved Letterhead Drafts ({savedDrafts.length})
              </h3>
            </div>
            {savedDrafts.length === 0 ? (
              <p className="text-xs text-slate-500">
                No saved drafts yet. Click <strong>Save Draft</strong> to store reusable site letters.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {savedDrafts.map((d) => (
                  <div
                    key={d.id}
                    className="p-2 border border-slate-200 rounded flex items-center justify-between gap-2 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setRefNumber(d.refNumber);
                        setIssueDate(d.issueDate);
                        setRecipient(d.recipient);
                        setSubject(d.subject);
                        setBodyHtml(d.bodyHtml);
                        if (editorRef.current) editorRef.current.innerHTML = d.bodyHtml;
                        setStatusNotice(`Opened draft "${d.title}".`);
                      }}
                      className="text-left min-w-0 flex-1 hover:text-orange-700"
                    >
                      <div className="font-medium text-slate-900 truncate flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{d.title}</span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-500">
                        {d.refNumber} · {d.issueDate}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete draft ${d.title}`}
                      onClick={() => persistDrafts(savedDrafts.filter((x) => x.id !== d.id))}
                      className="p-1 text-slate-400 hover:text-red-600 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Live A4 Official Letterhead Preview */}
        <div className="xl:col-span-8 bg-slate-100 border border-slate-200 rounded-lg p-4 sm:p-6 overflow-x-auto">
          <LetterheadPreviewSheet
            company={company}
            refNumber={refNumber}
            issueDate={issueDate}
            recipient={recipient}
            subject={subject}
            bodyHtml={bodyHtml}
            fontClass={fontClass}
            showCompanySeal={showSeal}
          />
        </div>
      </div>

      {/* Isolated A4 Print Preview */}
      <PrintPreviewOverlay
        open={showPrintOverlay}
        mode="report_a4"
        title={`${company.companyName} — Official Company Letterhead`}
        subtitle={`${refNumber} · ${subject}`}
        onClose={() => setShowPrintOverlay(false)}
        onDownloadPdf={handleDownloadPdf}
        renderPrintContent={() => (
          <LetterheadPreviewSheet
            company={company}
            refNumber={refNumber}
            issueDate={issueDate}
            recipient={recipient}
            subject={subject}
            bodyHtml={bodyHtml}
            fontClass={fontClass}
            showCompanySeal={showSeal}
          />
        )}
      />
    </div>
  );
}
