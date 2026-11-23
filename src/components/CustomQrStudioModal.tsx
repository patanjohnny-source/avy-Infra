import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Copy,
  Download,
  ExternalLink,
  MapPin,
  Printer,
  QrCode,
  Search,
  Users,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type {
  CustomQrAccentTheme,
  CustomQrErrorLevel,
  CustomQrLayout,
  CustomQrTargetKind,
  Employee,
  EmployeeRole,
  Project,
  Tower,
} from '../types/avy';
import { isAdminSession } from '../utils/authAccess';
import { buildCustomQrSheetPdfBlob, type CustomQrSheetItem } from '../utils/idCardPdf';
import {
  buildEmployeeQrPassData,
  buildEmployeeQrScanUrl,
  buildSiteQrPassData,
  buildSiteQrScanUrl,
  CUSTOM_QR_ACCENT_THEMES,
  SITE_CHECKPOINT_PRESETS,
} from '../utils/qrProfile';
import { QrCodeSvg } from './QrCodeSvg';

export interface CustomQrStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  projects: Project[];
  towers: Tower[];
  defaultTarget?: CustomQrTargetKind;
  initialEmployeeId?: string;
  initialProjectId?: string;
  initialTowerId?: string;
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

const THEME_IDS: CustomQrAccentTheme[] = [
  'navy_orange',
  'emerald_slate',
  'indigo_sky',
  'charcoal_amber',
];

interface SiteTargetOption {
  id: string;
  project: Project;
  tower?: Tower;
  label: string;
  subLabel: string;
}

export function CustomQrStudioModal({
  isOpen,
  onClose,
  employees,
  projects,
  towers,
  defaultTarget = 'employees',
  initialEmployeeId,
  initialProjectId,
  initialTowerId,
  onPreviewQrProfile,
}: CustomQrStudioModalProps) {
  const {
    session,
    companyProfile,
    flats,
    deployments,
    assignments,
    attendance,
    ensureEmployeeQrPass,
  } = useStore();

  const isAdmin = isAdminSession(session);
  const companyName = companyProfile?.companyName || 'AVY INFRA';

  const [targetKind, setTargetKind] = useState<CustomQrTargetKind>(defaultTarget);
  const [layout, setLayout] = useState<CustomQrLayout>(
    defaultTarget === 'sites' ? 'posters' : 'badges'
  );
  const [themeId, setThemeId] = useState<CustomQrAccentTheme>('navy_orange');
  const [errorCorrection, setErrorCorrection] = useState<CustomQrErrorLevel>('M');
  const [showCompanyHeader, setShowCompanyHeader] = useState(true);
  const [showMetaDetails, setShowMetaDetails] = useState(true);

  // Employee selection & filters
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [towerFilter, setTowerFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState<'All' | EmployeeRole>('All');
  const [selectedEmpIds, setSelectedEmpIds] = useState<string[]>([]);
  const [qrUrlMap, setQrUrlMap] = useState<Record<string, string>>({});

  // Site selection & customization
  const [siteProjectFilter, setSiteProjectFilter] = useState('all');
  const [selectedSiteTargetIds, setSelectedSiteTargetIds] = useState<string[]>([]);
  const [checkpointLabel, setCheckpointLabel] = useState('Main Site Gate');
  const [customTitle, setCustomTitle] = useState('');
  const [customFooterNote, setCustomFooterNote] = useState(
    'Scan QR for live site status & attendance check-in'
  );

  const [busyPdf, setBusyPdf] = useState(false);
  const [busyPrint, setBusyPrint] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  const allSiteTargets = useMemo<SiteTargetOption[]>(() => {
    const list: SiteTargetOption[] = [];
    for (const proj of projects) {
      const projTowers = towers.filter((t) => t.projectId === proj.id);
      if (isAdmin || projTowers.length === 0) {
        list.push({
          id: `site:${proj.id}`,
          project: proj,
          label: `${proj.name} (Main Site)`,
          subLabel: proj.location || 'Project Gate',
        });
      }
      for (const twr of projTowers) {
        list.push({
          id: `tower:${twr.id}`,
          project: proj,
          tower: twr,
          label: `${proj.name} · ${twr.name}`,
          subLabel: `${twr.totalFloors} Floors · ${twr.supervisorName ? `Sup: ${twr.supervisorName}` : proj.location}`,
        });
      }
    }
    return list;
  }, [projects, towers, isAdmin]);

  // Reset modal controls cleanly whenever opened
  useEffect(() => {
    if (!isOpen) return;
    setTargetKind(defaultTarget);
    setLayout(defaultTarget === 'sites' ? 'posters' : 'badges');
    setStatusMessage('');
    setCopiedKey(null);

    if (initialEmployeeId) {
      setSelectedEmpIds([initialEmployeeId]);
    } else {
      setSelectedEmpIds(employees.filter((e) => e.status === 'active').map((e) => e.id));
    }

    const initProj = initialProjectId && initialProjectId !== 'all' ? initialProjectId : 'all';
    setSiteProjectFilter(initProj);

    if (initialTowerId && initialTowerId !== 'all') {
      setSelectedSiteTargetIds([`tower:${initialTowerId}`]);
      setCheckpointLabel('Tower Entrance');
    } else if (initProj !== 'all') {
      const scopedIds = allSiteTargets
        .filter((t) => t.project.id === initProj)
        .map((t) => t.id);
      setSelectedSiteTargetIds(scopedIds.length > 0 ? scopedIds : allSiteTargets.map((t) => t.id));
      setCheckpointLabel(isAdmin ? 'Main Site Gate' : 'Tower Entrance');
    } else {
      setSelectedSiteTargetIds(allSiteTargets.map((t) => t.id));
      setCheckpointLabel(isAdmin ? 'Main Site Gate' : 'Tower Entrance');
    }
  }, [
    isOpen,
    defaultTarget,
    initialEmployeeId,
    initialProjectId,
    initialTowerId,
    employees,
    allSiteTargets,
    isAdmin,
  ]);

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
    const set = new Set(selectedEmpIds);
    return employees.filter((e) => set.has(e.id));
  }, [employees, selectedEmpIds]);

  const filteredSiteTargets = useMemo(() => {
    if (siteProjectFilter === 'all') return allSiteTargets;
    return allSiteTargets.filter((t) => t.project.id === siteProjectFilter);
  }, [allSiteTargets, siteProjectFilter]);

  const selectedSiteTargets = useMemo(() => {
    const set = new Set(selectedSiteTargetIds);
    return allSiteTargets.filter((t) => set.has(t.id));
  }, [allSiteTargets, selectedSiteTargetIds]);

  // Precompute deterministic Employee QR URLs
  const fallbackEmpScanUrls = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const map: Record<string, string> = {};
    for (const emp of selectedEmployees) {
      const passData = buildEmployeeQrPassData({
        employee: emp,
        companyName,
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
  }, [selectedEmployees, companyName, projects, towers, deployments, assignments, attendance]);

  // Backfill persistent qrToken + Firestore qr_passes for selected employees
  useEffect(() => {
    if (!isOpen || targetKind !== 'employees' || selectedEmployees.length === 0) return;
    let active = true;
    const syncTokens = async () => {
      const entries: Array<[string, string]> = [];
      for (const emp of selectedEmployees) {
        try {
          const res = await ensureEmployeeQrPass(emp.id);
          if (!active) return;
          entries.push([emp.id, res.scanUrl]);
        } catch {
          // Deterministic fallback URL remains active
        }
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
  }, [isOpen, targetKind, selectedEmployees, ensureEmployeeQrPass]);

  // Precompute Project Site & Tower QR scan payloads + URLs
  const siteQrCards = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const cleanFooter = customFooterNote.trim() || 'Scan QR for live site status & attendance check-in';
    return selectedSiteTargets.map((target) => {
      const pass = buildSiteQrPassData({
        project: target.project,
        tower: target.tower,
        companyName,
        checkpointLabel: checkpointLabel.trim() || (target.tower ? 'Tower Entrance' : 'Main Site Gate'),
        customTitle: customTitle.trim() || undefined,
        customSubtitle: cleanFooter,
        employees,
        flats,
        attendance,
      });
      const scanUrl = buildSiteQrScanUrl({ origin, passData: pass });
      const title =
        customTitle.trim() ||
        (target.tower ? `${target.project.name} · ${target.tower.name}` : target.project.name);
      const subtitle = `${pass.checkpointLabel} · ${pass.activeCrewCount} Crew · ${pass.totalFlats} Flats`;
      const metaLine = `${pass.location}${
        target.tower?.supervisorName ? ` · Sup: ${target.tower.supervisorName}` : ''
      }`;
      return {
        target,
        pass,
        scanUrl,
        title,
        subtitle,
        metaLine,
        footerLabel: cleanFooter,
      };
    });
  }, [
    selectedSiteTargets,
    companyName,
    checkpointLabel,
    customTitle,
    customFooterNote,
    employees,
    flats,
    attendance,
  ]);

  if (!isOpen) return null;

  const theme = CUSTOM_QR_ACCENT_THEMES[themeId];
  const getEmpScanUrl = (emp: Employee) => qrUrlMap[emp.id] || fallbackEmpScanUrls[emp.id] || '';
  const getSiteLabel = (emp: Employee) =>
    emp.currentProjectName
      ? `${emp.currentProjectName}${emp.currentTowerName ? ` · ${emp.currentTowerName}` : ''}`
      : 'Unassigned';

  const activeCount =
    targetKind === 'employees' ? selectedEmployees.length : siteQrCards.length;

  const ensureAllSelectedEmployeesSynced = async (): Promise<Record<string, string>> => {
    const resolved: Record<string, string> = {};
    for (const emp of selectedEmployees) {
      try {
        const res = await ensureEmployeeQrPass(emp.id);
        resolved[emp.id] = res.scanUrl;
      } catch {
        resolved[emp.id] = getEmpScanUrl(emp);
      }
    }
    setQrUrlMap((prev) => ({ ...prev, ...resolved }));
    return resolved;
  };

  const handlePrintSheet = async () => {
    if (activeCount === 0) return;
    setBusyPrint(true);
    setStatusMessage('');
    try {
      if (targetKind === 'employees') {
        await ensureAllSelectedEmployeesSynced();
      }
      window.print();
    } finally {
      setBusyPrint(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (activeCount === 0) return;
    setBusyPdf(true);
    setStatusMessage('');
    try {
      let pdfItems: CustomQrSheetItem[] = [];
      if (targetKind === 'employees') {
        const synced = await ensureAllSelectedEmployeesSynced();
        const footerNote = customFooterNote.trim() || 'SCAN QR FOR LIVE SITE & WORK STATUS';
        pdfItems = selectedEmployees.map((emp) => ({
          codeLabel: emp.empCode,
          title: emp.fullName,
          subtitle: `${emp.empCode}  ·  ${emp.role}`,
          metaLine: getSiteLabel(emp),
          footerLabel: footerNote,
          scanUrl: synced[emp.id] || getEmpScanUrl(emp),
        }));
      } else {
        pdfItems = siteQrCards.map((card) => ({
          codeLabel: card.pass.checkpointLabel,
          title: card.title,
          subtitle: card.subtitle,
          metaLine: card.metaLine,
          footerLabel: card.footerLabel,
          scanUrl: card.scanUrl,
        }));
      }

      const { blob, fileName } = await buildCustomQrSheetPdfBlob({
        companyName,
        targetLabel: targetKind === 'employees' ? 'Workforce' : 'Project_Sites',
        layout,
        themeId,
        errorCorrection,
        showCompanyHeader,
        showMetaDetails,
        items: pdfItems,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setStatusMessage(`Downloaded printable PDF "${fileName}" (${pdfItems.length} QR codes).`);
    } finally {
      setBusyPdf(false);
    }
  };

  const handleCopyUrl = async (key: string, label: string, url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      setStatusMessage(`Copied QR tracking link for ${label}.`);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2500);
    } catch {
      setStatusMessage(`QR link ready for ${label}: ${url}`);
    }
  };

  const toggleEmp = (empId: string) => {
    setSelectedEmpIds((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  const toggleSiteTarget = (targetId: string) => {
    setSelectedSiteTargetIds((prev) =>
      prev.includes(targetId) ? prev.filter((id) => id !== targetId) : [...prev, targetId]
    );
  };

  const handleSwitchTarget = (nextTarget: CustomQrTargetKind) => {
    setTargetKind(nextTarget);
    setLayout(nextTarget === 'sites' ? 'posters' : 'badges');
    setStatusMessage('');
  };

  const gridClass =
    layout === 'posters'
      ? 'grid grid-cols-1 gap-4'
      : layout === 'stickers'
        ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 print:grid-cols-3 gap-3'
        : 'grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-4';

  const qrPixelSize = layout === 'posters' ? 168 : layout === 'stickers' ? 104 : 136;

  return (
    <div
      data-testid="custom-qr-studio-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-qr-studio-title"
    >
      <div className="w-full max-w-6xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[95vh] flex flex-col">
        {/* Top Modal Header + Target Switcher */}
        <div className="no-print flex flex-wrap items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-start gap-2.5 min-w-0">
            <QrCode className="w-5 h-5 text-orange-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="custom-qr-studio-title" className="text-base font-semibold text-slate-900">
                Custom QR Code Generator &amp; Print Studio
              </h2>
              <p className="text-xs text-slate-500">
                Create &amp; print customizable QR badges, stickers, and site gate posters for mobile &amp; desktop scanning
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <div
              className="inline-flex items-center bg-slate-100 border border-slate-200 p-0.5 rounded-md text-xs"
              role="tablist"
              aria-label="QR target type"
            >
              <button
                type="button"
                role="tab"
                data-testid="qr-target-employees"
                aria-selected={targetKind === 'employees'}
                onClick={() => handleSwitchTarget('employees')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded transition-colors whitespace-nowrap ${
                  targetKind === 'employees'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <Users className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Employees QR</span>
              </button>
              <button
                type="button"
                role="tab"
                data-testid="qr-target-sites"
                aria-selected={targetKind === 'sites'}
                onClick={() => handleSwitchTarget('sites')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded transition-colors whitespace-nowrap ${
                  targetKind === 'sites'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Project Sites QR</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close QR studio modal"
              className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Studio Body */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Builder Controls Toolbar */}
          <div className="no-print px-4 sm:px-6 py-4 bg-slate-50 border-b border-slate-200 space-y-3.5 shrink-0">
            {targetKind === 'employees' ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <div className="relative">
                    <Search
                      className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5"
                      aria-hidden="true"
                    />
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

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelectedEmpIds(filteredEmployees.map((e) => e.id))}
                    className="px-2.5 py-1 font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100 whitespace-nowrap"
                  >
                    Select Filtered ({filteredEmployees.length})
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedEmpIds(
                        filteredEmployees.filter((e) => e.status === 'active').map((e) => e.id)
                      )
                    }
                    className="px-2.5 py-1 font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 whitespace-nowrap"
                  >
                    Active Only
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedEmpIds([])}
                    className="px-2.5 py-1 font-medium text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-100 whitespace-nowrap"
                  >
                    Clear ({selectedEmpIds.length})
                  </button>
                </div>

                {filteredEmployees.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-0.5">
                    {filteredEmployees.map((emp) => {
                      const isSelected = selectedEmpIds.includes(emp.id);
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
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  <div>
                    <label
                      htmlFor="qr-site-proj-filter"
                      className="block text-[11px] font-medium text-slate-600 mb-1"
                    >
                      Project Site Filter
                    </label>
                    <select
                      id="qr-site-proj-filter"
                      value={siteProjectFilter}
                      onChange={(e) => setSiteProjectFilter(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    >
                      <option value="all">All Projects ({projects.length})</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="qr-site-checkpoint"
                      className="block text-[11px] font-medium text-slate-600 mb-1"
                    >
                      Checkpoint / Gate Label
                    </label>
                    <input
                      id="qr-site-checkpoint"
                      type="text"
                      value={checkpointLabel}
                      onChange={(e) => setCheckpointLabel(e.target.value)}
                      placeholder="e.g. Main Site Gate, Tower A Entry"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="qr-site-custom-title"
                      className="block text-[11px] font-medium text-slate-600 mb-1"
                    >
                      Custom Headline Override (Optional)
                    </label>
                    <input
                      id="qr-site-custom-title"
                      type="text"
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      placeholder="Auto-uses Project / Tower name if blank"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                </div>

                {/* Checkpoint Presets */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-[11px] font-medium text-slate-500 mr-1">
                    Checkpoint Presets:
                  </span>
                  {SITE_CHECKPOINT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCheckpointLabel(preset)}
                      className={`px-2.5 py-1 rounded border text-[11px] font-medium whitespace-nowrap ${
                        checkpointLabel === preset
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                {/* Selectable Sites & Towers */}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-[11px] font-medium text-slate-600">
                      Select Project Sites / Towers ({selectedSiteTargets.length} selected):
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedSiteTargetIds(filteredSiteTargets.map((t) => t.id))
                        }
                        className="px-2 py-0.5 text-[11px] font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                      >
                        Select Filtered ({filteredSiteTargets.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSiteTargetIds([])}
                        className="px-2 py-0.5 text-[11px] font-medium text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-100"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {filteredSiteTargets.map((st) => {
                      const active = selectedSiteTargetIds.includes(st.id);
                      return (
                        <label
                          key={st.id}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border cursor-pointer select-none ${
                            active
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggleSiteTarget(st.id)}
                            className="sr-only"
                          />
                          <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span>{st.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Shared Customization Controls Row */}
            <div className="pt-2.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              {/* Print Layout */}
              <div
                className="grid grid-cols-3 w-full sm:w-auto sm:inline-flex items-center bg-slate-200/80 p-0.5 rounded-md text-[11px] sm:text-xs"
                role="group"
                aria-label="QR print sheet layout"
              >
                <button
                  type="button"
                  data-testid="qr-layout-badges"
                  onClick={() => setLayout('badges')}
                  className={`px-1.5 sm:px-2.5 py-1.5 font-medium rounded whitespace-nowrap text-center truncate ${
                    layout === 'badges'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Badges (6/pg)
                </button>
                <button
                  type="button"
                  data-testid="qr-layout-stickers"
                  onClick={() => setLayout('stickers')}
                  className={`px-1.5 sm:px-2.5 py-1.5 font-medium rounded whitespace-nowrap text-center truncate ${
                    layout === 'stickers'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Stickers (12/pg)
                </button>
                <button
                  type="button"
                  data-testid="qr-layout-posters"
                  onClick={() => setLayout('posters')}
                  className={`px-1.5 sm:px-2.5 py-1.5 font-medium rounded whitespace-nowrap text-center truncate ${
                    layout === 'posters'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Posters (2/pg)
                </button>
              </div>

              {/* Theme Swatches & ECC & Display Toggles */}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5" role="group" aria-label="QR color theme">
                  <span className="text-[11px] font-medium text-slate-500">Theme:</span>
                  {THEME_IDS.map((tid) => {
                    const spec = CUSTOM_QR_ACCENT_THEMES[tid];
                    const selected = themeId === tid;
                    return (
                      <button
                        key={tid}
                        type="button"
                        data-testid={`qr-theme-${tid}`}
                        aria-label={`Use ${spec.label} QR theme`}
                        aria-pressed={selected}
                        onClick={() => setThemeId(tid)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium whitespace-nowrap ${
                          selected
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: spec.accentBg }}
                          aria-hidden="true"
                        />
                        <span className="hidden md:inline">{spec.label}</span>
                      </button>
                    );
                  })}
                </div>

                <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                  <span>QR ECC:</span>
                  <select
                    aria-label="QR error correction level"
                    value={errorCorrection}
                    onChange={(e) => setErrorCorrection(e.target.value as CustomQrErrorLevel)}
                    className="px-2 py-1 text-[11px] bg-white border border-slate-300 rounded"
                  >
                    <option value="M">Standard (M)</option>
                    <option value="H">Outdoor Durable (H)</option>
                  </select>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-[11px] font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={showCompanyHeader}
                    onChange={(e) => setShowCompanyHeader(e.target.checked)}
                    className="rounded border-slate-300 text-orange-700"
                  />
                  <span>Company Header</span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-[11px] font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={showMetaDetails}
                    onChange={(e) => setShowMetaDetails(e.target.checked)}
                    className="rounded border-slate-300 text-orange-700"
                  />
                  <span>Site Details</span>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="qr-footer-note"
                className="text-[11px] font-medium text-slate-500 whitespace-nowrap"
              >
                Footer Note:
              </label>
              <input
                id="qr-footer-note"
                type="text"
                value={customFooterNote}
                onChange={(e) => setCustomFooterNote(e.target.value)}
                placeholder="Scan CTA shown at bottom of QR cards"
                className="flex-1 min-w-0 w-full sm:w-auto px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-md"
              />
            </div>
          </div>

          {/* Printable Preview Sheet */}
          <div className="id-card-print-area flex-1 p-4 sm:p-6 bg-slate-100/80 space-y-4">
            <div className="hidden print:block mb-3 border-b border-slate-300 pb-2">
              <div className="text-sm font-bold text-slate-900">
                {companyName} — {targetKind === 'employees' ? 'Workforce' : 'Project Site'} QR{' '}
                {layout === 'posters' ? 'Gate Posters' : layout === 'stickers' ? 'Stickers' : 'Badges'}
              </div>
              <div className="text-[11px] text-slate-600">
                {customFooterNote || 'Scan any QR code to open live read-only site tracking & verification pass.'}
              </div>
            </div>

            {statusMessage && (
              <div className="no-print p-2.5 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md">
                {statusMessage}
              </div>
            )}

            {activeCount === 0 ? (
              <div className="no-print py-14 text-center bg-white border border-slate-200 rounded-lg space-y-2">
                <QrCode className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
                <div className="text-sm font-medium text-slate-900">
                  {targetKind === 'employees'
                    ? 'No Employees Selected for QR Sheet'
                    : 'No Project Sites or Towers Selected'}
                </div>
                <p className="text-xs text-slate-500">
                  Select one or more items above to preview and print custom QR codes.
                </p>
              </div>
            ) : targetKind === 'employees' ? (
              <div className={gridClass}>
                {selectedEmployees.map((emp) => {
                  const scanUrl = getEmpScanUrl(emp);
                  const siteLabel = getSiteLabel(emp);
                  const copyId = `emp:${emp.id}`;
                  return (
                    <article
                      key={emp.id}
                      data-testid={`qr-badge-${emp.empCode}`}
                      className="qr-print-card no-dark-invert bg-white border border-slate-300 rounded-lg overflow-hidden flex flex-col justify-between shadow-sm"
                    >
                      {showCompanyHeader ? (
                        <div>
                          <div
                            className="text-white px-3.5 py-2 flex items-center justify-between gap-2"
                            style={{ backgroundColor: theme.headerBg }}
                          >
                            <span className="font-display font-bold text-xs tracking-tight truncate">
                              {companyName}
                            </span>
                            <span
                              className="font-mono text-[11px] font-semibold shrink-0"
                              style={{ color: theme.badgeTextHex }}
                            >
                              {emp.empCode}
                            </span>
                          </div>
                          <div className="h-1" style={{ backgroundColor: theme.accentBg }} />
                        </div>
                      ) : (
                        <div className="h-1.5" style={{ backgroundColor: theme.accentBg }} />
                      )}

                      <div
                        className={`p-4 flex ${
                          layout === 'posters'
                            ? 'flex-col sm:flex-row items-center sm:items-center gap-5 text-center sm:text-left'
                            : 'flex-col items-center text-center gap-2.5'
                        }`}
                      >
                        <div className="p-2 bg-white border border-slate-200 rounded-md shrink-0">
                          <QrCodeSvg
                            value={scanUrl}
                            size={qrPixelSize}
                            errorCorrectionLevel={errorCorrection}
                            darkColor={theme.qrDarkHex}
                            ariaLabel={`QR verification code for ${emp.fullName}`}
                          />
                        </div>

                        <div className="space-y-1 w-full min-w-0">
                          <div
                            className={`font-display font-bold text-slate-900 truncate ${
                              layout === 'posters' ? 'text-lg' : layout === 'stickers' ? 'text-xs' : 'text-sm'
                            }`}
                          >
                            {emp.fullName}
                          </div>
                          <div
                            className="text-xs font-mono font-semibold truncate"
                            style={{ color: theme.accentBg }}
                          >
                            {emp.role} · {emp.status === 'active' ? 'Active' : 'Inactive'}
                          </div>
                          {showMetaDetails && (
                            <div className="text-xs text-slate-600 truncate" title={siteLabel}>
                              {siteLabel}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="px-3.5 py-2 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                        <span className="font-mono uppercase truncate">
                          {customFooterNote || 'Scan for live site status'}
                        </span>
                        <div className="no-print flex items-center gap-1.5 ml-auto">
                          <button
                            type="button"
                            onClick={() => handleCopyUrl(copyId, emp.fullName, scanUrl)}
                            title="Copy QR scan link"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 whitespace-nowrap"
                          >
                            {copiedKey === copyId ? (
                              <Check className="w-3 h-3 text-emerald-700" aria-hidden="true" />
                            ) : (
                              <Copy className="w-3 h-3" aria-hidden="true" />
                            )}
                            <span>{copiedKey === copyId ? 'Copied' : 'Link'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onPreviewQrProfile(scanUrl);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100 whitespace-nowrap"
                          >
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            <span>Preview Scan</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className={gridClass}>
                {siteQrCards.map((card) => {
                  const copyId = card.target.id;
                  return (
                    <article
                      key={card.target.id}
                      data-testid={`qr-site-card-${card.target.id}`}
                      className="qr-print-card no-dark-invert bg-white border border-slate-300 rounded-lg overflow-hidden flex flex-col justify-between shadow-sm"
                    >
                      {showCompanyHeader ? (
                        <div>
                          <div
                            className="text-white px-4 py-2.5 flex items-center justify-between gap-2"
                            style={{ backgroundColor: theme.headerBg }}
                          >
                            <span className="font-display font-bold text-xs tracking-tight truncate">
                              {companyName}
                            </span>
                            <span
                              className="font-mono text-[11px] font-semibold shrink-0"
                              style={{ color: theme.badgeTextHex }}
                            >
                              {card.pass.checkpointLabel}
                            </span>
                          </div>
                          <div className="h-1" style={{ backgroundColor: theme.accentBg }} />
                        </div>
                      ) : (
                        <div className="h-1.5" style={{ backgroundColor: theme.accentBg }} />
                      )}

                      <div
                        className={`p-4 sm:p-5 flex ${
                          layout === 'posters'
                            ? 'flex-col sm:flex-row items-center gap-5 text-center sm:text-left'
                            : 'flex-col items-center text-center gap-2.5'
                        }`}
                      >
                        <div className="p-2 bg-white border border-slate-200 rounded-md shrink-0">
                          <QrCodeSvg
                            value={card.scanUrl}
                            size={qrPixelSize}
                            errorCorrectionLevel={errorCorrection}
                            darkColor={theme.qrDarkHex}
                            ariaLabel={`Site tracking QR code for ${card.title}`}
                          />
                        </div>

                        <div className="space-y-1.5 w-full min-w-0">
                          <div
                            className="text-[11px] font-mono font-bold uppercase tracking-wider truncate"
                            style={{ color: theme.accentBg }}
                          >
                            {card.pass.checkpointLabel}
                          </div>
                          <h3
                            className={`font-display font-bold text-slate-900 leading-snug ${
                              layout === 'posters' ? 'text-lg sm:text-xl' : 'text-sm'
                            }`}
                          >
                            {card.title}
                          </h3>
                          <div className="text-xs font-mono font-semibold text-slate-700">
                            {card.pass.activeCrewCount} Active Crew · {card.pass.todayPresentCount} Present ·{' '}
                            {card.pass.totalFlats} Flats
                          </div>
                          {showMetaDetails && (
                            <div className="text-xs text-slate-600 line-clamp-2" title={card.metaLine}>
                              {card.metaLine}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600">
                        <span className="font-mono uppercase truncate">{card.footerLabel}</span>
                        <div className="no-print flex items-center gap-1.5 ml-auto">
                          <button
                            type="button"
                            onClick={() => handleCopyUrl(copyId, card.title, card.scanUrl)}
                            title="Copy site QR link"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 whitespace-nowrap"
                          >
                            {copiedKey === copyId ? (
                              <Check className="w-3 h-3 text-emerald-700" aria-hidden="true" />
                            ) : (
                              <Copy className="w-3 h-3" aria-hidden="true" />
                            )}
                            <span>{copiedKey === copyId ? 'Copied' : 'Copy Link'}</span>
                          </button>
                          <button
                            type="button"
                            data-testid={`qr-site-preview-${card.target.id}`}
                            onClick={() => {
                              onClose();
                              onPreviewQrProfile(card.scanUrl);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100 whitespace-nowrap"
                          >
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            <span>Preview Scan</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer Action Strip */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3.5 bg-white border-t border-slate-200 shrink-0">
          <div className="text-xs text-slate-600 font-mono tabular-nums">
            {activeCount} {targetKind === 'employees' ? 'worker' : 'site'} QR{activeCount === 1 ? '' : 's'} ready ·{' '}
            {layout === 'posters'
              ? '2 Gate Posters / A4'
              : layout === 'stickers'
                ? '12 Stickers / A4'
                : '6 Badges / A4'}{' '}
            · ECC-{errorCorrection}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={activeCount === 0 || busyPrint}
              onClick={handlePrintSheet}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <Printer className="w-4 h-4" aria-hidden="true" />
              <span>{busyPrint ? 'Preparing...' : 'Print QR Sheet'}</span>
            </button>

            <button
              type="button"
              data-testid="qr-studio-download-pdf"
              disabled={activeCount === 0 || busyPdf}
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
