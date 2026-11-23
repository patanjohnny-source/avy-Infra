import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateTotpCode } from './devsecCore.ts';
import { createDevSecRouter } from './devsecRoutes.ts';
import { DevSecStore } from './devsecStore.ts';

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avy-devsec-test-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'Sample.tsx'), 'export const v = 1;\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'server.ts'), '// backend entry\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET_KEY=top-secret-never-leak\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'firebase-blueprint.json'), '{"entities":{}}\n', 'utf8');
  return dir;
}

test('DevSecStore full lifecycle: claim owner, register/verify/2FA/lockout dev, approve scoped perms, version restore, backup, emergency revoke', async () => {
  const tmpDir = makeTempProject();
  try {
    const store = new DevSecStore(tmpDir);
    assert.equal(store.getStatus().ownerClaimed, false);

    // 1. Claim Master Owner
    const claim = store.claimOwnerAccount({
      username: 'avyowner',
      email: 'owner@avyinfra.com',
      password: 'OwnerMaster#2026',
      ipAddress: '127.0.0.1',
      userAgent: 'node-test',
    });
    assert.equal(claim.ok, true);
    if (!claim.ok) return;
    assert.equal(store.getStatus().ownerClaimed, true);

    // Second claim must fail
    const secondClaim = store.claimOwnerAccount({
      username: 'attacker',
      email: 'a@b.com',
      password: 'OwnerMaster#2026',
      ipAddress: '127.0.0.1',
      userAgent: 'node-test',
    });
    assert.equal(secondClaim.ok, false);

    // 2. Register Developer
    const reg = await store.registerDeveloper({
      username: 'dev_arjun',
      email: 'arjun@contractor.io',
      fullName: 'Arjun Contractor',
      roleTitle: 'Frontend Engineer',
      requestReason: 'UI fixes on flat matrix',
      password: 'DevStrong#2026',
      ipAddress: '10.0.0.5',
    });
    assert.equal(reg.ok, true);
    if (!reg.ok) return;
    assert.equal(reg.account.status, 'pending');
    assert.equal(Object.values(reg.account.permissions).every((v) => v === false), true);

    // Verify email
    const badVerify = store.verifyDeveloperEmail({
      username: 'dev_arjun',
      code: '000000',
      ipAddress: '10.0.0.5',
    });
    assert.equal(badVerify.ok, false);

    const goodVerify = store.verifyDeveloperEmail({
      username: 'dev_arjun',
      code: reg.emailVerificationPreviewCode,
      ipAddress: '10.0.0.5',
    });
    assert.equal(goodVerify.ok, true);

    // Login before Owner approval must fail
    const totp1 = generateTotpCode(reg.totpSetup.secret);
    const pendingLogin = store.loginDeveloper({
      username: 'dev_arjun',
      password: 'DevStrong#2026',
      totpCode: totp1,
      ipAddress: '10.0.0.5',
      userAgent: 'node-test',
    });
    assert.equal(pendingLogin.ok, false);

    // 3. Owner approves with view_source + edit_frontend ONLY (no edit_backend, no download_source) for 1h
    const approval = store.approveOrUpdateDeveloper({
      ownerUsername: 'avyowner',
      developerId: reg.account.id,
      decision: 'approve',
      permissions: { view_source: true, edit_frontend: true },
      durationPreset: '1h',
      reviewNote: 'Approved for frontend view & edits only',
      ipAddress: '127.0.0.1',
    });
    assert.equal(approval.ok, true);

    // 4. Test lockout after 5 wrong password attempts then Owner re-enables
    for (let i = 0; i < 5; i += 1) {
      const fail = store.loginDeveloper({
        username: 'dev_arjun',
        password: 'WrongPassword!1',
        totpCode: '123456',
        ipAddress: '10.0.0.5',
        userAgent: 'node-test',
      });
      assert.equal(fail.ok, false);
    }
    const lockedRes = store.loginDeveloper({
      username: 'dev_arjun',
      password: 'DevStrong#2026',
      totpCode: generateTotpCode(reg.totpSetup.secret, Date.now() + 31_000),
      ipAddress: '10.0.0.5',
      userAgent: 'node-test',
    });
    assert.equal(lockedRes.ok, false);
    assert.equal(lockedRes.status, 423);

    // Owner unlocks/enables
    store.approveOrUpdateDeveloper({
      ownerUsername: 'avyowner',
      developerId: reg.account.id,
      decision: 'enable',
      ipAddress: '127.0.0.1',
    });

    // 5. Developer logs in cleanly with future 2FA step
    const devLogin = store.loginDeveloper({
      username: 'dev_arjun',
      password: 'DevStrong#2026',
      totpCode: generateTotpCode(reg.totpSetup.secret, Date.now() + 62_000),
      ipAddress: '10.0.0.5',
      userAgent: 'node-test',
    });
    // Note: totp verifier checks current server time +/- 1 step; let's test with current time step +1 (within +/-1 window)
    const devLoginValid = devLogin.ok
      ? devLogin
      : store.loginDeveloper({
          username: 'dev_arjun',
          password: 'DevStrong#2026',
          totpCode: generateTotpCode(reg.totpSetup.secret, Date.now() + 30_000),
          ipAddress: '10.0.0.5',
          userAgent: 'node-test',
        });
    assert.equal(devLoginValid.ok, true);
    if (!devLoginValid.ok) return;

    const authDev = store.authenticateToken(`Bearer ${devLoginValid.token}`);
    assert.equal(authDev.ok, true);
    assert.ok(authDev.context);

    // Repository listing must NEVER include .env
    const files = store.listRepositoryFiles();
    assert.equal(files.some((f) => f.path === '.env'), false);
    assert.equal(files.some((f) => f.path === 'src/Sample.tsx'), true);

    // Dev can view & edit frontend file
    const readOk = store.readRepositoryFile(authDev.context!, 'src/Sample.tsx', '10.0.0.5');
    assert.equal(readOk.ok, true);

    const writeFrontend = store.writeRepositoryFile(
      authDev.context!,
      'src/Sample.tsx',
      'export const v = 2;\n',
      'Update Sample v2',
      '10.0.0.5'
    );
    assert.equal(writeFrontend.ok, true);
    if (!writeFrontend.ok) return;

    // Dev CANNOT edit backend file
    const writeBackend = store.writeRepositoryFile(
      authDev.context!,
      'server.ts',
      '// hacked',
      'Attempt backend edit',
      '10.0.0.5'
    );
    assert.equal(writeBackend.ok, false);
    assert.equal(writeBackend.status, 403);

    // Dev CANNOT download source without download_source permission
    const dlCheck = store.checkDeveloperPermission(
      authDev.context!,
      'download_source',
      '10.0.0.5',
      'DOWNLOAD_SOURCE',
      'bundle'
    );
    assert.equal(dlCheck.allowed, false);

    // 6. Owner restores version snapshot back to v1
    const restored = store.restoreVersionSnapshot(
      'avyowner',
      writeFrontend.snapshot.id,
      '127.0.0.1'
    );
    assert.equal(restored.ok, true);
    assert.equal(
      fs.readFileSync(path.join(tmpDir, 'src', 'Sample.tsx'), 'utf8'),
      'export const v = 1;\n'
    );

    // 7. Encrypted backup creation & restore
    const backup = store.createEncryptedBackup('avyowner', 'Pre-release Backup', '127.0.0.1');
    assert.equal(backup.ok, true);
    fs.writeFileSync(path.join(tmpDir, 'src', 'Sample.tsx'), 'corrupted', 'utf8');
    const restoreBak = store.restoreFromEncryptedBackup(
      'avyowner',
      backup.metadata.id,
      '127.0.0.1'
    );
    assert.equal(restoreBak.ok, true);
    assert.equal(
      fs.readFileSync(path.join(tmpDir, 'src', 'Sample.tsx'), 'utf8'),
      'export const v = 1;\n'
    );

    // 8. Emergency revoke invalidates dev token immediately
    store.emergencyControl('avyowner', 'revoke_all_developers', '127.0.0.1');
    const afterRevoke = store.authenticateToken(`Bearer ${devLoginValid.token}`);
    assert.equal(afterRevoke.ok, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('DevSecStore unverified email 403 preserves TOTP code and supports resend verification + Owner verify_email', async () => {
  const tmpDir = makeTempProject();
  try {
    const store = new DevSecStore(tmpDir);
    store.claimOwnerAccount({
      username: 'avyowner',
      email: 'owner@avyinfra.com',
      password: 'OwnerMaster#2026',
      ipAddress: '127.0.0.1',
      userAgent: 'node-test',
    });

    const reg = await store.registerDeveloper({
      username: 'dev_mehek',
      email: 'mehek@contractor.io',
      fullName: 'Mehek Dev',
      roleTitle: 'Frontend Dev',
      requestReason: 'Dashboard updates',
      password: 'DevStrong#2026',
      ipAddress: '10.0.0.8',
    });
    assert.equal(reg.ok, true);
    if (!reg.ok) return;

    // Owner approves before developer finishes email verification
    store.approveOrUpdateDeveloper({
      ownerUsername: 'avyowner',
      developerId: reg.account.id,
      decision: 'approve',
      permissions: { view_source: true },
      durationPreset: '24h',
      ipAddress: '127.0.0.1',
    });

    // Attempting login before email verification returns 403 EMAIL_UNVERIFIED and MUST NOT burn the TOTP code
    const sharedTotp = generateTotpCode(reg.totpSetup.secret);
    const blocked = store.loginDeveloper({
      username: 'dev_mehek',
      password: 'DevStrong#2026',
      totpCode: sharedTotp,
      ipAddress: '10.0.0.8',
      userAgent: 'node-test',
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 403);
    if (!blocked.ok && 'code' in blocked) {
      assert.equal(blocked.code, 'EMAIL_UNVERIFIED');
    }

    // Resend rejects wrong password
    const badResend = store.resendDeveloperVerificationCode({
      username: 'dev_mehek',
      password: 'WrongPassword!1',
      ipAddress: '10.0.0.8',
    });
    assert.equal(badResend.ok, false);
    assert.equal(badResend.status, 401);

    // Resend succeeds with valid password and issues new code
    const goodResend = store.resendDeveloperVerificationCode({
      username: 'dev_mehek',
      password: 'DevStrong#2026',
      ipAddress: '10.0.0.8',
    });
    assert.equal(goodResend.ok, true);
    if (!goodResend.ok || !goodResend.emailVerificationPreviewCode) return;

    // Verify with new code
    const verified = store.verifyDeveloperEmail({
      username: 'dev_mehek',
      code: goodResend.emailVerificationPreviewCode,
      ipAddress: '10.0.0.8',
    });
    assert.equal(verified.ok, true);

    // Same TOTP step still works because the earlier 403 did not consume it
    const success = store.loginDeveloper({
      username: 'dev_mehek',
      password: 'DevStrong#2026',
      totpCode: sharedTotp,
      ipAddress: '10.0.0.8',
      userAgent: 'node-test',
    });
    assert.equal(success.ok, true);

    // Owner verify_email decision marks a second unverified developer as verified
    const reg2 = await store.registerDeveloper({
      username: 'dev_second',
      email: 'second@contractor.io',
      fullName: 'Second Dev',
      roleTitle: 'Backend Dev',
      requestReason: 'API work',
      password: 'DevStrong#2026',
      ipAddress: '10.0.0.9',
    });
    assert.equal(reg2.ok, true);
    if (!reg2.ok) return;
    const ownerVerify = store.approveOrUpdateDeveloper({
      ownerUsername: 'avyowner',
      developerId: reg2.account.id,
      decision: 'verify_email',
      ipAddress: '127.0.0.1',
    });
    assert.equal(ownerVerify.ok, true);
    if (ownerVerify.ok) {
      assert.equal(ownerVerify.account.emailVerified, true);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createDevSecRouter maps logical 403 errors to HTTP 422 with JSON status 403 & error code for Nginx safety', async () => {
  const tmpDir = makeTempProject();
  const store = new DevSecStore(tmpDir);
  store.claimOwnerAccount({
    username: 'avyowner',
    email: 'owner@avyinfra.com',
    password: 'OwnerMaster#2026',
    ipAddress: '127.0.0.1',
    userAgent: 'node-test',
  });

  const regUnverified = await store.registerDeveloper({
    username: 'dev_unverified_http',
    email: 'unverified@contractor.io',
    fullName: 'Unverified Dev',
    roleTitle: 'Frontend Dev',
    requestReason: 'Testing HTTP 403 mapping',
    password: 'DevStrong#2026',
    ipAddress: '10.0.0.12',
  });
  assert.equal(regUnverified.ok, true);
  if (!regUnverified.ok) return;

  const regVerified = await store.registerDeveloper({
    username: 'dev_verified_http',
    email: 'verified@contractor.io',
    fullName: 'Verified Dev',
    roleTitle: 'Frontend Dev',
    requestReason: 'Testing permission check',
    password: 'DevStrong#2026',
    ipAddress: '10.0.0.13',
  });
  assert.equal(regVerified.ok, true);
  if (!regVerified.ok) return;

  store.verifyDeveloperEmail({
    username: 'dev_verified_http',
    code: regVerified.emailVerificationPreviewCode,
    ipAddress: '10.0.0.13',
  });
  store.approveOrUpdateDeveloper({
    ownerUsername: 'avyowner',
    developerId: regVerified.account.id,
    decision: 'approve',
    permissions: { view_source: true },
    durationPreset: '24h',
    ipAddress: '127.0.0.1',
  });
  const devLogin = store.loginDeveloper({
    username: 'dev_verified_http',
    password: 'DevStrong#2026',
    totpCode: generateTotpCode(regVerified.totpSetup.secret),
    ipAddress: '10.0.0.13',
    userAgent: 'node-test',
  });
  assert.equal(devLogin.ok, true);
  if (!devLogin.ok) return;

  const app = express();
  app.use(express.json());
  app.use('/api/devsec', createDevSecRouter(store));

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Expected TCP port');
    const baseUrl = `http://127.0.0.1:${addr.port}/api/devsec`;

    // 1. Unverified developer login returns HTTP 422 (NOT 403) with status: 403 & code: EMAIL_UNVERIFIED
    const unverifiedRes = await fetch(`${baseUrl}/dev/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'dev_unverified_http',
        password: 'DevStrong#2026',
        totpCode: generateTotpCode(regUnverified.totpSetup.secret),
      }),
    });
    assert.equal(unverifiedRes.status, 422);
    const unverifiedJson = (await unverifiedRes.json()) as { status?: number; code?: string; error?: string };
    assert.equal(unverifiedJson.status, 403);
    assert.equal(unverifiedJson.code, 'EMAIL_UNVERIFIED');
    assert.match(unverifiedJson.error || '', /verify your email/i);

    // 2. Developer calling Owner dashboard returns HTTP 422 with status: 403 & OWNER_REQUIRED
    const ownerOnlyRes = await fetch(`${baseUrl}/owner/dashboard`, {
      headers: { Authorization: `Bearer ${devLogin.token}` },
    });
    assert.equal(ownerOnlyRes.status, 422);
    const ownerOnlyJson = (await ownerOnlyRes.json()) as { status?: number; code?: string };
    assert.equal(ownerOnlyJson.status, 403);
    assert.equal(ownerOnlyJson.code, 'OWNER_REQUIRED');

    // 3. Developer without download_source permission returns HTTP 422 with status: 403 & PERMISSION_DENIED
    const permRes = await fetch(`${baseUrl}/source/download`, {
      headers: { Authorization: `Bearer ${devLogin.token}` },
    });
    assert.equal(permRes.status, 422);
    const permJson = (await permRes.json()) as { status?: number; code?: string };
    assert.equal(permJson.status, 403);
    assert.equal(permJson.code, 'PERMISSION_DENIED');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


