import test from 'node:test';
import assert from 'node:assert/strict';
import type { CompanyDocument } from '../types/avy';
import {
  detectDocumentFormat,
  filterCompanyDocuments,
  formatFileSizeBytes,
  isSupportedOfficeUploadFile,
  stripFileExtension,
} from './documentDrive';

const sampleDocs: CompanyDocument[] = [
  {
    id: 'cdoc_1',
    ownerId: 'u1',
    source: 'smart_generator',
    docCategory: 'employment_proof',
    fileFormat: 'doc',
    title: 'Employment Proof — Imran Khan',
    fileName: 'employment_proof_imran.doc',
    mimeType: 'application/msword',
    sizeBytes: 4200,
    approvalStatus: 'approved',
    approvedByName: 'Admin',
    approvedAt: '2026-11-20T10:00:00.000Z',
    employeeId: 'emp_2',
    empCode: 'AVY-MSN-002',
    employeeName: 'Imran Khan',
    refNumber: 'AVY/EMP-PRF/2026/1120-AVYMSN002',
    issueDate: '2026-11-20',
    subject: 'Employment Proof Certificate',
    createdAt: '2026-11-20T09:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
  },
  {
    id: 'cdoc_2',
    ownerId: 'u1',
    source: 'word_letterhead',
    docCategory: 'letterhead_doc',
    fileFormat: 'doc',
    title: 'Safety Circular Tower A',
    fileName: 'safety_circular.doc',
    mimeType: 'application/msword',
    sizeBytes: 3100,
    approvalStatus: 'draft',
    refNumber: 'AVY/DOC/2026/1119-NOTICE',
    issueDate: '2026-11-19',
    subject: 'Site Safety Circular',
    createdAt: '2026-11-19T08:00:00.000Z',
    updatedAt: '2026-11-19T08:00:00.000Z',
  },
  {
    id: 'cdoc_3',
    ownerId: 'u1',
    source: 'ppt_slides',
    docCategory: 'presentation_deck',
    fileFormat: 'ppt',
    title: 'Site Operations Briefing',
    fileName: 'site_briefing.ppt',
    mimeType: 'application/vnd.ms-powerpoint',
    sizeBytes: 9800,
    approvalStatus: 'approved',
    issueDate: '2026-11-18',
    createdAt: '2026-11-18T08:00:00.000Z',
    updatedAt: '2026-11-18T08:00:00.000Z',
  },
  {
    id: 'cdoc_4',
    ownerId: 'u1',
    source: 'uploaded',
    docCategory: 'uploaded_office',
    fileFormat: 'docx',
    title: 'Builder Contract Addendum',
    fileName: 'Builder_Contract_Addendum.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 24500,
    approvalStatus: 'approved',
    employeeId: 'emp_other',
    empCode: 'AVY-HLP-009',
    employeeName: 'Other Crew',
    issueDate: '2026-11-17',
    createdAt: '2026-11-17T08:00:00.000Z',
    updatedAt: '2026-11-17T08:00:00.000Z',
  },
];

test('detectDocumentFormat and isSupportedOfficeUploadFile classify Word, PowerPoint, PDF, and reject unsupported scripts', () => {
  assert.equal(detectDocumentFormat('offer.doc'), 'doc');
  assert.equal(detectDocumentFormat('offer.DOCX'), 'docx');
  assert.equal(detectDocumentFormat('deck.ppt'), 'ppt');
  assert.equal(detectDocumentFormat('deck.pptx'), 'pptx');
  assert.equal(detectDocumentFormat('slip.pdf'), 'pdf');
  assert.equal(detectDocumentFormat('scan.png', 'image/png'), 'other');

  assert.equal(isSupportedOfficeUploadFile('letter.docx'), true);
  assert.equal(isSupportedOfficeUploadFile('slides.pptx'), true);
  assert.equal(isSupportedOfficeUploadFile('receipt.pdf'), true);
  assert.equal(isSupportedOfficeUploadFile('script.exe'), false);
  assert.equal(stripFileExtension('Joining_Letter_2026.docx'), 'Joining_Letter_2026');
  assert.equal(formatFileSizeBytes(4200), '4.1 KB');
});

test('filterCompanyDocuments filters by category, status, search query, and supervisor tower scope', () => {
  const allApproved = filterCompanyDocuments(sampleDocs, { statusFilter: 'approved' });
  assert.equal(allApproved.length, 3);

  const smartOnly = filterCompanyDocuments(sampleDocs, { categoryGroup: 'smart_employee' });
  assert.equal(smartOnly.length, 1);
  assert.equal(smartOnly[0].id, 'cdoc_1');

  const searchHit = filterCompanyDocuments(sampleDocs, { searchQuery: 'safety' });
  assert.equal(searchHit.length, 1);
  assert.equal(searchHit[0].id, 'cdoc_2');

  // Tower supervisor scope hides docs tied to out-of-scope employees while keeping general company docs
  const scoped = filterCompanyDocuments(sampleDocs, {
    scopedEmployeeIds: new Set(['emp_2']),
  });
  assert.deepEqual(
    scoped.map((d) => d.id),
    ['cdoc_1', 'cdoc_2', 'cdoc_3']
  );
});
