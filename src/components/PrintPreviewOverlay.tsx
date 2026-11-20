import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Lock, Printer, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  type IdCardPrintSides,
  type PrintOverlayMode,
  buildIsolatedPageRuleCss,
  getPrintDimensionSpec,
  getScaledPreviewDimensionsPx,
  resolvePreviewZoomPercent,
} from '../utils/printLayout';

interface PrintPreviewOverlayProps {
  open: boolean;
  mode: PrintOverlayMode;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onDownloadPdf?: () => void | Promise<void>;
  downloadPdfLabel?: string;
  busyPdf?: boolean;
  idCardSideControls?: {
    sides: IdCardPrintSides;
    onChangeSides: (sides: IdCardPrintSides) => void;
  };
  topControls?: React.ReactNode;
  renderPrintContent: () => React.ReactNode;
}

const ZOOM_PRESETS = [75, 100, 125, 150] as const;

export function PrintPreviewOverlay({
  open,
  mode,
  title,
  subtitle,
  onClose,
  onDownloadPdf,
  downloadPdfLabel = 'Download Exact PDF',
  busyPdf = false,
  idCardSideControls,
  topControls,
  renderPrintContent,
}: PrintPreviewOverlayProps) {
  const spec = getPrintDimensionSpec(mode);
  const [previewZoom, setPreviewZoom] = useState<number>(mode === 'id_card_cr80' ? 125 : 75);
  const [printStatusNotice, setPrintStatusNotice] = useState('');

  useEffect(() => {
    setPreviewZoom(mode === 'id_card_cr80' ? 125 : 75);
    setPrintStatusNotice('');
  }, [mode, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    const cleanup = () => {
      document.body.classList.remove('printing-isolated-id-card', 'printing-isolated-invoice');
      const styleEl = document.getElementById('avy-isolated-print-page-style');
      if (styleEl) styleEl.remove();
    };
    window.addEventListener('afterprint', cleanup);
    return () => {
      window.removeEventListener('afterprint', cleanup);
      cleanup();
    };
  }, []);

  if (!open) return null;

  const scale = resolvePreviewZoomPercent(previewZoom) / 100;
  const scaledDims = getScaledPreviewDimensionsPx(mode, previewZoom);

  const handlePrintNow = () => {
    setPrintStatusNotice('');
    let styleEl = document.getElementById(
      'avy-isolated-print-page-style'
    ) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'avy-isolated-print-page-style';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = buildIsolatedPageRuleCss(mode);

    document.body.classList.remove('printing-isolated-id-card', 'printing-isolated-invoice');
    document.body.classList.add(spec.bodyClassName);

    setTimeout(() => {
      try {
        window.print();
      } catch {
        // Sandboxed preview frames may suppress print dialog; PDF fallback remains available
      }
      setPrintStatusNotice(
        mode === 'id_card_cr80'
          ? 'Print job sent at locked Vertical CR80 dimensions (54mm × 86mm, Scale 100%). In your browser print dialog, ensure Scale is "Actual size / 100%" and Margins is "None".'
          : `Print job sent at locked ${spec.label} dimensions (${spec.widthMm}mm × ${spec.heightMm}mm, Portrait). Use "Download Exact PDF" anytime for offline printing.`
      );
      setTimeout(() => {
        document.body.classList.remove('printing-isolated-id-card', 'printing-isolated-invoice');
        const el = document.getElementById('avy-isolated-print-page-style');
        if (el) el.remove();
      }, 1500);
    }, 60);
  };

  const printPortal = (
    <div
      id="avy-isolated-print-root"
      data-print-mode={mode}
      className="hidden print:block"
    >
      {renderPrintContent()}
    </div>
  );

  const overlayDialog = (
    <div
      data-testid="dedicated-print-preview-overlay"
      data-print-mode={mode}
      data-orientation={spec.orientation}
      className="no-print fixed inset-0 !m-0 z-[70] bg-slate-950 text-slate-100 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-preview-overlay-title"
    >
        {/* Top Calibration & Action Toolbar */}
        <header className="px-4 sm:px-6 py-3 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="print-preview-overlay-title"
                className="text-sm sm:text-base font-semibold text-white truncate"
              >
                {title}
              </h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono font-semibold bg-orange-900/60 text-orange-200 border border-orange-700/70 rounded">
                <Lock className="w-3 h-3" aria-hidden="true" />
                <span>{spec.label}</span>
              </span>
              <span className="px-2 py-0.5 text-[11px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800 rounded">
                Print Scale: 100% Locked
              </span>
            </div>
            {subtitle && (
              <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* ID Card Side Filter */}
            {mode === 'id_card_cr80' && idCardSideControls && (
              <div
                className="inline-flex items-center gap-1 p-1 bg-slate-800 border border-slate-700 rounded"
                role="group"
                aria-label="ID card print sides"
              >
                {[
                  { id: 'both' as const, label: 'Front & Back (2p)' },
                  { id: 'front' as const, label: 'Front Only' },
                  { id: 'back' as const, label: 'Back Only' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => idCardSideControls.onChangeSides(opt.id)}
                    className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                      idCardSideControls.sides === opt.id
                        ? 'bg-orange-600 text-white'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* On-Screen Zoom Controls (never affects physical print size) */}
            <div
              className="inline-flex items-center gap-1 p-1 bg-slate-800 border border-slate-700 rounded"
              aria-label="On-screen preview zoom"
            >
              <button
                type="button"
                onClick={() => setPreviewZoom((z) => resolvePreviewZoomPercent(z - 25))}
                aria-label="Zoom out preview"
                className="p-1 text-slate-300 hover:text-white rounded hover:bg-slate-700"
              >
                <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              {ZOOM_PRESETS.map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setPreviewZoom(z)}
                  className={`px-1.5 py-0.5 text-[11px] font-mono rounded ${
                    previewZoom === z
                      ? 'bg-slate-100 text-slate-900 font-semibold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {z}%
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPreviewZoom((z) => resolvePreviewZoomPercent(z + 25))}
                aria-label="Zoom in preview"
                className="p-1 text-slate-300 hover:text-white rounded hover:bg-slate-700"
              >
                <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            {onDownloadPdf && (
              <button
                type="button"
                disabled={busyPdf}
                onClick={onDownloadPdf}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-900 bg-slate-100 rounded hover:bg-white disabled:opacity-50 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{busyPdf ? 'Building PDF...' : downloadPdfLabel}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handlePrintNow}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded hover:bg-orange-500 whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Print Now (Exact Size)</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close print preview overlay"
              className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Guidance Strip */}
        <div className="px-4 sm:px-6 py-2 bg-slate-900/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300 shrink-0">
          <span>
            Isolated vertical print canvas · Screen preview zoom ({previewZoom}%) does not alter physical print dimensions ({spec.widthMm}mm × {spec.heightMm}mm).
          </span>
          <span className="font-mono text-slate-400">
            Recommended browser print settings: Scale = 100% (Actual Size) · Portrait · Margins = {spec.marginMm === 0 ? 'None' : `${spec.marginMm}mm`}
          </span>
        </div>

        {topControls && (
          <div className="px-4 sm:px-6 py-2.5 bg-slate-800/90 border-b border-slate-700 shrink-0">
            {topControls}
          </div>
        )}

        {printStatusNotice && (
          <div
            role="status"
            className="mx-4 sm:mx-6 mt-3 px-4 py-2.5 text-xs text-emerald-100 bg-emerald-950/90 border border-emerald-700 rounded shrink-0"
          >
            {printStatusNotice}
          </div>
        )}

        {/* Isolated Print-Preview Stage */}
        <div className="flex-1 overflow-auto p-6 sm:p-10 flex flex-col items-center justify-start">
          {mode === 'id_card_cr80' ? (
            <div
              data-testid="isolated-print-stage"
              className="flex flex-wrap items-start justify-center gap-8"
              style={{
                transform: `scale(${scale})`,
                transformOrigin: 'top center',
                marginBottom: `${Math.max(0, (scale - 1) * 326)}px`,
              }}
            >
              {renderPrintContent()}
            </div>
          ) : (
            <div
              data-testid="isolated-print-stage"
              style={{
                width: `${scaledDims.widthPx}px`,
                minHeight: `${scaledDims.heightPx}px`,
              }}
              className="shrink-0"
            >
              <div
                style={{
                  width: `${spec.widthMm - spec.marginMm * 2}mm`,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                {renderPrintContent()}
              </div>
            </div>
          )}
        </div>
      </div>
  );

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {printPortal}
      {overlayDialog}
    </>,
    document.body
  );
}
