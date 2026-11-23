import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Lock,
  LogOut,
  ShieldCheck,
  Smartphone,
  UserPlus,
} from 'lucide-react';
import { devsecApi } from '../../utils/devsecApi';
import type {
  ActiveDevSecSession,
  DeploymentRecord,
  DevSecStatusResponse,
  OwnerDashboardSummary,
  PublicDeveloperAccount,
} from '../../types/devsec';
import { OwnerSecurityDashboard } from './OwnerSecurityDashboard';
import { DeveloperPortalWorkspace } from './DeveloperPortalWorkspace';

interface SecurityPortalRootProps {
  onExitPortal: () => void;
}

type UnauthView = 'owner' | 'developer' | 'request';

export function SecurityPortalRoot({ onExitPortal }: SecurityPortalRootProps) {
  const [status, setStatus] = useState<DevSecStatusResponse | null>(null);
  const [unauthTab, setUnauthTab] = useState<UnauthView>('owner');

  // Strict in-memory authentication state (NEVER persisted to localStorage)
  const [token, setToken] = useState<string | null>(null);
  const [actorType, setActorType] = useState<'owner' | 'developer' | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveDevSecSession | null>(null);
  const [ownerSummary, setOwnerSummary] = useState<OwnerDashboardSummary | null>(null);
  const [devAccount, setDevAccount] = useState<PublicDeveloperAccount | null>(null);
  const [devDeployments, setDevDeployments] = useState<DeploymentRecord[]>([]);

  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // Master Owner claim/login fields
  const [ownerUsername, setOwnerUsername] = useState('avyowner');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');

  // Developer login fields
  const [devLoginUser, setDevLoginUser] = useState('');
  const [devLoginPass, setDevLoginPass] = useState('');
  const [devLoginTotp, setDevLoginTotp] = useState('');

  // Developer registration & access request fields
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regFullName, setRegFullName] = useState('');
  const [regRoleTitle, setRegRoleTitle] = useState('Full-Stack Contractor');
  const [regReason, setRegReason] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regResult, setRegResult] = useState<{
    username: string;
    totpSecret: string;
    qrDataUrl: string;
    emailPreviewCode: string;
    emailVerified: boolean;
  } | null>(null);
  const [verifyCodeInput, setVerifyCodeInput] = useState('');

  // Inline email verification recovery on Developer Login tab
  const [showInlineEmailVerify, setShowInlineEmailVerify] = useState(false);
  const [inlineVerifyPreviewCode, setInlineVerifyPreviewCode] = useState('');
  const [inlineVerifyCodeInput, setInlineVerifyCodeInput] = useState('');

  const loadStatus = async () => {
    try {
      const res = await devsecApi.getStatus();
      setStatus(res);
    } catch {
      setErrorMsg('Unable to reach server security service.');
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const clearAuthState = (notice?: string) => {
    setToken(null);
    setActorType(null);
    setActiveSession(null);
    setOwnerSummary(null);
    setDevAccount(null);
    setDevDeployments([]);
    setOwnerPassword('');
    setDevLoginPass('');
    setDevLoginTotp('');
    if (notice) setErrorMsg(notice);
  };

  const handleOwnerClaimOrLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      const needsClaim = status && !status.ownerClaimed && !status.ownerEnvConfigured;
      const res = needsClaim
        ? await devsecApi.claimOwner({
            username: ownerUsername,
            email: ownerEmail,
            password: ownerPassword,
          })
        : await devsecApi.loginOwner({
            username: ownerUsername,
            password: ownerPassword,
          });
      setToken(res.token);
      setActorType('owner');
      setActiveSession(res.session);
      setOwnerSummary(res.summary);
      setOwnerPassword('');
      await loadStatus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Master Owner authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeveloperRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      const res = await devsecApi.registerDeveloper({
        username: regUsername,
        email: regEmail,
        fullName: regFullName,
        roleTitle: regRoleTitle,
        requestReason: regReason,
        password: regPassword,
      });
      setRegResult({
        username: res.account.username,
        totpSecret: res.totpSetup.secret,
        qrDataUrl: res.totpSetup.qrDataUrl,
        emailPreviewCode: res.emailVerificationPreviewCode,
        emailVerified: false,
      });
      setVerifyCodeInput('');
      setRegPassword('');
      setInfoMsg(
        'Access request registered. Complete Email Verification and save your 2FA Authenticator QR code before signing in once Owner approves.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regResult) return;
    setErrorMsg('');
    setLoading(true);
    try {
      await devsecApi.verifyDeveloperEmail({
        username: regResult.username,
        code: verifyCodeInput,
      });
      setRegResult({ ...regResult, emailVerified: true });
      setInfoMsg(
        `Email verified for @${regResult.username}. Your request is now queued for Master Owner permission approval.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeveloperLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      const res = await devsecApi.loginDeveloper({
        username: devLoginUser,
        password: devLoginPass,
        totpCode: devLoginTotp,
      });
      const me = await devsecApi.getMe(res.token);
      setToken(res.token);
      setActorType('developer');
      setActiveSession(res.session);
      setDevAccount(res.account);
      if (me.actorType === 'developer') {
        setDevDeployments(me.deployments);
      }
      setDevLoginPass('');
      setDevLoginTotp('');
      setShowInlineEmailVerify(false);
      setInlineVerifyPreviewCode('');
      setInlineVerifyCodeInput('');
    } catch (err) {
      const apiErr = err as Error & { status?: number; code?: string };
      if (
        apiErr.code === 'EMAIL_UNVERIFIED' ||
        apiErr.message.toLowerCase().includes('verify your email')
      ) {
        setShowInlineEmailVerify(true);
      }
      setErrorMsg(apiErr.message || 'Developer login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendInlineVerification = async () => {
    if (!devLoginUser.trim() || !devLoginPass) {
      setErrorMsg('Enter your Developer Username and Password above to generate a new email verification code.');
      return;
    }
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      const res = await devsecApi.resendDeveloperVerificationCode({
        username: devLoginUser.trim(),
        password: devLoginPass,
      });
      if (res.alreadyVerified) {
        setShowInlineEmailVerify(false);
        setInfoMsg(`Email for @${res.username} is already verified. Click "Verify 2FA & Sign In" to continue.`);
      } else if (res.emailVerificationPreviewCode) {
        setInlineVerifyPreviewCode(res.emailVerificationPreviewCode);
        setInfoMsg(`New email verification code generated for @${res.username} (${res.email}).`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not resend verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyInlineEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!devLoginUser.trim() || !inlineVerifyCodeInput.trim()) return;
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      await devsecApi.verifyDeveloperEmail({
        username: devLoginUser.trim(),
        code: inlineVerifyCodeInput.trim(),
      });
      setShowInlineEmailVerify(false);
      setInlineVerifyPreviewCode('');
      setInlineVerifyCodeInput('');
      setInfoMsg(
        `Email verified for @${devLoginUser.trim()}. Click "Verify 2FA & Sign In" above to complete login.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Email verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (token) {
      try {
        await devsecApi.logout(token);
      } catch {
        // Clear local state regardless
      }
    }
    clearAuthState();
    setInfoMsg('Security session closed cleanly.');
  };

  const needsOwnerClaim = Boolean(status && !status.ownerClaimed && !status.ownerEnvConfigured);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Security Portal Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onExitPortal}
            data-testid="exit-security-portal-btn"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to AVY INFRA</span>
          </button>
          <div className="min-w-0">
            <div className="font-display font-bold text-sm sm:text-base text-slate-900 truncate">
              AVY INFRA · Source Code Access &amp; Developer Security
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {token && activeSession && (
            <>
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono bg-slate-100 border border-slate-200 rounded">
                <ShieldCheck className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                <span>
                  {actorType === 'owner' ? 'MASTER OWNER' : `DEV @${activeSession.username}`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void handleLogout()}
                data-testid="devsec-logout-btn"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
        {token && actorType === 'owner' && ownerSummary ? (
          <OwnerSecurityDashboard
            token={token}
            initialSummary={ownerSummary}
            onTokenRefreshed={(nextToken) => setToken(nextToken)}
            onSessionInvalid={() =>
              clearAuthState('Owner session expired or invalidated. Please sign in again.')
            }
          />
        ) : token && actorType === 'developer' && devAccount && activeSession ? (
          <DeveloperPortalWorkspace
            token={token}
            session={activeSession}
            initialAccount={devAccount}
            initialDeployments={devDeployments}
            onSessionInvalid={() =>
              clearAuthState(
                'Developer session expired or was revoked by the Master Owner. Re-authentication required.'
              )
            }
          />
        ) : (
          <div className="max-w-4xl mx-auto bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-12">
            {/* Left Security Architecture Panel */}
            <div className="lg:col-span-5 bg-slate-900 text-slate-100 p-6 sm:p-7 flex flex-col justify-between gap-6">
              <div className="space-y-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-md bg-orange-700 text-white flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="font-display font-bold text-base text-white">
                      Source Code Vault
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Zero-Trust Repository &amp; Deployment Gate
                    </div>
                  </div>
                </div>

                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <div className="flex items-start gap-2">
                    <KeyRound className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <span className="font-semibold text-white block">Master Owner Exclusive Control</span>
                      Full visibility into frontend/backend source, DB blueprint, encrypted backups, and production deploy authorization.
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Smartphone className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <span className="font-semibold text-white block">Mandatory 2FA &amp; Email Verification</span>
                      Every developer account requires a strong password, email verification, and RFC 6238 Authenticator TOTP verification.
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <span className="font-semibold text-white block">Timed &amp; Granular Permissions</span>
                      All 9 permissions default to disabled. Access automatically expires after the approved window and is logged in real time.
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 text-[11px] text-slate-400">
                Tokens are stored exclusively in volatile memory and validated server-side with scrypt &amp; HMAC-SHA256.
              </div>
            </div>

            {/* Right Auth / Registration Forms */}
            <div className="lg:col-span-7 p-6 sm:p-7 space-y-5">
              <div
                role="tablist"
                aria-label="Security portal authentication mode"
                className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={unauthTab === 'owner'}
                  onClick={() => {
                    setUnauthTab('owner');
                    setErrorMsg('');
                  }}
                  data-testid="portal-tab-owner"
                  className={`py-2 px-2 text-xs font-semibold rounded-md transition-colors ${
                    unauthTab === 'owner'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Master Owner
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={unauthTab === 'developer'}
                  onClick={() => {
                    setUnauthTab('developer');
                    setErrorMsg('');
                  }}
                  data-testid="portal-tab-developer"
                  className={`py-2 px-2 text-xs font-semibold rounded-md transition-colors ${
                    unauthTab === 'developer'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Developer Login
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={unauthTab === 'request'}
                  onClick={() => {
                    setUnauthTab('request');
                    setErrorMsg('');
                  }}
                  data-testid="portal-tab-request"
                  className={`py-2 px-2 text-xs font-semibold rounded-md transition-colors ${
                    unauthTab === 'request'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Request Access
                </button>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="p-3 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md"
                >
                  {errorMsg}
                </div>
              )}
              {infoMsg && (
                <div className="p-3 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
                  {infoMsg}
                </div>
              )}

              {/* 1. Master Owner Claim or Login */}
              {unauthTab === 'owner' && (
                <form onSubmit={handleOwnerClaimOrLogin} className="space-y-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {needsOwnerClaim
                        ? 'Initialize Master Owner Account (First Run)'
                        : 'Master Owner Sign In'}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {needsOwnerClaim
                        ? 'Create the exclusive Master Owner credential stored hashed on the server. Only the Owner can approve developer access.'
                        : 'Authenticate with your Master Owner credentials to access complete source code, backups, and developer controls.'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Owner Username
                    </label>
                    <input
                      type="text"
                      required
                      value={ownerUsername}
                      onChange={(e) => setOwnerUsername(e.target.value)}
                      data-testid="owner-username-input"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                    />
                  </div>

                  {needsOwnerClaim && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Owner Recovery Email
                      </label>
                      <input
                        type="email"
                        required
                        value={ownerEmail}
                        onChange={(e) => setOwnerEmail(e.target.value)}
                        placeholder="owner@avyinfra.com"
                        data-testid="owner-email-input"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Master Owner Password
                    </label>
                    <input
                      type="password"
                      required
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      placeholder={
                        needsOwnerClaim
                          ? 'Min 10 chars, upper, lower, number & symbol'
                          : 'Enter Master Owner password'
                      }
                      data-testid="owner-password-input"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    data-testid="owner-submit-btn"
                    className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                  >
                    {needsOwnerClaim
                      ? 'Initialize & Open Owner Security Dashboard'
                      : 'Sign In as Master Owner'}
                  </button>
                </form>
              )}

              {/* 2. Developer 2FA Login */}
              {unauthTab === 'developer' && (
                <div className="space-y-4">
                  <form onSubmit={handleDeveloperLogin} className="space-y-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        Developer Login Portal (2FA Required)
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Requires an Owner-approved account, verified email, strong password, and live 6-digit Authenticator TOTP code.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Developer Username or Email
                      </label>
                      <input
                        type="text"
                        required
                        value={devLoginUser}
                        onChange={(e) => setDevLoginUser(e.target.value)}
                        placeholder="dev_arjun"
                        data-testid="dev-login-username"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Password
                      </label>
                      <input
                        type="password"
                        required
                        value={devLoginPass}
                        onChange={(e) => setDevLoginPass(e.target.value)}
                        data-testid="dev-login-password"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        6-Digit Authenticator 2FA Code
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={6}
                        inputMode="numeric"
                        value={devLoginTotp}
                        onChange={(e) => setDevLoginTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456"
                        data-testid="dev-login-totp"
                        className="w-full px-3 py-2 text-sm font-mono tracking-widest border border-slate-300 rounded-md"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      data-testid="dev-login-submit"
                      className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50"
                    >
                      Verify 2FA &amp; Sign In
                    </button>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setShowInlineEmailVerify((prev) => !prev)}
                        data-testid="toggle-inline-email-verify-btn"
                        className="text-xs font-medium text-orange-700 hover:underline"
                      >
                        {showInlineEmailVerify
                          ? 'Hide email verification'
                          : 'Need to verify your email address?'}
                      </button>
                    </div>
                  </form>

                  {showInlineEmailVerify && (
                    <form
                      onSubmit={handleVerifyInlineEmail}
                      data-testid="inline-email-verify-panel"
                      className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg space-y-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-amber-950">
                          Complete Work Email Verification
                        </span>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => void handleResendInlineVerification()}
                          data-testid="inline-resend-email-code-btn"
                          className="px-2.5 py-1 font-semibold text-amber-900 bg-white border border-amber-300 rounded hover:bg-amber-100"
                        >
                          Send New 6-Digit Code
                        </button>
                      </div>
                      {inlineVerifyPreviewCode && (
                        <div className="text-amber-950">
                          Verification code dispatched:{' '}
                          <span
                            className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-amber-300"
                            data-testid="inline-email-code-preview"
                          >
                            {inlineVerifyPreviewCode}
                          </span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          required
                          maxLength={6}
                          value={inlineVerifyCodeInput}
                          onChange={(e) => setInlineVerifyCodeInput(e.target.value)}
                          placeholder="Enter 6-digit email code"
                          data-testid="inline-verify-email-input"
                          className="flex-1 px-3 py-1.5 font-mono bg-white border border-amber-300 rounded-md"
                        />
                        <button
                          type="submit"
                          disabled={loading}
                          data-testid="inline-verify-email-btn"
                          className="px-4 py-1.5 font-semibold text-white bg-amber-800 rounded-md hover:bg-amber-900"
                        >
                          Verify Email
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* 3. Developer Registration, Email Verify & TOTP Enrollment */}
              {unauthTab === 'request' && !regResult && (
                <form onSubmit={handleDeveloperRegister} className="space-y-3.5">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 flex items-center gap-1.5">
                      <UserPlus className="w-4 h-4 text-orange-700" aria-hidden="true" />
                      <span>Submit Developer Access Request</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      All permissions start disabled. After email verification &amp; 2FA setup, the Master Owner reviews and grants temporary access.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Unique Username
                      </label>
                      <input
                        type="text"
                        required
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value)}
                        placeholder="dev_arjun"
                        data-testid="dev-reg-username"
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Work Email
                      </label>
                      <input
                        type="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="arjun@agency.com"
                        data-testid="dev-reg-email"
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={regFullName}
                        onChange={(e) => setRegFullName(e.target.value)}
                        placeholder="Arjun Rao"
                        data-testid="dev-reg-fullname"
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Role / Specialization
                      </label>
                      <input
                        type="text"
                        value={regRoleTitle}
                        onChange={(e) => setRegRoleTitle(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Strong Password (10+ chars, upper, lower, digit &amp; symbol)
                    </label>
                    <input
                      type="password"
                      required
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      data-testid="dev-reg-password"
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Scope &amp; Reason for Access
                    </label>
                    <textarea
                      rows={2}
                      required
                      value={regReason}
                      onChange={(e) => setRegReason(e.target.value)}
                      placeholder="Describe specific module or bug fix scope..."
                      data-testid="dev-reg-reason"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    data-testid="dev-reg-submit"
                    className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                  >
                    Register &amp; Generate 2FA Authenticator Setup
                  </button>
                </form>
              )}

              {/* Registration Step 2: 2FA QR Enrollment + Email Verification */}
              {unauthTab === 'request' && regResult && (
                <div className="space-y-4">
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row items-center gap-4">
                    <img
                      src={regResult.qrDataUrl}
                      alt="TOTP 2FA QR Code"
                      className="w-36 h-36 bg-white p-1.5 border border-slate-200 rounded"
                    />
                    <div className="space-y-1.5 text-xs">
                      <div className="font-semibold text-slate-900">
                        Scan with Google Authenticator / Authy
                      </div>
                      <p className="text-slate-600">
                        Save this 2FA key now. You will enter the 6-digit rotating TOTP code on every login.
                      </p>
                      <div className="font-mono text-[11px] bg-white border border-slate-200 px-2.5 py-1.5 rounded select-all break-all">
                        Secret: <span data-testid="dev-totp-secret">{regResult.totpSecret}</span>
                      </div>
                    </div>
                  </div>

                  {regResult.emailVerified ? (
                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                      <span>
                        Email verified for <span className="font-mono">@{regResult.username}</span>.
                        Your request is now visible in the Master Owner dashboard for approval.
                      </span>
                    </div>
                  ) : (
                    <form
                      onSubmit={handleVerifyEmail}
                      className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg space-y-2.5 text-xs"
                    >
                      <div className="font-semibold text-amber-950">
                        Verify Work Email (Code dispatched: <span className="font-mono" data-testid="dev-email-code-preview">{regResult.emailPreviewCode}</span>)
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          required
                          maxLength={6}
                          value={verifyCodeInput}
                          onChange={(e) => setVerifyCodeInput(e.target.value)}
                          placeholder="Enter 6-digit email code"
                          data-testid="dev-verify-email-input"
                          className="flex-1 px-3 py-1.5 font-mono bg-white border border-amber-300 rounded-md"
                        />
                        <button
                          type="submit"
                          disabled={loading}
                          data-testid="dev-verify-email-btn"
                          className="px-4 py-1.5 font-semibold text-white bg-amber-800 rounded-md hover:bg-amber-900"
                        >
                          Verify Email
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="flex justify-between items-center text-xs">
                    <button
                      type="button"
                      onClick={() => setRegResult(null)}
                      className="text-slate-600 hover:underline"
                    >
                      Submit another developer request
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnauthTab('developer')}
                      className="font-semibold text-orange-700 hover:underline"
                    >
                      Proceed to Developer Login →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
