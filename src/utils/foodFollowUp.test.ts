import test from 'node:test';
import assert from 'node:assert/strict';
import type { AdvanceEntry } from '../types/avy';
import {
  DEFAULT_FOOD_FOLLOWUP_TEMPLATE,
  buildFoodAdvanceFollowUpMessage,
  computeWeeklyFoodFollowUpSummary,
  evaluateWeeklyFoodAdvance,
  formatElapsedDurationLabel,
} from './foodFollowUp';

function makeAdvance(overrides: Partial<AdvanceEntry> = {}): AdvanceEntry {
  return {
    id: 'adv_test_1',
    ownerId: 'owner_1',
    date: '2026-11-18',
    employeeId: 'emp_1',
    empCode: 'AVY-MSN-002',
    employeeName: 'Imran Khan',
    employeePhone: '9701233445',
    projectId: 'proj_1',
    projectName: 'Skyline Heights Residency',
    towerId: 'twr_b',
    towerName: 'Tower B',
    isSundayRun: true,
    advanceType: 'weekly_food',
    amount: 900,
    paymentMode: 'upi',
    notes: 'Sunday weekly food advance',
    whatsappShared: true,
    acknowledged: false,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    ...overrides,
  };
}

test('evaluateWeeklyFoodAdvance classifies within_window vs overdue_unacknowledged at 24h boundary', () => {
  const adv = makeAdvance({
    date: '2026-11-19',
    createdAt: '2026-11-19T10:00:00.000Z',
  });

  // 12 hours after recording -> still within 24h window
  const at12h = Date.parse('2026-11-19T22:00:00.000Z');
  const res12 = evaluateWeeklyFoodAdvance(adv, at12h);
  assert.equal(res12.status, 'within_window');
  assert.equal(res12.isDueForAutoFollowUp, false);
  assert.equal(Math.round(res12.remainingHours), 12);

  // Exactly 24 hours after recording -> overdue & eligible for follow-up
  const at24h = Date.parse('2026-11-20T10:00:00.000Z');
  const res24 = evaluateWeeklyFoodAdvance(adv, at24h);
  assert.equal(res24.status, 'overdue_unacknowledged');
  assert.equal(res24.isDueForAutoFollowUp, true);
  assert.equal(Math.round(res24.elapsedHours), 24);
});

test('evaluateWeeklyFoodAdvance respects 24h cooldown and stops reminders once acknowledged', () => {
  const nowMs = Date.parse('2026-11-20T14:00:00.000Z');

  // Sent follow-up 4 hours ago -> still overdue, but in cooldown (not due again yet)
  const sentRecently = makeAdvance({
    followUpSentAt: '2026-11-20T10:00:00.000Z',
    followUpCount: 1,
  });
  const cooled = evaluateWeeklyFoodAdvance(sentRecently, nowMs);
  assert.equal(cooled.status, 'overdue_unacknowledged');
  assert.equal(cooled.inCooldown, true);
  assert.equal(cooled.isDueForAutoFollowUp, false);
  assert.equal(Math.round(cooled.cooldownRemainingHours), 20);

  // Sent follow-up 26 hours ago -> cooldown expired, due for follow-up again
  const sentLongAgo = makeAdvance({
    followUpSentAt: '2026-11-19T12:00:00.000Z',
    followUpCount: 1,
  });
  const readyAgain = evaluateWeeklyFoodAdvance(sentLongAgo, nowMs);
  assert.equal(readyAgain.inCooldown, false);
  assert.equal(readyAgain.isDueForAutoFollowUp, true);

  // Worker acknowledged -> never due regardless of age
  const acked = makeAdvance({
    acknowledged: true,
    acknowledgedAt: '2026-11-20T11:00:00.000Z',
    acknowledgedBy: 'Imran Khan (Employee Portal)',
  });
  const resAck = evaluateWeeklyFoodAdvance(acked, nowMs);
  assert.equal(resAck.status, 'acknowledged');
  assert.equal(resAck.isDueForAutoFollowUp, false);
});

test('computeWeeklyFoodFollowUpSummary filters strictly to weekly_food and aggregates buckets', () => {
  const nowMs = Date.parse('2026-11-20T12:00:00.000Z');
  const advances: AdvanceEntry[] = [
    makeAdvance({ id: 'w_overdue', date: '2026-11-18', createdAt: '2026-11-18T10:00:00.000Z' }),
    makeAdvance({
      id: 'w_within',
      date: '2026-11-20',
      createdAt: '2026-11-20T06:00:00.000Z',
    }),
    makeAdvance({
      id: 'w_acked',
      date: '2026-11-15',
      createdAt: '2026-11-15T10:00:00.000Z',
      acknowledged: true,
    }),
    makeAdvance({
      id: 'd_ignored',
      advanceType: 'daily_food',
      date: '2026-11-15',
      createdAt: '2026-11-15T10:00:00.000Z',
    }),
    makeAdvance({
      id: 'c_ignored',
      advanceType: 'cash_advance',
      date: '2026-11-15',
      createdAt: '2026-11-15T10:00:00.000Z',
    }),
  ];

  const summary = computeWeeklyFoodFollowUpSummary(advances, nowMs);
  assert.equal(summary.allRows.length, 3);
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.dueNowCount, 1);
  assert.equal(summary.withinWindowCount, 1);
  assert.equal(summary.acknowledgedCount, 1);
  assert.equal(summary.overdueRows[0].advance.id, 'w_overdue');
});

test('buildFoodAdvanceFollowUpMessage interpolates all template variables cleanly', () => {
  const adv = makeAdvance({
    paymentApp: 'PhonePe',
    transactionId: 'UTR998877',
  });
  const msg = buildFoodAdvanceFollowUpMessage(adv, {
    companyName: 'AVY INFRA',
    elapsedHours: 36,
    template: DEFAULT_FOOD_FOLLOWUP_TEMPLATE,
  });

  assert.match(msg, /AVY INFRA — Weekly Food Advance Reminder/);
  assert.match(msg, /Imran Khan \(AVY-MSN-002\)/);
  assert.match(msg, /₹900/);
  assert.match(msg, /2026-11-18/);
  assert.match(msg, /UPI · PhonePe · Ref: UTR998877/);
  assert.match(msg, /Skyline Heights Residency \(Tower B\)/);
  assert.match(msg, /1d 12h/);
  assert.equal(formatElapsedDurationLabel(24), '1d');
  assert.equal(formatElapsedDurationLabel(14), '14h');

  const customMsg = buildFoodAdvanceFollowUpMessage(adv, {
    companyName: 'AVY INFRA',
    elapsedHours: 28,
    template: 'Hi {{workerName}}, ack {{amount}} ({{hoursElapsed}})',
  });
  assert.equal(customMsg, 'Hi Imran Khan, ack ₹900 (1d 4h)');
});
