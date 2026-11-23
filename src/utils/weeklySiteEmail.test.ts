import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedWorkspace } from '../data/seedData';
import { buildWeeklySitePerformanceReport } from './weeklySiteEmail';

test('buildWeeklySitePerformanceReport aggregates site logs, payroll wages/advances, expenses, and tile completion for a project week', () => {
  const seed = createSeedWorkspace('test-owner');
  const project = seed.projects[0];
  const allDates = [
    ...seed.dailySiteLogs.map((l) => l.date),
    ...seed.attendance.map((a) => a.date),
    ...seed.advances.map((a) => a.date),
    ...seed.expenses.map((e) => e.date),
  ].sort();

  const weekStart = allDates[0] || '2026-01-01';
  const weekEnd = allDates[allDates.length - 1] || '2026-12-31';

  const report = buildWeeklySitePerformanceReport({
    project,
    towers: seed.towers,
    flats: seed.flats,
    dailySiteLogs: seed.dailySiteLogs,
    attendance: seed.attendance,
    advances: seed.advances,
    expenses: seed.expenses,
    companyProfile: seed.companyProfile,
    weekStart,
    weekEnd,
    recipientEmail: 'director@avyinfra.in',
  });

  assert.equal(report.recipientEmail, 'director@avyinfra.in');
  assert.ok(report.subject.includes(project.name));
  assert.ok(report.mailtoUrl.startsWith('mailto:director%40avyinfra.in?'));
  assert.ok(report.metrics.totalFlats > 0);
  assert.ok(report.metrics.totalWeeklyCost > 0);
  assert.ok(report.body.includes('TILE COMPLETION & WORK PROGRESS'));
  assert.ok(report.body.includes('PAYROLL, ATTENDANCE & ADVANCES'));
  assert.ok(report.body.includes('SITE EXPENSES'));
  assert.ok(report.body.includes('DAILY SITE LOG HIGHLIGHTS'));
  assert.ok(report.whatsappMessage.includes(project.name));
});
