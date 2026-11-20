import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileDown,
  FolderOpen,
  Maximize2,
  Plus,
  Presentation,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { getTodayIso } from '../data/seedData';
import type {
  AttendanceRecord,
  CompanyDocument,
  CompanyDocumentApprovalStatus,
  CompanyDocumentFormat,
  CompanyProfile,
  Employee,
  FlatUnit,
  Project,
  SiteExpense,
  Tower,
} from '../types/avy';
import {
  SLIDE_THEMES,
  buildPowerPointDocBlob,
  buildPresentationDeckPdfBlob,
  createBlankSlide,
  createLiveProjectDeck,
  type PresentationDeck,
  type PresentationSlide,
  type SlideLayoutKey,
  type SlideThemeKey,
} from '../utils/hrDocuments';
import type { SaveCompanyDocInput } from './HrDocumentsGenerator';

const DECK_STORAGE_KEY = 'avy_presentation_deck_v1';

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

export interface PptSeedDeckPayload {
  nonce: number;
  driveDocId?: string;
  deck: PresentationDeck;
}

interface PresentationDeckBuilderProps {
  company: CompanyProfile;
  projects: Project[];
  towers: Tower[];
  flats: FlatUnit[];
  employees: Employee[];
  attendance: AttendanceRecord[];
  expenses: SiteExpense[];
  seedDeck?: PptSeedDeckPayload | null;
  userDisplayName?: string;
  readOnly?: boolean;
  onSaveToDrive?: (input: SaveCompanyDocInput) => Promise<CompanyDocument>;
  onOpenDriveTab?: () => void;
}

export function PresentationDeckBuilder({
  company,
  projects,
  towers,
  flats,
  employees,
  attendance,
  expenses,
  seedDeck,
  userDisplayName = 'Admin',
  readOnly = false,
  onSaveToDrive,
  onOpenDriveTab,
}: PresentationDeckBuilderProps) {
  const today = getTodayIso();

  const [deck, setDeck] = useState<PresentationDeck>(() => {
    try {
      const raw = localStorage.getItem(DECK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PresentationDeck;
        if (parsed && Array.isArray(parsed.slides) && parsed.slides.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Ignore storage errors
    }
    return createLiveProjectDeck({
      company,
      projects,
      towers,
      flats,
      employees,
      attendance,
      expenses,
      todayIso: today,
    });
  });

  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [presentMode, setPresentMode] = useState(false);
  const [activeDriveDocId, setActiveDriveDocId] = useState<string | undefined>(undefined);
  const [statusNotice, setStatusNotice] = useState('');

  useEffect(() => {
    if (!seedDeck) return;
    setDeck(seedDeck.deck);
    setActiveDriveDocId(seedDeck.driveDocId);
    setActiveSlideIndex(0);
    setStatusNotice(`Loaded "${seedDeck.deck.title}" from Documents Drive.`);
  }, [seedDeck]);

  useEffect(() => {
    try {
      localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(deck));
    } catch {
      // Ignore storage quota issues
    }
  }, [deck]);

  useEffect(() => {
    if (!presentMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresentMode(false);
      else if (e.key === 'ArrowRight' || e.key === ' ') {
        setActiveSlideIndex((idx) => Math.min(deck.slides.length - 1, idx + 1));
      } else if (e.key === 'ArrowLeft') {
        setActiveSlideIndex((idx) => Math.max(0, idx - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [presentMode, deck.slides.length]);

  const safeIndex = Math.max(0, Math.min(activeSlideIndex, deck.slides.length - 1));
  const activeSlide = deck.slides[safeIndex] || deck.slides[0];
  const theme = SLIDE_THEMES[deck.theme] || SLIDE_THEMES.executive_slate;

  const updateSlide = (patch: Partial<PresentationSlide>) => {
    setDeck((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      slides: prev.slides.map((s, idx) => (idx === safeIndex ? { ...s, ...patch } : s)),
    }));
  };

  const handleAddSlide = () => {
    const fresh = createBlankSlide('bullets_metrics');
    setDeck((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      slides: [...prev.slides, fresh],
    }));
    setActiveSlideIndex(deck.slides.length);
  };

  const handleDuplicateSlide = () => {
    if (!activeSlide) return;
    const copy: PresentationSlide = {
      ...activeSlide,
      id: `slide_${Date.now()}`,
      title: `${activeSlide.title} (Copy)`,
      bullets: [...activeSlide.bullets],
      metrics: activeSlide.metrics.map((m) => ({ ...m })),
      secondaryBullets: activeSlide.secondaryBullets ? [...activeSlide.secondaryBullets] : undefined,
    };
    const next = [...deck.slides];
    next.splice(safeIndex + 1, 0, copy);
    setDeck((prev) => ({ ...prev, updatedAt: new Date().toISOString(), slides: next }));
    setActiveSlideIndex(safeIndex + 1);
  };

  const handleDeleteSlide = (idxToRemove: number) => {
    if (deck.slides.length <= 1) return;
    const next = deck.slides.filter((_, idx) => idx !== idxToRemove);
    setDeck((prev) => ({ ...prev, updatedAt: new Date().toISOString(), slides: next }));
    setActiveSlideIndex(Math.max(0, Math.min(safeIndex, next.length - 1)));
  };

  const handleMoveSlide = (dir: -1 | 1) => {
    const target = safeIndex + dir;
    if (target < 0 || target >= deck.slides.length) return;
    const next = [...deck.slides];
    const [moved] = next.splice(safeIndex, 1);
    next.splice(target, 0, moved);
    setDeck((prev) => ({ ...prev, updatedAt: new Date().toISOString(), slides: next }));
    setActiveSlideIndex(target);
  };

  const handleRebuildFromLiveSiteData = () => {
    const fresh = createLiveProjectDeck({
      company,
      projects,
      towers,
      flats,
      employees,
      attendance,
      expenses,
      todayIso: today,
    });
    setActiveDriveDocId(undefined);
    setDeck({ ...fresh, theme: deck.theme });
    setActiveSlideIndex(0);
    setStatusNotice('Synchronized presentation slides with live project, tower, crew & expense figures.');
  };

  const syncDeckToDrive = async (
    approvalStatus: CompanyDocumentApprovalStatus,
    format: CompanyDocumentFormat = 'ppt',
    overrideFileName?: string,
    overrideSizeBytes?: number,
    overrideMime?: string
  ) => {
    if (!onSaveToDrive || readOnly) return null;
    const deckJson = JSON.stringify(deck);
    const slug = (deck.title || 'avy_presentation')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
    const fileName = overrideFileName || `${slug}.${format === 'pdf' ? 'pdf' : 'ppt'}`;
    const mimeType =
      overrideMime ||
      (format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.ms-powerpoint;charset=utf-8');
    const sizeBytes = overrideSizeBytes ?? new Blob([deckJson]).size + 2400;

    const saved = await onSaveToDrive({
      id: activeDriveDocId,
      source: 'ppt_slides',
      docCategory: 'presentation_deck',
      fileFormat: format,
      title: deck.title.trim() || 'Site Operations Briefing Deck',
      fileName,
      mimeType,
      sizeBytes,
      approvalStatus,
      approvedByName: approvalStatus === 'approved' ? userDisplayName : undefined,
      issueDate: today,
      subject: deck.title.trim() || 'Site Operations Briefing',
      plainTextSummary: `${deck.slides.length} slides · ${deck.slides
        .map((s) => s.title)
        .slice(0, 3)
        .join(' | ')}`,
      deckJson,
    });
    setActiveDriveDocId(saved.id);
    return saved;
  };

  const handleSaveDeckToDrive = async () => {
    const saved = await syncDeckToDrive('approved', 'ppt');
    if (saved) {
      setStatusNotice(`Saved presentation deck "${saved.title}" (${deck.slides.length} slides) to Documents Drive.`);
    }
  };

  const handleExportPpt = async () => {
    const { blob, fileName } = buildPowerPointDocBlob({ deck, company });
    triggerDownloadBlob(blob, fileName);
    await syncDeckToDrive(
      'approved',
      'ppt',
      fileName,
      blob.size,
      'application/vnd.ms-powerpoint;charset=utf-8'
    );
    setStatusNotice(`Downloaded PowerPoint (.ppt) deck (${fileName}) & saved to Documents Drive.`);
  };

  const handleExportPdf = async () => {
    const { blob, fileName } = buildPresentationDeckPdfBlob({ deck, company });
    triggerDownloadBlob(blob, fileName);
    await syncDeckToDrive('approved', 'pdf', fileName, blob.size, 'application/pdf');
    setStatusNotice(`Downloaded 16:9 PDF deck (${fileName}) & saved to Documents Drive.`);
  };

  const renderSlideStage = (slide: PresentationSlide, slideIdx: number, isFullscreen = false) => {
    const isTwoCol = slide.layout === 'two_column';
    return (
      <div
        className={`no-dark-invert w-full aspect-[16/9] rounded-lg overflow-hidden border flex flex-col justify-between shadow-lg ${
          isFullscreen ? 'max-w-6xl mx-auto p-8 sm:p-12' : 'p-6 sm:p-8'
        }`}
        style={{
          backgroundColor: theme.bgHex,
          color: theme.textHex,
          borderColor: theme.borderHex,
        }}
      >
        <div className="space-y-4">
          {/* Top Accent Bar & Deck Brand */}
          <div className="flex items-center justify-between text-xs pb-2 border-b" style={{ borderColor: theme.borderHex }}>
            <span className="font-bold tracking-wider uppercase" style={{ color: theme.accentHex }}>
              {company.companyName || 'AVY INFRA'}
            </span>
            <span className="font-mono" style={{ color: theme.mutedHex }}>
              Slide {slideIdx + 1} / {deck.slides.length}
            </span>
          </div>

          {/* Slide Title & Subtitle */}
          <div>
            <h2
              className={`font-display font-bold tracking-tight leading-tight ${
                slide.layout === 'title_cover'
                  ? isFullscreen
                    ? 'text-3xl sm:text-5xl mt-4'
                    : 'text-2xl sm:text-3xl mt-2'
                  : isFullscreen
                    ? 'text-2xl sm:text-3xl'
                    : 'text-lg sm:text-2xl'
              }`}
              style={{ color: theme.textHex }}
            >
              {slide.title || 'Untitled Slide'}
            </h2>
            {slide.subtitle && (
              <p
                className={`mt-1.5 ${isFullscreen ? 'text-base sm:text-lg' : 'text-xs sm:text-sm'}`}
                style={{ color: theme.mutedHex }}
              >
                {slide.subtitle}
              </p>
            )}
          </div>

          {/* KPI Metrics Strip */}
          {slide.metrics.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              {slide.metrics.slice(0, 4).map((m, mIdx) => (
                <div
                  key={mIdx}
                  className="p-3 rounded-md border"
                  style={{
                    backgroundColor: theme.surfaceHex,
                    borderColor: theme.borderHex,
                  }}
                >
                  <div className="text-[11px] truncate" style={{ color: theme.mutedHex }}>
                    {m.label}
                  </div>
                  <div
                    className={`font-display font-bold mt-0.5 truncate ${
                      isFullscreen ? 'text-2xl' : 'text-base sm:text-xl'
                    }`}
                    style={{ color: theme.textHex }}
                  >
                    {m.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Bullets (Single or Two-Column) */}
          <div className={`grid gap-6 pt-1 ${isTwoCol ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            <ul
              className={`space-y-2 list-disc pl-5 ${
                isFullscreen ? 'text-base sm:text-lg' : 'text-xs sm:text-sm'
              }`}
            >
              {slide.bullets
                .filter((b) => b.trim().length > 0)
                .map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
            </ul>

            {isTwoCol && (
              <div
                className="p-3.5 rounded-md border space-y-2"
                style={{
                  backgroundColor: theme.surfaceHex,
                  borderColor: theme.borderHex,
                }}
              >
                {slide.secondaryTitle && (
                  <div
                    className="text-xs font-bold uppercase tracking-wide"
                    style={{ color: theme.accentHex }}
                  >
                    {slide.secondaryTitle}
                  </div>
                )}
                <ul
                  className={`space-y-1.5 list-disc pl-5 ${
                    isFullscreen ? 'text-base' : 'text-xs sm:text-sm'
                  }`}
                >
                  {(slide.secondaryBullets || [])
                    .filter((b) => b.trim().length > 0)
                    .map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Slide Footer */}
        <div
          className="pt-2 border-t flex items-center justify-between text-[11px]"
          style={{ borderColor: theme.borderHex, color: theme.mutedHex }}
        >
          <span>{slide.footerNote || `${company.companyName} · Site Presentation`}</span>
          <span>{company.hrContact}</span>
        </div>
      </div>
    );
  };

  return (
    <div data-testid="presentation-deck-builder" className="space-y-5">
      {/* PowerPoint Top Action Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
            <Presentation className="w-5 h-5 text-orange-700 shrink-0" aria-hidden="true" />
            <input
              type="text"
              aria-label="Presentation deck title"
              value={deck.title}
              onChange={(e) => setDeck((prev) => ({ ...prev, title: e.target.value }))}
              className="px-3 py-1.5 text-sm font-semibold border border-slate-300 rounded-md flex-1 min-w-[260px]"
            />
            <select
              aria-label="Presentation theme"
              value={deck.theme}
              onChange={(e) =>
                setDeck((prev) => ({ ...prev, theme: e.target.value as SlideThemeKey }))
              }
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white shrink-0"
            >
              {(Object.keys(SLIDE_THEMES) as SlideThemeKey[]).map((key) => (
                <option key={key} value={key}>
                  Theme: {SLIDE_THEMES[key].label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRebuildFromLiveSiteData}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sync Live Data</span>
            </button>
            {!readOnly && onSaveToDrive && (
              <button
                type="button"
                data-testid="ppt-save-drive-btn"
                onClick={handleSaveDeckToDrive}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800"
              >
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Save PPT to Drive</span>
              </button>
            )}
            <button
              type="button"
              data-testid="ppt-export-ppt-btn"
              onClick={handleExportPpt}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100"
            >
              <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download PowerPoint (.ppt)</span>
            </button>
            <button
              type="button"
              data-testid="ppt-export-pdf-btn"
              onClick={handleExportPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export 16:9 PDF</span>
            </button>
            <button
              type="button"
              data-testid="ppt-present-btn"
              onClick={() => setPresentMode(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
            >
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Present Slideshow</span>
            </button>
          </div>
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

      {/* Main PowerPoint 3-Pane Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Slide Sorter Strip */}
        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-lg p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
              Slides ({deck.slides.length})
            </h3>
            <button
              type="button"
              data-testid="ppt-add-slide-btn"
              onClick={handleAddSlide}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-orange-700 rounded hover:bg-orange-800"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Slide</span>
            </button>
          </div>

          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-0.5">
            {deck.slides.map((s, idx) => {
              const selected = idx === safeIndex;
              return (
                <div
                  key={s.id}
                  className={`p-2.5 rounded-md border transition-colors ${
                    selected
                      ? 'border-orange-600 bg-orange-50'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveSlideIndex(idx)}
                    className="w-full text-left space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono font-bold text-slate-700">#{idx + 1}</span>
                      <span className="text-[10px] text-slate-500 capitalize">
                        {s.layout.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {s.title || 'Untitled Slide'}
                    </div>
                  </button>
                  <div className="mt-2 pt-1.5 border-t border-slate-200 flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!selected || idx === 0}
                        onClick={() => handleMoveSlide(-1)}
                        aria-label={`Move slide ${idx + 1} up`}
                        className="p-1 text-slate-600 hover:text-slate-900 disabled:opacity-30"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={!selected || idx === deck.slides.length - 1}
                        onClick={() => handleMoveSlide(1)}
                        aria-label={`Move slide ${idx + 1} down`}
                        className="p-1 text-slate-600 hover:text-slate-900 disabled:opacity-30"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveSlideIndex(idx);
                          handleDuplicateSlide();
                        }}
                        aria-label={`Duplicate slide ${idx + 1}`}
                        className="p-1 text-slate-600 hover:text-slate-900"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={deck.slides.length <= 1}
                      onClick={() => handleDeleteSlide(idx)}
                      aria-label={`Delete slide ${idx + 1}`}
                      className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-30"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center + Bottom: Live 16:9 Stage & Slide Content Editor */}
        <div className="lg:col-span-9 space-y-4">
          {activeSlide && renderSlideStage(activeSlide, safeIndex, false)}

          {activeSlide && (
            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-900">
                  Edit Slide #{safeIndex + 1}
                </h3>
                <div className="flex items-center gap-2 text-xs">
                  <label htmlFor="ppt-slide-layout" className="font-medium text-slate-600">
                    Layout:
                  </label>
                  <select
                    id="ppt-slide-layout"
                    value={activeSlide.layout}
                    onChange={(e) => updateSlide({ layout: e.target.value as SlideLayoutKey })}
                    className="px-2.5 py-1 border border-slate-300 rounded bg-white"
                  >
                    <option value="title_cover">Title Cover + Highlights</option>
                    <option value="bullets_metrics">Key Metrics + Bullet List</option>
                    <option value="two_column">Two-Column Comparison</option>
                    <option value="project_summary">Project Summary</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-3">
                  <div>
                    <label htmlFor="ppt-slide-title" className="block font-medium text-slate-700 mb-1">
                      Slide Headline
                    </label>
                    <input
                      id="ppt-slide-title"
                      type="text"
                      value={activeSlide.title}
                      onChange={(e) => updateSlide({ title: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label htmlFor="ppt-slide-sub" className="block font-medium text-slate-700 mb-1">
                      Subtitle / Context
                    </label>
                    <input
                      id="ppt-slide-sub"
                      type="text"
                      value={activeSlide.subtitle}
                      onChange={(e) => updateSlide({ subtitle: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label htmlFor="ppt-slide-bullets" className="block font-medium text-slate-700 mb-1">
                      Main Bullet Points (one per line)
                    </label>
                    <textarea
                      id="ppt-slide-bullets"
                      rows={4}
                      value={activeSlide.bullets.join('\n')}
                      onChange={(e) => updateSlide({ bullets: e.target.value.split('\n') })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-slate-700">KPI Cards (max 4)</span>
                      <button
                        type="button"
                        onClick={() =>
                          updateSlide({
                            metrics: [
                              ...activeSlide.metrics.slice(0, 3),
                              { label: 'New Metric', value: '0' },
                            ],
                          })
                        }
                        className="text-[11px] font-semibold text-orange-700 hover:underline"
                      >
                        + Add KPI
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {activeSlide.metrics.map((m, mIdx) => (
                        <div key={mIdx} className="flex items-center gap-2">
                          <input
                            type="text"
                            aria-label={`KPI ${mIdx + 1} label`}
                            value={m.label}
                            onChange={(e) => {
                              const next = [...activeSlide.metrics];
                              next[mIdx] = { ...next[mIdx], label: e.target.value };
                              updateSlide({ metrics: next });
                            }}
                            placeholder="Label"
                            className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded"
                          />
                          <input
                            type="text"
                            aria-label={`KPI ${mIdx + 1} value`}
                            value={m.value}
                            onChange={(e) => {
                              const next = [...activeSlide.metrics];
                              next[mIdx] = { ...next[mIdx], value: e.target.value };
                              updateSlide({ metrics: next });
                            }}
                            placeholder="Value"
                            className="w-28 px-2.5 py-1.5 font-mono font-semibold border border-slate-300 rounded"
                          />
                          <button
                            type="button"
                            aria-label={`Remove KPI ${mIdx + 1}`}
                            onClick={() =>
                              updateSlide({
                                metrics: activeSlide.metrics.filter((_, idx) => idx !== mIdx),
                              })
                            }
                            className="p-1 text-slate-400 hover:text-red-600"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {activeSlide.layout === 'two_column' && (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <label htmlFor="ppt-sec-title" className="block font-medium text-slate-700">
                        Right Column Heading &amp; Bullets
                      </label>
                      <input
                        id="ppt-sec-title"
                        type="text"
                        value={activeSlide.secondaryTitle || ''}
                        onChange={(e) => updateSlide({ secondaryTitle: e.target.value })}
                        placeholder="Right column heading"
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                      />
                      <textarea
                        rows={3}
                        value={(activeSlide.secondaryBullets || []).join('\n')}
                        onChange={(e) =>
                          updateSlide({ secondaryBullets: e.target.value.split('\n') })
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-md"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full-Screen Slideshow Presentation Modal */}
      {presentMode && activeSlide && (
        <div
          data-testid="ppt-fullscreen-slideshow"
          className="fixed inset-0 z-[80] bg-slate-950/95 flex flex-col justify-between p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Presentation slideshow mode"
        >
          <div className="flex items-center justify-between text-slate-200 text-xs">
            <span className="font-semibold truncate">{deck.title}</span>
            <button
              type="button"
              onClick={() => setPresentMode(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-md border border-slate-700"
            >
              <X className="w-3.5 h-3.5" />
              <span>Exit Slideshow (Esc)</span>
            </button>
          </div>

          <div className="flex-1 flex items-center justify-center py-4">
            {renderSlideStage(activeSlide, safeIndex, true)}
          </div>

          <div className="flex items-center justify-center gap-4 text-xs text-slate-200">
            <button
              type="button"
              disabled={safeIndex === 0}
              onClick={() => setActiveSlideIndex((i) => Math.max(0, i - 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>
            <span className="font-mono">
              {safeIndex + 1} / {deck.slides.length}
            </span>
            <button
              type="button"
              disabled={safeIndex >= deck.slides.length - 1}
              onClick={() =>
                setActiveSlideIndex((i) => Math.min(deck.slides.length - 1, i + 1))
              }
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 disabled:opacity-40"
            >
              <span>Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
