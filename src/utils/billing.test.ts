import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBillingTotals,
  formatAmountInWordsINR,
  formatBillingWhatsappMessage,
  generateNextBillingNumber,
  organizeTaxInvoicesByProject,
} from './billing';
import type { BillingDocument, Project } from '../types/avy';

test('generateNextBillingNumber auto-increments separately for quotation, invoice, and tax_invoice', () => {
  const docs = [
    { docType: 'quotation' as const, docNumber: 'QTN-2026-0001' },
    { docType: 'quotation' as const, docNumber: 'QTN-2026-0004' },
    { docType: 'invoice' as const, docNumber: 'INV-2026-0002' },
    { docType: 'tax_invoice' as const, docNumber: 'TAX-2026-0009' },
  ];

  assert.equal(generateNextBillingNumber('quotation', docs, '2026-11-18'), 'QTN-2026-0005');
  assert.equal(generateNextBillingNumber('invoice', docs, '2026-11-18'), 'INV-2026-0003');
  assert.equal(generateNextBillingNumber('tax_invoice', docs, '2026-11-18'), 'TAX-2026-0010');
  assert.equal(generateNextBillingNumber('tax_invoice', [], '2026-11-18'), 'TAX-2026-0001');
});

test('computeBillingTotals calculates CGST/SGST and IGST correctly with round-off', () => {
  const cgstRes = computeBillingTotals(
    [
      {
        id: '1',
        description: 'Hall Flooring Vitrified',
        hsnSac: '995433',
        unit: 'Sq.Ft',
        quantity: 1000,
        rate: 65,
        gstRate: 18,
      },
      {
        id: '2',
        description: 'Kitchen Dado',
        hsnSac: '995433',
        unit: 'Sq.Ft',
        quantity: 250,
        rate: 80,
        gstRate: 18,
      },
    ],
    'cgst_sgst'
  );

  assert.equal(cgstRes.subtotal, 85000);
  assert.equal(cgstRes.cgstTotal, 7650);
  assert.equal(cgstRes.sgstTotal, 7650);
  assert.equal(cgstRes.igstTotal, 0);
  assert.equal(cgstRes.grandTotal, 100300);

  const igstRes = computeBillingTotals(
    [
      {
        id: '1',
        description: 'Granite Slab',
        unit: 'Sq.Ft',
        quantity: 100,
        rate: 120,
        gstRate: 18,
      },
    ],
    'igst'
  );
  assert.equal(igstRes.cgstTotal, 0);
  assert.equal(igstRes.sgstTotal, 0);
  assert.equal(igstRes.igstTotal, 2160);
  assert.equal(igstRes.grandTotal, 14160);

  const exemptRes = computeBillingTotals(
    [{ id: '1', description: 'Labour', quantity: 100, rate: 50, gstRate: 18 }],
    'none'
  );
  assert.equal(exemptRes.totalTax, 0);
  assert.equal(exemptRes.grandTotal, 5000);
});

test('organizeTaxInvoicesByProject groups tax invoices by project and sums paid vs pending balances', () => {
  const projects: Project[] = [
    {
      id: 'p1',
      ownerId: 'u1',
      name: 'Skyline Heights',
      location: 'Gachibowli',
      clientName: 'Vertex',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'p2',
      ownerId: 'u1',
      name: 'Emerald Villas',
      location: 'Kokapet',
      clientName: 'Surya',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const docs: BillingDocument[] = [
    {
      id: 'd1',
      ownerId: 'u1',
      docType: 'tax_invoice',
      docNumber: 'TAX-2026-0001',
      issueDate: '2026-11-10',
      projectId: 'p1',
      projectName: 'Skyline Heights',
      clientName: 'Vertex',
      taxMode: 'cgst_sgst',
      items: [],
      subtotal: 100000,
      cgstTotal: 9000,
      sgstTotal: 9000,
      igstTotal: 0,
      roundOff: 0,
      grandTotal: 118000,
      amountPaid: 118000,
      status: 'paid',
      whatsappShared: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'd2',
      ownerId: 'u1',
      docType: 'tax_invoice',
      docNumber: 'TAX-2026-0002',
      issueDate: '2026-11-15',
      projectId: 'p1',
      projectName: 'Skyline Heights',
      clientName: 'Vertex',
      taxMode: 'cgst_sgst',
      items: [],
      subtotal: 50000,
      cgstTotal: 4500,
      sgstTotal: 4500,
      igstTotal: 0,
      roundOff: 0,
      grandTotal: 59000,
      amountPaid: 20000,
      status: 'issued',
      whatsappShared: false,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'd3',
      ownerId: 'u1',
      docType: 'quotation',
      docNumber: 'QTN-2026-0001',
      issueDate: '2026-11-12',
      projectId: 'p2',
      projectName: 'Emerald Villas',
      clientName: 'Surya',
      taxMode: 'cgst_sgst',
      items: [],
      subtotal: 40000,
      cgstTotal: 3600,
      sgstTotal: 3600,
      igstTotal: 0,
      roundOff: 0,
      grandTotal: 47200,
      amountPaid: 0,
      status: 'sent',
      whatsappShared: false,
      createdAt: '',
      updatedAt: '',
    },
  ];

  const taxOnly = organizeTaxInvoicesByProject({ docs, projects, docTypeFilter: 'tax_invoice' });
  const p1 = taxOnly.find((b) => b.projectId === 'p1')!;
  const p2 = taxOnly.find((b) => b.projectId === 'p2')!;

  assert.equal(p1.taxInvoiceCount, 2);
  assert.equal(p1.subtotal, 150000);
  assert.equal(p1.totalTax, 27000);
  assert.equal(p1.grandTotal, 177000);
  assert.equal(p1.amountPaid, 138000);
  assert.equal(p1.pendingBalance, 39000);

  // Quotations excluded in tax_invoice mode
  assert.equal(p2.taxInvoiceCount, 0);
  assert.equal(p2.grandTotal, 0);
});

test('formatAmountInWordsINR and formatBillingWhatsappMessage produce readable outputs', () => {
  assert.equal(formatAmountInWordsINR(118000), 'Rupees One Lakh Eighteen Thousand Only');
  const msg = formatBillingWhatsappMessage(
    {
      id: 'd1',
      ownerId: 'u1',
      docType: 'tax_invoice',
      docNumber: 'TAX-2026-0001',
      issueDate: '2026-11-18',
      projectId: 'p1',
      projectName: 'Skyline Heights',
      clientName: 'Vertex Developers',
      taxMode: 'cgst_sgst',
      items: [
        {
          id: '1',
          description: 'Tile Flooring',
          hsnSac: '995433',
          unit: 'Sq.Ft',
          quantity: 100,
          rate: 60,
          gstRate: 18,
          taxableAmount: 6000,
          taxAmount: 1080,
          lineTotal: 7080,
        },
      ],
      subtotal: 6000,
      cgstTotal: 540,
      sgstTotal: 540,
      igstTotal: 0,
      roundOff: 0,
      grandTotal: 7080,
      amountPaid: 0,
      status: 'issued',
      whatsappShared: false,
      createdAt: '',
      updatedAt: '',
    },
    { companyName: 'AVY INFRA', gstNumber: '36AABCA9021K1Z4', hrContact: '9848000112', hrEmail: 'hr@avyinfra.com' }
  );
  assert.match(msg, /TAX-2026-0001/);
  assert.match(msg, /Grand Total: ₹7,080/);
});
