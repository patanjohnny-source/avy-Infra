import test from 'node:test';
import assert from 'node:assert/strict';
import {
  A4_PORTRAIT_SPEC,
  CR80_PORTRAIT_SPEC,
  buildIsolatedPageRuleCss,
  getPrintDimensionSpec,
  getScaledPreviewDimensionsPx,
  resolvePreviewZoomPercent,
} from './printLayout';

test('getPrintDimensionSpec locks vertical CR80 (54x86mm) and A4 (210x297mm) dimensions', () => {
  const cr80 = getPrintDimensionSpec('id_card_cr80');
  assert.equal(cr80.widthMm, 54);
  assert.equal(cr80.heightMm, 86);
  assert.equal(cr80.marginMm, 0);
  assert.equal(cr80.orientation, 'portrait');
  assert.equal(cr80.bodyClassName, 'printing-isolated-id-card');

  const a4 = getPrintDimensionSpec('invoice_a4');
  assert.equal(a4.widthMm, 210);
  assert.equal(a4.heightMm, 297);
  assert.equal(a4.orientation, 'portrait');
  assert.equal(a4.bodyClassName, 'printing-isolated-invoice');

  const rep = getPrintDimensionSpec('report_a4');
  assert.equal(rep.widthMm, 210);
  assert.equal(rep.heightMm, 297);
  assert.equal(rep.bodyClassName, 'printing-isolated-invoice');

  const attCard = getPrintDimensionSpec('attendance_card_a4');
  assert.equal(attCard.widthMm, 210);
  assert.equal(attCard.heightMm, 297);
  assert.equal(attCard.bodyClassName, 'printing-isolated-invoice');

  const bulkA4 = getPrintDimensionSpec('bulk_worker_cards_a4');
  assert.equal(bulkA4.widthMm, 210);
  assert.equal(bulkA4.heightMm, 297);

  const bulkLetter = getPrintDimensionSpec('bulk_worker_cards_letter');
  assert.equal(bulkLetter.widthMm, 215.9);
  assert.equal(bulkLetter.heightMm, 279.4);
  assert.equal(bulkLetter.bodyClassName, 'printing-isolated-invoice');
});

test('buildIsolatedPageRuleCss outputs portrait @page dimensions and zoom: 1 lock', () => {
  const cr80Css = buildIsolatedPageRuleCss('id_card_cr80');
  assert.match(cr80Css, /@page\s*\{\s*size:\s*54mm 86mm portrait;\s*margin:\s*0mm;\s*\}/);
  assert.match(cr80Css, /zoom:\s*1\s*!important/);
  assert.match(cr80Css, /width:\s*54mm\s*!important/);

  const a4Css = buildIsolatedPageRuleCss('invoice_a4');
  assert.match(a4Css, /@page\s*\{\s*size:\s*210mm 297mm portrait;\s*margin:\s*8mm;\s*\}/);
  assert.match(a4Css, /width:\s*194mm\s*!important/);

  const repCss = buildIsolatedPageRuleCss('report_a4');
  assert.match(repCss, /@page\s*\{\s*size:\s*210mm 297mm portrait;\s*margin:\s*8mm;\s*\}/);

  const letterCss = buildIsolatedPageRuleCss('bulk_worker_cards_letter');
  assert.match(letterCss, /@page\s*\{\s*size:\s*215\.9mm 279\.4mm portrait;\s*margin:\s*8mm;\s*\}/);
  assert.match(letterCss, /width:\s*199\.9mm\s*!important/);
});

test('resolvePreviewZoomPercent and getScaledPreviewDimensionsPx keep screen zoom bounded without altering CR80 aspect ratio', () => {
  assert.equal(resolvePreviewZoomPercent(20), 50);
  assert.equal(resolvePreviewZoomPercent(300), 175);
  assert.equal(resolvePreviewZoomPercent(125), 125);

  const cr80At100 = getScaledPreviewDimensionsPx('id_card_cr80', 100);
  const cr80At150 = getScaledPreviewDimensionsPx('id_card_cr80', 150);
  assert.equal(cr80At100.scale, 1);
  assert.equal(cr80At150.scale, 1.5);
  assert.ok(cr80At150.heightPx > cr80At150.widthPx);
  assert.equal(Math.round(cr80At100.widthPx * 1.5), cr80At150.widthPx);

  const a4At75 = getScaledPreviewDimensionsPx('invoice_a4', 75);
  assert.equal(a4At75.scale, 0.75);
  assert.ok(a4At75.heightPx > a4At75.widthPx);
  assert.equal(CR80_PORTRAIT_SPEC.orientation, A4_PORTRAIT_SPEC.orientation);
});
