import type {
  AccessDurationPreset,
  ActiveDevSecSession,
  AuditLogEntry,
  DeploymentRecord,
  DevPermissions,
  DevSecStatusResponse,
  EnvironmentHostingConfig,
  EnvironmentName,
  FileVersionSnapshot,
  OwnerDashboardSummary,
  PublicDeveloperAccount,
  RepoFileEntry,
  SecuritySettingsState,
} from '../types/devsec';

async function devsecFetch<T>(
  path: string,
  opts: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    token?: string | null;
    body?: unknown;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  const response = await fetch(`/api/devsec${path}`, {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }
  if (!response.ok) {
    const logicalStatus =
      typeof parsed.status === 'number' ? parsed.status : response.status;
    const fallbackMessage =
      logicalStatus === 403
        ? 'Access forbidden (403). Verify your account permissions, email verification, or active preview session and try again.'
        : `Request failed with status ${logicalStatus}`;
    const err = new Error(
      typeof parsed.error === 'string' ? parsed.error : fallbackMessage
    ) as Error & { status?: number; code?: string };
    err.status = logicalStatus;
    if (typeof parsed.code === 'string') {
      err.code = parsed.code;
    }
    throw err;
  }
  return parsed as unknown as T;
}

export const devsecApi = {
  getStatus: () => devsecFetch<DevSecStatusResponse>('/status'),

  claimOwner: (payload: { username: string; email: string; password: string }) =>
    devsecFetch<{
      token: string;
      session: ActiveDevSecSession;
      summary: OwnerDashboardSummary;
    }>('/owner/claim', { method: 'POST', body: payload }),

  loginOwner: (payload: { username: string; password: string }) =>
    devsecFetch<{
      token: string;
      session: ActiveDevSecSession;
      summary: OwnerDashboardSummary;
    }>('/owner/login', { method: 'POST', body: payload }),

  registerDeveloper: (payload: {
    username: string;
    email: string;
    fullName: string;
    roleTitle: string;
    requestReason: string;
    password: string;
  }) =>
    devsecFetch<{
      account: PublicDeveloperAccount;
      totpSetup: { secret: string; otpAuthUri: string; qrDataUrl: string };
      emailVerificationPreviewCode: string;
    }>('/dev/register', { method: 'POST', body: payload }),

  verifyDeveloperEmail: (payload: { username: string; code: string }) =>
    devsecFetch<{ verified: boolean; alreadyVerified: boolean }>('/dev/verify-email', {
      method: 'POST',
      body: payload,
    }),

  resendDeveloperVerificationCode: (payload: { username: string; password: string }) =>
    devsecFetch<{
      alreadyVerified: boolean;
      username: string;
      email: string;
      emailVerificationPreviewCode?: string;
    }>('/dev/resend-verification', {
      method: 'POST',
      body: payload,
    }),

  loginDeveloper: (payload: { username: string; password: string; totpCode: string }) =>
    devsecFetch<{
      token: string;
      session: ActiveDevSecSession;
      account: PublicDeveloperAccount;
    }>('/dev/login', { method: 'POST', body: payload }),

  logout: (token: string) =>
    devsecFetch<{ ok: boolean }>('/logout', { method: 'POST', token }),

  getMe: (token: string) =>
    devsecFetch<
      | { actorType: 'owner'; session: ActiveDevSecSession; summary: OwnerDashboardSummary }
      | {
          actorType: 'developer';
          session: ActiveDevSecSession;
          account: PublicDeveloperAccount;
          deployments: DeploymentRecord[];
        }
    >('/me', { token }),

  getOwnerDashboard: (token: string) =>
    devsecFetch<OwnerDashboardSummary>('/owner/dashboard', { token }),

  decideDeveloper: (
    token: string,
    developerId: string,
    payload: {
      decision: 'approve' | 'reject' | 'update' | 'revoke' | 'disable' | 'enable' | 'verify_email';
      permissions?: Partial<DevPermissions>;
      durationPreset?: AccessDurationPreset;
      customExpiresAt?: string | null;
      reviewNote?: string;
    }
  ) =>
    devsecFetch<{ account: PublicDeveloperAccount; summary: OwnerDashboardSummary }>(
      `/owner/developers/${encodeURIComponent(developerId)}/decision`,
      { method: 'POST', token, body: payload }
    ),

  terminateSession: (token: string, sessionId: string) =>
    devsecFetch<{ summary: OwnerDashboardSummary }>(
      `/owner/sessions/${encodeURIComponent(sessionId)}/terminate`,
      { method: 'POST', token }
    ),

  emergencyAction: (
    token: string,
    action: 'revoke_all_developers' | 'terminate_all_dev_sessions' | 'rotate_credentials'
  ) =>
    devsecFetch<{
      result: Record<string, unknown>;
      token?: string;
      session: ActiveDevSecSession;
      summary: OwnerDashboardSummary;
    }>('/owner/emergency', { method: 'POST', token, body: { action } }),

  updateSecuritySettings: (token: string, updates: Partial<SecuritySettingsState>) =>
    devsecFetch<{ ok: boolean; summary: OwnerDashboardSummary }>(
      '/owner/security-settings',
      { method: 'POST', token, body: updates }
    ),

  acknowledgeAlerts: (token: string) =>
    devsecFetch<{ summary: OwnerDashboardSummary }>('/owner/alerts/acknowledge', {
      method: 'POST',
      token,
    }),

  restoreVersion: (token: string, versionId: string) =>
    devsecFetch<{ snapshot: FileVersionSnapshot; summary: OwnerDashboardSummary }>(
      `/owner/versions/${encodeURIComponent(versionId)}/restore`,
      { method: 'POST', token }
    ),

  createBackup: (token: string, label: string) =>
    devsecFetch<{ summary: OwnerDashboardSummary }>('/owner/backups', {
      method: 'POST',
      token,
      body: { label },
    }),

  downloadBackup: async (token: string, backupId: string) => {
    const res = await fetch(`/api/devsec/owner/backups/${encodeURIComponent(backupId)}/download`, {
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error('Failed to download encrypted backup');
    }
    return res.blob();
  },

  restoreBackup: (token: string, backupId: string) =>
    devsecFetch<{ restoredCount: number; summary: OwnerDashboardSummary }>(
      `/owner/backups/${encodeURIComponent(backupId)}/restore`,
      { method: 'POST', token }
    ),

  decideDeployment: (
    token: string,
    deploymentId: string,
    decision: 'approve_and_deploy' | 'reject'
  ) =>
    devsecFetch<{ deployment: DeploymentRecord; summary: OwnerDashboardSummary }>(
      `/owner/deployments/${encodeURIComponent(deploymentId)}/decide`,
      { method: 'POST', token, body: { decision } }
    ),

  listFiles: (token: string) =>
    devsecFetch<{ files: RepoFileEntry[] }>('/source/files', { token }),

  readFile: (token: string, relPath: string) =>
    devsecFetch<{ path: string; category: string; content: string }>(
      `/source/file?path=${encodeURIComponent(relPath)}`,
      { token }
    ),

  writeFile: (token: string, payload: { path: string; content: string; summary: string }) =>
    devsecFetch<{ snapshot: FileVersionSnapshot }>('/source/file', {
      method: 'PUT',
      token,
      body: payload,
    }),

  deleteFile: (token: string, relPath: string) =>
    devsecFetch<{ snapshot: FileVersionSnapshot }>(
      `/source/file?path=${encodeURIComponent(relPath)}`,
      { method: 'DELETE', token }
    ),

  downloadSourceBundle: async (token: string) => {
    const res = await fetch('/api/devsec/source/download', {
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof data?.error === 'string' ? data.error : 'Download permission denied'
      );
    }
    return data as Record<string, unknown>;
  },

  getDatabaseSchema: (token: string) =>
    devsecFetch<{
      firebaseConfig: Record<string, unknown>;
      blueprintJson: string;
      firestoreRules: string;
      vaultPath: string;
    }>('/database/schema', { token }),

  getApiAndHostingConfig: (token: string) =>
    devsecFetch<{
      apiIntegrationSettings: {
        geminiEnabled: boolean;
        mapsEnabled: boolean;
        firebaseSyncEnabled: boolean;
        pwaInstallEnabled: boolean;
        allowedOrigins: string;
        updatedAt: string;
      };
      maskedSecrets: { key: string; scope: string; status: string }[];
      environments: EnvironmentHostingConfig[];
      securitySettings: SecuritySettingsState;
    }>('/api-hosting/config', { token }),

  updateApiConfig: (
    token: string,
    updates: {
      geminiEnabled?: boolean;
      mapsEnabled?: boolean;
      firebaseSyncEnabled?: boolean;
      pwaInstallEnabled?: boolean;
      allowedOrigins?: string;
    }
  ) =>
    devsecFetch<{ ok: boolean }>('/api-hosting/config', {
      method: 'PUT',
      token,
      body: updates,
    }),

  requestDeployment: (
    token: string,
    payload: {
      environment: EnvironmentName;
      versionTag: string;
      commitSummary: string;
      notes?: string;
    }
  ) =>
    devsecFetch<{ ok: boolean; deployment: DeploymentRecord }>('/deployments', {
      method: 'POST',
      token,
      body: payload,
    }),

  getApplicationLogs: (token: string) =>
    devsecFetch<{
      serverUptimeSec: number;
      nodeVersion: string;
      environment: string;
      recentLogs: AuditLogEntry[];
    }>('/logs', { token }),
};
