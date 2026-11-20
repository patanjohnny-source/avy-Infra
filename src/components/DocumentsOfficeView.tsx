import React, { useMemo, useState } from 'react';
import { FilePenLine, FileText, FolderOpen, Presentation, Sparkles } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { WhatsappMessagePayload } from '../types/avy';
import {
  getScopedAdvances,
  getScopedAttendance,
  getScopedEmployees,
  getScopedExpenses,
  getScopedFlats,
  getScopedProjects,
  getScopedTowers,
} from '../utils/authAccess';
import { filterCompanyDocuments } from '../utils/documentDrive';
import { DocumentsDriveView } from './DocumentsDriveView';
import { HrDocumentsGenerator } from './HrDocumentsGenerator';
import { PresentationDeckBuilder, type PptSeedDeckPayload } from './PresentationDeckBuilder';
import { WordLetterheadEditor, type WordEditorSeedDraft } from './WordLetterheadEditor';

type OfficeTab = 'hr_letters' | 'word_letterhead' | 'slides_ppt' | 'drive';

interface DocumentsOfficeViewProps {
  onTriggerWhatsapp: (payload: WhatsappMessagePayload) => void;
}

export function DocumentsOfficeView({ onTriggerWhatsapp }: DocumentsOfficeViewProps) {
  const {
    session,
    companyProfile,
    projects: rawProjects,
    towers: rawTowers,
    flats: rawFlats,
    employees: rawEmployees,
    attendance: rawAttendance,
    advances: rawAdvances,
    expenses: rawExpenses,
    settlements,
    companyDocuments,
    saveCompanyDocument,
    approveCompanyDocument,
    deleteCompanyDocument,
  } = useStore();

  const [activeTab, setActiveTab] = useState<OfficeTab>('hr_letters');
  const [wordSeedDraft, setWordSeedDraft] = useState<WordEditorSeedDraft | null>(null);
  const [pptSeedDeck, setPptSeedDeck] = useState<PptSeedDeckPayload | null>(null);

  const projects = useMemo(
    () => getScopedProjects(session, rawProjects, rawTowers),
    [session, rawProjects, rawTowers]
  );
  const towers = useMemo(() => getScopedTowers(session, rawTowers), [session, rawTowers]);
  const flats = useMemo(() => getScopedFlats(session, rawFlats), [session, rawFlats]);
  const employees = useMemo(
    () => getScopedEmployees(session, rawEmployees),
    [session, rawEmployees]
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

  const scopedDocs = useMemo(() => {
    const scopedEmployeeIds = new Set(employees.map((e) => e.id));
    return filterCompanyDocuments(companyDocuments || [], { scopedEmployeeIds });
  }, [companyDocuments, employees]);

  const userDisplayName = session?.displayName || companyProfile.signatoryName || 'Admin';
  const readOnly = session?.role === 'employee';

  const tabs: Array<{
    id: OfficeTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'hr_letters', label: 'Smart Document Generator', icon: Sparkles },
    { id: 'word_letterhead', label: 'MS Word Letterhead Studio', icon: FilePenLine },
    { id: 'slides_ppt', label: 'PowerPoint Slides (PPT)', icon: Presentation },
    { id: 'drive', label: `Documents Drive (${scopedDocs.length})`, icon: FolderOpen },
  ];

  return (
    <div data-testid="documents-office-view" className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-orange-700" aria-hidden="true" />
            <h1 className="font-display text-xl font-bold text-slate-900">
              Smart Document Generator, Office Suite &amp; Documents Drive
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            Auto-fill employee proofs, salary slips, joining, relieving &amp; security letters on letterhead, compose Word &amp; PowerPoint presentations, and retrieve or upload all files in Documents Drive.
          </p>
        </div>

        <div
          className="inline-flex flex-wrap gap-1.5 p-1 bg-slate-100 border border-slate-200 rounded-lg"
          role="tablist"
          aria-label="Office document studios"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`office-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-orange-700 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-white hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'hr_letters' && (
        <HrDocumentsGenerator
          company={companyProfile}
          employees={employees}
          projects={projects}
          towers={towers}
          attendance={attendance}
          advances={advances}
          settlements={settlements}
          userDisplayName={userDisplayName}
          readOnly={readOnly}
          onSaveToDrive={saveCompanyDocument}
          onOpenDriveTab={() => setActiveTab('drive')}
          onCustomizeInWord={(draft) => {
            setWordSeedDraft(draft);
            setActiveTab('word_letterhead');
          }}
          onTriggerWhatsapp={onTriggerWhatsapp}
        />
      )}

      {activeTab === 'word_letterhead' && (
        <WordLetterheadEditor
          company={companyProfile}
          seedDraft={wordSeedDraft}
          userDisplayName={userDisplayName}
          readOnly={readOnly}
          onSaveToDrive={saveCompanyDocument}
          onOpenDriveTab={() => setActiveTab('drive')}
        />
      )}

      {activeTab === 'slides_ppt' && (
        <PresentationDeckBuilder
          company={companyProfile}
          projects={projects}
          towers={towers}
          flats={flats}
          employees={employees}
          attendance={attendance}
          expenses={expenses}
          seedDeck={pptSeedDeck}
          userDisplayName={userDisplayName}
          readOnly={readOnly}
          onSaveToDrive={saveCompanyDocument}
          onOpenDriveTab={() => setActiveTab('drive')}
        />
      )}

      {activeTab === 'drive' && (
        <DocumentsDriveView
          company={companyProfile}
          documents={scopedDocs}
          employees={employees}
          userDisplayName={userDisplayName}
          readOnly={readOnly}
          onSaveUploadedDoc={saveCompanyDocument}
          onApproveDoc={approveCompanyDocument}
          onDeleteDoc={deleteCompanyDocument}
          onJumpToStudio={(tab) => setActiveTab(tab)}
          onOpenInWord={(doc) => {
            setWordSeedDraft({
              nonce: Date.now(),
              driveDocId: doc.id,
              employeeId: doc.employeeId,
              empCode: doc.empCode,
              employeeName: doc.employeeName,
              docCategory: doc.docCategory,
              refNumber: doc.refNumber || doc.id,
              issueDate: doc.issueDate,
              recipient: doc.recipient || '',
              subject: doc.subject || doc.title,
              bodyHtml: doc.bodyHtml || '',
            });
            setActiveTab('word_letterhead');
          }}
          onOpenInPpt={(doc, deck) => {
            setPptSeedDeck({
              nonce: Date.now(),
              driveDocId: doc.id,
              deck,
            });
            setActiveTab('slides_ppt');
          }}
        />
      )}
    </div>
  );
}

