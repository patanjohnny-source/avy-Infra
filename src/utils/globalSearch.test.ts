import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedWorkspace } from '../data/seedData';
import { searchWorkspaceEntities } from './globalSearch';

test('searchWorkspaceEntities filters projects, employees, and flat IDs by name or code', () => {
  const ws = createSeedWorkspace('test-owner');

  // Search by project name
  const projRes = searchWorkspaceEntities({
    query: 'Skyline',
    projects: ws.projects,
    towers: ws.towers,
    flats: ws.flats,
    employees: ws.employees,
  });
  assert.equal(projRes.projects.length >= 1, true);
  assert.equal(projRes.projects[0].title, 'Skyline Heights Residency');

  // Search by employee code
  const firstEmp = ws.employees[0];
  const empCodeRes = searchWorkspaceEntities({
    query: firstEmp.empCode,
    projects: ws.projects,
    towers: ws.towers,
    flats: ws.flats,
    employees: ws.employees,
  });
  assert.equal(empCodeRes.employees[0]?.id, firstEmp.id);
  assert.equal(empCodeRes.employees[0]?.code, firstEmp.empCode);

  // Search by flat unit number and exact flat ID
  const targetFlat = ws.flats[0];
  const flatByUnit = searchWorkspaceEntities({
    query: targetFlat.unitNumber,
    projects: ws.projects,
    towers: ws.towers,
    flats: ws.flats,
    employees: ws.employees,
  });
  assert.equal(flatByUnit.flats.some((f) => f.id === targetFlat.id), true);

  const flatById = searchWorkspaceEntities({
    query: targetFlat.id,
    projects: ws.projects,
    towers: ws.towers,
    flats: ws.flats,
    employees: ws.employees,
  });
  assert.equal(flatById.flats[0]?.id, targetFlat.id);
});

test('searchWorkspaceEntities returns empty groups on blank query and respects group limit', () => {
  const ws = createSeedWorkspace('test-owner');

  const blankRes = searchWorkspaceEntities({
    query: '   ',
    projects: ws.projects,
    towers: ws.towers,
    flats: ws.flats,
    employees: ws.employees,
  });
  assert.equal(blankRes.totalCount, 0);
  assert.equal(blankRes.ordered.length, 0);

  const limitedRes = searchWorkspaceEntities({
    query: '1',
    projects: ws.projects,
    towers: ws.towers,
    flats: ws.flats,
    employees: ws.employees,
    limitPerGroup: 2,
  });
  assert.equal(limitedRes.flats.length <= 2, true);
  assert.equal(limitedRes.employees.length <= 2, true);
  assert.equal(limitedRes.projects.length <= 2, true);
});
