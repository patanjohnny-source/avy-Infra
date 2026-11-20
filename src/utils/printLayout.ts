export type PrintOverlayMode =
  | 'id_card_cr80'
  | 'invoice_a4'
  | 'report_a4'
  | 'attendance_card_a4'
  | 'bulk_worker_cards_a4'
  | 'bulk_worker_cards_letter';

export type IdCardPrintSides = 'both' | 'front' | 'back';

export interface PrintDimensionSpec {
  mode: PrintOverlayMode;
  widthMm: number;
  heightMm: number;
  marginMm: number;
  orientation: 'portrait';
  label: string;
  bodyClassName: string;
}

export const CR80_PORTRAIT_SPEC: PrintDimensionSpec = {
  mode: 'id_card_cr80',
  widthMm: 54,
  heightMm: 86,
  marginMm: 0,
  orientation: 'portrait',
  label: 'CR80 Vertical (54mm × 86mm)',
  bodyClassName: 'printing-isolated-id-card',
};

export const A4_PORTRAIT_SPEC: PrintDimensionSpec = {
  mode: 'invoice_a4',
  widthMm: 210,
  heightMm: 297,
  marginMm: 8,
  orientation: 'portrait',
  label: 'A4 Vertical (210mm × 297mm)',
  bodyClassName: 'printing-isolated-invoice',
};

export const LETTER_PORTRAIT_SPEC: PrintDimensionSpec = {
  mode: 'bulk_worker_cards_letter',
  widthMm: 215.9,
  heightMm: 279.4,
  marginMm: 8,
  orientation: 'portrait',
  label: 'US Letter (8.5" × 11")',
  bodyClassName: 'printing-isolated-invoice',
};

export function getPrintDimensionSpec(mode: PrintOverlayMode): PrintDimensionSpec {
  if (mode === 'id_card_cr80') return CR80_PORTRAIT_SPEC;
  if (mode === 'report_a4') {
    return {
      ...A4_PORTRAIT_SPEC,
      mode: 'report_a4',
      label: 'A4 Report Portrait (210mm × 297mm)',
    };
  }
  if (mode === 'attendance_card_a4') {
    return {
      ...A4_PORTRAIT_SPEC,
      mode: 'attendance_card_a4',
      label: 'A4 Attendance Card (210mm × 297mm)',
    };
  }
  if (mode === 'bulk_worker_cards_a4') {
    return {
      ...A4_PORTRAIT_SPEC,
      mode: 'bulk_worker_cards_a4',
      label: 'A4 Bulk Cards (210mm × 297mm)',
    };
  }
  if (mode === 'bulk_worker_cards_letter') {
    return LETTER_PORTRAIT_SPEC;
  }
  return A4_PORTRAIT_SPEC;
}

export function buildIsolatedPageRuleCss(mode: PrintOverlayMode): string {
  const spec = getPrintDimensionSpec(mode);
  if (mode === 'id_card_cr80') {
    return [
      `@page { size: ${spec.widthMm}mm ${spec.heightMm}mm portrait; margin: ${spec.marginMm}mm; }`,
      `@media print {`,
      `  html, body { width: ${spec.widthMm}mm !important; min-width: ${spec.widthMm}mm !important; max-width: ${spec.widthMm}mm !important; margin: 0 !important; padding: 0 !important; zoom: 1 !important; transform: none !important; -webkit-text-size-adjust: 100% !important; }`,
      `}`,
    ].join('\n');
  }

  const contentWidthMm = spec.widthMm - spec.marginMm * 2;
  return [
    `@page { size: ${spec.widthMm}mm ${spec.heightMm}mm portrait; margin: ${spec.marginMm}mm; }`,
    `@media print {`,
    `  html, body { width: ${contentWidthMm}mm !important; min-width: ${contentWidthMm}mm !important; margin: 0 !important; padding: 0 !important; zoom: 1 !important; transform: none !important; -webkit-text-size-adjust: 100% !important; }`,
    `}`,
  ].join('\n');
}

export function resolvePreviewZoomPercent(zoom: number): number {
  if (!Number.isFinite(zoom)) return 100;
  return Math.max(50, Math.min(175, Math.round(zoom)));
}

export function getScaledPreviewDimensionsPx(
  mode: PrintOverlayMode,
  zoomPercent: number,
  pxPerMm = 3.7795275591
): { widthPx: number; heightPx: number; scale: number } {
  const spec = getPrintDimensionSpec(mode);
  const clampedZoom = resolvePreviewZoomPercent(zoomPercent);
  const scale = clampedZoom / 100;
  const isA4 = mode !== 'id_card_cr80';
  const baseWidth = isA4 ? spec.widthMm - spec.marginMm * 2 : spec.widthMm;
  const baseHeight = isA4 ? spec.heightMm - spec.marginMm * 2 : spec.heightMm;

  return {
    widthPx: Math.round(baseWidth * pxPerMm * scale),
    heightPx: Math.round(baseHeight * pxPerMm * scale),
    scale,
  };
}
