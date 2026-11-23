import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Search, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import type { AssignmentStatus, TileZoneKey } from '../types/avy';
import {
  EMPLOYEE_PRESET_SKILL_TAGS,
  filterEmployeesBySkillTags,
  findActiveUnfinishedAssignment,
  normalizeSkillTags,
} from '../utils/operations';
import {
  formatFloorLabel,
  getEffectiveZonesForFlat,
  getWorkStatusLabel,
} from '../utils/tileZones';
import {
  getScopedEmployees,
  getScopedFlats,
  getScopedProjects,
  getScopedTowers,
} from '../utils/authAccess';

interface AssignWorkModalProps {
  isOpen: boolean;
  preselectedFlatId?: string;
  preselectedZoneKey?: TileZoneKey;
  preselectedEmployeeId?: string;
  onClose: () => void;
}

export function AssignWorkModal({
  isOpen,
  preselectedFlatId,
  preselectedZoneKey,
  preselectedEmployeeId,
  onClose,
}: AssignWorkModalProps) {
  const {
    session,
    projects: allProjects,
    towers: allTowers,
    flats: allFlats,
    employees: allEmployees,
    assignments,
    companyProfile,
    assignWorkToFlat,
    completeAssignment,
    updateFlatZone,
  } = useStore();

  const projects = useMemo(
    () => getScopedProjects(session, allProjects, allTowers),
    [session, allProjects, allTowers]
  );
  const towers = useMemo(() => getScopedTowers(session, allTowers), [session, allTowers]);
  const flats = useMemo(() => getScopedFlats(session, allFlats), [session, allFlats]);
  const employees = useMemo(
    () => getScopedEmployees(session, allEmployees),
    [session, allEmployees]
  );

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === 'active'),
    [employees]
  );

  const [projectId, setProjectId] = useState('');
  const [towerId, setTowerId] = useState('');
  const [flatId, setFlatId] = useState('');
  const [zoneKey, setZoneKey] = useState<TileZoneKey>('master_bedroom_flooring');
  const [employeeId, setEmployeeId] = useState('');
  const [assignedDate, setAssignedDate] = useState(getTodayIso());
  const [targetSqft, setTargetSqft] = useState('195');
  const [status, setStatus] = useState<AssignmentStatus>('in_progress');
  const [notes, setNotes] = useState('');

  // Search inputs inside Assign modal
  const [flatSearch, setFlatSearch] = useState('');
  const [zoneSearch, setZoneSearch] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [skillFilter, setSkillFilter] = useState<string>('all');
  const [towerCrewOnly, setTowerCrewOnly] = useState(false);

  const [error, setError] = useState('');
  const [completingPrev, setCompletingPrev] = useState(false);
  const [completedNotice, setCompletedNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const catalog = companyProfile?.tileZoneCatalog;
  const requireFinish = companyProfile?.requireFinishBeforeNewWork !== false;

  useEffect(() => {
    if (!isOpen) return;
    const preFlat = preselectedFlatId ? flats.find((f) => f.id === preselectedFlatId) : flats[0];
    const pId = preFlat?.projectId || projects[0]?.id || '';
    const tId = preFlat?.towerId || towers.find((t) => t.projectId === pId)?.id || '';
    const fId = preFlat?.id || flats.find((f) => f.towerId === tId)?.id || '';
    const effectiveZones = getEffectiveZonesForFlat(preFlat, catalog);
    const zKey = preselectedZoneKey || effectiveZones[0]?.key || 'master_bedroom_flooring';
    const zDef = effectiveZones.find((z) => z.key === zKey);

    setProjectId(pId);
    setTowerId(tId);
    setFlatId(fId);
    setZoneKey(zKey);
    setTargetSqft(String(preFlat?.zones?.[zKey]?.sqft || zDef?.defaultSqft || 150));
    setEmployeeId(preselectedEmployeeId || activeEmployees[0]?.id || '');
    setAssignedDate(getTodayIso());
    setStatus('in_progress');
    setNotes('');
    setFlatSearch('');
    setZoneSearch('');
    setEmployeeSearch('');
    setSkillFilter('all');
    setTowerCrewOnly(false);
    setCompletedNotice('');
    setError('');
  }, [isOpen, preselectedFlatId, preselectedZoneKey, preselectedEmployeeId]);

  const projectTowers = useMemo(
    () => towers.filter((t) => t.projectId === projectId),
    [towers, projectId]
  );

  const towerFlats = useMemo(
    () =>
      flats
        .filter((f) => f.towerId === towerId)
        .sort((a, b) => a.floorNumber - b.floorNumber || a.unitNumber.localeCompare(b.unitNumber)),
    [flats, towerId]
  );

  const filteredFlats = useMemo(() => {
    if (!flatSearch.trim()) return towerFlats;
    const q = flatSearch.trim().toLowerCase();
    return towerFlats.filter((f) => {
      const flLbl = formatFloorLabel(f.floorNumber, f.floorLabel).toLowerCase();
      return (
        f.unitNumber.toLowerCase().includes(q) ||
        f.unitType.toLowerCase().includes(q) ||
        flLbl.includes(q)
      );
    });
  }, [towerFlats, flatSearch]);

  const currentFlat = useMemo(
    () => flats.find((f) => f.id === flatId) || filteredFlats[0] || null,
    [flats, flatId, filteredFlats]
  );

  const effectiveZones = useMemo(
    () => getEffectiveZonesForFlat(currentFlat, catalog),
    [currentFlat, catalog]
  );

  const filteredZones = useMemo(() => {
    if (!zoneSearch.trim()) return effectiveZones;
    const q = zoneSearch.trim().toLowerCase();
    return effectiveZones.filter(
      (z) => z.label.toLowerCase().includes(q) || z.category.toLowerCase().includes(q)
    );
  }, [effectiveZones, zoneSearch]);

  const availableSkillTags = useMemo(
    () =>
      normalizeSkillTags([
        ...EMPLOYEE_PRESET_SKILL_TAGS,
        ...activeEmployees.flatMap((e) => e.skillTags || []),
      ]),
    [activeEmployees]
  );

  const filteredEmployees = useMemo(() => {
    let list =
      skillFilter !== 'all'
        ? filterEmployeesBySkillTags(activeEmployees, [skillFilter], 'any')
        : [...activeEmployees];
    if (towerCrewOnly && towerId) {
      const towerMatches = list.filter((emp) => emp.currentTowerId === towerId);
      if (towerMatches.length > 0) list = towerMatches;
    }
    if (employeeSearch.trim()) {
      const q = employeeSearch.trim().toLowerCase();
      list = list.filter(
        (emp) =>
          emp.fullName.toLowerCase().includes(q) ||
          emp.empCode.toLowerCase().includes(q) ||
          emp.role.toLowerCase().includes(q) ||
          emp.phone.toLowerCase().includes(q) ||
          (emp.currentProjectName || '').toLowerCase().includes(q) ||
          (emp.currentTowerName || '').toLowerCase().includes(q) ||
          (emp.skillTags || []).some((t) => t.toLowerCase().includes(q))
      );
    }
    // Sort selected tower crew first
    return list.sort((a, b) => {
      const aMatch = a.currentTowerId === towerId ? 0 : 1;
      const bMatch = b.currentTowerId === towerId ? 0 : 1;
      return aMatch - bMatch || a.fullName.localeCompare(b.fullName);
    });
  }, [activeEmployees, skillFilter, towerCrewOnly, towerId, employeeSearch]);

  const selectedEmpObj = activeEmployees.find((e) => e.id === employeeId);

  const activeUnfinishedTask = useMemo(() => {
    if (!employeeId) return null;
    return findActiveUnfinishedAssignment(employeeId, assignments, flats, projects, towers);
  }, [employeeId, assignments, flats, projects, towers]);

  if (!isOpen) return null;

  const handleProjectChange = (nextProjectId: string) => {
    setProjectId(nextProjectId);
    const nextTower = towers.find((t) => t.projectId === nextProjectId);
    setTowerId(nextTower?.id || '');
    const nextFlat = flats.find((f) => f.towerId === nextTower?.id);
    setFlatId(nextFlat?.id || '');
  };

  const handleTowerChange = (nextTowerId: string) => {
    setTowerId(nextTowerId);
    const nextFlat = flats.find((f) => f.towerId === nextTowerId);
    setFlatId(nextFlat?.id || '');
  };

  const handleZoneChange = (nextZone: TileZoneKey) => {
    setZoneKey(nextZone);
    const zDef = effectiveZones.find((z) => z.key === nextZone);
    setTargetSqft(String(currentFlat?.zones?.[nextZone]?.sqft || zDef?.defaultSqft || 150));
  };

  const handleMarkPreviousCompleted = async () => {
    if (!activeUnfinishedTask) return;
    setCompletingPrev(true);
    setError('');
    try {
      if (activeUnfinishedTask.assignmentId) {
        await completeAssignment(activeUnfinishedTask.assignmentId, getTodayIso());
      } else {
        const prevFlat = flats.find((f) => f.id === activeUnfinishedTask.flatId);
        const prevZone = prevFlat?.zones?.[activeUnfinishedTask.zoneKey];
        await updateFlatZone({
          flatId: activeUnfinishedTask.flatId,
          zoneKey: activeUnfinishedTask.zoneKey,
          status: 'completed',
          sqft: prevZone?.sqft || 150,
          assignedEmployeeId: employeeId,
        });
      }
      setCompletedNotice(
        `Marked Flat ${activeUnfinishedTask.unitNumber} (${activeUnfinishedTask.zoneLabel}) as Completed. Ready to assign new work.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete previous work.');
    } finally {
      setCompletingPrev(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const resolvedFlatId = flatId || filteredFlats[0]?.id;
    const resolvedZoneKey = zoneKey || filteredZones[0]?.key;
    const resolvedEmpId = employeeId || filteredEmployees[0]?.id;

    if (!resolvedFlatId || !resolvedEmpId || !resolvedZoneKey) {
      setError('Please select a flat unit, room/tile area, and employee.');
      return;
    }
    if (requireFinish && activeUnfinishedTask) {
      setError(
        `Finish or mark completed the running work on Flat ${activeUnfinishedTask.unitNumber} (${activeUnfinishedTask.zoneLabel}) before assigning new work.`
      );
      return;
    }
    setSubmitting(true);
    try {
      await assignWorkToFlat({
        flatId: resolvedFlatId,
        zoneKey: resolvedZoneKey,
        employeeId: resolvedEmpId,
        assignedDate,
        targetSqft: Number(targetSqft) || 0,
        status,
        notes,
        allowIncompleteOverride: !requireFinish,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign work.');
    } finally {
      setSubmitting(false);
    }
  };

  const isBlockedByUnfinished = requireFinish && Boolean(activeUnfinishedTask);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-work-title"
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <ClipboardCheck className="w-5 h-5 text-orange-700" aria-hidden="true" />
            <h2 id="assign-work-title" className="text-base font-semibold text-slate-900">
              Assign Tile Work to Flat &amp; Room
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close work assignment modal"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          {completedNotice && (
            <div className="p-3 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{completedNotice}</span>
            </div>
          )}

          {/* Project + Tower */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="asgn-project" className="block text-xs font-medium text-slate-700 mb-1">
                Project
              </label>
              <select
                id="asgn-project"
                value={projectId}
                onChange={(e) => handleProjectChange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="asgn-tower" className="block text-xs font-medium text-slate-700 mb-1">
                Tower
              </label>
              <select
                id="asgn-tower"
                value={towerId}
                onChange={(e) => handleTowerChange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              >
                {projectTowers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Searchable Flat + Searchable Room */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-md">
            <div className="space-y-1.5">
              <label htmlFor="asgn-flat-search" className="block text-xs font-medium text-slate-700">
                Flat / Unit / Level (Search &amp; Select)
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
                <input
                  id="asgn-flat-search"
                  type="text"
                  value={flatSearch}
                  onChange={(e) => {
                    const q = e.target.value;
                    setFlatSearch(q);
                    const match = towerFlats.find((f) => {
                      const flLbl = formatFloorLabel(f.floorNumber, f.floorLabel).toLowerCase();
                      const lq = q.trim().toLowerCase();
                      return !lq || f.unitNumber.toLowerCase().includes(lq) || flLbl.includes(lq);
                    });
                    if (match) setFlatId(match.id);
                  }}
                  placeholder="Search 101, 5001, B1, Podium..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-orange-600"
                />
              </div>
              <select
                id="asgn-flat"
                aria-label="Select flat unit"
                value={flatId}
                onChange={(e) => setFlatId(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              >
                {filteredFlats.length === 0 ? (
                  <option value="">No matching flats</option>
                ) : (
                  filteredFlats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.unitNumber} ({formatFloorLabel(f.floorNumber, f.floorLabel)})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="asgn-zone-search" className="block text-xs font-medium text-slate-700">
                Room / Tile Area (Search &amp; Select)
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
                <input
                  id="asgn-zone-search"
                  type="text"
                  value={zoneSearch}
                  onChange={(e) => {
                    const q = e.target.value;
                    setZoneSearch(q);
                    const match = effectiveZones.find(
                      (z) =>
                        !q.trim() ||
                        z.label.toLowerCase().includes(q.trim().toLowerCase()) ||
                        z.category.toLowerCase().includes(q.trim().toLowerCase())
                    );
                    if (match) handleZoneChange(match.key);
                  }}
                  placeholder="Search bedroom, skirting, dado, custom..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-orange-600"
                />
              </div>
              <select
                id="asgn-zone"
                aria-label="Select room or tile area"
                value={zoneKey}
                onChange={(e) => handleZoneChange(e.target.value as TileZoneKey)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              >
                {filteredZones.length === 0 ? (
                  <option value="">No matching rooms</option>
                ) : (
                  filteredZones.map((z) => (
                    <option key={z.key} value={z.key}>
                      {z.label} ({z.category})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Searchable Employee Selector */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="asgn-emp-search" className="text-xs font-medium text-slate-700">
                Assign Employee (Tower Crew Prioritized)
              </label>
              <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={towerCrewOnly}
                  onChange={(e) => setTowerCrewOnly(e.target.checked)}
                  className="rounded border-slate-300 text-orange-700 focus:ring-orange-600"
                />
                <span>Tower Crew Only</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
                <input
                  id="asgn-emp-search"
                  type="text"
                  value={employeeSearch}
                  onChange={(e) => {
                    const q = e.target.value;
                    setEmployeeSearch(q);
                    const lq = q.trim().toLowerCase();
                    const pool =
                      skillFilter !== 'all'
                        ? filterEmployeesBySkillTags(activeEmployees, [skillFilter], 'any')
                        : activeEmployees;
                    const match = pool.find(
                      (emp) =>
                        !lq ||
                        emp.fullName.toLowerCase().includes(lq) ||
                        emp.empCode.toLowerCase().includes(lq) ||
                        emp.role.toLowerCase().includes(lq) ||
                        (emp.currentProjectName || '').toLowerCase().includes(lq) ||
                        (emp.skillTags || []).some((t) => t.toLowerCase().includes(lq))
                    );
                    if (match) setEmployeeId(match.id);
                  }}
                  placeholder="Name, ID, trade, skill..."
                  className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
                />
              </div>
              <select
                id="asgn-skill-filter"
                aria-label="Filter employees by skill tag"
                value={skillFilter}
                onChange={(e) => {
                  const nextSkill = e.target.value;
                  setSkillFilter(nextSkill);
                  const nextPool =
                    nextSkill !== 'all'
                      ? filterEmployeesBySkillTags(activeEmployees, [nextSkill], 'any')
                      : activeEmployees;
                  if (nextPool.length > 0 && !nextPool.some((x) => x.id === employeeId)) {
                    setEmployeeId(nextPool[0].id);
                  }
                }}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              >
                <option value="all">All Skills ({activeEmployees.length})</option>
                {availableSkillTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
              <select
                id="asgn-employee"
                aria-label="Select employee to assign"
                value={employeeId}
                onChange={(e) => {
                  setEmployeeId(e.target.value);
                  setCompletedNotice('');
                  setError('');
                }}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              >
                {filteredEmployees.length === 0 ? (
                  <option value="">No matching workers</option>
                ) : (
                  filteredEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.empCode} — {emp.fullName} ({emp.role})
                      {emp.currentTowerName ? ` · ${emp.currentTowerName}` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>

            {selectedEmpObj && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                {selectedEmpObj.currentProjectName && (
                  <div className="text-[11px] font-mono text-slate-600">
                    Allocated Site: {selectedEmpObj.currentProjectName}
                    {selectedEmpObj.currentTowerName ? ` · ${selectedEmpObj.currentTowerName}` : ''}
                  </div>
                )}
                {selectedEmpObj.skillTags && selectedEmpObj.skillTags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {selectedEmpObj.skillTags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-900 border border-amber-200 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Unfinished Work Guard Banner */}
          {activeUnfinishedTask && (
            <div
              className={`p-3.5 rounded-md border space-y-2 ${
                requireFinish
                  ? 'bg-amber-50 border-amber-300 text-amber-950'
                  : 'bg-slate-50 border-slate-300 text-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="text-xs">
                    <div className="font-semibold">
                      {requireFinish
                        ? 'Previous Work Must Be Finished Before Assigning New Work'
                        : 'Notice: Employee Has Active In-Progress Work'}
                    </div>
                    <div className="mt-0.5 text-amber-900">
                      Running Task:{' '}
                      <strong>
                        Flat {activeUnfinishedTask.unitNumber} · {activeUnfinishedTask.zoneLabel}
                      </strong>{' '}
                      ({activeUnfinishedTask.projectName} / {activeUnfinishedTask.towerName} ·{' '}
                      {getWorkStatusLabel(activeUnfinishedTask.status)})
                      {activeUnfinishedTask.assignedDate && (
                        <span className="font-mono"> · Since {activeUnfinishedTask.assignedDate}</span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={completingPrev}
                  onClick={handleMarkPreviousCompleted}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {completingPrev ? 'Completing...' : 'Mark Previous Work Completed'}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="asgn-date" className="block text-xs font-medium text-slate-700 mb-1">
                Assigned Date
              </label>
              <input
                id="asgn-date"
                type="date"
                value={assignedDate}
                onChange={(e) => setAssignedDate(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              />
            </div>

            <div>
              <label htmlFor="asgn-sqft" className="block text-xs font-medium text-slate-700 mb-1">
                Area (Sq.Ft)
              </label>
              <input
                id="asgn-sqft"
                type="number"
                min="0"
                value={targetSqft}
                onChange={(e) => setTargetSqft(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              />
            </div>

            <div>
              <label htmlFor="asgn-status" className="block text-xs font-medium text-slate-700 mb-1">
                Work Status
              </label>
              <select
                id="asgn-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as AssignmentStatus)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
              >
                <option value="assigned">Assigned</option>
                <option value="prechecking">Prechecking</option>
                <option value="in_progress">In Progress</option>
                <option value="cleaning_in_progress">Cleaning In Progress</option>
                <option value="cleaning_done">Cleaning Done</option>
                <option value="completed">Completed</option>
                <option value="qc_approved">QC Approved</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="asgn-notes" className="block text-xs font-medium text-slate-700 mb-1">
              Work Instructions / Tile Specification
            </label>
            <input
              id="asgn-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. 600x1200mm GVT with 2mm spacers"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || isBlockedByUnfinished}
              className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {submitting ? 'Assigning...' : 'Save Assignment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
