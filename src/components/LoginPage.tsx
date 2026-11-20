import React, { useState } from 'react';
import {
  Building2,
  Cloud,
  Eye,
  EyeOff,
  HardHat,
  KeyRound,
  Lock,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { AuthRole } from '../utils/authAccess';

const ROLE_TABS: {
  id: AuthRole;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'admin',
    label: 'Admin Login',
    subtitle: 'Full access to all projects, workforce, payroll, expenses & settings',
    icon: ShieldCheck,
  },
  {
    id: 'supervisor',
    label: 'Supervisor Login',
    subtitle: 'Assigned tower crew attendance, work allotment & daily/food/special expenses',
    icon: HardHat,
  },
  {
    id: 'employee',
    label: 'Employee Login',
    subtitle: 'Personal attendance sheet, payment status & advance balance ledger',
    icon: UserCheck,
  },
];

export function LoginPage() {
  const {
    companyProfile,
    cloudConnected,
    user,
    syncError,
    signInWithGoogle,
    loginWithCredentials,
  } = useStore();

  const companyName = companyProfile?.companyName || 'AVY INFRA';
  const tagline = companyProfile?.tagline || 'Tile Laying & Workforce Operations';

  const [role, setRole] = useState<AuthRole>('admin');
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');

  const activeTabInfo = ROLE_TABS.find((t) => t.id === role) || ROLE_TABS[0];

  const handleRoleChange = (nextRole: AuthRole) => {
    setRole(nextRole);
    setError('');
    setIdentifier('');
    setSecret('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const result = loginWithCredentials(role, identifier, secret);
    if (!result.ok) {
      setError(result.error || 'Login failed. Check your credentials.');
    }
  };

  const handleQuickLogin = (targetRole: AuthRole, demoId: string, demoSecret: string) => {
    setRole(targetRole);
    setIdentifier(demoId);
    setSecret(demoSecret);
    setError('');
    const result = loginWithCredentials(targetRole, demoId, demoSecret);
    if (!result.ok) {
      setError(result.error || 'Unable to sign in with demo account.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl w-full mx-auto bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* Left Brand & Role Overview Panel */}
        <div className="lg:col-span-5 bg-slate-900 text-slate-100 p-7 sm:p-8 flex flex-col justify-between gap-8">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              {companyProfile?.logoDataUrl ? (
                <img
                  src={companyProfile.logoDataUrl}
                  alt={companyName}
                  className="w-11 h-11 rounded-md object-contain bg-white p-1"
                />
              ) : (
                <div className="w-11 h-11 rounded-md bg-orange-700 text-white flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0">
                <div className="font-display text-xl font-bold tracking-tight text-white truncate">
                  {companyName}
                </div>
                <div className="text-xs text-slate-400 truncate">{tagline}</div>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <h1 className="text-xl font-semibold text-white tracking-tight">
                Site Operations &amp; Workforce Portal
              </h1>
              <p className="text-xs text-slate-300 leading-relaxed">
                Sign in with your role credentials to access project flat matrices, tower crew attendance, advance ledgers, and site expense registers.
              </p>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-800">
              <div className="flex items-start gap-2.5 text-xs">
                <ShieldCheck className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="font-semibold text-white">Admin Access</div>
                  <div className="text-slate-400">
                    Full control of projects, towers, employees, payroll settlements, role access &amp; attendance edit PIN.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2.5 text-xs">
                <HardHat className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="font-semibold text-white">Supervisor (Tower-Scoped)</div>
                  <div className="text-slate-400">
                    View &amp; update assigned tower crew, mark locked daily attendance, allot flat work, update tile status, and add food, daily &amp; special expenses.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2.5 text-xs">
                <UserCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="font-semibold text-white">Employee Self-Service</div>
                  <div className="text-slate-400">
                    Read-only view of personal attendance days, wages earned, advances taken, and payable balance.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-3">
            {cloudConnected && user ? (
              <div className="text-xs text-emerald-300 truncate">
                Cloud Sync Active: {user.email}
              </div>
            ) : (
              <button
                type="button"
                onClick={signInWithGoogle}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-md hover:bg-slate-700 transition-colors"
              >
                <Cloud className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Connect Google Cloud Sync</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Login Form Panel */}
        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between gap-6">
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Sign In to Workspace</h2>
              <p className="text-xs text-slate-500 mt-0.5">{activeTabInfo.subtitle}</p>
            </div>

            {syncError && (
              <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
                Cloud Sync Notice: {syncError}
              </div>
            )}

            {/* Role Selector Tabs */}
            <div
              role="tablist"
              aria-label="Select login role"
              className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg"
            >
              {ROLE_TABS.map((tab) => {
                const Icon = tab.icon;
                const active = role === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => handleRoleChange(tab.id)}
                    className={`flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{tab.label.replace(' Login', '')}</span>
                  </button>
                );
              })}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="p-3 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md"
                >
                  {error}
                </div>
              )}

              <div>
                <label
                  htmlFor="login-identifier"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  {role === 'admin'
                    ? 'Admin Username or HR Email'
                    : role === 'supervisor'
                      ? 'Supervisor Employee ID or Registered Mobile'
                      : 'Employee ID or Registered Mobile'}
                </label>
                <input
                  id="login-identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={
                    role === 'admin'
                      ? 'admin'
                      : role === 'supervisor'
                        ? 'AVY-SUP-005 or 9866554433'
                        : 'AVY-MSN-001 or 9848011223'
                  }
                  className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
                />
              </div>

              <div>
                <label
                  htmlFor="login-secret"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  {role === 'admin' ? 'Admin Password' : '4-Digit Login PIN'}
                </label>
                <div className="relative">
                  <Lock
                    className="w-4 h-4 text-slate-400 absolute left-3 top-3"
                    aria-hidden="true"
                  />
                  <input
                    id="login-secret"
                    type={showSecret ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={role === 'admin' ? 'Enter admin password' : 'Enter 4-digit PIN'}
                    className="w-full pl-9 pr-10 py-2.5 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((prev) => !prev)}
                    aria-label={showSecret ? 'Hide password or PIN' : 'Show password or PIN'}
                    className="absolute right-2.5 top-2 p-1 text-slate-400 hover:text-slate-700"
                  >
                    {showSecret ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 transition-colors"
              >
                Sign In as {role === 'admin' ? 'Admin' : role === 'supervisor' ? 'Supervisor' : 'Employee'}
              </button>
            </form>
          </div>

          {/* Quick Starter Accounts */}
          <div className="pt-4 border-t border-slate-200 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <KeyRound className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
              <span>Quick Starter Accounts (Editable in Admin Role Access)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleQuickLogin('admin', 'admin', 'admin123')}
                className="p-2.5 text-left bg-slate-50 border border-slate-200 rounded-md hover:border-orange-400 hover:bg-orange-50/40 transition-colors"
              >
                <div className="text-xs font-semibold text-slate-900">Admin (All Access)</div>
                <div className="text-[11px] font-mono text-slate-600 mt-0.5">admin / admin123</div>
              </button>
              <button
                type="button"
                onClick={() => handleQuickLogin('supervisor', 'AVY-SUP-005', '1234')}
                className="p-2.5 text-left bg-slate-50 border border-slate-200 rounded-md hover:border-orange-400 hover:bg-orange-50/40 transition-colors"
              >
                <div className="text-xs font-semibold text-slate-900">Supervisor (Tower A)</div>
                <div className="text-[11px] font-mono text-slate-600 mt-0.5">
                  AVY-SUP-005 / 1234
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleQuickLogin('employee', 'AVY-MSN-001', '1234')}
                className="p-2.5 text-left bg-slate-50 border border-slate-200 rounded-md hover:border-orange-400 hover:bg-orange-50/40 transition-colors"
              >
                <div className="text-xs font-semibold text-slate-900">Employee (Raju)</div>
                <div className="text-[11px] font-mono text-slate-600 mt-0.5">
                  AVY-MSN-001 / 1234
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
