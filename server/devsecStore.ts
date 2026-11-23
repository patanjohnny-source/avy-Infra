import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import {
  buildOtpAuthUri,
  canDeveloperPerform,
  classifyRepoPath,
  computeExpiryIso,
  createEmptyPermissions,
  decryptBackupPayload,
  encryptBackupPayload,
  type EncryptedBackupEnvelope,
  generateTotpSecret,
  hashSecretScrypt,
  isAccessExpired,
  isAccountLocked,
  isBlockedRepoPath,
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
import type {
  AccessDurationPreset,
  ActiveDevSecSession,
  AuditLogEntry,
  AuditOutcome,
  BackupMetadata,
  DeploymentRecord,
  DeveloperAccountStatus,
  DevPermissionKey,
  DevPermissions,
  EnvironmentHostingConfig,
  EnvironmentName,
  FileVersionSnapshot,
  OwnerDashboardSummary,
  PublicDeveloperAccount,
  RepoFileEntry,
  SecurityAlertItem,
  SecuritySettingsState,
} from '../src/types/devsec.ts';

interface StoredOwnerRecord {
  username: string;
  email: string;
  passwordHash: string;
  claimedAt: string;
}

interface StoredDeveloperAccount {
  id: string;
  username: string;
  email: string;
  fullName: string;
  roleTitle: string;
  requestReason: string;
  passwordHash: string;
  totpSecret: string;
  lastTotpCounter: number | null;
  emailVerified: boolean;
  emailVerificationCodeHash: string | null;
  status: DeveloperAccountStatus;
  permissions: DevPermissions;
  durationPreset: AccessDurationPreset | null;
  accessGrantedAt: string | null;
  accessExpiresAt: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedBy: string | null;
  reviewNote: string | null;
}

interface DevSecVaultData {
  owner: StoredOwnerRecord | null;
  developers: StoredDeveloperAccount[];
  sessions: ActiveDevSecSession[];
  auditLogs: AuditLogEntry[];
  alerts: SecurityAlertItem[];
  versions: FileVersionSnapshot[];
  deployments: DeploymentRecord[];
  backups: BackupMetadata[];
  environments: EnvironmentHostingConfig[];
  securitySettings: SecuritySettingsState;
  apiIntegrationSettings: {
    geminiEnabled: boolean;
    mapsEnabled: boolean;
    firebaseSyncEnabled: boolean;
    pwaInstallEnabled: boolean;
    allowedOrigins: string;
    updatedAt: string;
  };
}

export interface AuthenticatedContext {
  actorType: 'owner' | 'developer';
  accountId: string;
  username: string;
  displayName: string;
  session: ActiveDevSecSession;
  developer: StoredDeveloperAccount | null;
}

const RUNTIME_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const RUNTIME_BACKUP_SECRET = crypto.randomBytes(32).toString('hex');

export class DevSecStore {
  private readonly rootDir: string;
  private readonly vaultDir: string;
  private readonly vaultFile: string;
  private readonly backupDir: string;
  private data: DevSecVaultData;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    this.vaultDir = path.join(this.rootDir, '.devsec-vault');
    this.vaultFile = path.join(this.vaultDir, 'vault.json');
    this.backupDir = path.join(this.vaultDir, 'backups');
    this.ensureDirs();
    this.data = this.loadVault();
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.vaultDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
  }

  private getSigningSecret(): string {
    const envSecret = (process.env.DEVSEC_SESSION_SECRET || '').trim();
    const base = envSecret || RUNTIME_SESSION_SECRET;
    return `${base}:epoch:${this.data.securitySettings.keyEpoch}`;
  }

  private getBackupSecret(epoch?: number): string {
    const envSecret = (process.env.DEVSEC_BACKUP_KEY || '').trim();
    const base = envSecret || RUNTIME_BACKUP_SECRET;
    const useEpoch = epoch ?? this.data.securitySettings.keyEpoch;
    return `${base}:backup-epoch:${useEpoch}`;
  }

  private getEnvOwnerPassword(): string {
    return (process.env.DEVSEC_OWNER_PASSWORD || '').trim();
  }

  private createInitialVault(): DevSecVaultData {
    const now = new Date().toISOString();
    const port = Number(process.env.PORT) || 3000;
    const appUrl = (process.env.APP_URL || '').trim();
    const hostUrl = appUrl && appUrl !== 'MY_APP_URL' ? appUrl : `http://localhost:${port}`;

    return {
      owner: null,
      developers: [],
      sessions: [],
      auditLogs: [
        {
          id: `aud_${crypto.randomUUID().slice(0, 8)}`,
          timestamp: now,
          actorType: 'system',
          actorUsername: 'system',
          action: 'VAULT_INITIALIZED',
          category: 'emergency',
          target: 'devsec-vault',
          outcome: 'success',
          details: 'Source Code Access & Developer Security vault initialized with all developer permissions disabled by default.',
          ipAddress: '127.0.0.1',
        },
      ],
      alerts: [],
      versions: [],
      deployments: [
        {
          id: 'dep_initial_prod',
          environment: 'production',
          versionTag: 'v1.0.0-avy-erp',
          commitSummary: 'Baseline AVY INFRA ERP, Projects Matrix, Payroll & PWA Release',
          requestedBy: 'owner',
          requestedByRole: 'owner',
          status: 'deployed',
          ownerApprovedBy: 'owner',
          createdAt: now,
          deployedAt: now,
          notes: 'Initial baseline production release protected by Owner deployment gate.',
        },
      ],
      backups: [],
      environments: [
        {
          environment: 'development',
          branch: 'dev/workspace',
          deploymentMode: 'auto_sandbox',
          requireOwnerApproval: false,
          enforceHttps: false,
          port,
          hostUrl: `http://localhost:${port}`,
          lastUpdatedAt: now,
        },
        {
          environment: 'staging',
          branch: 'staging/release-candidate',
          deploymentMode: 'owner_gated',
          requireOwnerApproval: true,
          enforceHttps: true,
          port,
          hostUrl,
          lastUpdatedAt: now,
        },
        {
          environment: 'production',
          branch: 'main/production',
          deploymentMode: 'owner_gated',
          requireOwnerApproval: true,
          enforceHttps: true,
          port,
          hostUrl,
          lastUpdatedAt: now,
        },
      ],
      securitySettings: {
        sessionTtlMinutes: 60,
        maxFailedLoginAttempts: 5,
        lockoutDurationMinutes: 15,
        requireEmailVerification: true,
        requireTwoFactorAuth: true,
        requireOwnerApprovalForProdDeploy: true,
        keyEpoch: 1,
        lastCredentialRotationAt: null,
      },
      apiIntegrationSettings: {
        geminiEnabled: Boolean((process.env.GEMINI_API_KEY || '').trim() && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
        mapsEnabled: Boolean(
          (process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim() &&
            process.env.VITE_GOOGLE_MAPS_API_KEY !== 'MY_GOOGLE_MAPS_API_KEY'
        ),
        firebaseSyncEnabled: true,
        pwaInstallEnabled: true,
        allowedOrigins: hostUrl,
        updatedAt: now,
      },
    };
  }

  private loadVault(): DevSecVaultData {
    try {
      if (fs.existsSync(this.vaultFile)) {
        const raw = fs.readFileSync(this.vaultFile, 'utf8');
        const parsed = JSON.parse(raw) as Partial<DevSecVaultData>;
        const base = this.createInitialVault();
        return {
          ...base,
          ...parsed,
          securitySettings: {
            ...base.securitySettings,
            ...(parsed.securitySettings || {}),
          },
          apiIntegrationSettings: {
            ...base.apiIntegrationSettings,
            ...(parsed.apiIntegrationSettings || {}),
          },
        };
      }
    } catch (err) {
      console.error('Failed to read DevSec vault, starting clean:', err);
    }
    const fresh = this.createInitialVault();
    this.saveVault(fresh);
    return fresh;
  }

  private saveVault(targetData: DevSecVaultData = this.data): void {
    this.ensureDirs();
    const tmpFile = `${this.vaultFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(targetData, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpFile, this.vaultFile);
  }

  private pruneExpiredSessions(): void {
    const now = Date.now();
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => Date.parse(s.expiresAt) > now);
    if (this.data.sessions.length !== before) {
      this.saveVault();
    }
  }

  private appendAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    const record: AuditLogEntry = {
      id: `aud_${crypto.randomUUID().slice(0, 10)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.data.auditLogs.unshift(record);
    if (this.data.auditLogs.length > 500) {
      this.data.auditLogs.length = 500;
    }
    this.saveVault();
    return record;
  }

  private appendAlert(
    severity: 'high' | 'medium' | 'low',
    title: string,
    details: string
  ): SecurityAlertItem {
    const alert: SecurityAlertItem = {
      id: `alrt_${crypto.randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      severity,
      title,
      details,
      acknowledged: false,
    };
    this.data.alerts.unshift(alert);
    if (this.data.alerts.length > 100) {
      this.data.alerts.length = 100;
    }
    this.saveVault();
    return alert;
  }

  public toPublicDeveloper(dev: StoredDeveloperAccount): PublicDeveloperAccount {
    return {
      id: dev.id,
      username: dev.username,
      email: dev.email,
      fullName: dev.fullName,
      roleTitle: dev.roleTitle,
      requestReason: dev.requestReason,
      status: dev.status,
      emailVerified: dev.emailVerified,
      twoFactorEnabled: Boolean(dev.totpSecret),
      permissions: { ...dev.permissions },
      durationPreset: dev.durationPreset,
      accessGrantedAt: dev.accessGrantedAt,
      accessExpiresAt: dev.accessExpiresAt,
      isExpiredNow: dev.status === 'approved' ? isAccessExpired(dev.accessExpiresAt) : false,
      failedLoginAttempts: dev.failedLoginAttempts,
      lockedUntil: dev.lockedUntil,
      lastLoginAt: dev.lastLoginAt,
      createdAt: dev.createdAt,
      updatedAt: dev.updatedAt,
      reviewedBy: dev.reviewedBy,
      reviewNote: dev.reviewNote,
    };
  }

  public getStatus() {
    const envPwConfigured = Boolean(this.getEnvOwnerPassword());
    return {
      ownerClaimed: Boolean(this.data.owner),
      ownerEnvConfigured: envPwConfigured,
      requireEmailVerification: this.data.securitySettings.requireEmailVerification,
      requireTwoFactorAuth: this.data.securitySettings.requireTwoFactorAuth,
    };
  }

  public claimOwnerAccount(input: {
    username: string;
    email: string;
    password: string;
    ipAddress: string;
    userAgent: string;
  }) {
    if (this.data.owner) {
      return { ok: false as const, status: 409, error: 'Master Owner account is already initialized.' };
    }
    if (this.getEnvOwnerPassword()) {
      return {
        ok: false as const,
        status: 409,
        error: 'Master Owner password is managed by server environment configuration.',
      };
    }

    const rawUsername = (input.username || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(rawUsername)) {
      return {
        ok: false as const,
        status: 400,
        error: 'Owner username must be 3-32 characters starting with a letter.',
      };
    }
    const email = (input.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false as const, status: 400, error: 'Valid Owner email is required.' };
    }
    const pwCheck = validateStrongPassword(input.password);
    if (!pwCheck.valid) {
      return { ok: false as const, status: 400, error: pwCheck.reason || 'Weak password.' };
    }

    const now = new Date().toISOString();
    this.data.owner = {
      username: rawUsername,
      email,
      passwordHash: hashSecretScrypt(input.password),
      claimedAt: now,
    };

    const sessionResult = this.createSession({
      actorType: 'owner',
      accountId: 'master_owner',
      username: rawUsername,
      displayName: `Master Owner (${rawUsername})`,
      ttlMs: 4 * 60 * 60 * 1000,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    this.appendAudit({
      actorType: 'owner',
      actorUsername: rawUsername,
      action: 'MASTER_OWNER_CLAIMED',
      category: 'auth',
      target: 'master_owner',
      outcome: 'success',
      details: `Master Owner account claimed and initialized for ${email}.`,
      ipAddress: input.ipAddress,
    });

    return {
      ok: true as const,
      token: sessionResult.token,
      session: sessionResult.session,
    };
  }

  public loginOwner(input: {
    username: string;
    password: string;
    ipAddress: string;
    userAgent: string;
  }) {
    const envPw = this.getEnvOwnerPassword();
    const enteredUser = (input.username || '').trim().toLowerCase();

    if (!this.data.owner && !envPw) {
      return {
        ok: false as const,
        status: 400,
        error: 'Master Owner account has not been claimed yet. Complete first-run setup first.',
      };
    }

    let valid = false;
    let ownerUsername = this.data.owner?.username || 'owner';

    if (envPw) {
      const a = Buffer.from(input.password || '', 'utf8');
      const b = Buffer.from(envPw, 'utf8');
      const envMatch = a.length === b.length && crypto.timingSafeEqual(a, b);
      const userMatch = !this.data.owner || !enteredUser || enteredUser === ownerUsername || enteredUser === 'owner';
      valid = envMatch && userMatch;
      if (valid && !this.data.owner) {
        this.data.owner = {
          username: enteredUser || 'owner',
          email: 'owner@avyinfra.local',
          passwordHash: hashSecretScrypt(envPw),
          claimedAt: new Date().toISOString(),
        };
        ownerUsername = this.data.owner.username;
      }
    } else if (this.data.owner) {
      const userMatches =
        enteredUser === this.data.owner.username || enteredUser === this.data.owner.email.toLowerCase();
      valid = userMatches && verifySecretScrypt(input.password || '', this.data.owner.passwordHash);
    }

    if (!valid) {
      this.appendAudit({
        actorType: 'owner',
        actorUsername: enteredUser || 'owner',
        action: 'OWNER_LOGIN_FAILED',
        category: 'auth',
        target: 'master_owner',
        outcome: 'denied',
        details: 'Rejected Master Owner login attempt (invalid username or password).',
        ipAddress: input.ipAddress,
      });
      this.appendAlert(
        'high',
        'Failed Master Owner Login Attempt',
        `Rejected login attempt for "${enteredUser || 'unknown'}" from ${input.ipAddress}.`
      );
      return { ok: false as const, status: 401, error: 'Invalid Master Owner credentials.' };
    }

    const sessionResult = this.createSession({
      actorType: 'owner',
      accountId: 'master_owner',
      username: ownerUsername,
      displayName: `Master Owner (${ownerUsername})`,
      ttlMs: 4 * 60 * 60 * 1000,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    this.appendAudit({
      actorType: 'owner',
      actorUsername: ownerUsername,
      action: 'OWNER_LOGIN_SUCCESS',
      category: 'auth',
      target: 'master_owner',
      outcome: 'success',
      details: 'Master Owner authenticated and opened secure session.',
      ipAddress: input.ipAddress,
    });

    return {
      ok: true as const,
      token: sessionResult.token,
      session: sessionResult.session,
    };
  }

  private createSession(params: {
    actorType: 'owner' | 'developer';
    accountId: string;
    username: string;
    displayName: string;
    ttlMs: number;
    ipAddress: string;
    userAgent: string;
  }) {
    this.pruneExpiredSessions();
    const nowMs = Date.now();
    const sid = `sid_${crypto.randomUUID()}`;
    const expMs = nowMs + Math.max(60_000, params.ttlMs);
    const session: ActiveDevSecSession = {
      sessionId: sid,
      actorType: params.actorType,
      accountId: params.accountId,
      username: params.username,
      displayName: params.displayName,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(expMs).toISOString(),
      lastSeenAt: new Date(nowMs).toISOString(),
      ipAddress: params.ipAddress,
      userAgent: params.userAgent.slice(0, 120),
    };
    this.data.sessions.unshift(session);
    this.saveVault();

    const token = signSessionToken(
      {
        sid,
        actorType: params.actorType,
        accountId: params.accountId,
        username: params.username,
        keyEpoch: this.data.securitySettings.keyEpoch,
        iat: nowMs,
        exp: expMs,
      },
      this.getSigningSecret()
    );

    return { token, session };
  }

  public authenticateToken(authHeader: string | undefined): {
    ok: boolean;
    context?: AuthenticatedContext;
    error?: string;
  } {
    this.pruneExpiredSessions();
    const token =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return { ok: false, error: 'Missing Authorization Bearer token.' };
    }

    const verified = verifySessionToken(
      token,
      this.getSigningSecret(),
      this.data.securitySettings.keyEpoch
    );
    if (!verified.valid || !verified.payload) {
      return { ok: false, error: verified.reason || 'Invalid or expired session.' };
    }

    const session = this.data.sessions.find((s) => s.sessionId === verified.payload?.sid);
    if (!session) {
      return { ok: false, error: 'Session has been terminated or revoked.' };
    }

    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.data.sessions = this.data.sessions.filter((s) => s.sessionId !== session.sessionId);
      this.saveVault();
      return { ok: false, error: 'Session expired automatically.' };
    }

    let developer: StoredDeveloperAccount | null = null;
    if (session.actorType === 'developer') {
      developer = this.data.developers.find((d) => d.id === session.accountId) || null;
      if (!developer) {
        return { ok: false, error: 'Developer account no longer exists.' };
      }
      if (developer.status !== 'approved') {
        this.terminateSessionById(session.sessionId);
        return { ok: false, error: `Developer access is ${developer.status}.` };
      }
      if (isAccessExpired(developer.accessExpiresAt)) {
        this.terminateSessionById(session.sessionId);
        return { ok: false, error: 'Temporary developer access window has expired.' };
      }
      if (isAccountLocked(developer.lockedUntil)) {
        this.terminateSessionById(session.sessionId);
        return { ok: false, error: 'Developer account is locked.' };
      }
    }

    session.lastSeenAt = new Date().toISOString();
    this.saveVault();

    return {
      ok: true,
      context: {
        actorType: session.actorType,
        accountId: session.accountId,
        username: session.username,
        displayName: session.displayName,
        session,
        developer,
      },
    };
  }

  public logout(ctx: AuthenticatedContext, ipAddress: string): void {
    this.terminateSessionById(ctx.session.sessionId);
    this.appendAudit({
      actorType: ctx.actorType,
      actorUsername: ctx.username,
      action: ctx.actorType === 'owner' ? 'OWNER_LOGOUT' : 'DEVELOPER_LOGOUT',
      category: 'auth',
      target: ctx.session.sessionId,
      outcome: 'success',
      details: 'Session closed via explicit logout.',
      ipAddress,
    });
  }

  private terminateSessionById(sessionId: string): boolean {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.sessionId !== sessionId);
    if (this.data.sessions.length !== before) {
      this.saveVault();
      return true;
    }
    return false;
  }

  public async registerDeveloper(input: {
    username: string;
    email: string;
    fullName: string;
    roleTitle: string;
    requestReason: string;
    password: string;
    ipAddress: string;
  }) {
    const uCheck = validateUsername(input.username);
    if (!uCheck.valid) {
      return { ok: false as const, status: 400, error: uCheck.reason };
    }
    const email = (input.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false as const, status: 400, error: 'Valid work email address is required.' };
    }
    const fullName = (input.fullName || '').trim();
    if (fullName.length < 2) {
      return { ok: false as const, status: 400, error: 'Developer full name is required.' };
    }
    const pwCheck = validateStrongPassword(input.password);
    if (!pwCheck.valid) {
      return { ok: false as const, status: 400, error: pwCheck.reason };
    }
    const exists = this.data.developers.some(
      (d) => d.username === uCheck.normalized || d.email === email
    );
    if (exists) {
      return {
        ok: false as const,
        status: 409,
        error: 'A developer account with that username or email already exists.',
      };
    }

    const totpSecret = generateTotpSecret();
    const otpAuthUri = buildOtpAuthUri(uCheck.normalized, totpSecret);
    const qrDataUrl = await QRCode.toDataURL(otpAuthUri, { width: 180, margin: 1 });
    const verificationCode = String(crypto.randomInt(100000, 999999));
    const now = new Date().toISOString();

    const dev: StoredDeveloperAccount = {
      id: `dev_${crypto.randomUUID().slice(0, 10)}`,
      username: uCheck.normalized,
      email,
      fullName: fullName.slice(0, 80),
      roleTitle: (input.roleTitle || 'External Developer').trim().slice(0, 60),
      requestReason: (input.requestReason || 'Maintenance & feature delivery').trim().slice(0, 300),
      passwordHash: hashSecretScrypt(input.password),
      totpSecret,
      lastTotpCounter: null,
      emailVerified: false,
      emailVerificationCodeHash: hashSecretScrypt(verificationCode),
      status: 'pending',
      permissions: createEmptyPermissions(),
      durationPreset: null,
      accessGrantedAt: null,
      accessExpiresAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      reviewedBy: null,
      reviewNote: null,
    };

    this.data.developers.unshift(dev);
    this.appendAudit({
      actorType: 'developer',
      actorUsername: dev.username,
      action: 'DEVELOPER_ACCESS_REQUESTED',
      category: 'auth',
      target: dev.username,
      outcome: 'success',
      details: `Access request submitted by ${dev.fullName} (${dev.email}). Email verification & Owner approval pending.`,
      ipAddress: input.ipAddress,
    });
    this.appendAlert(
      'low',
      'New Developer Access Request',
      `${dev.fullName} (@${dev.username}) submitted an access request awaiting Owner review.`
    );

    return {
      ok: true as const,
      account: this.toPublicDeveloper(dev),
      totpSetup: {
        secret: totpSecret,
        otpAuthUri,
        qrDataUrl,
      },
      emailVerificationPreviewCode: verificationCode,
    };
  }

  public verifyDeveloperEmail(input: {
    username: string;
    code: string;
    ipAddress: string;
  }) {
    const normalized = (input.username || '').trim().toLowerCase();
    const dev = this.data.developers.find(
      (d) => d.username === normalized || d.email === normalized
    );
    if (!dev) {
      return { ok: false as const, status: 404, error: 'Developer account not found.' };
    }
    if (dev.emailVerified) {
      return { ok: true as const, alreadyVerified: true };
    }
    if (
      !dev.emailVerificationCodeHash ||
      !verifySecretScrypt((input.code || '').trim(), dev.emailVerificationCodeHash)
    ) {
      this.appendAudit({
        actorType: 'developer',
        actorUsername: dev.username,
        action: 'EMAIL_VERIFICATION_FAILED',
        category: 'auth',
        target: dev.email,
        outcome: 'denied',
        details: 'Invalid email verification code submitted.',
        ipAddress: input.ipAddress,
      });
      return { ok: false as const, status: 400, error: 'Invalid email verification code.' };
    }

    dev.emailVerified = true;
    dev.emailVerificationCodeHash = null;
    dev.failedLoginAttempts = 0;
    dev.lockedUntil = null;
    dev.updatedAt = new Date().toISOString();
    this.appendAudit({
      actorType: 'developer',
      actorUsername: dev.username,
      action: 'EMAIL_VERIFIED',
      category: 'auth',
      target: dev.email,
      outcome: 'success',
      details: `Email verified for developer ${dev.username}.`,
      ipAddress: input.ipAddress,
    });

    return { ok: true as const, alreadyVerified: false };
  }

  public resendDeveloperVerificationCode(input: {
    username: string;
    password: string;
    ipAddress: string;
  }) {
    const normalized = (input.username || '').trim().toLowerCase();
    const dev = this.data.developers.find(
      (d) => d.username === normalized || d.email === normalized
    );
    if (!dev) {
      return { ok: false as const, status: 404, error: 'Developer account not found.' };
    }
    if (!verifySecretScrypt(input.password || '', dev.passwordHash)) {
      return {
        ok: false as const,
        status: 401,
        error: 'Enter your valid developer password to request a new email verification code.',
      };
    }
    if (dev.emailVerified) {
      return {
        ok: true as const,
        alreadyVerified: true,
        username: dev.username,
        email: dev.email,
      };
    }

    const verificationCode = String(crypto.randomInt(100000, 999999));
    dev.emailVerificationCodeHash = hashSecretScrypt(verificationCode);
    dev.updatedAt = new Date().toISOString();

    this.appendAudit({
      actorType: 'developer',
      actorUsername: dev.username,
      action: 'EMAIL_VERIFICATION_RESENT',
      category: 'auth',
      target: dev.email,
      outcome: 'success',
      details: `Issued a fresh email verification code for @${dev.username}.`,
      ipAddress: input.ipAddress,
    });

    return {
      ok: true as const,
      alreadyVerified: false,
      username: dev.username,
      email: dev.email,
      emailVerificationPreviewCode: verificationCode,
    };
  }

  public loginDeveloper(input: {
    username: string;
    password: string;
    totpCode: string;
    ipAddress: string;
    userAgent: string;
  }) {
    const normalized = (input.username || '').trim().toLowerCase();
    const dev = this.data.developers.find(
      (d) => d.username === normalized || d.email === normalized
    );
    if (!dev) {
      this.appendAudit({
        actorType: 'developer',
        actorUsername: normalized || 'unknown',
        action: 'DEVELOPER_LOGIN_FAILED',
        category: 'auth',
        target: normalized || 'unknown',
        outcome: 'denied',
        details: 'Login attempted for unknown developer username.',
        ipAddress: input.ipAddress,
      });
      return { ok: false as const, status: 401, error: 'Invalid developer credentials.' };
    }

    if (dev.status === 'disabled' || dev.status === 'revoked') {
      this.appendAudit({
        actorType: 'developer',
        actorUsername: dev.username,
        action: 'DEVELOPER_LOGIN_BLOCKED',
        category: 'auth',
        target: dev.username,
        outcome: 'denied',
        details: `Login blocked: account status is ${dev.status}.`,
        ipAddress: input.ipAddress,
      });
      return {
        ok: false as const,
        status: 403,
        code: 'ACCOUNT_DISABLED',
        error: `Account access has been ${dev.status} by the Master Owner.`,
      };
    }

    if (isAccountLocked(dev.lockedUntil)) {
      this.appendAudit({
        actorType: 'developer',
        actorUsername: dev.username,
        action: 'DEVELOPER_LOGIN_LOCKED',
        category: 'auth',
        target: dev.username,
        outcome: 'alert',
        details: `Login blocked while account locked until ${dev.lockedUntil}.`,
        ipAddress: input.ipAddress,
      });
      return {
        ok: false as const,
        status: 423,
        code: 'ACCOUNT_LOCKED',
        error: `Account temporarily locked after repeated failed attempts until ${new Date(
          dev.lockedUntil || ''
        ).toLocaleTimeString()}.`,
      };
    }

    const passwordOk = verifySecretScrypt(input.password || '', dev.passwordHash);
    if (!passwordOk) {
      return this.recordFailedDeveloperAttempt(dev, 'Invalid password', input.ipAddress);
    }

    // Check email verification, Owner approval, and access expiry BEFORE consuming a TOTP code
    if (this.data.securitySettings.requireEmailVerification && !dev.emailVerified) {
      this.appendAudit({
        actorType: 'developer',
        actorUsername: dev.username,
        action: 'DEVELOPER_LOGIN_UNVERIFIED_EMAIL',
        category: 'auth',
        target: dev.email,
        outcome: 'denied',
        details: 'Login rejected because developer email is not yet verified.',
        ipAddress: input.ipAddress,
      });
      return {
        ok: false as const,
        status: 403,
        code: 'EMAIL_UNVERIFIED',
        error: 'Verify your email address before signing in. Use the verification box below to complete email verification.',
      };
    }

    if (dev.status !== 'approved') {
      this.appendAudit({
        actorType: 'developer',
        actorUsername: dev.username,
        action: 'DEVELOPER_LOGIN_AWAITING_APPROVAL',
        category: 'auth',
        target: dev.username,
        outcome: 'denied',
        details: `Login rejected because access request status is "${dev.status}".`,
        ipAddress: input.ipAddress,
      });
      return {
        ok: false as const,
        status: 403,
        code: 'AWAITING_APPROVAL',
        error:
          dev.status === 'pending'
            ? 'Your access request is pending Master Owner approval.'
            : 'Your access request was rejected by the Master Owner.',
      };
    }

    if (isAccessExpired(dev.accessExpiresAt)) {
      this.appendAudit({
        actorType: 'developer',
        actorUsername: dev.username,
        action: 'DEVELOPER_ACCESS_EXPIRED',
        category: 'auth',
        target: dev.username,
        outcome: 'denied',
        details: `Temporary access window expired at ${dev.accessExpiresAt}.`,
        ipAddress: input.ipAddress,
      });
      return {
        ok: false as const,
        status: 403,
        code: 'ACCESS_EXPIRED',
        error: 'Your temporary developer access period has expired. Submit a new request or ask the Owner to extend.',
      };
    }

    if (this.data.securitySettings.requireTwoFactorAuth) {
      const totpRes = verifyTotpCode(dev.totpSecret, input.totpCode, {
        lastAcceptedCounter: dev.lastTotpCounter,
      });
      if (!totpRes.valid) {
        return this.recordFailedDeveloperAttempt(
          dev,
          totpRes.reason || 'Invalid 2FA verification code',
          input.ipAddress
        );
      }
      dev.lastTotpCounter = totpRes.matchedCounter;
    }

    dev.failedLoginAttempts = 0;
    dev.lockedUntil = null;
    dev.lastLoginAt = new Date().toISOString();
    dev.updatedAt = dev.lastLoginAt;

    const grantRemainingMs = Math.max(
      60_000,
      Date.parse(dev.accessExpiresAt || '') - Date.now()
    );
    const sessionTtlMs = Math.min(
      this.data.securitySettings.sessionTtlMinutes * 60 * 1000,
      grantRemainingMs
    );

    const sessionResult = this.createSession({
      actorType: 'developer',
      accountId: dev.id,
      username: dev.username,
      displayName: dev.fullName,
      ttlMs: sessionTtlMs,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    this.appendAudit({
      actorType: 'developer',
      actorUsername: dev.username,
      action: 'DEVELOPER_LOGIN_SUCCESS',
      category: 'auth',
      target: dev.username,
      outcome: 'success',
      details: `Developer authenticated via password + 2FA. Session expires ${sessionResult.session.expiresAt}.`,
      ipAddress: input.ipAddress,
    });

    return {
      ok: true as const,
      token: sessionResult.token,
      session: sessionResult.session,
      account: this.toPublicDeveloper(dev),
    };
  }

  private recordFailedDeveloperAttempt(
    dev: StoredDeveloperAccount,
    reason: string,
    ipAddress: string
  ) {
    dev.failedLoginAttempts += 1;
    dev.updatedAt = new Date().toISOString();
    const maxAttempts = this.data.securitySettings.maxFailedLoginAttempts;
    if (dev.failedLoginAttempts >= maxAttempts) {
      const lockMs = this.data.securitySettings.lockoutDurationMinutes * 60 * 1000;
      dev.lockedUntil = new Date(Date.now() + lockMs).toISOString();
      this.appendAudit({
        actorType: 'developer',
        actorUsername: dev.username,
        action: 'DEVELOPER_ACCOUNT_LOCKED',
        category: 'auth',
        target: dev.username,
        outcome: 'alert',
        details: `Account locked for ${this.data.securitySettings.lockoutDurationMinutes}m after ${dev.failedLoginAttempts} failed login attempts (${reason}).`,
        ipAddress,
      });
      this.appendAlert(
        'high',
        `Account Locked: @${dev.username}`,
        `Developer @${dev.username} locked out after ${dev.failedLoginAttempts} failed authentication attempts from ${ipAddress}.`
      );
      return {
        ok: false as const,
        status: 423,
        error: `Account locked for ${this.data.securitySettings.lockoutDurationMinutes} minutes due to repeated failed attempts.`,
      };
    }

    this.appendAudit({
      actorType: 'developer',
      actorUsername: dev.username,
      action: 'DEVELOPER_LOGIN_FAILED',
      category: 'auth',
      target: dev.username,
      outcome: 'denied',
      details: `Failed login (${reason}). Attempt ${dev.failedLoginAttempts}/${maxAttempts}.`,
      ipAddress,
    });
    return {
      ok: false as const,
      status: 401,
      error: `${reason}. (${maxAttempts - dev.failedLoginAttempts} attempts remaining before lockout)`,
    };
  }

  public checkDeveloperPermission(
    ctx: AuthenticatedContext,
    perm: DevPermissionKey,
    ipAddress: string,
    actionLabel: string,
    target: string
  ): { allowed: boolean; reason?: string } {
    if (ctx.actorType === 'owner') {
      return { allowed: true };
    }
    const res = canDeveloperPerform(ctx.developer, perm);
    if (!res.allowed) {
      this.appendAudit({
        actorType: 'developer',
        actorUsername: ctx.username,
        action: `UNAUTHORIZED_${actionLabel}`,
        category: 'permission',
        target,
        outcome: 'denied',
        details: res.reason || 'Permission denied.',
        ipAddress,
      });
      this.appendAlert(
        'medium',
        `Denied Action by @${ctx.username}`,
        `Attempted ${actionLabel} on "${target}": ${res.reason}`
      );
      return res;
    }
    return { allowed: true };
  }

  public getOwnerDashboardSummary(): OwnerDashboardSummary {
    this.pruneExpiredSessions();
    const devs = this.data.developers.map((d) => this.toPublicDeveloper(d));
    const authorized = devs.filter((d) => d.status === 'approved' && !d.isExpiredNow);
    const activeAccounts = devs.filter(
      (d) => d.status === 'approved' && !d.isExpiredNow && !isAccountLocked(d.lockedUntil)
    );
    const pending = devs.filter((d) => d.status === 'pending');
    const expired = devs.filter((d) => d.status === 'approved' && d.isExpiredNow);

    return {
      ownerUsername: this.data.owner?.username || 'owner',
      ownerEmail: this.data.owner?.email || 'owner@avyinfra.local',
      metrics: {
        totalAuthorizedDevelopers: authorized.length,
        activeDeveloperAccounts: activeAccounts.length,
        currentActiveSessions: this.data.sessions.filter((s) => s.actorType === 'developer').length,
        pendingAccessRequests: pending.length,
        expiredPermissions: expired.length,
        recentSourceModifications: this.data.versions.length,
        deploymentCount: this.data.deployments.length,
        securityAlertsCount: this.data.alerts.filter((a) => !a.acknowledged).length,
      },
      developers: devs,
      sessions: [...this.data.sessions],
      auditLogs: [...this.data.auditLogs],
      alerts: [...this.data.alerts],
      versions: [...this.data.versions],
      deployments: [...this.data.deployments],
      backups: [...this.data.backups],
      environments: [...this.data.environments],
      securitySettings: { ...this.data.securitySettings },
    };
  }

  public approveOrUpdateDeveloper(input: {
    ownerUsername: string;
    developerId: string;
    decision: 'approve' | 'reject' | 'update' | 'revoke' | 'disable' | 'enable' | 'verify_email';
    permissions?: Partial<DevPermissions>;
    durationPreset?: AccessDurationPreset;
    customExpiresAt?: string | null;
    reviewNote?: string;
    ipAddress: string;
  }) {
    const dev = this.data.developers.find((d) => d.id === input.developerId);
    if (!dev) {
      return { ok: false as const, status: 404, error: 'Developer account not found.' };
    }

    const nowIso = new Date().toISOString();
    dev.updatedAt = nowIso;
    dev.reviewedBy = input.ownerUsername;
    if (input.reviewNote !== undefined) {
      dev.reviewNote = String(input.reviewNote || '').slice(0, 300);
    }

    if (input.decision === 'verify_email') {
      dev.emailVerified = true;
      dev.emailVerificationCodeHash = null;
      dev.failedLoginAttempts = 0;
      dev.lockedUntil = null;
      this.appendAudit({
        actorType: 'owner',
        actorUsername: input.ownerUsername,
        action: 'OWNER_VERIFIED_DEVELOPER_EMAIL',
        category: 'auth',
        target: dev.email,
        outcome: 'success',
        details: `Master Owner verified developer email for @${dev.username} (${dev.email}).`,
        ipAddress: input.ipAddress,
      });
      return { ok: true as const, account: this.toPublicDeveloper(dev) };
    }

    if (input.decision === 'reject') {
      dev.status = 'rejected';
      dev.permissions = createEmptyPermissions();
      this.terminateDeveloperSessions(dev.id);
      this.appendAudit({
        actorType: 'owner',
        actorUsername: input.ownerUsername,
        action: 'DEVELOPER_REQUEST_REJECTED',
        category: 'permission',
        target: dev.username,
        outcome: 'success',
        details: `Access request rejected. ${dev.reviewNote || ''}`.trim(),
        ipAddress: input.ipAddress,
      });
      return { ok: true as const, account: this.toPublicDeveloper(dev) };
    }

    if (input.decision === 'revoke') {
      dev.status = 'revoked';
      dev.permissions = createEmptyPermissions();
      dev.accessExpiresAt = nowIso;
      this.terminateDeveloperSessions(dev.id);
      this.appendAudit({
        actorType: 'owner',
        actorUsername: input.ownerUsername,
        action: 'DEVELOPER_ACCESS_REVOKED',
        category: 'emergency',
        target: dev.username,
        outcome: 'success',
        details: `Immediate revocation executed for @${dev.username}; active sessions terminated.`,
        ipAddress: input.ipAddress,
      });
      return { ok: true as const, account: this.toPublicDeveloper(dev) };
    }

    if (input.decision === 'disable') {
      dev.status = 'disabled';
      this.terminateDeveloperSessions(dev.id);
      this.appendAudit({
        actorType: 'owner',
        actorUsername: input.ownerUsername,
        action: 'DEVELOPER_ACCOUNT_DISABLED',
        category: 'emergency',
        target: dev.username,
        outcome: 'success',
        details: `Developer account @${dev.username} disabled by Owner.`,
        ipAddress: input.ipAddress,
      });
      return { ok: true as const, account: this.toPublicDeveloper(dev) };
    }

    if (input.decision === 'enable') {
      dev.status = 'approved';
      dev.failedLoginAttempts = 0;
      dev.lockedUntil = null;
      this.appendAudit({
        actorType: 'owner',
        actorUsername: input.ownerUsername,
        action: 'DEVELOPER_ACCOUNT_ENABLED',
        category: 'permission',
        target: dev.username,
        outcome: 'success',
        details: `Developer account @${dev.username} re-enabled & unlocked by Owner.`,
        ipAddress: input.ipAddress,
      });
      return { ok: true as const, account: this.toPublicDeveloper(dev) };
    }

    // approve or update
    const preset: AccessDurationPreset = input.durationPreset || dev.durationPreset || '24h';
    const expiryCalc = computeExpiryIso(preset, input.customExpiresAt || dev.accessExpiresAt);
    if (!expiryCalc.valid || !expiryCalc.expiresAt) {
      return { ok: false as const, status: 400, error: expiryCalc.reason || 'Invalid duration.' };
    }

    dev.status = 'approved';
    dev.permissions = sanitizePermissionsInput(input.permissions ?? dev.permissions);
    dev.durationPreset = preset;
    dev.accessGrantedAt = dev.accessGrantedAt || nowIso;
    dev.accessExpiresAt = expiryCalc.expiresAt;
    dev.failedLoginAttempts = 0;
    dev.lockedUntil = null;

    const grantedList = (Object.entries(dev.permissions) as [DevPermissionKey, boolean][])
      .filter(([, enabled]) => enabled)
      .map(([k]) => k);

    this.appendAudit({
      actorType: 'owner',
      actorUsername: input.ownerUsername,
      action: input.decision === 'approve' ? 'DEVELOPER_ACCESS_APPROVED' : 'DEVELOPER_PERMISSIONS_UPDATED',
      category: 'permission',
      target: dev.username,
      outcome: 'success',
      details: `Duration: ${preset} (expires ${dev.accessExpiresAt}). Granted: ${
        grantedList.length > 0 ? grantedList.join(', ') : 'none (all disabled)'
      }.`,
      ipAddress: input.ipAddress,
    });

    return { ok: true as const, account: this.toPublicDeveloper(dev) };
  }

  private terminateDeveloperSessions(accountId: string): number {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.accountId !== accountId);
    const removed = before - this.data.sessions.length;
    if (removed > 0) this.saveVault();
    return removed;
  }

  public terminateSession(ownerUsername: string, sessionId: string, ipAddress: string): boolean {
    const target = this.data.sessions.find((s) => s.sessionId === sessionId);
    if (!target) return false;
    this.terminateSessionById(sessionId);
    this.appendAudit({
      actorType: 'owner',
      actorUsername: ownerUsername,
      action: 'SESSION_TERMINATED',
      category: 'emergency',
      target: target.username,
      outcome: 'success',
      details: `Owner terminated active ${target.actorType} session ${sessionId}.`,
      ipAddress,
    });
    return true;
  }

  public emergencyControl(
    ownerUsername: string,
    action: 'revoke_all_developers' | 'terminate_all_dev_sessions' | 'rotate_credentials',
    ipAddress: string
  ) {
    const now = new Date().toISOString();
    if (action === 'revoke_all_developers') {
      let count = 0;
      this.data.developers.forEach((d) => {
        if (d.status === 'approved' || d.status === 'pending') {
          d.status = 'revoked';
          d.permissions = createEmptyPermissions();
          d.accessExpiresAt = now;
          d.updatedAt = now;
          count += 1;
        }
      });
      const terminated = this.data.sessions.filter((s) => s.actorType === 'developer').length;
      this.data.sessions = this.data.sessions.filter((s) => s.actorType === 'owner');
      this.appendAudit({
        actorType: 'owner',
        actorUsername: ownerUsername,
        action: 'EMERGENCY_REVOKE_ALL_DEVELOPERS',
        category: 'emergency',
        target: 'all_developers',
        outcome: 'alert',
        details: `Revoked ${count} developer accounts and terminated ${terminated} active developer sessions.`,
        ipAddress,
      });
      this.appendAlert(
        'high',
        'Emergency All-Developer Revocation Executed',
        `Owner revoked ${count} developer accounts and closed ${terminated} sessions.`
      );
      return { ok: true, count, terminated };
    }

    if (action === 'terminate_all_dev_sessions') {
      const terminated = this.data.sessions.filter((s) => s.actorType === 'developer').length;
      this.data.sessions = this.data.sessions.filter((s) => s.actorType === 'owner');
      this.appendAudit({
        actorType: 'owner',
        actorUsername: ownerUsername,
        action: 'EMERGENCY_TERMINATE_ALL_SESSIONS',
        category: 'emergency',
        target: 'developer_sessions',
        outcome: 'alert',
        details: `Terminated ${terminated} active developer sessions immediately.`,
        ipAddress,
      });
      return { ok: true, terminated };
    }

    // rotate_credentials
    this.data.securitySettings.keyEpoch += 1;
    this.data.securitySettings.lastCredentialRotationAt = now;
    const terminated = this.data.sessions.filter((s) => s.actorType === 'developer').length;
    this.data.sessions = this.data.sessions.filter((s) => s.actorType === 'owner');
    // Re-sign current owner sessions automatically? Keep owner session valid by removing old dev sessions and bumping epoch;
    // Note: Owner's current bearer token has previous epoch, so we return a fresh owner token on rotation endpoint!
    this.appendAudit({
      actorType: 'owner',
      actorUsername: ownerUsername,
      action: 'CREDENTIALS_ROTATED',
      category: 'emergency',
      target: `key_epoch_${this.data.securitySettings.keyEpoch}`,
      outcome: 'success',
      details: `Rotated session signing & backup key epoch to v${this.data.securitySettings.keyEpoch}. All developer tokens invalidated.`,
      ipAddress,
    });
    this.appendAlert(
      'medium',
      'Security Signing Keys Rotated',
      `Key epoch incremented to v${this.data.securitySettings.keyEpoch}; all previous developer tokens invalidated.`
    );
    return { ok: true, newEpoch: this.data.securitySettings.keyEpoch, terminated };
  }

  public refreshOwnerSessionToken(ctx: AuthenticatedContext, ipAddress: string, userAgent: string) {
    this.terminateSessionById(ctx.session.sessionId);
    const created = this.createSession({
      actorType: 'owner',
      accountId: 'master_owner',
      username: ctx.username,
      displayName: ctx.displayName,
      ttlMs: 4 * 60 * 60 * 1000,
      ipAddress,
      userAgent,
    });
    return created;
  }

  public listRepositoryFiles(): RepoFileEntry[] {
    const entries: RepoFileEntry[] = [];
    const walk = (dirAbs: string, relPrefix: string) => {
      const items = fs.readdirSync(dirAbs, { withFileTypes: true });
      for (const item of items) {
        const relPath = relPrefix ? `${relPrefix}/${item.name}` : item.name;
        if (isBlockedRepoPath(relPath)) continue;
        const absPath = path.join(dirAbs, item.name);
        if (item.isDirectory()) {
          walk(absPath, relPath);
        } else if (item.isFile()) {
          const stat = fs.statSync(absPath);
          if (stat.size <= 512 * 1024) {
            entries.push({
              path: relPath,
              category: classifyRepoPath(relPath),
              sizeBytes: stat.size,
              updatedAt: stat.mtime.toISOString(),
            });
          }
        }
      }
    };
    walk(this.rootDir, '');
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  public readRepositoryFile(ctx: AuthenticatedContext, relPath: string, ipAddress: string) {
    const safe = resolveSafeRepoPath(this.rootDir, relPath);
    if (!safe.safe) {
      return { ok: false as const, status: 403, error: safe.reason };
    }
    if (!fs.existsSync(safe.absolutePath) || fs.statSync(safe.absolutePath).isDirectory()) {
      return { ok: false as const, status: 404, error: 'File not found.' };
    }
    const content = fs.readFileSync(safe.absolutePath, 'utf8');
    this.appendAudit({
      actorType: ctx.actorType,
      actorUsername: ctx.username,
      action: 'SOURCE_FILE_VIEWED',
      category: 'source',
      target: safe.normalizedRel,
      outcome: 'success',
      details: `Viewed file ${safe.normalizedRel} (${content.length} chars).`,
      ipAddress,
    });
    return {
      ok: true as const,
      path: safe.normalizedRel,
      category: classifyRepoPath(safe.normalizedRel),
      content,
    };
  }

  public writeRepositoryFile(
    ctx: AuthenticatedContext,
    relPath: string,
    content: string,
    summary: string,
    ipAddress: string
  ) {
    const safe = resolveSafeRepoPath(this.rootDir, relPath);
    if (!safe.safe) {
      return { ok: false as const, status: 403, error: safe.reason };
    }
    const category = classifyRepoPath(safe.normalizedRel);
    if (ctx.actorType === 'developer') {
      if (category === 'frontend') {
        const check = this.checkDeveloperPermission(
          ctx,
          'edit_frontend',
          ipAddress,
          'EDIT_FRONTEND_FILE',
          safe.normalizedRel
        );
        if (!check.allowed) return { ok: false as const, status: 403, error: check.reason };
      } else if (category === 'backend') {
        const check = this.checkDeveloperPermission(
          ctx,
          'edit_backend',
          ipAddress,
          'EDIT_BACKEND_FILE',
          safe.normalizedRel
        );
        if (!check.allowed) return { ok: false as const, status: 403, error: check.reason };
      } else if (category === 'schema') {
        const check = this.checkDeveloperPermission(
          ctx,
          'access_db_schema',
          ipAddress,
          'EDIT_SCHEMA_FILE',
          safe.normalizedRel
        );
        if (!check.allowed) return { ok: false as const, status: 403, error: check.reason };
      } else {
        this.appendAudit({
          actorType: 'developer',
          actorUsername: ctx.username,
          action: 'PROTECTED_FILE_WRITE_BLOCKED',
          category: 'source',
          target: safe.normalizedRel,
          outcome: 'denied',
          details: 'Only the Master Owner can edit root config or non-scoped files.',
          ipAddress,
        });
        return {
          ok: false as const,
          status: 403,
          error: 'Only the Master Owner may edit core configuration files.',
        };
      }
    }

    if (typeof content !== 'string' || content.length > 400_000) {
      return { ok: false as const, status: 400, error: 'File content exceeds safe limit or is invalid.' };
    }

    const existed = fs.existsSync(safe.absolutePath);
    const previousContent = existed ? fs.readFileSync(safe.absolutePath, 'utf8') : null;

    fs.mkdirSync(path.dirname(safe.absolutePath), { recursive: true });
    fs.writeFileSync(safe.absolutePath, content, 'utf8');

    const snapshot: FileVersionSnapshot = {
      id: `ver_${crypto.randomUUID().slice(0, 10)}`,
      filePath: safe.normalizedRel,
      previousContent,
      newContent: content,
      changeType: existed ? 'modify' : 'create',
      editedBy: ctx.username,
      editedByRole: ctx.actorType,
      timestamp: new Date().toISOString(),
      summary: (summary || (existed ? 'Updated file' : 'Created new file')).slice(0, 160),
    };
    this.data.versions.unshift(snapshot);
    if (this.data.versions.length > 200) {
      this.data.versions.length = 200;
    }

    this.appendAudit({
      actorType: ctx.actorType,
      actorUsername: ctx.username,
      action: existed ? 'SOURCE_FILE_MODIFIED' : 'SOURCE_FILE_CREATED',
      category: 'source',
      target: safe.normalizedRel,
      outcome: 'success',
      details: `${existed ? 'Modified' : 'Created'} ${safe.normalizedRel}: ${snapshot.summary}`,
      ipAddress,
    });

    return { ok: true as const, snapshot };
  }

  public deleteRepositoryFile(ctx: AuthenticatedContext, relPath: string, ipAddress: string) {
    const safe = resolveSafeRepoPath(this.rootDir, relPath);
    if (!safe.safe) {
      return { ok: false as const, status: 403, error: safe.reason };
    }
    const category = classifyRepoPath(safe.normalizedRel);
    const criticalFiles = new Set([
      'package.json',
      'server.ts',
      'index.html',
      'src/App.tsx',
      'firestore.rules',
      'firebase-blueprint.json',
      'firebase-applet-config.json',
    ]);
    if (criticalFiles.has(safe.normalizedRel)) {
      return {
        ok: false as const,
        status: 403,
        error: 'Core entry files cannot be deleted via the code portal.',
      };
    }
    if (ctx.actorType === 'developer') {
      const neededPerm: DevPermissionKey =
        category === 'frontend' ? 'edit_frontend' : category === 'backend' ? 'edit_backend' : 'edit_backend';
      const check = this.checkDeveloperPermission(
        ctx,
        neededPerm,
        ipAddress,
        'DELETE_FILE',
        safe.normalizedRel
      );
      if (!check.allowed) return { ok: false as const, status: 403, error: check.reason };
    }
    if (!fs.existsSync(safe.absolutePath)) {
      return { ok: false as const, status: 404, error: 'File not found.' };
    }
    const previousContent = fs.readFileSync(safe.absolutePath, 'utf8');
    fs.unlinkSync(safe.absolutePath);

    const snapshot: FileVersionSnapshot = {
      id: `ver_${crypto.randomUUID().slice(0, 10)}`,
      filePath: safe.normalizedRel,
      previousContent,
      newContent: null,
      changeType: 'delete',
      editedBy: ctx.username,
      editedByRole: ctx.actorType,
      timestamp: new Date().toISOString(),
      summary: 'File deleted (snapshot saved for rollback)',
    };
    this.data.versions.unshift(snapshot);

    this.appendAudit({
      actorType: ctx.actorType,
      actorUsername: ctx.username,
      action: 'SOURCE_FILE_DELETED',
      category: 'source',
      target: safe.normalizedRel,
      outcome: 'alert',
      details: `Deleted ${safe.normalizedRel} (rollback snapshot ${snapshot.id} retained).`,
      ipAddress,
    });

    return { ok: true as const, snapshot };
  }

  public restoreVersionSnapshot(ownerUsername: string, versionId: string, ipAddress: string) {
    const snap = this.data.versions.find((v) => v.id === versionId);
    if (!snap) {
      return { ok: false as const, status: 404, error: 'Version snapshot not found.' };
    }
    const safe = resolveSafeRepoPath(this.rootDir, snap.filePath);
    if (!safe.safe) {
      return { ok: false as const, status: 403, error: safe.reason };
    }

    const currentContent = fs.existsSync(safe.absolutePath)
      ? fs.readFileSync(safe.absolutePath, 'utf8')
      : null;

    if (snap.previousContent === null) {
      if (fs.existsSync(safe.absolutePath)) {
        fs.unlinkSync(safe.absolutePath);
      }
    } else {
      fs.mkdirSync(path.dirname(safe.absolutePath), { recursive: true });
      fs.writeFileSync(safe.absolutePath, snap.previousContent, 'utf8');
    }

    const restoreSnap: FileVersionSnapshot = {
      id: `ver_${crypto.randomUUID().slice(0, 10)}`,
      filePath: snap.filePath,
      previousContent: currentContent,
      newContent: snap.previousContent,
      changeType: 'restore',
      editedBy: ownerUsername,
      editedByRole: 'owner',
      timestamp: new Date().toISOString(),
      summary: `Restored ${snap.filePath} prior to snapshot ${snap.id}`,
    };
    this.data.versions.unshift(restoreSnap);

    this.appendAudit({
      actorType: 'owner',
      actorUsername: ownerUsername,
      action: 'SOURCE_VERSION_RESTORED',
      category: 'source',
      target: snap.filePath,
      outcome: 'success',
      details: `Restored file ${snap.filePath} back to state prior to ${snap.timestamp}.`,
      ipAddress,
    });

    return { ok: true as const, snapshot: restoreSnap };
  }

  public buildAuditedSourceBundle(ctx: AuthenticatedContext, ipAddress: string) {
    const entries = this.listRepositoryFiles();
    const files: Record<string, string> = {};
    for (const entry of entries) {
      if (/\.(png|jpg|jpeg|webp|ico|woff2?)$/i.test(entry.path)) continue;
      const abs = path.join(this.rootDir, entry.path);
      if (fs.existsSync(abs)) {
        files[entry.path] = fs.readFileSync(abs, 'utf8');
      }
    }

    this.appendAudit({
      actorType: ctx.actorType,
      actorUsername: ctx.username,
      action: 'SOURCE_CODE_DOWNLOADED',
      category: 'source',
      target: `${Object.keys(files).length} files`,
      outcome: 'success',
      details: `Audited source bundle downloaded (${Object.keys(files).length} files, all .env/secrets stripped).`,
      ipAddress,
    });

    return {
      exportedAt: new Date().toISOString(),
      exportedBy: ctx.username,
      securityNotice: 'Protected environment secrets, vault credentials, and key files excluded.',
      fileCount: Object.keys(files).length,
      files,
    };
  }

  public createEncryptedBackup(ownerUsername: string, label: string, ipAddress: string) {
    const entries = this.listRepositoryFiles();
    const files: Record<string, string> = {};
    for (const entry of entries) {
      if (/\.(png|jpg|jpeg|webp|ico|woff2?)$/i.test(entry.path)) continue;
      const abs = path.join(this.rootDir, entry.path);
      if (fs.existsSync(abs)) {
        files[entry.path] = fs.readFileSync(abs, 'utf8');
      }
    }

    const now = new Date().toISOString();
    const epoch = this.data.securitySettings.keyEpoch;
    const envelope = encryptBackupPayload(
      {
        label: label || `Backup ${now}`,
        createdAt: now,
        createdBy: ownerUsername,
        files,
      },
      this.getBackupSecret(epoch),
      epoch,
      now
    );

    const backupId = `bak_${crypto.randomUUID().slice(0, 10)}`;
    const backupPath = path.join(this.backupDir, `${backupId}.avybak.json`);
    const rawJson = JSON.stringify(envelope, null, 2);
    fs.writeFileSync(backupPath, rawJson, { encoding: 'utf8', mode: 0o600 });

    const meta: BackupMetadata = {
      id: backupId,
      label: (label || `Snapshot ${now.slice(0, 16).replace('T', ' ')}`).slice(0, 80),
      createdAt: now,
      createdBy: ownerUsername,
      fileCount: Object.keys(files).length,
      encryptedBytes: Buffer.byteLength(rawJson, 'utf8'),
      algorithm: 'aes-256-gcm',
      keyEpoch: epoch,
    };
    this.data.backups.unshift(meta);
    this.appendAudit({
      actorType: 'owner',
      actorUsername: ownerUsername,
      action: 'ENCRYPTED_BACKUP_CREATED',
      category: 'backup',
      target: backupId,
      outcome: 'success',
      details: `AES-256-GCM encrypted backup "${meta.label}" created (${meta.fileCount} files).`,
      ipAddress,
    });

    return { ok: true as const, metadata: meta };
  }

  public readEncryptedBackupEnvelope(backupId: string): EncryptedBackupEnvelope | null {
    const safeId = backupId.replace(/[^a-zA-Z0-9_-]/g, '');
    const backupPath = path.join(this.backupDir, `${safeId}.avybak.json`);
    if (!fs.existsSync(backupPath)) return null;
    return JSON.parse(fs.readFileSync(backupPath, 'utf8')) as EncryptedBackupEnvelope;
  }

  public restoreFromEncryptedBackup(
    ownerUsername: string,
    backupId: string,
    ipAddress: string
  ) {
    const envelope = this.readEncryptedBackupEnvelope(backupId);
    if (!envelope) {
      return { ok: false as const, status: 404, error: 'Encrypted backup archive not found.' };
    }

    try {
      const decrypted = decryptBackupPayload<{
        label: string;
        files: Record<string, string>;
      }>(envelope, this.getBackupSecret(envelope.keyEpoch));

      let restoredCount = 0;
      for (const [relPath, content] of Object.entries(decrypted.files || {})) {
        const safe = resolveSafeRepoPath(this.rootDir, relPath);
        if (!safe.safe) continue;
        // Never overwrite active server.ts blindly during restore unless needed — restore src/, public/, config safely
        if (safe.normalizedRel.startsWith('src/') || safe.normalizedRel.startsWith('public/')) {
          fs.mkdirSync(path.dirname(safe.absolutePath), { recursive: true });
          fs.writeFileSync(safe.absolutePath, content, 'utf8');
          restoredCount += 1;
        }
      }

      this.appendAudit({
        actorType: 'owner',
        actorUsername: ownerUsername,
        action: 'ENCRYPTED_BACKUP_RESTORED',
        category: 'backup',
        target: backupId,
        outcome: 'success',
        details: `Verified AES-256-GCM integrity & restored ${restoredCount} frontend source files from backup "${decrypted.label}".`,
        ipAddress,
      });

      return { ok: true as const, restoredCount };
    } catch (err) {
      return {
        ok: false as const,
        status: 400,
        error: err instanceof Error ? err.message : 'Failed to decrypt backup archive.',
      };
    }
  }

  public getDatabaseSchemaSummary(ctx: AuthenticatedContext, ipAddress: string) {
    const readSafeText = (file: string) => {
      const safe = resolveSafeRepoPath(this.rootDir, file);
      if (!safe.safe || !fs.existsSync(safe.absolutePath)) return '';
      return fs.readFileSync(safe.absolutePath, 'utf8');
    };

    let firebasePublicConfig: Record<string, unknown> = {};
    try {
      const rawCfg = readSafeText('firebase-applet-config.json');
      if (rawCfg) {
        const parsed = JSON.parse(rawCfg) as Record<string, unknown>;
        firebasePublicConfig = {
          projectId: parsed.projectId || '',
          authDomain: parsed.authDomain || '',
          firestoreDatabaseId: parsed.firestoreDatabaseId || '',
          storageBucket: parsed.storageBucket || '',
        };
      }
    } catch {
      firebasePublicConfig = {};
    }

    this.appendAudit({
      actorType: ctx.actorType,
      actorUsername: ctx.username,
      action: 'DATABASE_SCHEMA_ACCESSED',
      category: 'database',
      target: 'firebase-blueprint.json & firestore.rules',
      outcome: 'success',
      details: 'Inspected Firestore schema blueprint, rules, and non-secret database configuration.',
      ipAddress,
    });

    return {
      firebaseConfig: firebasePublicConfig,
      blueprintJson: readSafeText('firebase-blueprint.json'),
      firestoreRules: readSafeText('firestore.rules'),
      vaultPath: '.devsec-vault/vault.json (Server-side protected)',
    };
  }

  public getApiAndHostingConfig(ctx: AuthenticatedContext, ipAddress: string) {
    this.appendAudit({
      actorType: ctx.actorType,
      actorUsername: ctx.username,
      action: 'API_AND_HOSTING_CONFIG_ACCESSED',
      category: 'api',
      target: 'server-config',
      outcome: 'success',
      details: 'Viewed API integration endpoints (masked secrets) and environment hosting separation.',
      ipAddress,
    });

    return {
      apiIntegrationSettings: { ...this.data.apiIntegrationSettings },
      maskedSecrets: [
        {
          key: 'GEMINI_API_KEY',
          scope: 'Server-side OCR & Billing Drafter (/api/ocr/*, /api/billing/*)',
          status: maskSecretValue(process.env.GEMINI_API_KEY),
        },
        {
          key: 'VITE_GOOGLE_MAPS_API_KEY',
          scope: 'Project Geo-Pins Map Integration',
          status: maskSecretValue(process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY),
        },
        {
          key: 'DEVSEC_OWNER_PASSWORD',
          scope: 'Master Owner Env Override',
          status: process.env.DEVSEC_OWNER_PASSWORD ? 'Configured (Hidden)' : 'UI Claim Mode Active',
        },
        {
          key: 'DEVSEC_SESSION_SECRET',
          scope: 'HMAC Session Signing',
          status: process.env.DEVSEC_SESSION_SECRET ? 'Configured (Hidden)' : `Runtime Ephemeral (Epoch v${this.data.securitySettings.keyEpoch})`,
        },
      ],
      environments: [...this.data.environments],
      securitySettings: { ...this.data.securitySettings },
    };
  }

  public updateApiIntegrationConfig(
    ctx: AuthenticatedContext,
    updates: Partial<DevSecVaultData['apiIntegrationSettings']>,
    ipAddress: string
  ) {
    if (typeof updates.geminiEnabled === 'boolean') {
      this.data.apiIntegrationSettings.geminiEnabled = updates.geminiEnabled;
    }
    if (typeof updates.mapsEnabled === 'boolean') {
      this.data.apiIntegrationSettings.mapsEnabled = updates.mapsEnabled;
    }
    if (typeof updates.firebaseSyncEnabled === 'boolean') {
      this.data.apiIntegrationSettings.firebaseSyncEnabled = updates.firebaseSyncEnabled;
    }
    if (typeof updates.pwaInstallEnabled === 'boolean') {
      this.data.apiIntegrationSettings.pwaInstallEnabled = updates.pwaInstallEnabled;
    }
    if (typeof updates.allowedOrigins === 'string' && updates.allowedOrigins.trim()) {
      this.data.apiIntegrationSettings.allowedOrigins = updates.allowedOrigins.trim().slice(0, 160);
    }
    this.data.apiIntegrationSettings.updatedAt = new Date().toISOString();

    this.appendAudit({
      actorType: ctx.actorType,
      actorUsername: ctx.username,
      action: 'API_CONFIG_UPDATED',
      category: 'api',
      target: 'apiIntegrationSettings',
      outcome: 'success',
      details: `Updated API integration toggles & origins (${this.data.apiIntegrationSettings.allowedOrigins}).`,
      ipAddress,
    });

    return { ok: true, apiIntegrationSettings: { ...this.data.apiIntegrationSettings } };
  }

  public requestDeployment(
    ctx: AuthenticatedContext,
    input: {
      environment: EnvironmentName;
      versionTag: string;
      commitSummary: string;
      notes?: string;
      ipAddress: string;
    }
  ) {
    const env: EnvironmentName = ['development', 'staging', 'production'].includes(input.environment)
      ? input.environment
      : 'staging';
    const now = new Date().toISOString();
    const versionTag = (input.versionTag || `v1.0.${this.data.deployments.length + 1}`).trim().slice(0, 40);
    const commitSummary = (input.commitSummary || 'Application update').trim().slice(0, 180);

    // Production deployments ALWAYS require Owner authorization
    const isOwnerAutoDeploy = ctx.actorType === 'owner';
    const requiresApproval = env === 'production' || (env === 'staging' && ctx.actorType === 'developer');

    const record: DeploymentRecord = {
      id: `dep_${crypto.randomUUID().slice(0, 8)}`,
      environment: env,
      versionTag,
      commitSummary,
      requestedBy: ctx.username,
      requestedByRole: ctx.actorType,
      status: isOwnerAutoDeploy
        ? 'deployed'
        : requiresApproval
          ? 'pending_owner_approval'
          : 'deployed',
      ownerApprovedBy: isOwnerAutoDeploy ? ctx.username : null,
      createdAt: now,
      deployedAt: isOwnerAutoDeploy || !requiresApproval ? now : null,
      notes: (input.notes || '').trim().slice(0, 240),
    };

    this.data.deployments.unshift(record);
    this.appendAudit({
      actorType: ctx.actorType,
      actorUsername: ctx.username,
      action: record.status === 'deployed' ? 'DEPLOYMENT_EXECUTED' : 'DEPLOYMENT_REQUESTED',
      category: 'deployment',
      target: `${env}:${versionTag}`,
      outcome: 'success',
      details:
        record.status === 'deployed'
          ? `Deployed ${versionTag} to ${env}: ${commitSummary}`
          : `Requested ${env} deployment ${versionTag} (awaiting Master Owner sign-off).`,
      ipAddress: input.ipAddress,
    });

    return { ok: true as const, deployment: record };
  }

  public decideDeployment(
    ownerUsername: string,
    deploymentId: string,
    decision: 'approve_and_deploy' | 'reject',
    ipAddress: string
  ) {
    const dep = this.data.deployments.find((d) => d.id === deploymentId);
    if (!dep) {
      return { ok: false as const, status: 404, error: 'Deployment record not found.' };
    }
    const now = new Date().toISOString();
    if (decision === 'reject') {
      dep.status = 'rejected';
      dep.ownerApprovedBy = ownerUsername;
      this.appendAudit({
        actorType: 'owner',
        actorUsername: ownerUsername,
        action: 'DEPLOYMENT_REJECTED',
        category: 'deployment',
        target: `${dep.environment}:${dep.versionTag}`,
        outcome: 'denied',
        details: `Master Owner rejected deployment ${dep.versionTag} requested by ${dep.requestedBy}.`,
        ipAddress,
      });
      return { ok: true as const, deployment: dep };
    }

    dep.status = 'deployed';
    dep.ownerApprovedBy = ownerUsername;
    dep.deployedAt = now;
    this.appendAudit({
      actorType: 'owner',
      actorUsername: ownerUsername,
      action: 'DEPLOYMENT_APPROVED_AND_EXECUTED',
      category: 'deployment',
      target: `${dep.environment}:${dep.versionTag}`,
      outcome: 'success',
      details: `Master Owner approved and deployed ${dep.versionTag} to ${dep.environment}.`,
      ipAddress,
    });
    return { ok: true as const, deployment: dep };
  }

  public getApplicationLogs(ctx: AuthenticatedContext, ipAddress: string) {
    this.appendAudit({
      actorType: ctx.actorType,
      actorUsername: ctx.username,
      action: 'APPLICATION_LOGS_VIEWED',
      category: 'source',
      target: 'application-logs',
      outcome: 'success',
      details: 'Viewed application runtime & security audit stream.',
      ipAddress,
    });
    return {
      serverUptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development',
      recentLogs: this.data.auditLogs.slice(0, 80),
    };
  }

  public updateSecuritySettings(
    ownerUsername: string,
    updates: Partial<SecuritySettingsState>,
    ipAddress: string
  ) {
    if (typeof updates.sessionTtlMinutes === 'number') {
      this.data.securitySettings.sessionTtlMinutes = Math.max(5, Math.min(480, updates.sessionTtlMinutes));
    }
    if (typeof updates.maxFailedLoginAttempts === 'number') {
      this.data.securitySettings.maxFailedLoginAttempts = Math.max(3, Math.min(10, updates.maxFailedLoginAttempts));
    }
    if (typeof updates.lockoutDurationMinutes === 'number') {
      this.data.securitySettings.lockoutDurationMinutes = Math.max(1, Math.min(1440, updates.lockoutDurationMinutes));
    }
    if (typeof updates.requireEmailVerification === 'boolean') {
      this.data.securitySettings.requireEmailVerification = updates.requireEmailVerification;
    }
    if (typeof updates.requireTwoFactorAuth === 'boolean') {
      this.data.securitySettings.requireTwoFactorAuth = updates.requireTwoFactorAuth;
    }
    this.data.securitySettings.requireOwnerApprovalForProdDeploy = true;

    this.appendAudit({
      actorType: 'owner',
      actorUsername: ownerUsername,
      action: 'SECURITY_SETTINGS_UPDATED',
      category: 'permission',
      target: 'securitySettings',
      outcome: 'success',
      details: `Updated policy: TTL=${this.data.securitySettings.sessionTtlMinutes}m, MaxAttempts=${this.data.securitySettings.maxFailedLoginAttempts}, Lockout=${this.data.securitySettings.lockoutDurationMinutes}m.`,
      ipAddress,
    });
    return { ok: true, securitySettings: { ...this.data.securitySettings } };
  }

  public acknowledgeAlerts(ownerUsername: string, ipAddress: string) {
    this.data.alerts.forEach((a) => {
      a.acknowledged = true;
    });
    this.appendAudit({
      actorType: 'owner',
      actorUsername: ownerUsername,
      action: 'SECURITY_ALERTS_ACKNOWLEDGED',
      category: 'emergency',
      target: 'alerts',
      outcome: 'success',
      details: 'Owner acknowledged security alerts.',
      ipAddress,
    });
    return { ok: true };
  }

  public getDeploymentsForActor(ctx: AuthenticatedContext): DeploymentRecord[] {
    if (ctx.actorType === 'owner') return [...this.data.deployments];
    return [...this.data.deployments].slice(0, 30);
  }
}
