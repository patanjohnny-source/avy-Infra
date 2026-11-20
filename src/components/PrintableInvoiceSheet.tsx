import React from 'react';
import type { BillingDocument, CompanyProfile } from '../types/avy';
import {
  BILLING_DOC_TYPE_LABELS,
  BILLING_STATUS_LABELS,
  formatAmountInWordsINR,
  formatBillingCurrency,
} from '../utils/billing';

interface PrintableInvoiceSheetProps {
  document: BillingDocument;
  companyProfile: CompanyProfile;
}

export function PrintableInvoiceSheet({
  document: doc,
  companyProfile,
}: PrintableInvoiceSheetProps) {
  const isTaxInvoice = doc.docType === 'tax_invoice';
  const balance =
    doc.status === 'paid' ? 0 : Math.max(0, (doc.grandTotal || 0) - (doc.amountPaid || 0));

  return (
    <div
      data-testid="printable-invoice-sheet"
      className="invoice-a4-page bg-white text-slate-900 border border-slate-300 shadow-sm mx-auto flex flex-col justify-between"
      style={{
        width: '194mm',
        minHeight: '277mm',
        padding: '10mm',
        boxSizing: 'border-box',
      }}
    >
      <div className="space-y-4">
        {/* Supplier & Document Header Band */}
        <header className="flex items-start justify-between gap-4 pb-4 border-b-2 border-slate-900">
          <div className="flex items-start gap-3 min-w-0">
            {companyProfile.logoDataUrl ? (
              <img
                src={companyProfile.logoDataUrl}
                alt={companyProfile.companyName}
                className="w-12 h-12 rounded border border-slate-200 object-contain p-0.5 bg-white shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded bg-slate-900 text-orange-400 font-display font-bold text-sm flex items-center justify-center shrink-0">
                {companyProfile.companyName.slice(0, 3).toUpperCase()}
              </div>
            )}

            <div className="min-w-0 space-y-0.5">
              <div className="font-display font-bold text-lg text-slate-900 leading-tight">
                {companyProfile.companyName}
              </div>
              {companyProfile.tagline && (
                <div className="text-[11px] font-medium text-orange-700">
                  {companyProfile.tagline}
                </div>
              )}
              <div className="text-[10.5px] text-slate-600 max-w-[330px] leading-snug">
                {companyProfile.address}
              </div>
              <div className="text-[10.5px] font-mono text-slate-700 pt-0.5">
                Ph: {companyProfile.hrContact}
                {companyProfile.hrEmail ? ` · ${companyProfile.hrEmail}` : ''}
              </div>
              {companyProfile.gstNumber && (
                <div className="text-[10.5px] font-mono font-semibold text-slate-900">
                  Supplier GSTIN: {companyProfile.gstNumber}
                </div>
              )}
            </div>
          </div>

          <div className="text-right shrink-0 space-y-1">
            <div
              className={`inline-block px-3 py-1 text-xs font-bold uppercase tracking-wider rounded border ${
                isTaxInvoice
                  ? 'bg-orange-700 text-white border-orange-700'
                  : doc.docType === 'quotation'
                    ? 'bg-indigo-700 text-white border-indigo-700'
                    : 'bg-slate-900 text-white border-slate-900'
              }`}
            >
              {BILLING_DOC_TYPE_LABELS[doc.docType]}
            </div>
            <div className="font-mono font-bold text-base text-slate-900 pt-0.5">
              {doc.docNumber}
            </div>
            <div className="text-[10.5px] font-mono text-slate-600">
              Issue Date: <strong className="text-slate-900">{doc.issueDate}</strong>
            </div>
            {doc.dueDate && (
              <div className="text-[10.5px] font-mono text-slate-600">
                Due / Valid Until: <strong className="text-slate-900">{doc.dueDate}</strong>
              </div>
            )}
            <div className="text-[10px] font-mono uppercase text-slate-600">
              Status: <strong className="text-slate-900">{BILLING_STATUS_LABELS[doc.status]}</strong>
            </div>
          </div>
        </header>

        {/* Client & Project Details */}
        <section className="grid grid-cols-2 gap-4 text-xs">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Bill To / Client Details
            </div>
            <div className="font-semibold text-sm text-slate-900">{doc.clientName}</div>
            {doc.clientAddress && (
              <div className="text-[11px] text-slate-600 leading-snug">{doc.clientAddress}</div>
            )}
            {doc.clientPhone && (
              <div className="text-[11px] font-mono text-slate-700">Phone: {doc.clientPhone}</div>
            )}
            {doc.clientEmail && (
              <div className="text-[11px] font-mono text-slate-700">Email: {doc.clientEmail}</div>
            )}
            {doc.clientGstin && (
              <div className="text-[11px] font-mono font-semibold text-slate-900">
                Client GSTIN: {doc.clientGstin}
              </div>
            )}
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Project &amp; Tax Jurisdiction
            </div>
            <div className="font-semibold text-slate-900">
              {doc.projectName || 'General Contracting Works'}
            </div>
            {doc.towerName && (
              <div className="text-[11px] text-slate-700">Tower / Block: {doc.towerName}</div>
            )}
            {doc.placeOfSupply && (
              <div className="text-[11px] text-slate-700">
                Place of Supply: <strong>{doc.placeOfSupply}</strong>
              </div>
            )}
            <div className="text-[11px] font-mono text-slate-700">
              Tax Regime:{' '}
              <strong>
                {doc.taxMode === 'cgst_sgst'
                  ? 'Intra-State (CGST + SGST)'
                  : doc.taxMode === 'igst'
                    ? 'Inter-State (IGST)'
                    : 'No GST / Non-Tax'}
              </strong>
            </div>
          </div>
        </section>

        {/* Line Items Table */}
        <section>
          <table className="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="py-2 px-2.5 w-8">#</th>
                <th className="py-2 px-2.5">Work Description</th>
                <th className="py-2 px-2 w-16">HSN/SAC</th>
                <th className="py-2 px-2 text-right w-20">Qty</th>
                <th className="py-2 px-2 text-right w-20">Rate</th>
                <th className="py-2 px-2 text-right w-24">Taxable</th>
                <th className="py-2 px-2 text-right w-14">GST</th>
                <th className="py-2 px-2.5 text-right w-24">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-x border-b border-slate-300">
              {doc.items.map((item, idx) => (
                <tr key={item.id || idx} className="align-top">
                  <td className="py-2 px-2.5 font-mono text-slate-500">{idx + 1}</td>
                  <td className="py-2 px-2.5 font-medium text-slate-900">{item.description}</td>
                  <td className="py-2 px-2 font-mono text-slate-600">{item.hsnSac || '995433'}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {formatBillingCurrency(item.rate)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {formatBillingCurrency(item.taxableAmount)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {doc.taxMode === 'none' ? '0%' : `${item.gstRate}%`}
                  </td>
                  <td className="py-2 px-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                    {formatBillingCurrency(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Totals & Amount in Words */}
        <section className="grid grid-cols-12 gap-4 items-start pt-1">
          <div className="col-span-7 space-y-2.5">
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-[11px]">
              <span className="font-semibold text-slate-700 block mb-0.5">
                Amount Chargeable (in Words):
              </span>
              <span className="font-medium text-slate-900">
                {formatAmountInWordsINR(doc.grandTotal)}
              </span>
            </div>

            {doc.notes && (
              <div className="text-[11px] text-slate-700">
                <strong className="text-slate-900">Site Notes: </strong>
                {doc.notes}
              </div>
            )}

            {doc.terms && (
              <div className="text-[10.5px] text-slate-600 leading-snug whitespace-pre-line">
                <strong className="text-slate-800 block mb-0.5">Terms &amp; Conditions:</strong>
                {doc.terms}
              </div>
            )}
          </div>

          <div className="col-span-5 p-3 bg-slate-50 border border-slate-300 rounded space-y-1.5 text-[11.5px]">
            <div className="flex justify-between">
              <span className="text-slate-600">Taxable Subtotal</span>
              <span className="font-mono font-semibold tabular-nums">
                {formatBillingCurrency(doc.subtotal)}
              </span>
            </div>

            {doc.taxMode === 'cgst_sgst' && (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-600">CGST Output</span>
                  <span className="font-mono tabular-nums">
                    {formatBillingCurrency(doc.cgstTotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">SGST Output</span>
                  <span className="font-mono tabular-nums">
                    {formatBillingCurrency(doc.sgstTotal)}
                  </span>
                </div>
              </>
            )}

            {doc.taxMode === 'igst' && (
              <div className="flex justify-between">
                <span className="text-slate-600">IGST Output</span>
                <span className="font-mono tabular-nums">
                  {formatBillingCurrency(doc.igstTotal)}
                </span>
              </div>
            )}

            <div className="flex justify-between text-slate-600">
              <span>Round Off</span>
              <span className="font-mono tabular-nums">₹{(doc.roundOff || 0).toFixed(2)}</span>
            </div>

            <div className="pt-2 border-t border-slate-300 flex justify-between items-baseline">
              <span className="text-xs font-bold uppercase text-slate-900">Grand Total</span>
              <span className="text-base font-mono font-bold tabular-nums text-orange-700">
                {formatBillingCurrency(doc.grandTotal)}
              </span>
            </div>

            {doc.docType !== 'quotation' && (
              <div className="pt-1.5 border-t border-slate-200 space-y-1 text-[11px]">
                <div className="flex justify-between text-emerald-800">
                  <span>Amount Paid</span>
                  <span className="font-mono tabular-nums">
                    {formatBillingCurrency(
                      doc.status === 'paid' ? doc.grandTotal : doc.amountPaid || 0
                    )}
                  </span>
                </div>
                <div className="flex justify-between font-semibold text-slate-900">
                  <span>Balance Due</span>
                  <span className="font-mono tabular-nums">{formatBillingCurrency(balance)}</span>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Authorized Signatory Footer */}
      <footer className="pt-6 mt-6 border-t border-slate-300 flex items-end justify-between text-[11px]">
        <div className="text-slate-500">
          <div>Generated by {companyProfile.companyName} Operations &amp; Billing Portal</div>
          <div className="font-mono text-[10px]">
            Document Ref: {doc.docNumber} · Portrait A4 (210mm × 297mm)
          </div>
        </div>
        <div className="text-right">
          <div className="text-slate-500 mb-6">For {companyProfile.companyName}</div>
          <div className="pt-1 border-t border-slate-400 font-semibold text-slate-900 min-w-[160px]">
            {companyProfile.signatoryName || 'Authorized Signatory'}
          </div>
        </div>
      </footer>
    </div>
  );
}
