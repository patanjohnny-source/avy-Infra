import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedWorkspace } from '../data/seedData';
import {
  buildEmployeeQrPassData,
  buildEmployeeQrScanUrl,
  buildSiteQrPassData,
  buildSiteQrScanUrl,
  decodeQrSnapshot,
  decodeSiteQrSnapshot,
  encodeQrSnapshot,
  encodeSiteQrSnapshot,
  generateQrPassToken,
  generateQrSvgString,
  parseQrScanParams,
  resolveScannedQrProfile,
  resolveScannedSiteQrProfile,
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
  assert.equal(parsed.scanKind, 'employee');
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

test('buildSiteQrPassData, snapshot encoding, URL parsing, and live/offline site resolution work end-to-end', () => {
  const ws = createSeedWorkspace('local-avy-infra');
  const proj = ws.projects.find((p) => p.id === 'proj_skyline_heights')!;
  const towerA = ws.towers.find((t) => t.id === 'twr_skyline_a')!;

  const sitePass = buildSiteQrPassData({
    project: proj,
    tower: towerA,
    companyName: ws.companyProfile.companyName,
    checkpointLabel: 'Tower Entrance',
    customTitle: 'Gate Check-In Point',
    customSubtitle: 'Scan on entry & shift handover',
    employees: ws.employees,
    flats: ws.flats,
    attendance: ws.attendance,
    todayIso: '2026-11-17',
  });

  assert.equal(sitePass.projectId, proj.id);
  assert.equal(sitePass.towerId, towerA.id);
  assert.equal(sitePass.towerName, 'Tower A');
  assert.equal(sitePass.checkpointLabel, 'Tower Entrance');
  assert.ok(sitePass.totalFlats > 0);

  const siteUrl = buildSiteQrScanUrl({
    origin: 'https://avy-infra.example.com',
    passData: sitePass,
  });
  assert.ok(siteUrl.includes(`qrSite=${proj.id}`));
  assert.ok(siteUrl.includes(`qrTower=${towerA.id}`));

  const parsed = parseQrScanParams(siteUrl.slice(siteUrl.indexOf('?')));
  assert.equal(parsed.hasQrScanRoute, true);
  assert.equal(parsed.scanKind, 'site');
  assert.equal(parsed.qrSite, proj.id);
  assert.equal(parsed.qrTower, towerA.id);

  const encoded = encodeSiteQrSnapshot(sitePass);
  const decoded = decodeSiteQrSnapshot(encoded);
  assert.ok(decoded);
  assert.equal(decoded?.projectName, proj.name);
  assert.equal(decoded?.checkpointLabel, 'Tower Entrance');
  assert.equal(decoded?.customTitle, 'Gate Check-In Point');
  assert.equal(decodeSiteQrSnapshot('invalid!!!'), null);

  // Offline / standalone fallback
  const snapshotOnly = resolveScannedSiteQrProfile({
    scanParams: parsed,
    liveWorkspace: null,
    todayIso: '2026-11-17',
  });
  assert.equal(snapshotOnly.source, 'qr_snapshot');
  assert.equal(snapshotOnly.siteProfile?.projectName, proj.name);
  assert.equal(snapshotOnly.siteProfile?.customTitle, 'Gate Check-In Point');

  // Live workspace overrides stale snapshot counts while preserving checkpoint metadata
  const liveResolved = resolveScannedSiteQrProfile({
    scanParams: parsed,
    liveWorkspace: ws,
    todayIso: '2026-11-17',
  });
  assert.equal(liveResolved.source, 'live_workspace');
  assert.equal(liveResolved.siteProfile?.towerName, 'Tower A');
  assert.equal(liveResolved.siteProfile?.checkpointLabel, 'Tower Entrance');
});

test('generateQrSvgString outputs valid SVG markup with custom color and error correction', async () => {
  const svg = await generateQrSvgString('https://example.com/?qrEmp=emp_1', {
    errorCorrectionLevel: 'H',
    darkColor: '#064e3b',
  });
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('</svg>'));
  assert.ok(svg.toLowerCase().includes('#064e3b'));
});

test('parseQrScanParams returns hasQrScanRoute=false for empty or unrelated search strings', () => {
  assert.equal(parseQrScanParams('').hasQrScanRoute, false);
  assert.equal(parseQrScanParams('?tab=workforce').hasQrScanRoute, false);
  assert.equal(parseQrScanParams('?qrToken=').hasQrScanRoute, false);
});
