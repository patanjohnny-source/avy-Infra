import React, { useEffect, useState } from 'react';
import {
  Building,
  Building2,
  CalendarCheck,
  Cloud,
  FileSpreadsheet,
  FileText,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  ReceiptIndianRupee,
  ScrollText,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { StoreProvider, useStore } from './context/StoreContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { AppSection, DashboardView } from './components/DashboardView';
import { ProjectsFlatsView } from './components/ProjectsFlatsView';
import { WorkforceView } from './components/WorkforceView';
import { AttendancePayrollView } from './components/AttendancePayrollView';
import { ExpensesReportsView } from './components/ExpensesReportsView';
import { DailySiteLogView } from './components/DailySiteLogView';
import { BillingInvoicesView } from './components/BillingInvoicesView';
import { DocumentsOfficeView } from './components/DocumentsOfficeView';
import { GiveAdvanceModal } from './components/GiveAdvanceModal';
import { AssignWorkModal } from './components/AssignWorkModal';
import { WhatsappShareModal } from './components/WhatsappShareModal';
import { CompanySettingsModal } from './components/CompanySettingsModal';
import { LoginPage } from './components/LoginPage';
import { EmployeePortalView } from './components/EmployeePortalView';
import { AdminAccessModal } from './components/AdminAccessModal';
import { QrScannedProfileView } from './components/QrScannedProfileView';
import { GlobalHeaderSearch } from './components/GlobalHeaderSearch';
import { GoogleMapsProvider } from './components/GoogleMapsProvider';
import { ProjectLogsReportModal } from './components/ProjectLogsReportModal';
import { TeamMessengerView } from './components/TeamMessengerView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { SecurityPortalRoot } from './components/security/SecurityPortalRoot';
import type { TileZoneKey, WhatsappMessagePayload } from './types/avy';
import {
  canAccessWorkspaceSection,
  getScopedEmployees,
  getScopedFlats,
  getScopedProjects,
  getScopedTowers,
  isAdminSession,
  isEmployeeSession,
  isSupervisorSession,
} from './utils/authAccess';
import type { GlobalSearchResultItem } from './utils/globalSearch';
import { countUnreadMessengerMessages } from './utils/messenger';
import { parseQrScanParams } from './utils/qrProfile';

const SECTION_TITLES: Record<AppSection, string> = {
  overview: 'Site Operations Overview',
  projects: 'Projects, Towers & Flat Matrix',
  workforce: 'Workforce, IDs & Site Deployment',
  payroll: 'Attendance, Monthly Register & Payroll',
  expenses: 'Project & Tower Expenses, Food & Timelines',
  sitelogs: 'Daily Site Log & Tower Progress Journal',
  messenger: 'Team & Site Communication Messenger',
  billing: 'Quotations, Invoices & Project Tax Organizer',
  documents: 'Documents Drive, Smart Generator & Office Suite',
};

function AppShell() {
  const {
    session,
    logoutSession,
    user,
    cloudConnected,
    cloudLoading,
    companyProfile,
    projects,
    towers,
    flats,
    employees,
    teamMessages,
    syncError,
    signInWithGoogle,
    signOutUser,
    seedCloudFromLocal,
    markAdvanceWhatsappShared,
    recordAdvanceFollowUpSent,
  } = useStore();
  const { isDark, toggleTheme } = useTheme();

  const companyName = companyProfile?.companyName || 'AVY INFRA';

  const [section, setSection] = useState<AppSection>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Global modal states
  const [advanceModalOpen, setAdvanceModalOpen] = useState(false);
  const [advanceEmpId, setAdvanceEmpId] = useState<string | undefined>(undefined);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignFlatId, setAssignFlatId] = useState<string | undefined>(undefined);
  const [assignZoneKey, setAssignZoneKey] = useState<TileZoneKey | undefined>(undefined);
  const [assignEmpId, setAssignEmpId] = useState<string | undefined>(undefined);

  const [companySettingsOpen, setCompanySettingsOpen] = useState(false);
  const [adminAccessOpen, setAdminAccessOpen] = useState(false);
  const [projectLogsModalOpen, setProjectLogsModalOpen] = useState(false);
  const [projectLogsInitialId, setProjectLogsInitialId] = useState<string | undefined>(undefined);
  const [whatsappPayload, setWhatsappPayload] = useState<WhatsappMessagePayload | null>(null);
  const [preselectedAttCard, setPreselectedAttCard] = useState<
    { employeeId: string; nonce: number } | undefined
  >(undefined);
  const [preselectedProjectTarget, setPreselectedProjectTarget] = useState<
    { projectId?: string; towerId?: string; flatId?: string; nonce: number } | undefined
  >(undefined);
  const [preselectedWorkforceEmp, setPreselectedWorkforceEmp] = useState<
    { employeeId: string; nonce: number } | undefined
  >(undefined);

  const [locationSearch, setLocationSearch] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.search : ''
  );
  const [securityPortalOpen, setSecurityPortalOpen] = useState(false);

  useEffect(() => {
    const handlePop = () => {
      setLocationSearch(window.location.search);
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  useEffect(() => {
    if (session && !isEmployeeSession(session) && !canAccessWorkspaceSection(session, section)) {
      setSection('overview');
    }
  }, [session, section]);

  const openQrScanPreview = (scanUrl: string) => {
    try {
      const parsed = new URL(scanUrl, window.location.origin);
      const nextUrl = `${window.location.pathname}${parsed.search}`;
      window.history.pushState({}, '', nextUrl);
      setLocationSearch(parsed.search);
    } catch {
      const idx = scanUrl.indexOf('?');
      const q = idx >= 0 ? scanUrl.slice(idx) : '';
      window.history.pushState({}, '', `${window.location.pathname}${q}`);
      setLocationSearch(q);
    }
  };

  const exitQrScanView = () => {
    window.history.pushState({}, '', window.location.pathname);
    setLocationSearch('');
  };

  // 0. Public Read-Only Scanned QR Workforce Pass (bypasses login gate intentionally)
  if (parseQrScanParams(locationSearch).hasQrScanRoute) {
    return (
      <QrScannedProfileView
        search={locationSearch}
        onExitScanView={exitQrScanView}
      />
    );
  }

  // 0.5 Owner & Developer Source Code Security Portal
  if (securityPortalOpen) {
    return <SecurityPortalRoot onExitPortal={() => setSecurityPortalOpen(false)} />;
  }

  // 1. Show Login Page whenever no active workspace session exists
  if (!session) {
    return <LoginPage onOpenSecurityPortal={() => setSecurityPortalOpen(true)} />;
  }

  // 2. Employee Login -> Dedicated read-only personal Attendance, Payment & Advance Balance portal
  if (isEmployeeSession(session)) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="font-display font-bold text-slate-900 whitespace-nowrap">
              {companyName}
            </span>
            <span className="text-slate-300" aria-hidden="true">/</span>
            <span className="text-xs sm:text-sm text-slate-600 truncate">
              My Attendance, Payment &amp; Advance Balance
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <PWAInstallButton variant="compact" />
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              data-testid="employee-dark-mode-toggle"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 whitespace-nowrap"
            >
              {isDark ? (
                <Sun className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{isDark ? 'Light' : 'Dark'}</span>
            </button>
            <span className="hidden sm:inline-flex items-center px-2.5 py-1 text-xs font-mono font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
              {session.empCode || 'EMPLOYEE'} · {session.displayName}
            </span>
            <button
              type="button"
              onClick={async () => {
                setSection('overview');
                await logoutSession();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Logout</span>
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto">
          <EmployeePortalView />
        </main>
      </div>
    );
  }

  const isAdmin = isAdminSession(session);
  const isSupervisor = isSupervisorSession(session);
  const assignedTowers = getScopedTowers(session, towers);
  const assignedTowerLabel = assignedTowers.map((t) => t.name).join(', ') || 'Assigned Tower';
  const scopedSearchProjects = getScopedProjects(session, projects, towers);
  const scopedSearchFlats = getScopedFlats(session, flats);
  const scopedSearchEmployees = getScopedEmployees(session, employees);
  const unreadMessengerCount = countUnreadMessengerMessages({
    session,
    companyProfile,
    employees,
    messages: teamMessages,
  });

  const handleGlobalSearchSelect = (item: GlobalSearchResultItem) => {
    const nonce = Date.now();
    if (item.type === 'employee' && item.employeeId) {
      setPreselectedWorkforceEmp({ employeeId: item.employeeId, nonce });
      setSection('workforce');
      return;
    }
    if (item.type === 'flat' && item.flatId) {
      setPreselectedProjectTarget({
        projectId: item.projectId,
        towerId: item.towerId,
        flatId: item.flatId,
        nonce,
      });
      setSection('projects');
      return;
    }
    if (item.type === 'project' && item.projectId) {
      setPreselectedProjectTarget({
        projectId: item.projectId,
        nonce,
      });
      setSection('projects');
    }
  };

  const openProjectLogsReport = (projectId?: string) => {
    setProjectLogsInitialId(projectId);
    setProjectLogsModalOpen(true);
  };

  const navItems: { id: AppSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = (
    [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'projects', label: isSupervisor ? 'Tower & Flats' : 'Projects & Flats', icon: Building2 },
      { id: 'workforce', label: isSupervisor ? 'Tower Crew & IDs' : 'Workforce & IDs', icon: Users },
      { id: 'payroll', label: isSupervisor ? 'Attendance & Food' : 'Attendance & Payroll', icon: CalendarCheck },
      { id: 'expenses', label: 'Expenses & Timelines', icon: ReceiptIndianRupee },
      { id: 'billing', label: 'Invoices & Quotes', icon: FileSpreadsheet },
      { id: 'documents', label: 'Docs & Letters', icon: FileText },
      { id: 'sitelogs', label: 'Daily Site Log', icon: ScrollText },
      { id: 'messenger', label: 'Team Messenger', icon: MessageSquare },
    ] as const
  ).filter((item) => canAccessWorkspaceSection(session, item.id));

  const openGiveAdvance = (employeeId?: string) => {
    setAdvanceEmpId(employeeId);
    setAdvanceModalOpen(true);
  };

  const openAssignWork = (opts?: {
    flatId?: string;
    zoneKey?: TileZoneKey;
    employeeId?: string;
  }) => {
    setAssignFlatId(opts?.flatId);
    setAssignZoneKey(opts?.zoneKey);
    setAssignEmpId(opts?.employeeId);
    setAssignModalOpen(true);
  };

  const handleNavigate = (next: AppSection) => {
    setSection(next);
    setMobileMenuOpen(false);
  };

  const handleLogout = async () => {
    setMobileMenuOpen(false);
    setSection('overview');
    await logoutSession();
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:w-60 lg:flex-col lg:fixed lg:inset-y-0 bg-slate-900 text-slate-100 border-r border-slate-800">
        <div className="px-6 py-5 border-b border-slate-800">
          <div className="font-display text-lg font-bold tracking-tight text-white truncate">
            {companyName}
          </div>
          <div className="text-xs text-slate-400 mt-0.5 truncate">
            {isAdmin ? 'Admin Full Control' : `Supervisor · ${assignedTowerLabel}`}
          </div>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1" aria-label="Main Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-orange-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
                {item.id === 'messenger' && unreadMessengerCount > 0 && (
                  <span className="ml-auto px-1.5 py-0.5 text-[10px] font-mono font-bold rounded-full bg-orange-500 text-white">
                    {unreadMessengerCount}
                  </span>
                )}
              </button>
            );
          })}

          <div className="pt-4 mt-4 border-t border-slate-800 space-y-1">
            <button
              type="button"
              data-testid="sidebar-settings-button"
              onClick={() => setCompanySettingsOpen(true)}
              className="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium text-slate-300 rounded-md hover:bg-slate-800 hover:text-white transition-colors whitespace-nowrap"
            >
              {isAdmin ? (
                <Building className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <Settings className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{isAdmin ? 'Settings & Company' : 'Display & Settings'}</span>
            </button>
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setAdminAccessOpen(true)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium text-slate-300 rounded-md hover:bg-slate-800 hover:text-white transition-colors whitespace-nowrap"
                >
                  <KeyRound className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Role &amp; Login Access</span>
                </button>
                <button
                  type="button"
                  data-testid="sidebar-security-portal-btn"
                  onClick={() => setSecurityPortalOpen(true)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium text-amber-300 rounded-md hover:bg-slate-800 hover:text-white transition-colors whitespace-nowrap"
                >
                  <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Source &amp; Dev Security</span>
                </button>
              </>
            )}
            <PWAInstallButton variant="sidebar" />
          </div>
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-2.5">
          <div className="px-2.5 py-2 rounded bg-slate-800/80 border border-slate-700/80 space-y-0.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-orange-300">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{isAdmin ? 'Admin' : 'Supervisor'}</span>
              {session.empCode && <span className="font-mono text-slate-300">({session.empCode})</span>}
            </div>
            <div className="text-xs font-medium text-white truncate">{session.displayName}</div>
            {isSupervisor && (
              <div className="text-[11px] text-slate-400 truncate">{assignedTowerLabel}</div>
            )}
          </div>

          {isAdmin && (
            cloudConnected && user ? (
              <div className="space-y-1.5">
                <div className="text-[11px] text-slate-400 truncate" title={user.email || ''}>
                  Cloud: {user.email}
                </div>
                {projects.length === 0 && !cloudLoading && (
                  <button
                    type="button"
                    onClick={() => {
                      void seedCloudFromLocal().catch(() => {});
                    }}
                    className="w-full px-3 py-1.5 text-xs font-medium text-white bg-slate-800 border border-slate-700 rounded hover:bg-slate-700"
                  >
                    Import Starter Site Data
                  </button>
                )}
                <button
                  type="button"
                  onClick={signOutUser}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 border border-slate-700 rounded hover:bg-slate-800"
                >
                  <Cloud className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Disconnect Cloud</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={signInWithGoogle}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-white bg-slate-800 border border-slate-700 rounded-md hover:bg-slate-700 transition-colors"
              >
                <Cloud className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign In for Cloud Sync</span>
              </button>
            )
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-800 border border-slate-700 rounded-md hover:bg-red-900/60 hover:border-red-700 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-64 max-w-[80vw] bg-slate-900 text-slate-100 flex flex-col z-50">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div className="min-w-0">
                <div className="font-display text-lg font-bold text-white truncate">{companyName}</div>
                <div className="text-[11px] text-slate-400 truncate">
                  {isAdmin ? 'Admin Access' : `Sup · ${assignedTowerLabel}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Mobile Navigation">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-md ${
                      active
                        ? 'bg-orange-700 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                    {item.id === 'messenger' && unreadMessengerCount > 0 && (
                      <span className="ml-auto px-1.5 py-0.5 text-[10px] font-mono font-bold rounded-full bg-orange-500 text-white">
                        {unreadMessengerCount}
                      </span>
                    )}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setCompanySettingsOpen(true);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-slate-300 rounded-md hover:bg-slate-800 hover:text-white"
              >
                {isAdmin ? (
                  <Building className="w-4 h-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Settings className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
                <span>{isAdmin ? 'Settings & Company' : 'Display & Settings'}</span>
              </button>
              {isAdmin && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setAdminAccessOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-slate-300 rounded-md hover:bg-slate-800 hover:text-white"
                  >
                    <KeyRound className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Role &amp; Login Access</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setSecurityPortalOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-amber-300 rounded-md hover:bg-slate-800 hover:text-white"
                  >
                    <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Source &amp; Dev Security</span>
                  </button>
                </>
              )}
              <div className="pt-2">
                <PWAInstallButton
                  variant="sidebar"
                  onOpenCallback={() => setMobileMenuOpen(false)}
                />
              </div>
            </nav>
            <div className="p-4 border-t border-slate-800 space-y-2">
              {isAdmin && (
                cloudConnected && user ? (
                  <button
                    type="button"
                    onClick={signOutUser}
                    className="w-full px-3 py-2 text-xs font-medium text-slate-200 border border-slate-700 rounded"
                  >
                    Disconnect Cloud ({user.email})
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={signInWithGoogle}
                    className="w-full px-3 py-2 text-xs font-medium text-white bg-slate-800 border border-slate-700 rounded"
                  >
                    Sign In for Cloud Sync
                  </button>
                )
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-800 border border-slate-700 rounded"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Logout ({session.displayName})</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-60 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-3 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-1.5 text-slate-600 hover:text-slate-900 rounded-md shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="hidden xl:flex items-center gap-2 text-sm truncate">
              <span className="font-semibold text-slate-900 whitespace-nowrap">{companyName}</span>
              <span className="text-slate-400" aria-hidden="true">/</span>
              <span className="text-slate-600 truncate max-w-[190px]">
                {isSupervisor ? `${assignedTowerLabel} · ` : ''}
                {SECTION_TITLES[section]}
              </span>
            </div>
          </div>

          <div className="flex-1 flex justify-center min-w-0 max-w-md">
            <GlobalHeaderSearch
              projects={scopedSearchProjects}
              towers={assignedTowers}
              flats={scopedSearchFlats}
              employees={scopedSearchEmployees}
              onSelectResult={handleGlobalSearchSelect}
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`hidden 2xl:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border whitespace-nowrap ${
                isAdmin
                  ? 'bg-slate-100 text-slate-800 border-slate-300'
                  : 'bg-amber-50 text-amber-900 border-amber-300'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {isAdmin
                  ? `Admin: ${session.displayName}`
                  : `Supervisor: ${session.displayName}`}
              </span>
            </span>

            <button
              type="button"
              data-testid="topbar-project-logs-report-btn"
              onClick={() => openProjectLogsReport()}
              aria-label="Open Project Logs Summary Report"
              className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 whitespace-nowrap"
            >
              <ScrollText className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
              <span>Logs Report</span>
            </button>

            <PWAInstallButton variant="topbar" />

            <button
              type="button"
              data-testid="topbar-settings-button"
              onClick={() => setCompanySettingsOpen(true)}
              aria-label="Open settings menu"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 whitespace-nowrap"
            >
              <Settings className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Settings</span>
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setAdminAccessOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 whitespace-nowrap"
              >
                <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Access &amp; PINs</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => openGiveAdvance()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 transition-colors whitespace-nowrap"
            >
              <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Give Advance</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              aria-label="Logout of workspace"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Sync Banner if empty cloud workspace or error */}
        {syncError && isAdmin && (
          <div className="mx-4 sm:mx-6 lg:mx-8 mt-4 p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
            Cloud Sync Notice: {syncError}
          </div>
        )}

        {isAdmin && cloudConnected && projects.length === 0 && !cloudLoading && (
          <div className="mx-4 sm:mx-6 lg:mx-8 mt-4 p-4 bg-white border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-700">
              Your Firebase cloud workspace is empty. Load the AVY INFRA starter projects, flats, and workforce or start adding your own.
            </div>
            <button
              type="button"
              onClick={() => {
                void seedCloudFromLocal().catch(() => {});
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap"
            >
              Load Starter Site Data to Cloud
            </button>
          </div>
        )}

        {/* Active View Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8 max-w-[1400px] w-full mx-auto">
          {section === 'overview' && (
            <DashboardView
              onNavigate={handleNavigate}
              onOpenGiveAdvance={(empId) => openGiveAdvance(empId)}
              onOpenAssignWork={() => openAssignWork()}
              onOpenCompanySettings={isAdmin ? () => setCompanySettingsOpen(true) : undefined}
              onTriggerWhatsapp={(p) => setWhatsappPayload(p)}
            />
          )}

          {section === 'projects' && (
            <ProjectsFlatsView
              preselectedTarget={preselectedProjectTarget}
              onOpenAssignWork={(flatId, zoneKey) => openAssignWork({ flatId, zoneKey })}
              onOpenProjectLogsReport={openProjectLogsReport}
              onTriggerWhatsapp={(p) => setWhatsappPayload(p)}
              onPreviewQrProfile={openQrScanPreview}
            />
          )}

          {section === 'workforce' && (
            <WorkforceView
              preselectedEmployee={preselectedWorkforceEmp}
              onOpenGiveAdvance={(empId) => openGiveAdvance(empId)}
              onOpenAssignWork={(empId) => openAssignWork({ employeeId: empId })}
              onOpenEmployeeAttendanceCard={(empId) => {
                setPreselectedAttCard({ employeeId: empId, nonce: Date.now() });
                setSection('payroll');
              }}
              onOpenCompanySettings={() => setCompanySettingsOpen(true)}
              onTriggerWhatsapp={(p) => setWhatsappPayload(p)}
              onPreviewQrProfile={openQrScanPreview}
            />
          )}

          {section === 'payroll' && (
            <AttendancePayrollView
              preselectedEmployeeCard={preselectedAttCard}
              onOpenGiveAdvance={(empId) => openGiveAdvance(empId)}
              onTriggerWhatsapp={(p) => setWhatsappPayload(p)}
            />
          )}

          {section === 'expenses' && (
            <ExpensesReportsView
              onTriggerWhatsapp={(p) => setWhatsappPayload(p)}
              onOpenCompanySettings={() => setCompanySettingsOpen(true)}
            />
          )}

          {isAdmin && section === 'billing' && (
            <BillingInvoicesView onTriggerWhatsapp={(p) => setWhatsappPayload(p)} />
          )}

          {isAdmin && section === 'documents' && (
            <DocumentsOfficeView onTriggerWhatsapp={(p) => setWhatsappPayload(p)} />
          )}

          {section === 'sitelogs' && (
            <DailySiteLogView onOpenProjectLogsReport={openProjectLogsReport} />
          )}

          {section === 'messenger' && <TeamMessengerView />}
        </main>
      </div>

      {/* Mobile Android Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Quick Navigation"
        data-testid="mobile-bottom-nav"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 h-16 px-1"
      >
        {(
          [
            { id: 'overview' as AppSection, label: 'Home', icon: LayoutDashboard },
            { id: 'projects' as AppSection, label: 'Flats', icon: Building2 },
            { id: 'payroll' as AppSection, label: 'Payroll', icon: CalendarCheck },
            { id: 'messenger' as AppSection, label: 'Chat', icon: MessageSquare },
          ] as const
        )
          .filter((item) => canAccessWorkspaceSection(session, item.id))
          .map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                  active
                    ? 'text-orange-700 dark:text-orange-400 font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
                {item.id === 'messenger' && unreadMessengerCount > 0 && (
                  <span className="absolute top-1.5 right-3 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-mono font-bold rounded-full bg-orange-600 text-white">
                    {unreadMessengerCount}
                  </span>
                )}
              </button>
            );
          })}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open all modules menu"
          className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
        >
          <Menu className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Menu</span>
        </button>
      </nav>

      {/* Global Modals */}
      <GiveAdvanceModal
        isOpen={advanceModalOpen}
        preselectedEmployeeId={advanceEmpId}
        onClose={() => setAdvanceModalOpen(false)}
        onTriggerWhatsapp={(p) => setWhatsappPayload(p)}
      />

      <AssignWorkModal
        isOpen={assignModalOpen}
        preselectedFlatId={assignFlatId}
        preselectedZoneKey={assignZoneKey}
        preselectedEmployeeId={assignEmpId}
        onClose={() => setAssignModalOpen(false)}
      />

      <CompanySettingsModal
        isOpen={companySettingsOpen}
        onClose={() => setCompanySettingsOpen(false)}
        canEditCompany={isAdmin}
      />

      {isAdmin && (
        <AdminAccessModal
          isOpen={adminAccessOpen}
          onClose={() => setAdminAccessOpen(false)}
        />
      )}

      <WhatsappShareModal
        payload={whatsappPayload}
        onClose={() => setWhatsappPayload(null)}
        onShared={(advId, followUpAdvId) => {
          if (advId) {
            markAdvanceWhatsappShared(advId);
          }
          if (followUpAdvId) {
            recordAdvanceFollowUpSent(followUpAdvId);
          }
        }}
      />

      <ProjectLogsReportModal
        isOpen={projectLogsModalOpen}
        initialProjectId={projectLogsInitialId}
        onClose={() => setProjectLogsModalOpen(false)}
      />
    </div>
  );
}

export default function App() {
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);

  useEffect(() => {
    const handleQuotaExceeded = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
  }, []);

  return (
    <ThemeProvider>
      <GoogleMapsProvider>
        <StoreProvider>
          {gmpQuotaExceeded && (
            <div
              role="alert"
              data-testid="gmp-quota-exceeded-banner"
              className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm"
            >
              <span>
                Google Maps Platform quota reached. If you are the app owner, visit{' '}
                <a
                  href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-semibold text-amber-950 hover:text-amber-800"
                >
                  maps developer site
                </a>{' '}
                for instructions to update your account.
              </span>
            </div>
          )}
          <AppShell />
          <OfflineIndicator />
        </StoreProvider>
      </GoogleMapsProvider>
    </ThemeProvider>
  );
}
