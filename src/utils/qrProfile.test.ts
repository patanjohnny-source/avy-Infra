import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedWorkspace } from '../data/seedData';
import {
  buildEmployeeQrPassData,
  buildEmployeeQrScanUrl,
  decodeQrSnapshot,
  encodeQrSnapshot,
  generateQrPassToken,
  generateQrSvgString,
  parseQrScanParams,
  resolveScannedQrProfile,
} from './qrProfile';

test('generateQrPassToken generates valid >=16 char Firestore IDs', () => {
  const t1 = generateQrPassToken();
  const t2 = generateQrPassToken();
  assert.ok(t1.length >= 20);
  assert.notEqual(t1, t2);
  assert.match(t1, /^[a-zA-Z0-9_-]+$/);
});

test('buildEmployeeQrPassData extracts deployment, active work, and excludes sensitive PII', () => {
  const ws = createSeedWorkspace('local-avy-infra');
  const raju = ws.employees.find((e) => e.empCode === 'AVY-MSN-001');
  assert.ok(raju);

  const pass = buildEmployeeQrPassData({
    employee: raju,
    companyName: ws.companyProfile.companyName,
    projects: ws.projects,
    towers: ws.towers,
    deployments: ws.deployments,
    assignments: ws.assignments,
    attendance: ws.attendance,
    todayIso: '2026-11-17',
  });

  assert.equal(pass.empCode, 'AVY-MSN-001');
  assert.equal(pass.fullName, raju.fullName);
  assert.equal(pass.currentProjectName, 'Skyline Heights Residency');
  assert.equal(pass.currentTowerName, 'Tower A');
  assert.ok(pass.activeAssignments.length >= 1);
  assert.ok(pass.recentDeployments.length >= 1);

  // Ensure sensitive PII is absent
  const recordKeys = Object.keys(pass);
  for (const piiKey of ['phone', 'aadharRef', 'pfNumber', 'esiNumber', 'emergencyContact', 'dailyRate']) {
    assert.equal(recordKeys.includes(piiKey), false);
  }
});

test('encodeQrSnapshot and decodeQrSnapshot round-trip deployment & active work compactly', () => {
  const ws = createSeedWorkspace('local-avy-infra');
  const imran = ws.employees.find((e) => e.empCode === 'AVY-MSN-002');
  assert.ok(imran);

  const pass = buildEmployeeQrPassData({
    employee: imran,
    companyName: ws.companyProfile.companyName,
    projects: ws.projects,
    towers: ws.towers,
    deployments: ws.deployments,
    assignments: ws.assignments,
    attendance: ws.attendance,
  });

  const url = buildEmployeeQrScanUrl({
    origin: 'https://avy-infra.example.com',
    passData: pass,
    qrToken: 'qrp_testtoken1234567890',
  });
  assert.ok(url.includes('qrToken=qrp_testtoken1234567890'));
  assert.ok(url.includes(`qrEmp=${imran.id}`));

  const query = url.slice(url.indexOf('?'));
  const parsed = parseQrScanParams(query);
  assert.equal(parsed.hasQrScanRoute, true);
  assert.equal(parsed.qrToken, 'qrp_testtoken1234567890');
  assert.equal(parsed.qrEmp, imran.id);

  const decoded = decodeQrSnapshot(parsed.qrEncoded);
  assert.ok(decoded);
  assert.equal(decoded.empCode, 'AVY-MSN-002');
  assert.equal(decoded.currentProjectName, pass.currentProjectName);
  assert.equal(decoded.currentTowerName, pass.currentTowerName);
  assert.equal(decoded.activeAssignments.length, Math.min(4, pass.activeAssignments.length));

  // Invalid encoded snapshot safely returns null
  assert.equal(decodeQrSnapshot('not-valid-base64-!!!'), null);

  // Direct encode/decode check
  const rawEncoded = encodeQrSnapshot(pass);
  assert.ok(rawEncoded.length < 700);
});

test('resolveScannedQrProfile prefers live workspace over cloud pass and URL snapshot', () => {
  const ws = createSeedWorkspace('local-avy-infra');
  const raju = ws.employees.find((e) => e.empCode === 'AVY-MSN-001');
  assert.ok(raju);

  const oldPass = buildEmployeeQrPassData({
    employee: { ...raju, currentTowerName: 'Tower Old' },
    companyName: 'AVY INFRA',
    projects: ws.projects,
    towers: ws.towers,
    deployments: [],
    assignments: [],
    attendance: [],
  });
  const encodedOld = encodeQrSnapshot(oldPass);
  const scanParams = parseQrScanParams(`?qrEmp=${raju.id}&qr=${encodedOld}`);

  // When live workspace is available, live tower ('Tower A') overrides stale snapshot ('Tower Old')
  const liveResolved = resolveScannedQrProfile({
    scanParams,
    liveWorkspace: ws,
  });
  assert.equal(liveResolved.source, 'live_workspace');
  assert.equal(liveResolved.profile?.currentTowerName, 'Tower A');

  // When live workspace is absent (e.g. another phone), falls back to cloud pass, then URL snapshot
  const snapshotResolved = resolveScannedQrProfile({
    scanParams,
    liveWorkspace: null,
    remoteQrPass: null,
  });
  assert.equal(snapshotResolved.source, 'qr_snapshot');
  assert.equal(snapshotResolved.profile?.empCode, 'AVY-MSN-001');
});

test('generateQrSvgString outputs valid SVG markup', async () => {
  const svg = await generateQrSvgString('https://example.com/?qrEmp=emp_1');
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('</svg>'));
});

test('parseQrScanParams returns hasQrScanRoute=false for empty or unrelated search strings', () => {
  assert.equal(parseQrScanParams('').hasQrScanRoute, false);
  assert.equal(parseQrScanParams('?tab=workforce').hasQrScanRoute, false);
  assert.equal(parseQrScanParams('?qrToken=').hasQrScanRoute, false);
});
