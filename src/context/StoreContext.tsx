import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  OperationType,
  auth,
  clampString,
  db,
  googleProvider,
  handleFirestoreError,
  sanitizeId,
  stripUndefinedDeep,
  testFirestoreConnection,
  tsCreate,
  tsUpdate,
} from '../lib/firebase';
import {
  WorkspaceSnapshot,
  createDefaultCompanyProfile,
  createSeedWorkspace,
  getTodayIso,
} from '../data/seedData';
import type {
  AdvanceEntry,
  AdvanceType,
  AssignmentStatus,
  AttendanceRecord,
  AttendanceStatus,
  BillingDocStatus,
  BillingDocType,
  BillingDocument,
  BillingTaxMode,
  CompanyDocument,
  CompanyDocumentApprovalStatus,
  CompanyDocumentCategory,
  CompanyDocumentFormat,
  CompanyDocumentSource,
  CompanyProfile,
  DailySiteLog,
  DeploymentRecord,
  Employee,
  EmployeeDocument,
  EmployeeRole,
  ExpenseCategory,
  FlatUnit,
  PaymentMode,
  Project,
  SettlementEntry,
  SiteExpense,
  TileZoneCategory,
  TileZoneDefinition,
  TileZoneKey,
  Tower,
  WorkAssignment,
  ZoneStatus,
} from '../types/avy';
import {
  computeDailyWage,
  computeEmployeePayroll,
  formatAdvanceWhatsappMessage,
  generateEmployeeCode,
} from '../utils/payroll';
import {
  SPECIAL_FLOOR_PRESETS,
  TILE_ZONES,
  ZONE_LABEL_MAP,
  type GeneratedFlatUnitSpec,
  type MixedBhkSpec,
  type WholeFloorCustomZoneItem,
  addCustomZoneToFlatsBatch,
  addCustomZonesToFlatsBatch,
  buildMixedBhkFloorUnits,
  createDefaultZones,
  formatFloorLabel,
  generateUnitNumbersForFloor,
  slugifyZoneKey,
  upsertFloorCommonUnitsBatch,
} from '../utils/tileZones';
import {
  DEFAULT_BILLING_TERMS,
  computeBillingTotals,
  generateNextBillingNumber,
} from '../utils/billing';
import {
  DEFAULT_WEEKLY_EXPENSE_BUDGET,
  findActiveUnfinishedAssignment,
  isSundayDate,
} from '../utils/operations';
import {
  AuthRole,
  DEFAULT_ADMIN_EDIT_PIN,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_USER_PIN,
  WorkspaceSession,
  authenticateWorkspaceUser,
  canAccessTower,
  canSupervisorUpdateEmployee,
  evaluateAttendanceMutation,
} from '../utils/authAccess';
import { buildNamespacedCloudSeedPayload } from '../utils/cloudSync';
import {
  buildEmployeeQrPassData,
  buildEmployeeQrScanUrl,
  generateQrPassToken,
} from '../utils/qrProfile';

const LOCAL_STORAGE_KEY = 'avy_infra_workspace_v1';
const AUTH_SESSION_KEY = 'avy_infra_auth_session_v1';

function loadInitialSession(): WorkspaceSession | null {
  try {
    if (typeof window !== 'undefined' && window.location.search.includes('autostart=1')) {
      return {
        role: 'admin',
        displayName: 'AVY INFRA Admin',
        assignedTowerIds: [],
        loginAt: new Date().toISOString(),
      };
    }
    const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceSession;
    if (parsed && (parsed.role === 'admin' || parsed.role === 'supervisor' || parsed.role === 'employee')) {
      return {
        ...parsed,
        assignedTowerIds: Array.isArray(parsed.assignedTowerIds) ? parsed.assignedTowerIds : [],
      };
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

function toIsoString(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (
    typeof val === 'object' &&
    val !== null &&
    'toDate' in val &&
    typeof (val as { toDate: () => Date }).toDate === 'function'
  ) {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

function loadLocalWorkspace(): WorkspaceSnapshot {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      const seeded = createSeedWorkspace('local-avy-infra');
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
    if (!parsed.projects || !parsed.employees) {
      const seeded = createSeedWorkspace('local-avy-infra');
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const defaultProfile = createDefaultCompanyProfile('local-avy-infra');
    return {
      companyProfile: parsed.companyProfile
        ? {
            ...defaultProfile,
            ...parsed.companyProfile,
            adminUsername: parsed.companyProfile.adminUsername || DEFAULT_ADMIN_USERNAME,
            adminPassword: parsed.companyProfile.adminPassword || DEFAULT_ADMIN_PASSWORD,
            adminEditPin: parsed.companyProfile.adminEditPin || DEFAULT_ADMIN_EDIT_PIN,
            supervisorCanEditAttendance: Boolean(
              parsed.companyProfile.supervisorCanEditAttendance
            ),
            requireFinishBeforeNewWork:
              parsed.companyProfile.requireFinishBeforeNewWork !== false,
            customAdvanceCategories: Array.isArray(parsed.companyProfile.customAdvanceCategories)
              ? parsed.companyProfile.customAdvanceCategories
              : defaultProfile.customAdvanceCategories,
            customExpenseCategories: Array.isArray(parsed.companyProfile.customExpenseCategories)
              ? parsed.companyProfile.customExpenseCategories
              : defaultProfile.customExpenseCategories,
            weeklyExpenseBudget:
              typeof parsed.companyProfile.weeklyExpenseBudget === 'number' &&
              Number.isFinite(parsed.companyProfile.weeklyExpenseBudget)
                ? Math.max(0, Math.round(parsed.companyProfile.weeklyExpenseBudget))
                : DEFAULT_WEEKLY_EXPENSE_BUDGET,
            tileZoneCatalog:
              parsed.companyProfile.tileZoneCatalog &&
              parsed.companyProfile.tileZoneCatalog.length > 0
                ? parsed.companyProfile.tileZoneCatalog
                : defaultProfile.tileZoneCatalog,
          }
        : defaultProfile,
      projects: parsed.projects || [],
      towers: parsed.towers || [],
      flats: parsed.flats || [],
      employees: (parsed.employees || []).map((emp) => ({
        ...emp,
        loginPin: emp.loginPin || DEFAULT_USER_PIN,
        qrToken: emp.qrToken || generateQrPassToken(),
        assignedTowerIds:
          Array.isArray(emp.assignedTowerIds) && emp.assignedTowerIds.length > 0
            ? emp.assignedTowerIds
            : emp.role === 'Supervisor' && emp.currentTowerId
              ? [emp.currentTowerId]
              : emp.assignedTowerIds,
      })),
      employeeDocuments: parsed.employeeDocuments || [],
      deployments: parsed.deployments || [],
      assignments: parsed.assignments || [],
      attendance: parsed.attendance || [],
      advances: parsed.advances || [],
      expenses: parsed.expenses || [],
      settlements: parsed.settlements || [],
      dailySiteLogs: parsed.dailySiteLogs || [],
      billingDocuments: Array.isArray(parsed.billingDocuments)
        ? parsed.billingDocuments
        : createSeedWorkspace('local-avy-infra').billingDocuments,
      companyDocuments: Array.isArray(parsed.companyDocuments)
        ? parsed.companyDocuments
        : createSeedWorkspace('local-avy-infra').companyDocuments,
    };
  } catch {
    return createSeedWorkspace('local-avy-infra');
  }
}

interface StoreContextValue extends WorkspaceSnapshot {
  user: User | null;
  authReady: boolean;
  cloudConnected: boolean;
  cloudLoading: boolean;
  syncError: string | null;
  session: WorkspaceSession | null;
  loginWithCredentials: (
    role: AuthRole,
    identifier: string,
    secret: string
  ) => { ok: boolean; error?: string };
  logoutSession: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  seedCloudFromLocal: () => Promise<void>;
  resetDemoData: () => void;

  // Company Profile & Customizable Tile Areas
  updateCompanyProfile: (patch: Partial<CompanyProfile>) => Promise<void>;
  updateTileZoneCatalog: (catalog: TileZoneDefinition[]) => Promise<void>;
  addCustomZoneToFlat: (input: {
    flatId: string;
    label: string;
    category: TileZoneCategory;
    sqft: number;
  }) => Promise<void>;
  addCustomZoneToWholeFloor: (input: {
    towerId: string;
    floorNumber: number;
    label: string;
    category: TileZoneCategory;
    sqft: number;
    status?: ZoneStatus;
  }) => Promise<{ updatedCount: number }>;
  addCustomZonesToWholeFloor: (input: {
    towerId: string;
    floorNumber: number;
    items: WholeFloorCustomZoneItem[];
  }) => Promise<{ updatedCount: number; skippedAtLimitCount: number }>;
  upsertFloorCommonAreas: (input: {
    projectId: string;
    towerId: string;
    floorNumbers: number[];
    items: WholeFloorCustomZoneItem[];
  }) => Promise<{
    createdUnitsCount: number;
    updatedUnitsCount: number;
    addedZonesCount: number;
    skippedExistingCount: number;
    skippedAtLimitCount: number;
    firstCommonUnitId?: string;
  }>;
  renameFlatZone: (input: {
    flatId: string;
    zoneKey: TileZoneKey;
    label: string;
    category: TileZoneCategory;
  }) => Promise<void>;
  removeFlatZone: (flatId: string, zoneKey: TileZoneKey) => Promise<void>;

  // Project / Tower / Flat actions
  addProject: (input: {
    name: string;
    location: string;
    clientName: string;
    startDate?: string;
    finishDate?: string;
    managerName?: string;
    managerPhone?: string;
    engineerName?: string;
    engineerPhone?: string;
  }) => Promise<Project>;
  updateProject: (projectId: string, patch: Partial<Project>) => Promise<void>;
  addTowerWithUnits: (input: {
    projectId: string;
    name: string;
    startFloor: number;
    endFloor: number;
    unitsPerFloor: number;
    unitType: string;
    mixedSpecsPerFloor?: MixedBhkSpec[];
    commonAreaItems?: WholeFloorCustomZoneItem[];
    specialLevels?: ('basement_3' | 'basement_2' | 'basement_1' | 'ground' | 'podium')[];
    specialUnitsPerLevel?: number;
    startDate?: string;
    finishDate?: string;
    inchargeName?: string;
    inchargePhone?: string;
    supervisorName?: string;
    supervisorPhone?: string;
    engineerName?: string;
    engineerPhone?: string;
    managerName?: string;
    managerPhone?: string;
  }) => Promise<Tower>;
  updateTower: (towerId: string, patch: Partial<Tower>) => Promise<void>;
  addCustomFloorUnits: (input: {
    projectId: string;
    towerId: string;
    floorNumber: number;
    floorLabel?: string;
    unitsCount: number;
    unitType: string;
    customUnitNumbers?: string[];
    mixedSpecs?: MixedBhkSpec[];
    unitSpecs?: GeneratedFlatUnitSpec[];
    commonAreaItems?: WholeFloorCustomZoneItem[];
  }) => Promise<FlatUnit[]>;
  removeTower: (towerId: string) => Promise<void>;
  removeFlat: (flatId: string) => Promise<void>;
  updateFlatZone: (input: {
    flatId: string;
    zoneKey: TileZoneKey;
    status: ZoneStatus;
    sqft: number;
    assignedEmployeeId?: string | null;
    notes?: string;
    createHistoryRecord?: boolean;
  }) => Promise<void>;

  // Employee, Documents & Site Deployment actions
  addEmployee: (input: {
    fullName: string;
    role: EmployeeRole;
    phone: string;
    alternatePhone?: string;
    email?: string;
    joiningDate: string;
    dailyRate: number;
    overtimeRate: number;
    foodAllowanceDaily: number;
    aadharRef?: string;
    pfNumber?: string;
    esiNumber?: string;
    bloodGroup?: string;
    emergencyContact?: string;
    photoDataUrl?: string;
    currentProjectId?: string;
    currentTowerId?: string;
    notes?: string;
  }) => Promise<Employee>;
  updateEmployee: (employeeId: string, patch: Partial<Employee>) => Promise<void>;
  addEmployeeDocument: (input: {
    employeeId: string;
    docCategory: 'aadhar_pdf' | 'other';
    title: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    dataUrl: string;
  }) => Promise<EmployeeDocument>;
  deleteEmployeeDocument: (docId: string) => Promise<void>;
  deployEmployeeToSite: (input: {
    employeeId: string;
    projectId: string;
    towerId: string;
    assignedDate: string;
    notes?: string;
  }) => Promise<DeploymentRecord>;
  bulkAllocateEmployeesToTower: (input: {
    employeeIds: string[];
    projectId: string;
    towerId: string;
    assignedDate: string;
    notes?: string;
  }) => Promise<void>;
  ensureEmployeeQrPass: (employeeId: string) => Promise<{ qrToken: string; scanUrl: string }>;
  assignWorkToFlat: (input: {
    flatId: string;
    zoneKey: TileZoneKey;
    employeeId: string;
    assignedDate: string;
    targetSqft: number;
    status: AssignmentStatus;
    notes?: string;
    allowIncompleteOverride?: boolean;
  }) => Promise<WorkAssignment>;
  completeAssignment: (assignmentId: string, completedDate?: string) => Promise<void>;

  // Attendance, Advance, Site Expense & Settlement actions
  markAttendance: (input: {
    date: string;
    employeeId: string;
    projectId: string;
    towerId?: string;
    status: AttendanceStatus;
    overtimeHours: number;
    notes?: string;
  }) => Promise<void>;
  editLockedAttendance: (input: {
    date: string;
    employeeId: string;
    projectId: string;
    towerId?: string;
    status: AttendanceStatus;
    overtimeHours: number;
    notes?: string;
    editReason: string;
    adminPin?: string;
  }) => Promise<void>;
  bulkMarkAttendancePresent: (date: string, projectId: string, towerId?: string) => Promise<void>;
  deleteAttendanceRecord: (date: string, employeeId: string) => Promise<void>;
  addAdvance: (input: {
    date: string;
    employeeId: string;
    advanceType: AdvanceType;
    customCategory?: string;
    amount: number;
    paymentMode: PaymentMode;
    paymentApp?: string;
    transactionId?: string;
    upiId?: string;
    proofImageDataUrl?: string;
    projectId?: string;
    towerId?: string;
    isSundayRun?: boolean;
    notes?: string;
  }) => Promise<{ advance: AdvanceEntry; whatsappMessage: string; updatedNetBalance: number }>;
  bulkAddAdvances: (
    entries: Array<{
      date: string;
      employeeId: string;
      advanceType: AdvanceType;
      customCategory?: string;
      amount: number;
      paymentMode: PaymentMode;
      paymentApp?: string;
      transactionId?: string;
      upiId?: string;
      proofImageDataUrl?: string;
      projectId?: string;
      towerId?: string;
      notes?: string;
    }>
  ) => Promise<AdvanceEntry[]>;
  addSundayWeeklyFoodBatch: (input: {
    date: string;
    projectId?: string;
    towerId?: string;
    entries: { employeeId: string; amount: number }[];
    paymentMode: PaymentMode;
    notes?: string;
  }) => Promise<AdvanceEntry[]>;
  markAdvanceWhatsappShared: (advanceId: string) => Promise<void>;
  acknowledgeAdvance: (advanceId: string, acknowledgedBy?: string) => Promise<void>;
  recordAdvanceFollowUpSent: (advanceId: string) => Promise<void>;
  addExpense: (input: {
    date: string;
    projectId: string;
    towerId?: string;
    category: ExpenseCategory;
    customCategory?: string;
    description: string;
    vendorName?: string;
    amount: number;
    paymentMode: PaymentMode;
    paymentApp?: string;
    transactionId?: string;
    upiId?: string;
    proofImageDataUrl?: string;
    notes?: string;
  }) => Promise<SiteExpense>;
  deleteExpense: (expenseId: string) => Promise<void>;
  recordSettlement: (input: {
    employeeId: string;
    periodStart: string;
    periodEnd: string;
    paymentMode: PaymentMode;
    paymentApp?: string;
    transactionId?: string;
    upiId?: string;
    proofImageDataUrl?: string;
    notes?: string;
  }) => Promise<SettlementEntry>;
  deleteAdvance: (advanceId: string) => Promise<void>;
  addDailySiteLog: (input: {
    date: string;
    projectId: string;
    towerId: string;
    notes: string;
    photoDataUrl?: string;
  }) => Promise<DailySiteLog>;
  deleteDailySiteLog: (logId: string) => Promise<void>;

  // Quotations, Invoices & Tax Invoices
  addBillingDocument: (input: {
    docType: BillingDocType;
    docNumber?: string;
    issueDate: string;
    dueDate?: string;
    projectId?: string;
    towerId?: string;
    clientName: string;
    clientPhone?: string;
    clientEmail?: string;
    clientAddress?: string;
    clientGstin?: string;
    placeOfSupply?: string;
    taxMode: BillingTaxMode;
    items: Array<{
      id: string;
      description: string;
      hsnSac?: string;
      unit?: string;
      quantity: number;
      rate: number;
      gstRate: number;
    }>;
    amountPaid?: number;
    status?: BillingDocStatus;
    notes?: string;
    terms?: string;
  }) => Promise<BillingDocument>;
  updateBillingDocument: (
    docId: string,
    patch: Partial<{
      docType: BillingDocType;
      docNumber: string;
      issueDate: string;
      dueDate: string;
      projectId: string;
      towerId: string;
      clientName: string;
      clientPhone: string;
      clientEmail: string;
      clientAddress: string;
      clientGstin: string;
      placeOfSupply: string;
      taxMode: BillingTaxMode;
      items: Array<{
        id: string;
        description: string;
        hsnSac?: string;
        unit?: string;
        quantity: number;
        rate: number;
        gstRate: number;
      }>;
      amountPaid: number;
      status: BillingDocStatus;
      notes: string;
      terms: string;
      whatsappShared: boolean;
    }>
  ) => Promise<void>;
  convertBillingDocument: (
    sourceDocId: string,
    targetType: BillingDocType
  ) => Promise<BillingDocument>;
  deleteBillingDocument: (docId: string) => Promise<void>;

  // Documents Drive & Smart Document Generator Storage
  saveCompanyDocument: (input: {
    id?: string;
    source: CompanyDocumentSource;
    docCategory: CompanyDocumentCategory;
    fileFormat: CompanyDocumentFormat;
    title: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    approvalStatus?: CompanyDocumentApprovalStatus;
    approvedByName?: string;
    employeeId?: string;
    empCode?: string;
    employeeName?: string;
    refNumber?: string;
    issueDate: string;
    recipient?: string;
    subject?: string;
    bodyHtml?: string;
    plainTextSummary?: string;
    deckJson?: string;
    dataUrl?: string;
  }) => Promise<CompanyDocument>;
  approveCompanyDocument: (docId: string, approvedByName?: string) => Promise<void>;
  deleteCompanyDocument: (docId: string) => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(() => loadLocalWorkspace());
  const [session, setSession] = useState<WorkspaceSession | null>(() => loadInitialSession());

  const cloudConnected = Boolean(user && user.emailVerified);

  useEffect(() => {
    try {
      if (session) {
        sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
      } else {
        sessionStorage.removeItem(AUTH_SESSION_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, [session]);

  useEffect(() => {
    if (!cloudConnected) {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(workspace));
      } catch {
        // Ignore storage quota errors
      }
    }
  }, [workspace, cloudConnected]);

  useEffect(() => {
    testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setWorkspace(loadLocalWorkspace());
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) return;

    setCloudLoading(true);
    setSyncError(null);
    const uid = user.uid;

    const mapSnap = <T extends { id: string }>(
      docs: { id: string; data: () => Record<string, unknown> }[]
    ): T[] =>
      docs.map((d) => {
        const raw = d.data();
        return {
          ...raw,
          id: d.id,
          createdAt: toIsoString(raw.createdAt),
          updatedAt: toIsoString(raw.updatedAt),
        } as unknown as T;
      });

    const unsubs: (() => void)[] = [];
    const loadedFlags = {
      company_profiles: false,
      projects: false,
      towers: false,
      flats: false,
      employees: false,
      employee_docs: false,
      deployments: false,
      assignments: false,
      attendance: false,
      advances: false,
      expenses: false,
      settlements: false,
      site_logs: false,
      billing_docs: false,
      company_documents: false,
    };

    const markLoaded = (key: keyof typeof loadedFlags) => {
      loadedFlags[key] = true;
      if (Object.values(loadedFlags).every(Boolean)) {
        setCloudLoading(false);
      }
    };

    const attachCollection = <T extends { id: string }>(
      colName: keyof typeof loadedFlags,
      stateKey: keyof WorkspaceSnapshot
    ) => {
      const q = query(collection(db, colName), where('ownerId', '==', uid));
      const unsub = onSnapshot(
        q,
        (snapshot) => {
          const items = mapSnap<T>(snapshot.docs);
          setWorkspace((prev) => ({
            ...prev,
            [stateKey]: items,
          }));
          markLoaded(colName);
        },
        (err) => {
          setSyncError(err.message);
          setCloudLoading(false);
          handleFirestoreError(err, OperationType.GET, colName);
        }
      );
      unsubs.push(unsub);
    };

    const profileQ = query(collection(db, 'company_profiles'), where('ownerId', '==', uid));
    unsubs.push(
      onSnapshot(
        profileQ,
        (snapshot) => {
          const profiles = mapSnap<CompanyProfile>(snapshot.docs);
          if (profiles[0]) {
            setWorkspace((prev) => ({
              ...prev,
              companyProfile: {
                ...createDefaultCompanyProfile(uid),
                ...profiles[0],
                requireFinishBeforeNewWork:
                  profiles[0].requireFinishBeforeNewWork !== false,
                tileZoneCatalog:
                  profiles[0].tileZoneCatalog && profiles[0].tileZoneCatalog.length > 0
                    ? profiles[0].tileZoneCatalog
                    : TILE_ZONES.map((z) => ({ ...z })),
              },
            }));
          } else {
            setWorkspace((prev) => ({
              ...prev,
              companyProfile: createDefaultCompanyProfile(uid),
            }));
          }
          markLoaded('company_profiles');
        },
        (err) => {
          setSyncError(err.message);
          setCloudLoading(false);
          handleFirestoreError(err, OperationType.GET, 'company_profiles');
        }
      )
    );

    attachCollection<Project>('projects', 'projects');
    attachCollection<Tower>('towers', 'towers');
    attachCollection<FlatUnit>('flats', 'flats');
    attachCollection<Employee>('employees', 'employees');
    attachCollection<EmployeeDocument>('employee_docs', 'employeeDocuments');
    attachCollection<DeploymentRecord>('deployments', 'deployments');
    attachCollection<WorkAssignment>('assignments', 'assignments');
    attachCollection<AttendanceRecord>('attendance', 'attendance');
    attachCollection<AdvanceEntry>('advances', 'advances');
    attachCollection<SiteExpense>('expenses', 'expenses');
    attachCollection<SettlementEntry>('settlements', 'settlements');
    attachCollection<DailySiteLog>('site_logs', 'dailySiteLogs');
    attachCollection<BillingDocument>('billing_docs', 'billingDocuments');
    attachCollection<CompanyDocument>('company_documents', 'companyDocuments');

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [authReady, user]);

  const loginWithCredentials = useCallback(
    (role: AuthRole, identifier: string, secret: string) => {
      const res = authenticateWorkspaceUser({
        role,
        identifier,
        secret,
        companyProfile: workspace.companyProfile,
        employees: workspace.employees,
        towers: workspace.towers,
      });
      if (res.ok) {
        setSession(res.session);
        return { ok: true };
      }
      return { ok: false, error: res.error };
    },
    [workspace.companyProfile, workspace.employees, workspace.towers]
  );

  const logoutSession = useCallback(async () => {
    setSession(null);
    try {
      sessionStorage.removeItem(AUTH_SESSION_KEY);
    } catch {
      // Ignore
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setSyncError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      setSyncError(msg);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(auth);
  }, []);

  const ownerUid = cloudConnected && user ? user.uid : 'local-avy-infra';

  const seedCloudFromLocal = useCallback(async () => {
    if (!user || !user.emailVerified) return;
    setCloudLoading(true);
    setSyncError(null);
    const uid = user.uid;
    const rawLocal = loadLocalWorkspace();
    const sourceWorkspace =
      rawLocal.projects && rawLocal.projects.length > 0
        ? rawLocal
        : createSeedWorkspace(uid);

    const payload = buildNamespacedCloudSeedPayload(uid, sourceWorkspace, {
      adminUsername: DEFAULT_ADMIN_USERNAME,
      adminPassword: DEFAULT_ADMIN_PASSWORD,
      adminEditPin: DEFAULT_ADMIN_EDIT_PIN,
      userPin: DEFAULT_USER_PIN,
    });

    const fetchExistingOwnerIds = async (colName: string): Promise<Set<string>> => {
      const snap = await getDocs(
        query(collection(db, colName), where('ownerId', '==', uid))
      );
      return new Set(snap.docs.map((d) => d.id));
    };

    const seedCollection = async (
      colName: string,
      items: Array<{ id: string; data: Record<string, unknown> }>
    ) => {
      if (items.length === 0) return;
      const existingIds = await fetchExistingOwnerIds(colName);
      for (const item of items) {
        if (existingIds.has(item.id)) continue;
        await setDoc(doc(db, colName, item.id), {
          ...item.data,
          ...tsCreate(),
        });
      }
    };

    try {
      const existingProfilesSnap = await getDocs(
        query(collection(db, 'company_profiles'), where('ownerId', '==', uid))
      );
      if (!existingProfilesSnap.empty) {
        await updateDoc(existingProfilesSnap.docs[0].ref, {
          ...payload.companyProfile.mutable,
          ...tsUpdate(),
        });
      } else {
        const cpRef = doc(db, 'company_profiles', payload.companyProfile.docId);
        await setDoc(cpRef, {
          ownerId: uid,
          ...payload.companyProfile.mutable,
          ...tsCreate(),
        });
      }

      // Parent collections must be committed first because Firestore rules verify ownsDoc()
      await seedCollection('projects', payload.projects);
      await seedCollection('employees', payload.employees);
      await seedCollection('towers', payload.towers);
      await seedCollection('flats', payload.flats);

      // Dependent collections
      await seedCollection('employee_docs', payload.employeeDocuments);
      await seedCollection('deployments', payload.deployments);
      await seedCollection('assignments', payload.assignments);
      await seedCollection('attendance', payload.attendance);
      await seedCollection('advances', payload.advances);
      await seedCollection('expenses', payload.expenses);
      await seedCollection('settlements', payload.settlements);
      await seedCollection('site_logs', payload.dailySiteLogs);
      await seedCollection('billing_docs', payload.billingDocuments);
      await seedCollection('company_documents', payload.companyDocuments);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Cloud sync failed');
      handleFirestoreError(err, OperationType.WRITE, 'seedCloudFromLocal');
    } finally {
      setCloudLoading(false);
    }
  }, [user]);

  const upsertCloudQrPass = useCallback(
    async (
      emp: Employee,
      token: string,
      overrides?: {
        deployments?: DeploymentRecord[];
        assignments?: WorkAssignment[];
        attendance?: AttendanceRecord[];
      }
    ) => {
      if (!cloudConnected || !token || token.length < 16) return;
      const passData = buildEmployeeQrPassData({
        employee: { ...emp, qrToken: token },
        companyName: workspace.companyProfile?.companyName || 'AVY INFRA',
        projects: workspace.projects,
        towers: workspace.towers,
        deployments: overrides?.deployments || workspace.deployments,
        assignments: overrides?.assignments || workspace.assignments,
        attendance: overrides?.attendance || workspace.attendance,
      });
      try {
        const existingSnap = await getDocs(
          query(collection(db, 'qr_passes'), where('ownerId', '==', ownerUid))
        );
        const existingDoc = existingSnap.docs.find((d) => d.id === token);
        if (existingDoc) {
          await updateDoc(existingDoc.ref, {
            empCode: passData.empCode,
            fullName: passData.fullName,
            role: passData.role,
            status: passData.status,
            companyName: passData.companyName,
            joiningDate: passData.joiningDate,
            currentProjectName: passData.currentProjectName,
            currentTowerName: passData.currentTowerName,
            deployedSince: passData.deployedSince,
            todayAttendanceStatus: passData.todayAttendanceStatus,
            todayAttendanceDate: passData.todayAttendanceDate,
            completedZonesCount: passData.completedZonesCount,
            activeAssignments: passData.activeAssignments,
            recentDeployments: passData.recentDeployments,
            ...tsUpdate(),
          });
        } else {
          await setDoc(doc(db, 'qr_passes', token), {
            ownerId: ownerUid,
            ...passData,
            ...tsCreate(),
          });
        }
      } catch {
        // Non-blocking: URL fallback still works if rules or offline limit hit
      }
    },
    [
      cloudConnected,
      ownerUid,
      workspace.companyProfile,
      workspace.projects,
      workspace.towers,
      workspace.deployments,
      workspace.assignments,
      workspace.attendance,
    ]
  );

  const ensureEmployeeQrPass = useCallback(
    async (employeeId: string): Promise<{ qrToken: string; scanUrl: string }> => {
      const emp = workspace.employees.find((e) => e.id === employeeId);
      if (!emp) {
        return { qrToken: '', scanUrl: typeof window !== 'undefined' ? window.location.origin : '' };
      }

      const token = emp.qrToken && emp.qrToken.length >= 16 ? emp.qrToken : generateQrPassToken();
      if (!emp.qrToken || emp.qrToken.length < 16) {
        if (cloudConnected) {
          try {
            await updateDoc(doc(db, 'employees', emp.id), {
              qrToken: token,
              ...tsUpdate(),
            });
          } catch {
            // Keep token for local URL generation even if offline
          }
        } else {
          const nowIso = new Date().toISOString();
          setWorkspace((prev) => ({
            ...prev,
            employees: prev.employees.map((item) =>
              item.id === emp.id ? { ...item, qrToken: token, updatedAt: nowIso } : item
            ),
          }));
        }
      }

      const nextEmp: Employee = { ...emp, qrToken: token };
      if (cloudConnected) {
        await upsertCloudQrPass(nextEmp, token);
      }

      const passData = buildEmployeeQrPassData({
        employee: nextEmp,
        companyName: workspace.companyProfile?.companyName || 'AVY INFRA',
        projects: workspace.projects,
        towers: workspace.towers,
        deployments: workspace.deployments,
        assignments: workspace.assignments,
        attendance: workspace.attendance,
      });

      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return {
        qrToken: token,
        scanUrl: buildEmployeeQrScanUrl({ origin, passData, qrToken: token }),
      };
    },
    [
      cloudConnected,
      upsertCloudQrPass,
      workspace.employees,
      workspace.companyProfile,
      workspace.projects,
      workspace.towers,
      workspace.deployments,
      workspace.assignments,
      workspace.attendance,
    ]
  );

  const resetDemoData = useCallback(() => {
    const fresh = createSeedWorkspace('local-avy-infra');
    setWorkspace(fresh);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(fresh));
  }, []);

  // --- Company Profile & Custom Tile Areas ---
  const saveCompanyProfileToBackend = useCallback(
    async (nextProfile: CompanyProfile) => {
      const guaranteedCatalog =
        nextProfile.tileZoneCatalog && nextProfile.tileZoneCatalog.length > 0
          ? nextProfile.tileZoneCatalog
          : TILE_ZONES.map((z) => ({ ...z }));

      const cleanMutable = stripUndefinedDeep({
        companyName: clampString(nextProfile.companyName || 'AVY INFRA', 120) || 'AVY INFRA',
        tagline: clampString(nextProfile.tagline, 160),
        address: clampString(nextProfile.address, 300),
        hrContact: clampString(nextProfile.hrContact, 40),
        hrEmail: clampString(nextProfile.hrEmail, 120),
        gstNumber: clampString(nextProfile.gstNumber, 40),
        pfEstCode: clampString(nextProfile.pfEstCode, 60),
        esiCode: clampString(nextProfile.esiCode, 60),
        signatoryName: clampString(nextProfile.signatoryName, 100),
        logoDataUrl: (nextProfile.logoDataUrl || '').slice(0, 120000),
        requireFinishBeforeNewWork: nextProfile.requireFinishBeforeNewWork !== false,
        adminUsername: clampString(nextProfile.adminUsername || DEFAULT_ADMIN_USERNAME, 60),
        adminPassword: clampString(nextProfile.adminPassword || DEFAULT_ADMIN_PASSWORD, 80),
        adminEditPin: clampString(nextProfile.adminEditPin || DEFAULT_ADMIN_EDIT_PIN, 24),
        supervisorCanEditAttendance: Boolean(nextProfile.supervisorCanEditAttendance),
        customAdvanceCategories: Array.isArray(nextProfile.customAdvanceCategories)
          ? nextProfile.customAdvanceCategories
              .map((c) => clampString(c, 60))
              .filter(Boolean)
              .slice(0, 30)
          : [],
        customExpenseCategories: Array.isArray(nextProfile.customExpenseCategories)
          ? nextProfile.customExpenseCategories
              .map((c) => clampString(c, 60))
              .filter(Boolean)
              .slice(0, 30)
          : [],
        weeklyExpenseBudget:
          typeof nextProfile.weeklyExpenseBudget === 'number' &&
          Number.isFinite(nextProfile.weeklyExpenseBudget)
            ? Math.max(0, Math.min(100000000, Math.round(nextProfile.weeklyExpenseBudget)))
            : DEFAULT_WEEKLY_EXPENSE_BUDGET,
        idCardFrontBgDataUrl: (nextProfile.idCardFrontBgDataUrl || '').slice(0, 120000),
        idCardBackBgDataUrl: (nextProfile.idCardBackBgDataUrl || '').slice(0, 120000),
        idCardBgColor: clampString(nextProfile.idCardBgColor || '#ffffff', 24),
        idCardHeaderColor: clampString(nextProfile.idCardHeaderColor || '#0f172a', 24),
        idCardAccentColor: clampString(nextProfile.idCardAccentColor || '#c2410c', 24),
        idCardTextColor: clampString(nextProfile.idCardTextColor || '#0f172a', 24),
        idCardBgOpacity:
          typeof nextProfile.idCardBgOpacity === 'number' &&
          Number.isFinite(nextProfile.idCardBgOpacity)
            ? Math.max(0, Math.min(1, nextProfile.idCardBgOpacity))
            : 0.22,
        tileZoneCatalog: stripUndefinedDeep(guaranteedCatalog).slice(0, 40),
      });

      const resolvedProfile: CompanyProfile = {
        ...nextProfile,
        ...cleanMutable,
        ownerId: ownerUid,
      };

      if (cloudConnected) {
        const docId = sanitizeId(
          nextProfile.id && nextProfile.id !== `company_local-avy-infra`
            ? nextProfile.id
            : `company_${ownerUid}`
        );
        const docRef = doc(db, 'company_profiles', docId);
        try {
          const existingSnap = await getDocs(
            query(collection(db, 'company_profiles'), where('ownerId', '==', ownerUid))
          );
          if (!existingSnap.empty) {
            const targetDoc = existingSnap.docs[0];
            await updateDoc(targetDoc.ref, {
              ...cleanMutable,
              ...tsUpdate(),
            });
            setWorkspace((prev) => ({
              ...prev,
              companyProfile: { ...resolvedProfile, id: targetDoc.id },
            }));
          } else {
            await setDoc(docRef, {
              ownerId: ownerUid,
              ...cleanMutable,
              ...tsCreate(),
            });
            setWorkspace((prev) => ({
              ...prev,
              companyProfile: { ...resolvedProfile, id: docId },
            }));
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `company_profiles/${docId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          companyProfile: resolvedProfile,
        }));
      }
    },
    [cloudConnected, ownerUid]
  );

  const updateCompanyProfile = useCallback(
    async (patch: Partial<CompanyProfile>): Promise<void> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can modify company or access settings.');
      }
      const nowIso = new Date().toISOString();
      const nextProfile: CompanyProfile = {
        ...workspace.companyProfile,
        ...patch,
        ownerId: ownerUid,
        updatedAt: nowIso,
      };
      await saveCompanyProfileToBackend(nextProfile);
    },
    [workspace.companyProfile, ownerUid, saveCompanyProfileToBackend, session]
  );

  const updateTileZoneCatalog = useCallback(
    async (catalog: TileZoneDefinition[]): Promise<void> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can customize default tile areas.');
      }
      const nowIso = new Date().toISOString();
      const cleanCatalog = (catalog.length > 0 ? catalog : TILE_ZONES).slice(0, 40).map((item) => ({
        key: item.key,
        label: clampString(item.label, 80) || 'Tile Area',
        category: item.category,
        defaultSqft: Math.max(0, Number(item.defaultSqft) || 0),
        isDefault: Boolean(item.isDefault),
      }));
      const nextProfile: CompanyProfile = {
        ...workspace.companyProfile,
        tileZoneCatalog: cleanCatalog,
        ownerId: ownerUid,
        updatedAt: nowIso,
      };
      await saveCompanyProfileToBackend(nextProfile);
    },
    [workspace.companyProfile, ownerUid, saveCompanyProfileToBackend, session]
  );

  const addCustomZoneToFlat = useCallback(
    async (input: {
      flatId: string;
      label: string;
      category: TileZoneCategory;
      sqft: number;
    }): Promise<void> => {
      const flat = workspace.flats.find((f) => f.id === input.flatId);
      if (!flat) return;
      const baseKey = slugifyZoneKey(input.label);
      let zoneKey = baseKey;
      let n = 2;
      while (flat.zones[zoneKey]) {
        zoneKey = `${baseKey}_${n++}`;
      }
      const nowIso = new Date().toISOString();
      const updatedZones = stripUndefinedDeep({
        ...flat.zones,
        [zoneKey]: {
          status: 'not_started' as ZoneStatus,
          sqft: Math.max(0, Number(input.sqft) || 0),
          label: clampString(input.label, 80),
          category: input.category,
          updatedDate: getTodayIso(),
        },
      });

      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'flats', flat.id), {
            zones: updatedZones,
            ...tsUpdate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `flats/${flat.id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          flats: prev.flats.map((f) =>
            f.id === flat.id ? { ...f, zones: updatedZones, updatedAt: nowIso } : f
          ),
        }));
      }
    },
    [cloudConnected, workspace.flats]
  );

  const addCustomZonesToWholeFloor = useCallback(
    async (input: {
      towerId: string;
      floorNumber: number;
      items: WholeFloorCustomZoneItem[];
    }): Promise<{ updatedCount: number; skippedAtLimitCount: number }> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can add custom tile areas across a whole floor.');
      }
      const nowIso = new Date().toISOString();
      const res = addCustomZonesToFlatsBatch({
        flats: workspace.flats,
        towerId: input.towerId,
        floorNumber: input.floorNumber,
        items: input.items.map((it) => ({
          label: clampString(it.label, 80),
          category: it.category,
          sqft: it.sqft,
          status: it.status,
        })),
        updatedDate: getTodayIso(),
        nowIso,
      });

      if (res.modifiedCount === 0) {
        return { updatedCount: 0, skippedAtLimitCount: res.skippedAtLimitCount };
      }

      if (cloudConnected) {
        const modifiedSet = new Set(res.modifiedFlatIds);
        const modifiedFlats = res.updatedFlats.filter((f) => modifiedSet.has(f.id));
        try {
          for (let i = 0; i < modifiedFlats.length; i += 400) {
            const batch = writeBatch(db);
            const slice = modifiedFlats.slice(i, i + 400);
            for (const fl of slice) {
              batch.update(doc(db, 'flats', fl.id), {
                zones: stripUndefinedDeep(fl.zones),
                ...tsUpdate(),
              });
            }
            await batch.commit();
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `flats/floor_${input.floorNumber}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          flats: res.updatedFlats,
        }));
      }

      return {
        updatedCount: res.modifiedCount,
        skippedAtLimitCount: res.skippedAtLimitCount,
      };
    },
    [cloudConnected, workspace.flats, session]
  );

  const addCustomZoneToWholeFloor = useCallback(
    async (input: {
      towerId: string;
      floorNumber: number;
      label: string;
      category: TileZoneCategory;
      sqft: number;
      status?: ZoneStatus;
    }): Promise<{ updatedCount: number }> => {
      const res = await addCustomZonesToWholeFloor({
        towerId: input.towerId,
        floorNumber: input.floorNumber,
        items: [
          {
            label: input.label,
            category: input.category,
            sqft: input.sqft,
            status: input.status,
          },
        ],
      });
      return { updatedCount: res.updatedCount };
    },
    [addCustomZonesToWholeFloor]
  );

  const upsertFloorCommonAreas = useCallback(
    async (input: {
      projectId: string;
      towerId: string;
      floorNumbers: number[];
      items: WholeFloorCustomZoneItem[];
    }): Promise<{
      createdUnitsCount: number;
      updatedUnitsCount: number;
      addedZonesCount: number;
      skippedExistingCount: number;
      skippedAtLimitCount: number;
      firstCommonUnitId?: string;
    }> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can configure whole-floor common areas.');
      }
      const nowIso = new Date().toISOString();
      const today = getTodayIso();
      const floorLabelsByNumber: Record<number, string> = {};
      for (const fl of workspace.flats) {
        if (fl.towerId === input.towerId && fl.floorLabel && !floorLabelsByNumber[fl.floorNumber]) {
          floorLabelsByNumber[fl.floorNumber] = fl.floorLabel;
        }
      }

      const res = upsertFloorCommonUnitsBatch({
        existingFlats: workspace.flats,
        ownerId: ownerUid,
        projectId: input.projectId,
        towerId: input.towerId,
        floorNumbers: input.floorNumbers,
        floorLabelsByNumber,
        items: input.items.map((it) => ({
          label: clampString(it.label, 80),
          category: it.category,
          sqft: it.sqft,
          status: it.status,
        })),
        updatedDate: today,
        nowIso,
        makeFlatId: (twrId, _flNum, unitNum) =>
          sanitizeId(`flat_${twrId}_${unitNum.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now().toString(36)}`),
      });

      if (res.createdUnits.length === 0 && res.updatedUnits.length === 0) {
        return {
          createdUnitsCount: 0,
          updatedUnitsCount: 0,
          addedZonesCount: 0,
          skippedExistingCount: res.skippedExistingCount,
          skippedAtLimitCount: res.skippedAtLimitCount,
        };
      }

      if (cloudConnected) {
        try {
          for (let i = 0; i < res.createdUnits.length; i += 400) {
            const batch = writeBatch(db);
            for (const flat of res.createdUnits.slice(i, i + 400)) {
              batch.set(doc(db, 'flats', flat.id), {
                ownerId: ownerUid,
                projectId: flat.projectId,
                towerId: flat.towerId,
                floorNumber: flat.floorNumber,
                floorLabel: flat.floorLabel || formatFloorLabel(flat.floorNumber),
                unitNumber: flat.unitNumber,
                unitType: flat.unitType,
                zones: stripUndefinedDeep(flat.zones),
                ...tsCreate(),
              });
            }
            await batch.commit();
          }
          for (let i = 0; i < res.updatedUnits.length; i += 400) {
            const batch = writeBatch(db);
            for (const flat of res.updatedUnits.slice(i, i + 400)) {
              batch.update(doc(db, 'flats', flat.id), {
                zones: stripUndefinedDeep(flat.zones),
                ...tsUpdate(),
              });
            }
            await batch.commit();
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `flats/common_${input.towerId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          flats: res.nextFlats,
        }));
      }

      return {
        createdUnitsCount: res.createdUnits.length,
        updatedUnitsCount: res.updatedUnits.length,
        addedZonesCount: res.addedZonesCount,
        skippedExistingCount: res.skippedExistingCount,
        skippedAtLimitCount: res.skippedAtLimitCount,
        firstCommonUnitId: res.createdUnits[0]?.id || res.updatedUnits[0]?.id,
      };
    },
    [cloudConnected, ownerUid, session, workspace.flats]
  );

  const renameFlatZone = useCallback(
    async (input: {
      flatId: string;
      zoneKey: TileZoneKey;
      label: string;
      category: TileZoneCategory;
    }): Promise<void> => {
      const flat = workspace.flats.find((f) => f.id === input.flatId);
      if (!flat) return;
      const nowIso = new Date().toISOString();
      const prevZone = flat.zones[input.zoneKey] || {
        status: 'not_started' as ZoneStatus,
        sqft: 100,
      };
      const updatedZones = stripUndefinedDeep({
        ...flat.zones,
        [input.zoneKey]: {
          ...prevZone,
          label: clampString(input.label, 80),
          category: input.category,
        },
      });

      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'flats', flat.id), {
            zones: updatedZones,
            ...tsUpdate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `flats/${flat.id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          flats: prev.flats.map((f) =>
            f.id === flat.id ? { ...f, zones: updatedZones, updatedAt: nowIso } : f
          ),
        }));
      }
    },
    [cloudConnected, workspace.flats]
  );

  const removeFlatZone = useCallback(
    async (flatId: string, zoneKey: TileZoneKey): Promise<void> => {
      const flat = workspace.flats.find((f) => f.id === flatId);
      if (!flat) return;
      const nowIso = new Date().toISOString();
      const rest = { ...flat.zones };
      delete rest[zoneKey];
      const updatedZones = stripUndefinedDeep(rest);

      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'flats', flat.id), {
            zones: updatedZones,
            ...tsUpdate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `flats/${flat.id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          flats: prev.flats.map((f) =>
            f.id === flat.id ? { ...f, zones: updatedZones, updatedAt: nowIso } : f
          ),
        }));
      }
    },
    [cloudConnected, workspace.flats]
  );

  // --- Projects / Towers / Flats ---
  const addProject = useCallback(
    async (input: {
      name: string;
      location: string;
      clientName: string;
      startDate?: string;
      finishDate?: string;
      managerName?: string;
      managerPhone?: string;
      engineerName?: string;
      engineerPhone?: string;
    }): Promise<Project> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can add projects.');
      }
      const nowIso = new Date().toISOString();
      const id = sanitizeId(`proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const project: Project = {
        id,
        ownerId: ownerUid,
        name: clampString(input.name, 120),
        location: clampString(input.location, 160),
        clientName: clampString(input.clientName, 120),
        status: 'active',
        startDate: clampString(input.startDate || getTodayIso(), 24),
        finishDate: clampString(input.finishDate, 24),
        managerName: clampString(input.managerName, 100),
        managerPhone: clampString(input.managerPhone, 24),
        engineerName: clampString(input.engineerName, 100),
        engineerPhone: clampString(input.engineerPhone, 24),
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          await setDoc(doc(db, 'projects', id), {
            ownerId: ownerUid,
            name: project.name,
            location: project.location,
            clientName: project.clientName,
            status: project.status,
            startDate: project.startDate,
            finishDate: project.finishDate,
            managerName: project.managerName,
            managerPhone: project.managerPhone,
            engineerName: project.engineerName,
            engineerPhone: project.engineerPhone,
            ...tsCreate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `projects/${id}`);
        }
      } else {
        setWorkspace((prev) => ({ ...prev, projects: [project, ...prev.projects] }));
      }
      return project;
    },
    [ownerUid, cloudConnected, session]
  );

  const updateProject = useCallback(
    async (projectId: string, patch: Partial<Project>): Promise<void> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can edit projects.');
      }
      const existing = workspace.projects.find((p) => p.id === projectId);
      if (!existing) return;
      const nowIso = new Date().toISOString();
      const merged: Project = {
        ...existing,
        ...patch,
        name: clampString(patch.name ?? existing.name, 120) || existing.name,
        location: clampString(patch.location ?? existing.location, 160),
        clientName: clampString(patch.clientName ?? existing.clientName, 120),
        status: patch.status ?? existing.status,
        startDate: clampString(patch.startDate ?? existing.startDate, 24),
        finishDate: clampString(patch.finishDate ?? existing.finishDate, 24),
        managerName: clampString(patch.managerName ?? existing.managerName, 100),
        managerPhone: clampString(patch.managerPhone ?? existing.managerPhone, 24),
        engineerName: clampString(patch.engineerName ?? existing.engineerName, 100),
        engineerPhone: clampString(patch.engineerPhone ?? existing.engineerPhone, 24),
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'projects', projectId), {
            name: merged.name,
            location: merged.location,
            clientName: merged.clientName,
            status: merged.status,
            startDate: merged.startDate || '',
            finishDate: merged.finishDate || '',
            managerName: merged.managerName || '',
            managerPhone: merged.managerPhone || '',
            engineerName: merged.engineerName || '',
            engineerPhone: merged.engineerPhone || '',
            ...tsUpdate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          projects: prev.projects.map((p) => (p.id === projectId ? merged : p)),
        }));
      }
    },
    [cloudConnected, workspace.projects]
  );

  const addTowerWithUnits = useCallback(
    async (input: {
      projectId: string;
      name: string;
      startFloor: number;
      endFloor: number;
      unitsPerFloor: number;
      unitType: string;
      mixedSpecsPerFloor?: MixedBhkSpec[];
      commonAreaItems?: WholeFloorCustomZoneItem[];
      specialLevels?: ('basement_3' | 'basement_2' | 'basement_1' | 'ground' | 'podium')[];
      specialUnitsPerLevel?: number;
      startDate?: string;
      finishDate?: string;
      inchargeName?: string;
      inchargePhone?: string;
      supervisorName?: string;
      supervisorPhone?: string;
      engineerName?: string;
      engineerPhone?: string;
      managerName?: string;
      managerPhone?: string;
    }): Promise<Tower> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can add towers.');
      }
      const nowIso = new Date().toISOString();
      const towerId = sanitizeId(`twr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const startFloor = Math.max(0, Math.min(150, input.startFloor));
      const endFloor = Math.max(startFloor, Math.min(150, input.endFloor));
      const cleanMixedSpecs = (input.mixedSpecsPerFloor || []).filter(
        (s) => (s.unitType || '').trim() && (Number(s.count) || 0) > 0
      );
      const mixedTotal = cleanMixedSpecs.reduce(
        (sum, s) => sum + Math.max(0, Math.floor(Number(s.count) || 0)),
        0
      );
      const unitsPerFloor =
        mixedTotal > 0
          ? Math.max(1, Math.min(50, mixedTotal))
          : Math.max(1, Math.min(20, input.unitsPerFloor));
      const specialCount = Math.max(1, Math.min(20, input.specialUnitsPerLevel || unitsPerFloor));
      const specialLevels = input.specialLevels || [];
      const totalFloors = Math.max(1, endFloor - startFloor + 1 + specialLevels.length);

      const catalog = workspace.companyProfile?.tileZoneCatalog || TILE_ZONES;

      const tower: Tower = {
        id: towerId,
        ownerId: ownerUid,
        projectId: input.projectId,
        name: clampString(input.name, 80),
        totalFloors,
        unitsPerFloor,
        startDate: clampString(input.startDate || getTodayIso(), 24),
        finishDate: clampString(input.finishDate, 24),
        inchargeName: clampString(input.inchargeName, 100),
        inchargePhone: clampString(input.inchargePhone, 24),
        supervisorName: clampString(input.supervisorName, 100),
        supervisorPhone: clampString(input.supervisorPhone, 24),
        engineerName: clampString(input.engineerName, 100),
        engineerPhone: clampString(input.engineerPhone, 24),
        managerName: clampString(input.managerName, 100),
        managerPhone: clampString(input.managerPhone, 24),
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const newFlats: FlatUnit[] = [];

      for (const lvlId of specialLevels) {
        const preset = SPECIAL_FLOOR_PRESETS.find((p) => p.id === lvlId);
        if (!preset) continue;
        const unitNums = generateUnitNumbersForFloor(preset.floorNumber, specialCount, preset.unitPrefix);
        for (const unitNum of unitNums) {
          const flatId = sanitizeId(`flat_${towerId}_${unitNum.replace(/[^a-zA-Z0-9]/g, '_')}`);
          newFlats.push({
            id: flatId,
            ownerId: ownerUid,
            projectId: input.projectId,
            towerId,
            floorNumber: preset.floorNumber,
            floorLabel: preset.label,
            unitNumber: unitNum,
            unitType: clampString(preset.defaultUnitType, 40),
            zones: createDefaultZones(undefined, catalog),
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
      }

      for (let f = startFloor; f <= endFloor; f++) {
        if (f === 0 && specialLevels.includes('ground')) continue;
        const unitSpecs: GeneratedFlatUnitSpec[] =
          cleanMixedSpecs.length > 0
            ? buildMixedBhkFloorUnits({ floorNumber: f, mixedSpecs: cleanMixedSpecs })
            : generateUnitNumbersForFloor(f, unitsPerFloor).map((unitNum) => ({
                unitNumber: unitNum,
                unitType: input.unitType || '3 BHK',
              }));

        for (const spec of unitSpecs) {
          const flatId = sanitizeId(`flat_${towerId}_${spec.unitNumber.replace(/[^a-zA-Z0-9]/g, '_')}`);
          newFlats.push({
            id: flatId,
            ownerId: ownerUid,
            projectId: input.projectId,
            towerId,
            floorNumber: f,
            floorLabel: formatFloorLabel(f),
            unitNumber: spec.unitNumber,
            unitType: clampString(spec.unitType || '3 BHK', 40),
            zones: createDefaultZones(undefined, catalog),
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
      }

      if (input.commonAreaItems && input.commonAreaItems.length > 0) {
        const floorNumsForCommon = Array.from(new Set(newFlats.map((f) => f.floorNumber))).sort(
          (a, b) => a - b
        );
        const floorLabelsMap: Record<number, string> = {};
        for (const f of newFlats) {
          if (f.floorLabel && !floorLabelsMap[f.floorNumber]) {
            floorLabelsMap[f.floorNumber] = f.floorLabel;
          }
        }
        const commonRes = upsertFloorCommonUnitsBatch({
          existingFlats: [],
          ownerId: ownerUid,
          projectId: input.projectId,
          towerId,
          floorNumbers: floorNumsForCommon,
          floorLabelsByNumber: floorLabelsMap,
          items: input.commonAreaItems.map((it) => ({
            label: clampString(it.label, 80),
            category: it.category,
            sqft: it.sqft,
            status: it.status,
          })),
          updatedDate: getTodayIso(),
          nowIso,
          makeFlatId: (twrId, _flNum, unitNum) =>
            sanitizeId(`flat_${twrId}_${unitNum.replace(/[^a-zA-Z0-9]/g, '_')}`),
        });
        newFlats.push(...commonRes.createdUnits);
      }

      if (cloudConnected) {
        try {
          await setDoc(doc(db, 'towers', towerId), {
            ownerId: ownerUid,
            projectId: input.projectId,
            name: tower.name,
            totalFloors: tower.totalFloors,
            unitsPerFloor: tower.unitsPerFloor,
            startDate: tower.startDate,
            finishDate: tower.finishDate,
            inchargeName: tower.inchargeName,
            inchargePhone: tower.inchargePhone,
            supervisorName: tower.supervisorName,
            supervisorPhone: tower.supervisorPhone,
            engineerName: tower.engineerName,
            engineerPhone: tower.engineerPhone,
            managerName: tower.managerName,
            managerPhone: tower.managerPhone,
            ...tsCreate(),
          });
          for (let i = 0; i < newFlats.length; i += 400) {
            const batch = writeBatch(db);
            for (const flat of newFlats.slice(i, i + 400)) {
              batch.set(doc(db, 'flats', flat.id), {
                ownerId: ownerUid,
                projectId: flat.projectId,
                towerId: flat.towerId,
                floorNumber: flat.floorNumber,
                floorLabel: flat.floorLabel || formatFloorLabel(flat.floorNumber),
                unitNumber: flat.unitNumber,
                unitType: flat.unitType,
                zones: stripUndefinedDeep(flat.zones),
                ...tsCreate(),
              });
            }
            await batch.commit();
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `towers/${towerId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          towers: [...prev.towers, tower],
          flats: [...prev.flats, ...newFlats],
        }));
      }
      return tower;
    },
    [ownerUid, cloudConnected, workspace.companyProfile, session]
  );

  const updateTower = useCallback(
    async (towerId: string, patch: Partial<Tower>): Promise<void> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can edit tower settings.');
      }
      const existing = workspace.towers.find((t) => t.id === towerId);
      if (!existing) return;
      const nowIso = new Date().toISOString();
      const merged: Tower = {
        ...existing,
        ...patch,
        name: clampString(patch.name ?? existing.name, 80) || existing.name,
        totalFloors: Math.max(1, Number(patch.totalFloors ?? existing.totalFloors) || 1),
        unitsPerFloor: Math.max(1, Number(patch.unitsPerFloor ?? existing.unitsPerFloor) || 1),
        startDate: clampString(patch.startDate ?? existing.startDate, 24),
        finishDate: clampString(patch.finishDate ?? existing.finishDate, 24),
        inchargeName: clampString(patch.inchargeName ?? existing.inchargeName, 100),
        inchargePhone: clampString(patch.inchargePhone ?? existing.inchargePhone, 24),
        supervisorName: clampString(patch.supervisorName ?? existing.supervisorName, 100),
        supervisorPhone: clampString(patch.supervisorPhone ?? existing.supervisorPhone, 24),
        engineerName: clampString(patch.engineerName ?? existing.engineerName, 100),
        engineerPhone: clampString(patch.engineerPhone ?? existing.engineerPhone, 24),
        managerName: clampString(patch.managerName ?? existing.managerName, 100),
        managerPhone: clampString(patch.managerPhone ?? existing.managerPhone, 24),
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'towers', towerId), {
            name: merged.name,
            totalFloors: merged.totalFloors,
            unitsPerFloor: merged.unitsPerFloor,
            startDate: merged.startDate || '',
            finishDate: merged.finishDate || '',
            inchargeName: merged.inchargeName || '',
            inchargePhone: merged.inchargePhone || '',
            supervisorName: merged.supervisorName || '',
            supervisorPhone: merged.supervisorPhone || '',
            engineerName: merged.engineerName || '',
            engineerPhone: merged.engineerPhone || '',
            managerName: merged.managerName || '',
            managerPhone: merged.managerPhone || '',
            ...tsUpdate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `towers/${towerId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          towers: prev.towers.map((t) => (t.id === towerId ? merged : t)),
        }));
      }
    },
    [cloudConnected, workspace.towers]
  );

  const addCustomFloorUnits = useCallback(
    async (input: {
      projectId: string;
      towerId: string;
      floorNumber: number;
      floorLabel?: string;
      unitsCount: number;
      unitType: string;
      customUnitNumbers?: string[];
      mixedSpecs?: MixedBhkSpec[];
      unitSpecs?: GeneratedFlatUnitSpec[];
      commonAreaItems?: WholeFloorCustomZoneItem[];
    }): Promise<FlatUnit[]> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can add floors or flat units.');
      }
      const nowIso = new Date().toISOString();
      const catalog = workspace.companyProfile?.tileZoneCatalog || TILE_ZONES;

      let resolvedSpecs: GeneratedFlatUnitSpec[];
      if (input.unitSpecs && input.unitSpecs.length > 0) {
        resolvedSpecs = input.unitSpecs;
      } else if (input.mixedSpecs && input.mixedSpecs.length > 0) {
        resolvedSpecs = buildMixedBhkFloorUnits({
          floorNumber: input.floorNumber,
          mixedSpecs: input.mixedSpecs,
        });
      } else {
        const unitNums =
          input.customUnitNumbers && input.customUnitNumbers.length > 0
            ? input.customUnitNumbers
            : generateUnitNumbersForFloor(input.floorNumber, input.unitsCount);
        resolvedSpecs = unitNums.map((unitNum) => ({
          unitNumber: unitNum,
          unitType: input.unitType || '3 BHK',
        }));
      }

      const existingNums = new Set(
        workspace.flats
          .filter((f) => f.towerId === input.towerId)
          .map((f) => f.unitNumber.toLowerCase())
      );

      const resolvedLabel = clampString(
        input.floorLabel || formatFloorLabel(input.floorNumber),
        60
      );

      const created: FlatUnit[] = [];
      for (const spec of resolvedSpecs) {
        const unitNum = clampString(spec.unitNumber, 24);
        if (!unitNum || existingNums.has(unitNum.toLowerCase())) continue;
        existingNums.add(unitNum.toLowerCase());
        const flatId = sanitizeId(
          `flat_${input.towerId}_${unitNum}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
        );
        created.push({
          id: flatId,
          ownerId: ownerUid,
          projectId: input.projectId,
          towerId: input.towerId,
          floorNumber: input.floorNumber,
          floorLabel: resolvedLabel,
          unitNumber: unitNum,
          unitType: clampString(spec.unitType || input.unitType || '3 BHK', 40),
          zones: createDefaultZones(undefined, catalog),
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }

      if (created.length === 0) {
        throw new Error('All specified unit/flat numbers already exist in this tower.');
      }

      if (input.commonAreaItems && input.commonAreaItems.length > 0) {
        const commonRes = upsertFloorCommonUnitsBatch({
          existingFlats: [...workspace.flats, ...created],
          ownerId: ownerUid,
          projectId: input.projectId,
          towerId: input.towerId,
          floorNumbers: [input.floorNumber],
          floorLabelsByNumber: { [input.floorNumber]: resolvedLabel },
          items: input.commonAreaItems.map((it) => ({
            label: clampString(it.label, 80),
            category: it.category,
            sqft: it.sqft,
            status: it.status,
          })),
          updatedDate: getTodayIso(),
          nowIso,
          makeFlatId: (twrId, _flNum, unitNum) =>
            sanitizeId(
              `flat_${twrId}_${unitNum.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now().toString(36)}`
            ),
        });
        created.push(...commonRes.createdUnits);
      }

      if (cloudConnected) {
        try {
          for (let i = 0; i < created.length; i += 400) {
            const batch = writeBatch(db);
            for (const flat of created.slice(i, i + 400)) {
              batch.set(doc(db, 'flats', flat.id), {
                ownerId: ownerUid,
                projectId: flat.projectId,
                towerId: flat.towerId,
                floorNumber: flat.floorNumber,
                floorLabel: flat.floorLabel || resolvedLabel,
                unitNumber: flat.unitNumber,
                unitType: flat.unitType,
                zones: stripUndefinedDeep(flat.zones),
                ...tsCreate(),
              });
            }
            await batch.commit();
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, 'flats');
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          flats: [...prev.flats, ...created],
        }));
      }

      return created;
    },
    [ownerUid, cloudConnected, workspace.flats, workspace.companyProfile, session]
  );

  const removeTower = useCallback(
    async (towerId: string): Promise<void> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can remove towers.');
      }
      const towerFlats = workspace.flats.filter((f) => f.towerId === towerId);
      if (cloudConnected) {
        try {
          for (let i = 0; i < towerFlats.length; i += 400) {
            const batch = writeBatch(db);
            for (const flat of towerFlats.slice(i, i + 400)) {
              batch.delete(doc(db, 'flats', flat.id));
            }
            await batch.commit();
          }
          await deleteDoc(doc(db, 'towers', towerId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `towers/${towerId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          towers: prev.towers.filter((t) => t.id !== towerId),
          flats: prev.flats.filter((f) => f.towerId !== towerId),
        }));
      }
    },
    [cloudConnected, workspace.flats, session]
  );

  const removeFlat = useCallback(
    async (flatId: string): Promise<void> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can remove flat units.');
      }
      if (cloudConnected) {
        try {
          await deleteDoc(doc(db, 'flats', flatId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `flats/${flatId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          flats: prev.flats.filter((f) => f.id !== flatId),
        }));
      }
    },
    [cloudConnected, session]
  );

  const assignWorkToFlat = useCallback(
    async (input: {
      flatId: string;
      zoneKey: TileZoneKey;
      employeeId: string;
      assignedDate: string;
      targetSqft: number;
      status: AssignmentStatus;
      notes?: string;
      allowIncompleteOverride?: boolean;
    }): Promise<WorkAssignment> => {
      if (session?.role === 'employee') {
        throw new Error('Employee login is read-only.');
      }
      const flat = workspace.flats.find((f) => f.id === input.flatId);
      const employee = workspace.employees.find((e) => e.id === input.employeeId);
      const project = workspace.projects.find((p) => p.id === flat?.projectId);
      const tower = workspace.towers.find((t) => t.id === flat?.towerId);

      if (!flat || !employee || !project || !tower) {
        throw new Error('Selected flat or employee was not found.');
      }
      if (session?.role === 'supervisor') {
        if (!canAccessTower(session, tower.id)) {
          throw new Error('Supervisors can only allot work inside their assigned tower(s).');
        }
        if (!canSupervisorUpdateEmployee(session, employee)) {
          throw new Error('Supervisors can only allot work to crew assigned to their tower(s).');
        }
      }

      const enforceFinish = workspace.companyProfile?.requireFinishBeforeNewWork !== false;
      if (enforceFinish && !input.allowIncompleteOverride) {
        const unfinished = findActiveUnfinishedAssignment(
          employee.id,
          workspace.assignments,
          workspace.flats,
          workspace.projects,
          workspace.towers
        );
        if (unfinished) {
          throw new Error(
            `${employee.fullName} (${employee.empCode}) still has unfinished work on Flat ${unfinished.unitNumber} (${unfinished.zoneLabel} · ${unfinished.projectName} / ${unfinished.towerName}). Mark previous work completed first before assigning new work.`
          );
        }
      }

      const nowIso = new Date().toISOString();
      const id = sanitizeId(`asgn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const catalogMatch = workspace.companyProfile?.tileZoneCatalog?.find(
        (z) => z.key === input.zoneKey
      );
      const zoneLabel =
        flat.zones?.[input.zoneKey]?.label ||
        catalogMatch?.label ||
        ZONE_LABEL_MAP[input.zoneKey] ||
        input.zoneKey;

      const completedDate =
        input.status === 'completed' ||
        input.status === 'cleaning_done' ||
        input.status === 'qc_approved'
          ? input.assignedDate
          : '';

      const assignment: WorkAssignment = {
        id,
        ownerId: ownerUid,
        projectId: project.id,
        projectName: project.name,
        towerId: tower.id,
        towerName: tower.name,
        flatId: flat.id,
        unitNumber: flat.unitNumber,
        zoneKey: input.zoneKey,
        zoneLabel,
        employeeId: employee.id,
        empCode: employee.empCode,
        employeeName: employee.fullName,
        employeeRole: employee.role,
        assignedDate: input.assignedDate,
        completedDate,
        targetSqft: Number(input.targetSqft) || 0,
        status: input.status,
        notes: clampString(input.notes, 400),
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const zoneStatus: ZoneStatus =
        input.status === 'assigned' ? 'in_progress' : input.status;

      const prevZone = flat.zones[input.zoneKey];
      const updatedZones = stripUndefinedDeep({
        ...flat.zones,
        [input.zoneKey]: {
          ...(prevZone || { sqft: input.targetSqft }),
          status: zoneStatus,
          sqft: Number(input.targetSqft) || prevZone?.sqft || 0,
          label: prevZone?.label || zoneLabel,
          category: prevZone?.category || catalogMatch?.category || 'Flooring',
          assignedEmployeeId: employee.id,
          assignedEmpCode: employee.empCode,
          assignedEmployeeName: employee.fullName,
          updatedDate: input.assignedDate,
          notes: clampString(input.notes, 300),
        },
      });

      if (cloudConnected) {
        try {
          await setDoc(doc(db, 'assignments', id), {
            ownerId: ownerUid,
            projectId: assignment.projectId,
            projectName: assignment.projectName,
            towerId: assignment.towerId,
            towerName: assignment.towerName,
            flatId: assignment.flatId,
            unitNumber: assignment.unitNumber,
            zoneKey: assignment.zoneKey,
            zoneLabel: assignment.zoneLabel,
            employeeId: assignment.employeeId,
            empCode: assignment.empCode,
            employeeName: assignment.employeeName,
            employeeRole: assignment.employeeRole,
            assignedDate: assignment.assignedDate,
            completedDate: assignment.completedDate,
            targetSqft: assignment.targetSqft,
            status: assignment.status,
            notes: assignment.notes,
            ...tsCreate(),
          });
          await updateDoc(doc(db, 'flats', flat.id), {
            zones: updatedZones,
            ...tsUpdate(),
          });
          await updateDoc(doc(db, 'employees', employee.id), {
            currentProjectId: project.id,
            currentProjectName: project.name,
            currentTowerId: tower.id,
            currentTowerName: tower.name,
            ...tsUpdate(),
          });
          if (employee.qrToken && employee.qrToken.length >= 16) {
            await upsertCloudQrPass(
              {
                ...employee,
                currentProjectId: project.id,
                currentProjectName: project.name,
                currentTowerId: tower.id,
                currentTowerName: tower.name,
              },
              employee.qrToken,
              { assignments: [assignment, ...workspace.assignments] }
            );
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `assignments/${id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          assignments: [assignment, ...prev.assignments],
          flats: prev.flats.map((f) =>
            f.id === flat.id ? { ...f, zones: updatedZones, updatedAt: nowIso } : f
          ),
          employees: prev.employees.map((emp) =>
            emp.id === employee.id
              ? {
                  ...emp,
                  currentProjectId: project.id,
                  currentProjectName: project.name,
                  currentTowerId: tower.id,
                  currentTowerName: tower.name,
                  updatedAt: nowIso,
                }
              : emp
          ),
        }));
      }

      return assignment;
    },
    [
      ownerUid,
      cloudConnected,
      workspace.flats,
      workspace.employees,
      workspace.projects,
      workspace.towers,
      workspace.assignments,
      workspace.companyProfile,
      session,
      upsertCloudQrPass,
    ]
  );

  const completeAssignment = useCallback(
    async (assignmentId: string, completedDate?: string): Promise<void> => {
      if (session?.role === 'employee') {
        throw new Error('Employee login is read-only.');
      }
      const asgn = workspace.assignments.find((a) => a.id === assignmentId);
      if (!asgn) return;
      if (session?.role === 'supervisor' && !canAccessTower(session, asgn.towerId)) {
        throw new Error('Supervisors can only update assignments in their assigned tower.');
      }
      const doneDate = clampString(completedDate || getTodayIso(), 24);
      const nowIso = new Date().toISOString();
      const flat = workspace.flats.find((f) => f.id === asgn.flatId);
      const prevZone = flat?.zones?.[asgn.zoneKey];
      const updatedZones = flat
        ? stripUndefinedDeep({
            ...flat.zones,
            [asgn.zoneKey]: {
              ...(prevZone || { sqft: asgn.targetSqft }),
              status: 'completed' as ZoneStatus,
              updatedDate: doneDate,
            },
          })
        : null;

      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'assignments', assignmentId), {
            status: 'completed',
            completedDate: doneDate,
            ...tsUpdate(),
          });
          if (flat && updatedZones) {
            await updateDoc(doc(db, 'flats', flat.id), {
              zones: updatedZones,
              ...tsUpdate(),
            });
          }
          const assignedEmp = workspace.employees.find((e) => e.id === asgn.employeeId);
          if (assignedEmp?.qrToken && assignedEmp.qrToken.length >= 16) {
            await upsertCloudQrPass(assignedEmp, assignedEmp.qrToken, {
              assignments: workspace.assignments.map((a) =>
                a.id === assignmentId ? { ...a, status: 'completed', completedDate: doneDate } : a
              ),
            });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `assignments/${assignmentId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          assignments: prev.assignments.map((a) =>
            a.id === assignmentId
              ? { ...a, status: 'completed', completedDate: doneDate, updatedAt: nowIso }
              : a
          ),
          flats:
            flat && updatedZones
              ? prev.flats.map((f) =>
                  f.id === flat.id ? { ...f, zones: updatedZones, updatedAt: nowIso } : f
                )
              : prev.flats,
        }));
      }
    },
    [cloudConnected, workspace.assignments, workspace.flats, workspace.employees, upsertCloudQrPass]
  );

  const updateFlatZone = useCallback(
    async (input: {
      flatId: string;
      zoneKey: TileZoneKey;
      status: ZoneStatus;
      sqft: number;
      assignedEmployeeId?: string | null;
      notes?: string;
      createHistoryRecord?: boolean;
    }): Promise<void> => {
      if (session?.role === 'employee') {
        throw new Error('Employee login is read-only.');
      }
      const flat = workspace.flats.find((f) => f.id === input.flatId);
      if (!flat) return;
      if (session?.role === 'supervisor' && !canAccessTower(session, flat.towerId)) {
        throw new Error('Supervisors can only update flat work status inside their assigned tower.');
      }

      const isExplicitUnassign = input.assignedEmployeeId === null || input.assignedEmployeeId === '';
      const employee =
        input.assignedEmployeeId && !isExplicitUnassign
          ? workspace.employees.find((e) => e.id === input.assignedEmployeeId)
          : undefined;
      if (session?.role === 'supervisor' && employee && !canSupervisorUpdateEmployee(session, employee)) {
        throw new Error('Supervisors can only allot under-employees from their assigned tower.');
      }

      const today = getTodayIso();
      const nowIso = new Date().toISOString();
      const prevZone = flat.zones[input.zoneKey];
      const catalogMatch = workspace.companyProfile?.tileZoneCatalog?.find(
        (z) => z.key === input.zoneKey
      );
      const zoneLabel =
        prevZone?.label || catalogMatch?.label || ZONE_LABEL_MAP[input.zoneKey] || input.zoneKey;

      const nextZoneState: FlatUnit['zones'][string] = {
        status: input.status,
        sqft: Number(input.sqft) || prevZone?.sqft || 0,
        assignedEmployeeId: isExplicitUnassign
          ? ''
          : employee
            ? employee.id
            : prevZone?.assignedEmployeeId || '',
        assignedEmpCode: isExplicitUnassign
          ? ''
          : employee
            ? employee.empCode
            : prevZone?.assignedEmpCode || '',
        assignedEmployeeName: isExplicitUnassign
          ? ''
          : employee
            ? employee.fullName
            : prevZone?.assignedEmployeeName || '',
        updatedDate: today,
        notes: input.notes !== undefined ? clampString(input.notes, 300) : prevZone?.notes || '',
      };
      if (prevZone?.label) nextZoneState.label = prevZone.label;
      if (prevZone?.category) nextZoneState.category = prevZone.category;

      const updatedZones = stripUndefinedDeep({
        ...flat.zones,
        [input.zoneKey]: nextZoneState,
      });

      const project = workspace.projects.find((p) => p.id === flat.projectId);
      const tower = workspace.towers.find((t) => t.id === flat.towerId);

      // Keep any open assignment for this flat/zone synchronized when marked completed/cleaning_done/qc_approved
      const matchingOpenAsgn =
        input.status === 'completed' ||
        input.status === 'cleaning_done' ||
        input.status === 'qc_approved'
          ? workspace.assignments.find(
              (a) =>
                a.flatId === flat.id &&
                a.zoneKey === input.zoneKey &&
                (a.status === 'assigned' ||
                  a.status === 'prechecking' ||
                  a.status === 'in_progress' ||
                  a.status === 'cleaning_in_progress')
            )
          : undefined;

      const resolvedDoneStatus: AssignmentStatus =
        input.status === 'qc_approved'
          ? 'qc_approved'
          : input.status === 'cleaning_done'
            ? 'cleaning_done'
            : 'completed';

      let historyAssignment: WorkAssignment | null = null;
      if (input.createHistoryRecord && employee && project && tower && !matchingOpenAsgn) {
        const asgnStatus: AssignmentStatus =
          input.status === 'not_started' ? 'assigned' : input.status;
        historyAssignment = {
          id: sanitizeId(`asgn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
          ownerId: ownerUid,
          projectId: project.id,
          projectName: project.name,
          towerId: tower.id,
          towerName: tower.name,
          flatId: flat.id,
          unitNumber: flat.unitNumber,
          zoneKey: input.zoneKey,
          zoneLabel,
          employeeId: employee.id,
          empCode: employee.empCode,
          employeeName: employee.fullName,
          employeeRole: employee.role,
          assignedDate: today,
          completedDate:
            input.status === 'completed' ||
            input.status === 'cleaning_done' ||
            input.status === 'qc_approved'
              ? today
              : '',
          targetSqft: nextZoneState.sqft,
          status: asgnStatus,
          notes: nextZoneState.notes || '',
          createdAt: nowIso,
          updatedAt: nowIso,
        };
      }

      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'flats', flat.id), {
            zones: updatedZones,
            ...tsUpdate(),
          });
          if (matchingOpenAsgn) {
            await updateDoc(doc(db, 'assignments', matchingOpenAsgn.id), {
              status: resolvedDoneStatus,
              completedDate: today,
              ...tsUpdate(),
            });
          }
          if (historyAssignment) {
            await setDoc(doc(db, 'assignments', historyAssignment.id), {
              ownerId: ownerUid,
              projectId: historyAssignment.projectId,
              projectName: historyAssignment.projectName,
              towerId: historyAssignment.towerId,
              towerName: historyAssignment.towerName,
              flatId: historyAssignment.flatId,
              unitNumber: historyAssignment.unitNumber,
              zoneKey: historyAssignment.zoneKey,
              zoneLabel: historyAssignment.zoneLabel,
              employeeId: historyAssignment.employeeId,
              empCode: historyAssignment.empCode,
              employeeName: historyAssignment.employeeName,
              employeeRole: historyAssignment.employeeRole,
              assignedDate: historyAssignment.assignedDate,
              completedDate: historyAssignment.completedDate,
              targetSqft: historyAssignment.targetSqft,
              status: historyAssignment.status,
              notes: historyAssignment.notes,
              ...tsCreate(),
            });
          }
          if (employee && project && tower) {
            await updateDoc(doc(db, 'employees', employee.id), {
              currentProjectId: project.id,
              currentProjectName: project.name,
              currentTowerId: tower.id,
              currentTowerName: tower.name,
              ...tsUpdate(),
            });
          }

          const nextAssignments = matchingOpenAsgn
            ? workspace.assignments.map((a) =>
                a.id === matchingOpenAsgn.id
                  ? {
                      ...a,
                      status: resolvedDoneStatus,
                      completedDate: today,
                    }
                  : a
              )
            : historyAssignment
              ? [historyAssignment, ...workspace.assignments]
              : workspace.assignments;

          if (employee?.qrToken && employee.qrToken.length >= 16) {
            const nextEmp: Employee =
              project && tower
                ? {
                    ...employee,
                    currentProjectId: project.id,
                    currentProjectName: project.name,
                    currentTowerId: tower.id,
                    currentTowerName: tower.name,
                  }
                : employee;
            await upsertCloudQrPass(nextEmp, employee.qrToken, { assignments: nextAssignments });
          }

          if (
            matchingOpenAsgn &&
            matchingOpenAsgn.employeeId !== employee?.id
          ) {
            const openEmp = workspace.employees.find((e) => e.id === matchingOpenAsgn.employeeId);
            if (openEmp?.qrToken && openEmp.qrToken.length >= 16) {
              await upsertCloudQrPass(openEmp, openEmp.qrToken, { assignments: nextAssignments });
            }
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `flats/${flat.id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          flats: prev.flats.map((f) =>
            f.id === flat.id ? { ...f, zones: updatedZones, updatedAt: nowIso } : f
          ),
          assignments: matchingOpenAsgn
            ? prev.assignments.map((a) =>
                a.id === matchingOpenAsgn.id
                  ? {
                      ...a,
                      status: resolvedDoneStatus,
                      completedDate: today,
                      updatedAt: nowIso,
                    }
                  : a
              )
            : historyAssignment
              ? [historyAssignment, ...prev.assignments]
              : prev.assignments,
          employees:
            employee && project && tower
              ? prev.employees.map((emp) =>
                  emp.id === employee.id
                    ? {
                        ...emp,
                        currentProjectId: project.id,
                        currentProjectName: project.name,
                        currentTowerId: tower.id,
                        currentTowerName: tower.name,
                        updatedAt: nowIso,
                      }
                    : emp
                )
              : prev.employees,
        }));
      }
    },
    [
      ownerUid,
      cloudConnected,
      workspace.flats,
      workspace.employees,
      workspace.projects,
      workspace.towers,
      workspace.assignments,
      workspace.companyProfile,
      session,
      upsertCloudQrPass,
    ]
  );

  // --- Employees, Documents & Site Deployments ---
  const addEmployee = useCallback(
    async (input: {
      fullName: string;
      role: EmployeeRole;
      phone: string;
      alternatePhone?: string;
      email?: string;
      joiningDate: string;
      dailyRate: number;
      overtimeRate: number;
      foodAllowanceDaily: number;
      aadharRef?: string;
      pfNumber?: string;
      esiNumber?: string;
      bloodGroup?: string;
      emergencyContact?: string;
      photoDataUrl?: string;
      currentProjectId?: string;
      currentTowerId?: string;
      notes?: string;
    }): Promise<Employee> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can register new employees.');
      }
      const nowIso = new Date().toISOString();
      const empCode = generateEmployeeCode(input.role, workspace.employees);
      const id = sanitizeId(`emp_${empCode.toLowerCase()}_${Date.now().toString(36)}`);
      const proj = workspace.projects.find((p) => p.id === input.currentProjectId);
      const twr = workspace.towers.find((t) => t.id === input.currentTowerId);

      const employee: Employee = {
        id,
        ownerId: ownerUid,
        empCode,
        fullName: clampString(input.fullName, 100),
        role: input.role,
        phone: clampString(input.phone, 24),
        alternatePhone: clampString(input.alternatePhone, 24),
        email: clampString(input.email, 120),
        joiningDate: clampString(input.joiningDate, 24),
        dailyRate: Number(input.dailyRate) || 0,
        overtimeRate: Number(input.overtimeRate) || 0,
        foodAllowanceDaily: Number(input.foodAllowanceDaily) || 0,
        aadharRef: clampString(input.aadharRef, 40),
        pfNumber: clampString(input.pfNumber, 60),
        esiNumber: clampString(input.esiNumber, 60),
        bloodGroup: clampString(input.bloodGroup, 12),
        emergencyContact: clampString(input.emergencyContact, 120),
        photoDataUrl: (input.photoDataUrl || '').slice(0, 120000),
        currentProjectId: proj?.id || '',
        currentProjectName: proj?.name || '',
        currentTowerId: twr?.id || '',
        currentTowerName: twr?.name || '',
        assignedTowerIds:
          input.role === 'Supervisor' && twr?.id ? [twr.id] : [],
        loginPin: DEFAULT_USER_PIN,
        qrToken: generateQrPassToken(),
        status: 'active',
        notes: clampString(input.notes, 400),
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          await setDoc(doc(db, 'employees', id), {
            ownerId: ownerUid,
            empCode: employee.empCode,
            fullName: employee.fullName,
            role: employee.role,
            phone: employee.phone,
            alternatePhone: employee.alternatePhone || '',
            email: employee.email || '',
            joiningDate: employee.joiningDate,
            dailyRate: employee.dailyRate,
            overtimeRate: employee.overtimeRate,
            foodAllowanceDaily: employee.foodAllowanceDaily,
            aadharRef: employee.aadharRef,
            pfNumber: employee.pfNumber || '',
            esiNumber: employee.esiNumber || '',
            bloodGroup: employee.bloodGroup || '',
            emergencyContact: employee.emergencyContact,
            photoDataUrl: employee.photoDataUrl || '',
            currentProjectId: employee.currentProjectId || '',
            currentProjectName: employee.currentProjectName || '',
            currentTowerId: employee.currentTowerId || '',
            currentTowerName: employee.currentTowerName || '',
            assignedTowerIds: employee.assignedTowerIds || [],
            loginPin: employee.loginPin || DEFAULT_USER_PIN,
            qrToken: employee.qrToken || '',
            status: employee.status,
            notes: employee.notes,
            ...tsCreate(),
          });
          if (employee.qrToken) {
            await upsertCloudQrPass(employee, employee.qrToken);
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `employees/${id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          employees: [...prev.employees, employee],
        }));
      }

      return employee;
    },
    [ownerUid, cloudConnected, workspace.employees, workspace.projects, workspace.towers]
  );

  const updateEmployee = useCallback(
    async (employeeId: string, patch: Partial<Employee>): Promise<void> => {
      const existing = workspace.employees.find((e) => e.id === employeeId);
      if (!existing) return;
      if (session && session.role === 'supervisor' && !canSupervisorUpdateEmployee(session, existing)) {
        throw new Error('Supervisors can only update employees assigned to their tower.');
      }
      if (session && session.role === 'employee') {
        throw new Error('Employee login is read-only.');
      }
      const nowIso = new Date().toISOString();

      const sanitizedPatch =
        session?.role === 'supervisor'
          ? {
              phone: patch.phone ?? existing.phone,
              alternatePhone: patch.alternatePhone ?? existing.alternatePhone,
              email: patch.email ?? existing.email,
              aadharRef: patch.aadharRef ?? existing.aadharRef,
              bloodGroup: patch.bloodGroup ?? existing.bloodGroup,
              emergencyContact: patch.emergencyContact ?? existing.emergencyContact,
              photoDataUrl: patch.photoDataUrl ?? existing.photoDataUrl,
              status: patch.status ?? existing.status,
              notes: patch.notes ?? existing.notes,
            }
          : patch;

      const updated: Employee = {
        ...existing,
        ...sanitizedPatch,
        empCode: existing.empCode,
        ownerId: existing.ownerId,
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'employees', employeeId), {
            fullName: clampString(updated.fullName, 100),
            role: updated.role,
            phone: clampString(updated.phone, 24),
            alternatePhone: clampString(updated.alternatePhone, 24),
            email: clampString(updated.email, 120),
            joiningDate: clampString(updated.joiningDate, 24),
            dailyRate: Number(updated.dailyRate) || 0,
            overtimeRate: Number(updated.overtimeRate) || 0,
            foodAllowanceDaily: Number(updated.foodAllowanceDaily) || 0,
            aadharRef: clampString(updated.aadharRef, 40),
            pfNumber: clampString(updated.pfNumber, 60),
            esiNumber: clampString(updated.esiNumber, 60),
            bloodGroup: clampString(updated.bloodGroup, 12),
            emergencyContact: clampString(updated.emergencyContact, 120),
            photoDataUrl: (updated.photoDataUrl || '').slice(0, 120000),
            currentProjectId: clampString(updated.currentProjectId, 128),
            currentProjectName: clampString(updated.currentProjectName, 120),
            currentTowerId: clampString(updated.currentTowerId, 128),
            currentTowerName: clampString(updated.currentTowerName, 80),
            assignedTowerIds: Array.isArray(updated.assignedTowerIds)
              ? updated.assignedTowerIds.slice(0, 30)
              : [],
            loginPin: clampString(updated.loginPin || DEFAULT_USER_PIN, 24),
            qrToken: clampString(updated.qrToken, 48),
            status: updated.status,
            notes: clampString(updated.notes, 400),
            ...tsUpdate(),
          });
          if (updated.qrToken && updated.qrToken.length >= 16) {
            await upsertCloudQrPass(updated, updated.qrToken);
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `employees/${employeeId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          employees: prev.employees.map((e) => (e.id === employeeId ? updated : e)),
        }));
      }
    },
    [cloudConnected, workspace.employees, session]
  );

  const addEmployeeDocument = useCallback(
    async (input: {
      employeeId: string;
      docCategory: 'aadhar_pdf' | 'other';
      title: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      dataUrl: string;
    }): Promise<EmployeeDocument> => {
      const nowIso = new Date().toISOString();
      const id = sanitizeId(`doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const docRecord: EmployeeDocument = {
        id,
        ownerId: ownerUid,
        employeeId: input.employeeId,
        docCategory: input.docCategory,
        title: clampString(input.title, 100),
        fileName: clampString(input.fileName, 160),
        mimeType: clampString(input.mimeType || 'application/pdf', 80),
        sizeBytes: Math.max(1, Number(input.sizeBytes) || 1),
        dataUrl: input.dataUrl,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          await setDoc(doc(db, 'employee_docs', id), {
            ownerId: ownerUid,
            employeeId: docRecord.employeeId,
            docCategory: docRecord.docCategory,
            title: docRecord.title,
            fileName: docRecord.fileName,
            mimeType: docRecord.mimeType,
            sizeBytes: docRecord.sizeBytes,
            dataUrl: docRecord.dataUrl,
            ...tsCreate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `employee_docs/${id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          employeeDocuments: [docRecord, ...prev.employeeDocuments],
        }));
      }
      return docRecord;
    },
    [ownerUid, cloudConnected]
  );

  const deleteEmployeeDocument = useCallback(
    async (docId: string): Promise<void> => {
      if (cloudConnected) {
        try {
          await deleteDoc(doc(db, 'employee_docs', docId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `employee_docs/${docId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          employeeDocuments: prev.employeeDocuments.filter((d) => d.id !== docId),
        }));
      }
    },
    [cloudConnected]
  );

  const deployEmployeeToSite = useCallback(
    async (input: {
      employeeId: string;
      projectId: string;
      towerId: string;
      assignedDate: string;
      notes?: string;
    }): Promise<DeploymentRecord> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can transfer employees across towers or projects.');
      }
      const emp = workspace.employees.find((e) => e.id === input.employeeId);
      const proj = workspace.projects.find((p) => p.id === input.projectId);
      const twr = workspace.towers.find((t) => t.id === input.towerId);
      if (!emp || !proj || !twr) {
        throw new Error('Employee, project, or tower not found.');
      }

      const nowIso = new Date().toISOString();
      const id = sanitizeId(`dep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const rec: DeploymentRecord = {
        id,
        ownerId: ownerUid,
        employeeId: emp.id,
        empCode: emp.empCode,
        employeeName: emp.fullName,
        employeeRole: emp.role,
        projectId: proj.id,
        projectName: proj.name,
        towerId: twr.id,
        towerName: twr.name,
        fromProjectName: emp.currentProjectName || '',
        fromTowerName: emp.currentTowerName || '',
        assignedDate: input.assignedDate || getTodayIso(),
        notes: clampString(input.notes, 300),
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          await setDoc(doc(db, 'deployments', id), {
            ownerId: ownerUid,
            employeeId: rec.employeeId,
            empCode: rec.empCode,
            employeeName: rec.employeeName,
            employeeRole: rec.employeeRole,
            projectId: rec.projectId,
            projectName: rec.projectName,
            towerId: rec.towerId,
            towerName: rec.towerName,
            fromProjectName: rec.fromProjectName || '',
            fromTowerName: rec.fromTowerName || '',
            assignedDate: rec.assignedDate,
            notes: rec.notes,
            ...tsCreate(),
          });
          await updateDoc(doc(db, 'employees', emp.id), {
            currentProjectId: proj.id,
            currentProjectName: proj.name,
            currentTowerId: twr.id,
            currentTowerName: twr.name,
            ...tsUpdate(),
          });
          if (emp.qrToken && emp.qrToken.length >= 16) {
            await upsertCloudQrPass(
              {
                ...emp,
                currentProjectId: proj.id,
                currentProjectName: proj.name,
                currentTowerId: twr.id,
                currentTowerName: twr.name,
              },
              emp.qrToken,
              { deployments: [rec, ...workspace.deployments] }
            );
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `deployments/${id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          deployments: [rec, ...prev.deployments],
          employees: prev.employees.map((e) =>
            e.id === emp.id
              ? {
                  ...e,
                  currentProjectId: proj.id,
                  currentProjectName: proj.name,
                  currentTowerId: twr.id,
                  currentTowerName: twr.name,
                  updatedAt: nowIso,
                }
              : e
          ),
        }));
      }
      return rec;
    },
    [
      ownerUid,
      cloudConnected,
      workspace.employees,
      workspace.projects,
      workspace.towers,
      workspace.deployments,
      upsertCloudQrPass,
    ]
  );

  const bulkAllocateEmployeesToTower = useCallback(
    async (input: {
      employeeIds: string[];
      projectId: string;
      towerId: string;
      assignedDate: string;
      notes?: string;
    }): Promise<void> => {
      for (const empId of input.employeeIds) {
        await deployEmployeeToSite({
          employeeId: empId,
          projectId: input.projectId,
          towerId: input.towerId,
          assignedDate: input.assignedDate,
          notes: input.notes || 'Project & Tower crew allocation',
        });
      }
    },
    [deployEmployeeToSite]
  );

  // --- Attendance / Advances / Expenses / Settlements ---
  const saveAttendanceRecordInternal = useCallback(
    async (input: {
      date: string;
      employeeId: string;
      projectId: string;
      towerId?: string;
      status: AttendanceStatus;
      overtimeHours: number;
      notes?: string;
      isExplicitEdit?: boolean;
      editReason?: string;
      adminPin?: string;
    }): Promise<void> => {
      const employee = workspace.employees.find((e) => e.id === input.employeeId);
      if (!employee) return;

      if (session?.role === 'supervisor' && !canSupervisorUpdateEmployee(session, employee)) {
        throw new Error('Supervisors can only mark attendance for crew in their assigned tower(s).');
      }

      const existing = workspace.attendance.find(
        (a) => a.date === input.date && a.employeeId === input.employeeId
      );

      const evalRes = evaluateAttendanceMutation({
        session,
        existingRecord: existing,
        companyProfile: workspace.companyProfile,
        isExplicitEdit: input.isExplicitEdit,
        adminPinInput: input.adminPin,
        editReason: input.editReason,
      });

      if (!evalRes.allowed) {
        throw new Error(evalRes.reason || 'You do not have permission to change this attendance.');
      }

      const project =
        workspace.projects.find((p) => p.id === input.projectId) ||
        workspace.projects.find((p) => p.id === employee.currentProjectId);
      const resolvedTowerId =
        input.towerId && input.towerId !== 'all'
          ? input.towerId
          : employee.currentTowerId || '';
      const tower = workspace.towers.find((t) => t.id === resolvedTowerId);

      const { dailyWageEarned, overtimePayEarned } = computeDailyWage(
        employee.dailyRate,
        employee.overtimeRate,
        input.status,
        input.overtimeHours
      );

      const nowIso = new Date().toISOString();
      const docId = existing
        ? existing.id
        : sanitizeId(`att_${input.date}_${input.employeeId}`);

      const actorRole: 'admin' | 'supervisor' =
        session?.role === 'supervisor' ? 'supervisor' : 'admin';
      const actorName = clampString(session?.displayName || 'Admin', 100);

      const record: AttendanceRecord = {
        id: docId,
        ownerId: ownerUid,
        date: input.date,
        employeeId: employee.id,
        empCode: employee.empCode,
        employeeName: employee.fullName,
        employeeRole: employee.role,
        projectId: project?.id || '',
        projectName: project?.name || '',
        towerId: tower?.id || '',
        towerName: tower?.name || '',
        status: input.status,
        overtimeHours: Number(input.overtimeHours) || 0,
        dailyWageEarned,
        overtimePayEarned,
        notes: clampString(input.notes, 300),
        markedByRole: existing?.markedByRole || actorRole,
        markedByName: existing?.markedByName || actorName,
        editedByName: existing ? actorName : undefined,
        editedAt: existing ? nowIso : undefined,
        editReason: existing
          ? clampString(input.editReason || 'Updated by Admin', 300)
          : undefined,
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          if (existing) {
            await updateDoc(doc(db, 'attendance', docId), {
              status: record.status,
              overtimeHours: record.overtimeHours,
              dailyWageEarned: record.dailyWageEarned,
              overtimePayEarned: record.overtimePayEarned,
              projectId: record.projectId,
              projectName: record.projectName,
              towerId: record.towerId || '',
              towerName: record.towerName || '',
              notes: record.notes,
              markedByRole: record.markedByRole,
              markedByName: record.markedByName,
              editedByName: record.editedByName || actorName,
              editedAt: record.editedAt || nowIso,
              editReason: record.editReason || '',
              ...tsUpdate(),
            });
          } else {
            await setDoc(doc(db, 'attendance', docId), {
              ownerId: ownerUid,
              date: record.date,
              employeeId: record.employeeId,
              empCode: record.empCode,
              employeeName: record.employeeName,
              employeeRole: record.employeeRole,
              projectId: record.projectId,
              projectName: record.projectName,
              towerId: record.towerId || '',
              towerName: record.towerName || '',
              status: record.status,
              overtimeHours: record.overtimeHours,
              dailyWageEarned: record.dailyWageEarned,
              overtimePayEarned: record.overtimePayEarned,
              notes: record.notes,
              markedByRole: record.markedByRole,
              markedByName: record.markedByName,
              ...tsCreate(),
            });
          }
          if (employee.qrToken && employee.qrToken.length >= 16) {
            const nextAttendance = existing
              ? workspace.attendance.map((a) => (a.id === docId ? record : a))
              : [record, ...workspace.attendance];
            await upsertCloudQrPass(employee, employee.qrToken, { attendance: nextAttendance });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `attendance/${docId}`);
        }
      } else {
        setWorkspace((prev) => {
          const exists = prev.attendance.some((a) => a.id === docId);
          return {
            ...prev,
            attendance: exists
              ? prev.attendance.map((a) => (a.id === docId ? record : a))
              : [record, ...prev.attendance],
          };
        });
      }
    },
    [
      ownerUid,
      cloudConnected,
      workspace.employees,
      workspace.projects,
      workspace.towers,
      workspace.attendance,
      workspace.companyProfile,
      session,
      upsertCloudQrPass,
    ]
  );

  const markAttendance = useCallback(
    async (input: {
      date: string;
      employeeId: string;
      projectId: string;
      towerId?: string;
      status: AttendanceStatus;
      overtimeHours: number;
      notes?: string;
    }): Promise<void> => {
      await saveAttendanceRecordInternal({
        ...input,
        isExplicitEdit: false,
      });
    },
    [saveAttendanceRecordInternal]
  );

  const editLockedAttendance = useCallback(
    async (input: {
      date: string;
      employeeId: string;
      projectId: string;
      towerId?: string;
      status: AttendanceStatus;
      overtimeHours: number;
      notes?: string;
      editReason: string;
      adminPin?: string;
    }): Promise<void> => {
      await saveAttendanceRecordInternal({
        ...input,
        isExplicitEdit: true,
      });
    },
    [saveAttendanceRecordInternal]
  );

  const deleteAttendanceRecord = useCallback(
    async (date: string, employeeId: string): Promise<void> => {
      const employee = workspace.employees.find((e) => e.id === employeeId);
      if (session?.role === 'employee') {
        throw new Error('Workers cannot delete attendance records.');
      }
      if (session?.role === 'supervisor' && employee && !canSupervisorUpdateEmployee(session, employee)) {
        throw new Error('Supervisors can only undo attendance for crew in their assigned tower(s).');
      }

      const existing = workspace.attendance.find(
        (a) => a.date === date && a.employeeId === employeeId
      );
      const docId = existing ? existing.id : sanitizeId(`att_${date}_${employeeId}`);
      const nextAttendance = workspace.attendance.filter(
        (a) => a.id !== docId && !(a.date === date && a.employeeId === employeeId)
      );

      if (cloudConnected) {
        try {
          await deleteDoc(doc(db, 'attendance', docId));
          if (employee?.qrToken && employee.qrToken.length >= 16) {
            await upsertCloudQrPass(employee, employee.qrToken, { attendance: nextAttendance });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `attendance/${docId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          attendance: prev.attendance.filter(
            (a) => a.id !== docId && !(a.date === date && a.employeeId === employeeId)
          ),
        }));
      }
    },
    [
      cloudConnected,
      session,
      workspace.employees,
      workspace.attendance,
      upsertCloudQrPass,
    ]
  );

  const bulkMarkAttendancePresent = useCallback(
    async (date: string, projectId: string, towerId?: string): Promise<void> => {
      const scoped = workspace.employees.filter((e) => {
        if (e.status !== 'active') return false;
        if (session?.role === 'supervisor' && !canSupervisorUpdateEmployee(session, e)) {
          return false;
        }
        if (projectId && projectId !== 'all' && e.currentProjectId !== projectId) return false;
        if (towerId && towerId !== 'all' && e.currentTowerId !== towerId) return false;
        return true;
      });
      for (const emp of scoped) {
        const existing = workspace.attendance.find(
          (a) => a.date === date && a.employeeId === emp.id
        );
        if (!existing) {
          await markAttendance({
            date,
            employeeId: emp.id,
            projectId: projectId === 'all' ? emp.currentProjectId || '' : projectId,
            towerId: towerId && towerId !== 'all' ? towerId : emp.currentTowerId,
            status: 'present',
            overtimeHours: 0,
            notes: '',
          });
        }
      }
    },
    [workspace.employees, workspace.attendance, markAttendance, session]
  );

  const addAdvance = useCallback(
    async (input: {
      date: string;
      employeeId: string;
      advanceType: AdvanceType;
      customCategory?: string;
      amount: number;
      paymentMode: PaymentMode;
      paymentApp?: string;
      transactionId?: string;
      upiId?: string;
      proofImageDataUrl?: string;
      projectId?: string;
      towerId?: string;
      isSundayRun?: boolean;
      notes?: string;
    }): Promise<{ advance: AdvanceEntry; whatsappMessage: string; updatedNetBalance: number }> => {
      if (session?.role === 'employee') {
        throw new Error('Employee login is read-only.');
      }
      const employee = workspace.employees.find((e) => e.id === input.employeeId);
      if (!employee) throw new Error('Employee not found.');
      if (session?.role === 'supervisor' && !canSupervisorUpdateEmployee(session, employee)) {
        throw new Error('Supervisors can only record advances for their assigned tower crew.');
      }

      const resolvedProjectId = input.projectId || employee.currentProjectId || '';
      const resolvedTowerId = input.towerId || employee.currentTowerId || '';
      const proj = workspace.projects.find((p) => p.id === resolvedProjectId);
      const twr = workspace.towers.find((t) => t.id === resolvedTowerId);
      const sundayFlag =
        input.isSundayRun ?? (input.advanceType === 'weekly_food' && isSundayDate(input.date));

      const cleanCustomCategory =
        input.advanceType === 'custom' ? clampString(input.customCategory, 60) : '';
      const cleanPaymentApp = clampString(input.paymentApp, 40);
      const cleanTxnId = clampString(input.transactionId, 100);
      const cleanUpiId = clampString(input.upiId, 120);
      const cleanProofUrl =
        input.proofImageDataUrl && input.proofImageDataUrl.startsWith('data:image/')
          ? input.proofImageDataUrl.slice(0, 240000)
          : '';

      const nowIso = new Date().toISOString();
      const id = sanitizeId(`adv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const advance: AdvanceEntry = {
        id,
        ownerId: ownerUid,
        date: input.date,
        employeeId: employee.id,
        empCode: employee.empCode,
        employeeName: employee.fullName,
        employeePhone: employee.phone,
        projectId: proj?.id || '',
        projectName: proj?.name || employee.currentProjectName || '',
        towerId: twr?.id || '',
        towerName: twr?.name || employee.currentTowerName || '',
        isSundayRun: sundayFlag,
        advanceType: input.advanceType,
        ...(cleanCustomCategory ? { customCategory: cleanCustomCategory } : {}),
        amount: Math.max(1, Number(input.amount) || 0),
        paymentMode: input.paymentMode,
        ...(cleanPaymentApp ? { paymentApp: cleanPaymentApp } : {}),
        ...(cleanTxnId ? { transactionId: cleanTxnId } : {}),
        ...(cleanUpiId ? { upiId: cleanUpiId } : {}),
        ...(cleanProofUrl ? { proofImageDataUrl: cleanProofUrl } : {}),
        notes: clampString(input.notes, 300),
        whatsappShared: false,
        acknowledged: false,
        followUpCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const nextAdvances = [advance, ...workspace.advances];
      const payrollAfter = computeEmployeePayroll(
        employee,
        workspace.attendance,
        nextAdvances,
        workspace.settlements
      );
      const whatsappMessage = formatAdvanceWhatsappMessage(
        advance,
        payrollAfter.netPayable,
        workspace.companyProfile?.companyName || 'AVY INFRA'
      );

      if (cloudConnected) {
        try {
          await setDoc(doc(db, 'advances', id), {
            ownerId: ownerUid,
            date: advance.date,
            employeeId: advance.employeeId,
            empCode: advance.empCode,
            employeeName: advance.employeeName,
            employeePhone: advance.employeePhone,
            projectId: advance.projectId || '',
            projectName: advance.projectName || '',
            towerId: advance.towerId || '',
            towerName: advance.towerName || '',
            isSundayRun: Boolean(advance.isSundayRun),
            advanceType: advance.advanceType,
            ...(cleanCustomCategory ? { customCategory: cleanCustomCategory } : {}),
            amount: advance.amount,
            paymentMode: advance.paymentMode,
            ...(cleanPaymentApp ? { paymentApp: cleanPaymentApp } : {}),
            ...(cleanTxnId ? { transactionId: cleanTxnId } : {}),
            ...(cleanUpiId ? { upiId: cleanUpiId } : {}),
            ...(cleanProofUrl ? { proofImageDataUrl: cleanProofUrl } : {}),
            notes: advance.notes,
            whatsappShared: false,
            acknowledged: false,
            followUpCount: 0,
            ...tsCreate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `advances/${id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          advances: [advance, ...prev.advances],
        }));
      }

      return { advance, whatsappMessage, updatedNetBalance: payrollAfter.netPayable };
    },
    [
      ownerUid,
      cloudConnected,
      workspace.employees,
      workspace.projects,
      workspace.towers,
      workspace.advances,
      workspace.attendance,
      workspace.settlements,
      workspace.companyProfile,
      session,
    ]
  );

  const bulkAddAdvances = useCallback(
    async (
      entries: Array<{
        date: string;
        employeeId: string;
        advanceType: AdvanceType;
        customCategory?: string;
        amount: number;
        paymentMode: PaymentMode;
        paymentApp?: string;
        transactionId?: string;
        upiId?: string;
        proofImageDataUrl?: string;
        projectId?: string;
        towerId?: string;
        notes?: string;
      }>
    ): Promise<AdvanceEntry[]> => {
      const created: AdvanceEntry[] = [];
      for (const entry of entries) {
        if (!entry.employeeId || entry.amount <= 0) continue;
        const res = await addAdvance(entry);
        created.push(res.advance);
      }
      return created;
    },
    [addAdvance]
  );

  const addSundayWeeklyFoodBatch = useCallback(
    async (input: {
      date: string;
      projectId?: string;
      towerId?: string;
      entries: { employeeId: string; amount: number }[];
      paymentMode: PaymentMode;
      notes?: string;
    }): Promise<AdvanceEntry[]> => {
      const created: AdvanceEntry[] = [];
      for (const item of input.entries) {
        if (item.amount <= 0) continue;
        const res = await addAdvance({
          date: input.date,
          employeeId: item.employeeId,
          advanceType: 'weekly_food',
          amount: item.amount,
          paymentMode: input.paymentMode,
          projectId: input.projectId,
          towerId: input.towerId,
          isSundayRun: true,
          notes: input.notes || 'Sunday weekly food advance',
        });
        created.push(res.advance);
      }
      return created;
    },
    [addAdvance]
  );

  const markAdvanceWhatsappShared = useCallback(
    async (advanceId: string): Promise<void> => {
      const nowIso = new Date().toISOString();
      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'advances', advanceId), {
            whatsappShared: true,
            ...tsUpdate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `advances/${advanceId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          advances: prev.advances.map((a) =>
            a.id === advanceId ? { ...a, whatsappShared: true, updatedAt: nowIso } : a
          ),
        }));
      }
    },
    [cloudConnected]
  );

  const acknowledgeAdvance = useCallback(
    async (advanceId: string, acknowledgedBy?: string): Promise<void> => {
      const existing = workspace.advances.find((a) => a.id === advanceId);
      if (!existing) throw new Error('Advance entry not found.');

      if (session?.role === 'employee' && existing.employeeId !== session.employeeId) {
        throw new Error('You can only acknowledge your own advance entries.');
      }
      if (session?.role === 'supervisor') {
        const emp = workspace.employees.find((e) => e.id === existing.employeeId);
        const allowed = emp
          ? canSupervisorUpdateEmployee(session, emp)
          : Boolean(existing.towerId && session.assignedTowerIds.includes(existing.towerId));
        if (!allowed) {
          throw new Error('Supervisors can only acknowledge advances for their assigned tower crew.');
        }
      }

      const nowIso = new Date().toISOString();
      const actorLabel = clampString(
        acknowledgedBy ||
          (session?.role === 'employee'
            ? `${existing.employeeName} (Employee Portal)`
            : session?.displayName || 'Site Supervisor Verified'),
        100
      );

      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'advances', advanceId), {
            acknowledged: true,
            acknowledgedAt: nowIso,
            acknowledgedBy: actorLabel,
            ...tsUpdate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `advances/${advanceId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          advances: prev.advances.map((a) =>
            a.id === advanceId
              ? {
                  ...a,
                  acknowledged: true,
                  acknowledgedAt: nowIso,
                  acknowledgedBy: actorLabel,
                  updatedAt: nowIso,
                }
              : a
          ),
        }));
      }
    },
    [cloudConnected, workspace.advances, workspace.employees, session]
  );

  const recordAdvanceFollowUpSent = useCallback(
    async (advanceId: string): Promise<void> => {
      if (session?.role === 'employee') {
        throw new Error('Employee login cannot dispatch follow-up reminders.');
      }
      const existing = workspace.advances.find((a) => a.id === advanceId);
      if (!existing) return;

      if (session?.role === 'supervisor') {
        const emp = workspace.employees.find((e) => e.id === existing.employeeId);
        const allowed = emp
          ? canSupervisorUpdateEmployee(session, emp)
          : Boolean(existing.towerId && session.assignedTowerIds.includes(existing.towerId));
        if (!allowed) {
          throw new Error('Supervisors can only send follow-ups for their assigned tower crew.');
        }
      }

      const nowIso = new Date().toISOString();
      const nextCount = Math.min(1000, (existing.followUpCount ?? 0) + 1);

      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'advances', advanceId), {
            whatsappShared: true,
            followUpSentAt: nowIso,
            followUpCount: nextCount,
            ...tsUpdate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `advances/${advanceId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          advances: prev.advances.map((a) =>
            a.id === advanceId
              ? {
                  ...a,
                  whatsappShared: true,
                  followUpSentAt: nowIso,
                  followUpCount: nextCount,
                  updatedAt: nowIso,
                }
              : a
          ),
        }));
      }
    },
    [cloudConnected, workspace.advances, workspace.employees, session]
  );

  const addExpense = useCallback(
    async (input: {
      date: string;
      projectId: string;
      towerId?: string;
      category: ExpenseCategory;
      customCategory?: string;
      description: string;
      vendorName?: string;
      amount: number;
      paymentMode: PaymentMode;
      paymentApp?: string;
      transactionId?: string;
      upiId?: string;
      proofImageDataUrl?: string;
      notes?: string;
    }): Promise<SiteExpense> => {
      if (session?.role === 'employee') {
        throw new Error('Employee login is read-only.');
      }
      const proj = workspace.projects.find((p) => p.id === input.projectId);
      if (!proj) throw new Error('Please select a project for this expense.');
      const resolvedTowerId =
        input.towerId ||
        (session?.role === 'supervisor' ? session.assignedTowerIds[0] || '' : '');
      if (session?.role === 'supervisor' && !canAccessTower(session, resolvedTowerId)) {
        throw new Error('Supervisors can only log expenses for their assigned tower.');
      }
      const twr = resolvedTowerId
        ? workspace.towers.find((t) => t.id === resolvedTowerId)
        : undefined;

      const cleanCustomCategory =
        input.category === 'custom' ? clampString(input.customCategory, 60) : '';
      const cleanPaymentApp = clampString(input.paymentApp, 40);
      const cleanTxnId = clampString(input.transactionId, 100);
      const cleanUpiId = clampString(input.upiId, 120);
      const cleanProofUrl =
        input.proofImageDataUrl && input.proofImageDataUrl.startsWith('data:image/')
          ? input.proofImageDataUrl.slice(0, 240000)
          : '';

      const nowIso = new Date().toISOString();
      const id = sanitizeId(`exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const expense: SiteExpense = {
        id,
        ownerId: ownerUid,
        date: clampString(input.date || getTodayIso(), 24),
        projectId: proj.id,
        projectName: clampString(proj.name, 120),
        towerId: twr?.id || '',
        towerName: twr?.name || '',
        category: input.category,
        ...(cleanCustomCategory ? { customCategory: cleanCustomCategory } : {}),
        description: clampString(input.description, 160),
        vendorName: clampString(input.vendorName, 100),
        amount: Math.max(1, Number(input.amount) || 1),
        paymentMode: input.paymentMode,
        ...(cleanPaymentApp ? { paymentApp: cleanPaymentApp } : {}),
        ...(cleanTxnId ? { transactionId: cleanTxnId } : {}),
        ...(cleanUpiId ? { upiId: cleanUpiId } : {}),
        ...(cleanProofUrl ? { proofImageDataUrl: cleanProofUrl } : {}),
        notes: clampString(input.notes, 300),
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          await setDoc(doc(db, 'expenses', id), {
            ownerId: ownerUid,
            date: expense.date,
            projectId: expense.projectId,
            projectName: expense.projectName,
            towerId: expense.towerId || '',
            towerName: expense.towerName || '',
            category: expense.category,
            ...(cleanCustomCategory ? { customCategory: cleanCustomCategory } : {}),
            description: expense.description,
            vendorName: expense.vendorName || '',
            amount: expense.amount,
            paymentMode: expense.paymentMode,
            ...(cleanPaymentApp ? { paymentApp: cleanPaymentApp } : {}),
            ...(cleanTxnId ? { transactionId: cleanTxnId } : {}),
            ...(cleanUpiId ? { upiId: cleanUpiId } : {}),
            ...(cleanProofUrl ? { proofImageDataUrl: cleanProofUrl } : {}),
            notes: expense.notes,
            ...tsCreate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `expenses/${id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          expenses: [expense, ...prev.expenses],
        }));
      }

      return expense;
    },
    [ownerUid, cloudConnected, workspace.projects, workspace.towers, session]
  );

  const deleteExpense = useCallback(
    async (expenseId: string): Promise<void> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can delete logged expense bills.');
      }
      if (cloudConnected) {
        try {
          await deleteDoc(doc(db, 'expenses', expenseId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `expenses/${expenseId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          expenses: prev.expenses.filter((e) => e.id !== expenseId),
        }));
      }
    },
    [cloudConnected, session]
  );

  const recordSettlement = useCallback(
    async (input: {
      employeeId: string;
      periodStart: string;
      periodEnd: string;
      paymentMode: PaymentMode;
      paymentApp?: string;
      transactionId?: string;
      upiId?: string;
      proofImageDataUrl?: string;
      notes?: string;
    }): Promise<SettlementEntry> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can record payroll settlements.');
      }
      const employee = workspace.employees.find((e) => e.id === input.employeeId);
      if (!employee) throw new Error('Employee not found.');

      const payroll = computeEmployeePayroll(
        employee,
        workspace.attendance,
        workspace.advances,
        workspace.settlements,
        { start: input.periodStart, end: input.periodEnd }
      );

      const cleanPaymentApp = clampString(input.paymentApp, 40);
      const cleanTxnId = clampString(input.transactionId, 100);
      const cleanUpiId = clampString(input.upiId, 120);
      const cleanProofUrl =
        input.proofImageDataUrl && input.proofImageDataUrl.startsWith('data:image/')
          ? input.proofImageDataUrl.slice(0, 240000)
          : '';

      const nowIso = new Date().toISOString();
      const today = getTodayIso();
      const id = sanitizeId(`stl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const settlement: SettlementEntry = {
        id,
        ownerId: ownerUid,
        employeeId: employee.id,
        empCode: employee.empCode,
        employeeName: employee.fullName,
        periodStart: input.periodStart || today,
        periodEnd: input.periodEnd || today,
        daysWorked: payroll.effectiveDaysWorked,
        grossWages: payroll.grossWages,
        overtimePay: payroll.overtimePay,
        totalAdvances: payroll.totalAdvances,
        netPaid: Math.max(0, payroll.netPayable),
        paymentMode: input.paymentMode,
        ...(cleanPaymentApp ? { paymentApp: cleanPaymentApp } : {}),
        ...(cleanTxnId ? { transactionId: cleanTxnId } : {}),
        ...(cleanUpiId ? { upiId: cleanUpiId } : {}),
        ...(cleanProofUrl ? { proofImageDataUrl: cleanProofUrl } : {}),
        settledDate: today,
        notes: clampString(input.notes, 300),
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          await setDoc(doc(db, 'settlements', id), {
            ownerId: ownerUid,
            employeeId: settlement.employeeId,
            empCode: settlement.empCode,
            employeeName: settlement.employeeName,
            periodStart: settlement.periodStart,
            periodEnd: settlement.periodEnd,
            daysWorked: settlement.daysWorked,
            grossWages: settlement.grossWages,
            overtimePay: settlement.overtimePay,
            totalAdvances: settlement.totalAdvances,
            netPaid: settlement.netPaid,
            paymentMode: settlement.paymentMode,
            ...(cleanPaymentApp ? { paymentApp: cleanPaymentApp } : {}),
            ...(cleanTxnId ? { transactionId: cleanTxnId } : {}),
            ...(cleanUpiId ? { upiId: cleanUpiId } : {}),
            ...(cleanProofUrl ? { proofImageDataUrl: cleanProofUrl } : {}),
            settledDate: settlement.settledDate,
            notes: settlement.notes,
            ...tsCreate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `settlements/${id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          settlements: [settlement, ...prev.settlements],
        }));
      }

      return settlement;
    },
    [ownerUid, cloudConnected, workspace.employees, workspace.attendance, workspace.advances, workspace.settlements, session]
  );

  const deleteAdvance = useCallback(
    async (advanceId: string): Promise<void> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can delete advance entries.');
      }
      if (cloudConnected) {
        try {
          await deleteDoc(doc(db, 'advances', advanceId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `advances/${advanceId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          advances: prev.advances.filter((a) => a.id !== advanceId),
        }));
      }
    },
    [cloudConnected, session]
  );

  const addDailySiteLog = useCallback(
    async (input: {
      date: string;
      projectId: string;
      towerId: string;
      notes: string;
      photoDataUrl?: string;
    }): Promise<DailySiteLog> => {
      if (session?.role === 'employee') {
        throw new Error('Employee login is read-only.');
      }
      const proj = workspace.projects.find((p) => p.id === input.projectId);
      const twr = workspace.towers.find((t) => t.id === input.towerId);
      if (!proj || !twr) {
        throw new Error('Please select a valid project and tower for this daily site log.');
      }
      if (session?.role === 'supervisor' && !canAccessTower(session, twr.id)) {
        throw new Error('Supervisors can only post daily site logs for their assigned tower.');
      }
      const cleanNotes = clampString(input.notes, 600);
      if (!cleanNotes) {
        throw new Error('Please enter a short site progress note.');
      }
      const cleanPhoto =
        input.photoDataUrl && input.photoDataUrl.startsWith('data:image/')
          ? input.photoDataUrl.slice(0, 240000)
          : '';

      const nowIso = new Date().toISOString();
      const id = sanitizeId(`slog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const logEntry: DailySiteLog = {
        id,
        ownerId: ownerUid,
        date: clampString(input.date || getTodayIso(), 24),
        projectId: proj.id,
        projectName: clampString(proj.name, 120),
        towerId: twr.id,
        towerName: clampString(twr.name, 80),
        notes: cleanNotes,
        ...(cleanPhoto ? { photoDataUrl: cleanPhoto } : {}),
        loggedByRole: session?.role === 'supervisor' ? 'supervisor' : 'admin',
        loggedByName: clampString(session?.displayName || 'AVY INFRA Admin', 100),
        ...(session?.employeeId ? { loggedByEmployeeId: session.employeeId } : {}),
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          await setDoc(doc(db, 'site_logs', id), {
            ownerId: ownerUid,
            date: logEntry.date,
            projectId: logEntry.projectId,
            projectName: logEntry.projectName,
            towerId: logEntry.towerId,
            towerName: logEntry.towerName,
            notes: logEntry.notes,
            ...(cleanPhoto ? { photoDataUrl: cleanPhoto } : {}),
            loggedByRole: logEntry.loggedByRole,
            loggedByName: logEntry.loggedByName,
            ...(logEntry.loggedByEmployeeId
              ? { loggedByEmployeeId: logEntry.loggedByEmployeeId }
              : {}),
            ...tsCreate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `site_logs/${id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          dailySiteLogs: [logEntry, ...(prev.dailySiteLogs || [])],
        }));
      }

      return logEntry;
    },
    [ownerUid, cloudConnected, workspace.projects, workspace.towers, session]
  );

  const deleteDailySiteLog = useCallback(
    async (logId: string): Promise<void> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can delete daily site logs.');
      }
      if (cloudConnected) {
        try {
          await deleteDoc(doc(db, 'site_logs', logId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `site_logs/${logId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          dailySiteLogs: (prev.dailySiteLogs || []).filter((l) => l.id !== logId),
        }));
      }
    },
    [cloudConnected, session]
  );

  // --- Quotations, Invoices & GST Tax Invoices ---
  const addBillingDocument = useCallback(
    async (input: {
      docType: BillingDocType;
      docNumber?: string;
      issueDate: string;
      dueDate?: string;
      projectId?: string;
      towerId?: string;
      clientName: string;
      clientPhone?: string;
      clientEmail?: string;
      clientAddress?: string;
      clientGstin?: string;
      placeOfSupply?: string;
      taxMode: BillingTaxMode;
      items: Array<{
        id: string;
        description: string;
        hsnSac?: string;
        unit?: string;
        quantity: number;
        rate: number;
        gstRate: number;
      }>;
      amountPaid?: number;
      status?: BillingDocStatus;
      notes?: string;
      terms?: string;
    }): Promise<BillingDocument> => {
      if (session?.role === 'employee') {
        throw new Error('Employee login is read-only.');
      }
      const cleanClient = clampString(input.clientName, 140);
      if (!cleanClient) {
        throw new Error('Please enter Client / Builder name.');
      }
      const validRawItems = (input.items || []).filter((it) => (it.description || '').trim().length > 0);
      if (validRawItems.length === 0) {
        throw new Error('Please add at least one work line item.');
      }

      const proj = input.projectId ? workspace.projects.find((p) => p.id === input.projectId) : undefined;
      const twr = input.towerId ? workspace.towers.find((t) => t.id === input.towerId) : undefined;
      const issueDate = clampString(input.issueDate || getTodayIso(), 24);
      const docNumber =
        clampString(input.docNumber, 48) ||
        generateNextBillingNumber(input.docType, workspace.billingDocuments || [], issueDate);
      const totals = computeBillingTotals(validRawItems.slice(0, 50), input.taxMode);
      const status: BillingDocStatus = input.status || 'issued';
      const amountPaid =
        status === 'paid'
          ? totals.grandTotal
          : Math.max(0, Math.min(totals.grandTotal, Number(input.amountPaid) || 0));

      const nowIso = new Date().toISOString();
      const id = sanitizeId(`bill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      const docRecord: BillingDocument = {
        id,
        ownerId: ownerUid,
        docType: input.docType,
        docNumber,
        issueDate,
        dueDate: clampString(input.dueDate, 24),
        projectId: proj?.id || '',
        projectName: proj ? clampString(proj.name, 120) : '',
        towerId: twr?.id || '',
        towerName: twr ? clampString(twr.name, 80) : '',
        clientName: cleanClient,
        clientPhone: clampString(input.clientPhone, 24),
        clientEmail: clampString(input.clientEmail, 120),
        clientAddress: clampString(input.clientAddress, 300),
        clientGstin: clampString(input.clientGstin, 32).toUpperCase(),
        placeOfSupply: clampString(input.placeOfSupply, 80),
        taxMode: input.taxMode,
        items: totals.items,
        subtotal: totals.subtotal,
        cgstTotal: totals.cgstTotal,
        sgstTotal: totals.sgstTotal,
        igstTotal: totals.igstTotal,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,
        amountPaid,
        status,
        notes: clampString(input.notes, 500),
        terms: clampString(input.terms ?? DEFAULT_BILLING_TERMS, 800),
        whatsappShared: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          await setDoc(doc(db, 'billing_docs', id), {
            ownerId: ownerUid,
            docType: docRecord.docType,
            docNumber: docRecord.docNumber,
            issueDate: docRecord.issueDate,
            dueDate: docRecord.dueDate || '',
            projectId: docRecord.projectId || '',
            projectName: docRecord.projectName || '',
            towerId: docRecord.towerId || '',
            towerName: docRecord.towerName || '',
            clientName: docRecord.clientName,
            clientPhone: docRecord.clientPhone || '',
            clientEmail: docRecord.clientEmail || '',
            clientAddress: docRecord.clientAddress || '',
            clientGstin: docRecord.clientGstin || '',
            placeOfSupply: docRecord.placeOfSupply || '',
            taxMode: docRecord.taxMode,
            items: stripUndefinedDeep(docRecord.items),
            subtotal: docRecord.subtotal,
            cgstTotal: docRecord.cgstTotal,
            sgstTotal: docRecord.sgstTotal,
            igstTotal: docRecord.igstTotal,
            roundOff: docRecord.roundOff,
            grandTotal: docRecord.grandTotal,
            amountPaid: docRecord.amountPaid,
            status: docRecord.status,
            notes: docRecord.notes || '',
            terms: docRecord.terms || '',
            whatsappShared: docRecord.whatsappShared,
            ...tsCreate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `billing_docs/${id}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          billingDocuments: [docRecord, ...(prev.billingDocuments || [])],
        }));
      }
      return docRecord;
    },
    [ownerUid, cloudConnected, workspace.projects, workspace.towers, workspace.billingDocuments, session]
  );

  const updateBillingDocument = useCallback(
    async (
      docId: string,
      patch: Partial<{
        docType: BillingDocType;
        docNumber: string;
        issueDate: string;
        dueDate: string;
        projectId: string;
        towerId: string;
        clientName: string;
        clientPhone: string;
        clientEmail: string;
        clientAddress: string;
        clientGstin: string;
        placeOfSupply: string;
        taxMode: BillingTaxMode;
        items: Array<{
          id: string;
          description: string;
          hsnSac?: string;
          unit?: string;
          quantity: number;
          rate: number;
          gstRate: number;
        }>;
        amountPaid: number;
        status: BillingDocStatus;
        notes: string;
        terms: string;
        whatsappShared: boolean;
      }>
    ): Promise<void> => {
      if (session?.role === 'employee') {
        throw new Error('Employee login is read-only.');
      }
      const existing = (workspace.billingDocuments || []).find((d) => d.id === docId);
      if (!existing) return;

      const nextDocType = patch.docType ?? existing.docType;
      const nextTaxMode = patch.taxMode ?? existing.taxMode;
      const nextItemsSource = patch.items ?? existing.items;
      const validRawItems = nextItemsSource.filter((it) => (it.description || '').trim().length > 0);
      const totals = computeBillingTotals(
        (validRawItems.length > 0 ? validRawItems : existing.items).slice(0, 50),
        nextTaxMode
      );

      const projId = patch.projectId !== undefined ? patch.projectId : existing.projectId || '';
      const proj = projId ? workspace.projects.find((p) => p.id === projId) : undefined;
      const twrId = patch.towerId !== undefined ? patch.towerId : existing.towerId || '';
      const twr = twrId ? workspace.towers.find((t) => t.id === twrId) : undefined;

      const nextStatus = patch.status ?? existing.status;
      const rawPaid = patch.amountPaid !== undefined ? patch.amountPaid : existing.amountPaid;
      const nextAmountPaid =
        nextStatus === 'paid'
          ? totals.grandTotal
          : Math.max(0, Math.min(totals.grandTotal, Number(rawPaid) || 0));

      const nowIso = new Date().toISOString();
      const updatedDoc: BillingDocument = {
        ...existing,
        docType: nextDocType,
        docNumber: clampString(patch.docNumber ?? existing.docNumber, 48) || existing.docNumber,
        issueDate: clampString(patch.issueDate ?? existing.issueDate, 24) || existing.issueDate,
        dueDate: clampString(patch.dueDate ?? existing.dueDate, 24),
        projectId: proj?.id || '',
        projectName: proj ? clampString(proj.name, 120) : '',
        towerId: twr?.id || '',
        towerName: twr ? clampString(twr.name, 80) : '',
        clientName: clampString(patch.clientName ?? existing.clientName, 140) || existing.clientName,
        clientPhone: clampString(patch.clientPhone ?? existing.clientPhone, 24),
        clientEmail: clampString(patch.clientEmail ?? existing.clientEmail, 120),
        clientAddress: clampString(patch.clientAddress ?? existing.clientAddress, 300),
        clientGstin: clampString(patch.clientGstin ?? existing.clientGstin, 32).toUpperCase(),
        placeOfSupply: clampString(patch.placeOfSupply ?? existing.placeOfSupply, 80),
        taxMode: nextTaxMode,
        items: totals.items,
        subtotal: totals.subtotal,
        cgstTotal: totals.cgstTotal,
        sgstTotal: totals.sgstTotal,
        igstTotal: totals.igstTotal,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,
        amountPaid: nextAmountPaid,
        status: nextStatus,
        notes: clampString(patch.notes ?? existing.notes, 500),
        terms: clampString(patch.terms ?? existing.terms, 800),
        whatsappShared: patch.whatsappShared ?? existing.whatsappShared,
        updatedAt: nowIso,
      };

      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'billing_docs', docId), {
            docType: updatedDoc.docType,
            docNumber: updatedDoc.docNumber,
            issueDate: updatedDoc.issueDate,
            dueDate: updatedDoc.dueDate || '',
            projectId: updatedDoc.projectId || '',
            projectName: updatedDoc.projectName || '',
            towerId: updatedDoc.towerId || '',
            towerName: updatedDoc.towerName || '',
            clientName: updatedDoc.clientName,
            clientPhone: updatedDoc.clientPhone || '',
            clientEmail: updatedDoc.clientEmail || '',
            clientAddress: updatedDoc.clientAddress || '',
            clientGstin: updatedDoc.clientGstin || '',
            placeOfSupply: updatedDoc.placeOfSupply || '',
            taxMode: updatedDoc.taxMode,
            items: stripUndefinedDeep(updatedDoc.items),
            subtotal: updatedDoc.subtotal,
            cgstTotal: updatedDoc.cgstTotal,
            sgstTotal: updatedDoc.sgstTotal,
            igstTotal: updatedDoc.igstTotal,
            roundOff: updatedDoc.roundOff,
            grandTotal: updatedDoc.grandTotal,
            amountPaid: updatedDoc.amountPaid,
            status: updatedDoc.status,
            notes: updatedDoc.notes || '',
            terms: updatedDoc.terms || '',
            whatsappShared: updatedDoc.whatsappShared,
            ...tsUpdate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `billing_docs/${docId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          billingDocuments: (prev.billingDocuments || []).map((d) =>
            d.id === docId ? updatedDoc : d
          ),
        }));
      }
    },
    [cloudConnected, workspace.billingDocuments, workspace.projects, workspace.towers, session]
  );

  const convertBillingDocument = useCallback(
    async (sourceDocId: string, targetType: BillingDocType): Promise<BillingDocument> => {
      const source = (workspace.billingDocuments || []).find((d) => d.id === sourceDocId);
      if (!source) {
        throw new Error('Source billing document not found.');
      }
      const today = getTodayIso();
      return addBillingDocument({
        docType: targetType,
        docNumber: generateNextBillingNumber(targetType, workspace.billingDocuments || [], today),
        issueDate: today,
        dueDate: source.dueDate,
        projectId: source.projectId,
        towerId: source.towerId,
        clientName: source.clientName,
        clientPhone: source.clientPhone,
        clientEmail: source.clientEmail,
        clientAddress: source.clientAddress,
        clientGstin: source.clientGstin,
        placeOfSupply: source.placeOfSupply,
        taxMode: source.taxMode,
        items: source.items.map((it, idx) => ({
          id: `li_${Date.now()}_${idx}`,
          description: it.description,
          hsnSac: it.hsnSac,
          unit: it.unit,
          quantity: it.quantity,
          rate: it.rate,
          gstRate: it.gstRate,
        })),
        amountPaid: 0,
        status: 'issued',
        notes: `Converted from ${source.docNumber}. ${source.notes || ''}`.trim(),
        terms: source.terms,
      });
    },
    [workspace.billingDocuments, addBillingDocument]
  );

  const deleteBillingDocument = useCallback(
    async (docId: string): Promise<void> => {
      if (session && session.role !== 'admin') {
        throw new Error('Only Admin can delete quotations or invoices.');
      }
      if (cloudConnected) {
        try {
          await deleteDoc(doc(db, 'billing_docs', docId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `billing_docs/${docId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          billingDocuments: (prev.billingDocuments || []).filter((d) => d.id !== docId),
        }));
      }
    },
    [cloudConnected, session]
  );

  // --- Documents Drive & Smart Document Storage ---
  const saveCompanyDocument = useCallback(
    async (input: {
      id?: string;
      source: CompanyDocumentSource;
      docCategory: CompanyDocumentCategory;
      fileFormat: CompanyDocumentFormat;
      title: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      approvalStatus?: CompanyDocumentApprovalStatus;
      approvedByName?: string;
      employeeId?: string;
      empCode?: string;
      employeeName?: string;
      refNumber?: string;
      issueDate: string;
      recipient?: string;
      subject?: string;
      bodyHtml?: string;
      plainTextSummary?: string;
      deckJson?: string;
      dataUrl?: string;
    }): Promise<CompanyDocument> => {
      if (session?.role === 'employee') {
        throw new Error('Employee login is read-only.');
      }
      const nowIso = new Date().toISOString();
      const existing = input.id
        ? (workspace.companyDocuments || []).find((d) => d.id === input.id)
        : undefined;

      const emp = input.employeeId
        ? workspace.employees.find((e) => e.id === input.employeeId)
        : undefined;

      const approvalStatus: CompanyDocumentApprovalStatus =
        input.approvalStatus || existing?.approvalStatus || 'draft';

      const approverName =
        approvalStatus === 'approved'
          ? clampString(
              input.approvedByName ||
                existing?.approvedByName ||
                session?.displayName ||
                workspace.companyProfile?.signatoryName ||
                'Admin',
              100
            )
          : '';
      const approvedAt =
        approvalStatus === 'approved'
          ? clampString(existing?.approvedAt || nowIso, 40)
          : '';

      const id = existing
        ? existing.id
        : sanitizeId(`cdoc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

      const record: CompanyDocument = {
        id,
        ownerId: ownerUid,
        source: input.source,
        docCategory: input.docCategory,
        fileFormat: input.fileFormat,
        title: clampString(input.title, 160) || 'Company Document',
        fileName: clampString(input.fileName, 180) || 'document.doc',
        mimeType: clampString(input.mimeType, 120) || 'application/msword',
        sizeBytes: Math.max(1, Math.min(600000, Math.round(Number(input.sizeBytes) || 1024))),
        approvalStatus,
        approvedByName: approverName,
        approvedAt,
        employeeId: emp?.id || clampString(input.employeeId, 128),
        empCode: emp?.empCode || clampString(input.empCode, 32),
        employeeName: emp?.fullName || clampString(input.employeeName, 100),
        refNumber: clampString(input.refNumber, 80),
        issueDate: clampString(input.issueDate || getTodayIso(), 24) || getTodayIso(),
        recipient: clampString(input.recipient, 400),
        subject: clampString(input.subject, 240),
        bodyHtml: (input.bodyHtml || '').slice(0, 120000),
        plainTextSummary: (input.plainTextSummary || '').slice(0, 20000),
        deckJson: (input.deckJson || '').slice(0, 150000),
        dataUrl: (input.dataUrl || '').slice(0, 750000),
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      const firestorePayload = stripUndefinedDeep({
        source: record.source,
        docCategory: record.docCategory,
        fileFormat: record.fileFormat,
        title: record.title,
        fileName: record.fileName,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        approvalStatus: record.approvalStatus,
        approvedByName: record.approvedByName || '',
        approvedAt: record.approvedAt || '',
        employeeId: record.employeeId || '',
        empCode: record.empCode || '',
        employeeName: record.employeeName || '',
        refNumber: record.refNumber || '',
        issueDate: record.issueDate,
        recipient: record.recipient || '',
        subject: record.subject || '',
        bodyHtml: record.bodyHtml || '',
        plainTextSummary: record.plainTextSummary || '',
        deckJson: record.deckJson || '',
        dataUrl: record.dataUrl || '',
      });

      if (cloudConnected) {
        try {
          if (existing) {
            await updateDoc(doc(db, 'company_documents', id), {
              ...firestorePayload,
              ...tsUpdate(),
            });
          } else {
            await setDoc(doc(db, 'company_documents', id), {
              ownerId: ownerUid,
              ...firestorePayload,
              ...tsCreate(),
            });
          }
        } catch (err) {
          handleFirestoreError(
            err,
            existing ? OperationType.UPDATE : OperationType.CREATE,
            `company_documents/${id}`
          );
        }
      } else {
        setWorkspace((prev) => {
          const current = prev.companyDocuments || [];
          const next = existing
            ? current.map((d) => (d.id === id ? record : d))
            : [record, ...current];
          return {
            ...prev,
            companyDocuments: next,
          };
        });
      }

      return record;
    },
    [
      ownerUid,
      cloudConnected,
      session,
      workspace.companyDocuments,
      workspace.employees,
      workspace.companyProfile,
    ]
  );

  const approveCompanyDocument = useCallback(
    async (docId: string, approvedByName?: string): Promise<void> => {
      if (session?.role === 'employee') {
        throw new Error('Employee login is read-only.');
      }
      const existing = (workspace.companyDocuments || []).find((d) => d.id === docId);
      if (!existing) return;
      const nowIso = new Date().toISOString();
      const approver = clampString(
        approvedByName ||
          session?.displayName ||
          workspace.companyProfile?.signatoryName ||
          'Admin',
        100
      );

      if (cloudConnected) {
        try {
          await updateDoc(doc(db, 'company_documents', docId), {
            approvalStatus: 'approved',
            approvedByName: approver,
            approvedAt: nowIso,
            ...tsUpdate(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `company_documents/${docId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          companyDocuments: (prev.companyDocuments || []).map((d) =>
            d.id === docId
              ? {
                  ...d,
                  approvalStatus: 'approved',
                  approvedByName: approver,
                  approvedAt: nowIso,
                  updatedAt: nowIso,
                }
              : d
          ),
        }));
      }
    },
    [cloudConnected, session, workspace.companyDocuments, workspace.companyProfile]
  );

  const deleteCompanyDocument = useCallback(
    async (docId: string): Promise<void> => {
      if (session?.role === 'employee') {
        throw new Error('Employee login is read-only.');
      }
      if (cloudConnected) {
        try {
          await deleteDoc(doc(db, 'company_documents', docId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `company_documents/${docId}`);
        }
      } else {
        setWorkspace((prev) => ({
          ...prev,
          companyDocuments: (prev.companyDocuments || []).filter((d) => d.id !== docId),
        }));
      }
    },
    [cloudConnected, session]
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      ...workspace,
      user,
      authReady,
      cloudConnected,
      cloudLoading,
      syncError,
      session,
      loginWithCredentials,
      logoutSession,
      signInWithGoogle,
      signOutUser,
      seedCloudFromLocal,
      resetDemoData,
      updateCompanyProfile,
      updateTileZoneCatalog,
      addCustomZoneToFlat,
      addCustomZoneToWholeFloor,
      addCustomZonesToWholeFloor,
      upsertFloorCommonAreas,
      renameFlatZone,
      removeFlatZone,
      addProject,
      updateProject,
      addTowerWithUnits,
      updateTower,
      addCustomFloorUnits,
      removeTower,
      removeFlat,
      updateFlatZone,
      addEmployee,
      updateEmployee,
      addEmployeeDocument,
      deleteEmployeeDocument,
      deployEmployeeToSite,
      bulkAllocateEmployeesToTower,
      ensureEmployeeQrPass,
      assignWorkToFlat,
      completeAssignment,
      markAttendance,
      editLockedAttendance,
      bulkMarkAttendancePresent,
      deleteAttendanceRecord,
      addAdvance,
      bulkAddAdvances,
      addSundayWeeklyFoodBatch,
      markAdvanceWhatsappShared,
      acknowledgeAdvance,
      recordAdvanceFollowUpSent,
      addExpense,
      deleteExpense,
      recordSettlement,
      deleteAdvance,
      addDailySiteLog,
      deleteDailySiteLog,
      addBillingDocument,
      updateBillingDocument,
      convertBillingDocument,
      deleteBillingDocument,
      saveCompanyDocument,
      approveCompanyDocument,
      deleteCompanyDocument,
    }),
    [
      workspace,
      user,
      authReady,
      cloudConnected,
      cloudLoading,
      syncError,
      session,
      loginWithCredentials,
      logoutSession,
      signInWithGoogle,
      signOutUser,
      seedCloudFromLocal,
      resetDemoData,
      updateCompanyProfile,
      updateTileZoneCatalog,
      addCustomZoneToFlat,
      addCustomZoneToWholeFloor,
      addCustomZonesToWholeFloor,
      upsertFloorCommonAreas,
      renameFlatZone,
      removeFlatZone,
      addProject,
      updateProject,
      addTowerWithUnits,
      updateTower,
      addCustomFloorUnits,
      removeTower,
      removeFlat,
      updateFlatZone,
      addEmployee,
      updateEmployee,
      addEmployeeDocument,
      deleteEmployeeDocument,
      deployEmployeeToSite,
      bulkAllocateEmployeesToTower,
      ensureEmployeeQrPass,
      assignWorkToFlat,
      completeAssignment,
      markAttendance,
      editLockedAttendance,
      bulkMarkAttendancePresent,
      deleteAttendanceRecord,
      addAdvance,
      bulkAddAdvances,
      addSundayWeeklyFoodBatch,
      markAdvanceWhatsappShared,
      acknowledgeAdvance,
      recordAdvanceFollowUpSent,
      addExpense,
      deleteExpense,
      recordSettlement,
      deleteAdvance,
      addDailySiteLog,
      deleteDailySiteLog,
      addBillingDocument,
      updateBillingDocument,
      convertBillingDocument,
      deleteBillingDocument,
      saveCompanyDocument,
      approveCompanyDocument,
      deleteCompanyDocument,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
