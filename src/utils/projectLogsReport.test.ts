import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedWorkspace } from '../data/seedData';
import {
  buildProjectLogsReportCsv,
  buildProjectLogsSummaryReport,
} from './projectLogsReport';

test('buildProjectLogsSummaryReport aggregates all log types scoped strictly to selected project', () => {
  const ws = createSeedWorkspace('test-owner');
  const project = ws.projects[0];
  const otherProject = ws.projects[1];

  const report = buildProjectLogsSummaryReport({
    project,
    towers: ws.towers,
    dailySiteLogs: ws.dailySiteLogs,
    assignments: ws.assignments,
    attendance: ws.attendance,
    advances: ws.advances,
    expenses: ws.expenses,
    deployments: ws.deployments,
  });

  assert.equal(report.project.id, project.id);
  assert.equal(report.totalEntries > 0, true);

  const expectedCounts =
    report.countsByCategory.site_log +
    report.countsByCategory.work_assignment +
    report.countsByCategory.attendance +
    report.countsByCategory.advance +
    report.countsByCategory.expense +
    report.countsByCategory.deployment;
  assert.equal(report.totalEntries, expectedCounts);

  // Confirm other project's unique daily log notes are excluded when different
  if (otherProject) {
    const otherOnlyLogs = ws.dailySiteLogs.filter((l) => l.projectId === otherProject.id);
    for (const ol of otherOnlyLogs) {
      assert.equal(report.entries.some((e) => e.id === `slog:${ol.id}`), false);
    }
  }
});

test('buildProjectLogsSummaryReport filters by date range and categories and escapes CSV properly', () => {
  const ws = createSeedWorkspace('test-owner');
  const project = ws.projects[0];
  const tower = ws.towers.find((t) => t.projectId === project.id)!;

  const customLog = {
    id: 'slog_custom_csv',
    ownerId: 'test-owner',
    date: '2026-05-15',
    projectId: project.id,
    projectName: project.name,
    towerId: tower.id,
    towerName: tower.name,
    notes: 'Delivered "Kajaria 600x1200", adhesive 20 bags\nChecked floor 4',
    loggedByRole: 'supervisor' as const,
    loggedByName: 'Suresh Nair',
    createdAt: '2026-05-15T10:00:00Z',
    updatedAt: '2026-05-15T10:00:00Z',
  };

  const report = buildProjectLogsSummaryReport({
    project,
    towers: ws.towers,
    dailySiteLogs: [customLog, ...ws.dailySiteLogs],
    assignments: ws.assignments,
    attendance: ws.attendance,
    advances: ws.advances,
    expenses: ws.expenses,
    deployments: ws.deployments,
    fromDate: '2026-05-15',
    toDate: '2026-05-15',
    categories: ['site_log'],
  });

  assert.equal(report.totalEntries, 1);
  assert.equal(report.countsByCategory.site_log, 1);

  const csv = buildProjectLogsReportCsv(report);
  const lines = csv.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].includes('""Kajaria 600x1200""'), true);
  assert.equal(lines[1].includes('\nChecked'), false);
});
