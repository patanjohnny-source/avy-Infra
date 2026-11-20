import type {
  BillingDocStatus,
  BillingDocType,
  BillingDocument,
  BillingLineItem,
  BillingTaxMode,
  CompanyProfile,
  Project,
} from '../types/avy';

export const BILLING_DOC_TYPE_LABELS: Record<BillingDocType, string> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  tax_invoice: 'Tax Invoice (GST)',
};

export const BILLING_DOC_PREFIXES: Record<BillingDocType, string> = {
  quotation: 'QTN',
  invoice: 'INV',
  tax_invoice: 'TAX',
};

export const BILLING_STATUS_LABELS: Record<BillingDocStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  sent: 'Sent',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export const DEFAULT_BILLING_TERMS = [
  '1. Work execution & measurement as per certified site joint measurement sheet (sq.ft / running ft).',
  '2. Payment due within 7 days of bill submission via RTGS / NEFT / UPI.',
  '3. All disputes subject to local jurisdiction only.',
].join('\n');

export function round2(num: number): number {
  return Math.round((Number(num) || 0) * 100) / 100;
}

export function getBillingDocTypePrefix(docType: BillingDocType): string {
  return BILLING_DOC_PREFIXES[docType] || 'INV';
}

export function generateNextBillingNumber(
  docType: BillingDocType,
  existingDocs: Pick<BillingDocument, 'docType' | 'docNumber'>[],
  dateIso?: string
): string {
  const prefix = getBillingDocTypePrefix(docType);
  const yearMatch = (dateIso || '').match(/^(\d{4})/);
  const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`, 'i');

  let maxSeq = 0;
  for (const doc of existingDocs) {
    if (doc.docType !== docType) continue;
    const m = (doc.docNumber || '').trim().match(pattern);
    if (m) {
      const seq = Number(m[1]);
      if (Number.isFinite(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  // Also check any sequence with same prefix across years if user used sequential numbering
  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  return `${prefix}-${year}-${nextSeq}`;
}

export function computeBillingLineItem(
  raw: {
    id: string;
    description: string;
    hsnSac?: string;
    unit?: string;
    quantity: number;
    rate: number;
    gstRate: number;
  },
  taxMode: BillingTaxMode
): BillingLineItem {
  const quantity = Math.max(0, round2(Number(raw.quantity) || 0));
  const rate = Math.max(0, round2(Number(raw.rate) || 0));
  const gstRate = taxMode === 'none' ? 0 : Math.max(0, Math.min(28, round2(Number(raw.gstRate) || 0)));
  const taxableAmount = round2(quantity * rate);
  const taxAmount = taxMode === 'none' ? 0 : round2((taxableAmount * gstRate) / 100);
  const lineTotal = round2(taxableAmount + taxAmount);

  return {
    id: raw.id || `li_${Math.random().toString(36).slice(2, 8)}`,
    description: (raw.description || '').trim(),
    hsnSac: (raw.hsnSac || '995433').trim(),
    unit: (raw.unit || 'Sq.Ft').trim(),
    quantity,
    rate,
    gstRate,
    taxableAmount,
    taxAmount,
    lineTotal,
  };
}

export interface BillingTotalsSummary {
  items: BillingLineItem[];
  subtotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  totalTax: number;
  roundOff: number;
  grandTotal: number;
}

export function computeBillingTotals(
  rawItems: Array<{
    id: string;
    description: string;
    hsnSac?: string;
    unit?: string;
    quantity: number;
    rate: number;
    gstRate: number;
  }>,
  taxMode: BillingTaxMode
): BillingTotalsSummary {
  const items = rawItems.map((item) => computeBillingLineItem(item, taxMode));
  const subtotal = round2(items.reduce((sum, item) => sum + item.taxableAmount, 0));
  const rawTaxTotal = round2(items.reduce((sum, item) => sum + item.taxAmount, 0));

  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  if (taxMode === 'cgst_sgst') {
    cgstTotal = round2(rawTaxTotal / 2);
    sgstTotal = round2(rawTaxTotal - cgstTotal);
  } else if (taxMode === 'igst') {
    igstTotal = rawTaxTotal;
  }

  const totalTax = round2(cgstTotal + sgstTotal + igstTotal);
  const exactTotal = round2(subtotal + totalTax);
  const grandTotal = Math.round(exactTotal);
  const roundOff = round2(grandTotal - exactTotal);

  return {
    items,
    subtotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    totalTax,
    roundOff,
    grandTotal,
  };
}

export interface ProjectTaxOrganizerBucket {
  projectId: string;
  projectName: string;
  clientName: string;
  location: string;
  documents: BillingDocument[];
  docCount: number;
  taxInvoiceCount: number;
  invoiceCount: number;
  quotationCount: number;
  paidCount: number;
  subtotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  totalTax: number;
  grandTotal: number;
  amountPaid: number;
  pendingBalance: number;
}

export function organizeTaxInvoicesByProject(params: {
  docs: BillingDocument[];
  projects: Project[];
  docTypeFilter?: 'tax_invoice' | 'all_bills' | 'all';
}): ProjectTaxOrganizerBucket[] {
  const projectMap = new Map<string, Project>();
  for (const p of params.projects) {
    projectMap.set(p.id, p);
  }

  const filterMode = params.docTypeFilter ?? 'tax_invoice';
  const filtered = params.docs.filter((doc) => {
    if (doc.status === 'cancelled') return false;
    if (filterMode === 'tax_invoice') return doc.docType === 'tax_invoice';
    if (filterMode === 'all_bills') return doc.docType === 'tax_invoice' || doc.docType === 'invoice';
    return true;
  });

  const bucketMap = new Map<string, ProjectTaxOrganizerBucket>();

  // Ensure all projects appear even when organizing tax invoices
  for (const proj of params.projects) {
    bucketMap.set(proj.id, {
      projectId: proj.id,
      projectName: proj.name,
      clientName: proj.clientName || '',
      location: proj.location || '',
      documents: [],
      docCount: 0,
      taxInvoiceCount: 0,
      invoiceCount: 0,
      quotationCount: 0,
      paidCount: 0,
      subtotal: 0,
      cgstTotal: 0,
      sgstTotal: 0,
      igstTotal: 0,
      totalTax: 0,
      grandTotal: 0,
      amountPaid: 0,
      pendingBalance: 0,
    });
  }

  for (const doc of filtered) {
    const key = doc.projectId || '__unassigned__';
    const proj = doc.projectId ? projectMap.get(doc.projectId) : undefined;
    let bucket = bucketMap.get(key);
    if (!bucket) {
      bucket = {
        projectId: key,
        projectName: doc.projectName || proj?.name || 'General / Unlinked Client Work',
        clientName: proj?.clientName || doc.clientName || '',
        location: proj?.location || '',
        documents: [],
        docCount: 0,
        taxInvoiceCount: 0,
        invoiceCount: 0,
        quotationCount: 0,
        paidCount: 0,
        subtotal: 0,
        cgstTotal: 0,
        sgstTotal: 0,
        igstTotal: 0,
        totalTax: 0,
        grandTotal: 0,
        amountPaid: 0,
        pendingBalance: 0,
      };
      bucketMap.set(key, bucket);
    }

    bucket.documents.push(doc);
    bucket.docCount += 1;
    if (doc.docType === 'tax_invoice') bucket.taxInvoiceCount += 1;
    else if (doc.docType === 'invoice') bucket.invoiceCount += 1;
    else bucket.quotationCount += 1;

    if (doc.status === 'paid') bucket.paidCount += 1;

    // Only sum revenue/tax metrics when not purely viewing mixed quotes if filter is tax/bills; for 'all', still display totals cleanly
    bucket.subtotal = round2(bucket.subtotal + (doc.subtotal || 0));
    bucket.cgstTotal = round2(bucket.cgstTotal + (doc.cgstTotal || 0));
    bucket.sgstTotal = round2(bucket.sgstTotal + (doc.sgstTotal || 0));
    bucket.igstTotal = round2(bucket.igstTotal + (doc.igstTotal || 0));
    bucket.totalTax = round2(bucket.cgstTotal + bucket.sgstTotal + bucket.igstTotal);
    bucket.grandTotal = round2(bucket.grandTotal + (doc.grandTotal || 0));
    const effectivePaid =
      doc.status === 'paid'
        ? Math.max(doc.amountPaid || 0, doc.grandTotal || 0)
        : Math.max(0, Math.min(doc.grandTotal || 0, doc.amountPaid || 0));
    bucket.amountPaid = round2(bucket.amountPaid + effectivePaid);
    bucket.pendingBalance = round2(Math.max(0, bucket.grandTotal - bucket.amountPaid));
  }

  return Array.from(bucketMap.values())
    .map((b) => ({
      ...b,
      documents: [...b.documents].sort((a, bDoc) => bDoc.issueDate.localeCompare(a.issueDate)),
    }))
    .sort((a, b) => b.grandTotal - a.grandTotal || b.docCount - a.docCount);
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitsWords(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`.trim();
}

function threeDigitsWords(n: number): string {
  if (n === 0) return '';
  const h = Math.floor(n / 100);
  const rem = n % 100;
  return `${h > 0 ? `${ONES[h]} Hundred` : ''}${h > 0 && rem > 0 ? ' ' : ''}${rem > 0 ? twoDigitsWords(rem) : ''}`.trim();
}

export function formatAmountInWordsINR(amount: number): string {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  if (n === 0) return 'Rupees Zero Only';

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(`${threeDigitsWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigitsWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigitsWords(thousand)} Thousand`);
  if (rest > 0) parts.push(threeDigitsWords(rest));

  return `Rupees ${parts.join(' ')} Only`;
}

export function formatBillingCurrency(amount: number): string {
  return `₹${Math.round(Number(amount) || 0).toLocaleString('en-IN')}`;
}

export function formatBillingWhatsappMessage(
  doc: BillingDocument,
  company: Pick<CompanyProfile, 'companyName' | 'gstNumber' | 'hrContact' | 'hrEmail'>
): string {
  const title = BILLING_DOC_TYPE_LABELS[doc.docType].toUpperCase();
  const lines: string[] = [
    `*${company.companyName} — ${title}*`,
    `Doc No: *${doc.docNumber}* | Date: ${doc.issueDate}`,
  ];
  if (doc.dueDate) {
    lines.push(`Due / Valid Till: ${doc.dueDate}`);
  }
  if (doc.projectName) {
    lines.push(`Project: ${doc.projectName}${doc.towerName ? ` (${doc.towerName})` : ''}`);
  }
  lines.push(`Client: ${doc.clientName}${doc.clientGstin ? ` (GSTIN: ${doc.clientGstin})` : ''}`);
  if (company.gstNumber && doc.docType === 'tax_invoice') {
    lines.push(`Supplier GSTIN: ${company.gstNumber}`);
  }
  lines.push('--- Work Summary ---');
  doc.items.slice(0, 8).forEach((item, idx) => {
    lines.push(
      `${idx + 1}. ${item.description} (${item.quantity} ${item.unit} @ ₹${item.rate}) = ₹${Math.round(item.lineTotal).toLocaleString('en-IN')}`
    );
  });
  if (doc.items.length > 8) {
    lines.push(`...and ${doc.items.length - 8} more line item(s)`);
  }
  lines.push(`Subtotal: ${formatBillingCurrency(doc.subtotal)}`);
  if (doc.taxMode === 'cgst_sgst') {
    lines.push(
      `CGST: ${formatBillingCurrency(doc.cgstTotal)} | SGST: ${formatBillingCurrency(doc.sgstTotal)}`
    );
  } else if (doc.taxMode === 'igst') {
    lines.push(`IGST: ${formatBillingCurrency(doc.igstTotal)}`);
  }
  lines.push(`*Grand Total: ${formatBillingCurrency(doc.grandTotal)}*`);
  if (doc.amountPaid > 0 && doc.docType !== 'quotation') {
    lines.push(
      `Paid: ${formatBillingCurrency(doc.amountPaid)} | Balance: ${formatBillingCurrency(Math.max(0, doc.grandTotal - doc.amountPaid))}`
    );
  }
  lines.push('');
  lines.push(`Please find attached ${doc.docNumber} PDF.`);
  if (company.hrContact) {
    lines.push(`Contact: ${company.hrContact}${company.hrEmail ? ` | ${company.hrEmail}` : ''}`);
  }
  return lines.join('\n');
}
