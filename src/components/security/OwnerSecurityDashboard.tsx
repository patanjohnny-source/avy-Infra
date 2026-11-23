import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Code2,
  Database,
  Download,
  KeyRound,
  Lock,
  PowerOff,
  RefreshCw,
  Rocket,
  RotateCcw,
  Server,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
  XCircle,
} from 'lucide-react';
import { devsecApi } from '../../utils/devsecApi';
import {
  DEV_PERMISSION_META,
  type AccessDurationPreset,
  type DevPermissionKey,
  type DevPermissions,
  type EnvironmentName,
  type OwnerDashboardSummary,
  type PublicDeveloperAccount,
} from '../../types/devsec';
import { SourceExplorerPanel } from './SourceExplorerPanel';

interface OwnerSecurityDashboardProps {
  token: string;
  initialSummary: OwnerDashboardSummary;
  onTokenRefreshed: (nextToken: string) => void;
  onSessionInvalid: () => void;
}

type OwnerTab = 'approvals' | 'source' | 'infrastructure' | 'deployments' | 'audit';

function emptyPerms(): DevPermissions {
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

export function OwnerSecurityDashboard({
  token,
  initialSummary,
  onTokenRefreshed,
  onSessionInvalid,
}: OwnerSecurityDashboardProps) {
  const [summary, setSummary] = useState<OwnerDashboardSummary>(initialSummary);
  const [tab, setTab] = useState<OwnerTab>('approvals');
  const [busyMsg, setBusyMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmEmergency, setConfirmEmergency] = useState<
    'revoke_all_developers' | 'terminate_all_dev_sessions' | 'rotate_credentials' | null
  >(null);

  // Selected developer to review / edit permissions
  const [editingDev, setEditingDev] = useState<PublicDeveloperAccount | null>(null);
  const [draftPerms, setDraftPerms] = useState<DevPermissions>(emptyPerms());
  const [draftDuration, setDraftDuration] = useState<AccessDurationPreset>('24h');
  const [draftCustomExpiry, setDraftCustomExpiry] = useState('');
  const [draftNote, setDraftNote] = useState('');

  // Infrastructure tab state
  const [dbSchema, setDbSchema] = useState<{
    firebaseConfig: Record<string, unknown>;
    blueprintJson: string;
    firestoreRules: string;
    vaultPath: string;
  } | null>(null);
  const [apiHosting, setApiHosting] = useState<{
    apiIntegrationSettings: {
      geminiEnabled: boolean;
      mapsEnabled: boolean;
      firebaseSyncEnabled: boolean;
      pwaInstallEnabled: boolean;
      allowedOrigins: string;
      updatedAt: string;
    };
    maskedSecrets: { key: string; scope: string; status: string }[];
  } | null>(null);
  const [backupLabel, setBackupLabel] = useState('');

  // Deployments form
  const [deployEnv, setDeployEnv] = useState<EnvironmentName>('production');
  const [deployTag, setDeployTag] = useState('v1.1.0-prod');
  const [deploySummary, setDeploySummary] = useState('');

  // Audit filter
  const [auditSearch, setAuditSearch] = useState('');
  const [auditCategory, setAuditCategory] = useState('all');

  // Security Policy state
  const [policyTtl, setPolicyTtl] = useState(initialSummary.securitySettings.sessionTtlMinutes);
  const [policyMaxAttempts, setPolicyMaxAttempts] = useState(
    initialSummary.securitySettings.maxFailedLoginAttempts
  );
  const [policyLockoutMin, setPolicyLockoutMin] = useState(
    initialSummary.securitySettings.lockoutDurationMinutes
  );

  const handleErr = (err: unknown) => {
    const e = err as Error & { status?: number };
    if (e.status === 401) {
      onSessionInvalid();
      return;
    }
    setErrorMsg(e.message || 'Action failed');
  };

  const refreshDashboard = async () => {
    setErrorMsg('');
    try {
      const next = await devsecApi.getOwnerDashboard(token);
      setSummary(next);
    } catch (err) {
      handleErr(err);
    }
  };

  useEffect(() => {
    if (tab === 'infrastructure' && !dbSchema) {
      void (async () => {
        try {
          const [schemaRes, apiRes] = await Promise.all([
            devsecApi.getDatabaseSchema(token),
            devsecApi.getApiAndHostingConfig(token),
          ]);
          setDbSchema(schemaRes);
          setApiHosting(apiRes);
        } catch (err) {
          handleErr(err);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const openReviewDrawer = (dev: PublicDeveloperAccount) => {
    setEditingDev(dev);
    setDraftPerms({ ...dev.permissions });
    setDraftDuration(dev.durationPreset || '24h');
    setDraftCustomExpiry(
      dev.accessExpiresAt ? dev.accessExpiresAt.slice(0, 16) : ''
    );
    setDraftNote(dev.reviewNote || '');
    setErrorMsg('');
    setBusyMsg('');
  };

  const handleDeveloperDecision = async (
    developerId: string,
    decision: 'approve' | 'reject' | 'update' | 'revoke' | 'disable' | 'enable' | 'verify_email'
  ) => {
    setErrorMsg('');
    setBusyMsg('');
    try {
      const res = await devsecApi.decideDeveloper(token, developerId, {
        decision,
        permissions: draftPerms,
        durationPreset: draftDuration,
        customExpiresAt:
          draftDuration === 'custom' && draftCustomExpiry
            ? new Date(draftCustomExpiry).toISOString()
            : null,
        reviewNote: draftNote,
      });
      setSummary(res.summary);
      if (decision === 'verify_email' && editingDev?.id === developerId) {
        setEditingDev(res.account);
      } else {
        setEditingDev(null);
      }
      setBusyMsg(
        decision === 'verify_email'
          ? `Email verified by Owner for @${res.account.username}.`
          : `Developer @${res.account.username} updated (${decision}).`
      );
    } catch (err) {
      handleErr(err);
    }
  };

  const handleEmergency = async (
    action: 'revoke_all_developers' | 'terminate_all_dev_sessions' | 'rotate_credentials'
  ) => {
    setErrorMsg('');
    setBusyMsg('');
    try {
      const res = await devsecApi.emergencyAction(token, action);
      if (res.token) {
        onTokenRefreshed(res.token);
      }
      setSummary(res.summary);
      setConfirmEmergency(null);
      setBusyMsg(
        action === 'revoke_all_developers'
          ? 'Emergency lock applied: all developer accounts revoked and sessions terminated.'
          : action === 'terminate_all_dev_sessions'
            ? 'All active developer sessions terminated.'
            : 'Signing & backup credentials rotated cleanly. Previous developer tokens invalidated.'
      );
    } catch (err) {
      handleErr(err);
    }
  };

  const handleCreateBackup = async () => {
    setErrorMsg('');
    setBusyMsg('');
    try {
      const res = await devsecApi.createBackup(
        token,
        backupLabel.trim() || `Owner Snapshot ${new Date().toISOString().slice(0, 16)}`
      );
      setSummary(res.summary);
      setBackupLabel('');
      setBusyMsg('Encrypted AES-256-GCM backup created and stored in Owner vault.');
    } catch (err) {
      handleErr(err);
    }
  };

  const handleDownloadBackup = async (backupId: string) => {
    try {
      const blob = await devsecApi.downloadBackup(token, backupId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${backupId}.avybak.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      handleErr(err);
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    setErrorMsg('');
    setBusyMsg('');
    try {
      const res = await devsecApi.restoreBackup(token, backupId);
      setSummary(res.summary);
      setBusyMsg(`Verified AES-256-GCM backup and restored ${res.restoredCount} source files.`);
    } catch (err) {
      handleErr(err);
    }
  };

  const handleOwnerDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setBusyMsg('');
    try {
      await devsecApi.requestDeployment(token, {
        environment: deployEnv,
        versionTag: deployTag,
        commitSummary: deploySummary || `Master Owner release to ${deployEnv}`,
      });
      setDeploySummary('');
      await refreshDashboard();
      setBusyMsg(`Deployed ${deployTag} to ${deployEnv}.`);
    } catch (err) {
      handleErr(err);
    }
  };

  const handleDecideDeployment = async (
    deploymentId: string,
    decision: 'approve_and_deploy' | 'reject'
  ) => {
    setErrorMsg('');
    setBusyMsg('');
    try {
      const res = await devsecApi.decideDeployment(token, deploymentId, decision);
      setSummary(res.summary);
      setBusyMsg(
        decision === 'approve_and_deploy'
          ? `Approved & deployed ${res.deployment.versionTag} to ${res.deployment.environment}.`
          : `Rejected deployment ${res.deployment.versionTag}.`
      );
    } catch (err) {
      handleErr(err);
    }
  };

  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return summary.auditLogs.filter((l) => {
      if (auditCategory !== 'all' && l.category !== auditCategory) return false;
      if (
        q &&
        !l.actorUsername.toLowerCase().includes(q) &&
        !l.action.toLowerCase().includes(q) &&
        !l.target.toLowerCase().includes(q) &&
        !l.details.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [summary.auditLogs, auditSearch, auditCategory]);

  const m = summary.metrics;

  return (
    <div className="space-y-6">
      {/* Emergency Controls Bar */}
      <div className="bg-slate-900 text-slate-100 rounded-xl p-4 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-700 text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">
              Master Owner Security Command Center
            </div>
            <div className="text-xs text-slate-400">
              Owner: <span className="font-mono text-slate-200">{summary.ownerUsername}</span> ·
              Key Epoch <span className="font-mono text-slate-200">v{summary.securitySettings.keyEpoch}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshDashboard()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-slate-200 border border-slate-700 rounded-md hover:bg-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => void handleCreateBackup()}
            data-testid="owner-quick-backup-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-slate-100 border border-slate-700 rounded-md hover:bg-slate-700"
          >
            <Archive className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
            <span>Encrypted Backup</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmEmergency('rotate_credentials')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-amber-200 border border-amber-700/60 rounded-md hover:bg-slate-700"
          >
            <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Rotate Keys</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmEmergency('terminate_all_dev_sessions')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-orange-200 border border-orange-700/60 rounded-md hover:bg-slate-700"
          >
            <PowerOff className="w-3.5 h-3.5" aria-hidden="true" />
            <span>End Dev Sessions</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmEmergency('revoke_all_developers')}
            data-testid="owner-emergency-revoke-all-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-700 text-white rounded-md hover:bg-red-800"
          >
            <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Revoke All Access</span>
          </button>
        </div>
      </div>

      {/* Inline Emergency Confirmation Strip */}
      {confirmEmergency && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-lg flex flex-wrap items-center justify-between gap-3"
        >
          <div className="text-xs text-red-900">
            <span className="font-semibold">Confirm Emergency Security Action:</span>{' '}
            {confirmEmergency === 'revoke_all_developers'
              ? 'This will immediately revoke all pending & approved developer permissions and terminate all active developer sessions.'
              : confirmEmergency === 'terminate_all_dev_sessions'
                ? 'This will immediately terminate every active developer session.'
                : 'This will increment the cryptographic signing key epoch and invalidate all active developer tokens.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleEmergency(confirmEmergency)}
              data-testid="owner-confirm-emergency-btn"
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-red-700 rounded-md hover:bg-red-800"
            >
              Confirm Execute
            </button>
            <button
              type="button"
              onClick={() => setConfirmEmergency(null)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div role="alert" className="p-3 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md">
          {errorMsg}
        </div>
      )}
      {busyMsg && (
        <div className="p-3 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
          {busyMsg}
        </div>
      )}

      {/* 8 Security Dashboard KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Authorized Devs', value: m.totalAuthorizedDevelopers },
          { label: 'Active Accounts', value: m.activeDeveloperAccounts },
          { label: 'Active Sessions', value: m.currentActiveSessions },
          { label: 'Pending Requests', value: m.pendingAccessRequests, warn: m.pendingAccessRequests > 0 },
          { label: 'Expired Grants', value: m.expiredPermissions },
          { label: 'Code Edits', value: m.recentSourceModifications },
          { label: 'Deployments', value: m.deploymentCount },
          { label: 'Security Alerts', value: m.securityAlertsCount, alert: m.securityAlertsCount > 0 },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="bg-white border border-slate-200 rounded-lg p-3 space-y-1"
          >
            <div className="text-[11px] font-medium text-slate-500 truncate">{kpi.label}</div>
            <div
              className={`text-xl font-display font-bold tabular-nums ${
                kpi.alert
                  ? 'text-red-700'
                  : kpi.warn
                    ? 'text-orange-700'
                    : 'text-slate-900'
              }`}
            >
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Navigation Tabs */}
      <div role="tablist" aria-label="Owner security sections" className="border-b border-slate-200 flex flex-wrap gap-1.5">
        {(
          [
            { id: 'approvals', label: 'Developers, Approvals & Sessions', icon: UserCheck },
            { id: 'source', label: 'Source Code & Versions', icon: Code2 },
            { id: 'infrastructure', label: 'DB, APIs, Hosting & Backups', icon: Database },
            { id: 'deployments', label: 'Deployments & Releases', icon: Rocket },
            { id: 'audit', label: 'Activity Audit Log', icon: Activity },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              data-testid={`owner-tab-${item.id}`}
              className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 ${
                active
                  ? 'border-orange-700 text-orange-700 bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: Developers, Access Approvals, Active Sessions & Security Alerts */}
      {tab === 'approvals' && (
        <div className="space-y-6">
          {/* Review & Permission Drawer */}
          {editingDev && (
            <div className="bg-white border border-orange-300 rounded-xl p-5 space-y-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Review &amp; Configure Access: {editingDev.fullName} (@{editingDev.username})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {editingDev.email} · {editingDev.roleTitle} · Email{' '}
                    {editingDev.emailVerified ? 'Verified' : 'Unverified'} · 2FA Active
                  </p>
                  <p className="text-xs text-slate-700 mt-1.5 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
                    Requested Reason: {editingDev.requestReason}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingDev(null)}
                  className="text-xs text-slate-500 hover:text-slate-900"
                >
                  Close
                </button>
              </div>

              {!editingDev.emailVerified && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950">
                  <span>
                    Email is currently <strong>Unverified</strong> — developer login will be blocked with HTTP 403 until verified by the developer or confirmed by the Owner.
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDeveloperDecision(editingDev.id, 'verify_email')}
                    data-testid="owner-verify-dev-email-btn"
                    className="px-3 py-1.5 font-semibold text-white bg-amber-800 rounded-md hover:bg-amber-900 shrink-0"
                  >
                    Mark Email Verified (Owner)
                  </button>
                </div>
              )}

              {/* 9 Granular Permissions Grid (all false by default) */}
              <div>
                <div className="text-xs font-semibold text-slate-800 mb-2">
                  Granular Developer Permissions (Disabled by Default — Grant Individually)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {DEV_PERMISSION_META.map((perm) => {
                    const checked = draftPerms[perm.key] === true;
                    return (
                      <label
                        key={perm.key}
                        className={`flex items-start gap-2.5 p-2.5 rounded-md border cursor-pointer text-xs ${
                          checked
                            ? 'bg-orange-50/70 border-orange-300 text-slate-900'
                            : 'bg-slate-50 border-slate-200 text-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setDraftPerms((prev) => ({ ...prev, [perm.key]: e.target.checked }))
                          }
                          data-testid={`perm-toggle-${perm.key}`}
                          className="mt-0.5 rounded border-slate-300 text-orange-700 focus:ring-orange-600"
                        />
                        <span>
                          <span className="font-semibold block">{perm.label}</span>
                          <span className="text-[11px] text-slate-500 leading-snug block">
                            {perm.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Temporary Duration & Notes */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Access Duration
                  </label>
                  <select
                    value={draftDuration}
                    onChange={(e) => setDraftDuration(e.target.value as AccessDurationPreset)}
                    data-testid="owner-duration-select"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    <option value="1h">1 Hour (Temporary)</option>
                    <option value="6h">6 Hours</option>
                    <option value="24h">24 Hours</option>
                    <option value="7d">7 Days</option>
                    <option value="custom">Custom Expiration Date</option>
                  </select>
                </div>

                {draftDuration === 'custom' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Custom Expiration Date &amp; Time
                    </label>
                    <input
                      type="datetime-local"
                      value={draftCustomExpiry}
                      onChange={(e) => setDraftCustomExpiry(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                    />
                  </div>
                )}

                <div className={draftDuration === 'custom' ? '' : 'md:col-span-2'}>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Owner Review Note
                  </label>
                  <input
                    type="text"
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                    placeholder="Scope notes or ticket reference..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDeveloperDecision(editingDev.id, 'approve')}
                    data-testid="owner-approve-dev-btn"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Approve &amp; Grant Timed Access</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeveloperDecision(editingDev.id, 'reject')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100"
                  >
                    <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Reject Request</span>
                  </button>
                </div>
                {editingDev.status === 'approved' && (
                  <button
                    type="button"
                    onClick={() => void handleDeveloperDecision(editingDev.id, 'revoke')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-red-700 rounded-md hover:bg-red-800"
                  >
                    <UserX className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Revoke Immediately</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Developers Table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Developer Accounts &amp; Access Requests
              </h3>
              <span className="text-xs text-slate-500">
                Only Master Owner can authorize or revoke source access
              </span>
            </div>
            {summary.developers.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">
                No developer requests submitted yet. Developers can register &amp; submit an access request from the Developer Portal tab.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Developer</th>
                      <th className="px-4 py-2.5 font-semibold">Verification</th>
                      <th className="px-4 py-2.5 font-semibold">Status &amp; Expiry</th>
                      <th className="px-4 py-2.5 font-semibold">Granted Permissions</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Owner Controls</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summary.developers.map((dev) => {
                      const activePermCount = (
                        Object.keys(dev.permissions) as DevPermissionKey[]
                      ).filter((k) => dev.permissions[k]).length;
                      return (
                        <tr key={dev.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">
                              {dev.fullName}{' '}
                              <span className="font-mono text-slate-500">@{dev.username}</span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {dev.email} · {dev.roleTitle}
                            </div>
                          </td>
                          <td className="px-4 py-3 space-y-0.5">
                            <div className="text-[11px]">
                              Email:{' '}
                              <span
                                className={
                                  dev.emailVerified
                                    ? 'text-emerald-700 font-semibold'
                                    : 'text-amber-700 font-semibold'
                                }
                              >
                                {dev.emailVerified ? 'Verified' : 'Pending'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500">2FA: TOTP Enabled</div>
                          </td>
                          <td className="px-4 py-3 space-y-0.5">
                            <span
                              className={`inline-block px-2 py-0.5 text-[11px] font-semibold uppercase rounded border ${
                                dev.status === 'approved' && !dev.isExpiredNow
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : dev.status === 'pending'
                                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                                    : 'bg-red-50 text-red-800 border-red-200'
                              }`}
                            >
                              {dev.isExpiredNow ? 'EXPIRED' : dev.status}
                            </span>
                            {dev.accessExpiresAt && (
                              <div className="text-[11px] font-mono text-slate-500">
                                Until {new Date(dev.accessExpiresAt).toLocaleString()}
                              </div>
                            )}
                            {dev.lockedUntil && Date.parse(dev.lockedUntil) > Date.now() && (
                              <div className="text-[11px] text-red-700 font-semibold">
                                Locked ({dev.failedLoginAttempts} fails)
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-slate-700">
                              {activePermCount} / 9 enabled
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                            {!dev.emailVerified && (
                              <button
                                type="button"
                                onClick={() => void handleDeveloperDecision(dev.id, 'verify_email')}
                                data-testid={`verify-email-dev-${dev.username}`}
                                className="px-2.5 py-1 text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100"
                              >
                                Verify Email
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openReviewDrawer(dev)}
                              data-testid={`review-dev-${dev.username}`}
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-slate-900 rounded hover:bg-slate-800"
                            >
                              {dev.status === 'pending' ? 'Review & Approve' : 'Edit Permissions'}
                            </button>
                            {dev.status === 'approved' && (
                              <button
                                type="button"
                                onClick={() => void handleDeveloperDecision(dev.id, 'revoke')}
                                data-testid={`revoke-dev-${dev.username}`}
                                className="px-2.5 py-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100"
                              >
                                Revoke Now
                              </button>
                            )}
                            {(dev.status === 'disabled' ||
                              (dev.lockedUntil && Date.parse(dev.lockedUntil) > Date.now())) && (
                              <button
                                type="button"
                                onClick={() => void handleDeveloperDecision(dev.id, 'enable')}
                                className="px-2.5 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded"
                              >
                                Unlock/Enable
                              </button>
                            )}
                            {dev.status === 'approved' && (
                              <button
                                type="button"
                                onClick={() => void handleDeveloperDecision(dev.id, 'disable')}
                                className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded"
                              >
                                Disable
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Active Sessions & Security Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-orange-700" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-slate-900">Current Active Sessions</h3>
                </div>
                <span className="text-xs font-mono text-slate-500 tabular-nums">
                  {summary.sessions.length}
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {summary.sessions.map((s) => (
                  <div
                    key={s.sessionId}
                    className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">
                        {s.displayName}{' '}
                        <span className="font-mono text-[11px] text-slate-500 uppercase">
                          [{s.actorType}]
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 truncate">
                        IP {s.ipAddress} · Expires {new Date(s.expiresAt).toLocaleTimeString()}
                      </div>
                    </div>
                    {s.actorType === 'developer' && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await devsecApi.terminateSession(token, s.sessionId);
                            setSummary(res.summary);
                          } catch (err) {
                            handleErr(err);
                          }
                        }}
                        className="px-2.5 py-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 shrink-0"
                      >
                        Terminate
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-slate-900">Security Alerts</h3>
                </div>
                {summary.alerts.some((a) => !a.acknowledged) && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await devsecApi.acknowledgeAlerts(token);
                        setSummary(res.summary);
                      } catch (err) {
                        handleErr(err);
                      }
                    }}
                    className="text-[11px] font-semibold text-orange-700 hover:underline"
                  >
                    Acknowledge All
                  </button>
                )}
              </div>
              <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {summary.alerts.length === 0 ? (
                  <div className="p-4 text-xs text-slate-500">No security alerts triggered.</div>
                ) : (
                  summary.alerts.map((a) => (
                    <div key={a.id} className="px-4 py-2.5 text-xs space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{a.title}</span>
                        <span
                          className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                            a.severity === 'high'
                              ? 'bg-red-50 text-red-800 border-red-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {a.severity}
                        </span>
                      </div>
                      <div className="text-slate-600">{a.details}</div>
                      <div className="text-[11px] font-mono text-slate-400">
                        {new Date(a.timestamp).toLocaleString()} {a.acknowledged ? '· Ack' : ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Source Code Explorer & Version History */}
      {tab === 'source' && (
        <SourceExplorerPanel
          token={token}
          isOwner={true}
          canEditFrontend={true}
          canEditBackend={true}
          canDownloadSource={true}
          versions={summary.versions}
          onRefreshDashboard={() => void refreshDashboard()}
          onSessionInvalid={onSessionInvalid}
        />
      )}

      {/* TAB 3: DB Schema, API Config, Environments & Encrypted Backups */}
      {tab === 'infrastructure' && (
        <div className="space-y-6">
          {/* Environments Separation */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
              <Server className="w-4 h-4 text-orange-700" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-900">
                Environment Separation &amp; Hosting Configuration
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
              {summary.environments.map((env) => (
                <div key={env.environment} className="p-3.5 border border-slate-200 rounded-lg bg-slate-50 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold uppercase text-slate-900">{env.environment}</span>
                    <span className="font-mono text-[11px] text-slate-500">Port {env.port}</span>
                  </div>
                  <div className="text-slate-600">
                    Branch: <span className="font-mono text-slate-800">{env.branch}</span>
                  </div>
                  <div className="text-slate-600">
                    HTTPS Policy: {env.enforceHttps ? 'Enforced' : 'Local Dev HTTP'}
                  </div>
                  <div className="text-slate-600">
                    Deploy Gate:{' '}
                    <span className="font-semibold text-orange-800">
                      {env.requireOwnerApproval ? 'Master Owner Sign-Off Required' : 'Sandbox'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* API Integrations & Masked Secrets + Security Policy */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Lock className="w-4 h-4 text-orange-700" aria-hidden="true" />
                <span>API Integrations &amp; Server Secrets Protection</span>
              </div>
              <p className="text-xs text-slate-500">
                Secret keys are held strictly in server environment variables and masked in all dashboard views.
              </p>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                {(apiHosting?.maskedSecrets || []).map((s) => (
                  <div key={s.key} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="font-mono font-semibold text-slate-900">{s.key}</div>
                      <div className="text-[11px] text-slate-500">{s.scope}</div>
                    </div>
                    <span className="font-mono text-[11px] text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                      {s.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
              <div className="text-sm font-semibold text-slate-900">Application Security Policy</div>
              <div className="grid grid-cols-3 gap-2.5 text-xs">
                <div>
                  <label className="block text-slate-600 mb-1">Session TTL (min)</label>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    value={policyTtl}
                    onChange={(e) => setPolicyTtl(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Max Failed Attempts</label>
                  <input
                    type="number"
                    min={3}
                    max={10}
                    value={policyMaxAttempts}
                    onChange={(e) => setPolicyMaxAttempts(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Lockout (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={policyLockoutMin}
                    onChange={(e) => setPolicyLockoutMin(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              <div className="text-[11px] text-slate-500">
                2FA (TOTP), Email Verification, and Master Owner Production Deploy Approval are enforced.
              </div>
              <button
                type="button"
                onClick={async () => {
                  const res = await devsecApi.updateSecuritySettings(token, {
                    sessionTtlMinutes: policyTtl,
                    maxFailedLoginAttempts: policyMaxAttempts,
                    lockoutDurationMinutes: policyLockoutMin,
                  });
                  setSummary(res.summary);
                  setBusyMsg('Security policy thresholds saved.');
                }}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
              >
                Save Security Settings
              </button>
            </div>
          </div>

          {/* Encrypted Backup & Restore */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  AES-256-GCM Encrypted Backups &amp; Restore
                </h3>
                <p className="text-xs text-slate-500">
                  Backups encrypt application source files and schema blueprints using server-side AES-256-GCM authentication tags.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={backupLabel}
                  onChange={(e) => setBackupLabel(e.target.value)}
                  placeholder="Backup label..."
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateBackup()}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
                >
                  Create Encrypted Backup
                </button>
              </div>
            </div>
            {summary.backups.length === 0 ? (
              <div className="text-xs text-slate-500">No encrypted backups created yet.</div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-md">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Label</th>
                      <th className="px-3 py-2 font-semibold">Created</th>
                      <th className="px-3 py-2 font-semibold">Files / Size</th>
                      <th className="px-3 py-2 font-semibold">Cipher</th>
                      <th className="px-3 py-2 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summary.backups.map((b) => (
                      <tr key={b.id}>
                        <td className="px-3 py-2 font-medium text-slate-900">{b.label}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                          {new Date(b.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums">
                          {b.fileCount} files · {(b.encryptedBytes / 1024).toFixed(1)} KB
                        </td>
                        <td className="px-3 py-2 font-mono uppercase text-[11px] text-emerald-700">
                          {b.algorithm} (v{b.keyEpoch})
                        </td>
                        <td className="px-3 py-2 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => void handleDownloadBackup(b.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200"
                          >
                            <Download className="w-3 h-3" aria-hidden="true" />
                            <span>Download</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRestoreBackup(b.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                          >
                            <RotateCcw className="w-3 h-3" aria-hidden="true" />
                            <span>Verify &amp; Restore</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Database Structure & Firestore Rules */}
          {dbSchema && (
            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
              <div className="text-sm font-semibold text-slate-900">
                Database Configuration &amp; Schema Blueprint
              </div>
              <div className="text-xs font-mono bg-slate-50 border border-slate-200 rounded p-3">
                Firebase Project: {String(dbSchema.firebaseConfig.projectId || '')} · Firestore DB:{' '}
                {String(dbSchema.firebaseConfig.firestoreDatabaseId || '')} · Vault:{' '}
                {dbSchema.vaultPath}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1">
                    firebase-blueprint.json
                  </div>
                  <pre className="p-3 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded max-h-64 overflow-auto">
                    {dbSchema.blueprintJson}
                  </pre>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-700 mb-1">firestore.rules</div>
                  <pre className="p-3 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded max-h-64 overflow-auto">
                    {dbSchema.firestoreRules}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Deployments & Production Sign-Off */}
      {tab === 'deployments' && (
        <div className="space-y-4">
          <form
            onSubmit={handleOwnerDeploy}
            className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Environment</label>
              <select
                value={deployEnv}
                onChange={(e) => setDeployEnv(e.target.value as EnvironmentName)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="development">Development</option>
                <option value="staging">Staging</option>
                <option value="production">Production (Owner Signed)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Version Tag</label>
              <input
                type="text"
                value={deployTag}
                onChange={(e) => setDeployTag(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Release Summary</label>
              <input
                type="text"
                value={deploySummary}
                onChange={(e) => setDeploySummary(e.target.value)}
                placeholder="Describe deployed changes..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
            >
              Execute Owner Deployment
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-900">
              Deployment History &amp; Production Approval Queue
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Timestamp</th>
                    <th className="px-4 py-2 font-semibold">Environment</th>
                    <th className="px-4 py-2 font-semibold">Version</th>
                    <th className="px-4 py-2 font-semibold">Requested By</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 font-semibold">Summary</th>
                    <th className="px-4 py-2 font-semibold text-right">Owner Gate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.deployments.map((d) => (
                    <tr key={d.id}>
                      <td className="px-4 py-2 font-mono text-[11px] text-slate-500">
                        {new Date(d.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 font-mono uppercase font-semibold">{d.environment}</td>
                      <td className="px-4 py-2 font-mono text-slate-900">{d.versionTag}</td>
                      <td className="px-4 py-2 font-mono">{d.requestedBy}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`px-2 py-0.5 text-[11px] font-semibold uppercase rounded border ${
                            d.status === 'deployed'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : d.status === 'pending_owner_approval'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-red-50 text-red-800 border-red-200'
                          }`}
                        >
                          {d.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-600">{d.commitSummary}</td>
                      <td className="px-4 py-2 text-right space-x-1.5">
                        {d.status === 'pending_owner_approval' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleDecideDeployment(d.id, 'approve_and_deploy')}
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-700 rounded"
                            >
                              Authorize &amp; Deploy
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDecideDeployment(d.id, 'reject')}
                              className="px-2.5 py-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded"
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {d.ownerApprovedBy ? `By ${d.ownerApprovedBy}` : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: Developer & Owner Activity Audit Log */}
      {tab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-900">
              Complete Security &amp; Source Activity Audit Log
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Search actor, file, action..."
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-md"
              />
              <select
                value={auditCategory}
                onChange={(e) => setAuditCategory(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Categories</option>
                <option value="auth">Authentication</option>
                <option value="source">Source Code</option>
                <option value="permission">Permissions</option>
                <option value="database">Database</option>
                <option value="api">API Config</option>
                <option value="deployment">Deployments</option>
                <option value="backup">Backups</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[540px]">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                <tr>
                  <th className="px-4 py-2 font-semibold">Date &amp; Time</th>
                  <th className="px-4 py-2 font-semibold">Account</th>
                  <th className="px-4 py-2 font-semibold">Action</th>
                  <th className="px-4 py-2 font-semibold">Target</th>
                  <th className="px-4 py-2 font-semibold">Outcome</th>
                  <th className="px-4 py-2 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-900 whitespace-nowrap">
                      {log.actorUsername}{' '}
                      <span className="text-[10px] text-slate-400">({log.actorType})</span>
                    </td>
                    <td className="px-4 py-2 font-mono font-semibold text-slate-800 whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-700">{log.target}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-0.5 text-[10px] font-mono uppercase rounded border ${
                          log.outcome === 'success'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : log.outcome === 'denied'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-red-50 text-red-800 border-red-200'
                        }`}
                      >
                        {log.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
