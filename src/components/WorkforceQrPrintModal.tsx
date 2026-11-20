import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Printer,
  QrCode,
  Search,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { Employee, EmployeeRole, Project, Tower } from '../types/avy';
import { buildWorkforceQrSheetPdfBlob } from '../utils/idCardPdf';
import { buildEmployeeQrPassData, buildEmployeeQrScanUrl } from '../utils/qrProfile';
import { QrCodeSvg } from './QrCodeSvg';

interface WorkforceQrPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  projects: Project[];
  towers: Tower[];
  initialEmployeeId?: string;
  onPreviewQrProfile: (scanUrl: string) => void;
}

const ROLE_OPTIONS: Array<'All' | EmployeeRole> = [
  'All',
  'Mason',
  'Helper',
  'Material Shifting',
  'Supervisor',
  'Engineer',
];

export function WorkforceQrPrintModal({
  isOpen,
  onClose,
  employees,
  projects,
  towers,
  initialEmployeeId,
  onPreviewQrProfile,
}: WorkforceQrPrintModalProps) {
  const {
    companyProfile,
    deployments,
    assignments,
    attendance,
    ensureEmployeeQrPass,
  } = useStore();

  const [layout, setLayout] = useState<'badges' | 'stickers'>('badges');
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [towerFilter, setTowerFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState<'All' | EmployeeRole>('All');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [qrUrlMap, setQrUrlMap] = useState<Record<string, string>>({});
  const [busyPdf, setBusyPdf] = useState(false);
  const [busyPrint, setBusyPrint] = useState(false);
  const [copiedEmpId, setCopiedEmpId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setStatusMessage('');
    setCopiedEmpId(null);
    if (initialEmployeeId) {
      setSelectedIds([initialEmployeeId]);
    } else {
      setSelectedIds(employees.filter((e) => e.status === 'active').map((e) => e.id));
    }
  }, [isOpen, initialEmployeeId, employees]);

  const filterTowers = useMemo(() => {
    if (projectFilter === 'all') return towers;
    return towers.filter((t) => t.projectId === projectFilter);
  }, [towers, projectFilter]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((emp) => {
      if (roleFilter !== 'All' && emp.role !== roleFilter) return false;
      if (projectFilter !== 'all' && emp.currentProjectId !== projectFilter) return false;
      if (towerFilter !== 'all' && emp.currentTowerId !== towerFilter) return false;
      if (q) {
        return (
          emp.fullName.toLowerCase().includes(q) ||
          emp.empCode.toLowerCase().includes(q) ||
          emp.role.toLowerCase().includes(q) ||
          (emp.currentProjectName || '').toLowerCase().includes(q) ||
          (emp.currentTowerName || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [employees, roleFilter, projectFilter, towerFilter, searchQuery]);

  const selectedEmployees = useMemo(() => {
    const set = new Set(selectedIds);
    return employees.filter((e) => set.has(e.id));
  }, [employees, selectedIds]);

  // Precompute deterministic QR scan URLs for instant SVG rendering
  const fallbackScanUrls = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const map: Record<string, string> = {};
    for (const emp of selectedEmployees) {
      const passData = buildEmployeeQrPassData({
        employee: emp,
        companyName: companyProfile.companyName || 'AVY INFRA',
        projects,
        towers,
        deployments,
        assignments,
        attendance,
      });
      map[emp.id] = buildEmployeeQrScanUrl({
        origin,
        passData,
        qrToken: emp.qrToken,
      });
    }
    return map;
  }, [
    selectedEmployees,
    companyProfile.companyName,
    projects,
    towers,
    deployments,
    assignments,
    attendance,
  ]);

  // Lazily backfill persistent qrToken + Firestore qr_passes for selected employees
  useEffect(() => {
    if (!isOpen || selectedEmployees.length === 0) return;
    let active = true;
    const syncTokens = async () => {
      const entries: Array<[string, string]> = [];
      for (const emp of selectedEmployees) {
        const res = await ensureEmployeeQrPass(emp.id);
        if (!active) return;
        entries.push([emp.id, res.scanUrl]);
      }
      if (active && entries.length > 0) {
        setQrUrlMap((prev) => {
          const next = { ...prev };
          for (const [id, url] of entries) {
            next[id] = url;
          }
          return next;
        });
      }
    };
    void syncTokens();
    return () => {
      active = false;
    };
  }, [isOpen, selectedEmployees, ensureEmployeeQrPass]);

  if (!isOpen) return null;

  const getScanUrl = (emp: Employee) => qrUrlMap[emp.id] || fallbackScanUrls[emp.id] || '';

  const getSiteLabel = (emp: Employee) =>
    emp.currentProjectName
      ? `${emp.currentProjectName}${emp.currentTowerName ? ` · ${emp.currentTowerName}` : ''}`
      : 'Unassigned';

  const ensureAllSelectedSynced = async (): Promise<Record<string, string>> => {
    const resolved: Record<string, string> = {};
    for (const emp of selectedEmployees) {
      const res = await ensureEmployeeQrPass(emp.id);
      resolved[emp.id] = res.scanUrl;
    }
    setQrUrlMap((prev) => ({ ...prev, ...resolved }));
    return resolved;
  };

  const handlePrintSheet = async () => {
    if (selectedEmployees.length === 0) return;
    setBusyPrint(true);
    setStatusMessage('');
    try {
      await ensureAllSelectedSynced();
      window.print();
    } finally {
      setBusyPrint(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (selectedEmployees.length === 0) return;
    setBusyPdf(true);
    setStatusMessage('');
    try {
      const syncedUrls = await ensureAllSelectedSynced();
      const items = selectedEmployees.map((emp) => ({
        empCode: emp.empCode,
        fullName: emp.fullName,
        role: emp.role,
        siteLabel: getSiteLabel(emp),
        status: emp.status,
        scanUrl: syncedUrls[emp.id] || getScanUrl(emp),
      }));
      const { blob, fileName } = await buildWorkforceQrSheetPdfBlob({
        companyName: companyProfile.companyName || 'AVY INFRA',
        layout,
        items,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setStatusMessage(`Downloaded printable PDF "${fileName}" (${items.length} QR cards).`);
    } finally {
      setBusyPdf(false);
    }
  };

  const handleCopyUrl = async (emp: Employee) => {
    const url = getScanUrl(emp);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedEmpId(emp.id);
      setStatusMessage(`Copied QR verification link for ${emp.fullName} (${emp.empCode}).`);
      setTimeout(() => {
        setCopiedEmpId((prev) => (prev === emp.id ? null : prev));
      }, 2500);
    } catch {
      setStatusMessage(`QR link ready for ${emp.empCode}: ${url}`);
    }
  };

  const toggleEmp = (empId: string) => {
    setSelectedIds((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-sheet-modal-title"
    >
      <div className="w-full max-w-5xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="no-print flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-start gap-2.5 min-w-0">
            <QrCode className="w-5 h-5 text-orange-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="qr-sheet-modal-title" className="text-base font-semibold text-slate-900">
                Workforce QR Code Generator &amp; Print Sheet
              </h2>
              <p className="text-xs text-slate-500">
                Generate &amp; print site verification QR badges — scanning shows read-only deployment &amp; active work status
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR print modal"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body (Filters + Printable QR Sheet) */}
        <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Filter & Selection Toolbar */}
        <div className="no-print px-5 sm:px-6 py-3.5 bg-slate-50 border-b border-slate-200 space-y-3 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
              <input
                type="text"
                aria-label="Filter workers for QR sheet"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search ID, name, role..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              />
            </div>

            <select
              aria-label="Filter QR sheet by project"
              value={projectFilter}
              onChange={(e) => {
                setProjectFilter(e.target.value);
                setTowerFilter('all');
              }}
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter QR sheet by tower"
              value={towerFilter}
              onChange={(e) => setTowerFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              <option value="all">All Towers</option>
              {filterTowers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter QR sheet by role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as 'All' | EmployeeRole)}
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r === 'All' ? 'All Roles' : r}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Multi-select chips */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSelectedIds(filteredEmployees.map((e) => e.id))}
                className="px-2.5 py-1 font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100 whitespace-nowrap"
              >
                Select Filtered ({filteredEmployees.length})
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(
                    filteredEmployees.filter((e) => e.status === 'active').map((e) => e.id)
                  )
                }
                className="px-2.5 py-1 font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 whitespace-nowrap"
              >
                Active Only
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="px-2.5 py-1 font-medium text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-100 whitespace-nowrap"
              >
                Clear ({selectedIds.length})
              </button>
            </div>

            {/* Layout Selector */}
            <div className="grid grid-cols-2 w-full sm:w-auto sm:inline-flex items-center bg-slate-200/80 p-0.5 rounded-md text-xs">
              <button
                type="button"
                onClick={() => setLayout('badges')}
                className={`px-2.5 sm:px-3 py-1.5 font-medium rounded whitespace-nowrap transition-colors text-center ${
                  layout === 'badges'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Lanyard Badges (6/pg)
              </button>
              <button
                type="button"
                onClick={() => setLayout('stickers')}
                className={`px-2.5 sm:px-3 py-1.5 font-medium rounded whitespace-nowrap transition-colors text-center ${
                  layout === 'stickers'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Compact Stickers (12/pg)
              </button>
            </div>
          </div>

          {/* Compact Worker Selection Checklist */}
          {filteredEmployees.length > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1">
              {filteredEmployees.map((emp) => {
                const isSelected = selectedIds.includes(emp.id);
                return (
                  <label
                    key={emp.id}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border cursor-pointer select-none ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleEmp(emp.id)}
                      className="sr-only"
                    />
                    <span className="font-mono text-[11px]">{emp.empCode}</span>
                    <span className="truncate max-w-[130px]">{emp.fullName}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Printable Sheet Preview */}
        <div className="id-card-print-area flex-1 p-5 sm:p-6 bg-slate-100/80 space-y-4">
          <div className="hidden print:block mb-3 border-b border-slate-300 pb-2">
            <div className="text-sm font-bold text-slate-900">
              {companyProfile.companyName} — Workforce Site QR Verification{' '}
              {layout === 'stickers' ? 'Stickers' : 'Badges'}
            </div>
            <div className="text-[11px] text-slate-600">
              Scan any QR code to inspect live read-only site deployment and active flat/zone work status.
            </div>
          </div>

          {statusMessage && (
            <div className="no-print p-2.5 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md">
              {statusMessage}
            </div>
          )}

          {selectedEmployees.length === 0 ? (
            <div className="no-print py-14 text-center bg-white border border-slate-200 rounded-lg space-y-2">
              <QrCode className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
              <div className="text-sm font-medium text-slate-900">
                No Employees Selected for QR Sheet
              </div>
              <p className="text-xs text-slate-500">
                Select one or more workers above to generate printable QR badges or stickers.
              </p>
            </div>
          ) : layout === 'badges' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-4">
              {selectedEmployees.map((emp) => {
                const scanUrl = getScanUrl(emp);
                const siteLabel = getSiteLabel(emp);
                return (
                  <article
                    key={emp.id}
                    data-testid={`qr-badge-${emp.empCode}`}
                    className="qr-print-card bg-white border border-slate-300 rounded-lg overflow-hidden flex flex-col justify-between shadow-sm"
                  >
                    <div>
                      <div className="bg-slate-900 text-white px-3.5 py-2 flex items-center justify-between gap-2">
                        <span className="font-display font-bold text-xs tracking-tight truncate">
                          {companyProfile.companyName}
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-orange-300 shrink-0">
                          {emp.empCode}
                        </span>
                      </div>
                      <div className="h-1 bg-orange-700" />
                    </div>

                    <div className="p-4 flex flex-col items-center text-center gap-2.5">
                      <div className="p-2 bg-white border border-slate-200 rounded-md">
                        <QrCodeSvg
                          value={scanUrl}
                          size={136}
                          ariaLabel={`QR verification code for ${emp.fullName}`}
                        />
                      </div>

                      <div className="space-y-0.5 w-full min-w-0">
                        <div className="font-display font-bold text-sm text-slate-900 truncate">
                          {emp.fullName}
                        </div>
                        <div className="text-xs font-mono font-semibold text-orange-700">
                          {emp.role} · {emp.status === 'active' ? 'Active' : 'Inactive'}
                        </div>
                        <div className="text-xs text-slate-600 truncate" title={siteLabel}>
                          {siteLabel}
                        </div>
                      </div>
                    </div>

                    <div className="px-3.5 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span className="font-mono uppercase">Scan for live site status</span>
                      <div className="no-print flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleCopyUrl(emp)}
                          title="Copy QR scan link"
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 whitespace-nowrap"
                        >
                          {copiedEmpId === emp.id ? (
                            <Check className="w-3 h-3 text-emerald-700" aria-hidden="true" />
                          ) : (
                            <Copy className="w-3 h-3" aria-hidden="true" />
                          )}
                          <span>{copiedEmpId === emp.id ? 'Copied' : 'Link'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onPreviewQrProfile(scanUrl);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100 whitespace-nowrap"
                        >
                          <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          <span>Preview Profile</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 print:grid-cols-3 gap-3">
              {selectedEmployees.map((emp) => {
                const scanUrl = getScanUrl(emp);
                const siteLabel = getSiteLabel(emp);
                return (
                  <article
                    key={emp.id}
                    data-testid={`qr-sticker-${emp.empCode}`}
                    className="qr-print-card bg-white border border-slate-300 rounded-md overflow-hidden flex flex-col justify-between text-center"
                  >
                    <div>
                      <div className="bg-slate-900 text-white px-2.5 py-1.5 flex items-center justify-between gap-1 text-[10px]">
                        <span className="font-bold truncate">{companyProfile.companyName}</span>
                        <span className="font-mono text-orange-300 shrink-0">{emp.empCode}</span>
                      </div>
                      <div className="h-0.5 bg-orange-700" />
                    </div>

                    <div className="p-2.5 flex flex-col items-center gap-1.5">
                      <QrCodeSvg
                        value={scanUrl}
                        size={104}
                        ariaLabel={`QR sticker for ${emp.fullName}`}
                      />
                      <div className="w-full min-w-0">
                        <div className="font-semibold text-xs text-slate-900 truncate">
                          {emp.fullName}
                        </div>
                        <div className="text-[11px] font-medium text-orange-700 truncate">
                          {emp.role}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate" title={siteLabel}>
                          {siteLabel}
                        </div>
                      </div>
                    </div>

                    <div className="no-print px-2 py-1.5 bg-slate-50 border-t border-slate-200 flex justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onPreviewQrProfile(scanUrl);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-800 hover:underline whitespace-nowrap"
                      >
                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        <span>Preview</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
        </div>

        {/* Footer Actions */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-4 bg-white border-t border-slate-200 shrink-0">
          <div className="text-xs text-slate-600 font-mono tabular-nums">
            {selectedEmployees.length} worker QR{selectedEmployees.length === 1 ? '' : 's'} ready ·{' '}
            {layout === 'badges' ? '6 badges / A4 page' : '12 stickers / A4 page'}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={selectedEmployees.length === 0 || busyPrint}
              onClick={handlePrintSheet}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <Printer className="w-4 h-4" aria-hidden="true" />
              <span>{busyPrint ? 'Preparing...' : 'Print QR Sheet'}</span>
            </button>

            <button
              type="button"
              disabled={selectedEmployees.length === 0 || busyPdf}
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              <span>{busyPdf ? 'Building PDF...' : 'Download QR PDF'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
