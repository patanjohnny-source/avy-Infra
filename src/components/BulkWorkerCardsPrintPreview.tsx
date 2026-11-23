import React, { useEffect, useMemo, useState } from 'react';
import { Scissors, Wallet } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import type { Employee } from '../types/avy';
import {
  type BulkCardLayout,
  type BulkPaperSize,
  BULK_CARD_LAYOUT_SPECS,
  BULK_PAPER_SPECS,
  buildBulkWorkerCardModels,
  getBulkCardLayoutSpec,
  getBulkPaperSpec,
  paginateBulkWorkerCards,
} from '../utils/bulkWorkerCards';
import { buildBulkWorkerProfileCardsPdfBlob, triggerBlobDownload } from '../utils/idCardPdf';
import { canViewEmployeeFixedSalary } from '../utils/authAccess';
import { PrintPreviewOverlay } from './PrintPreviewOverlay';
import { PrintableBulkWorkerCardsSheet } from './PrintableBulkWorkerCardsSheet';

interface BulkWorkerCardsPrintPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  selectedEmployees: Employee[];
}

const LAYOUT_OPTIONS: BulkCardLayout[] = [
  'profile_attendance_2up',
  'id_grid_4up',
  'id_grid_6up',
];

const PAPER_OPTIONS: BulkPaperSize[] = ['a4', 'letter'];

export function BulkWorkerCardsPrintPreview({
  isOpen,
  onClose,
  selectedEmployees,
}: BulkWorkerCardsPrintPreviewProps) {
  const {
    session,
    companyProfile,
    projects,
    towers,
    deployments,
    assignments,
    attendance,
    advances,
    settlements,
    ensureEmployeeQrPass,
  } = useStore();

  const hideSalary = !canViewEmployeeFixedSalary(session);
  const [paperSize, setPaperSize] = useState<BulkPaperSize>('a4');
  const [layout, setLayout] = useState<BulkCardLayout>('profile_attendance_2up');
  const [yearMonth, setYearMonth] = useState<string>(() => getTodayIso().slice(0, 7));
  const [showCutMarks, setShowCutMarks] = useState(true);
  const [showWageSummary, setShowWageSummary] = useState(true);
  const effectiveShowWageSummary = !hideSalary && showWageSummary;
  const [qrUrlMap, setQrUrlMap] = useState<Record<string, string>>({});
  const [busyPdf, setBusyPdf] = useState(false);

  // Backfill persistent QR tokens for selected workers when opened
  useEffect(() => {
    if (!isOpen || selectedEmployees.length === 0) return;
    let active = true;
    const syncPasses = async () => {
      const next: Record<string, string> = {};
      for (const emp of selectedEmployees) {
        try {
          const res = await ensureEmployeeQrPass(emp.id);
          if (!active) return;
          if (res.scanUrl) next[emp.id] = res.scanUrl;
        } catch {
          // Deterministic fallback remains active in buildBulkWorkerCardModels
        }
      }
      if (active && Object.keys(next).length > 0) {
        setQrUrlMap((prev) => ({ ...prev, ...next }));
      }
    };
    void syncPasses();
    return () => {
      active = false;
    };
  }, [isOpen, selectedEmployees, ensureEmployeeQrPass]);

  const cardModels = useMemo(() => {
    const models = buildBulkWorkerCardModels({
      employees: selectedEmployees,
      company: companyProfile,
      projects,
      towers,
      deployments,
      assignments,
      attendance,
      advances,
      settlements,
      yearMonth,
    });
    return models.map((m) => ({
      ...m,
      scanUrl: qrUrlMap[m.employee.id] || m.scanUrl,
    }));
  }, [
    selectedEmployees,
    companyProfile,
    projects,
    towers,
    deployments,
    assignments,
    attendance,
    advances,
    settlements,
    yearMonth,
    qrUrlMap,
  ]);

  const paperSpec = getBulkPaperSpec(paperSize);
  const layoutSpec = getBulkCardLayoutSpec(layout);
  const pages = useMemo(
    () => paginateBulkWorkerCards(cardModels, layoutSpec.cardsPerPage),
    [cardModels, layoutSpec.cardsPerPage]
  );

  const monthLabel = useMemo(() => {
    const [y, m] = yearMonth.split('-').map(Number);
    if (!y || !m) return yearMonth;
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
    });
  }, [yearMonth]);

  const handleDownloadPdf = async () => {
    if (cardModels.length === 0) return;
    setBusyPdf(true);
    try {
      const { blob, fileName } = await buildBulkWorkerProfileCardsPdfBlob({
        company: companyProfile,
        cards: cardModels,
        paperSize,
        layout,
        monthLabel,
        showCutMarks,
        showWageSummary: effectiveShowWageSummary,
      });
      triggerBlobDownload(blob, fileName);
    } finally {
      setBusyPdf(false);
    }
  };

  const printMode =
    paperSize === 'letter' ? 'bulk_worker_cards_letter' : 'bulk_worker_cards_a4';

  const topControls = (
    <div
      data-testid="bulk-print-config-bar"
      className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-200"
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* Card Format Selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-400">Card Layout:</span>
          <div
            className="inline-flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-700 rounded"
            role="group"
            aria-label="Bulk card layout preset"
          >
            {LAYOUT_OPTIONS.map((opt) => {
              const spec = BULK_CARD_LAYOUT_SPECS[opt];
              const active = layout === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  data-testid={`bulk-layout-${opt}`}
                  onClick={() => setLayout(opt)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-orange-600 text-white'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {spec.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Standard Paper Size Selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-400">Paper Size:</span>
          <div
            className="inline-flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-700 rounded"
            role="group"
            aria-label="Standard paper size"
          >
            {PAPER_OPTIONS.map((p) => {
              const spec = BULK_PAPER_SPECS[p];
              const active = paperSize === p;
              return (
                <button
                  key={p}
                  type="button"
                  data-testid={`bulk-paper-${p}`}
                  onClick={() => setPaperSize(p)}
                  className={`px-2.5 py-1 text-[11px] font-mono font-medium rounded transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-orange-600 text-white font-semibold'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {spec.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Attendance Month */}
        <label className="inline-flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-400">Month:</span>
          <input
            type="month"
            aria-label="Attendance summary month for bulk worker cards"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="px-2 py-1 text-[11px] font-mono bg-slate-900 text-white border border-slate-700 rounded focus:outline-none focus:border-orange-500"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showCutMarks}
            onChange={(e) => setShowCutMarks(e.target.checked)}
            className="rounded border-slate-600 text-orange-600"
          />
          <Scissors className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
          <span className="text-[11px]">Cut Guides</span>
        </label>

        {!hideSalary && (
          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showWageSummary}
              onChange={(e) => setShowWageSummary(e.target.checked)}
              className="rounded border-slate-600 text-orange-600"
            />
            <Wallet className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            <span className="text-[11px]">Wages &amp; Net Bal</span>
          </label>
        )}

        <span
          data-testid="bulk-pagination-summary"
          className="px-2.5 py-1 text-[11px] font-mono tabular-nums bg-slate-900 border border-slate-700 rounded text-orange-200"
        >
          {cardModels.length} Workers · {pages.length} {paperSpec.shortLabel} Page
          {pages.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );

  return (
    <PrintPreviewOverlay
      open={isOpen}
      mode={printMode}
      title={`Bulk Worker Profile Cards (${cardModels.length} Workers)`}
      subtitle={`${companyProfile.companyName} · ${layoutSpec.label} · ${paperSpec.label} · ${monthLabel}`}
      onClose={onClose}
      onDownloadPdf={handleDownloadPdf}
      downloadPdfLabel={`Download ${pages.length}-Page ${paperSpec.shortLabel} PDF`}
      busyPdf={busyPdf}
      topControls={topControls}
      renderPrintContent={() => (
        <PrintableBulkWorkerCardsSheet
          company={companyProfile}
          cards={cardModels}
          paperSize={paperSize}
          layout={layout}
          monthLabel={monthLabel}
          showCutMarks={showCutMarks}
          showWageSummary={effectiveShowWageSummary}
        />
      )}
    />
  );
}
