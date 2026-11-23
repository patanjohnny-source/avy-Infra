import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Code2,
  Database,
  Lock,
  Rocket,
  ScrollText,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { devsecApi } from '../../utils/devsecApi';
import {
  DEV_PERMISSION_META,
  type ActiveDevSecSession,
  type AuditLogEntry,
  type DeploymentRecord,
  type EnvironmentHostingConfig,
  type EnvironmentName,
  type PublicDeveloperAccount,
} from '../../types/devsec';
import { SourceExplorerPanel } from './SourceExplorerPanel';

interface DeveloperPortalWorkspaceProps {
  token: string;
  session: ActiveDevSecSession;
  initialAccount: PublicDeveloperAccount;
  initialDeployments: DeploymentRecord[];
  onSessionInvalid: () => void;
}

type DevTab = 'overview' | 'source' | 'database' | 'hosting' | 'deployments' | 'logs';

function formatCountdown(targetIso: string | null): string {
  if (!targetIso) return 'Expired';
  const diff = Date.parse(targetIso) - Date.now();
  if (diff <= 0) return 'Expired';
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m remaining`;
  if (hours > 0) return `${hours}h ${mins}m remaining`;
  return `${mins}m ${totalSec % 60}s remaining`;
}

export function DeveloperPortalWorkspace({
  token,
  session,
  initialAccount,
  initialDeployments,
  onSessionInvalid,
}: DeveloperPortalWorkspaceProps) {
  const [account, setAccount] = useState<PublicDeveloperAccount>(initialAccount);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>(initialDeployments);
  const [tab, setTab] = useState<DevTab>('overview');
  const [countdown, setCountdown] = useState(() => formatCountdown(initialAccount.accessExpiresAt));
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  const [dbSchema, setDbSchema] = useState<{
    firebaseConfig: Record<string, unknown>;
    blueprintJson: string;
    firestoreRules: string;
  } | null>(null);

  const [apiHosting, setApiHosting] = useState<{
    apiIntegrationSettings: {
      geminiEnabled: boolean;
      mapsEnabled: boolean;
      firebaseSyncEnabled: boolean;
      pwaInstallEnabled: boolean;
      allowedOrigins: string;
    };
    maskedSecrets: { key: string; scope: string; status: string }[];
    environments: EnvironmentHostingConfig[];
  } | null>(null);

  const [logs, setLogs] = useState<{
    serverUptimeSec: number;
    environment: string;
    recentLogs: AuditLogEntry[];
  } | null>(null);

  const [deployEnv, setDeployEnv] = useState<EnvironmentName>('staging');
  const [deployTag, setDeployTag] = useState('v1.1.0-rc1');
  const [deploySummary, setDeploySummary] = useState('');

  const handleErr = (err: unknown) => {
    const e = err as Error & { status?: number };
    if (e.status === 401) {
      onSessionInvalid();
      return;
    }
    setErrorMsg(e.message || 'Access denied by server policy.');
  };

  const refreshProfile = async () => {
    try {
      const me = await devsecApi.getMe(token);
      if (me.actorType === 'developer') {
        setAccount(me.account);
        setDeployments(me.deployments);
      }
    } catch (err) {
      handleErr(err);
    }
  };

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown(formatCountdown(account.accessExpiresAt));
      void refreshProfile();
    }, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.accessExpiresAt, token]);

  useEffect(() => {
    setErrorMsg('');
    setStatusMsg('');
    if (tab === 'database' && account.permissions.access_db_schema) {
      void devsecApi
        .getDatabaseSchema(token)
        .then((res) => setDbSchema(res))
        .catch(handleErr);
    } else if (
      tab === 'hosting' &&
      (account.permissions.access_api_config || account.permissions.access_hosting)
    ) {
      void devsecApi
        .getApiAndHostingConfig(token)
        .then((res) => setApiHosting(res))
        .catch(handleErr);
    } else if (tab === 'logs' && account.permissions.view_logs) {
      void devsecApi
        .getApplicationLogs(token)
        .then((res) => setLogs(res))
        .catch(handleErr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleRequestDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await devsecApi.requestDeployment(token, {
        environment: deployEnv,
        versionTag: deployTag,
        commitSummary: deploySummary || `Developer release request to ${deployEnv}`,
      });
      setDeployments((prev) => [res.deployment, ...prev]);
      setDeploySummary('');
      setStatusMsg(
        res.deployment.status === 'pending_owner_approval'
          ? `Deployment ${res.deployment.versionTag} submitted for Master Owner authorization.`
          : `Deployed ${res.deployment.versionTag} to ${res.deployment.environment}.`
      );
    } catch (err) {
      handleErr(err);
    }
  };

  const p = account.permissions;

  const tabs: {
    id: DevTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    permitted: boolean;
  }[] = [
    { id: 'overview', label: 'Permissions & Session', icon: ShieldCheck, permitted: true },
    { id: 'source', label: 'Source Code', icon: Code2, permitted: p.view_source },
    { id: 'database', label: 'Database Schema', icon: Database, permitted: p.access_db_schema },
    {
      id: 'hosting',
      label: 'API & Hosting',
      icon: Server,
      permitted: p.access_api_config || p.access_hosting,
    },
    { id: 'deployments', label: 'Deployments', icon: Rocket, permitted: p.deploy_updates },
    { id: 'logs', label: 'App Logs', icon: ScrollText, permitted: p.view_logs },
  ];

  return (
    <div className="space-y-6">
      {/* Developer Session Status Strip */}
      <div className="bg-slate-900 text-slate-100 rounded-xl p-4 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-0.5">
          <div className="text-sm font-semibold text-white">
            Scoped Developer Portal · {account.fullName} (@{account.username})
          </div>
          <div className="text-xs text-slate-400">
            2FA Verified · Email Verified · Session expires{' '}
            <span className="font-mono text-slate-200">
              {new Date(session.expiresAt).toLocaleTimeString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-xs">
          <Clock className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
          <span className="font-mono text-amber-200 tabular-nums" data-testid="dev-access-countdown">
            Access Window: {countdown}
          </span>
        </div>
      </div>

      {errorMsg && (
        <div role="alert" className="p-3 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md">
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div className="p-3 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
          {statusMsg}
        </div>
      )}

      {/* Navigation */}
      <div role="tablist" aria-label="Developer portal sections" className="border-b border-slate-200 flex flex-wrap gap-1.5">
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              data-testid={`dev-tab-${item.id}`}
              className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 ${
                active
                  ? 'border-orange-700 text-orange-700 bg-white'
                  : item.permitted
                    ? 'border-transparent text-slate-700 hover:text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {item.permitted ? (
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Overview & Granted Permission Matrix */}
      {tab === 'overview' && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Owner-Approved Capability Matrix
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              All developer permissions are disabled by default and enforced server-side on every request.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {DEV_PERMISSION_META.map((perm) => {
              const granted = account.permissions[perm.key] === true;
              return (
                <div
                  key={perm.key}
                  data-testid={`dev-perm-card-${perm.key}`}
                  className={`p-3 rounded-lg border text-xs space-y-1 ${
                    granted
                      ? 'bg-emerald-50/70 border-emerald-200 text-slate-900'
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{perm.label}</span>
                    {granted ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Granted</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                        <Lock className="w-3 h-3" aria-hidden="true" />
                        <span>Locked</span>
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] leading-snug">{perm.description}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Source Code */}
      {tab === 'source' &&
        (p.view_source ? (
          <SourceExplorerPanel
            token={token}
            isOwner={false}
            canEditFrontend={p.edit_frontend}
            canEditBackend={p.edit_backend}
            canDownloadSource={p.download_source}
            onSessionInvalid={onSessionInvalid}
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center space-y-2">
            <Lock className="w-6 h-6 text-slate-400 mx-auto" aria-hidden="true" />
            <div className="text-sm font-semibold text-slate-900">Source Code Access Locked</div>
            <p className="text-xs text-slate-500">
              Ask the Master Owner to grant the View Source Code permission for your account.
            </p>
          </div>
        ))}

      {/* Database Schema */}
      {tab === 'database' &&
        (p.access_db_schema && dbSchema ? (
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-900">
              Database Schema &amp; Firestore Rules (Read-Only Config)
            </div>
            <div className="text-xs font-mono bg-slate-50 border border-slate-200 rounded p-2.5">
              Project: {String(dbSchema.firebaseConfig.projectId || '')} · DB:{' '}
              {String(dbSchema.firebaseConfig.firestoreDatabaseId || '')}
            </div>
            <pre className="p-3 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded max-h-72 overflow-auto">
              {dbSchema.blueprintJson}
            </pre>
            <pre className="p-3 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded max-h-72 overflow-auto">
              {dbSchema.firestoreRules}
            </pre>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center space-y-2">
            <Lock className="w-6 h-6 text-slate-400 mx-auto" aria-hidden="true" />
            <div className="text-sm font-semibold text-slate-900">Database Schema Locked</div>
            <p className="text-xs text-slate-500">
              Requires Access Database Schema permission from Master Owner.
            </p>
          </div>
        ))}

      {/* API & Hosting */}
      {tab === 'hosting' &&
        ((p.access_api_config || p.access_hosting) && apiHosting ? (
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
            <div className="text-sm font-semibold text-slate-900">
              API Integration Status &amp; Environment Separation
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {apiHosting.environments.map((env) => (
                <div key={env.environment} className="p-3 border border-slate-200 rounded-md bg-slate-50 text-xs space-y-1">
                  <div className="font-semibold uppercase text-slate-900">{env.environment}</div>
                  <div className="font-mono text-slate-600">{env.branch}</div>
                  <div className="text-slate-500">
                    {env.requireOwnerApproval ? 'Owner Approval Required' : 'Dev Sandbox'}
                  </div>
                </div>
              ))}
            </div>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
              {apiHosting.maskedSecrets.map((s) => (
                <div key={s.key} className="px-3 py-2 flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-slate-800">{s.key}</span>
                  <span className="font-mono text-slate-600">{s.status}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center space-y-2">
            <Lock className="w-6 h-6 text-slate-400 mx-auto" aria-hidden="true" />
            <div className="text-sm font-semibold text-slate-900">
              API &amp; Hosting Settings Locked
            </div>
            <p className="text-xs text-slate-500">
              Requires Access API Configuration or Access Hosting Settings permission.
            </p>
          </div>
        ))}

      {/* Deployments */}
      {tab === 'deployments' &&
        (p.deploy_updates ? (
          <div className="space-y-4">
            <form
              onSubmit={handleRequestDeploy}
              className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Target Env</label>
                <select
                  value={deployEnv}
                  onChange={(e) => setDeployEnv(e.target.value as EnvironmentName)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                >
                  <option value="development">Development</option>
                  <option value="staging">Staging (Owner Sign-Off)</option>
                  <option value="production">Production (Owner Sign-Off Required)</option>
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
                <label className="block text-xs font-medium text-slate-700 mb-1">Summary</label>
                <input
                  type="text"
                  value={deploySummary}
                  onChange={(e) => setDeploySummary(e.target.value)}
                  placeholder="Changelog summary..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
              >
                Submit Deployment Request
              </button>
            </form>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="divide-y divide-slate-100">
                {deployments.map((d) => (
                  <div key={d.id} className="px-4 py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-mono font-semibold uppercase">{d.environment}</span> ·{' '}
                      <span className="font-mono">{d.versionTag}</span> — {d.commitSummary}
                    </div>
                    <span className="font-mono uppercase text-[11px] px-2 py-0.5 bg-slate-100 rounded">
                      {d.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center space-y-2">
            <Lock className="w-6 h-6 text-slate-400 mx-auto" aria-hidden="true" />
            <div className="text-sm font-semibold text-slate-900">Deployments Locked</div>
            <p className="text-xs text-slate-500">
              Requires Deploy Application Updates permission (and Owner sign-off for production).
            </p>
          </div>
        ))}

      {/* Application Logs */}
      {tab === 'logs' &&
        (p.view_logs && logs ? (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 text-xs font-mono text-slate-600">
              Env: {logs.environment} · Server Uptime: {logs.serverUptimeSec}s
            </div>
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {logs.recentLogs.map((l) => (
                <div key={l.id} className="px-4 py-2 text-xs flex flex-wrap justify-between gap-2">
                  <div>
                    <span className="font-mono font-semibold">{l.action}</span>{' '}
                    <span className="text-slate-500">({l.actorUsername})</span> — {l.details}
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    {new Date(l.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center space-y-2">
            <Lock className="w-6 h-6 text-slate-400 mx-auto" aria-hidden="true" />
            <div className="text-sm font-semibold text-slate-900">Application Logs Locked</div>
            <p className="text-xs text-slate-500">
              Requires View Application Logs permission from Master Owner.
            </p>
          </div>
        ))}
    </div>
  );
}
