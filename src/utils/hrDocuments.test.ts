import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AdvanceEntry,
  AttendanceRecord,
  CompanyProfile,
  Employee,
  Project,
  SettlementEntry,
  Tower,
} from '../types/avy';
import {
  buildAutoEmployeeDocument,
  buildLetterheadPdfBlob,
  buildPowerPointDocBlob,
  buildPresentationDeckPdfBlob,
  buildWordDocumentBlob,
  createLiveProjectDeck,
  maskAadhaarRef,
  sanitizeRichHtml,
} from './hrDocuments';

const mockCompany: CompanyProfile = {
  id: 'comp_1',
  ownerId: 'u1',
  companyName: 'AVY INFRA',
  tagline: 'Precision Tiling & Interior Works',
  address: 'Plot 42, Jubilee Hills, Hyderabad 500033',
  hrContact: '9848000111',
  hrEmail: 'hr@avyinfra.in',
  gstNumber: '36AABCA1234D1Z5',
  pfEstCode: 'APHYD0045678000',
  esiCode: '52000456780000999',
  signatoryName: 'Vikram Reddy',
  tileZoneCatalog: [],
  createdAt: '',
  updatedAt: '',
};

const mockEmp: Employee = {
  id: 'emp_1',
  ownerId: 'u1',
  empCode: 'AVY-MSN-001',
  fullName: 'Raju Mistri',
  role: 'Mason',
  phone: '9848011223',
  joiningDate: '2025-02-10',
  dailyRate: 1000,
  overtimeRate: 150,
  foodAllowanceDaily: 150,
  aadharRef: '4589-2314-8821',
  pfNumber: 'PF-HYD-1122',
  bloodGroup: 'B+',
  emergencyContact: '9848099001',
  currentProjectId: 'p1',
  currentProjectName: 'Skyline Residences',
  currentTowerId: 't1',
  currentTowerName: 'Tower A',
  status: 'active',
  notes: '',
  createdAt: '',
  updatedAt: '',
};

const mockProject: Project = {
  id: 'p1',
  ownerId: 'u1',
  name: 'Skyline Residences',
  location: 'Gachibowli, Hyderabad',
  clientName: 'Prestige Buildcon',
  status: 'active',
  createdAt: '',
  updatedAt: '',
};

const mockTower: Tower = {
  id: 't1',
  ownerId: 'u1',
  projectId: 'p1',
  name: 'Tower A',
  totalFloors: 12,
  unitsPerFloor: 4,
  supervisorPhone: '9000111222',
  createdAt: '',
  updatedAt: '',
};

const mockAttendance: AttendanceRecord[] = [
  {
    id: 'att_1',
    ownerId: 'u1',
    date: '2026-11-10',
    employeeId: 'emp_1',
    empCode: 'AVY-MSN-001',
    employeeName: 'Raju Mistri',
    employeeRole: 'Mason',
    projectId: 'p1',
    projectName: 'Skyline Residences',
    towerId: 't1',
    towerName: 'Tower A',
    status: 'present',
    overtimeHours: 2,
    dailyWageEarned: 1000,
    overtimePayEarned: 300,
    notes: '',
    createdAt: '',
    updatedAt: '',
  },
];

const mockAdvances: AdvanceEntry[] = [
  {
    id: 'adv_1',
    ownerId: 'u1',
    date: '2026-11-11',
    employeeId: 'emp_1',
    empCode: 'AVY-MSN-001',
    employeeName: 'Raju Mistri',
    employeePhone: '9848011223',
    advanceType: 'weekly_food',
    amount: 450,
    paymentMode: 'upi',
    whatsappShared: true,
    notes: '',
    createdAt: '',
    updatedAt: '',
  },
];

const mockSettlements: SettlementEntry[] = [];

test('maskAadhaarRef protects leading digits while keeping last 4 visible', () => {
  assert.equal(maskAadhaarRef('4589-2314-8821'), 'XXXX-XXXX-8821');
  assert.equal(maskAadhaarRef(''), 'On Record');
});

test('buildAutoEmployeeDocument auto-generates Employment Proof, Payslip, Joining, Relieving & Travel Security Verification letters', () => {
  const proofDoc = buildAutoEmployeeDocument({
    docType: 'employment_proof',
    employee: mockEmp,
    company: mockCompany,
    attendance: mockAttendance,
    advances: mockAdvances,
    settlements: mockSettlements,
    projects: [mockProject],
    towers: [mockTower],
    issueDate: '2026-11-20',
  });
  assert.match(proofDoc.refNumber, /^AVY\/EMP-PRF\/2026/);
  assert.match(proofDoc.htmlBody, /Raju Mistri/);
  assert.match(proofDoc.htmlBody, /26,000/);
  assert.match(proofDoc.htmlBody, /Skyline Residences/);

  const payslipDoc = buildAutoEmployeeDocument({
    docType: 'payslip',
    employee: mockEmp,
    company: mockCompany,
    attendance: mockAttendance,
    advances: mockAdvances,
    settlements: mockSettlements,
    projects: [mockProject],
    towers: [mockTower],
    issueDate: '2026-11-20',
    monthKey: '2026-11',
  });

  assert.equal(payslipDoc.payslip?.summary.totalEarned, 1300);
  assert.equal(payslipDoc.payslip?.summary.totalAdvances, 450);
  assert.equal(payslipDoc.payslip?.summary.netPayable, 850);
  assert.match(payslipDoc.refNumber, /^AVY\/PAY\/2026/);

  const joiningDoc = buildAutoEmployeeDocument({
    docType: 'joining_letter',
    employee: mockEmp,
    company: mockCompany,
    attendance: mockAttendance,
    advances: mockAdvances,
    settlements: mockSettlements,
    projects: [mockProject],
    towers: [mockTower],
    issueDate: '2026-11-20',
  });
  assert.match(joiningDoc.htmlBody, /Raju Mistri/);
  assert.match(joiningDoc.htmlBody, /XXXX-XXXX-8821/);
  assert.match(joiningDoc.htmlBody, /Skyline Residences/);

  const relievingDoc = buildAutoEmployeeDocument({
    docType: 'relieving_letter',
    employee: mockEmp,
    company: mockCompany,
    attendance: mockAttendance,
    advances: mockAdvances,
    settlements: mockSettlements,
    projects: [mockProject],
    towers: [mockTower],
    issueDate: '2026-11-20',
    relievingDate: '2026-11-20',
  });
  assert.match(relievingDoc.htmlBody, /20 Nov 2026/);
  assert.match(relievingDoc.htmlBody, /850/);

  const travelDoc = buildAutoEmployeeDocument({
    docType: 'travel_security_letter',
    employee: mockEmp,
    company: mockCompany,
    attendance: mockAttendance,
    advances: mockAdvances,
    settlements: mockSettlements,
    projects: [mockProject],
    towers: [mockTower],
    issueDate: '2026-11-20',
    travelRoute: 'Nalgonda -> Hyderabad Site',
    travelValidFrom: '2026-11-20',
    travelValidTo: '2026-11-25',
  });
  assert.equal(travelDoc.travelMeta?.route, 'Nalgonda -> Hyderabad Site');
  assert.equal(travelDoc.travelMeta?.verificationPhone, '9000111222');
  assert.match(travelDoc.htmlBody, /9000111222/);
  assert.match(travelDoc.htmlBody, /B\+/);
});

test('sanitizeRichHtml strips script tags and inline event handlers', () => {
  const dirty = `<p onclick="alert(1)">Hello</p><script>evil()</script><a href="javascript:bad()">Link</a>`;
  const clean = sanitizeRichHtml(dirty);
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /onclick/i);
  assert.doesNotMatch(clean, /javascript:/i);
});

test('Word .doc, PowerPoint .ppt, Letterhead PDF, and 16:9 Presentation Deck PDF builders produce non-empty valid Blobs', async () => {
  const wordOut = buildWordDocumentBlob({
    company: mockCompany,
    refNumber: 'AVY/DOC/2026/1120-GEN',
    issueDate: '2026-11-20',
    recipient: 'To Site Team',
    subject: 'Safety Circular',
    bodyHtml: '<p>Wear helmets on all floors.</p>',
  });
  assert.ok(wordOut.blob.size > 200);
  assert.match(wordOut.fileName, /\.doc$/);
  const wordText = await wordOut.blob.text();
  assert.match(wordText, /AVY INFRA/);
  assert.match(wordText, /Vikram Reddy/);

  const pdfOut = buildLetterheadPdfBlob({
    company: mockCompany,
    refNumber: 'AVY/TRV-SEC/2026/1120-AVYMSN001',
    issueDate: '2026-11-20',
    recipient: 'To Checkpost Officer',
    subject: 'Worker Travel Security Letter',
    plainTextLines: ['Raju Mistri is an active company mason.'],
    employee: mockEmp,
  });
  assert.ok(pdfOut.blob.size > 500);
  assert.match(pdfOut.fileName, /\.pdf$/);

  const deck = createLiveProjectDeck({
    company: mockCompany,
    projects: [mockProject],
    towers: [mockTower],
    flats: [],
    employees: [mockEmp],
    attendance: mockAttendance,
    expenses: [],
    todayIso: '2026-11-20',
  });
  assert.equal(deck.slides.length, 3);

  const deckPdf = buildPresentationDeckPdfBlob({ deck, company: mockCompany });
  assert.ok(deckPdf.blob.size > 800);
  assert.match(deckPdf.fileName, /\.pdf$/);

  const deckPpt = buildPowerPointDocBlob({ deck, company: mockCompany });
  assert.ok(deckPpt.blob.size > 500);
  assert.match(deckPpt.fileName, /\.ppt$/);
  const pptText = await deckPpt.blob.text();
  assert.match(pptText, /AVY INFRA/);
  assert.match(pptText, /Slide 1 \/ 3/);
});
