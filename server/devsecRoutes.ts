import express, { type NextFunction, type Request, type Response } from 'express';
import type { DevSecStore, AuthenticatedContext } from './devsecStore.ts';
import type {
  AccessDurationPreset,
  DevPermissionKey,
  DevPermissions,
  EnvironmentName,
} from '../src/types/devsec.ts';

interface RequestWithDevSec extends Request {
  devsec?: AuthenticatedContext;
}

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

function sendDevSecError(
  res: Response,
  logicalStatus: number,
  error?: string,
  code?: string
): void {
  // Nginx in front of the preview server sets `proxy_intercept_errors on` with `error_page 403 = /forbidden.html`,
  // which discards Express JSON bodies on HTTP 403. Use HTTP 422 on the wire while preserving `status: 403` in JSON.
  const wireStatus = logicalStatus === 403 ? 422 : logicalStatus;
  res.status(wireStatus).json({
    error: error || 'Request could not be completed.',
    status: logicalStatus,
    ...(code ? { code } : {}),
  });
}

export function createDevSecRouter(store: DevSecStore): express.Router {
  const router = express.Router();

  // Security headers on every DevSec endpoint
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  const requireAuth = (req: RequestWithDevSec, res: Response, next: NextFunction) => {
    const authResult = store.authenticateToken(req.headers.authorization);
    if (!authResult.ok || !authResult.context) {
      res.status(401).json({ error: authResult.error || 'Authentication required.' });
      return;
    }
    req.devsec = authResult.context;
    next();
  };

  const requireOwner = (req: RequestWithDevSec, res: Response, next: NextFunction) => {
    requireAuth(req, res, () => {
      if (!req.devsec || req.devsec.actorType !== 'owner') {
        sendDevSecError(res, 403, 'Master Owner authorization required.', 'OWNER_REQUIRED');
        return;
      }
      next();
    });
  };

  const requireOwnerOrPermission =
    (perm: DevPermissionKey, actionLabel: string) =>
    (req: RequestWithDevSec, res: Response, next: NextFunction) => {
      requireAuth(req, res, () => {
        const ctx = req.devsec!;
        if (ctx.actorType === 'owner') {
          next();
          return;
        }
        const target =
          (typeof req.query.path === 'string' && req.query.path) ||
          (typeof req.body?.path === 'string' && req.body.path) ||
          req.path;
        const check = store.checkDeveloperPermission(ctx, perm, getClientIp(req), actionLabel, target);
        if (!check.allowed) {
          sendDevSecError(res, 403, check.reason || 'Permission denied.', 'PERMISSION_DENIED');
          return;
        }
        next();
      });
    };

  // --- Public Status & Onboarding/Login ---
  router.get('/status', (_req, res) => {
    res.json(store.getStatus());
  });

  router.post('/owner/claim', (req, res) => {
    const { username, email, password } = (req.body || {}) as {
      username?: string;
      email?: string;
      password?: string;
    };
    const result = store.claimOwnerAccount({
      username: username || '',
      email: email || '',
      password: password || '',
      ipAddress: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || 'browser'),
    });
    if (!result.ok) {
      sendDevSecError(res, result.status, result.error);
      return;
    }
    res.json({
      token: result.token,
      session: result.session,
      summary: store.getOwnerDashboardSummary(),
    });
  });

  router.post('/owner/login', (req, res) => {
    const { username, password } = (req.body || {}) as {
      username?: string;
      password?: string;
    };
    const result = store.loginOwner({
      username: username || '',
      password: password || '',
      ipAddress: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || 'browser'),
    });
    if (!result.ok) {
      sendDevSecError(res, result.status, result.error);
      return;
    }
    res.json({
      token: result.token,
      session: result.session,
      summary: store.getOwnerDashboardSummary(),
    });
  });

  router.post('/dev/register', async (req, res) => {
    const { username, email, fullName, roleTitle, requestReason, password } = (req.body || {}) as {
      username?: string;
      email?: string;
      fullName?: string;
      roleTitle?: string;
      requestReason?: string;
      password?: string;
    };
    const result = await store.registerDeveloper({
      username: username || '',
      email: email || '',
      fullName: fullName || '',
      roleTitle: roleTitle || '',
      requestReason: requestReason || '',
      password: password || '',
      ipAddress: getClientIp(req),
    });
    if (!result.ok) {
      sendDevSecError(res, result.status, result.error);
      return;
    }
    res.status(201).json({
      account: result.account,
      totpSetup: result.totpSetup,
      emailVerificationPreviewCode: result.emailVerificationPreviewCode,
    });
  });

  router.post('/dev/verify-email', (req, res) => {
    const { username, code } = (req.body || {}) as { username?: string; code?: string };
    const result = store.verifyDeveloperEmail({
      username: username || '',
      code: code || '',
      ipAddress: getClientIp(req),
    });
    if (!result.ok) {
      sendDevSecError(res, result.status, result.error);
      return;
    }
    res.json({ verified: true, alreadyVerified: result.alreadyVerified });
  });

  router.post('/dev/resend-verification', (req, res) => {
    const { username, password } = (req.body || {}) as { username?: string; password?: string };
    const result = store.resendDeveloperVerificationCode({
      username: username || '',
      password: password || '',
      ipAddress: getClientIp(req),
    });
    if (!result.ok) {
      sendDevSecError(res, result.status, result.error);
      return;
    }
    res.json({
      alreadyVerified: result.alreadyVerified,
      username: result.username,
      email: result.email,
      emailVerificationPreviewCode: result.emailVerificationPreviewCode,
    });
  });

  router.post('/dev/login', (req, res) => {
    const { username, password, totpCode } = (req.body || {}) as {
      username?: string;
      password?: string;
      totpCode?: string;
    };
    const result = store.loginDeveloper({
      username: username || '',
      password: password || '',
      totpCode: totpCode || '',
      ipAddress: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || 'browser'),
    });
    if (!result.ok) {
      sendDevSecError(
        res,
        result.status,
        result.error,
        'code' in result ? result.code : undefined
      );
      return;
    }
    res.json({
      token: result.token,
      session: result.session,
      account: result.account,
    });
  });

  router.post('/logout', requireAuth, (req: RequestWithDevSec, res) => {
    store.logout(req.devsec!, getClientIp(req));
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req: RequestWithDevSec, res) => {
    const ctx = req.devsec!;
    if (ctx.actorType === 'owner') {
      res.json({
        actorType: 'owner',
        session: ctx.session,
        summary: store.getOwnerDashboardSummary(),
      });
      return;
    }
    res.json({
      actorType: 'developer',
      session: ctx.session,
      account: store.toPublicDeveloper(ctx.developer!),
      deployments: store.getDeploymentsForActor(ctx),
    });
  });

  // --- Owner-Exclusive Security & Governance Endpoints ---
  router.get('/owner/dashboard', requireOwner, (_req, res) => {
    res.json(store.getOwnerDashboardSummary());
  });

  router.post('/owner/developers/:id/decision', requireOwner, (req: RequestWithDevSec, res) => {
    const { decision, permissions, durationPreset, customExpiresAt, reviewNote } = (req.body ||
      {}) as {
      decision?: 'approve' | 'reject' | 'update' | 'revoke' | 'disable' | 'enable' | 'verify_email';
      permissions?: Partial<DevPermissions>;
      durationPreset?: AccessDurationPreset;
      customExpiresAt?: string | null;
      reviewNote?: string;
    };

    const allowedDecisions = [
      'approve',
      'reject',
      'update',
      'revoke',
      'disable',
      'enable',
      'verify_email',
    ];
    if (!decision || !allowedDecisions.includes(decision)) {
      res.status(400).json({ error: 'Valid decision is required.' });
      return;
    }

    const result = store.approveOrUpdateDeveloper({
      ownerUsername: req.devsec!.username,
      developerId: req.params.id,
      decision,
      permissions,
      durationPreset,
      customExpiresAt,
      reviewNote,
      ipAddress: getClientIp(req),
    });

    if (!result.ok) {
      sendDevSecError(res, result.status, result.error);
      return;
    }
    res.json({ account: result.account, summary: store.getOwnerDashboardSummary() });
  });

  router.post('/owner/sessions/:sessionId/terminate', requireOwner, (req: RequestWithDevSec, res) => {
    const terminated = store.terminateSession(
      req.devsec!.username,
      req.params.sessionId,
      getClientIp(req)
    );
    if (!terminated) {
      res.status(404).json({ error: 'Active session not found.' });
      return;
    }
    res.json({ summary: store.getOwnerDashboardSummary() });
  });

  router.post('/owner/emergency', requireOwner, (req: RequestWithDevSec, res) => {
    const { action } = (req.body || {}) as {
      action?: 'revoke_all_developers' | 'terminate_all_dev_sessions' | 'rotate_credentials';
    };
    if (
      !action ||
      !['revoke_all_developers', 'terminate_all_dev_sessions', 'rotate_credentials'].includes(action)
    ) {
      res.status(400).json({ error: 'Invalid emergency security action.' });
      return;
    }

    const result = store.emergencyControl(req.devsec!.username, action, getClientIp(req));
    let refreshedToken: string | undefined;
    let refreshedSession = req.devsec!.session;
    if (action === 'rotate_credentials') {
      const next = store.refreshOwnerSessionToken(
        req.devsec!,
        getClientIp(req),
        String(req.headers['user-agent'] || 'browser')
      );
      refreshedToken = next.token;
      refreshedSession = next.session;
    }

    res.json({
      result,
      token: refreshedToken,
      session: refreshedSession,
      summary: store.getOwnerDashboardSummary(),
    });
  });

  router.post('/owner/security-settings', requireOwner, (req: RequestWithDevSec, res) => {
    const result = store.updateSecuritySettings(req.devsec!.username, req.body || {}, getClientIp(req));
    res.json({ ...result, summary: store.getOwnerDashboardSummary() });
  });

  router.post('/owner/alerts/acknowledge', requireOwner, (req: RequestWithDevSec, res) => {
    store.acknowledgeAlerts(req.devsec!.username, getClientIp(req));
    res.json({ summary: store.getOwnerDashboardSummary() });
  });

  router.post('/owner/versions/:versionId/restore', requireOwner, (req: RequestWithDevSec, res) => {
    const result = store.restoreVersionSnapshot(
      req.devsec!.username,
      req.params.versionId,
      getClientIp(req)
    );
    if (!result.ok) {
      sendDevSecError(res, result.status, result.error);
      return;
    }
    res.json({ snapshot: result.snapshot, summary: store.getOwnerDashboardSummary() });
  });

  router.post('/owner/backups', requireOwner, (req: RequestWithDevSec, res) => {
    const { label } = (req.body || {}) as { label?: string };
    const result = store.createEncryptedBackup(
      req.devsec!.username,
      label || '',
      getClientIp(req)
    );
    res.status(201).json({ metadata: result.metadata, summary: store.getOwnerDashboardSummary() });
  });

  router.get('/owner/backups/:backupId/download', requireOwner, (req, res) => {
    const env = store.readEncryptedBackupEnvelope(req.params.backupId);
    if (!env) {
      res.status(404).json({ error: 'Encrypted backup not found.' });
      return;
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${req.params.backupId}.avybak.json"`
    );
    res.json(env);
  });

  router.post('/owner/backups/:backupId/restore', requireOwner, (req: RequestWithDevSec, res) => {
    const result = store.restoreFromEncryptedBackup(
      req.devsec!.username,
      req.params.backupId,
      getClientIp(req)
    );
    if (!result.ok) {
      sendDevSecError(res, result.status, result.error);
      return;
    }
    res.json({ restoredCount: result.restoredCount, summary: store.getOwnerDashboardSummary() });
  });

  router.post('/owner/deployments/:deploymentId/decide', requireOwner, (req: RequestWithDevSec, res) => {
    const { decision } = (req.body || {}) as {
      decision?: 'approve_and_deploy' | 'reject';
    };
    if (decision !== 'approve_and_deploy' && decision !== 'reject') {
      res.status(400).json({ error: 'Invalid deployment decision.' });
      return;
    }
    const result = store.decideDeployment(
      req.devsec!.username,
      req.params.deploymentId,
      decision,
      getClientIp(req)
    );
    if (!result.ok) {
      sendDevSecError(res, result.status, result.error);
      return;
    }
    res.json({ deployment: result.deployment, summary: store.getOwnerDashboardSummary() });
  });

  // --- Scoped Source, DB, API, Hosting, Logs & Deployment Routes ---
  router.get(
    '/source/files',
    requireOwnerOrPermission('view_source', 'LIST_SOURCE_FILES'),
    (_req, res) => {
      res.json({ files: store.listRepositoryFiles() });
    }
  );

  router.get(
    '/source/file',
    requireOwnerOrPermission('view_source', 'VIEW_SOURCE_FILE'),
    (req: RequestWithDevSec, res) => {
      const relPath = String(req.query.path || '');
      const result = store.readRepositoryFile(req.devsec!, relPath, getClientIp(req));
      if (!result.ok) {
        sendDevSecError(res, result.status, result.error);
        return;
      }
      res.json(result);
    }
  );

  router.put('/source/file', requireAuth, (req: RequestWithDevSec, res) => {
    const { path: relPath, content, summary } = (req.body || {}) as {
      path?: string;
      content?: string;
      summary?: string;
    };
    const result = store.writeRepositoryFile(
      req.devsec!,
      relPath || '',
      typeof content === 'string' ? content : '',
      summary || '',
      getClientIp(req)
    );
    if (!result.ok) {
      sendDevSecError(res, result.status, result.error);
      return;
    }
    res.json({ snapshot: result.snapshot });
  });

  router.delete('/source/file', requireAuth, (req: RequestWithDevSec, res) => {
    const relPath = String(req.query.path || req.body?.path || '');
    const result = store.deleteRepositoryFile(req.devsec!, relPath, getClientIp(req));
    if (!result.ok) {
      sendDevSecError(res, result.status, result.error);
      return;
    }
    res.json({ snapshot: result.snapshot });
  });

  router.get(
    '/source/download',
    requireOwnerOrPermission('download_source', 'DOWNLOAD_SOURCE_BUNDLE'),
    (req: RequestWithDevSec, res) => {
      const bundle = store.buildAuditedSourceBundle(req.devsec!, getClientIp(req));
      res.setHeader('Content-Disposition', 'attachment; filename="avy-infra-source-audited.json"');
      res.json(bundle);
    }
  );

  router.get(
    '/database/schema',
    requireOwnerOrPermission('access_db_schema', 'VIEW_DATABASE_SCHEMA'),
    (req: RequestWithDevSec, res) => {
      res.json(store.getDatabaseSchemaSummary(req.devsec!, getClientIp(req)));
    }
  );

  router.get(
    '/api-hosting/config',
    requireAuth,
    (req: RequestWithDevSec, res) => {
      const ctx = req.devsec!;
      if (ctx.actorType === 'developer') {
        const apiCheck = store.checkDeveloperPermission(
          ctx,
          'access_api_config',
          getClientIp(req),
          'VIEW_API_CONFIG',
          'api-hosting/config'
        );
        const hostCheck = store.checkDeveloperPermission(
          ctx,
          'access_hosting',
          getClientIp(req),
          'VIEW_HOSTING_CONFIG',
          'api-hosting/config'
        );
        if (!apiCheck.allowed && !hostCheck.allowed) {
          sendDevSecError(
            res,
            403,
            apiCheck.reason || hostCheck.reason || 'Permission denied.',
            'PERMISSION_DENIED'
          );
          return;
        }
      }
      res.json(store.getApiAndHostingConfig(ctx, getClientIp(req)));
    }
  );

  router.put(
    '/api-hosting/config',
    requireOwnerOrPermission('access_api_config', 'UPDATE_API_CONFIG'),
    (req: RequestWithDevSec, res) => {
      const result = store.updateApiIntegrationConfig(req.devsec!, req.body || {}, getClientIp(req));
      res.json(result);
    }
  );

  router.post(
    '/deployments',
    requireOwnerOrPermission('deploy_updates', 'REQUEST_DEPLOYMENT'),
    (req: RequestWithDevSec, res) => {
      const { environment, versionTag, commitSummary, notes } = (req.body || {}) as {
        environment?: EnvironmentName;
        versionTag?: string;
        commitSummary?: string;
        notes?: string;
      };
      const result = store.requestDeployment(req.devsec!, {
        environment: environment || 'staging',
        versionTag: versionTag || '',
        commitSummary: commitSummary || '',
        notes,
        ipAddress: getClientIp(req),
      });
      res.status(201).json(result);
    }
  );

  router.get(
    '/logs',
    requireOwnerOrPermission('view_logs', 'VIEW_APPLICATION_LOGS'),
    (req: RequestWithDevSec, res) => {
      res.json(store.getApplicationLogs(req.devsec!, getClientIp(req)));
    }
  );

  return router;
}
