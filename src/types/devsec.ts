export type DevPermissionKey =
  | 'view_source'
  | 'edit_frontend'
  | 'edit_backend'
  | 'access_db_schema'
  | 'access_api_config'
  | 'deploy_updates'
  | 'download_source'
  | 'access_hosting'
  | 'view_logs';

export type DevPermissions = Record<DevPermissionKey, boolean>;

export const DEV_PERMISSION_META: {
  key: DevPermissionKey;
  label: string;
  description: string;
  category: 'code' | 'infra' | 'ops';
}[] = [
  {
    key: 'view_source',
    label: 'View Source Code',
    description: 'Browse repository files and inspect frontend/backend source code.',
    category: 'code',
  },
  {
    key: 'edit_frontend',
    label: 'Edit Frontend Code',
    description: 'Create, modify, or delete UI & client files under src/, public/, and index.html.',
    category: 'code',
  },
  {
    key: 'edit_backend',
    label: 'Edit Backend Code',
    description: 'Create or modify Express routes and server modules (server.ts, server/**).',
    category: 'code',
  },
  {
    key: 'download_source',
    label: 'Download Source Code',
    description: 'Export audited source bundle archives (secret files are always excluded).',
    category: 'code',
  },
  {
    key: 'access_db_schema',
    label: 'Access Database Schema',
    description: 'Inspect Firestore schema blueprint, security rules, and DB configuration.',
    category: 'infra',
  },
  {
    key: 'access_api_config',
    label: 'Access API Configuration',
    description: 'View API endpoint mappings and masked integration key status.',
    category: 'infra',
  },
  {
    key: 'access_hosting',
    label: 'Access Hosting Settings',
    description: 'View development, staging, and production hosting & port configuration.',
    category: 'infra',
  },
  {
    key: 'deploy_updates',
    label: 'Deploy Application Updates',
    description: 'Submit staging/production deployment requests (production requires Owner sign-off).',
    category: 'ops',
  },
  {
    key: 'view_logs',
    label: 'View Application Logs',
    description: 'Inspect runtime health logs, request traces, and security status feed.',
    category: 'ops',
  },
];

export type AccessDurationPreset = '1h' | '6h' | '24h' | '7d' | 'custom';

export type DeveloperAccountStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'revoked'
  | 'disabled';

export type EnvironmentName = 'development' | 'staging' | 'production';

export type AuditOutcome = 'success' | 'denied' | 'alert';

export interface PublicDeveloperAccount {
  id: string;
  username: string;
  email: string;
  fullName: string;
  roleTitle: string;
  requestReason: string;
  status: DeveloperAccountStatus;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  permissions: DevPermissions;
  durationPreset: AccessDurationPreset | null;
  accessGrantedAt: string | null;
  accessExpiresAt: string | null;
  isExpiredNow: boolean;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedBy: string | null;
  reviewNote: string | null;
}

export interface ActiveDevSecSession {
  sessionId: string;
  actorType: 'owner' | 'developer';
  accountId: string;
  username: string;
  displayName: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ipAddress: string;
  userAgent: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorType: 'owner' | 'developer' | 'system';
  actorUsername: string;
  action: string;
  category:
    | 'auth'
    | 'source'
    | 'database'
    | 'api'
    | 'deployment'
    | 'permission'
    | 'emergency'
    | 'backup';
  target: string;
  outcome: AuditOutcome;
  details: string;
  ipAddress: string;
}

export interface SecurityAlertItem {
  id: string;
  timestamp: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  details: string;
  acknowledged: boolean;
}

export interface FileVersionSnapshot {
  id: string;
  filePath: string;
  previousContent: string | null;
  newContent: string | null;
  changeType: 'modify' | 'create' | 'delete' | 'restore';
  editedBy: string;
  editedByRole: 'owner' | 'developer';
  timestamp: string;
  summary: string;
}

export interface DeploymentRecord {
  id: string;
  environment: EnvironmentName;
  versionTag: string;
  commitSummary: string;
  requestedBy: string;
  requestedByRole: 'owner' | 'developer';
  status: 'pending_owner_approval' | 'approved' | 'deployed' | 'rejected';
  ownerApprovedBy: string | null;
  createdAt: string;
  deployedAt: string | null;
  notes: string;
}

export interface BackupMetadata {
  id: string;
  label: string;
  createdAt: string;
  createdBy: string;
  fileCount: number;
  encryptedBytes: number;
  algorithm: 'aes-256-gcm';
  keyEpoch: number;
}

export interface RepoFileEntry {
  path: string;
  category: 'frontend' | 'backend' | 'schema' | 'config' | 'other';
  sizeBytes: number;
  updatedAt: string;
}

export interface EnvironmentHostingConfig {
  environment: EnvironmentName;
  branch: string;
  deploymentMode: 'auto_sandbox' | 'owner_gated';
  requireOwnerApproval: boolean;
  enforceHttps: boolean;
  port: number;
  hostUrl: string;
  lastUpdatedAt: string;
}

export interface SecuritySettingsState {
  sessionTtlMinutes: number;
  maxFailedLoginAttempts: number;
  lockoutDurationMinutes: number;
  requireEmailVerification: boolean;
  requireTwoFactorAuth: boolean;
  requireOwnerApprovalForProdDeploy: boolean;
  keyEpoch: number;
  lastCredentialRotationAt: string | null;
}

export interface OwnerDashboardSummary {
  ownerUsername: string;
  ownerEmail: string;
  metrics: {
    totalAuthorizedDevelopers: number;
    activeDeveloperAccounts: number;
    currentActiveSessions: number;
    pendingAccessRequests: number;
    expiredPermissions: number;
    recentSourceModifications: number;
    deploymentCount: number;
    securityAlertsCount: number;
  };
  developers: PublicDeveloperAccount[];
  sessions: ActiveDevSecSession[];
  auditLogs: AuditLogEntry[];
  alerts: SecurityAlertItem[];
  versions: FileVersionSnapshot[];
  deployments: DeploymentRecord[];
  backups: BackupMetadata[];
  environments: EnvironmentHostingConfig[];
  securitySettings: SecuritySettingsState;
}

export interface DevSecStatusResponse {
  ownerClaimed: boolean;
  ownerEnvConfigured: boolean;
  requireEmailVerification: boolean;
  requireTwoFactorAuth: boolean;
}
