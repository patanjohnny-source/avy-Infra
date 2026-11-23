import crypto from 'node:crypto';
import path from 'node:path';
import type {
  AccessDurationPreset,
  DeveloperAccountStatus,
  DevPermissionKey,
  DevPermissions,
} from '../src/types/devsec.ts';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function createEmptyPermissions(): DevPermissions {
  return {
    view_source: false,
    edit_frontend: false,
    edit_backend: false,
    access_db_schema: false,
    access_api_config: false,
    deploy_updates: false,
    download_source: false,
    access_hosting: false,
    view_logs: false,
  };
}

export function sanitizePermissionsInput(input: Partial<DevPermissions> | undefined): DevPermissions {
  const base = createEmptyPermissions();
  if (!input || typeof input !== 'object') return base;
  (Object.keys(base) as DevPermissionKey[]).forEach((k) => {
    base[k] = input[k] === true;
  });
  return base;
}

export function validateStrongPassword(password: string): { valid: boolean; reason?: string } {
  if (typeof password !== 'string') {
    return { valid: false, reason: 'Password is required.' };
  }
  if (password.length < 10) {
    return { valid: false, reason: 'Password must be at least 10 characters long.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, reason: 'Password must include at least one uppercase letter.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, reason: 'Password must include at least one lowercase letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, reason: 'Password must include at least one number.' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, reason: 'Password must include at least one special character.' };
  }
  return { valid: true };
}

export function validateUsername(username: string): { valid: boolean; normalized: string; reason?: string } {
  const normalized = (username || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      reason: 'Username must be 3-32 characters, start with a letter, and contain only letters, digits, ., _, or -.',
    };
  }
  if (normalized === 'owner' || normalized === 'masterowner' || normalized === 'root') {
    return {
      valid: false,
      normalized,
      reason: 'Reserved system username cannot be registered as a developer account.',
    };
  }
  return { valid: true, normalized };
}

export function hashSecretScrypt(secret: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(secret, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifySecretScrypt(secret: string, storedHash: string): boolean {
  if (!secret || !storedHash || !storedHash.startsWith('scrypt:')) {
    return false;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [, salt, hexDigest] = parts;
  if (!salt || !hexDigest) return false;
  try {
    const derived = crypto.scryptSync(secret, salt, 64);
    const expected = Buffer.from(hexDigest, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buf.length; i += 1) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(str: string): Buffer {
  const cleaned = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function buildOtpAuthUri(username: string, secret: string, issuer = 'AVY INFRA DevSec'): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

export function getTotpCounter(timeMs = Date.now(), periodSec = 30): number {
  return Math.floor(timeMs / 1000 / periodSec);
}

export function generateTotpCodeForCounter(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function generateTotpCode(secret: string, timeMs = Date.now()): string {
  return generateTotpCodeForCounter(secret, getTotpCounter(timeMs));
}

export function verifyTotpCode(
  secret: string,
  code: string,
  opts?: { timeMs?: number; window?: number; lastAcceptedCounter?: number | null }
): { valid: boolean; matchedCounter: number | null; reason?: string } {
  const cleanedCode = (code || '').trim();
  if (!/^\d{6}$/.test(cleanedCode)) {
    return { valid: false, matchedCounter: null, reason: '2FA code must be a 6-digit number.' };
  }
  const timeMs = opts?.timeMs ?? Date.now();
  const window = opts?.window ?? 1;
  const currentCounter = getTotpCounter(timeMs);

  for (let delta = -window; delta <= window; delta += 1) {
    const candidateCounter = currentCounter + delta;
    if (candidateCounter < 0) continue;
    const expected = generateTotpCodeForCounter(secret, candidateCounter);
    const a = Buffer.from(cleanedCode, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      if (
        opts?.lastAcceptedCounter !== undefined &&
        opts?.lastAcceptedCounter !== null &&
        candidateCounter <= opts.lastAcceptedCounter
      ) {
        return {
          valid: false,
          matchedCounter: null,
          reason: 'This 2FA code has already been used. Wait for the next 30-second code.',
        };
      }
      return { valid: true, matchedCounter: candidateCounter };
    }
  }
  return { valid: false, matchedCounter: null, reason: 'Invalid 2FA verification code.' };
}

export interface SessionTokenPayload {
  sid: string;
  actorType: 'owner' | 'developer';
  accountId: string;
  username: string;
  keyEpoch: number;
  iat: number;
  exp: number;
}

export function signSessionToken(payload: SessionTokenPayload, signingSecret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', signingSecret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${sig}`;
}

export function verifySessionToken(
  token: string,
  signingSecret: string,
  expectedEpoch: number,
  nowMs = Date.now()
): { valid: boolean; payload: SessionTokenPayload | null; reason?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, payload: null, reason: 'Missing session token.' };
  }
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0 || dotIdx === token.length - 1) {
    return { valid: false, payload: null, reason: 'Malformed session token.' };
  }
  const encodedPayload = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  const expectedSig = crypto
    .createHmac('sha256', signingSecret)
    .update(encodedPayload)
    .digest('base64url');

  const sigA = Buffer.from(providedSig, 'utf8');
  const sigB = Buffer.from(expectedSig, 'utf8');
  if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
    return { valid: false, payload: null, reason: 'Invalid token signature.' };
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as SessionTokenPayload;
    if (!parsed || typeof parsed.sid !== 'string' || typeof parsed.exp !== 'number') {
      return { valid: false, payload: null, reason: 'Corrupted session payload.' };
    }
    if (parsed.keyEpoch !== expectedEpoch) {
      return { valid: false, payload: null, reason: 'Session invalidated by credential rotation.' };
    }
    if (nowMs >= parsed.exp) {
      return { valid: false, payload: null, reason: 'Session expired.' };
    }
    return { valid: true, payload: parsed };
  } catch {
    return { valid: false, payload: null, reason: 'Unreadable session payload.' };
  }
}

export interface EncryptedBackupEnvelope {
  format: 'avy-infra-encrypted-backup-v1';
  algorithm: 'aes-256-gcm';
  keyEpoch: number;
  createdAt: string;
  ivHex: string;
  authTagHex: string;
  ciphertextBase64: string;
}

function deriveAes256Key(keyMaterial: string): Buffer {
  return crypto.createHash('sha256').update(`avy-backup:${keyMaterial}`).digest();
}

export function encryptBackupPayload(
  plainData: unknown,
  keyMaterial: string,
  keyEpoch: number,
  createdAt = new Date().toISOString()
): EncryptedBackupEnvelope {
  const key = deriveAes256Key(keyMaterial);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(plainData);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    format: 'avy-infra-encrypted-backup-v1',
    algorithm: 'aes-256-gcm',
    keyEpoch,
    createdAt,
    ivHex: iv.toString('hex'),
    authTagHex: authTag.toString('hex'),
    ciphertextBase64: encrypted.toString('base64'),
  };
}

export function decryptBackupPayload<T = unknown>(
  envelope: EncryptedBackupEnvelope,
  keyMaterial: string
): T {
  if (!envelope || envelope.format !== 'avy-infra-encrypted-backup-v1') {
    throw new Error('Unsupported backup envelope format.');
  }
  const key = deriveAes256Key(keyMaterial);
  const iv = Buffer.from(envelope.ivHex, 'hex');
  const authTag = Buffer.from(envelope.authTagHex, 'hex');
  const ciphertext = Buffer.from(envelope.ciphertextBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted) as T;
}

const PRESET_MS: Record<Exclude<AccessDurationPreset, 'custom'>, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export function computeExpiryIso(
  preset: AccessDurationPreset,
  customExpiresAt?: string | null,
  nowMs = Date.now()
): { valid: boolean; expiresAt: string | null; reason?: string } {
  if (preset === 'custom') {
    if (!customExpiresAt) {
      return { valid: false, expiresAt: null, reason: 'Custom expiration date & time is required.' };
    }
    const parsedMs = Date.parse(customExpiresAt);
    if (!Number.isFinite(parsedMs)) {
      return { valid: false, expiresAt: null, reason: 'Invalid custom expiration date format.' };
    }
    if (parsedMs <= nowMs + 60_000) {
      return {
        valid: false,
        expiresAt: null,
        reason: 'Custom expiration must be at least 1 minute in the future.',
      };
    }
    return { valid: true, expiresAt: new Date(parsedMs).toISOString() };
  }

  const duration = PRESET_MS[preset];
  if (!duration) {
    return { valid: false, expiresAt: null, reason: 'Unsupported access duration preset.' };
  }
  return { valid: true, expiresAt: new Date(nowMs + duration).toISOString() };
}

export function isAccessExpired(expiresAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!expiresAt) return true;
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) return true;
  return nowMs >= parsed;
}

export function isAccountLocked(lockedUntil: string | null | undefined, nowMs = Date.now()): boolean {
  if (!lockedUntil) return false;
  const parsed = Date.parse(lockedUntil);
  return Number.isFinite(parsed) && nowMs < parsed;
}

export interface EvaluatableDeveloperAccount {
  status: DeveloperAccountStatus;
  emailVerified: boolean;
  permissions: DevPermissions;
  accessExpiresAt: string | null;
  lockedUntil: string | null;
}

export function canDeveloperPerform(
  account: EvaluatableDeveloperAccount | null | undefined,
  requiredPermission: DevPermissionKey,
  nowMs = Date.now()
): { allowed: boolean; reason?: string } {
  if (!account) {
    return { allowed: false, reason: 'Developer account not found.' };
  }
  if (account.status === 'disabled') {
    return { allowed: false, reason: 'Developer account is disabled by the Owner.' };
  }
  if (account.status === 'revoked') {
    return { allowed: false, reason: 'Developer access has been revoked by the Owner.' };
  }
  if (account.status !== 'approved') {
    return { allowed: false, reason: 'Developer access request has not been approved by the Owner.' };
  }
  if (!account.emailVerified) {
    return { allowed: false, reason: 'Developer email verification is required.' };
  }
  if (isAccountLocked(account.lockedUntil, nowMs)) {
    return { allowed: false, reason: 'Developer account is temporarily locked due to failed attempts.' };
  }
  if (isAccessExpired(account.accessExpiresAt, nowMs)) {
    return { allowed: false, reason: 'Temporary developer access window has expired.' };
  }
  if (account.permissions[requiredPermission] !== true) {
    return {
      allowed: false,
      reason: `Missing Owner-granted permission: ${requiredPermission}.`,
    };
  }
  return { allowed: true };
}

const BLOCKED_EXACT_NAMES = new Set([
  '.git',
  '.devsec-vault',
  'node_modules',
  'dist',
  'build',
  '.playwright-cli',
  'devsec-vault.json',
]);

export function isBlockedRepoPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) return true;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return true;

  for (const seg of segments) {
    if (seg === '.' || seg === '..') return true;
    if (BLOCKED_EXACT_NAMES.has(seg)) return true;
    if (seg.startsWith('.env') && seg !== '.env.example') return true;
    if (/\.(pem|key|p12|pfx|keystore)$/i.test(seg)) return true;
  }
  return false;
}

export function resolveSafeRepoPath(
  rootDir: string,
  relPath: string
): { safe: boolean; normalizedRel: string; absolutePath: string; reason?: string } {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    return { safe: false, normalizedRel: '', absolutePath: '', reason: 'File path is required.' };
  }
  const cleaned = relPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (path.isAbsolute(relPath) || isBlockedRepoPath(cleaned)) {
    return {
      safe: false,
      normalizedRel: cleaned,
      absolutePath: '',
      reason: 'Access to protected environment, vault, or out-of-bounds path is blocked.',
    };
  }
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, cleaned);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    return {
      safe: false,
      normalizedRel: cleaned,
      absolutePath: '',
      reason: 'Path traversal outside application root is forbidden.',
    };
  }
  const canonicalRel = path.relative(resolvedRoot, resolvedTarget).replace(/\\/g, '/');
  if (isBlockedRepoPath(canonicalRel)) {
    return {
      safe: false,
      normalizedRel: canonicalRel,
      absolutePath: '',
      reason: 'Access to protected files is blocked.',
    };
  }
  return {
    safe: true,
    normalizedRel: canonicalRel,
    absolutePath: resolvedTarget,
  };
}

export function classifyRepoPath(
  relPath: string
): 'frontend' | 'backend' | 'schema' | 'config' | 'other' {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (
    norm.startsWith('src/') ||
    norm === 'index.html' ||
    norm.startsWith('public/')
  ) {
    return 'frontend';
  }
  if (
    norm === 'server.ts' ||
    norm.startsWith('server/') ||
    norm === 'vite.config.ts'
  ) {
    return 'backend';
  }
  if (
    norm === 'firebase-blueprint.json' ||
    norm === 'firestore.rules' ||
    norm === 'firebase-applet-config.json'
  ) {
    return 'schema';
  }
  if (
    norm === 'package.json' ||
    norm === 'tsconfig.json' ||
    norm === 'metadata.json' ||
    norm === '.env.example'
  ) {
    return 'config';
  }
  return 'other';
}

export function maskSecretValue(raw: string | undefined | null): string {
  const val = (raw || '').trim();
  if (!val || val === 'MY_GEMINI_API_KEY' || val === 'MY_GOOGLE_MAPS_API_KEY' || val === 'MY_APP_URL') {
    return 'Not Configured';
  }
  if (val.length <= 6) {
    return '••••••';
  }
  return `••••${val.slice(-4)}`;
}
