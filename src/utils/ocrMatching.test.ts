import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchOcrEmployeeRow,
  normalizeOcrAdvanceCategory,
  normalizeOcrPaymentMode,
  sanitizeIsoDateInput,
} from './ocrMatching';
import type { Employee } from '../types/avy';

const crew: Employee[] = [
  {
    id: 'e1',
    ownerId: 'o1',
    empCode: 'AVY-MSN-001',
    fullName: 'Raju Mistri',
    role: 'Mason',
    phone: '9876543210',
    joiningDate: '2025-01-01',
    dailyRate: 1000,
    overtimeRate: 150,
    foodAllowanceDaily: 150,
    aadharRef: '',
    emergencyContact: '',
    status: 'active',
    notes: '',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'e2',
    ownerId: 'o1',
    empCode: 'AVY-HLP-014',
    fullName: 'Suresh Kumar Yadav',
    role: 'Helper',
    phone: '9876543211',
    joiningDate: '2025-01-01',
    dailyRate: 650,
    overtimeRate: 90,
    foodAllowanceDaily: 120,
    aadharRef: '',
    emergencyContact: '',
    status: 'active',
    notes: '',
    createdAt: '',
    updatedAt: '',
  },
];

test('matchOcrEmployeeRow matches exact code, numeric suffix, exact name, and partial name', () => {
  const byCode = matchOcrEmployeeRow('Random', 'avy msn 001', crew);
  assert.equal(byCode.employee?.id, 'e1');
  assert.equal(byCode.matchReason, 'emp_code');

  const bySuffix = matchOcrEmployeeRow('Suresh', '014', crew);
  assert.equal(bySuffix.employee?.id, 'e2');
  assert.equal(bySuffix.matchReason, 'code_suffix');

  const byName = matchOcrEmployeeRow('raju mistri', '', crew);
  assert.equal(byName.employee?.id, 'e1');
  assert.equal(byName.matchReason, 'exact_name');

  const byPartial = matchOcrEmployeeRow('Suresh Yadav', '', crew);
  assert.equal(byPartial.employee?.id, 'e2');

  const noMatch = matchOcrEmployeeRow('Unknown Person', '999', crew);
  assert.equal(noMatch.employee, null);
});

test('normalizeOcrAdvanceCategory maps standard and custom advance labels', () => {
  assert.deepEqual(normalizeOcrAdvanceCategory('Daily Food'), {
    advanceType: 'daily_food',
    customCategory: '',
  });
  assert.deepEqual(normalizeOcrAdvanceCategory('Sunday Weekly Mess'), {
    advanceType: 'weekly_food',
    customCategory: '',
  });
  assert.deepEqual(normalizeOcrAdvanceCategory('Kharchi'), {
    advanceType: 'cash_advance',
    customCategory: '',
  });
  assert.deepEqual(normalizeOcrAdvanceCategory('Medical Bill', ['Medical Bill']), {
    advanceType: 'custom',
    customCategory: 'Medical Bill',
  });
  assert.deepEqual(normalizeOcrAdvanceCategory('Gas Cylinder'), {
    advanceType: 'custom',
    customCategory: 'Gas Cylinder',
  });
});

test('normalizeOcrPaymentMode and sanitizeIsoDateInput normalize receipt metadata', () => {
  assert.deepEqual(normalizeOcrPaymentMode('GPay UPI'), {
    paymentMode: 'upi',
    paymentApp: 'GPay',
  });
  assert.deepEqual(normalizeOcrPaymentMode('PhonePe'), {
    paymentMode: 'upi',
    paymentApp: 'PhonePe',
  });
  assert.deepEqual(normalizeOcrPaymentMode('Paytm Wallet / UPI'), {
    paymentMode: 'upi',
    paymentApp: 'Paytm',
  });
  assert.deepEqual(normalizeOcrPaymentMode('IMPS Bank Transfer'), {
    paymentMode: 'bank_transfer',
    paymentApp: 'Bank Transfer',
  });
  assert.equal(sanitizeIsoDateInput('16/11/2026', '2026-11-01'), '2026-11-16');
  assert.equal(sanitizeIsoDateInput('bad-date', '2026-11-01'), '2026-11-01');
});
