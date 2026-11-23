import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  buildOtpAuthUri,
  canDeveloperPerform,
  classifyRepoPath,
  computeExpiryIso,
  createEmptyPermissions,
  decryptBackupPayload,
  encryptBackupPayload,
  generateTotpCode,
  generateTotpSecret,
  hashSecretScrypt,
  isAccessExpired,
  isAccountLocked,
  maskSecretValue,
  resolveSafeRepoPath,
  sanitizePermissionsInput,
  signSessionToken,
  validateStrongPassword,
  validateUsername,
  verifySecretScrypt,
  verifySessionToken,
  verifyTotpCode,
} from './devsecCore.ts';

test('scrypt password hashing verifies matching password and rejects wrong password', () => {
  const hash = hashSecretScrypt('AvyOwner#2026');
  assert.ok(hash.startsWith('scrypt:'));
  assert.equal(verifySecretScrypt('AvyOwner#2026', hash), true);
  assert.equal(verifySecretScrypt('WrongPass#2026', hash), false);
});

test('strong password and username validators enforce strict rules', () => {
  assert.equal(validateStrongPassword('weak').valid, false);
  assert.equal(validateStrongPassword('alllowercase12!').valid, false);
  assert.equal(validateStrongPassword('NoSpecialChar123').valid, false);
  assert.equal(validateStrongPassword('ValidDev@2026').valid, true);

  assert.equal(validateUsername('ab').valid, false);
  assert.equal(validateUsername('owner').valid, false);
  assert.equal(validateUsername('Ravi_Dev01').valid, true);
  assert.equal(validateUsername('Ravi_Dev01').normalized, 'ravi_dev01');
});

test('RFC 6238 TOTP 2FA verifies current code, builds URI, and blocks replay', () => {
  const secret = generateTotpSecret();
  const uri = buildOtpAuthUri('ravi_dev', secret);
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.ok(uri.includes(secret));

  const nowMs = 1_700_000_000_000;
  const code = generateTotpCode(secret, nowMs);
  assert.match(code, /^\d{6}$/);

  const firstCheck = verifyTotpCode(secret, code, { timeMs: nowMs, lastAcceptedCounter: null });
  assert.equal(firstCheck.valid, true);
  assert.ok(firstCheck.matchedCounter !== null);

  const replayCheck = verifyTotpCode(secret, code, {
    timeMs: nowMs,
    lastAcceptedCounter: firstCheck.matchedCounter,
  });
  assert.equal(replayCheck.valid, false);

  const badCheck = verifyTotpCode(secret, '000000', { timeMs: nowMs });
  assert.equal(badCheck.valid, false);
});

test('HMAC session token respects signing secret, expiry, and credential rotation epoch', () => {
  const secret = 'test-signing-secret-32-bytes-long!';
  const now = 1_700_000_000_000;
  const token = signSessionToken(
    {
      sid: 'sess-1',
      actorType: 'developer',
      accountId: 'dev-1',
      username: 'dev_ravi',
      keyEpoch: 2,
      iat: now,
      exp: now + 60_000,
    },
    secret
  );

  assert.equal(verifySessionToken(token, secret, 2, now + 10_000).valid, true);
  assert.equal(verifySessionToken(token, secret, 3, now + 10_000).valid, false);
  assert.equal(verifySessionToken(token, secret, 2, now + 65_000).valid, false);
  assert.equal(verifySessionToken(`${token}tamper`, secret, 2, now + 10_000).valid, false);
});

test('AES-256-GCM encrypted backup round-trips and fails on wrong key or tampering', () => {
  const payload = { files: { 'src/App.tsx': 'console.log("ok")' }, version: 1 };
  const envelope = encryptBackupPayload(payload, 'backup-master-secret', 1, '2026-11-23T12:00:00Z');
  assert.equal(envelope.algorithm, 'aes-256-gcm');

  const decrypted = decryptBackupPayload<typeof payload>(envelope, 'backup-master-secret');
  assert.deepEqual(decrypted, payload);

  assert.throws(() => decryptBackupPayload(envelope, 'wrong-secret'));
  const tampered = { ...envelope, ciphertextBase64: Buffer.from('tampered').toString('base64') };
  assert.throws(() => decryptBackupPayload(tampered, 'backup-master-secret'));
});

test('permissions default to all false and temporary access expiry + lockout are strictly enforced', () => {
  const empty = createEmptyPermissions();
  assert.equal(Object.values(empty).every((v) => v === false), true);

  const sanitized = sanitizePermissionsInput({ view_source: true, edit_backend: 'yes' as unknown as boolean });
  assert.equal(sanitized.view_source, true);
  assert.equal(sanitized.edit_backend, false);

  const now = 1_700_000_000_000;
  const exp1h = computeExpiryIso('1h', null, now);
  assert.equal(exp1h.valid, true);
  assert.equal(isAccessExpired(exp1h.expiresAt, now + 10_000), false);
  assert.equal(isAccessExpired(exp1h.expiresAt, now + 3_700_000), true);

  const badCustom = computeExpiryIso('custom', new Date(now - 10_000).toISOString(), now);
  assert.equal(badCustom.valid, false);

  const account = {
    status: 'approved' as const,
    emailVerified: true,
    permissions: sanitizePermissionsInput({ view_source: true }),
    accessExpiresAt: exp1h.expiresAt,
    lockedUntil: null,
  };

  assert.equal(canDeveloperPerform(account, 'view_source', now + 10_000).allowed, true);
  assert.equal(canDeveloperPerform(account, 'download_source', now + 10_000).allowed, false);
  assert.equal(canDeveloperPerform(account, 'view_source', now + 3_700_000).allowed, false);
  assert.equal(
    canDeveloperPerform({ ...account, status: 'revoked' }, 'view_source', now + 10_000).allowed,
    false
  );
  assert.equal(
    canDeveloperPerform(
      { ...account, lockedUntil: new Date(now + 60_000).toISOString() },
      'view_source',
      now + 10_000
    ).allowed,
    false
  );
  assert.equal(isAccountLocked(new Date(now + 60_000).toISOString(), now), true);
});

test('path confinement blocks .env, .git, .devsec-vault, and traversal escapes', () => {
  const root = path.resolve('/tmp/fake-app');
  assert.equal(resolveSafeRepoPath(root, '.env').safe, false);
  assert.equal(resolveSafeRepoPath(root, '.env.local').safe, false);
  assert.equal(resolveSafeRepoPath(root, '.env.example').safe, true);
  assert.equal(resolveSafeRepoPath(root, '../etc/passwd').safe, false);
  assert.equal(resolveSafeRepoPath(root, '.devsec-vault/vault.json').safe, false);
  assert.equal(resolveSafeRepoPath(root, 'node_modules/react/index.js').safe, false);
  assert.equal(resolveSafeRepoPath(root, 'src/App.tsx').safe, true);

  assert.equal(classifyRepoPath('src/App.tsx'), 'frontend');
  assert.equal(classifyRepoPath('server.ts'), 'backend');
  assert.equal(classifyRepoPath('firebase-blueprint.json'), 'schema');
  assert.equal(classifyRepoPath('package.json'), 'config');
  assert.equal(maskSecretValue('AIzaSyFakeSecret1234'), '••••1234');
  assert.equal(maskSecretValue('MY_GEMINI_API_KEY'), 'Not Configured');
});
