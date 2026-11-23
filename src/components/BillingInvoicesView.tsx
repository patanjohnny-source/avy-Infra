import React, { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FileText,
  ImagePlus,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Printer,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import type {
  BillingDocStatus,
  BillingDocType,
  BillingDocument,
  BillingTaxMode,
  WhatsappMessagePayload,
} from '../types/avy';
import {
  getScopedProjects,
  getScopedTowers,
  isAdminSession,
  isSupervisorSession,
} from '../utils/authAccess';
import {
  BILLING_DOC_TYPE_LABELS,
  BILLING_STATUS_LABELS,
  DEFAULT_BILLING_TERMS,
  computeBillingTotals,
  formatAmountInWordsINR,
  formatBillingCurrency,
  formatBillingWhatsappMessage,
  generateNextBillingNumber,
  organizeTaxInvoicesByProject,
} from '../utils/billing';
import {
  buildBillingDocumentPdfBlob,
  compressBoundedScreenshotDataUrl,
  triggerBlobDownload,
} from '../utils/idCardPdf';
import { calculateFlatProgress, getEffectiveZonesForFlat } from '../utils/tileZones';
import { PrintPreviewOverlay } from './PrintPreviewOverlay';
import { PrintableInvoiceSheet } from './PrintableInvoiceSheet';

interface BillingInvoicesViewProps {
  onTriggerWhatsapp: (payload: WhatsappMessagePayload) => void;
}

interface DraftLineRow {
  id: string;
  description: string;
  hsnSac: string;
  unit: string;
  quantity: string;
  rate: string;
  gstRate: string;
}

function createEmptyLineRow(defaultGst = '18'): DraftLineRow {
  return {
    id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    description: '',
    hsnSac: '995433',
    unit: 'Sq.Ft',
    quantity: '100',
    rate: '45',
    gstRate: defaultGst,
  };
}

function docStatusBadgeClass(status: BillingDocStatus): string {
  switch (status) {
    case 'paid':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'sent':
      return 'bg-sky-50 text-sky-800 border-sky-200';
    case 'issued':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'cancelled':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function docTypeBadgeClass(docType: BillingDocType): string {
  switch (docType) {
    case 'tax_invoice':
      return 'bg-orange-50 text-orange-800 border-orange-200';
    case 'invoice':
      return 'bg-slate-100 text-slate-800 border-slate-300';
    case 'quotation':
      return 'bg-indigo-50 text-indigo-800 border-indigo-200';
  }
}

export function BillingInvoicesView({ onTriggerWhatsapp }: BillingInvoicesViewProps) {
  const {
    session,
    companyProfile,
    projects: rawProjects,
    towers: rawTowers,
    flats,
    billingDocuments,
    addBillingDocument,
    updateBillingDocument,
    convertBillingDocument,
    deleteBillingDocument,
  } = useStore();

  const isAdmin = isAdminSession(session);
  const isSupervisor = isSupervisorSession(session);
  const projects = useMemo(
    () => getScopedProjects(session, rawProjects, rawTowers),
    [session, rawProjects, rawTowers]
  );
  const towers = useMemo(() => getScopedTowers(session, rawTowers), [session, rawTowers]);

  const scopedDocList = useMemo(() => {
    const allowedProjectIds = new Set(projects.map((p) => p.id));
    return (billingDocuments || [])
      .filter((doc) => !isSupervisor || !doc.projectId || allowedProjectIds.has(doc.projectId))
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.createdAt.localeCompare(a.createdAt));
  }, [billingDocuments, isSupervisor, projects]);

  const [activeTab, setActiveTab] = useState<'documents' | 'organizer'>('documents');
  const [filterDocType, setFilterDocType] = useState<'all' | BillingDocType>('all');
  const [filterProjectId, setFilterProjectId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | BillingDocStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Organizer sub-controls
  const [organizerMode, setOrganizerMode] = useState<'tax_invoice' | 'all_bills' | 'all'>(
    'tax_invoice'
  );
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState('');

  // Modal: Create / Edit Billing Document
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<BillingDocument | null>(null);
  const [docType, setDocType] = useState<BillingDocType>('tax_invoice');
  const [docNumber, setDocNumber] = useState('');
  const [issueDate, setIssueDate] = useState(getTodayIso());
  const [dueDate, setDueDate] = useState('');
  const [projectId, setProjectId] = useState('');
  const [towerId, setTowerId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientGstin, setClientGstin] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('Telangana (36)');
  const [taxMode, setTaxMode] = useState<BillingTaxMode>('cgst_sgst');
  const [status, setStatus] = useState<BillingDocStatus>('issued');
  const [amountPaid, setAmountPaid] = useState('0');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState(DEFAULT_BILLING_TERMS);
  const [useCustomLetterhead, setUseCustomLetterhead] = useState(false);
  const [hideDefaultHeader, setHideDefaultHeader] = useState(false);
  const [letterheadBgDataUrl, setLetterheadBgDataUrl] = useState('');
  const [letterheadBgOpacity, setLetterheadBgOpacity] = useState(0.14);
  const [lineRows, setLineRows] = useState<DraftLineRow[]>([createEmptyLineRow('18')]);

  // Gemini AI prompt engineering state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiError, setAiError] = useState('');

  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [printPreviewDoc, setPrintPreviewDoc] = useState<BillingDocument | null>(null);

  const filteredDocuments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scopedDocList.filter((doc) => {
      if (filterDocType !== 'all' && doc.docType !== filterDocType) return false;
      if (filterProjectId !== 'all' && (doc.projectId || '__unassigned__') !== filterProjectId) {
        return false;
      }
      if (filterStatus !== 'all' && doc.status !== filterStatus) return false;
      if (!q) return true;
      return (
        doc.docNumber.toLowerCase().includes(q) ||
        doc.clientName.toLowerCase().includes(q) ||
        (doc.projectName || '').toLowerCase().includes(q) ||
        (doc.towerName || '').toLowerCase().includes(q) ||
        (doc.clientGstin || '').toLowerCase().includes(q)
      );
    });
  }, [scopedDocList, filterDocType, filterProjectId, filterStatus, searchQuery]);

  const summaryKpis = useMemo(() => {
    const activeBills = scopedDocList.filter(
      (d) => d.status !== 'cancelled' && (d.docType === 'tax_invoice' || d.docType === 'invoice')
    );
    const taxDocs = scopedDocList.filter(
      (d) => d.status !== 'cancelled' && d.docType === 'tax_invoice'
    );
    const openQuotes = scopedDocList.filter(
      (d) => d.status !== 'cancelled' && d.docType === 'quotation'
    );

    const totalTaxBilled = taxDocs.reduce((s, d) => s + (d.grandTotal || 0), 0);
    const totalGstCollected = taxDocs.reduce(
      (s, d) => s + (d.cgstTotal || 0) + (d.sgstTotal || 0) + (d.igstTotal || 0),
      0
    );
    const totalReceivables = activeBills.reduce((s, d) => {
      const paid = d.status === 'paid' ? d.grandTotal : d.amountPaid || 0;
      return s + Math.max(0, (d.grandTotal || 0) - paid);
    }, 0);
    const quotesPipeline = openQuotes.reduce((s, d) => s + (d.grandTotal || 0), 0);

    return {
      taxInvoiceCount: taxDocs.length,
      totalTaxBilled,
      totalGstCollected,
      totalReceivables,
      quotationCount: openQuotes.length,
      quotesPipeline,
    };
  }, [scopedDocList]);

  const projectOrganizerBuckets = useMemo(
    () =>
      organizeTaxInvoicesByProject({
        docs: scopedDocList,
        projects,
        docTypeFilter: organizerMode,
      }),
    [scopedDocList, projects, organizerMode]
  );

  const liveDraftTotals = useMemo(
    () =>
      computeBillingTotals(
        lineRows.map((r) => ({
          id: r.id,
          description: r.description || 'Item',
          hsnSac: r.hsnSac,
          unit: r.unit,
          quantity: Number(r.quantity) || 0,
          rate: Number(r.rate) || 0,
          gstRate: Number(r.gstRate) || 0,
        })),
        taxMode
      ),
    [lineRows, taxMode]
  );

  const openNewDocModal = (initialType: BillingDocType, prefillProjectId?: string) => {
    const today = getTodayIso();
    const targetProj =
      projects.find((p) => p.id === (prefillProjectId || projects[0]?.id)) || null;
    const defaultTaxMode: BillingTaxMode = initialType === 'tax_invoice' ? 'cgst_sgst' : 'none';
    const defaultGst = initialType === 'tax_invoice' ? '18' : '0';
    const hasCompanyBg = Boolean(companyProfile.quotationLetterheadBgDataUrl);

    setEditingDoc(null);
    setDocType(initialType);
    setDocNumber(generateNextBillingNumber(initialType, billingDocuments || [], today));
    setIssueDate(today);
    setDueDate('');
    setProjectId(targetProj?.id || '');
    setTowerId('');
    setClientName(targetProj?.clientName || '');
    setClientPhone(targetProj?.managerPhone || '');
    setClientEmail('');
    setClientGstin('');
    setClientAddress(targetProj?.location || '');
    setPlaceOfSupply('Telangana (36)');
    setTaxMode(defaultTaxMode);
    setStatus(initialType === 'quotation' ? 'draft' : 'issued');
    setAmountPaid('0');
    setNotes('');
    setTerms(DEFAULT_BILLING_TERMS);
    setUseCustomLetterhead(initialType === 'quotation' && hasCompanyBg);
    setHideDefaultHeader(false);
    setLetterheadBgDataUrl(companyProfile.quotationLetterheadBgDataUrl || '');
    setLetterheadBgOpacity(
      typeof companyProfile.quotationLetterheadOpacity === 'number' &&
        Number.isFinite(companyProfile.quotationLetterheadOpacity)
        ? Math.max(0.05, Math.min(1, companyProfile.quotationLetterheadOpacity))
        : 0.14
    );
    setLineRows([createEmptyLineRow(defaultGst)]);
    setAiPrompt('');
    setAiError('');
    setSaveError('');
    setModalOpen(true);
  };

  const openEditDocModal = (doc: BillingDocument) => {
    setEditingDoc(doc);
    setDocType(doc.docType);
    setDocNumber(doc.docNumber);
    setIssueDate(doc.issueDate);
    setDueDate(doc.dueDate || '');
    setProjectId(doc.projectId || '');
    setTowerId(doc.towerId || '');
    setClientName(doc.clientName);
    setClientPhone(doc.clientPhone || '');
    setClientEmail(doc.clientEmail || '');
    setClientGstin(doc.clientGstin || '');
    setClientAddress(doc.clientAddress || '');
    setPlaceOfSupply(doc.placeOfSupply || 'Telangana (36)');
    setTaxMode(doc.taxMode);
    setStatus(doc.status);
    setAmountPaid(String(doc.amountPaid || 0));
    setNotes(doc.notes || '');
    setTerms(doc.terms || DEFAULT_BILLING_TERMS);
    setUseCustomLetterhead(Boolean(doc.useCustomLetterhead));
    setHideDefaultHeader(Boolean(doc.hideDefaultHeader));
    setLetterheadBgDataUrl(doc.letterheadBgDataUrl || '');
    setLetterheadBgOpacity(
      typeof doc.letterheadBgOpacity === 'number' && Number.isFinite(doc.letterheadBgOpacity)
        ? Math.max(0.05, Math.min(1, doc.letterheadBgOpacity))
        : typeof companyProfile.quotationLetterheadOpacity === 'number' &&
            Number.isFinite(companyProfile.quotationLetterheadOpacity)
          ? Math.max(0.05, Math.min(1, companyProfile.quotationLetterheadOpacity))
          : 0.14
    );
    setLineRows(
      doc.items.length > 0
        ? doc.items.map((it) => ({
            id: it.id,
            description: it.description,
            hsnSac: it.hsnSac || '995433',
            unit: it.unit || 'Sq.Ft',
            quantity: String(it.quantity),
            rate: String(it.rate),
            gstRate: String(it.gstRate),
          }))
        : [createEmptyLineRow(doc.taxMode === 'none' ? '0' : '18')]
    );
    setAiPrompt('');
    setAiError('');
    setSaveError('');
    setModalOpen(true);
  };

  const handleDocTypeSwitch = (nextType: BillingDocType) => {
    setDocType(nextType);
    if (!editingDoc) {
      setDocNumber(generateNextBillingNumber(nextType, billingDocuments || [], issueDate));
      if (nextType === 'tax_invoice' && taxMode === 'none') {
        setTaxMode('cgst_sgst');
        setLineRows((prev) => prev.map((r) => ({ ...r, gstRate: r.gstRate === '0' ? '18' : r.gstRate })));
      }
    }
  };

  const handleProjectSelect = (nextProjId: string) => {
    setProjectId(nextProjId);
    setTowerId('');
    const proj = projects.find((p) => p.id === nextProjId);
    if (proj) {
      if (!clientName.trim()) setClientName(proj.clientName || '');
      if (!clientPhone.trim()) setClientPhone(proj.managerPhone || '');
      if (!clientAddress.trim()) setClientAddress(proj.location || '');
    }
  };

  const handlePrefillPromptFromSite = () => {
    const proj = projects.find((p) => p.id === projectId);
    const twr = towers.find((t) => t.id === towerId);
    const scopedFlats = flats.filter((f) => {
      if (twr) return f.towerId === twr.id;
      if (proj) return f.projectId === proj.id;
      return true;
    });

    let completedSqft = 0;
    let totalSqft = 0;
    const categoryTotals: Record<string, number> = {};
    const zoneCatalog = companyProfile?.tileZoneCatalog;

    for (const flat of scopedFlats) {
      const prog = calculateFlatProgress(flat, zoneCatalog);
      completedSqft += prog.completedSqft;
      totalSqft += prog.totalSqft;
      const defs = getEffectiveZonesForFlat(flat, zoneCatalog);
      for (const def of defs) {
        const z = flat.zones?.[def.key];
        const sqft = Number(z?.sqft ?? def.defaultSqft) || 0;
        if (z?.status === 'completed' || z?.status === 'cleaning_done' || z?.status === 'in_progress') {
          categoryTotals[def.category] = (categoryTotals[def.category] || 0) + sqft;
        }
      }
    }

    const catBreakdown = Object.entries(categoryTotals)
      .filter(([, sqft]) => sqft > 0)
      .map(([cat, sqft]) => `${cat}: ${sqft} sq.ft`)
      .join(', ');

    const scopeTitle = proj
      ? `${proj.name}${twr ? ` (${twr.name})` : ''}`
      : 'Active Tile Project';
    const docLabel = BILLING_DOC_TYPE_LABELS[docType];

    setAiPrompt(
      `Prepare a detailed ${docLabel} BOQ for ${scopeTitle} covering ${scopedFlats.length} unit(s) (Completed tile area: ${completedSqft} sq.ft out of ${totalSqft} sq.ft total). ${catBreakdown ? `Category execution: ${catBreakdown}. ` : ''}Include vitrified floor tiling, bathroom dado wall tiling, granite kitchen counter fixing, waterproofing/grout finishing, and site floor cleaning with HSN/SAC 995433 and standard Indian contracting rates.`
    );
  };

  const handleDraftItemsWithGemini = async () => {
    setAiError('');
    if (!aiPrompt.trim()) {
      setAiError('Enter a work scope description or click "Auto-fill from Site Sq.Ft" first.');
      return;
    }
    setAiDrafting(true);
    try {
      const proj = projects.find((p) => p.id === projectId);
      const twr = towers.find((t) => t.id === towerId);
      const resp = await fetch('/api/billing/draft-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt.trim(),
          docType,
          projectName: proj?.name || '',
          towerName: twr?.name || '',
          clientName: clientName.trim(),
        }),
      });
      const json = (await resp.json()) as {
        error?: string;
        items?: Array<{
          description: string;
          hsnSac?: string;
          unit?: string;
          quantity?: number;
          rate?: number;
          gstRate?: number;
        }>;
        suggestedNotes?: string;
      };
      if (!resp.ok || json.error) {
        setAiError(json.error || `Gemini AI draft failed (${resp.status}).`);
        return;
      }
      if (!json.items || json.items.length === 0) {
        setAiError('Gemini returned no line items. Please refine your prompt.');
        return;
      }

      const mappedRows: DraftLineRow[] = json.items.map((it, idx) => ({
        id: `ai_${Date.now()}_${idx}`,
        description: it.description,
        hsnSac: it.hsnSac || '995433',
        unit: it.unit || 'Sq.Ft',
        quantity: String(it.quantity ?? 100),
        rate: String(it.rate ?? 45),
        gstRate: taxMode === 'none' ? '0' : String(it.gstRate ?? 18),
      }));

      setLineRows((prev) => {
        const nonEmpty = prev.filter((r) => r.description.trim().length > 0);
        return [...nonEmpty, ...mappedRows];
      });
      if (json.suggestedNotes && !notes.trim()) {
        setNotes(json.suggestedNotes);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to connect to Gemini AI endpoint.');
    } finally {
      setAiDrafting(false);
    }
  };

  const handleUploadLetterheadBg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaveError('');
    try {
      const compressed = await compressBoundedScreenshotDataUrl(file, {
        maxWidth: 1000,
        maxHeight: 1400,
        quality: 0.78,
        maxChars: 220000,
      });
      setLetterheadBgDataUrl(compressed);
      setUseCustomLetterhead(true);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to process letterhead background image.'
      );
    }
  };

  const handleSaveDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError('');
    if (!clientName.trim()) {
      setSaveError('Please enter Client / Builder Name.');
      return;
    }
    const cleanItems = lineRows
      .filter((r) => r.description.trim().length > 0)
      .map((r) => ({
        id: r.id,
        description: r.description.trim(),
        hsnSac: r.hsnSac.trim() || '995433',
        unit: r.unit.trim() || 'Sq.Ft',
        quantity: Math.max(0, Number(r.quantity) || 0),
        rate: Math.max(0, Number(r.rate) || 0),
        gstRate: taxMode === 'none' ? 0 : Math.max(0, Math.min(28, Number(r.gstRate) || 0)),
      }));

    if (cleanItems.length === 0) {
      setSaveError('Please enter at least one line item with a description.');
      return;
    }

    setSaveBusy(true);
    try {
      if (editingDoc) {
        await updateBillingDocument(editingDoc.id, {
          docType,
          docNumber: docNumber.trim(),
          issueDate,
          dueDate,
          projectId,
          towerId,
          clientName: clientName.trim(),
          clientPhone: clientPhone.trim(),
          clientEmail: clientEmail.trim(),
          clientAddress: clientAddress.trim(),
          clientGstin: clientGstin.trim().toUpperCase(),
          placeOfSupply: placeOfSupply.trim(),
          taxMode,
          items: cleanItems,
          amountPaid: Number(amountPaid) || 0,
          status,
          notes: notes.trim(),
          terms: terms.trim(),
          useCustomLetterhead,
          hideDefaultHeader,
          letterheadBgDataUrl,
          letterheadBgOpacity,
        });
        setActionFeedback(`Updated ${BILLING_DOC_TYPE_LABELS[docType]} ${docNumber.trim()}.`);
      } else {
        const created = await addBillingDocument({
          docType,
          docNumber: docNumber.trim(),
          issueDate,
          dueDate,
          projectId,
          towerId,
          clientName: clientName.trim(),
          clientPhone: clientPhone.trim(),
          clientEmail: clientEmail.trim(),
          clientAddress: clientAddress.trim(),
          clientGstin: clientGstin.trim().toUpperCase(),
          placeOfSupply: placeOfSupply.trim(),
          taxMode,
          items: cleanItems,
          amountPaid: Number(amountPaid) || 0,
          status,
          notes: notes.trim(),
          terms: terms.trim(),
          useCustomLetterhead,
          hideDefaultHeader,
          letterheadBgDataUrl,
          letterheadBgOpacity,
        });
        setActionFeedback(`Saved ${created.docNumber} to database.`);
      }
      setModalOpen(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save billing document.');
    } finally {
      setSaveBusy(false);
    }
  };

  const handleDownloadPdf = (doc: BillingDocument) => {
    const { blob, fileName } = buildBillingDocumentPdfBlob(doc, companyProfile);
    triggerBlobDownload(blob, fileName);
    setActionFeedback(`Downloaded PDF: ${fileName}`);
  };

  const handleOpenDraftPrintPreview = () => {
    const cleanItems = lineRows
      .filter((r) => r.description.trim().length > 0)
      .map((r) => ({
        id: r.id,
        description: r.description.trim() || 'Item',
        hsnSac: r.hsnSac.trim() || '995433',
        unit: r.unit.trim() || 'Sq.Ft',
        quantity: Math.max(0, Number(r.quantity) || 0),
        rate: Math.max(0, Number(r.rate) || 0),
        gstRate: taxMode === 'none' ? 0 : Math.max(0, Math.min(28, Number(r.gstRate) || 0)),
      }));
    const computed = computeBillingTotals(cleanItems, taxMode);
    const proj = projects.find((p) => p.id === projectId);
    const twr = towers.find((t) => t.id === towerId);
    setPrintPreviewDoc({
      id: editingDoc?.id || 'draft_preview',
      ownerId: editingDoc?.ownerId || 'preview',
      docType,
      docNumber: docNumber.trim() || 'DRAFT',
      issueDate,
      dueDate: dueDate || undefined,
      projectId: projectId || undefined,
      projectName: proj?.name || undefined,
      towerId: towerId || undefined,
      towerName: twr?.name || undefined,
      clientName: clientName.trim() || 'Client Name',
      clientPhone: clientPhone.trim() || undefined,
      clientEmail: clientEmail.trim() || undefined,
      clientAddress: clientAddress.trim() || undefined,
      clientGstin: clientGstin.trim().toUpperCase() || undefined,
      placeOfSupply: placeOfSupply.trim() || undefined,
      taxMode,
      items: computed.items,
      subtotal: computed.subtotal,
      cgstTotal: computed.cgstTotal,
      sgstTotal: computed.sgstTotal,
      igstTotal: computed.igstTotal,
      roundOff: computed.roundOff,
      grandTotal: computed.grandTotal,
      amountPaid: Number(amountPaid) || 0,
      status,
      notes: notes.trim() || undefined,
      terms: terms.trim() || undefined,
      whatsappShared: editingDoc?.whatsappShared ?? false,
      useCustomLetterhead,
      hideDefaultHeader,
      letterheadBgDataUrl: letterheadBgDataUrl || undefined,
      letterheadBgOpacity,
      createdAt: editingDoc?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleSharePdfWhatsappEmail = async (doc: BillingDocument, markSent = true) => {
    const { blob, fileName } = buildBillingDocumentPdfBlob(doc, companyProfile);
    triggerBlobDownload(blob, fileName);

    // Attempt native Web Share with PDF file where supported (mobile browsers), while also opening modal for guaranteed WhatsApp / Email dispatch
    const msg = formatBillingWhatsappMessage(doc, companyProfile);
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        const pdfFile = new File([blob], fileName, { type: 'application/pdf' });
        const navWithCanShare = navigator as Navigator & {
          canShare?: (data: ShareData) => boolean;
        };
        if (!navWithCanShare.canShare || navWithCanShare.canShare({ files: [pdfFile] })) {
          await navigator.share({
            title: `${companyProfile.companyName} — ${doc.docNumber}`,
            text: msg,
            files: [pdfFile],
          });
        }
      } catch {
        // User dismissed native share or desktop environment; proceed directly to WhatsApp/Email modal
      }
    }

    if (markSent) {
      await updateBillingDocument(doc.id, {
        whatsappShared: true,
        status: doc.status === 'draft' ? 'sent' : doc.status,
      });
    }

    onTriggerWhatsapp({
      title: `Share ${BILLING_DOC_TYPE_LABELS[doc.docType]} ${doc.docNumber} (PDF + WhatsApp / Email)`,
      recipientName: doc.clientName,
      recipientPhone: doc.clientPhone || '',
      recipientEmail: doc.clientEmail || '',
      emailSubject: `${companyProfile.companyName} — ${BILLING_DOC_TYPE_LABELS[doc.docType]} ${doc.docNumber} (${formatBillingCurrency(doc.grandTotal)})`,
      message: msg,
    });
    setActionFeedback(`PDF ${fileName} prepared for WhatsApp & Email sharing.`);
  };

  const handleConvert = async (doc: BillingDocument, targetType: BillingDocType) => {
    const created = await convertBillingDocument(doc.id, targetType);
    setActionFeedback(
      `Converted ${doc.docNumber} → new ${BILLING_DOC_TYPE_LABELS[targetType]} ${created.docNumber}.`
    );
  };

  const handleQuickStatusChange = async (doc: BillingDocument, nextStatus: BillingDocStatus) => {
    await updateBillingDocument(doc.id, {
      status: nextStatus,
      amountPaid: nextStatus === 'paid' ? doc.grandTotal : doc.amountPaid,
    });
    setActionFeedback(`${doc.docNumber} marked ${BILLING_STATUS_LABELS[nextStatus]}.`);
  };

  const handleConfirmDelete = async (docId: string) => {
    await deleteBillingDocument(docId);
    setConfirmDeleteId(null);
    setActionFeedback('Billing document deleted.');
  };

  return (
    <div className="space-y-6">
      {/* Page Header & Quick Maker Triggers */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Quotations, Invoices &amp; Project Tax Organizer
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Create auto-numbered Quotations, Regular Invoices, and GST Tax Invoices, draft BOQ rows with Gemini AI, export A4 PDFs, and share via WhatsApp or Email.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => openNewDocModal('quotation')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>New Quotation</span>
          </button>
          <button
            type="button"
            onClick={() => openNewDocModal('invoice')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>New Invoice</span>
          </button>
          <button
            type="button"
            onClick={() => openNewDocModal('tax_invoice')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
            <span>New Tax Invoice (GST)</span>
          </button>
        </div>
      </div>

      {/* Top Billing KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Tax Invoices (GST)</div>
          <div className="mt-1 text-xl font-mono font-bold tabular-nums text-slate-900">
            {formatBillingCurrency(summaryKpis.totalTaxBilled)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono">
            {summaryKpis.taxInvoiceCount} active tax invoice{summaryKpis.taxInvoiceCount === 1 ? '' : 's'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Total GST Output Tax</div>
          <div className="mt-1 text-xl font-mono font-bold tabular-nums text-orange-700">
            {formatBillingCurrency(summaryKpis.totalGstCollected)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">CGST + SGST + IGST recorded</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Pending Receivables</div>
          <div className="mt-1 text-xl font-mono font-bold tabular-nums text-amber-700">
            {formatBillingCurrency(summaryKpis.totalReceivables)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">Unpaid balance across bills</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Active Quotations</div>
          <div className="mt-1 text-xl font-mono font-bold tabular-nums text-indigo-700">
            {formatBillingCurrency(summaryKpis.quotesPipeline)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono">
            {summaryKpis.quotationCount} quote{summaryKpis.quotationCount === 1 ? '' : 's'} ready to convert
          </div>
        </div>
      </div>

      {actionFeedback && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md"
        >
          <span>{actionFeedback}</span>
          <button
            type="button"
            onClick={() => setActionFeedback('')}
            aria-label="Dismiss billing feedback"
            className="text-emerald-700 hover:text-emerald-900 p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'documents'}
            onClick={() => setActiveTab('documents')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded transition-colors ${
              activeTab === 'documents'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Quotations &amp; Invoices ({scopedDocList.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'organizer'}
            onClick={() => setActiveTab('organizer')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded transition-colors ${
              activeTab === 'organizer'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Project-Wise Tax Invoice Organizer ({projectOrganizerBuckets.length})
          </button>
        </div>

        <div className="text-xs text-slate-500 font-mono">
          Supplier GSTIN: <strong className="text-slate-800">{companyProfile.gstNumber || 'Not Configured'}</strong>
        </div>
      </div>

      {/* TAB 1: ALL QUOTATIONS, INVOICES & TAX INVOICES */}
      {activeTab === 'documents' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="bill-filter-type" className="block text-xs font-medium text-slate-500 mb-1">
                Document Type
              </label>
              <select
                id="bill-filter-type"
                value={filterDocType}
                onChange={(e) => setFilterDocType(e.target.value as 'all' | BillingDocType)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
              >
                <option value="all">All Types ({scopedDocList.length})</option>
                <option value="tax_invoice">Tax Invoices (GST)</option>
                <option value="invoice">Regular Invoices</option>
                <option value="quotation">Quotations</option>
              </select>
            </div>

            <div>
              <label htmlFor="bill-filter-proj" className="block text-xs font-medium text-slate-500 mb-1">
                Project
              </label>
              <select
                id="bill-filter-proj"
                value={filterProjectId}
                onChange={(e) => setFilterProjectId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
              >
                <option value="all">All Projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="__unassigned__">Unlinked / General Clients</option>
              </select>
            </div>

            <div>
              <label htmlFor="bill-filter-status" className="block text-xs font-medium text-slate-500 mb-1">
                Payment / Issue Status
              </label>
              <select
                id="bill-filter-status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'all' | BillingDocStatus)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="issued">Issued</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div>
              <label htmlFor="bill-search" className="block text-xs font-medium text-slate-500 mb-1">
                Search Number / Client / GSTIN
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
                <input
                  id="bill-search"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="TAX-2026, client, project..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>
          </div>

          {/* Documents List */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {filteredDocuments.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <FileText className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
                <p className="text-sm text-slate-600">No quotations or invoices match these filters.</p>
                <button
                  type="button"
                  onClick={() => openNewDocModal('tax_invoice')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
                >
                  Create First Tax Invoice
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <th className="py-3 px-4">Doc Number &amp; Date</th>
                      <th className="py-3 px-3">Type</th>
                      <th className="py-3 px-3">Client &amp; Project</th>
                      <th className="py-3 px-3 text-right">Subtotal + GST</th>
                      <th className="py-3 px-3 text-right">Grand Total</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-4 text-right">PDF, Share &amp; Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredDocuments.map((doc) => {
                      const taxSum = (doc.cgstTotal || 0) + (doc.sgstTotal || 0) + (doc.igstTotal || 0);
                      const balance =
                        doc.status === 'paid'
                          ? 0
                          : Math.max(0, (doc.grandTotal || 0) - (doc.amountPaid || 0));
                      return (
                        <tr key={doc.id} className="hover:bg-slate-50/70 align-top">
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-mono font-bold text-slate-900">{doc.docNumber}</div>
                            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                              {doc.issueDate}
                              {doc.dueDate ? ` → ${doc.dueDate}` : ''}
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span
                              className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded border ${docTypeBadgeClass(
                                doc.docType
                              )}`}
                            >
                              {BILLING_DOC_TYPE_LABELS[doc.docType]}
                            </span>
                            <div className="text-[11px] text-slate-500 mt-1">
                              {doc.items.length} item{doc.items.length === 1 ? '' : 's'}
                            </div>
                          </td>
                          <td className="py-3 px-3 min-w-[200px]">
                            <div className="font-semibold text-slate-900">{doc.clientName}</div>
                            {doc.projectName && (
                              <div className="text-[11px] text-slate-600">
                                {doc.projectName}
                                {doc.towerName ? ` · ${doc.towerName}` : ''}
                              </div>
                            )}
                            {doc.clientGstin && (
                              <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                                GSTIN: {doc.clientGstin}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="text-slate-700">{formatBillingCurrency(doc.subtotal)}</div>
                            <div className="text-[11px] text-slate-500">
                              {doc.taxMode === 'none'
                                ? 'No GST'
                                : `+ ${formatBillingCurrency(taxSum)} GST`}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-bold text-slate-900 text-sm">
                              {formatBillingCurrency(doc.grandTotal)}
                            </div>
                            {doc.docType !== 'quotation' && balance > 0 && (
                              <div className="text-[11px] text-amber-700">
                                Bal: {formatBillingCurrency(balance)}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <select
                              aria-label={`Change status for ${doc.docNumber}`}
                              value={doc.status}
                              onChange={(e) =>
                                handleQuickStatusChange(doc, e.target.value as BillingDocStatus)
                              }
                              className={`px-2 py-1 text-[11px] font-semibold rounded border ${docStatusBadgeClass(
                                doc.status
                              )}`}
                            >
                              <option value="draft">Draft</option>
                              <option value="issued">Issued</option>
                              <option value="sent">Sent</option>
                              <option value="paid">Paid</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                            {doc.whatsappShared && (
                              <div className="text-[10px] text-emerald-700 mt-1 flex items-center gap-0.5">
                                <Check className="w-3 h-3" aria-hidden="true" />
                                <span>Shared</span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex flex-wrap justify-end items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setPrintPreviewDoc(doc)}
                                aria-label={`Print preview for ${doc.docNumber}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                              >
                                <Printer className="w-3 h-3" aria-hidden="true" />
                                <span>Print</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDownloadPdf(doc)}
                                aria-label={`Download PDF for ${doc.docNumber}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                              >
                                <Download className="w-3 h-3" aria-hidden="true" />
                                <span>PDF</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleSharePdfWhatsappEmail(doc, true)}
                                aria-label={`Share ${doc.docNumber} PDF on WhatsApp or Email`}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                              >
                                <MessageSquare className="w-3 h-3" aria-hidden="true" />
                                <Mail className="w-3 h-3" aria-hidden="true" />
                                <span>WA / Email</span>
                              </button>

                              {doc.docType === 'quotation' && (
                                <button
                                  type="button"
                                  onClick={() => handleConvert(doc, 'tax_invoice')}
                                  aria-label={`Convert ${doc.docNumber} to Tax Invoice`}
                                  className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                                >
                                  <ArrowRightLeft className="w-3 h-3" aria-hidden="true" />
                                  <span>To Tax Inv</span>
                                </button>
                              )}

                              {doc.docType === 'invoice' && (
                                <button
                                  type="button"
                                  onClick={() => handleConvert(doc, 'tax_invoice')}
                                  aria-label={`Upgrade ${doc.docNumber} to GST Tax Invoice`}
                                  className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                                >
                                  <ArrowRightLeft className="w-3 h-3" aria-hidden="true" />
                                  <span>To GST Tax</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => openEditDocModal(doc)}
                                aria-label={`Edit ${doc.docNumber}`}
                                className="p-1.5 text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-100"
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>

                              {isAdmin && (
                                confirmDeleteId === doc.id ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleConfirmDelete(doc.id)}
                                      className="px-2 py-1 text-[11px] font-semibold text-white bg-red-700 rounded"
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="px-2 py-1 text-[11px] text-slate-600 border border-slate-300 rounded bg-white"
                                    >
                                      No
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(doc.id)}
                                    aria-label={`Delete ${doc.docNumber}`}
                                    className="p-1.5 text-red-600 bg-white border border-red-200 rounded hover:bg-red-50"
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
        </div>
      )}

      {/* TAB 2: PROJECT-WISE TAX INVOICE ORGANIZER */}
      {activeTab === 'organizer' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Project-Wise Tax Invoice &amp; GST Ledger Organizer
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Inspect GST tax breakdown (CGST / SGST / IGST), billed totals, collections, and pending client receivables grouped by Construction Project.
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              {[
                { id: 'tax_invoice' as const, label: 'Tax Invoices Only' },
                { id: 'all_bills' as const, label: 'Tax + Regular Bills' },
                { id: 'all' as const, label: 'All Docs + Quotes' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setOrganizerMode(opt.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded ${
                    organizerMode === opt.id
                      ? 'bg-white text-slate-900 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {projectOrganizerBuckets.map((bucket) => {
            const isExpanded = expandedProjectIds[bucket.projectId] ?? bucket.docCount > 0;
            return (
              <section
                key={bucket.projectId}
                className="bg-white border border-slate-200 rounded-lg overflow-hidden"
              >
                <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/70 border-b border-slate-200">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-md bg-slate-900 text-white flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-orange-400" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-slate-900 truncate">
                        {bucket.projectName}
                      </h3>
                      <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {bucket.clientName && <span>Client: {bucket.clientName}</span>}
                        {bucket.location && <span>· {bucket.location}</span>}
                        <span className="font-mono text-slate-700">
                          · {bucket.docCount} doc{bucket.docCount === 1 ? '' : 's'} ({bucket.paidCount} paid)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 sm:gap-6 shrink-0">
                    <div className="text-right">
                      <div className="text-[11px] text-slate-500">Taxable Subtotal</div>
                      <div className="text-xs font-mono font-semibold text-slate-800">
                        {formatBillingCurrency(bucket.subtotal)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-slate-500">
                        {bucket.igstTotal > 0 ? 'CGST+SGST / IGST' : 'CGST + SGST'}
                      </div>
                      <div className="text-xs font-mono font-semibold text-orange-700">
                        {formatBillingCurrency(bucket.totalTax)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-slate-500">Grand Billed</div>
                      <div className="text-sm font-mono font-bold text-slate-900">
                        {formatBillingCurrency(bucket.grandTotal)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-slate-500">Pending Balance</div>
                      <div
                        className={`text-sm font-mono font-bold ${
                          bucket.pendingBalance > 0 ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        {formatBillingCurrency(bucket.pendingBalance)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {bucket.projectId !== '__unassigned__' && (
                        <button
                          type="button"
                          onClick={() => openNewDocModal('tax_invoice', bucket.projectId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded hover:bg-orange-800 whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Tax Inv</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedProjectIds((prev) => ({
                            ...prev,
                            [bucket.projectId]: !isExpanded,
                          }))
                        }
                        aria-expanded={isExpanded}
                        aria-label={`Toggle invoices list for ${bucket.projectName}`}
                        className="p-1.5 text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-100"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-4">
                    {bucket.documents.length === 0 ? (
                      <div className="py-4 text-center text-xs text-slate-500">
                        No {organizerMode === 'tax_invoice' ? 'Tax Invoices' : 'billing documents'} recorded for{' '}
                        {bucket.projectName} yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500">
                              <th className="py-2 pr-3">Doc No</th>
                              <th className="py-2 px-2">Date</th>
                              <th className="py-2 px-2">Tower / Client</th>
                              <th className="py-2 px-2 text-right">Taxable</th>
                              <th className="py-2 px-2 text-right">CGST</th>
                              <th className="py-2 px-2 text-right">SGST</th>
                              <th className="py-2 px-2 text-right">IGST</th>
                              <th className="py-2 px-2 text-right">Total</th>
                              <th className="py-2 px-2 text-right">Paid</th>
                              <th className="py-2 px-2">Status</th>
                              <th className="py-2 pl-2 text-right">PDF &amp; Share</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {bucket.documents.map((doc) => (
                              <tr key={doc.id} className="hover:bg-slate-50/70">
                                <td className="py-2.5 pr-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                                  {doc.docNumber}
                                </td>
                                <td className="py-2.5 px-2 font-mono text-slate-600 whitespace-nowrap">
                                  {doc.issueDate}
                                </td>
                                <td className="py-2.5 px-2">
                                  <span className="font-medium text-slate-900">{doc.clientName}</span>
                                  {doc.towerName && (
                                    <span className="text-slate-500"> · {doc.towerName}</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono">
                                  {formatBillingCurrency(doc.subtotal)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono text-slate-600">
                                  {formatBillingCurrency(doc.cgstTotal)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono text-slate-600">
                                  {formatBillingCurrency(doc.sgstTotal)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono text-slate-600">
                                  {formatBillingCurrency(doc.igstTotal)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono font-bold text-slate-900">
                                  {formatBillingCurrency(doc.grandTotal)}
                                </td>
                                <td className="py-2.5 px-2 text-right font-mono text-emerald-700">
                                  {formatBillingCurrency(
                                    doc.status === 'paid' ? doc.grandTotal : doc.amountPaid
                                  )}
                                </td>
                                <td className="py-2.5 px-2 whitespace-nowrap">
                                  <span
                                    className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${docStatusBadgeClass(
                                      doc.status
                                    )}`}
                                  >
                                    {BILLING_STATUS_LABELS[doc.status]}
                                  </span>
                                </td>
                                <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setPrintPreviewDoc(doc)}
                                      aria-label={`Print preview ${doc.docNumber}`}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                                    >
                                      <Printer className="w-3 h-3" aria-hidden="true" />
                                      <span>Print</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDownloadPdf(doc)}
                                      aria-label={`Download PDF ${doc.docNumber}`}
                                      className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                                    >
                                      PDF
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSharePdfWhatsappEmail(doc, true)}
                                      aria-label={`Share ${doc.docNumber} via WhatsApp or Email`}
                                      className="px-2 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                                    >
                                      WA / Mail
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openEditDocModal(doc)}
                                      aria-label={`Edit ${doc.docNumber}`}
                                      className="p-1 text-slate-600 border border-slate-300 rounded hover:bg-slate-100"
                                    >
                                      <Pencil className="w-3 h-3" aria-hidden="true" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* MODAL: INVOICE / QUOTATION / TAX INVOICE MAKER + GEMINI AI PROMPT ENGINEERING */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="billing-maker-title"
        >
          <div className="w-full max-w-5xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[94vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 id="billing-maker-title" className="text-base font-semibold text-slate-900">
                  {editingDoc
                    ? `Edit ${BILLING_DOC_TYPE_LABELS[docType]} · ${editingDoc.docNumber}`
                    : `${BILLING_DOC_TYPE_LABELS[docType]} Maker`}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Auto-saves to database with sequential numbering, GST calculation &amp; A4 PDF output
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close billing document maker"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDocument} className="p-6 space-y-5 overflow-y-auto">
              {saveError && (
                <div className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
                  {saveError}
                </div>
              )}

              {/* Document Type Selector + Doc Number + Dates */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-4">
                  <span className="block text-xs font-medium text-slate-700 mb-1">Document Type</span>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
                    {(
                      [
                        { id: 'quotation', label: 'Quote' },
                        { id: 'invoice', label: 'Invoice' },
                        { id: 'tax_invoice', label: 'Tax Inv' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleDocTypeSwitch(opt.id)}
                        className={`py-1.5 text-xs font-semibold rounded transition-colors ${
                          docType === opt.id
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-3">
                  <label htmlFor="bill-doc-number" className="block text-xs font-medium text-slate-700 mb-1">
                    Document Number *
                  </label>
                  <input
                    id="bill-doc-number"
                    type="text"
                    required
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono font-semibold border border-slate-300 rounded-md"
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="bill-issue-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Issue Date *
                  </label>
                  <input
                    id="bill-issue-date"
                    type="date"
                    required
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>

                <div className="md:col-span-3">
                  <label htmlFor="bill-due-date" className="block text-xs font-medium text-slate-700 mb-1">
                    {docType === 'quotation' ? 'Valid Until Date' : 'Payment Due Date'}
                  </label>
                  <input
                    id="bill-due-date"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              {/* Project, Tower & Client Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-md">
                <div>
                  <label htmlFor="bill-project" className="block text-xs font-medium text-slate-700 mb-1">
                    Linked Project (Organizer)
                  </label>
                  <select
                    id="bill-project"
                    value={projectId}
                    onChange={(e) => handleProjectSelect(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    <option value="">General / Unlinked</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="bill-tower" className="block text-xs font-medium text-slate-700 mb-1">
                    Specific Tower (Optional)
                  </label>
                  <select
                    id="bill-tower"
                    value={towerId}
                    onChange={(e) => setTowerId(e.target.value)}
                    disabled={!projectId}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md disabled:opacity-50"
                  >
                    <option value="">All / Whole Project</option>
                    {towers
                      .filter((t) => t.projectId === projectId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="bill-client-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Client / Builder Name *
                  </label>
                  <input
                    id="bill-client-name"
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="e.g. Skyline Builders Pvt Ltd"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label htmlFor="bill-client-gstin" className="block text-xs font-medium text-slate-700 mb-1">
                    Client GSTIN
                  </label>
                  <input
                    id="bill-client-gstin"
                    type="text"
                    value={clientGstin}
                    onChange={(e) => setClientGstin(e.target.value.toUpperCase())}
                    placeholder="e.g. 36AABCS1429B1Z5"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label htmlFor="bill-client-phone" className="block text-xs font-medium text-slate-700 mb-1">
                    Client WhatsApp / Phone
                  </label>
                  <input
                    id="bill-client-phone"
                    type="text"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="e.g. 9848011223"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label htmlFor="bill-client-email" className="block text-xs font-medium text-slate-700 mb-1">
                    Client Email (for Mail Send)
                  </label>
                  <input
                    id="bill-client-email"
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="accounts@client.com"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label htmlFor="bill-tax-mode" className="block text-xs font-medium text-slate-700 mb-1">
                    GST Tax Scheme
                  </label>
                  <select
                    id="bill-tax-mode"
                    value={taxMode}
                    onChange={(e) => setTaxMode(e.target.value as BillingTaxMode)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    <option value="cgst_sgst">CGST + SGST (Intra-State)</option>
                    <option value="igst">IGST (Inter-State)</option>
                    <option value="none">No Tax / Exempt</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="bill-pos" className="block text-xs font-medium text-slate-700 mb-1">
                    Place of Supply
                  </label>
                  <input
                    id="bill-pos"
                    type="text"
                    value={placeOfSupply}
                    onChange={(e) => setPlaceOfSupply(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-4">
                  <label htmlFor="bill-client-addr" className="block text-xs font-medium text-slate-700 mb-1">
                    Client Billing Address
                  </label>
                  <input
                    id="bill-client-addr"
                    type="text"
                    value={clientAddress}
                    onChange={(e) => setClientAddress(e.target.value)}
                    placeholder="Site / Registered office address"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              {/* Gemini AI Prompt Engineering Box */}
              <div className="p-4 bg-orange-50/60 border border-orange-200 rounded-md space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-950">
                    <Sparkles className="w-4 h-4 text-orange-700" aria-hidden="true" />
                    <span>Gemini AI Prompt Engineer — Auto-Draft BOQ &amp; Tax Line Items</span>
                  </div>
                  <button
                    type="button"
                    onClick={handlePrefillPromptFromSite}
                    className="px-2.5 py-1 text-[11px] font-semibold text-orange-800 bg-white border border-orange-300 rounded hover:bg-orange-100"
                  >
                    Auto-fill Prompt from Project/Tower Sq.Ft
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <textarea
                    rows={2}
                    aria-label="Prompt Gemini AI to generate quotation or invoice line items"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Describe scope, e.g.: '12 floors in Tower A vitrified flooring 6500 sqft @ ₹48, bathroom dado 2400 sqft @ ₹62, 12 granite kitchen counters, waterproofing & acid cleaning, 18% GST'"
                    className="flex-1 px-3 py-2 text-xs bg-white border border-orange-200 rounded-md focus:outline-none focus:border-orange-600"
                  />
                  <button
                    type="button"
                    disabled={aiDrafting}
                    onClick={handleDraftItemsWithGemini}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 self-stretch sm:self-auto"
                  >
                    {aiDrafting ? 'Drafting BOQ...' : 'Draft Items with Gemini'}
                  </button>
                </div>

                {aiError && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded">
                    {aiError}
                  </div>
                )}
              </div>

              {/* Line Items Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                    BOQ Work Line Items ({lineRows.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      setLineRows((prev) => [
                        ...prev,
                        createEmptyLineRow(taxMode === 'none' ? '0' : '18'),
                      ])
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Add Line Item</span>
                  </button>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-md">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <th className="py-2 px-2.5">Description *</th>
                        <th className="py-2 px-2 w-24">HSN/SAC</th>
                        <th className="py-2 px-2 w-20 text-right">Qty</th>
                        <th className="py-2 px-2 w-24">Unit</th>
                        <th className="py-2 px-2 w-24 text-right">Rate (₹)</th>
                        <th className="py-2 px-2 w-20 text-right">GST%</th>
                        <th className="py-2 px-2.5 w-28 text-right">Line Total</th>
                        <th className="py-2 px-2 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lineRows.map((row, idx) => {
                        const computed = liveDraftTotals.items[idx];
                        return (
                          <tr key={row.id}>
                            <td className="p-1.5 min-w-[210px]">
                              <input
                                type="text"
                                aria-label={`Line ${idx + 1} work description`}
                                value={row.description}
                                onChange={(e) =>
                                  setLineRows((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id ? { ...r, description: e.target.value } : r
                                    )
                                  )
                                }
                                placeholder="e.g. Vitrified Floor Tiling (800x800mm)"
                                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="text"
                                aria-label={`Line ${idx + 1} HSN or SAC code`}
                                value={row.hsnSac}
                                onChange={(e) =>
                                  setLineRows((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id ? { ...r, hsnSac: e.target.value } : r
                                    )
                                  )
                                }
                                className="w-full px-2 py-1.5 text-xs font-mono border border-slate-300 rounded"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                aria-label={`Line ${idx + 1} quantity`}
                                value={row.quantity}
                                onChange={(e) =>
                                  setLineRows((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id ? { ...r, quantity: e.target.value } : r
                                    )
                                  )
                                }
                                className="w-full px-2 py-1.5 text-xs font-mono text-right border border-slate-300 rounded"
                              />
                            </td>
                            <td className="p-1.5">
                              <select
                                aria-label={`Line ${idx + 1} unit`}
                                value={row.unit}
                                onChange={(e) =>
                                  setLineRows((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id ? { ...r, unit: e.target.value } : r
                                    )
                                  )
                                }
                                className="w-full px-1.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                              >
                                <option value="Sq.Ft">Sq.Ft</option>
                                <option value="R.Ft">R.Ft</option>
                                <option value="Nos">Nos</option>
                                <option value="Bag">Bag</option>
                                <option value="Lump Sum">Lump Sum</option>
                              </select>
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                aria-label={`Line ${idx + 1} rate`}
                                value={row.rate}
                                onChange={(e) =>
                                  setLineRows((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id ? { ...r, rate: e.target.value } : r
                                    )
                                  )
                                }
                                className="w-full px-2 py-1.5 text-xs font-mono text-right border border-slate-300 rounded"
                              />
                            </td>
                            <td className="p-1.5">
                              <select
                                aria-label={`Line ${idx + 1} GST percent`}
                                disabled={taxMode === 'none'}
                                value={taxMode === 'none' ? '0' : row.gstRate}
                                onChange={(e) =>
                                  setLineRows((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id ? { ...r, gstRate: e.target.value } : r
                                    )
                                  )
                                }
                                className="w-full px-1.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded disabled:opacity-50"
                              >
                                <option value="0">0%</option>
                                <option value="5">5%</option>
                                <option value="12">12%</option>
                                <option value="18">18%</option>
                                <option value="28">28%</option>
                              </select>
                            </td>
                            <td className="p-1.5 px-2.5 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                              {formatBillingCurrency(computed?.lineTotal || 0)}
                            </td>
                            <td className="p-1.5 text-center">
                              {lineRows.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLineRows((prev) => prev.filter((r) => r.id !== row.id))
                                  }
                                  aria-label={`Remove line item ${idx + 1}`}
                                  className="p-1 text-slate-400 hover:text-red-700"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Custom Background Letterhead Option */}
              <div
                data-testid="billing-letterhead-section"
                className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-900 cursor-pointer">
                    <input
                      id="bill-use-custom-letterhead"
                      type="checkbox"
                      checked={useCustomLetterhead}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setUseCustomLetterhead(checked);
                        if (checked && !letterheadBgDataUrl && companyProfile.quotationLetterheadBgDataUrl) {
                          setLetterheadBgDataUrl(companyProfile.quotationLetterheadBgDataUrl);
                        }
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-orange-700"
                    />
                    <span>Use Custom Background Letterhead (Print &amp; PDF)</span>
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">
                    {useCustomLetterhead ? 'Active on A4 Print & PDF' : 'Standard Header Only'}
                  </span>
                </div>

                {useCustomLetterhead && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-2 border-t border-slate-200">
                    <div className="w-16 h-22 rounded border border-slate-300 bg-white flex items-center justify-center overflow-hidden shrink-0">
                      {letterheadBgDataUrl || companyProfile.quotationLetterheadBgDataUrl ? (
                        <img
                          src={letterheadBgDataUrl || companyProfile.quotationLetterheadBgDataUrl}
                          alt="Document Letterhead Preview"
                          className={`w-full h-full object-cover ${
                            letterheadBgOpacity <= 0.15
                              ? 'opacity-15'
                              : letterheadBgOpacity <= 0.3
                                ? 'opacity-25'
                                : letterheadBgOpacity <= 0.5
                                  ? 'opacity-40'
                                  : letterheadBgOpacity <= 0.75
                                    ? 'opacity-70'
                                    : 'opacity-90'
                          }`}
                        />
                      ) : (
                        <span className="text-[10px] text-slate-400 text-center px-1">No BG</span>
                      )}
                    </div>

                    <div className="flex-1 space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer">
                          <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>
                            {letterheadBgDataUrl ? 'Replace Background' : 'Upload Background Image'}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            data-testid="bill-letterhead-upload"
                            onChange={handleUploadLetterheadBg}
                            className="sr-only"
                          />
                        </label>
                        {companyProfile.quotationLetterheadBgDataUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              setLetterheadBgDataUrl(companyProfile.quotationLetterheadBgDataUrl || '');
                              setLetterheadBgOpacity(
                                typeof companyProfile.quotationLetterheadOpacity === 'number'
                                  ? companyProfile.quotationLetterheadOpacity
                                  : 0.14
                              );
                            }}
                            className="px-2.5 py-1.5 text-xs font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100"
                          >
                            Use Company Default
                          </button>
                        )}
                        {letterheadBgDataUrl && (
                          <button
                            type="button"
                            onClick={() => setLetterheadBgDataUrl('')}
                            className="px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50"
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                        <div>
                          <div className="flex items-center justify-between text-[11px] text-slate-700 mb-1">
                            <label htmlFor="bill-letterhead-opacity" className="font-medium">
                              Watermark / Letterhead Opacity
                            </label>
                            <span className="font-mono font-semibold text-slate-900">
                              {Math.round(letterheadBgOpacity * 100)}%
                            </span>
                          </div>
                          <input
                            id="bill-letterhead-opacity"
                            type="range"
                            min="0.05"
                            max="1"
                            step="0.05"
                            value={letterheadBgOpacity}
                            onChange={(e) => setLetterheadBgOpacity(Number(e.target.value) || 0.14)}
                            className="w-full accent-orange-700"
                          />
                        </div>

                        <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                          <input
                            id="bill-hide-default-header"
                            type="checkbox"
                            checked={hideDefaultHeader}
                            onChange={(e) => setHideDefaultHeader(e.target.checked)}
                            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-700"
                          />
                          <span>
                            Hide default top company banner (use pre-printed header in image)
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Notes, Status, Paid & Totals Summary */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                <div className="lg:col-span-7 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="bill-status" className="block text-xs font-medium text-slate-700 mb-1">
                        Document Status
                      </label>
                      <select
                        id="bill-status"
                        value={status}
                        onChange={(e) => setStatus(e.target.value as BillingDocStatus)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                      >
                        <option value="draft">Draft</option>
                        <option value="issued">Issued</option>
                        <option value="sent">Sent to Client</option>
                        <option value="paid">Paid in Full</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="bill-paid" className="block text-xs font-medium text-slate-700 mb-1">
                        Amount Received / Paid (₹)
                      </label>
                      <input
                        id="bill-paid"
                        type="number"
                        min="0"
                        value={status === 'paid' ? String(liveDraftTotals.grandTotal) : amountPaid}
                        disabled={status === 'paid'}
                        onChange={(e) => setAmountPaid(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md disabled:bg-slate-100"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="bill-notes" className="block text-xs font-medium text-slate-700 mb-1">
                      Site / Work Notes
                    </label>
                    <input
                      id="bill-notes"
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Joint measurement reference, floor range, material brand..."
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                    />
                  </div>

                  <div>
                    <label htmlFor="bill-terms" className="block text-xs font-medium text-slate-700 mb-1">
                      Terms &amp; Conditions
                    </label>
                    <textarea
                      id="bill-terms"
                      rows={3}
                      value={terms}
                      onChange={(e) => setTerms(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                    />
                  </div>
                </div>

                <div className="lg:col-span-5 p-4 bg-slate-50 border border-slate-200 rounded-md space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Taxable Subtotal</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {formatBillingCurrency(liveDraftTotals.subtotal)}
                    </span>
                  </div>
                  {taxMode === 'cgst_sgst' && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-600">CGST</span>
                        <span className="font-mono text-slate-800">
                          {formatBillingCurrency(liveDraftTotals.cgstTotal)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">SGST</span>
                        <span className="font-mono text-slate-800">
                          {formatBillingCurrency(liveDraftTotals.sgstTotal)}
                        </span>
                      </div>
                    </>
                  )}
                  {taxMode === 'igst' && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">IGST</span>
                      <span className="font-mono text-slate-800">
                        {formatBillingCurrency(liveDraftTotals.igstTotal)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-600">Round Off</span>
                    <span className="font-mono text-slate-600">
                      ₹{liveDraftTotals.roundOff.toFixed(2)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-300 flex justify-between items-baseline">
                    <span className="text-sm font-bold text-slate-900">Grand Total</span>
                    <span className="text-lg font-mono font-bold text-orange-700">
                      {formatBillingCurrency(liveDraftTotals.grandTotal)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 pt-1">
                    {formatAmountInWordsINR(liveDraftTotals.grandTotal)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleOpenDraftPrintPreview}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-300 rounded-md hover:bg-slate-100"
                >
                  <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Print Preview (A4 Vertical)</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saveBusy}
                    className="px-5 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                  >
                    {saveBusy
                      ? 'Saving...'
                      : editingDoc
                        ? `Update ${BILLING_DOC_TYPE_LABELS[docType]}`
                        : `Save ${BILLING_DOC_TYPE_LABELS[docType]}`}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {printPreviewDoc && (
        <PrintPreviewOverlay
          open={Boolean(printPreviewDoc)}
          mode="invoice_a4"
          title={`${BILLING_DOC_TYPE_LABELS[printPreviewDoc.docType]} Print Preview — ${printPreviewDoc.docNumber}`}
          subtitle={`${printPreviewDoc.clientName}${
            printPreviewDoc.projectName ? ` · ${printPreviewDoc.projectName}` : ''
          }`}
          onClose={() => setPrintPreviewDoc(null)}
          onDownloadPdf={() => handleDownloadPdf(printPreviewDoc)}
          downloadPdfLabel="Download A4 PDF"
          renderPrintContent={() => (
            <PrintableInvoiceSheet document={printPreviewDoc} companyProfile={companyProfile} />
          )}
        />
      )}
    </div>
  );
}
