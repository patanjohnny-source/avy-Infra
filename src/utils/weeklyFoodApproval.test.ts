import test from 'node:test';
import assert from 'node:assert/strict';
import type { AdvanceEntry } from '../types/avy';
import {
  buildWeeklyFoodAdminApprovalWhatsappMessage,
  buildWeeklyFoodDecisionWhatsappMessage,
  buildWhatsappDirectUrl,
  getEffectiveAdvanceApprovalStatus,
  groupWeeklyFoodApprovalBatches,
} from './weeklyFoodApproval';

test('weeklyFoodApproval groups batches by approvalBatchId and formats Admin & Decision WhatsApp messages', () => {
  const entries: AdvanceEntry[] = [
    {
      id: 'adv1',
      ownerId: 'u1',
      date: '2026-11-22',
      employeeId: 'e1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju',
      employeePhone: '9848011223',
      projectId: 'p1',
      projectName: 'Skyline Heights',
      towerId: 't1',
      towerName: 'Tower A',
      isSundayRun: true,
      advanceType: 'weekly_food',
      amount: 1200,
      paymentMode: 'upi',
      notes: 'Sunday Weekly Food',
      whatsappShared: true,
      approvalStatus: 'pending_admin',
      approvalBatchId: 'wfood_batch_1',
      submittedByName: 'Prakash Reddy',
      submittedByRole: 'supervisor',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'adv2',
      ownerId: 'u1',
      date: '2026-11-22',
      employeeId: 'e2',
      empCode: 'AVY-HLP-003',
      employeeName: 'Suresh',
      employeePhone: '9848011225',
      projectId: 'p1',
      projectName: 'Skyline Heights',
      towerId: 't1',
      towerName: 'Tower A',
      isSundayRun: true,
      advanceType: 'weekly_food',
      amount: 1000,
      paymentMode: 'cash',
      notes: 'Sunday Weekly Food',
      whatsappShared: true,
      approvalStatus: 'pending_admin',
      approvalBatchId: 'wfood_batch_1',
      submittedByName: 'Prakash Reddy',
      submittedByRole: 'supervisor',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'adv_legacy',
      ownerId: 'u1',
      date: '2026-11-15',
      employeeId: 'e1',
      empCode: 'AVY-MSN-001',
      employeeName: 'Raju',
      employeePhone: '9848011223',
      advanceType: 'weekly_food',
      amount: 900,
      paymentMode: 'cash',
      notes: '',
      whatsappShared: false,
      createdAt: '',
      updatedAt: '',
    },
  ];

  assert.equal(getEffectiveAdvanceApprovalStatus(entries[2]), 'approved');

  const pendingBatches = groupWeeklyFoodApprovalBatches(entries, 'pending_admin');
  assert.equal(pendingBatches.length, 1);
  assert.equal(pendingBatches[0].batchId, 'wfood_batch_1');
  assert.equal(pendingBatches[0].totalAmount, 2200);
  assert.equal(pendingBatches[0].entries.length, 2);

  const reqMsg = buildWeeklyFoodAdminApprovalWhatsappMessage({
    companyName: 'AVY INFRA',
    date: '2026-11-22',
    submittedByName: 'Prakash Reddy',
    submittedByRole: 'supervisor',
    siteLabel: 'Skyline Heights · Tower A',
    batchId: 'wfood_batch_1',
    entries: pendingBatches[0].entries,
  });
  assert.ok(reqMsg.includes('WEEKLY FOOD RUN APPROVAL REQUEST'));
  assert.ok(reqMsg.includes('Raju'));
  assert.ok(reqMsg.includes('Suresh'));

  const decisionMsg = buildWeeklyFoodDecisionWhatsappMessage({
    companyName: 'AVY INFRA',
    decision: 'approved',
    batch: pendingBatches[0],
    reviewedByName: 'Venkateswara Rao',
    note: 'Cleared for Sunday disbursement',
  });
  assert.ok(decisionMsg.includes('APPROVED'));
  assert.ok(decisionMsg.includes('Venkateswara Rao'));

  const waUrl = buildWhatsappDirectUrl('9848011223', reqMsg);
  assert.ok(waUrl.startsWith('https://wa.me/919848011223?text='));
});
