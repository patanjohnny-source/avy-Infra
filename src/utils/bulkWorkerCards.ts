import type {
  AdvanceEntry,
  AttendanceRecord,
  CompanyProfile,
  DeploymentRecord,
  Employee,
  Project,
  SettlementEntry,
  Tower,
  WorkAssignment,
} from '../types/avy';
import {
  type SingleEmployeeAttendanceCard,
  computeSingleEmployeeAttendanceCard,
} from './operations';
import { type EmployeePayrollSummary, computeEmployeePayroll } from './payroll';
import { buildEmployeeQrPassData, buildEmployeeQrScanUrl } from './qrProfile';

export type BulkPaperSize = 'a4' | 'letter';
export type BulkCardLayout = 'profile_attendance_2up' | 'id_grid_4up' | 'id_grid_6up';

export interface BulkPaperSpec {
  id: BulkPaperSize;
  label: string;
  shortLabel: string;
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: number;
  contentWidthMm: number;
  contentHeightMm: number;
}

export interface BulkCardLayoutSpec {
  id: BulkCardLayout;
  label: string;
  shortLabel: string;
  cardsPerPage: number;
  columns: number;
  rows: number;
  description: string;
}

export const BULK_PAPER_SPECS: Record<BulkPaperSize, BulkPaperSpec> = {
  a4: {
    id: 'a4',
    label: 'A4 Portrait (210 × 297 mm)',
    shortLabel: 'A4',
    pageWidthMm: 210,
    pageHeightMm: 297,
    marginMm: 8,
    contentWidthMm: 194,
    contentHeightMm: 281,
  },
  letter: {
    id: 'letter',
    label: 'US Letter (8.5 × 11 in / 216 × 279 mm)',
    shortLabel: 'Letter',
    pageWidthMm: 215.9,
    pageHeightMm: 279.4,
    marginMm: 8,
    contentWidthMm: 199.9,
    contentHeightMm: 263.4,
  },
};

export const BULK_CARD_LAYOUT_SPECS: Record<BulkCardLayout, BulkCardLayoutSpec> = {
  profile_attendance_2up: {
    id: 'profile_attendance_2up',
    label: '2-Up Detailed Profile & Attendance (2 / page)',
    shortLabel: '2-Up Profile + Muster',
    cardsPerPage: 2,
    columns: 1,
    rows: 2,
    description: 'Full profile, QR pass, statutory IDs & 31-day attendance strip',
  },
  id_grid_4up: {
    id: 'id_grid_4up',
    label: '4-Up Vertical ID & Attendance Cards (4 / page)',
    shortLabel: '4-Up ID Cards',
    cardsPerPage: 4,
    columns: 2,
    rows: 2,
    description: '2×2 portrait worker ID + attendance summary cards with cut guides',
  },
  id_grid_6up: {
    id: 'id_grid_6up',
    label: '6-Up Compact Wallet Pass Grid (6 / page)',
    shortLabel: '6-Up Wallet Grid',
    cardsPerPage: 6,
    columns: 2,
    rows: 3,
    description: 'High-density 2×3 pocket ID + QR + monthly attendance summary',
  },
};

export function getBulkPaperSpec(paperSize: BulkPaperSize): BulkPaperSpec {
  return BULK_PAPER_SPECS[paperSize] || BULK_PAPER_SPECS.a4;
}

export function getBulkCardLayoutSpec(layout: BulkCardLayout): BulkCardLayoutSpec {
  return BULK_CARD_LAYOUT_SPECS[layout] || BULK_CARD_LAYOUT_SPECS.profile_attendance_2up;
}

export interface BulkCardPage<T> {
  pageNumber: number;
  totalPages: number;
  cards: T[];
  emptySlots: number;
}

/**
 * Splits a selected worker list cleanly into fixed-capacity pages without splitting individual cards.
 */
export function paginateBulkWorkerCards<T>(
  items: T[],
  cardsPerPage: number
): BulkCardPage<T>[] {
  const safePerPage = Math.max(1, Math.floor(cardsPerPage) || 1);
  if (items.length === 0) return [];

  const totalPages = Math.ceil(items.length / safePerPage);
  const pages: BulkCardPage<T>[] = [];
  for (let p = 0; p < totalPages; p++) {
    const start = p * safePerPage;
    const slice = items.slice(start, start + safePerPage);
    pages.push({
      pageNumber: p + 1,
      totalPages,
      cards: slice,
      emptySlots: Math.max(0, safePerPage - slice.length),
    });
  }
  return pages;
}

export function toggleBulkWorkerSelection(selectedIds: string[], employeeId: string): string[] {
  if (!employeeId) return selectedIds;
  return selectedIds.includes(employeeId)
    ? selectedIds.filter((id) => id !== employeeId)
    : [...selectedIds, employeeId];
}

export function setBulkWorkersSelection(
  currentSelectedIds: string[],
  targetEmployees: Employee[],
  action: 'replace' | 'add' | 'remove' | 'clear'
): string[] {
  if (action === 'clear') return [];
  const targetIds = targetEmployees.map((e) => e.id);
  if (action === 'replace') return Array.from(new Set(targetIds));
  if (action === 'add') return Array.from(new Set([...currentSelectedIds, ...targetIds]));
  const removeSet = new Set(targetIds);
  return currentSelectedIds.filter((id) => !removeSet.has(id));
}

export function resolveBulkWorkerSiteLabel(emp: Employee): string {
  if (!emp.currentProjectName) return 'Unassigned / Standby';
  return emp.currentTowerName
    ? `${emp.currentProjectName} · ${emp.currentTowerName}`
    : emp.currentProjectName;
}

export interface BulkWorkerCardModel {
  employee: Employee;
  initials: string;
  siteLabel: string;
  scanUrl: string;
  attendanceCard: SingleEmployeeAttendanceCard;
  payrollSummary: EmployeePayrollSummary;
}

export function buildBulkWorkerCardModels(params: {
  employees: Employee[];
  company: CompanyProfile;
  projects: Project[];
  towers: Tower[];
  deployments: DeploymentRecord[];
  assignments: WorkAssignment[];
  attendance: AttendanceRecord[];
  advances: AdvanceEntry[];
  settlements: SettlementEntry[];
  yearMonth: string;
  origin?: string;
}): BulkWorkerCardModel[] {
  const {
    employees,
    company,
    projects,
    towers,
    deployments,
    assignments,
    attendance,
    advances,
    settlements,
    yearMonth,
    origin = typeof window !== 'undefined' ? window.location.origin : '',
  } = params;

  return employees.map((emp) => {
    const initials =
      emp.fullName
        .split(' ')
        .map((s) => s.trim()[0])
        .filter(Boolean)
        .join('')
        .slice(0, 2)
        .toUpperCase() || 'ID';

    const passData = buildEmployeeQrPassData({
      employee: emp,
      companyName: company.companyName || 'AVY INFRA',
      projects,
      towers,
      deployments,
      assignments,
      attendance,
    });

    const scanUrl = buildEmployeeQrScanUrl({
      origin,
      passData,
      qrToken: emp.qrToken,
    });

    const attendanceCard = computeSingleEmployeeAttendanceCard({
      employee: emp,
      yearMonth,
      attendance,
      advances,
    });

    const payrollSummary = computeEmployeePayroll(emp, attendance, advances, settlements);

    return {
      employee: emp,
      initials,
      siteLabel: resolveBulkWorkerSiteLabel(emp),
      scanUrl,
      attendanceCard,
      payrollSummary,
    };
  });
}
