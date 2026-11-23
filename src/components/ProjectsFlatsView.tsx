import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Flag,
  Layers,
  MapPin,
  MessageSquare,
  Mic,
  Pencil,
  Phone,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  ScrollText,
  Search,
  SlidersHorizontal,
  Square,
  Trash2,
  UserPlus,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { getTodayIso } from '../data/seedData';
import type {
  Project,
  TileZoneCategory,
  TileZoneDefinition,
  TileZoneKey,
  Tower,
  WhatsappMessagePayload,
  ZoneStatus,
} from '../types/avy';
import {
  getScopedAdvances,
  getScopedAssignments,
  getScopedAttendance,
  getScopedEmployees,
  getScopedExpenses,
  getScopedFlats,
  getScopedProjects,
  getScopedTowers,
  isAdminSession,
  isSupervisorSession,
} from '../utils/authAccess';
import { buildWorkReportPdfBlob, triggerBlobDownload } from '../utils/idCardPdf';
import {
  type WorkAreaFilter,
  type WorkBreakdownLevel,
  type WorkStatusFilter,
  WORK_AREA_FILTER_OPTIONS,
  computeProjectAndTowerExpenses,
  computeProjectWorkStatusOverview,
  computeTowerAttendanceSummary,
  computeTowerFoodExpenseBreakdown,
  formatDurationBreakdown,
  formatTowerProjectStatusWhatsappMessage,
} from '../utils/operations';
import {
  type MixedBhkSpec,
  type WholeFloorCommonRoomSpec,
  type WholeFloorCustomZoneItem,
  SPECIAL_FLOOR_PRESETS,
  FLOOR_LAYOUT_PRESETS,
  RESIDENTIAL_BHK_TYPES,
  TILE_ZONES,
  WHOLE_FLOOR_COMMON_ROOM_TEMPLATES,
  WHOLE_FLOOR_CUSTOM_PRESETS,
  ZONE_CATEGORIES,
  ZONE_STATUS_LABELS,
  buildMixedBhkFloorUnits,
  buildOrderedSlotFloorUnits,
  buildWholeFloorCommonZoneItems,
  calculateFlatProgress,
  collectOpenZoneIssuesForFlats,
  formatFloorLabel,
  formatFloorShortTag,
  generateUnitNumbersForFloor,
  getEffectiveZonesForFlat,
  getWorkStatusBadgeClass,
  getWorkStatusLabel,
  isActiveWorkStatus,
  isFloorCommonUnit,
  parseCustomUnitNumbers,
  slugifyZoneKey,
} from '../utils/tileZones';
import { PrintPreviewOverlay } from './PrintPreviewOverlay';
import { PrintableWorkReportSheet } from './PrintableWorkReportSheet';
import { ProjectLocationAutocomplete } from './ProjectLocationAutocomplete';
import { ProjectSitesCompletionMap } from './ProjectSitesCompletionMap';
import { ProjectSitesMapModal } from './ProjectSitesMapModal';
import { CustomQrStudioModal } from './CustomQrStudioModal';

interface ProjectsFlatsViewProps {
  preselectedTarget?: {
    projectId?: string;
    towerId?: string;
    flatId?: string;
    nonce: number;
  };
  onOpenAssignWork: (flatId?: string, zoneKey?: TileZoneKey) => void;
  onOpenProjectLogsReport?: (projectId?: string) => void;
  onPreviewQrProfile?: (scanUrl: string) => void;
  onTriggerWhatsapp: (payload: WhatsappMessagePayload) => void;
}

type SpecialLevelId = 'basement_3' | 'basement_2' | 'basement_1' | 'ground' | 'podium';

export function ProjectsFlatsView({
  preselectedTarget,
  onOpenAssignWork,
  onOpenProjectLogsReport,
  onPreviewQrProfile,
  onTriggerWhatsapp,
}: ProjectsFlatsViewProps) {
  const {
    session,
    companyProfile,
    projects: rawProjects,
    towers: rawTowers,
    flats: rawFlats,
    employees: rawEmployees,
    assignments: rawAssignments,
    attendance: rawAttendance,
    advances: rawAdvances,
    expenses: rawExpenses,
    addProject,
    updateProject,
    addTowerWithUnits,
    updateTower,
    addCustomFloorUnits,
    removeTower,
    removeFlat,
    updateFlatZone,
    rectifyFlatZoneIssue,
    completeAssignment,
    updateTileZoneCatalog,
    addCustomZoneToFlat,
    addCustomZoneToWholeFloor,
    addCustomZonesToWholeFloor,
    upsertFloorCommonAreas,
    renameFlatZone,
    removeFlatZone,
    bulkAllocateEmployeesToTower,
  } = useStore();

  const isAdmin = isAdminSession(session);
  const isSupervisor = isSupervisorSession(session);

  const projects = useMemo(
    () => getScopedProjects(session, rawProjects, rawTowers),
    [session, rawProjects, rawTowers]
  );
  const towers = useMemo(() => getScopedTowers(session, rawTowers), [session, rawTowers]);
  const flats = useMemo(() => getScopedFlats(session, rawFlats), [session, rawFlats]);
  const employees = useMemo(
    () => getScopedEmployees(session, rawEmployees),
    [session, rawEmployees]
  );
  const assignments = useMemo(
    () => getScopedAssignments(session, rawAssignments),
    [session, rawAssignments]
  );
  const attendance = useMemo(
    () => getScopedAttendance(session, rawAttendance, rawEmployees),
    [session, rawAttendance, rawEmployees]
  );
  const advances = useMemo(
    () => getScopedAdvances(session, rawAdvances, rawEmployees),
    [session, rawAdvances, rawEmployees]
  );
  const expenses = useMemo(() => getScopedExpenses(session, rawExpenses), [session, rawExpenses]);

  const zoneCatalog = companyProfile?.tileZoneCatalog || TILE_ZONES;
  const companyName = companyProfile?.companyName || 'AVY INFRA';

  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || '');
  const [selectedTowerId, setSelectedTowerId] = useState('');
  const [selectedFloorFilter, setSelectedFloorFilter] = useState<string>('all');
  const [unitSearch, setUnitSearch] = useState('');
  const [selectedFlatId, setSelectedFlatId] = useState<string>(flats[0]?.id || '');
  const [workerSearch, setWorkerSearch] = useState('');
  const [workStatusFilter, setWorkStatusFilter] = useState<WorkStatusFilter>('all');
  const [workBreakdownLevel, setWorkBreakdownLevel] = useState<WorkBreakdownLevel>('tower');
  const [workOverviewAllProjects, setWorkOverviewAllProjects] = useState(false);
  const [workTowerFilter, setWorkTowerFilter] = useState<string>('all');
  const [workCustomFloors, setWorkCustomFloors] = useState<number[]>([]);
  const [workAreaFilter, setWorkAreaFilter] = useState<WorkAreaFilter>('all');
  const [workAreaSearch, setWorkAreaSearch] = useState<string>('');
  const [showWorkReportPreview, setShowWorkReportPreview] = useState(false);
  const [showSiteMapModal, setShowSiteMapModal] = useState(false);
  const [showQrStudioModal, setShowQrStudioModal] = useState(false);

  // Per-flat custom room/area controls
  const [showAddFlatZone, setShowAddFlatZone] = useState(false);
  const [newFlatZoneLabel, setNewFlatZoneLabel] = useState('');
  const [newFlatZoneCat, setNewFlatZoneCat] = useState<TileZoneCategory>('Flooring');
  const [newFlatZoneSqft, setNewFlatZoneSqft] = useState('120');
  const [editingZoneKey, setEditingZoneKey] = useState<string | null>(null);
  const [editingZoneLabel, setEditingZoneLabel] = useState('');
  const [editingZoneCat, setEditingZoneCat] = useState<TileZoneCategory>('Flooring');

  // Tile-laying area Note & Remarks + Voice Note Modal state
  const [remarkModalZone, setRemarkModalZone] = useState<{
    flatId: string;
    zoneKey: string;
    zoneLabel: string;
  } | null>(null);
  const [draftZoneNotes, setDraftZoneNotes] = useState('');
  const [draftVoiceTranscript, setDraftVoiceTranscript] = useState('');
  const [draftVoiceDataUrl, setDraftVoiceDataUrl] = useState('');
  const [draftFlagOpenIssue, setDraftFlagOpenIssue] = useState(true);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceRecordError, setVoiceRecordError] = useState('');
  const [savingZoneRemark, setSavingZoneRemark] = useState(false);
  const [rectifyingKey, setRectifyingKey] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechRecRef = useRef<{ stop?: () => void } | null>(null);
  const voiceStopTimerRef = useRef<number | null>(null);

  // Modals for Project (New & Edit)
  const [showNewProject, setShowNewProject] = useState(false);
  const [projName, setProjName] = useState('');
  const [projLocation, setProjLocation] = useState('');
  const [projPlaceId, setProjPlaceId] = useState('');
  const [projClient, setProjClient] = useState('');
  const [projStartDate, setProjStartDate] = useState(getTodayIso());
  const [projFinishDate, setProjFinishDate] = useState('');
  const [projManagerName, setProjManagerName] = useState('');
  const [projManagerPhone, setProjManagerPhone] = useState('');
  const [projEngineerName, setProjEngineerName] = useState('');
  const [projEngineerPhone, setProjEngineerPhone] = useState('');

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editProjStatus, setEditProjStatus] = useState<'active' | 'completed' | 'on_hold'>('active');

  // Modals for Tower (New & Edit)
  const [showNewTower, setShowNewTower] = useState(false);
  const [towerName, setTowerName] = useState('');
  const [startFloor, setStartFloor] = useState('1');
  const [endFloor, setEndFloor] = useState('3');
  const [unitsPerFloor, setUnitsPerFloor] = useState('3');
  const [unitTypeDefault, setUnitTypeDefault] = useState('3 BHK');
  const [twrPlanMode, setTwrPlanMode] = useState<'uniform' | 'mixed' | 'ordered_slots'>('uniform');
  const [twrOrderedSlots, setTwrOrderedSlots] = useState<string[]>([
    '3 BHK',
    '3 BHK',
    '2 BHK',
    '2 BHK',
    '2 BHK',
    '2 BHK',
    '3 BHK',
    '3 BHK',
  ]);
  const [twrMixedCounts, setTwrMixedCounts] = useState<Record<string, string>>({
    '3 BHK': '3',
    '2 BHK': '3',
    '4 BHK': '0',
    '5 BHK': '0',
    '1 BHK': '0',
    Penthouse: '0',
  });
  const [selectedSpecialLevels, setSelectedSpecialLevels] = useState<SpecialLevelId[]>([]);
  const [specialUnitsPerLevel, setSpecialUnitsPerLevel] = useState('2');
  const [twrIncludeCommon, setTwrIncludeCommon] = useState(true);
  const [twrCommonElecCount, setTwrCommonElecCount] = useState<number>(1);
  const [twrCommonLiftCount, setTwrCommonLiftCount] = useState<number>(1);
  const [twrCommonCorridor, setTwrCommonCorridor] = useState(true);
  const [twrStartDate, setTwrStartDate] = useState(getTodayIso());
  const [twrFinishDate, setTwrFinishDate] = useState('');
  const [twrInchargeName, setTwrInchargeName] = useState('');
  const [twrInchargePhone, setTwrInchargePhone] = useState('');
  const [twrSupervisorName, setTwrSupervisorName] = useState('');
  const [twrSupervisorPhone, setTwrSupervisorPhone] = useState('');
  const [twrEngineerName, setTwrEngineerName] = useState('');
  const [twrEngineerPhone, setTwrEngineerPhone] = useState('');
  const [twrManagerName, setTwrManagerName] = useState('');
  const [twrManagerPhone, setTwrManagerPhone] = useState('');
  const [towerError, setTowerError] = useState('');
  const [towerSubmitting, setTowerSubmitting] = useState(false);

  const [editingTower, setEditingTower] = useState<Tower | null>(null);

  // Deploy Manpower to Specific Tower Modal
  const [showDeployToTower, setShowDeployToTower] = useState(false);
  const [deployProjId, setDeployProjId] = useState('');
  const [deployTwrId, setDeployTwrId] = useState('');
  const [deployDate, setDeployDate] = useState(getTodayIso());
  const [deployNotes, setDeployNotes] = useState('');
  const [deploySearch, setDeploySearch] = useState('');
  const [deployHideCurrentTower, setDeployHideCurrentTower] = useState(false);
  const [deploySelectedEmpIds, setDeploySelectedEmpIds] = useState<string[]>([]);
  const [deploySubmitting, setDeploySubmitting] = useState(false);

  const [showInlineSiteMap, setShowInlineSiteMap] = useState(true);
  const [showAddFloor, setShowAddFloor] = useState(false);
  const [floorPreset, setFloorPreset] = useState<'typical' | SpecialLevelId>('typical');
  const [floorMode, setFloorMode] = useState<'auto' | 'mixed' | 'ordered_slots' | 'custom'>('auto');
  const [customFloorNum, setCustomFloorNum] = useState('2');
  const [customEndFloorNum, setCustomEndFloorNum] = useState('');
  const [customFloorLabelInput, setCustomFloorLabelInput] = useState('');
  const [customUnitsCount, setCustomUnitsCount] = useState('3');
  const [flOrderedSlots, setFlOrderedSlots] = useState<string[]>([
    '3 BHK',
    '3 BHK',
    '2 BHK',
    '2 BHK',
    '2 BHK',
    '2 BHK',
    '3 BHK',
    '3 BHK',
  ]);
  const [flMixedCounts, setFlMixedCounts] = useState<Record<string, string>>({
    '3 BHK': '3',
    '2 BHK': '3',
    '4 BHK': '0',
    '5 BHK': '0',
    '1 BHK': '0',
    Penthouse: '0',
  });
  const [flIncludeCommon, setFlIncludeCommon] = useState(true);
  const [flCommonElecCount, setFlCommonElecCount] = useState<number>(1);
  const [flCommonLiftCount, setFlCommonLiftCount] = useState<number>(1);
  const [flCommonCorridor, setFlCommonCorridor] = useState(true);
  const [customUnitListText, setCustomUnitListText] = useState('');
  const [customUnitType, setCustomUnitType] = useState('3 BHK');
  const [floorError, setFloorError] = useState('');
  const [floorSubmitting, setFloorSubmitting] = useState(false);

  // Customize Global Tile Area Catalog Modal
  const [showCustomizeZones, setShowCustomizeZones] = useState(false);
  const [draftCatalog, setDraftCatalog] = useState<TileZoneDefinition[]>([]);
  const [newCatZoneLabel, setNewCatZoneLabel] = useState('');
  const [newCatZoneCategory, setNewCatZoneCategory] = useState<TileZoneCategory>('Flooring');
  const [newCatZoneSqft, setNewCatZoneSqft] = useState('120');
  const [catalogSaving, setCatalogSaving] = useState(false);

  const [confirmRemoveTower, setConfirmRemoveTower] = useState(false);
  const [confirmRemoveFlatId, setConfirmRemoveFlatId] = useState<string | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);

  // Add Whole-Floor Common Areas (Electrical 1/2, Lift Lobby, Corridor, Custom Areas) Modal
  const [showWholeFloorZoneModal, setShowWholeFloorZoneModal] = useState(false);
  const [wfTargetMode, setWfTargetMode] = useState<'common_unit' | 'each_flat'>('common_unit');
  const [wfFloorNum, setWfFloorNum] = useState<string>('1');
  const [wfSelectedFloors, setWfSelectedFloors] = useState<number[]>([1]);
  const [wfRoomSpecs, setWfRoomSpecs] = useState<WholeFloorCommonRoomSpec[]>(() =>
    WHOLE_FLOOR_COMMON_ROOM_TEMPLATES.map((t) => ({ ...t }))
  );
  const [wfCustomRooms, setWfCustomRooms] = useState<
    Array<{
      id: string;
      baseName: string;
      count: number;
      includeFlooring: boolean;
      includeSkirting: boolean;
      category: TileZoneCategory;
      flooringSqft: string;
      skirtingSqft: string;
    }>
  >([]);
  const [wfPresetSelection, setWfPresetSelection] = useState<
    Record<string, { selected: boolean; sqft: string }>
  >(() =>
    Object.fromEntries(
      WHOLE_FLOOR_CUSTOM_PRESETS.map((p) => [
        p.label,
        { selected: false, sqft: String(p.defaultSqft) },
      ])
    )
  );
  const [wfZoneLabel, setWfZoneLabel] = useState('');
  const [wfZoneCat, setWfZoneCat] = useState<TileZoneCategory>('Common');
  const [wfZoneSqft, setWfZoneSqft] = useState('120');
  const [wfZoneStatus, setWfZoneStatus] = useState<ZoneStatus>('not_started');
  const [wfBusy, setWfBusy] = useState(false);
  const [wfError, setWfError] = useState('');
  const [wfFeedback, setWfFeedback] = useState('');

  useEffect(() => {
    if (!projects.some((p) => p.id === selectedProjectId) && projects[0]) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!preselectedTarget) return;
    if (preselectedTarget.projectId && projects.some((p) => p.id === preselectedTarget.projectId)) {
      setSelectedProjectId(preselectedTarget.projectId);
    }
    if (preselectedTarget.towerId && towers.some((t) => t.id === preselectedTarget.towerId)) {
      setSelectedTowerId(preselectedTarget.towerId);
    }
    setSelectedFloorFilter('all');
    setUnitSearch('');
    if (preselectedTarget.flatId && flats.some((f) => f.id === preselectedTarget.flatId)) {
      setSelectedFlatId(preselectedTarget.flatId);
    }
  }, [preselectedTarget, projects, towers, flats]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  const workScopeTowers = useMemo(
    () =>
      workOverviewAllProjects
        ? towers
        : towers.filter((t) => t.projectId === selectedProjectId),
    [towers, workOverviewAllProjects, selectedProjectId]
  );

  useEffect(() => {
    if (workTowerFilter !== 'all' && !workScopeTowers.some((t) => t.id === workTowerFilter)) {
      setWorkTowerFilter('all');
      setWorkCustomFloors([]);
    }
  }, [workScopeTowers, workTowerFilter]);

  const workAvailableFloors = useMemo(() => {
    const map = new Map<number, string>();
    for (const f of flats) {
      if (!workOverviewAllProjects && selectedProjectId && f.projectId !== selectedProjectId) {
        continue;
      }
      if (workTowerFilter !== 'all' && f.towerId !== workTowerFilter) continue;
      if (!map.has(f.floorNumber)) {
        map.set(f.floorNumber, formatFloorLabel(f.floorNumber, f.floorLabel));
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [flats, workOverviewAllProjects, selectedProjectId, workTowerFilter]);

  const workStatusOverview = useMemo(
    () =>
      computeProjectWorkStatusOverview({
        projects,
        towers,
        flats,
        projectId: workOverviewAllProjects ? 'all' : selectedProjectId || 'all',
        towerId: workTowerFilter,
        floorNumbers: workCustomFloors.length > 0 ? workCustomFloors : 'all',
        areaFilter: workAreaFilter,
        areaSearch: workAreaSearch,
        statusFilter: workStatusFilter,
      }),
    [
      projects,
      towers,
      flats,
      workOverviewAllProjects,
      selectedProjectId,
      workTowerFilter,
      workCustomFloors,
      workAreaFilter,
      workAreaSearch,
      workStatusFilter,
    ]
  );

  const projectTowers = useMemo(
    () => towers.filter((t) => t.projectId === selectedProjectId),
    [towers, selectedProjectId]
  );

  useEffect(() => {
    if (!projectTowers.some((t) => t.id === selectedTowerId)) {
      setSelectedTowerId(projectTowers[0]?.id || '');
    }
  }, [projectTowers, selectedTowerId]);

  const selectedTower = projectTowers.find((t) => t.id === selectedTowerId) || null;

  const towerFlats = useMemo(
    () =>
      flats
        .filter((f) => f.towerId === selectedTowerId)
        .sort(
          (a, b) =>
            a.floorNumber - b.floorNumber ||
            Number(isFloorCommonUnit(a)) - Number(isFloorCommonUnit(b)) ||
            a.unitNumber.localeCompare(b.unitNumber)
        ),
    [flats, selectedTowerId]
  );

  const floorsAvailable = useMemo(() => {
    const map = new Map<number, string>();
    for (const f of towerFlats) {
      if (!map.has(f.floorNumber)) {
        map.set(f.floorNumber, formatFloorLabel(f.floorNumber, f.floorLabel));
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [towerFlats]);

  const filteredFlats = useMemo(() => {
    return towerFlats.filter((f) => {
      if (selectedFloorFilter !== 'all' && String(f.floorNumber) !== selectedFloorFilter) {
        return false;
      }
      if (unitSearch.trim()) {
        const q = unitSearch.trim().toLowerCase();
        const flLabel = formatFloorLabel(f.floorNumber, f.floorLabel).toLowerCase();
        return (
          f.unitNumber.toLowerCase().includes(q) ||
          f.unitType.toLowerCase().includes(q) ||
          flLabel.includes(q)
        );
      }
      return true;
    });
  }, [towerFlats, selectedFloorFilter, unitSearch]);

  useEffect(() => {
    if (!towerFlats.some((f) => f.id === selectedFlatId)) {
      setSelectedFlatId(towerFlats[0]?.id || '');
    }
  }, [towerFlats, selectedFlatId]);

  const selectedFlat = flats.find((f) => f.id === selectedFlatId) || null;

  const effectiveFlatZones = useMemo(
    () => getEffectiveZonesForFlat(selectedFlat, zoneCatalog),
    [selectedFlat, zoneCatalog]
  );

  const flatAssignments = useMemo(
    () =>
      selectedFlat
        ? assignments
            .filter((a) => a.flatId === selectedFlat.id)
            .sort((a, b) => b.assignedDate.localeCompare(a.assignedDate))
        : [],
    [assignments, selectedFlat]
  );

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === 'active'),
    [employees]
  );

  const selectedTowerCrew = useMemo(
    () =>
      selectedTowerId
        ? activeEmployees.filter((e) => e.currentTowerId === selectedTowerId)
        : [],
    [activeEmployees, selectedTowerId]
  );

  const deployTargetCrew = useMemo(
    () =>
      deployTwrId
        ? activeEmployees.filter((e) => e.currentTowerId === deployTwrId)
        : [],
    [activeEmployees, deployTwrId]
  );

  const deployCandidateEmployees = useMemo(() => {
    const q = deploySearch.trim().toLowerCase();
    return activeEmployees.filter((e) => {
      if (deployHideCurrentTower && e.currentTowerId === deployTwrId) return false;
      if (!q) return true;
      return (
        e.fullName.toLowerCase().includes(q) ||
        e.empCode.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q) ||
        (e.currentProjectName || '').toLowerCase().includes(q) ||
        (e.currentTowerName || '').toLowerCase().includes(q)
      );
    });
  }, [activeEmployees, deployHideCurrentTower, deployTwrId, deploySearch]);

  const filteredWorkerOptions = useMemo(() => {
    if (!workerSearch.trim()) return activeEmployees;
    const q = workerSearch.trim().toLowerCase();
    return activeEmployees.filter(
      (emp) =>
        emp.fullName.toLowerCase().includes(q) ||
        emp.empCode.toLowerCase().includes(q) ||
        emp.role.toLowerCase().includes(q) ||
        (emp.currentTowerName || '').toLowerCase().includes(q)
    );
  }, [activeEmployees, workerSearch]);

  const resetTowerContactFields = () => {
    setTwrStartDate(getTodayIso());
    setTwrFinishDate('');
    setTwrInchargeName('');
    setTwrInchargePhone('');
    setTwrSupervisorName('');
    setTwrSupervisorPhone('');
    setTwrEngineerName(selectedProject?.engineerName || '');
    setTwrEngineerPhone(selectedProject?.engineerPhone || '');
    setTwrManagerName(selectedProject?.managerName || '');
    setTwrManagerPhone(selectedProject?.managerPhone || '');
  };

  const handleOpenNewProject = () => {
    setProjName('');
    setProjLocation('');
    setProjPlaceId('');
    setProjClient('');
    setProjStartDate(getTodayIso());
    setProjFinishDate('');
    setProjManagerName('');
    setProjManagerPhone('');
    setProjEngineerName('');
    setProjEngineerPhone('');
    setShowNewProject(true);
  };

  const handleOpenEditProject = (proj: Project) => {
    setEditingProject(proj);
    setProjName(proj.name);
    setProjLocation(proj.location);
    setProjPlaceId(proj.placeId || '');
    setProjClient(proj.clientName);
    setEditProjStatus(proj.status);
    setProjStartDate(proj.startDate || '');
    setProjFinishDate(proj.finishDate || '');
    setProjManagerName(proj.managerName || '');
    setProjManagerPhone(proj.managerPhone || '');
    setProjEngineerName(proj.engineerName || '');
    setProjEngineerPhone(proj.engineerPhone || '');
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projName.trim()) return;
    const p = await addProject({
      name: projName.trim(),
      location: projLocation.trim(),
      placeId: projPlaceId.trim() || undefined,
      clientName: projClient.trim(),
      startDate: projStartDate,
      finishDate: projFinishDate,
      managerName: projManagerName.trim(),
      managerPhone: projManagerPhone.trim(),
      engineerName: projEngineerName.trim(),
      engineerPhone: projEngineerPhone.trim(),
    });
    setSelectedProjectId(p.id);
    setShowNewProject(false);
  };

  const handleSaveEditProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject || !projName.trim()) return;
    await updateProject(editingProject.id, {
      name: projName.trim(),
      location: projLocation.trim(),
      placeId: projPlaceId.trim() || undefined,
      clientName: projClient.trim(),
      status: editProjStatus,
      startDate: projStartDate,
      finishDate: projFinishDate,
      managerName: projManagerName.trim(),
      managerPhone: projManagerPhone.trim(),
      engineerName: projEngineerName.trim(),
      engineerPhone: projEngineerPhone.trim(),
    });
    setEditingProject(null);
  };

  const toggleSpecialLevel = (lvlId: SpecialLevelId) => {
    setSelectedSpecialLevels((prev) =>
      prev.includes(lvlId) ? prev.filter((id) => id !== lvlId) : [...prev, lvlId]
    );
  };

  const getMixedSpecs = (countsMap: Record<string, string>): MixedBhkSpec[] => {
    const order = ['3 BHK', '2 BHK', '4 BHK', '5 BHK', '1 BHK', 'Penthouse'];
    return order
      .map((unitType) => ({
        unitType,
        count: Math.max(0, Math.min(30, Math.floor(Number(countsMap[unitType]) || 0))),
      }))
      .filter((item) => item.count > 0);
  };

  const buildQuickFloorCommonSeedItems = (
    elecCount: number,
    liftCount: number,
    includeCorridor: boolean
  ): WholeFloorCustomZoneItem[] =>
    buildWholeFloorCommonZoneItems({
      rooms: [
        {
          id: 'electrical_room',
          baseName: 'Electrical Room',
          count: elecCount,
          includeFlooring: true,
          includeSkirting: true,
          flooringCategory: 'Flooring',
          flooringSqft: 110,
          skirtingSqft: 42,
        },
        {
          id: 'lift_lobby',
          baseName: 'Lift Lobby',
          count: liftCount,
          includeFlooring: true,
          includeSkirting: true,
          flooringCategory: 'Common',
          flooringSqft: 165,
          skirtingSqft: 52,
        },
        {
          id: 'corridor',
          baseName: 'Corridor',
          count: includeCorridor ? 1 : 0,
          includeFlooring: true,
          includeSkirting: true,
          flooringCategory: 'Common',
          flooringSqft: 185,
          skirtingSqft: 68,
        },
      ],
    });

  const handleCreateTower = async (e: React.FormEvent) => {
    e.preventDefault();
    setTowerError('');
    if (!selectedProjectId || !towerName.trim()) {
      setTowerError('Please enter a tower name.');
      return;
    }
    const mixedSpecsPerFloor =
      twrPlanMode === 'mixed' ? getMixedSpecs(twrMixedCounts) : undefined;
    if (twrPlanMode === 'mixed' && (!mixedSpecsPerFloor || mixedSpecsPerFloor.length === 0)) {
      setTowerError('Enter at least 1 unit count in the Mixed BHK configuration.');
      return;
    }
    const orderedSlotTypes =
      twrPlanMode === 'ordered_slots' ? twrOrderedSlots : undefined;
    if (twrPlanMode === 'ordered_slots' && (!orderedSlotTypes || orderedSlotTypes.length === 0)) {
      setTowerError('Add at least 1 flat slot in Ordered Slot Layout.');
      return;
    }
    const commonAreaItems = twrIncludeCommon
      ? buildQuickFloorCommonSeedItems(
          twrCommonElecCount,
          twrCommonLiftCount,
          twrCommonCorridor
        )
      : undefined;
    setTowerSubmitting(true);
    try {
      const twr = await addTowerWithUnits({
        projectId: selectedProjectId,
        name: towerName.trim(),
        startFloor: Number(startFloor) || 1,
        endFloor: Number(endFloor) || 1,
        unitsPerFloor:
          twrPlanMode === 'ordered_slots'
            ? twrOrderedSlots.length
            : Number(unitsPerFloor) || 3,
        unitType: unitTypeDefault.trim() || '3 BHK',
        mixedSpecsPerFloor,
        orderedSlotTypes,
        commonAreaItems,
        specialLevels: selectedSpecialLevels,
        specialUnitsPerLevel: Number(specialUnitsPerLevel) || 2,
        startDate: twrStartDate,
        finishDate: twrFinishDate,
        inchargeName: twrInchargeName.trim(),
        inchargePhone: twrInchargePhone.trim(),
        supervisorName: twrSupervisorName.trim(),
        supervisorPhone: twrSupervisorPhone.trim(),
        engineerName: twrEngineerName.trim(),
        engineerPhone: twrEngineerPhone.trim(),
        managerName: twrManagerName.trim(),
        managerPhone: twrManagerPhone.trim(),
      });
      setSelectedTowerId(twr.id);
      setSelectedFloorFilter('all');
      setUnitSearch('');
      setTowerName('');
      setSelectedSpecialLevels([]);
      setShowNewTower(false);
    } catch (err) {
      setTowerError(err instanceof Error ? err.message : 'Failed to create tower.');
    } finally {
      setTowerSubmitting(false);
    }
  };

  const handleOpenEditTower = (twr: Tower) => {
    setEditingTower(twr);
    setTowerName(twr.name);
    setTwrStartDate(twr.startDate || '');
    setTwrFinishDate(twr.finishDate || '');
    setTwrInchargeName(twr.inchargeName || '');
    setTwrInchargePhone(twr.inchargePhone || '');
    setTwrSupervisorName(twr.supervisorName || '');
    setTwrSupervisorPhone(twr.supervisorPhone || '');
    setTwrEngineerName(twr.engineerName || '');
    setTwrEngineerPhone(twr.engineerPhone || '');
    setTwrManagerName(twr.managerName || '');
    setTwrManagerPhone(twr.managerPhone || '');
    setTowerError('');
  };

  const handleSaveEditTower = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTower || !towerName.trim()) return;
    setTowerSubmitting(true);
    try {
      await updateTower(editingTower.id, {
        name: towerName.trim(),
        startDate: twrStartDate,
        finishDate: twrFinishDate,
        inchargeName: twrInchargeName.trim(),
        inchargePhone: twrInchargePhone.trim(),
        supervisorName: twrSupervisorName.trim(),
        supervisorPhone: twrSupervisorPhone.trim(),
        engineerName: twrEngineerName.trim(),
        engineerPhone: twrEngineerPhone.trim(),
        managerName: twrManagerName.trim(),
        managerPhone: twrManagerPhone.trim(),
      });
      setEditingTower(null);
      setTowerName('');
    } catch (err) {
      setTowerError(err instanceof Error ? err.message : 'Failed to update tower.');
    } finally {
      setTowerSubmitting(false);
    }
  };

  const handleShareTowerStatus = (roleTitle: string, contactName?: string, contactPhone?: string) => {
    if (!selectedProject || !selectedTower) return;
    const today = getTodayIso();
    let tTotal = 0;
    let tDone = 0;
    let tRunning = 0;
    for (const fl of towerFlats) {
      const pr = calculateFlatProgress(fl, zoneCatalog);
      tTotal += pr.totalZones;
      tDone += pr.completedCount;
      tRunning += pr.inProgressCount;
    }

    const attSummary = computeTowerAttendanceSummary({
      date: today,
      projectId: selectedProject.id,
      towerId: selectedTower.id,
      employees,
      attendance,
    });

    const food = computeTowerFoodExpenseBreakdown({
      referenceDate: today,
      advances,
      employees,
      projectId: selectedProject.id,
      towerId: selectedTower.id,
    });

    const { towerRows } = computeProjectAndTowerExpenses({
      projects,
      towers,
      employees,
      attendance,
      advances,
      expenses,
    });
    const twrCost = towerRows.find((r) => r.tower.id === selectedTower.id);
    const dur = formatDurationBreakdown(selectedTower.startDate, selectedTower.finishDate, today);

    const msg = formatTowerProjectStatusWhatsappMessage({
      companyName,
      project: selectedProject,
      tower: selectedTower,
      flatsCount: towerFlats.length,
      completedZones: tDone,
      totalZones: tTotal,
      inProgressZones: tRunning,
      attendanceSummary: attSummary,
      foodDaily: food.dailyFoodTotal,
      foodMonthly: food.monthlyFoodTotal,
      totalTowerExpense: twrCost?.totalExpenseCost || 0,
      durationLabel: dur.label,
    });

    onTriggerWhatsapp({
      title: `Share ${selectedTower.name} Status to ${roleTitle}`,
      recipientName: contactName ? `${contactName} (${roleTitle})` : `${selectedTower.name} ${roleTitle}`,
      recipientPhone: contactPhone || '',
      recipientEmail: companyProfile?.hrEmail || '',
      emailSubject: `${companyName} Site Status — ${selectedProject.name} / ${selectedTower.name}`,
      message: msg,
    });
  };

  const handleSelectFloorPreset = (presetId: 'typical' | SpecialLevelId) => {
    setFloorPreset(presetId);
    if (presetId === 'typical') {
      setCustomFloorNum('2');
      setCustomFloorLabelInput('');
      setCustomUnitType('3 BHK');
    } else {
      const preset = SPECIAL_FLOOR_PRESETS.find((p) => p.id === presetId);
      if (preset) {
        setCustomFloorNum(String(preset.floorNumber));
        setCustomFloorLabelInput(preset.label);
        setCustomUnitType(preset.defaultUnitType);
      }
    }
  };

  const handleCreateFloorUnits = async (e: React.FormEvent) => {
    e.preventDefault();
    setFloorError('');
    if (!selectedProjectId || !selectedTowerId) {
      setFloorError('Please select a project and tower first.');
      return;
    }

    const parsedFloor = Number(customFloorNum);
    if (!Number.isFinite(parsedFloor) || parsedFloor < -10 || parsedFloor > 150) {
      setFloorError('Level must be between -10 (Basements) and 150.');
      return;
    }

    const parsedEndFloor = customEndFloorNum.trim() ? Number(customEndFloorNum) : undefined;
    if (
      parsedEndFloor !== undefined &&
      (!Number.isFinite(parsedEndFloor) || parsedEndFloor < parsedFloor || parsedEndFloor > 150)
    ) {
      setFloorError('End Floor must be between Start Floor and 150.');
      return;
    }

    const customNumbers =
      floorMode === 'custom' ? parseCustomUnitNumbers(customUnitListText) : undefined;
    if (floorMode === 'custom' && (!customNumbers || customNumbers.length === 0)) {
      setFloorError('Enter at least one flat/unit number (e.g. B1-01, GF-01, 5001).');
      return;
    }
    const mixedSpecs = floorMode === 'mixed' ? getMixedSpecs(flMixedCounts) : undefined;
    if (floorMode === 'mixed' && (!mixedSpecs || mixedSpecs.length === 0)) {
      setFloorError('Enter at least 1 unit count in Mixed BHK configuration.');
      return;
    }
    const orderedSlotTypes =
      floorMode === 'ordered_slots' ? flOrderedSlots : undefined;
    if (floorMode === 'ordered_slots' && (!orderedSlotTypes || orderedSlotTypes.length === 0)) {
      setFloorError('Add at least 1 flat slot in Ordered Slot Layout.');
      return;
    }

    const commonAreaItems = flIncludeCommon
      ? buildQuickFloorCommonSeedItems(
          flCommonElecCount,
          flCommonLiftCount,
          flCommonCorridor
        )
      : undefined;

    setFloorSubmitting(true);
    try {
      const created = await addCustomFloorUnits({
        projectId: selectedProjectId,
        towerId: selectedTowerId,
        floorNumber: parsedFloor,
        endFloorNumber: floorMode !== 'custom' ? parsedEndFloor : undefined,
        floorLabel: customFloorLabelInput.trim() || formatFloorLabel(parsedFloor),
        unitsCount:
          floorMode === 'ordered_slots'
            ? flOrderedSlots.length
            : Number(customUnitsCount) || 3,
        unitType: customUnitType.trim() || '3 BHK',
        customUnitNumbers: customNumbers,
        mixedSpecs,
        orderedSlotTypes,
        commonAreaItems,
      });
      setSelectedFloorFilter('all');
      setUnitSearch('');
      if (created[0]) {
        setSelectedFlatId(created[0].id);
      }
      setCustomUnitListText('');
      setCustomEndFloorNum('');
      setShowAddFloor(false);
    } catch (err) {
      setFloorError(err instanceof Error ? err.message : 'Failed to add floor & flats.');
    } finally {
      setFloorSubmitting(false);
    }
  };

  const handleAddFlatCustomZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFlat || !newFlatZoneLabel.trim()) return;
    await addCustomZoneToFlat({
      flatId: selectedFlat.id,
      label: newFlatZoneLabel.trim(),
      category: newFlatZoneCat,
      sqft: Number(newFlatZoneSqft) || 100,
    });
    setNewFlatZoneLabel('');
    setNewFlatZoneSqft('120');
    setShowAddFlatZone(false);
  };

  const handleOpenWholeFloorZoneModal = (overrideFloor?: number) => {
    const defaultFloorNum =
      typeof overrideFloor === 'number' && Number.isFinite(overrideFloor)
        ? overrideFloor
        : selectedFloorFilter !== 'all'
          ? Number(selectedFloorFilter)
          : floorsAvailable[0]
            ? floorsAvailable[0][0]
            : 1;
    setWfTargetMode('common_unit');
    setWfFloorNum(String(defaultFloorNum));
    setWfSelectedFloors([defaultFloorNum]);
    setWfRoomSpecs(WHOLE_FLOOR_COMMON_ROOM_TEMPLATES.map((t) => ({ ...t })));
    setWfCustomRooms([]);
    setWfPresetSelection(
      Object.fromEntries(
        WHOLE_FLOOR_CUSTOM_PRESETS.map((p) => [
          p.label,
          { selected: false, sqft: String(p.defaultSqft) },
        ])
      )
    );
    setWfZoneLabel('');
    setWfZoneCat('Common');
    setWfZoneSqft('120');
    setWfZoneStatus('not_started');
    setWfError('');
    setShowWholeFloorZoneModal(true);
  };

  const getWholeFloorDraftItems = (): WholeFloorCustomZoneItem[] => {
    if (wfTargetMode === 'common_unit') {
      const combinedRooms: WholeFloorCommonRoomSpec[] = [
        ...wfRoomSpecs,
        ...wfCustomRooms.map((cr) => ({
          id: cr.id,
          baseName: cr.baseName,
          count: cr.count,
          includeFlooring: cr.includeFlooring,
          includeSkirting: cr.includeSkirting,
          includeDado: false,
          flooringCategory: cr.category,
          flooringSqft: Math.max(0, Number(cr.flooringSqft) || 0),
          skirtingSqft: Math.max(0, Number(cr.skirtingSqft) || 0),
        })),
      ];
      const extraAreas = wfZoneLabel.trim()
        ? [
            {
              label: wfZoneLabel.trim(),
              category: wfZoneCat,
              sqft: Math.max(0, Number(wfZoneSqft) || 0),
            },
          ]
        : [];
      return buildWholeFloorCommonZoneItems({
        rooms: combinedRooms,
        extraAreas,
        status: wfZoneStatus,
      });
    }

    const items: WholeFloorCustomZoneItem[] = [];
    for (const preset of WHOLE_FLOOR_CUSTOM_PRESETS) {
      const sel = wfPresetSelection[preset.label];
      if (sel?.selected) {
        items.push({
          label: preset.label,
          category: preset.category,
          sqft: Math.max(0, Number(sel.sqft) || preset.defaultSqft),
          status: wfZoneStatus,
        });
      }
    }
    if (wfZoneLabel.trim()) {
      items.push({
        label: wfZoneLabel.trim(),
        category: wfZoneCat,
        sqft: Math.max(0, Number(wfZoneSqft) || 0),
        status: wfZoneStatus,
      });
    }
    return items;
  };

  const handleAddZoneToWholeFloor = async (e: React.FormEvent) => {
    e.preventDefault();
    setWfError('');
    if (!selectedProjectId || !selectedTowerId) {
      setWfError('Please select a Project & Tower first.');
      return;
    }

    const targetFloors =
      wfTargetMode === 'common_unit'
        ? wfSelectedFloors
        : [Number(wfFloorNum)].filter((n) => Number.isFinite(n));

    if (targetFloors.length === 0) {
      setWfError('Select at least one floor level.');
      return;
    }

    const items = getWholeFloorDraftItems();
    if (items.length === 0) {
      setWfError(
        wfTargetMode === 'common_unit'
          ? 'Set count >= 1 on Electrical Room / Lift Lobby / Corridor or enter a custom floor area.'
          : 'Select at least one site preset or enter a custom area name.'
      );
      return;
    }

    setWfBusy(true);
    try {
      if (wfTargetMode === 'common_unit') {
        const res = await upsertFloorCommonAreas({
          projectId: selectedProjectId,
          towerId: selectedTowerId,
          floorNumbers: targetFloors,
          items,
        });
        if (res.firstCommonUnitId) {
          setSelectedFlatId(res.firstCommonUnitId);
        }
        const floorText = targetFloors
          .map((n) => floorsAvailable.find(([num]) => num === n)?.[1] || formatFloorLabel(n))
          .join(', ');
        const areaPreview = items
          .slice(0, 5)
          .map((i) => i.label)
          .join(', ');
        const moreText = items.length > 5 ? ` +${items.length - 5} more` : '';
        setWfFeedback(
          `Saved Floor Common Areas (${areaPreview}${moreText}) across ${floorText}: ${res.addedZonesCount} area${res.addedZonesCount === 1 ? '' : 's'} added (${res.createdUnitsCount} new common unit${res.createdUnitsCount === 1 ? '' : 's'}, ${res.updatedUnitsCount} updated).${
            res.skippedExistingCount > 0
              ? ` Kept ${res.skippedExistingCount} existing area(s) untouched.`
              : ''
          }`
        );
      } else {
        const targetFloor = targetFloors[0];
        const res = await addCustomZonesToWholeFloor({
          towerId: selectedTowerId,
          floorNumber: targetFloor,
          items,
        });
        const floorLbl =
          floorsAvailable.find(([num]) => num === targetFloor)?.[1] ||
          formatFloorLabel(targetFloor);
        const areaNames = items.map((i) => i.label).join(', ');
        setWfFeedback(
          `Added ${items.length} area${items.length === 1 ? '' : 's'} (${areaNames}) to ${res.updatedCount} unit${res.updatedCount === 1 ? '' : 's'} on ${floorLbl}.${
            res.skippedAtLimitCount > 0 ? ` (${res.skippedAtLimitCount} hit 40-area limit.)` : ''
          }`
        );
      }
      setShowWholeFloorZoneModal(false);
    } catch (err) {
      setWfError(err instanceof Error ? err.message : 'Failed to save whole-floor common areas.');
    } finally {
      setWfBusy(false);
    }
  };

  const handleOpenCustomizeZones = () => {
    setDraftCatalog(zoneCatalog.map((z) => ({ ...z })));
    setNewCatZoneLabel('');
    setNewCatZoneCategory('Flooring');
    setNewCatZoneSqft('120');
    setShowCustomizeZones(true);
  };

  const handleAddCatalogZone = () => {
    if (!newCatZoneLabel.trim()) return;
    const baseKey = slugifyZoneKey(newCatZoneLabel);
    let key = baseKey;
    let idx = 2;
    while (draftCatalog.some((z) => z.key === key)) {
      key = `${baseKey}_${idx++}`;
    }
    setDraftCatalog((prev) => [
      ...prev,
      {
        key,
        label: newCatZoneLabel.trim(),
        category: newCatZoneCategory,
        defaultSqft: Math.max(0, Number(newCatZoneSqft) || 100),
        isDefault: false,
      },
    ]);
    setNewCatZoneLabel('');
    setNewCatZoneSqft('120');
  };

  const handleSaveCatalog = async () => {
    setCatalogSaving(true);
    try {
      await updateTileZoneCatalog(draftCatalog);
      setShowCustomizeZones(false);
    } finally {
      setCatalogSaving(false);
    }
  };

  const handleConfirmRemoveTower = async () => {
    if (!selectedTowerId) return;
    setRemovingBusy(true);
    try {
      await removeTower(selectedTowerId);
      setConfirmRemoveTower(false);
      setSelectedFloorFilter('all');
    } finally {
      setRemovingBusy(false);
    }
  };

  const handleConfirmRemoveFlat = async () => {
    if (!confirmRemoveFlatId) return;
    setRemovingBusy(true);
    try {
      await removeFlat(confirmRemoveFlatId);
      setConfirmRemoveFlatId(null);
    } finally {
      setRemovingBusy(false);
    }
  };

  const parsedCustomFloor = Number(customFloorNum);
  const previewFloorMixedSpecs =
    floorMode === 'mixed'
      ? buildMixedBhkFloorUnits({
          floorNumber: Number.isFinite(parsedCustomFloor) ? parsedCustomFloor : 1,
          mixedSpecs: getMixedSpecs(flMixedCounts),
        })
      : [];
  const previewFloorOrderedSpecs =
    floorMode === 'ordered_slots'
      ? buildOrderedSlotFloorUnits({
          floorNumber: Number.isFinite(parsedCustomFloor) ? parsedCustomFloor : 1,
          slotUnitTypes: flOrderedSlots,
        })
      : [];
  const previewFloorUnits =
    floorMode === 'auto'
      ? generateUnitNumbersForFloor(
          Number.isFinite(parsedCustomFloor) ? parsedCustomFloor : 0,
          Number(customUnitsCount) || 1
        )
      : floorMode === 'mixed'
        ? previewFloorMixedSpecs.map((u) => `${u.unitNumber} (${u.unitType})`)
        : floorMode === 'ordered_slots'
          ? previewFloorOrderedSpecs.map((u) => `${u.unitNumber} (${u.unitType})`)
          : parseCustomUnitNumbers(customUnitListText);

  const openZoneIssues = useMemo(
    () =>
      collectOpenZoneIssuesForFlats({
        flats,
        projects,
        towers,
        tileZoneCatalog: zoneCatalog,
      }),
    [flats, projects, towers, zoneCatalog]
  );

  const stopVoiceRecording = () => {
    if (voiceStopTimerRef.current !== null) {
      window.clearTimeout(voiceStopTimerRef.current);
      voiceStopTimerRef.current = null;
    }
    try {
      speechRecRef.current?.stop?.();
    } catch {
      // Ignore
    }
    speechRecRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore
      }
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setIsRecordingVoice(false);
  };

  useEffect(() => {
    return () => {
      stopVoiceRecording();
    };
  }, []);

  const startVoiceRecording = async () => {
    setVoiceRecordError('');
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setVoiceRecordError(
        'Microphone recording is not available in this browser. Type or paste the voice note transcript below.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        if (blob.size > 0) {
          const reader = new FileReader();
          reader.onloadend = () => {
            const res = typeof reader.result === 'string' ? reader.result : '';
            if (res.length > 65000) {
              setVoiceRecordError(
                'Voice recording exceeded 65 KB limit. Keep voice clips under 6 seconds or add a text transcript.'
              );
            } else if (res.startsWith('data:audio/')) {
              setDraftVoiceDataUrl(res);
            }
          };
          reader.readAsDataURL(blob);
        }
        setIsRecordingVoice(false);
      };

      // Optional live SpeechRecognition dictation if supported
      try {
        const win = window as unknown as {
          SpeechRecognition?: new () => {
            continuous: boolean;
            interimResults: boolean;
            lang: string;
            onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
            start: () => void;
            stop: () => void;
          };
          webkitSpeechRecognition?: new () => {
            continuous: boolean;
            interimResults: boolean;
            lang: string;
            onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
            start: () => void;
            stop: () => void;
          };
        };
        const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
        if (SpeechRec) {
          const rec = new SpeechRec();
          rec.continuous = true;
          rec.interimResults = false;
          rec.lang = 'en-IN';
          rec.onresult = (ev) => {
            const parts: string[] = [];
            for (let i = 0; i < ev.results.length; i += 1) {
              const t = ev.results[i]?.[0]?.transcript;
              if (t) parts.push(t.trim());
            }
            if (parts.length > 0) {
              setDraftVoiceTranscript(parts.join(' ').slice(0, 400));
            }
          };
          rec.start();
          speechRecRef.current = rec;
        }
      } catch {
        // Ignore SpeechRecognition errors silently
      }

      recorder.start();
      setIsRecordingVoice(true);
      voiceStopTimerRef.current = window.setTimeout(() => {
        stopVoiceRecording();
      }, 6500);
    } catch (err) {
      setVoiceRecordError(
        err instanceof Error
          ? `Mic access blocked (${err.message}). You can type the voice note transcript below.`
          : 'Microphone unavailable. Type the voice note transcript below.'
      );
    }
  };

  const openZoneRemarkModal = (flatId: string, zoneKey: string, zoneLabel: string) => {
    const targetFlat = flats.find((f) => f.id === flatId);
    const zState = targetFlat?.zones?.[zoneKey];
    stopVoiceRecording();
    setRemarkModalZone({ flatId, zoneKey, zoneLabel });
    setDraftZoneNotes(zState?.notes || '');
    setDraftVoiceTranscript(zState?.voiceNoteTranscript || '');
    setDraftVoiceDataUrl(zState?.voiceNoteDataUrl || '');
    setDraftFlagOpenIssue(zState?.issueStatus === 'open' || (!zState?.notes && !zState?.issueStatus));
    setVoiceRecordError('');
  };

  const handleSaveZoneRemark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remarkModalZone) return;
    const targetFlat = flats.find((f) => f.id === remarkModalZone.flatId);
    const prevZone = targetFlat?.zones?.[remarkModalZone.zoneKey];
    setSavingZoneRemark(true);
    try {
      await updateFlatZone({
        flatId: remarkModalZone.flatId,
        zoneKey: remarkModalZone.zoneKey,
        status: prevZone?.status || 'not_started',
        sqft: prevZone?.sqft ?? 100,
        assignedEmployeeId: prevZone?.assignedEmployeeId,
        notes: draftZoneNotes.trim(),
        voiceNoteDataUrl: draftVoiceDataUrl,
        voiceNoteTranscript: draftVoiceTranscript.trim(),
        issueStatus: draftFlagOpenIssue
          ? 'open'
          : prevZone?.issueStatus === 'open'
            ? 'rectified'
            : prevZone?.issueStatus,
        issueReportedBy: session?.displayName || (isSupervisor ? 'Supervisor' : 'Admin'),
        issueReportedAt: draftFlagOpenIssue ? new Date().toISOString() : prevZone?.issueReportedAt,
      });
      setRemarkModalZone(null);
    } finally {
      setSavingZoneRemark(false);
    }
  };

  const projectDur = selectedProject
    ? formatDurationBreakdown(selectedProject.startDate, selectedProject.finishDate, getTodayIso())
    : null;
  const towerDur = selectedTower
    ? formatDurationBreakdown(selectedTower.startDate, selectedTower.finishDate, getTodayIso())
    : null;

  return (
    <div className="space-y-6">
      {/* Header & Project/Tower Controls */}
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Projects, Towers &amp; Flat Tile Matrix
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Track Basements (B1–B3), Ground Floor, Podium &amp; Flats (101–5002+), timelines, and Tower Incharge / Supervisor / Engineer / Manager contacts.
          </p>
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="projects-open-site-map-btn"
              onClick={() => setShowSiteMapModal(true)}
              disabled={projects.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 disabled:opacity-50 whitespace-nowrap"
            >
              <MapPin className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
              <span>Site Map</span>
            </button>
            <button
              type="button"
              data-testid="projects-open-qr-studio-btn"
              onClick={() => setShowQrStudioModal(true)}
              disabled={projects.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 disabled:opacity-50 whitespace-nowrap"
            >
              <QrCode className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
              <span>Site QR Codes</span>
            </button>
            {onOpenProjectLogsReport && (
              <button
                type="button"
                data-testid="projects-open-logs-report-btn"
                onClick={() => onOpenProjectLogsReport(selectedProjectId || undefined)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 whitespace-nowrap"
              >
                <ScrollText className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                <span>Logs Report</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenCustomizeZones}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Customize Tile Areas</span>
            </button>
            <button
              type="button"
              onClick={() => handleOpenWholeFloorZoneModal()}
              disabled={!selectedTowerId || floorsAvailable.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-orange-800 bg-orange-50 border border-orange-300 rounded-md hover:bg-orange-100 disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Floor Common Areas</span>
            </button>
            <button
              type="button"
              onClick={handleOpenNewProject}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New Project</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTowerError('');
                setTowerName('');
                setSelectedSpecialLevels([]);
                resetTowerContactFields();
                setShowNewTower(true);
              }}
              disabled={!selectedProjectId}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Tower</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemoveTower(true)}
              disabled={!selectedTowerId}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-40 whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Remove Tower</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFloorError('');
                setFloorPreset('typical');
                setCustomFloorNum('2');
                setCustomEndFloorNum('');
                setCustomFloorLabelInput('');
                setShowAddFloor(true);
              }}
              disabled={!selectedTowerId}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Floor / Flats</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="projects-open-site-map-btn"
              onClick={() => setShowSiteMapModal(true)}
              disabled={projects.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <MapPin className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
              <span>Site Map</span>
            </button>
            <button
              type="button"
              data-testid="projects-open-qr-studio-btn"
              onClick={() => setShowQrStudioModal(true)}
              disabled={projects.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <QrCode className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
              <span>Site QR Codes</span>
            </button>
            {onOpenProjectLogsReport && (
              <button
                type="button"
                data-testid="projects-open-logs-report-btn"
                onClick={() => onOpenProjectLogsReport(selectedProjectId || undefined)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
              >
                <ScrollText className="w-3.5 h-3.5 text-orange-700" aria-hidden="true" />
                <span>Logs Report</span>
              </button>
            )}
            <div className="px-3 py-1.5 text-xs font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded-md whitespace-nowrap">
              Assigned Tower Scope · Work Allotment &amp; Status Updates
            </div>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label htmlFor="matrix-project" className="block text-xs font-medium text-slate-500 mb-1">
            Project
          </label>
          <select
            id="matrix-project"
            value={selectedProjectId}
            onChange={(e) => {
              setSelectedProjectId(e.target.value);
              setSelectedFloorFilter('all');
            }}
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
          <label htmlFor="matrix-tower" className="block text-xs font-medium text-slate-500 mb-1">
            Tower / Block
          </label>
          <select
            id="matrix-tower"
            value={selectedTowerId}
            onChange={(e) => {
              setSelectedTowerId(e.target.value);
              setSelectedFloorFilter('all');
            }}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
          >
            {projectTowers.length === 0 ? (
              <option value="">No towers</option>
            ) : (
              projectTowers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label htmlFor="matrix-floor" className="block text-xs font-medium text-slate-500 mb-1">
            Level / Floor Filter
          </label>
          <select
            id="matrix-floor"
            value={selectedFloorFilter}
            onChange={(e) => setSelectedFloorFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
          >
            <option value="all">All Levels ({towerFlats.length} Units)</option>
            {floorsAvailable.map(([flNum, flLbl]) => (
              <option key={flNum} value={String(flNum)}>
                {flLbl}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="matrix-search" className="block text-xs font-medium text-slate-500 mb-1">
            Find Flat / Level (e.g. B1, GF, 101, 5001)
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
            <input
              id="matrix-search"
              type="text"
              value={unitSearch}
              onChange={(e) => setUnitSearch(e.target.value)}
              placeholder="Search flat or level..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
            />
          </div>
        </div>
      </div>

      {/* Inline Google Maps Active Site Completion Map */}
      {projects.length > 0 && (
        <section
          data-testid="projects-inline-map-section"
          className="bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="w-4 h-4 text-orange-700 shrink-0" aria-hidden="true" />
              <span className="text-sm font-semibold text-slate-900">
                Active Project Sites Map (Color-Coded by Completion Status)
              </span>
            </div>
            <button
              type="button"
              data-testid="toggle-inline-site-map-btn"
              onClick={() => setShowInlineSiteMap((prev) => !prev)}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 whitespace-nowrap"
            >
              {showInlineSiteMap ? 'Hide Map' : 'Show Map'}
            </button>
          </div>
          {showInlineSiteMap && (
            <ProjectSitesCompletionMap
              compact
              projects={projects}
              towers={towers}
              flats={flats}
              tileZoneCatalog={zoneCatalog}
              selectedProjectId={selectedProjectId}
              onSelectProject={(projectId) => {
                setSelectedProjectId(projectId);
                setSelectedFloorFilter('all');
              }}
              onSaveProjectPlaceId={(projectId, placeId) => {
                void updateProject(projectId, { placeId });
              }}
            />
          )}
        </section>
      )}

      {/* Project & Tower Timeline + Leadership Contact Strip */}
      {selectedProject && (
        <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              <div className="flex items-center gap-1.5 text-slate-700">
                <CalendarClock className="w-4 h-4 text-orange-700 shrink-0" aria-hidden="true" />
                <span>
                  <strong className="text-slate-900">{selectedProject.name}</strong>
                  {selectedProject.startDate ? (
                    <span className="font-mono text-slate-600">
                      {' '}
                      · Started {selectedProject.startDate}
                      {selectedProject.finishDate ? ` → ${selectedProject.finishDate}` : ' (Running)'}
                      {projectDur ? ` · ${projectDur.label}` : ''}
                    </span>
                  ) : (
                    <span className="text-slate-500"> · Start date not set</span>
                  )}
                </span>
              </div>

              {selectedTower && (
                <div className="text-slate-700">
                  <strong className="text-slate-900">{selectedTower.name}</strong>
                  {selectedTower.startDate ? (
                    <span className="font-mono text-slate-600">
                      {' '}
                      · Started {selectedTower.startDate}
                      {selectedTower.finishDate ? ` → ${selectedTower.finishDate}` : ' (Running)'}
                      {towerDur ? ` · ${towerDur.label}` : ''}
                    </span>
                  ) : (
                    <span className="text-slate-500"> · Start date not set</span>
                  )}
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {selectedTower && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeployProjId(selectedProject.id);
                      setDeployTwrId(selectedTower.id);
                      setDeployDate(getTodayIso());
                      setDeployNotes('');
                      setDeploySearch('');
                      setDeployHideCurrentTower(true);
                      setDeploySelectedEmpIds([]);
                      setShowDeployToTower(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Users className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
                    <span>Deploy Manpower to Tower ({selectedTowerCrew.length})</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleOpenEditProject(selectedProject)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded hover:bg-slate-100 whitespace-nowrap"
                >
                  <Pencil className="w-3 h-3" aria-hidden="true" />
                  <span>Edit Project &amp; Dates</span>
                </button>
                {selectedTower && (
                  <button
                    type="button"
                    onClick={() => handleOpenEditTower(selectedTower)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded hover:bg-slate-100 whitespace-nowrap"
                  >
                    <Pencil className="w-3 h-3" aria-hidden="true" />
                    <span>Edit Tower &amp; Contacts</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {selectedTower && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {[
                {
                  role: 'Tower Incharge',
                  name: selectedTower.inchargeName,
                  phone: selectedTower.inchargePhone,
                },
                {
                  role: 'Tower Supervisor',
                  name: selectedTower.supervisorName,
                  phone: selectedTower.supervisorPhone,
                },
                {
                  role: 'Site Engineer',
                  name: selectedTower.engineerName || selectedProject.engineerName,
                  phone: selectedTower.engineerPhone || selectedProject.engineerPhone,
                },
                {
                  role: 'Project Manager',
                  name: selectedTower.managerName || selectedProject.managerName,
                  phone: selectedTower.managerPhone || selectedProject.managerPhone,
                },
              ].map((contact) => (
                <div
                  key={contact.role}
                  className="p-2.5 rounded-md border border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-slate-500">{contact.role}</div>
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {contact.name || 'Not added'}
                    </div>
                    <div className="text-[11px] font-mono text-slate-600 flex items-center gap-1">
                      <Phone className="w-2.5 h-2.5 text-slate-400" aria-hidden="true" />
                      <span>{contact.phone || 'No phone'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleShareTowerStatus(contact.role, contact.name, contact.phone)}
                    aria-label={`Share ${selectedTower.name} status via WhatsApp to ${contact.role}`}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 shrink-0"
                  >
                    <MessageSquare className="w-3 h-3" aria-hidden="true" />
                    <span>WA</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Overall Project Work Status & Filters (Tower-wise / Floor-wise / Flat-wise + Area Type) */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Overall Project Work Progress &amp; Printable Area Filters
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Filter by Tower, Custom Floors, Tile Area (Balcony, Main Flooring, Skirting, Electrical, Corridor), and Work Status — then print A4 reports.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Project Scope Toggle */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-md text-xs">
              <button
                type="button"
                onClick={() => setWorkOverviewAllProjects(false)}
                className={`px-2.5 py-1 font-medium rounded whitespace-nowrap ${
                  !workOverviewAllProjects
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {selectedProject?.name || 'Current Project'}
              </button>
              <button
                type="button"
                onClick={() => setWorkOverviewAllProjects(true)}
                className={`px-2.5 py-1 font-medium rounded whitespace-nowrap ${
                  workOverviewAllProjects
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Projects ({projects.length})
              </button>
            </div>

            {/* Breakdown Level */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-md text-xs">
              {(
                [
                  { id: 'tower', label: 'Tower-wise' },
                  { id: 'floor', label: 'Floor-wise' },
                  { id: 'flat', label: 'Flat-wise' },
                ] as const
              ).map((lvl) => (
                <button
                  key={lvl.id}
                  type="button"
                  onClick={() => setWorkBreakdownLevel(lvl.id)}
                  className={`px-2.5 py-1 font-semibold rounded whitespace-nowrap ${
                    workBreakdownLevel === lvl.id
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowWorkReportPreview(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Print Filtered Report</span>
            </button>
          </div>
        </div>

        {/* Tower + Tile Area + Keyword Filter Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="wf-filter-tower" className="block text-[11px] font-medium text-slate-500 mb-1">
              Tower Filter
            </label>
            <select
              id="wf-filter-tower"
              value={workTowerFilter}
              onChange={(e) => {
                setWorkTowerFilter(e.target.value);
                setWorkCustomFloors([]);
              }}
              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              <option value="all">All Towers ({workScopeTowers.length})</option>
              {workScopeTowers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="wf-filter-area" className="block text-[11px] font-medium text-slate-500 mb-1">
              Tile Area Category (Balcony / Main Flooring / Skirting)
            </label>
            <select
              id="wf-filter-area"
              value={workAreaFilter}
              onChange={(e) => setWorkAreaFilter(e.target.value as WorkAreaFilter)}
              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              {WORK_AREA_FILTER_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="wf-filter-search" className="block text-[11px] font-medium text-slate-500 mb-1">
              Custom Area Keyword Filter
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" aria-hidden="true" />
              <input
                id="wf-filter-search"
                type="text"
                value={workAreaSearch}
                onChange={(e) => setWorkAreaSearch(e.target.value)}
                placeholder="Search corridor, electrical, balcony..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md"
              />
            </div>
          </div>
        </div>

        {/* Custom Multi-Floor Chip Selector */}
        {workAvailableFloors.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] font-medium text-slate-500 mr-1">
              Custom Floors:
            </span>
            <button
              type="button"
              onClick={() => setWorkCustomFloors([])}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded border ${
                workCustomFloors.length === 0
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              All Floors ({workAvailableFloors.length})
            </button>
            {workAvailableFloors.map(([flNum, flLbl]) => {
              const selected = workCustomFloors.includes(flNum);
              return (
                <button
                  key={flNum}
                  type="button"
                  onClick={() =>
                    setWorkCustomFloors((prev) =>
                      prev.includes(flNum)
                        ? prev.filter((n) => n !== flNum)
                        : [...prev, flNum].sort((a, b) => a - b)
                    )
                  }
                  className={`px-2.5 py-1 text-[11px] font-medium rounded border ${
                    selected
                      ? 'bg-orange-700 text-white border-orange-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {flLbl}
                </button>
              );
            })}
          </div>
        )}

        {/* Status Filter Bar + Overall Summary Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All Work (${workStatusOverview.totalZones})` },
                { id: 'pending', label: `Pending (${workStatusOverview.pendingZones})` },
                { id: 'prechecking', label: `Prechecking (${workStatusOverview.precheckingZones})` },
                { id: 'in_progress', label: `In Progress (${workStatusOverview.inProgressZones})` },
                {
                  id: 'cleaning_in_progress',
                  label: `Cleaning Running (${workStatusOverview.cleaningInProgressZones})`,
                },
                { id: 'cleaning_done', label: `Cleaning Done (${workStatusOverview.cleaningDoneZones})` },
                { id: 'completed', label: `Completed (${workStatusOverview.completedZones})` },
              ] as const
            ).map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setWorkStatusFilter(st.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap ${
                  workStatusFilter === st.id
                    ? st.id === 'completed'
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : st.id === 'cleaning_done'
                        ? 'bg-teal-700 text-white border-teal-700'
                        : st.id === 'cleaning_in_progress'
                          ? 'bg-cyan-700 text-white border-cyan-700'
                          : st.id === 'prechecking'
                            ? 'bg-sky-700 text-white border-sky-700'
                            : st.id === 'in_progress'
                              ? 'bg-amber-600 text-white border-amber-600'
                              : st.id === 'pending'
                                ? 'bg-slate-700 text-white border-slate-700'
                                : 'bg-orange-700 text-white border-orange-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          <div className="text-xs font-mono text-slate-700 tabular-nums">
            {workStatusOverview.totalFlats} Flats · {workStatusOverview.matchingZonesTotal} Matching Areas (
            {Math.round(workStatusOverview.matchingSqftTotal).toLocaleString('en-IN')} Sq.Ft) ·{' '}
            <strong className="text-emerald-800">{workStatusOverview.overallProgressPct}%</strong>
          </div>
        </div>

        {/* Breakdown Results Table */}
        <div className="overflow-x-auto border border-slate-200 rounded-md">
          {workBreakdownLevel === 'tower' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 px-3">Project / Tower</th>
                  <th className="py-2.5 px-3 text-right">Flats</th>
                  <th className="py-2.5 px-3 text-right">Matched Areas</th>
                  <th className="py-2.5 px-3 text-right">Matched Sq.Ft</th>
                  <th className="py-2.5 px-3 text-right">Pending</th>
                  <th className="py-2.5 px-3 text-right">In Progress</th>
                  <th className="py-2.5 px-3 text-right">Completed</th>
                  <th className="py-2.5 px-3">Progress</th>
                  <th className="py-2.5 px-3 text-right">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workStatusOverview.towerRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-slate-500">
                      No towers match this filter combination.
                    </td>
                  </tr>
                ) : (
                  workStatusOverview.towerRows.map((row) => (
                    <tr key={row.tower.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-900">{row.tower.name}</div>
                        <div className="text-[11px] text-slate-500">{row.projectName}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{row.flatCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-orange-800">
                        {row.matchingZonesCount}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                        {Math.round(row.matchingSqft).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                        {row.pendingZones}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-amber-700">
                        {row.inProgressZones}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-700">
                        {row.completedZones}
                      </td>
                      <td className="py-2.5 px-3 min-w-[120px]">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded overflow-hidden">
                            <div
                              className="h-full bg-emerald-600"
                              style={{ width: `${row.progressPct}%` }}
                            />
                          </div>
                          <span className="font-mono text-slate-700 w-9 text-right">
                            {row.progressPct}%
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProjectId(row.tower.projectId);
                            setSelectedTowerId(row.tower.id);
                            setSelectedFloorFilter('all');
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                        >
                          Open Tower
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {workBreakdownLevel === 'floor' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 px-3">Floor / Level</th>
                  <th className="py-2.5 px-3">Project / Tower</th>
                  <th className="py-2.5 px-3 text-right">Flats</th>
                  <th className="py-2.5 px-3 text-right">Matched Areas</th>
                  <th className="py-2.5 px-3 text-right">Sq.Ft</th>
                  <th className="py-2.5 px-3 text-right">Pending</th>
                  <th className="py-2.5 px-3 text-right">In Progress</th>
                  <th className="py-2.5 px-3 text-right">Completed</th>
                  <th className="py-2.5 px-3">Progress</th>
                  <th className="py-2.5 px-3 text-right">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workStatusOverview.floorRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-slate-500">
                      No floors match this filter combination.
                    </td>
                  </tr>
                ) : (
                  workStatusOverview.floorRows.map((row) => (
                    <tr key={row.key} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">
                        {row.floorLabel}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {row.projectName} · {row.towerName}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{row.flatCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-orange-800">
                        {row.matchingZonesCount}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                        {Math.round(row.matchingSqft).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                        {row.pendingZones}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-amber-700">
                        {row.inProgressZones}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-700">
                        {row.completedZones}
                      </td>
                      <td className="py-2.5 px-3 min-w-[120px]">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded overflow-hidden">
                            <div
                              className="h-full bg-emerald-600"
                              style={{ width: `${row.progressPct}%` }}
                            />
                          </div>
                          <span className="font-mono text-slate-700 w-9 text-right">
                            {row.progressPct}%
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProjectId(row.projectId);
                            setSelectedTowerId(row.towerId);
                            setSelectedFloorFilter(String(row.floorNumber));
                            if (row.flats[0]) setSelectedFlatId(row.flats[0].id);
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                        >
                          Filter Floor
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {workBreakdownLevel === 'flat' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 px-3">Flat / Unit</th>
                  <th className="py-2.5 px-3">Project · Tower · Floor</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Pend / Prog / Done</th>
                  <th className="py-2.5 px-3 text-right">Matched Sq.Ft</th>
                  <th className="py-2.5 px-3">Matching Areas</th>
                  <th className="py-2.5 px-3 text-right">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workStatusOverview.flatRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500">
                      No flats match this filter combination.
                    </td>
                  </tr>
                ) : (
                  workStatusOverview.flatRows.slice(0, 60).map((row) => (
                    <tr key={row.flat.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                        {row.flat.unitNumber}{' '}
                        <span className="font-sans font-normal text-slate-500">
                          ({row.flat.unitType})
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {row.projectName} · {row.towerName} · {row.floorLabel}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded border ${
                            row.overallStatus === 'completed'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : row.overallStatus === 'in_progress'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {row.overallStatus === 'completed'
                            ? 'Completed'
                            : row.overallStatus === 'in_progress'
                              ? 'In Progress'
                              : 'Pending'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                        <span className="text-slate-600">{row.pendingZones}P</span> /{' '}
                        <span className="text-amber-700">{row.inProgressZones}IP</span> /{' '}
                        <span className="text-emerald-700">{row.completedZones}D</span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                        {Math.round(row.matchingSqft).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">
                        {row.matchingZoneLabels.slice(0, 4).join(', ')}
                        {row.matchingZoneLabels.length > 4
                          ? ` +${row.matchingZoneLabels.length - 4} more`
                          : ''}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProjectId(row.flat.projectId);
                            setSelectedTowerId(row.flat.towerId);
                            setSelectedFloorFilter(String(row.flat.floorNumber));
                            setSelectedFlatId(row.flat.id);
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                        >
                          Open Unit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {wfFeedback && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md"
        >
          <span>{wfFeedback}</span>
          <button
            type="button"
            onClick={() => setWfFeedback('')}
            aria-label="Dismiss floor batch update message"
            className="text-emerald-700 hover:text-emerald-900 p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Open Tile-Laying Issues Alert Panel (Remains visible to Supervisor/Admin until Rectified) */}
      {openZoneIssues.length > 0 && (
        <section
          data-testid="projects-open-zone-issues-panel"
          className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-amber-950">
                Open Flat Tile-Laying Issues &amp; Remarks ({openZoneIssues.length})
              </h2>
            </div>
            <span className="text-xs font-medium text-amber-900">
              Stays active on Supervisor &amp; Worker screens until rectified
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {openZoneIssues.map((issue) => {
              const busyKey = `${issue.flatId}_${issue.zoneKey}`;
              return (
                <div
                  key={busyKey}
                  className="bg-white border border-amber-200 rounded-md p-3 flex flex-col justify-between gap-2 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        Unit <span className="font-mono">{issue.unitNumber}</span> · {issue.zoneLabel}
                      </span>
                      <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase bg-red-50 text-red-800 border border-red-200 rounded">
                        Open Issue
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {issue.projectName} · {issue.towerName}
                      {issue.assignedEmployeeName
                        ? ` · Assigned: ${issue.assignedEmployeeName} (${issue.assignedEmpCode || ''})`
                        : ' · Unassigned'}
                    </div>
                    {issue.notes && (
                      <div className="text-slate-800 font-medium">{issue.notes}</div>
                    )}
                    {issue.voiceNoteTranscript && (
                      <div className="text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                        <span className="font-semibold text-orange-800">Voice Note:</span>{' '}
                        {issue.voiceNoteTranscript}
                      </div>
                    )}
                    {issue.voiceNoteDataUrl && (
                      <audio
                        controls
                        src={issue.voiceNoteDataUrl}
                        className="w-full h-8 mt-1"
                        aria-label={`Voice note audio for Unit ${issue.unitNumber} ${issue.zoneLabel}`}
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProjectId(issue.projectId);
                        setSelectedTowerId(issue.towerId);
                        setSelectedFloorFilter('all');
                        setSelectedFlatId(issue.flatId);
                      }}
                      className="text-[11px] font-semibold text-orange-800 hover:underline"
                    >
                      Inspect Flat Zone →
                    </button>
                    <button
                      type="button"
                      disabled={rectifyingKey === busyKey}
                      onClick={async () => {
                        setRectifyingKey(busyKey);
                        try {
                          await rectifyFlatZoneIssue({
                            flatId: issue.flatId,
                            zoneKey: issue.zoneKey,
                          });
                        } finally {
                          setRectifyingKey(null);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-700 rounded hover:bg-emerald-800 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                      <span>
                        {rectifyingKey === busyKey ? 'Rectifying...' : 'Mark Rectified'}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Main Split: Left Flat Grid + Right Flat Zone Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Flat Selector Grid */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Units &amp; Levels ({filteredFlats.length})
              </h2>
              <span className="text-xs text-slate-500">Click unit to inspect rooms</span>
            </div>
            {isAdmin && selectedTowerId && floorsAvailable.length > 0 && (
              <button
                type="button"
                onClick={() => handleOpenWholeFloorZoneModal()}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100 whitespace-nowrap"
              >
                <Plus className="w-3 h-3" aria-hidden="true" />
                <span>+ Floor Common (Elec / Lift)</span>
              </button>
            )}
          </div>

          {filteredFlats.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-slate-600">No flats found in this tower/filter.</p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowAddFloor(true)}
                  className="mt-3 px-4 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
                >
                  Add Floor / Level &amp; Generate Units
                </button>
              )}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[680px] overflow-y-auto pr-1">
              {filteredFlats.map((flat) => {
                const prog = calculateFlatProgress(flat, zoneCatalog);
                const isSelected = flat.id === selectedFlat?.id;
                const isCommon = isFloorCommonUnit(flat);
                return (
                  <button
                    key={flat.id}
                    type="button"
                    onClick={() => setSelectedFlatId(flat.id)}
                    aria-label={`Select Unit ${flat.unitNumber}`}
                    className={`text-left p-3 rounded-md border transition-colors ${
                      isSelected
                        ? 'border-orange-700 bg-orange-50/60 ring-1 ring-orange-700'
                        : isCommon
                          ? 'border-indigo-200 bg-indigo-50/40 hover:border-indigo-300'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-mono font-semibold tabular-nums text-slate-900 truncate">
                        {flat.unitNumber}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-slate-600 shrink-0">
                        {prog.percentComplete}%
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate flex items-center gap-1">
                      {isCommon && (
                        <span className="px-1 py-0 text-[9px] font-bold uppercase rounded bg-indigo-50 border border-indigo-200 text-indigo-800 shrink-0">
                          COMMON
                        </span>
                      )}
                      <span className="truncate">
                        {formatFloorShortTag(flat.floorNumber, flat.floorLabel)} · {flat.unitType}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full bg-slate-100 rounded-sm overflow-hidden">
                      <div
                        className={`h-full ${
                          prog.percentComplete === 100
                            ? 'bg-emerald-600'
                            : prog.completedCount > 0 || prog.inProgressCount > 0
                              ? 'bg-orange-600'
                              : 'bg-slate-300'
                        }`}
                        style={{ width: `${prog.percentComplete}%` }}
                      />
                    </div>
                    <div className="mt-1.5 text-[11px] font-mono tabular-nums text-slate-500">
                      {prog.completedCount}/{prog.totalZones} done
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Flat Zone Tile Work Detail */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-6">
          {!selectedFlat ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Select a unit on the left to manage its tile-laying rooms and areas.
            </div>
          ) : (
            <div className="space-y-5">
              {(() => {
                const prog = calculateFlatProgress(selectedFlat, zoneCatalog);
                const proj = projects.find((p) => p.id === selectedFlat.projectId);
                const twr = towers.find((t) => t.id === selectedFlat.towerId);
                const isCommon = isFloorCommonUnit(selectedFlat);
                return (
                  <div className="flex flex-col gap-3 pb-4 border-b border-slate-200">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500">
                        {proj?.name} · {twr?.name} ·{' '}
                        {formatFloorLabel(selectedFlat.floorNumber, selectedFlat.floorLabel)}
                      </div>
                      <h2 className="text-xl font-semibold text-slate-900 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>
                          {isCommon ? 'Floor Common' : 'Unit'}{' '}
                          <span className="font-mono">{selectedFlat.unitNumber}</span>
                        </span>
                        <span className="text-sm font-normal text-slate-500">
                          ({selectedFlat.unitType})
                        </span>
                        {isCommon && (
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded bg-indigo-50 border border-indigo-200 text-indigo-800">
                            Electrical · Lift Lobby · Corridor
                          </span>
                        )}
                      </h2>
                      <p className="text-xs text-slate-600 mt-1 font-mono tabular-nums">
                        {prog.completedCount} of {prog.totalZones} areas completed · {prog.completedSqft} /{' '}
                        {prog.totalSqft} sq.ft
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {isAdmin && (
                        <>
                          {isCommon && (
                            <button
                              type="button"
                              onClick={() =>
                                handleOpenWholeFloorZoneModal(selectedFlat.floorNumber)
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100 whitespace-nowrap"
                            >
                              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Add Elec / Lift / Area</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowAddFlatZone((v) => !v)}
                            className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 whitespace-nowrap"
                          >
                            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{isCommon ? 'Add Custom Area' : 'Add Area to Flat'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRemoveFlatId(selectedFlat.id)}
                            aria-label={`Remove Unit ${selectedFlat.unitNumber}`}
                            className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50 whitespace-nowrap"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Remove</span>
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenAssignWork(selectedFlat.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap"
                      >
                        <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Search &amp; Assign Crew</span>
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Inline Add Custom Room/Area to Selected Flat */}
              {showAddFlatZone && (
                <form
                  onSubmit={handleAddFlatCustomZone}
                  className="p-3.5 bg-slate-50 border border-slate-200 rounded-md grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
                >
                  <div className="sm:col-span-5">
                    <label htmlFor="flat-zone-lbl" className="block text-[11px] font-medium text-slate-700 mb-1">
                      Custom Room / Area Name
                    </label>
                    <input
                      id="flat-zone-lbl"
                      type="text"
                      required
                      value={newFlatZoneLabel}
                      onChange={(e) => setNewFlatZoneLabel(e.target.value)}
                      placeholder="e.g. Pooja Room Flooring / Lift Lobby"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label htmlFor="flat-zone-cat" className="block text-[11px] font-medium text-slate-700 mb-1">
                      Category
                    </label>
                    <select
                      id="flat-zone-cat"
                      value={newFlatZoneCat}
                      onChange={(e) => setNewFlatZoneCat(e.target.value as TileZoneCategory)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    >
                      {ZONE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="flat-zone-sqft" className="block text-[11px] font-medium text-slate-700 mb-1">
                      Sq.Ft
                    </label>
                    <input
                      id="flat-zone-sqft"
                      type="number"
                      min="0"
                      value={newFlatZoneSqft}
                      onChange={(e) => setNewFlatZoneSqft(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div className="sm:col-span-2 flex gap-1.5">
                    <button
                      type="submit"
                      className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded hover:bg-orange-800 whitespace-nowrap"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddFlatZone(false)}
                      className="px-2 py-1.5 text-xs text-slate-600 border border-slate-300 rounded bg-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </form>
              )}

              {/* Quick Worker Filter for Matrix Dropdowns */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-slate-600">
                  Showing {effectiveFlatZones.length} tile-laying areas
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" aria-hidden="true" />
                  <input
                    type="text"
                    aria-label="Filter worker options in dropdowns"
                    value={workerSearch}
                    onChange={(e) => setWorkerSearch(e.target.value)}
                    placeholder="Filter workers (name, ID, role)..."
                    className="w-full pl-8 pr-3 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-orange-600"
                  />
                </div>
              </div>

              {/* Tile-Laying Areas Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                      <th className="py-2 pr-3">Tile-Laying Area</th>
                      <th className="py-2 px-2 w-20 text-right">Sq.Ft</th>
                      <th className="py-2 px-2">Assigned Worker</th>
                      <th className="py-2 px-2 min-w-[200px]">Note &amp; Remarks</th>
                      <th className="py-2 pl-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {effectiveFlatZones.map((zoneDef) => {
                      const zState = selectedFlat.zones?.[zoneDef.key] || {
                        status: 'not_started' as ZoneStatus,
                        sqft: zoneDef.defaultSqft,
                      };
                      const isEditing = editingZoneKey === zoneDef.key;
                      const currentEmp = zState.assignedEmployeeId
                        ? activeEmployees.find((e) => e.id === zState.assignedEmployeeId)
                        : undefined;
                      const selectEmployees =
                        currentEmp && !filteredWorkerOptions.some((e) => e.id === currentEmp.id)
                          ? [currentEmp, ...filteredWorkerOptions]
                          : filteredWorkerOptions;
                      const hasVoice = Boolean(zState.voiceNoteDataUrl || zState.voiceNoteTranscript);
                      const isOpenIssue = zState.issueStatus === 'open';
                      const zoneBusyKey = `${selectedFlat.id}_${zoneDef.key}`;

                      return (
                        <tr
                          key={zoneDef.key}
                          className={isOpenIssue ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-slate-50/70'}
                        >
                          <td className="py-2.5 pr-3">
                            {isEditing ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <input
                                  type="text"
                                  value={editingZoneLabel}
                                  onChange={(e) => setEditingZoneLabel(e.target.value)}
                                  className="px-2 py-1 text-xs border border-slate-300 rounded w-40"
                                />
                                <select
                                  value={editingZoneCat}
                                  onChange={(e) => setEditingZoneCat(e.target.value as TileZoneCategory)}
                                  className="px-1.5 py-1 text-xs border border-slate-300 rounded bg-white"
                                >
                                  {ZONE_CATEGORIES.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (editingZoneLabel.trim()) {
                                      await renameFlatZone({
                                        flatId: selectedFlat.id,
                                        zoneKey: zoneDef.key,
                                        label: editingZoneLabel.trim(),
                                        category: editingZoneCat,
                                      });
                                    }
                                    setEditingZoneKey(null);
                                  }}
                                  className="px-2 py-1 text-[11px] font-semibold text-white bg-orange-700 rounded"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingZoneKey(null)}
                                  className="px-2 py-1 text-[11px] text-slate-600 border border-slate-300 rounded"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium text-slate-900">{zoneDef.label}</span>
                                  {isAdmin && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingZoneKey(zoneDef.key);
                                          setEditingZoneLabel(zoneDef.label);
                                          setEditingZoneCat(zoneDef.category);
                                        }}
                                        aria-label={`Rename ${zoneDef.label}`}
                                        className="p-0.5 text-slate-400 hover:text-slate-700 rounded"
                                      >
                                        <Pencil className="w-3 h-3" aria-hidden="true" />
                                      </button>
                                      {!zoneDef.isDefault && (
                                        <button
                                          type="button"
                                          onClick={() => removeFlatZone(selectedFlat.id, zoneDef.key)}
                                          aria-label={`Remove ${zoneDef.label} from flat`}
                                          className="p-0.5 text-slate-400 hover:text-red-700 rounded"
                                        >
                                          <Trash2 className="w-3 h-3" aria-hidden="true" />
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-1.5">
                                  <span>{zoneDef.category}</span>
                                  {zState.updatedDate && (
                                    <span className="whitespace-nowrap font-mono">
                                      · Updated {zState.updatedDate}
                                    </span>
                                  )}
                                </div>
                              </>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-right">
                            <input
                              type="number"
                              min="0"
                              aria-label={`${zoneDef.label} square feet`}
                              value={zState.sqft}
                              onChange={(e) =>
                                updateFlatZone({
                                  flatId: selectedFlat.id,
                                  zoneKey: zoneDef.key,
                                  status: zState.status,
                                  sqft: Number(e.target.value) || 0,
                                  assignedEmployeeId: zState.assignedEmployeeId,
                                })
                              }
                              className="w-20 px-2 py-1 text-right text-xs font-mono tabular-nums border border-slate-200 rounded focus:outline-none focus:border-orange-600"
                            />
                          </td>
                          <td className="py-2.5 px-2">
                            <select
                              aria-label={`Assign worker for ${zoneDef.label}`}
                              value={zState.assignedEmployeeId || ''}
                              onChange={(e) =>
                                updateFlatZone({
                                  flatId: selectedFlat.id,
                                  zoneKey: zoneDef.key,
                                  status:
                                    zState.status === 'not_started' && e.target.value
                                      ? 'in_progress'
                                      : zState.status,
                                  sqft: zState.sqft,
                                  assignedEmployeeId: e.target.value ? e.target.value : '',
                                  createHistoryRecord: Boolean(e.target.value),
                                })
                              }
                              className="w-full min-w-[130px] px-2 py-1 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-orange-600"
                            >
                              <option value="">Unassigned</option>
                              {selectEmployees.map((emp) => (
                                <option key={emp.id} value={emp.id}>
                                  {emp.empCode} · {emp.fullName}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 px-2">
                            <div className="space-y-1 max-w-[230px]">
                              {isOpenIssue && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase bg-red-50 text-red-800 border border-red-200 rounded">
                                  <Flag className="w-2.5 h-2.5" aria-hidden="true" />
                                  <span>Open Issue</span>
                                </span>
                              )}
                              {zState.issueStatus === 'rectified' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                                  Rectified
                                </span>
                              )}
                              {zState.notes && (
                                <p className="text-[11px] text-slate-700 leading-snug line-clamp-2">
                                  {zState.notes}
                                </p>
                              )}
                              {zState.voiceNoteTranscript && (
                                <p className="text-[10.5px] text-orange-900 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5 leading-snug line-clamp-2">
                                  <Volume2 className="w-3 h-3 inline mr-1" aria-hidden="true" />
                                  {zState.voiceNoteTranscript}
                                </p>
                              )}
                              {zState.voiceNoteDataUrl && (
                                <audio
                                  controls
                                  src={zState.voiceNoteDataUrl}
                                  className="w-44 h-7"
                                  aria-label={`Play voice note for ${zoneDef.label}`}
                                />
                              )}
                              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                <button
                                  type="button"
                                  data-testid={`zone-note-btn-${zoneDef.key}`}
                                  onClick={() =>
                                    openZoneRemarkModal(selectedFlat.id, zoneDef.key, zoneDef.label)
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-slate-800 bg-white border border-slate-300 rounded hover:bg-slate-50"
                                >
                                  <Mic className="w-3 h-3 text-orange-700" aria-hidden="true" />
                                  <span>
                                    {zState.notes || hasVoice ? 'Edit Note / Voice' : 'Add Note / Voice'}
                                  </span>
                                </button>
                                {isOpenIssue && (
                                  <button
                                    type="button"
                                    disabled={rectifyingKey === zoneBusyKey}
                                    onClick={async () => {
                                      setRectifyingKey(zoneBusyKey);
                                      try {
                                        await rectifyFlatZoneIssue({
                                          flatId: selectedFlat.id,
                                          zoneKey: zoneDef.key,
                                        });
                                      } finally {
                                        setRectifyingKey(null);
                                      }
                                    }}
                                    className="px-2 py-0.5 text-[11px] font-semibold text-white bg-emerald-700 rounded hover:bg-emerald-800 disabled:opacity-50"
                                  >
                                    Rectify
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 pl-2">
                            <select
                              aria-label={`Status for ${zoneDef.label}`}
                              value={zState.status}
                              onChange={(e) =>
                                updateFlatZone({
                                  flatId: selectedFlat.id,
                                  zoneKey: zoneDef.key,
                                  status: e.target.value as ZoneStatus,
                                  sqft: zState.sqft,
                                  assignedEmployeeId: zState.assignedEmployeeId,
                                  createHistoryRecord: Boolean(zState.assignedEmployeeId),
                                })
                              }
                              className={`w-full min-w-[130px] px-2 py-1 text-xs font-medium rounded border focus:outline-none ${getWorkStatusBadgeClass(
                                zState.status
                              )}`}
                            >
                              {Object.entries(ZONE_STATUS_LABELS).map(([k, lbl]) => (
                                <option key={k} value={k}>
                                  {lbl}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Flat Assignment History with Start/Finish Duration */}
              <div className="pt-4 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900 mb-2">
                  Unit {selectedFlat.unitNumber} Assignment History
                </h3>
                {flatAssignments.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No crew assignments logged for Unit {selectedFlat.unitNumber} yet. Assign a worker above to log history.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 text-xs">
                    {flatAssignments.map((item) => {
                      const dur = formatDurationBreakdown(
                        item.assignedDate,
                        item.completedDate,
                        getTodayIso()
                      );
                      const isOpenTask = isActiveWorkStatus(item.status);
                      return (
                        <div key={item.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-medium text-slate-900">{item.zoneLabel}</span>
                            <span className="text-slate-500">
                              {' '}
                              · {item.employeeName} ({item.empCode})
                            </span>
                            <div className="text-[11px] font-mono text-slate-500">
                              Start: {item.assignedDate}
                              {item.completedDate ? ` · Finish: ${item.completedDate}` : ' · Running'}
                              {' · '}
                              {dur.compactLabel}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isOpenTask && (
                              <button
                                type="button"
                                onClick={() => completeAssignment(item.id, getTodayIso())}
                                className="px-2 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                              >
                                Mark Completed
                              </button>
                            )}
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border ${getWorkStatusBadgeClass(
                                item.status
                              )}`}
                            >
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>{getWorkStatusLabel(item.status)}</span>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Modal: Customize Global Room / Tile Areas Catalog */}
      {showCustomizeZones && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="customize-zones-title"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 id="customize-zones-title" className="text-base font-semibold text-slate-900">
                  Customize Default Room &amp; Tile Areas
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure room/tile zones generated for every new flat, basement, podium, or lobby unit.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCustomizeZones(false)}
                aria-label="Close customize tile areas modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                <div className="sm:col-span-5">
                  <label htmlFor="cat-zone-name" className="block text-xs font-medium text-slate-700 mb-1">
                    New Room / Tile Area Name
                  </label>
                  <input
                    id="cat-zone-name"
                    type="text"
                    value={newCatZoneLabel}
                    onChange={(e) => setNewCatZoneLabel(e.target.value)}
                    placeholder="e.g. Pooja Room Flooring"
                    className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label htmlFor="cat-zone-type" className="block text-xs font-medium text-slate-700 mb-1">
                    Category
                  </label>
                  <select
                    id="cat-zone-type"
                    value={newCatZoneCategory}
                    onChange={(e) => setNewCatZoneCategory(e.target.value as TileZoneCategory)}
                    className="w-full px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    {ZONE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="cat-zone-sqft" className="block text-xs font-medium text-slate-700 mb-1">
                    Default Sq.Ft
                  </label>
                  <input
                    id="cat-zone-sqft"
                    type="number"
                    min="0"
                    value={newCatZoneSqft}
                    onChange={(e) => setNewCatZoneSqft(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={handleAddCatalogZone}
                    className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Add</span>
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-100 border border-slate-200 rounded-md overflow-hidden">
                {draftCatalog.map((item, idx) => (
                  <div
                    key={item.key}
                    className="p-2.5 bg-white grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                  >
                    <div className="sm:col-span-5">
                      <input
                        type="text"
                        aria-label={`Area label ${item.label}`}
                        value={item.label}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftCatalog((prev) =>
                            prev.map((z, i) => (i === idx ? { ...z, label: v } : z))
                          );
                        }}
                        className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <select
                        aria-label={`Category for ${item.label}`}
                        value={item.category}
                        onChange={(e) => {
                          const v = e.target.value as TileZoneCategory;
                          setDraftCatalog((prev) =>
                            prev.map((z, i) => (i === idx ? { ...z, category: v } : z))
                          );
                        }}
                        className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                      >
                        {ZONE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        type="number"
                        min="0"
                        aria-label={`Default Sq.Ft for ${item.label}`}
                        value={item.defaultSqft}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value) || 0);
                          setDraftCatalog((prev) =>
                            prev.map((z, i) => (i === idx ? { ...z, defaultSqft: v } : z))
                          );
                        }}
                        className="w-full px-2 py-1 text-xs text-right font-mono border border-slate-200 rounded"
                      />
                    </div>
                    <div className="sm:col-span-2 flex justify-end">
                      <button
                        type="button"
                        disabled={draftCatalog.length <= 1}
                        onClick={() =>
                          setDraftCatalog((prev) => prev.filter((_, i) => i !== idx))
                        }
                        aria-label={`Delete ${item.label}`}
                        className="p-1.5 text-slate-400 hover:text-red-700 disabled:opacity-30 rounded hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">
              <button
                type="button"
                onClick={() => setDraftCatalog(TILE_ZONES.map((z) => ({ ...z })))}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reset 13 Defaults</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCustomizeZones(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md bg-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={catalogSaving}
                  onClick={handleSaveCatalog}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {catalogSaving ? 'Saving...' : 'Save Area Template'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: New or Edit Project */}
      {(showNewProject || editingProject) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 id="project-modal-title" className="text-base font-semibold text-slate-900">
                {editingProject ? 'Edit Project, Dates & Contacts' : 'Add New Project'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowNewProject(false);
                  setEditingProject(null);
                }}
                aria-label="Close project modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={editingProject ? handleSaveEditProject : handleCreateProject}
              className="p-6 space-y-4"
            >
              <div>
                <label htmlFor="new-proj-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Project Name
                </label>
                <input
                  id="new-proj-name"
                  type="text"
                  required
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  placeholder="e.g. Prestige Lakeside Towers"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="new-proj-loc" className="block text-xs font-medium text-slate-700 mb-1">
                    Site Location
                  </label>
                  <ProjectLocationAutocomplete
                    id="new-proj-loc"
                    value={projLocation}
                    onChange={(next) => {
                      setProjLocation(next);
                      setProjPlaceId('');
                    }}
                    onPlaceSelected={(place) => {
                      setProjLocation(place.formattedAddress);
                      setProjPlaceId(place.placeId);
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="new-proj-client" className="block text-xs font-medium text-slate-700 mb-1">
                    Client / Builder Name
                  </label>
                  <input
                    id="new-proj-client"
                    type="text"
                    value={projClient}
                    onChange={(e) => setProjClient(e.target.value)}
                    placeholder="e.g. Prestige Constructions"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="proj-start" className="block text-xs font-medium text-slate-700 mb-1">
                    Work Start Date
                  </label>
                  <input
                    id="proj-start"
                    type="date"
                    value={projStartDate}
                    onChange={(e) => setProjStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="proj-finish" className="block text-xs font-medium text-slate-700 mb-1">
                    Finish / Target Date
                  </label>
                  <input
                    id="proj-finish"
                    type="date"
                    value={projFinishDate}
                    onChange={(e) => setProjFinishDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                {editingProject && (
                  <div>
                    <label htmlFor="proj-status" className="block text-xs font-medium text-slate-700 mb-1">
                      Status
                    </label>
                    <select
                      id="proj-status"
                      value={editProjStatus}
                      onChange={(e) =>
                        setEditProjStatus(e.target.value as 'active' | 'completed' | 'on_hold')
                      }
                      className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-md"
                    >
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                      <option value="on_hold">On Hold</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-3">
                <div className="text-xs font-semibold text-slate-800">
                  Project Manager &amp; Site Engineer Contacts (WhatsApp Status)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="proj-mgr-name" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Project Manager Name
                    </label>
                    <input
                      id="proj-mgr-name"
                      type="text"
                      value={projManagerName}
                      onChange={(e) => setProjManagerName(e.target.value)}
                      placeholder="Manager name"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="proj-mgr-phone" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Manager Phone (WhatsApp)
                    </label>
                    <input
                      id="proj-mgr-phone"
                      type="text"
                      value={projManagerPhone}
                      onChange={(e) => setProjManagerPhone(e.target.value)}
                      placeholder="9848099110"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="proj-eng-name" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Site Engineer Name
                    </label>
                    <input
                      id="proj-eng-name"
                      type="text"
                      value={projEngineerName}
                      onChange={(e) => setProjEngineerName(e.target.value)}
                      placeholder="Engineer name"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="proj-eng-phone" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Engineer Phone (WhatsApp)
                    </label>
                    <input
                      id="proj-eng-phone"
                      type="text"
                      value={projEngineerPhone}
                      onChange={(e) => setProjEngineerPhone(e.target.value)}
                      placeholder="9000112299"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewProject(false);
                    setEditingProject(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800"
                >
                  {editingProject ? 'Save Project Changes' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: New Tower OR Edit Tower & Leadership Contacts */}
      {(showNewTower || editingTower) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tower-modal-title"
        >
          <div className="w-full max-w-xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 id="tower-modal-title" className="text-base font-semibold text-slate-900">
                {editingTower ? `Edit ${editingTower.name} & Leadership Contacts` : 'Add Tower & Generate Units'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowNewTower(false);
                  setEditingTower(null);
                }}
                aria-label="Close tower modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={editingTower ? handleSaveEditTower : handleCreateTower}
              className="p-6 space-y-4"
            >
              {towerError && (
                <div className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
                  {towerError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <label htmlFor="new-twr-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Tower Name
                  </label>
                  <input
                    id="new-twr-name"
                    type="text"
                    required
                    value={towerName}
                    onChange={(e) => setTowerName(e.target.value)}
                    placeholder="e.g. Tower C"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label htmlFor="twr-start-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Work Start Date
                  </label>
                  <input
                    id="twr-start-date"
                    type="date"
                    value={twrStartDate}
                    onChange={(e) => setTwrStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="twr-finish-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Finish / Target Date
                  </label>
                  <input
                    id="twr-finish-date"
                    type="date"
                    value={twrFinishDate}
                    onChange={(e) => setTwrFinishDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              {/* Leadership Contacts Section (Incharge, Supervisor, Engineer, Manager) */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-3">
                <div className="text-xs font-semibold text-slate-800">
                  Tower Leadership &amp; Contact Numbers (Quick WhatsApp Status Share)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="twr-inc-name" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Tower Incharge Name
                    </label>
                    <input
                      id="twr-inc-name"
                      type="text"
                      value={twrInchargeName}
                      onChange={(e) => setTwrInchargeName(e.target.value)}
                      placeholder="e.g. Mahender Goud"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="twr-inc-phone" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Tower Incharge Phone
                    </label>
                    <input
                      id="twr-inc-phone"
                      type="text"
                      value={twrInchargePhone}
                      onChange={(e) => setTwrInchargePhone(e.target.value)}
                      placeholder="9848055110"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
                    />
                  </div>

                  <div>
                    <label htmlFor="twr-sup-name" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Tower Supervisor Name
                    </label>
                    <input
                      id="twr-sup-name"
                      type="text"
                      value={twrSupervisorName}
                      onChange={(e) => setTwrSupervisorName(e.target.value)}
                      placeholder="e.g. Prakash Reddy"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="twr-sup-phone" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Tower Supervisor Phone
                    </label>
                    <input
                      id="twr-sup-phone"
                      type="text"
                      value={twrSupervisorPhone}
                      onChange={(e) => setTwrSupervisorPhone(e.target.value)}
                      placeholder="9866554433"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
                    />
                  </div>

                  <div>
                    <label htmlFor="twr-eng-name" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Site Engineer Name
                    </label>
                    <input
                      id="twr-eng-name"
                      type="text"
                      value={twrEngineerName}
                      onChange={(e) => setTwrEngineerName(e.target.value)}
                      placeholder="e.g. Anil Sharma"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="twr-eng-phone" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Site Engineer Phone
                    </label>
                    <input
                      id="twr-eng-phone"
                      type="text"
                      value={twrEngineerPhone}
                      onChange={(e) => setTwrEngineerPhone(e.target.value)}
                      placeholder="9000112299"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
                    />
                  </div>

                  <div>
                    <label htmlFor="twr-mgr-name" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Project Manager Name
                    </label>
                    <input
                      id="twr-mgr-name"
                      type="text"
                      value={twrManagerName}
                      onChange={(e) => setTwrManagerName(e.target.value)}
                      placeholder="e.g. Karthik Rao"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div>
                    <label htmlFor="twr-mgr-phone" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Project Manager Phone
                    </label>
                    <input
                      id="twr-mgr-phone"
                      type="text"
                      value={twrManagerPhone}
                      onChange={(e) => setTwrManagerPhone(e.target.value)}
                      placeholder="9848099110"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
                    />
                  </div>
                </div>
              </div>

              {!editingTower && (
                <>
                  {/* Special Building Levels: Basements 3/2/1, Ground Floor, Podium */}
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-800">
                        Include Basements, Ground Floor &amp; Podium
                      </span>
                      <div className="flex items-center gap-1.5">
                        <label htmlFor="twr-special-units" className="text-[11px] text-slate-500">
                          Units / level:
                        </label>
                        <input
                          id="twr-special-units"
                          type="number"
                          min="1"
                          max="20"
                          value={specialUnitsPerLevel}
                          onChange={(e) => setSpecialUnitsPerLevel(e.target.value)}
                          className="w-14 px-2 py-1 text-xs font-mono bg-white border border-slate-300 rounded"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {SPECIAL_FLOOR_PRESETS.map((preset) => {
                        const checked = selectedSpecialLevels.includes(preset.id);
                        return (
                          <label
                            key={preset.id}
                            className={`flex items-center gap-2 px-2.5 py-2 text-xs rounded border cursor-pointer transition-colors ${
                              checked
                                ? 'bg-orange-50 border-orange-500 text-slate-900 font-medium'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSpecialLevel(preset.id)}
                              className="rounded border-slate-300 text-orange-700 focus:ring-orange-600"
                            />
                            <span>
                              {preset.label} ({preset.shortCode})
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="twr-start-fl" className="block text-xs font-medium text-slate-700 mb-1">
                        Start Floor
                      </label>
                      <input
                        id="twr-start-fl"
                        type="number"
                        min="0"
                        max="150"
                        value={startFloor}
                        onChange={(e) => setStartFloor(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label htmlFor="twr-end-fl" className="block text-xs font-medium text-slate-700 mb-1">
                        End Floor
                      </label>
                      <input
                        id="twr-end-fl"
                        type="number"
                        min="0"
                        max="150"
                        value={endFloor}
                        onChange={(e) => setEndFloor(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                      />
                    </div>
                  </div>

                  {/* Uniform vs Ordered Slot Layout vs Mixed BHK Plan per Floor */}
                  <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md text-xs">
                    <button
                      type="button"
                      onClick={() => setTwrPlanMode('uniform')}
                      className={`flex-1 py-1.5 px-2 font-semibold rounded whitespace-nowrap ${
                        twrPlanMode === 'uniform'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Uniform BHK / Floor
                    </button>
                    <button
                      type="button"
                      data-testid="tower-plan-ordered-slots-btn"
                      onClick={() => setTwrPlanMode('ordered_slots')}
                      className={`flex-1 py-1.5 px-2 font-semibold rounded whitespace-nowrap ${
                        twrPlanMode === 'ordered_slots'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Ordered Slot Layout (Per Flat #)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTwrPlanMode('mixed')}
                      className={`flex-1 py-1.5 px-2 font-semibold rounded whitespace-nowrap ${
                        twrPlanMode === 'mixed'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Mixed Counts (BHK Totals)
                    </button>
                  </div>

                  {twrPlanMode === 'uniform' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="twr-upf" className="block text-xs font-medium text-slate-700 mb-1">
                          Flats / Floor
                        </label>
                        <input
                          id="twr-upf"
                          type="number"
                          min="1"
                          max="20"
                          value={unitsPerFloor}
                          onChange={(e) => setUnitsPerFloor(e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label htmlFor="twr-type" className="block text-xs font-medium text-slate-700 mb-1">
                          Flat Configuration
                        </label>
                        <input
                          id="twr-type"
                          type="text"
                          value={unitTypeDefault}
                          onChange={(e) => setUnitTypeDefault(e.target.value)}
                          placeholder="e.g. 3 BHK"
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                        />
                      </div>
                    </div>
                  ) : twrPlanMode === 'ordered_slots' ? (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-3">
                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold text-slate-800">
                          Quick High-Rise Tower Templates (e.g. Floor 1 to 45):
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {FLOOR_LAYOUT_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => setTwrOrderedSlots([...preset.slotUnitTypes])}
                              className="px-2.5 py-1 text-[11px] font-medium bg-white border border-slate-300 rounded hover:border-orange-500 hover:bg-orange-50 text-slate-800"
                              title={preset.shortDesc}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-700">
                          Flat Position Mapping ({twrOrderedSlots.length} flats per floor):
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setTwrOrderedSlots((prev) =>
                              prev.length < 24 ? [...prev, '3 BHK'] : prev
                            )
                          }
                          className="px-2 py-1 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-300 rounded hover:bg-orange-100"
                        >
                          + Add Flat Slot
                        </button>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {twrOrderedSlots.map((slotType, idx) => {
                          const flPreviewNum = `${Math.max(1, Number(startFloor) || 1)}${String(idx + 1).padStart(2, '0')}`;
                          return (
                            <div
                              key={idx}
                              className="p-2 bg-white border border-slate-200 rounded space-y-1"
                            >
                              <div className="flex items-center justify-between text-[11px] font-mono text-slate-600">
                                <span>
                                  #{idx + 1} ({flPreviewNum})
                                </span>
                                {twrOrderedSlots.length > 1 && (
                                  <button
                                    type="button"
                                    aria-label={`Remove slot ${idx + 1}`}
                                    onClick={() =>
                                      setTwrOrderedSlots((prev) => prev.filter((_, i) => i !== idx))
                                    }
                                    className="text-slate-400 hover:text-red-700"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                              <select
                                aria-label={`Flat slot ${idx + 1} BHK type`}
                                value={slotType}
                                onChange={(e) =>
                                  setTwrOrderedSlots((prev) =>
                                    prev.map((v, i) => (i === idx ? e.target.value : v))
                                  )
                                }
                                className="w-full px-1.5 py-1 text-xs bg-white border border-slate-300 rounded"
                              >
                                {RESIDENTIAL_BHK_TYPES.map((bhk) => (
                                  <option key={bhk} value={bhk}>
                                    {bhk}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>

                      <div className="text-[11px] font-mono text-slate-600 space-y-0.5">
                        <div>
                          Start floor ({Number(startFloor) || 1}):{' '}
                          {buildOrderedSlotFloorUnits({
                            floorNumber: Number(startFloor) || 1,
                            slotUnitTypes: twrOrderedSlots,
                          })
                            .map((u) => `${u.unitNumber}(${u.unitType})`)
                            .join(', ')}
                        </div>
                        {(Number(endFloor) || 1) > (Number(startFloor) || 1) && (
                          <div>
                            Top floor ({Number(endFloor)}):{' '}
                            {buildOrderedSlotFloorUnits({
                              floorNumber: Number(endFloor) || 1,
                              slotUnitTypes: twrOrderedSlots,
                            })
                              .map((u) => `${u.unitNumber}(${u.unitType})`)
                              .join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
                      <div className="text-xs font-medium text-slate-700">
                        Flats Per Floor by BHK Design:
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                        {['3 BHK', '2 BHK', '4 BHK', '5 BHK', '1 BHK', 'Penthouse'].map((bhk) => (
                          <div key={bhk}>
                            <label
                              htmlFor={`twr-mix-${bhk}`}
                              className="block text-[11px] font-medium text-slate-600 mb-1"
                            >
                              {bhk}
                            </label>
                            <input
                              id={`twr-mix-${bhk}`}
                              type="number"
                              min="0"
                              max="30"
                              value={twrMixedCounts[bhk] ?? '0'}
                              onChange={(e) =>
                                setTwrMixedCounts((prev) => ({ ...prev, [bhk]: e.target.value }))
                              }
                              className="w-full px-2 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
                            />
                          </div>
                        ))}
                      </div>
                      <div className="text-[11px] font-mono text-slate-600">
                        Per-floor preview:{' '}
                        {buildMixedBhkFloorUnits({
                          floorNumber: Number(startFloor) || 1,
                          mixedSpecs: getMixedSpecs(twrMixedCounts),
                        })
                          .map((u) => `${u.unitNumber}(${u.unitType})`)
                          .join(', ') || 'Enter at least 1 unit'}
                      </div>
                    </div>
                  )}

                  {/* Auto-Seed Whole-Floor Common Areas per Floor */}
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={twrIncludeCommon}
                        onChange={(e) => setTwrIncludeCommon(e.target.checked)}
                        className="rounded border-slate-300 text-orange-700"
                      />
                      <span>
                        Auto-create Whole-Floor Common Areas per floor (Electrical Room 1–2, Lift Lobby, Corridor)
                      </span>
                    </label>
                    {twrIncludeCommon && (
                      <div className="flex flex-wrap items-center gap-3 pl-5 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-600">Electrical Rooms:</span>
                          {[0, 1, 2].map((cnt) => (
                            <button
                              key={cnt}
                              type="button"
                              onClick={() => setTwrCommonElecCount(cnt)}
                              className={`px-2 py-0.5 rounded border font-mono ${
                                twrCommonElecCount === cnt
                                  ? 'bg-orange-700 text-white border-orange-700'
                                  : 'bg-white text-slate-700 border-slate-300'
                              }`}
                            >
                              {cnt}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-600">Lift Lobby:</span>
                          {[0, 1, 2].map((cnt) => (
                            <button
                              key={cnt}
                              type="button"
                              onClick={() => setTwrCommonLiftCount(cnt)}
                              className={`px-2 py-0.5 rounded border font-mono ${
                                twrCommonLiftCount === cnt
                                  ? 'bg-orange-700 text-white border-orange-700'
                                  : 'bg-white text-slate-700 border-slate-300'
                              }`}
                            >
                              {cnt}
                            </button>
                          ))}
                        </div>
                        <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={twrCommonCorridor}
                            onChange={(e) => setTwrCommonCorridor(e.target.checked)}
                            className="rounded border-slate-300 text-orange-700"
                          />
                          <span>Corridor</span>
                        </label>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewTower(false);
                    setEditingTower(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={towerSubmitting}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {towerSubmitting
                    ? 'Saving...'
                    : editingTower
                      ? 'Save Tower Changes'
                      : 'Create Tower'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Custom Floor / Basement / Ground / Podium / Flats */}
      {showAddFloor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-floor-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 id="add-floor-title" className="text-base font-semibold text-slate-900">
                Add Floor, Basement, Ground, Podium &amp; Units
              </h2>
              <button
                type="button"
                onClick={() => setShowAddFloor(false)}
                aria-label="Close add floor modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateFloorUnits} className="p-6 space-y-4">
              {floorError && (
                <div className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
                  {floorError}
                </div>
              )}

              <div>
                <span className="block text-xs font-medium text-slate-700 mb-1.5">
                  Select Building Level
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSelectFloorPreset('typical')}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded border ${
                      floorPreset === 'typical'
                        ? 'bg-orange-700 text-white border-orange-700'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Typical Floor (1–150)
                  </button>
                  {SPECIAL_FLOOR_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectFloorPreset(preset.id)}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded border ${
                        floorPreset === preset.id
                          ? 'bg-orange-700 text-white border-orange-700'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {preset.label} ({preset.shortCode})
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
                <button
                  type="button"
                  onClick={() => setFloorMode('auto')}
                  className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
                    floorMode === 'auto'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Uniform Units
                </button>
                <button
                  type="button"
                  data-testid="floor-plan-ordered-slots-btn"
                  onClick={() => setFloorMode('ordered_slots')}
                  className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
                    floorMode === 'ordered_slots'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Ordered Slots
                </button>
                <button
                  type="button"
                  onClick={() => setFloorMode('mixed')}
                  className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
                    floorMode === 'mixed'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Mixed Counts
                </button>
                <button
                  type="button"
                  onClick={() => setFloorMode('custom')}
                  className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
                    floorMode === 'custom'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Custom Numbers
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="fl-num" className="block text-xs font-medium text-slate-700 mb-1">
                    {floorMode !== 'custom'
                      ? 'Start Floor (-3=B3, 0=GF, 0.5=Podium)'
                      : 'Floor / Level Index (-3=B3, 0=GF, 0.5=Podium)'}
                  </label>
                  <input
                    id="fl-num"
                    type="number"
                    step="0.5"
                    min="-10"
                    max="150"
                    required
                    value={customFloorNum}
                    onChange={(e) => setCustomFloorNum(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
                {floorMode === 'auto' ? (
                  <div>
                    <label htmlFor="fl-units" className="block text-xs font-medium text-slate-700 mb-1">
                      Number of Units
                    </label>
                    <input
                      id="fl-units"
                      type="number"
                      min="1"
                      max="50"
                      required
                      value={customUnitsCount}
                      onChange={(e) => setCustomUnitsCount(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                    />
                  </div>
                ) : floorMode === 'mixed' || floorMode === 'ordered_slots' ? (
                  <div>
                    <label htmlFor="fl-end-num" className="block text-xs font-medium text-slate-700 mb-1">
                      To Floor (Optional Range, e.g. 45)
                    </label>
                    <input
                      id="fl-end-num"
                      type="number"
                      min="1"
                      max="150"
                      value={customEndFloorNum}
                      onChange={(e) => setCustomEndFloorNum(e.target.value)}
                      placeholder="Single floor if blank"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                    />
                  </div>
                ) : (
                  <div>
                    <label htmlFor="fl-type-inline" className="block text-xs font-medium text-slate-700 mb-1">
                      Unit Configuration
                    </label>
                    <input
                      id="fl-type-inline"
                      type="text"
                      value={customUnitType}
                      onChange={(e) => setCustomUnitType(e.target.value)}
                      placeholder="e.g. Lobby / Parking / 3 BHK"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                    />
                  </div>
                )}
              </div>

              {floorMode !== 'mixed' && floorMode !== 'ordered_slots' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="fl-label" className="block text-xs font-medium text-slate-700 mb-1">
                      Level Display Name (Optional)
                    </label>
                    <input
                      id="fl-label"
                      type="text"
                      value={customFloorLabelInput}
                      onChange={(e) => setCustomFloorLabelInput(e.target.value)}
                      placeholder={formatFloorLabel(Number(customFloorNum) || 0)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                    />
                  </div>
                  {floorMode === 'auto' && (
                    <div>
                      <label htmlFor="fl-type" className="block text-xs font-medium text-slate-700 mb-1">
                        Unit Configuration
                      </label>
                      <input
                        id="fl-type"
                        type="text"
                        value={customUnitType}
                        onChange={(e) => setCustomUnitType(e.target.value)}
                        placeholder="e.g. 3 BHK / Podium Lobby"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                      />
                    </div>
                  )}
                </div>
              )}

              {floorMode === 'ordered_slots' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-800">
                      Quick Floor Plan Templates:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {FLOOR_LAYOUT_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setFlOrderedSlots([...preset.slotUnitTypes])}
                          className="px-2 py-1 text-[11px] font-medium bg-white border border-slate-300 rounded hover:border-orange-500 hover:bg-orange-50 text-slate-800"
                          title={preset.shortDesc}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700">
                      Per-Slot BHK Sequence ({flOrderedSlots.length} flats):
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setFlOrderedSlots((prev) =>
                          prev.length < 24 ? [...prev, '3 BHK'] : prev
                        )
                      }
                      className="px-2 py-1 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-300 rounded hover:bg-orange-100"
                    >
                      + Add Slot
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {flOrderedSlots.map((slotType, idx) => (
                      <div key={idx} className="p-2 bg-white border border-slate-200 rounded space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-600">
                          <span>Slot #{idx + 1}</span>
                          {flOrderedSlots.length > 1 && (
                            <button
                              type="button"
                              aria-label={`Remove floor slot ${idx + 1}`}
                              onClick={() =>
                                setFlOrderedSlots((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="text-slate-400 hover:text-red-700"
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <select
                          aria-label={`Floor slot ${idx + 1} BHK type`}
                          value={slotType}
                          onChange={(e) =>
                            setFlOrderedSlots((prev) =>
                              prev.map((v, i) => (i === idx ? e.target.value : v))
                            )
                          }
                          className="w-full px-1.5 py-1 text-xs bg-white border border-slate-300 rounded"
                        >
                          {RESIDENTIAL_BHK_TYPES.map((bhk) => (
                            <option key={bhk} value={bhk}>
                              {bhk}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {floorMode === 'mixed' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2">
                  <div className="text-xs font-medium text-slate-700">
                    Site Mixed BHK Design (set counts for this floor, e.g. 4×2 BHK + 4×3 BHK or 5 BHK):
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {['3 BHK', '2 BHK', '4 BHK', '5 BHK', '1 BHK', 'Penthouse'].map((bhk) => (
                      <div key={bhk}>
                        <label
                          htmlFor={`fl-mix-${bhk}`}
                          className="block text-[11px] font-medium text-slate-600 mb-1"
                        >
                          {bhk}
                        </label>
                        <input
                          id={`fl-mix-${bhk}`}
                          type="number"
                          min="0"
                          max="30"
                          value={flMixedCounts[bhk] ?? '0'}
                          onChange={(e) =>
                            setFlMixedCounts((prev) => ({ ...prev, [bhk]: e.target.value }))
                          }
                          className="w-full px-2 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {floorMode === 'custom' && (
                <div>
                  <label htmlFor="fl-custom-list" className="block text-xs font-medium text-slate-700 mb-1">
                    Unit Numbers (comma or space separated)
                  </label>
                  <input
                    id="fl-custom-list"
                    type="text"
                    required
                    value={customUnitListText}
                    onChange={(e) => setCustomUnitListText(e.target.value)}
                    placeholder="e.g. B1-Lobby, GF-Reception, 5001, 5002"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
              )}

              {/* Auto-include Whole Floor Common Area Unit on this Floor */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flIncludeCommon}
                    onChange={(e) => setFlIncludeCommon(e.target.checked)}
                    className="rounded border-slate-300 text-orange-700"
                  />
                  <span>
                    Include Floor Common Area Unit (Electrical Room 1–2, Lift Lobby, Corridor)
                  </span>
                </label>
                {flIncludeCommon && (
                  <div className="flex flex-wrap items-center gap-3 pl-5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-600">Electrical Rooms:</span>
                      {[0, 1, 2].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => setFlCommonElecCount(cnt)}
                          className={`px-2 py-0.5 rounded border font-mono ${
                            flCommonElecCount === cnt
                              ? 'bg-orange-700 text-white border-orange-700'
                              : 'bg-white text-slate-700 border-slate-300'
                          }`}
                        >
                          {cnt}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-600">Lift Lobby:</span>
                      {[0, 1, 2].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => setFlCommonLiftCount(cnt)}
                          className={`px-2 py-0.5 rounded border font-mono ${
                            flCommonLiftCount === cnt
                              ? 'bg-orange-700 text-white border-orange-700'
                              : 'bg-white text-slate-700 border-slate-300'
                          }`}
                        >
                          {cnt}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={flCommonCorridor}
                        onChange={(e) => setFlCommonCorridor(e.target.checked)}
                        className="rounded border-slate-300 text-orange-700"
                      />
                      <span>Corridor</span>
                    </label>
                  </div>
                )}
              </div>

              {previewFloorUnits.length > 0 && (
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600">
                  Will add {previewFloorUnits.length} unit{previewFloorUnits.length > 1 ? 's' : ''} under{' '}
                  <strong className="text-slate-800">
                    {customFloorLabelInput.trim() ||
                      formatFloorLabel(Number.isFinite(parsedCustomFloor) ? parsedCustomFloor : 0)}
                  </strong>
                  :{' '}
                  <span className="font-mono text-slate-900">
                    {previewFloorUnits.slice(0, 8).join(', ')}
                    {previewFloorUnits.length > 8 ? ` +${previewFloorUnits.length - 8} more` : ''}
                  </span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddFloor(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={floorSubmitting}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {floorSubmitting ? 'Adding...' : 'Generate Units'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirm Remove Tower */}
      {confirmRemoveTower && selectedTower && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-tower-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-xl p-6 space-y-4">
            <h2 id="remove-tower-title" className="text-base font-semibold text-slate-900">
              Remove {selectedTower.name}?
            </h2>
            <p className="text-sm text-slate-600">
              This will permanently remove <strong>{selectedTower.name}</strong> and its{' '}
              <span className="font-mono font-semibold">{towerFlats.length}</span> flat units from the active matrix. Historical work assignment logs remain preserved.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmRemoveTower(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={removingBusy}
                onClick={handleConfirmRemoveTower}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-700 rounded-md hover:bg-red-800 disabled:opacity-50"
              >
                {removingBusy ? 'Removing...' : 'Confirm Remove Tower'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Remove Flat */}
      {confirmRemoveFlatId && selectedFlat && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-flat-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-xl p-6 space-y-4">
            <h2 id="remove-flat-title" className="text-base font-semibold text-slate-900">
              Remove Unit {selectedFlat.unitNumber}?
            </h2>
            <p className="text-sm text-slate-600">
              This will delete Unit <strong className="font-mono">{selectedFlat.unitNumber}</strong> from the tower matrix. Past work assignment history entries will remain preserved.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmRemoveFlatId(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={removingBusy}
                onClick={handleConfirmRemoveFlat}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-700 rounded-md hover:bg-red-800 disabled:opacity-50"
              >
                {removingBusy ? 'Removing...' : 'Confirm Remove Unit'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal: Deploy Manpower to Specific Tower */}
      {showDeployToTower && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deploy-tower-modal-title"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-orange-700" aria-hidden="true" />
                <h2 id="deploy-tower-modal-title" className="text-base font-semibold text-slate-900">
                  Deploy Manpower to Specific Tower
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowDeployToTower(false)}
                aria-label="Close deploy manpower modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!deployProjId || !deployTwrId || deploySelectedEmpIds.length === 0) return;
                setDeploySubmitting(true);
                try {
                  await bulkAllocateEmployeesToTower({
                    employeeIds: deploySelectedEmpIds,
                    projectId: deployProjId,
                    towerId: deployTwrId,
                    assignedDate: deployDate,
                    notes: deployNotes || 'Deployed from Tower matrix',
                  });
                  setShowDeployToTower(false);
                } finally {
                  setDeploySubmitting(false);
                }
              }}
              className="p-6 space-y-4 overflow-y-auto"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="dt-proj" className="block text-xs font-medium text-slate-700 mb-1">
                    Target Project
                  </label>
                  <select
                    id="dt-proj"
                    required
                    value={deployProjId}
                    onChange={(e) => {
                      const nextP = e.target.value;
                      setDeployProjId(nextP);
                      const firstT = towers.find((t) => t.projectId === nextP);
                      setDeployTwrId(firstT?.id || '');
                    }}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="dt-twr" className="block text-xs font-medium text-slate-700 mb-1">
                    Specific Tower / Block
                  </label>
                  <select
                    id="dt-twr"
                    required
                    value={deployTwrId}
                    onChange={(e) => setDeployTwrId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                  >
                    {towers
                      .filter((t) => t.projectId === deployProjId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="dt-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Deployment Date
                  </label>
                  <input
                    id="dt-date"
                    type="date"
                    required
                    value={deployDate}
                    onChange={(e) => setDeployDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              {/* Currently Deployed Crew Snapshot */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">
                    Currently Assigned to {towers.find((t) => t.id === deployTwrId)?.name || 'Tower'} (
                    <span className="font-mono">{deployTargetCrew.length}</span>)
                  </span>
                  <span className="text-[11px] text-slate-500">Live site roster</span>
                </div>
                {deployTargetCrew.length === 0 ? (
                  <p className="text-xs text-slate-500">No workers currently assigned to this tower.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {deployTargetCrew.map((w) => (
                      <span
                        key={w.id}
                        className="px-2 py-0.5 bg-white border border-slate-200 rounded text-slate-700 font-medium"
                      >
                        <span className="font-mono text-slate-500">{w.empCode}</span> · {w.fullName} ({w.role})
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="dt-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Site Deployment Instructions
                </label>
                <input
                  id="dt-notes"
                  type="text"
                  value={deployNotes}
                  onChange={(e) => setDeployNotes(e.target.value)}
                  placeholder="e.g. Shifted to Tower B 10th floor flooring & dado work"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <input
                    type="text"
                    aria-label="Search workers to deploy to tower"
                    value={deploySearch}
                    onChange={(e) => setDeploySearch(e.target.value)}
                    placeholder="Search worker by name, ID, role, or current site..."
                    className="w-full sm:w-64 px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deployHideCurrentTower}
                        onChange={(e) => setDeployHideCurrentTower(e.target.checked)}
                        className="rounded border-slate-300 text-orange-700"
                      />
                      <span>Other towers / bench only</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setDeploySelectedEmpIds(deployCandidateEmployees.map((e) => e.id))}
                      className="text-orange-700 font-medium hover:underline"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeploySelectedEmpIds([])}
                      className="text-slate-600 hover:underline"
                    >
                      Clear ({deploySelectedEmpIds.length})
                    </button>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {deployCandidateEmployees.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      No matching workers available. Uncheck &ldquo;Other towers / bench only&rdquo; or adjust search.
                    </div>
                  ) : (
                    deployCandidateEmployees.map((emp) => {
                      const checked = deploySelectedEmpIds.includes(emp.id);
                      return (
                        <label
                          key={emp.id}
                          className={`px-3 py-2 flex items-center justify-between gap-3 text-xs cursor-pointer ${
                            checked ? 'bg-orange-50/60' : 'hover:bg-slate-50'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setDeploySelectedEmpIds((prev) =>
                                  e.target.checked
                                    ? [...prev, emp.id]
                                    : prev.filter((id) => id !== emp.id)
                                );
                              }}
                              className="rounded border-slate-300 text-orange-700"
                            />
                            <span className="font-mono text-slate-600">{emp.empCode}</span>
                            <span className="font-medium text-slate-900 truncate">{emp.fullName}</span>
                            <span className="text-slate-500">({emp.role})</span>
                          </span>
                          <span className="text-[11px] text-slate-500 shrink-0">
                            {emp.currentProjectName
                              ? `${emp.currentProjectName}${emp.currentTowerName ? ` · ${emp.currentTowerName}` : ''}`
                              : 'Unassigned'}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowDeployToTower(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deploySubmitting || !deployTwrId || deploySelectedEmpIds.length === 0}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {deploySubmitting
                    ? 'Deploying...'
                    : `Deploy ${deploySelectedEmpIds.length} Worker${
                        deploySelectedEmpIds.length === 1 ? '' : 's'
                      } to ${towers.find((t) => t.id === deployTwrId)?.name || 'Tower'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Whole-Floor Common Areas & Custom Floor Zones (1/2 Electrical Rooms, Lift Lobby, Corridor, Custom Areas) */}
      {showWholeFloorZoneModal && selectedTower && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wf-zone-modal-title"
        >
          <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 id="wf-zone-modal-title" className="text-base font-semibold text-slate-900">
                  Whole-Floor Common Areas &amp; Custom Tile Zones
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedProject?.name} · {selectedTower.name} · Configure 1 or 2 Electrical Rooms, Lift Lobbies, Corridors &amp; Custom Areas
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWholeFloorZoneModal(false)}
                aria-label="Close whole floor custom area modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddZoneToWholeFloor} className="p-6 space-y-4 overflow-y-auto">
              {wfError && (
                <div className="p-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md">
                  {wfError}
                </div>
              )}

              {/* Placement Mode Switch */}
              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-slate-700">
                  How should these whole-floor areas be tracked?
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setWfTargetMode('common_unit')}
                    className={`p-2.5 text-left rounded-md border transition-colors ${
                      wfTargetMode === 'common_unit'
                        ? 'bg-orange-50 border-orange-600 ring-1 ring-orange-600'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900">
                      Dedicated Floor Common Card (Recommended)
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Creates FL1-Common / FL2-Common for 1–2 Electrical Rooms, Lift Lobby &amp; Corridor once per floor.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWfTargetMode('each_flat')}
                    className={`p-2.5 text-left rounded-md border transition-colors ${
                      wfTargetMode === 'each_flat'
                        ? 'bg-orange-50 border-orange-600 ring-1 ring-orange-600'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900">
                      Attach Inside Every Flat on Floor
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Adds custom tile areas (e.g. Pooja Room, Shaft) inside each flat on the chosen floor.
                    </div>
                  </button>
                </div>
              </div>

              {/* Target Floor(s) Selector */}
              {wfTargetMode === 'common_unit' ? (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">
                      Target Floors ({wfSelectedFloors.length} selected)
                    </span>
                    <div className="flex items-center gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setWfSelectedFloors(floorsAvailable.map(([n]) => n))}
                        className="font-semibold text-orange-700 hover:text-orange-900"
                      >
                        Select All ({floorsAvailable.length})
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setWfSelectedFloors(
                            floorsAvailable[0] ? [floorsAvailable[0][0]] : []
                          )
                        }
                        className="font-medium text-slate-600 hover:text-slate-900"
                      >
                        Reset to Single Floor
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {floorsAvailable.map(([flNum, flLbl]) => {
                      const active = wfSelectedFloors.includes(flNum);
                      const hasCommon = towerFlats.some(
                        (f) => f.floorNumber === flNum && isFloorCommonUnit(f)
                      );
                      return (
                        <button
                          key={flNum}
                          type="button"
                          onClick={() =>
                            setWfSelectedFloors((prev) =>
                              prev.includes(flNum)
                                ? prev.filter((n) => n !== flNum)
                                : [...prev, flNum].sort((a, b) => a - b)
                            )
                          }
                          className={`px-2.5 py-1 text-xs font-medium rounded border flex items-center gap-1 ${
                            active
                              ? 'bg-orange-700 text-white border-orange-700'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          <span>{flLbl}</span>
                          {hasCommon && (
                            <span
                              className={`text-[9px] px-1 rounded ${
                                active
                                  ? 'bg-orange-900/40 text-orange-100'
                                  : 'bg-indigo-50 text-indigo-700'
                              }`}
                            >
                              Common
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="wf-floor-select" className="block text-xs font-medium text-slate-700 mb-1">
                    Target Floor / Level *
                  </label>
                  <select
                    id="wf-floor-select"
                    value={wfFloorNum}
                    onChange={(e) => setWfFloorNum(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
                  >
                    {floorsAvailable.map(([flNum, flLbl]) => {
                      const count = towerFlats.filter((f) => f.floorNumber === flNum).length;
                      return (
                        <option key={flNum} value={String(flNum)}>
                          {flLbl} ({count} unit{count === 1 ? '' : 's'})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Common Floor Areas Matrix Builder vs Per-Flat Presets */}
              {wfTargetMode === 'common_unit' ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">
                      Whole-Floor Rooms &amp; Counts (Choose 0, 1, 2 or 3 Rooms per Floor)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setWfRoomSpecs((prev) =>
                          prev.map((r) =>
                            r.id === 'electrical_room'
                              ? { ...r, count: 2, includeFlooring: true, includeSkirting: true }
                              : r.id === 'lift_lobby' || r.id === 'corridor'
                                ? { ...r, count: 1, includeFlooring: true, includeSkirting: true }
                                : r
                          )
                        )
                      }
                      className="text-[11px] font-semibold text-orange-700 hover:text-orange-900"
                    >
                      Quick Preset: 2 Electrical Rooms + Lift Lobby + Corridor
                    </button>
                  </div>

                  <div className="space-y-2">
                    {wfRoomSpecs.map((room) => (
                      <div
                        key={room.id}
                        className={`p-3 rounded-md border transition-colors ${
                          room.count > 0
                            ? 'bg-orange-50/40 border-orange-300'
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-900">
                              {room.baseName}
                            </span>
                            {room.count > 1 && (
                              <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200 rounded">
                                {room.baseName} 1..{room.count}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-[11px] text-slate-500 mr-1">Rooms:</span>
                            {[0, 1, 2, 3].map((cnt) => (
                              <button
                                key={cnt}
                                type="button"
                                aria-label={`${room.baseName} count ${cnt}`}
                                onClick={() =>
                                  setWfRoomSpecs((prev) =>
                                    prev.map((r) =>
                                      r.id === room.id ? { ...r, count: cnt } : r
                                    )
                                  )
                                }
                                className={`w-7 h-6 text-xs font-mono font-semibold rounded border ${
                                  room.count === cnt
                                    ? 'bg-orange-700 text-white border-orange-700'
                                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                                }`}
                              >
                                {cnt}
                              </button>
                            ))}
                          </div>
                        </div>

                        {room.count > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-slate-200/70 flex flex-wrap items-center gap-4 text-xs">
                            <label className="flex items-center gap-1.5 text-slate-800 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={room.includeFlooring}
                                onChange={(e) =>
                                  setWfRoomSpecs((prev) =>
                                    prev.map((r) =>
                                      r.id === room.id
                                        ? { ...r, includeFlooring: e.target.checked }
                                        : r
                                    )
                                  )
                                }
                                className="rounded border-slate-300 text-orange-700"
                              />
                              <span>Flooring</span>
                              <input
                                type="number"
                                min="0"
                                aria-label={`${room.baseName} Flooring Sq.Ft`}
                                value={room.flooringSqft}
                                onChange={(e) =>
                                  setWfRoomSpecs((prev) =>
                                    prev.map((r) =>
                                      r.id === room.id
                                        ? { ...r, flooringSqft: Number(e.target.value) || 0 }
                                        : r
                                    )
                                  )
                                }
                                className="w-16 px-1.5 py-0.5 text-[11px] font-mono bg-white border border-slate-300 rounded text-right"
                              />
                              <span className="text-[10px] text-slate-500">sf</span>
                            </label>

                            <label className="flex items-center gap-1.5 text-slate-800 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={room.includeSkirting}
                                onChange={(e) =>
                                  setWfRoomSpecs((prev) =>
                                    prev.map((r) =>
                                      r.id === room.id
                                        ? { ...r, includeSkirting: e.target.checked }
                                        : r
                                    )
                                  )
                                }
                                className="rounded border-slate-300 text-orange-700"
                              />
                              <span>Skirting</span>
                              <input
                                type="number"
                                min="0"
                                aria-label={`${room.baseName} Skirting Sq.Ft`}
                                value={room.skirtingSqft}
                                onChange={(e) =>
                                  setWfRoomSpecs((prev) =>
                                    prev.map((r) =>
                                      r.id === room.id
                                        ? { ...r, skirtingSqft: Number(e.target.value) || 0 }
                                        : r
                                    )
                                  )
                                }
                                className="w-16 px-1.5 py-0.5 text-[11px] font-mono bg-white border border-slate-300 rounded text-right"
                              />
                              <span className="text-[10px] text-slate-500">sf</span>
                            </label>

                            {room.id === 'lift_lobby' && (
                              <label className="flex items-center gap-1.5 text-slate-800 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={Boolean(room.includeDado)}
                                  onChange={(e) =>
                                    setWfRoomSpecs((prev) =>
                                      prev.map((r) =>
                                        r.id === room.id
                                          ? { ...r, includeDado: e.target.checked }
                                          : r
                                      )
                                    )
                                  }
                                  className="rounded border-slate-300 text-orange-700"
                                />
                                <span>Lift Wall Dado</span>
                                <input
                                  type="number"
                                  min="0"
                                  aria-label="Lift Lobby Dado Sq.Ft"
                                  value={room.dadoSqft ?? 95}
                                  onChange={(e) =>
                                    setWfRoomSpecs((prev) =>
                                      prev.map((r) =>
                                        r.id === room.id
                                          ? { ...r, dadoSqft: Number(e.target.value) || 0 }
                                          : r
                                      )
                                    )
                                  }
                                  className="w-16 px-1.5 py-0.5 text-[11px] font-mono bg-white border border-slate-300 rounded text-right"
                                />
                                <span className="text-[10px] text-slate-500">sf</span>
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Additional Repeat Custom Common Rooms */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800">
                        Extra Custom Whole-Floor Rooms (Optional)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setWfCustomRooms((prev) => [
                            ...prev,
                            {
                              id: `cr_${Date.now()}_${prev.length}`,
                              baseName: '',
                              count: 1,
                              includeFlooring: true,
                              includeSkirting: true,
                              category: 'Common',
                              flooringSqft: '90',
                              skirtingSqft: '32',
                            },
                          ])
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100"
                      >
                        <Plus className="w-3 h-3" aria-hidden="true" />
                        <span>Add Custom Room (with Flooring &amp; Skirting)</span>
                      </button>
                    </div>

                    {wfCustomRooms.map((cr) => (
                      <div
                        key={cr.id}
                        className="p-2.5 bg-slate-50 border border-slate-200 rounded-md grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                      >
                        <div className="sm:col-span-4">
                          <input
                            type="text"
                            placeholder="e.g. Garbage Room / Refuge / BMS"
                            value={cr.baseName}
                            onChange={(e) =>
                              setWfCustomRooms((prev) =>
                                prev.map((x) =>
                                  x.id === cr.id ? { ...x, baseName: e.target.value } : x
                                )
                              )
                            }
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                          />
                        </div>
                        <div className="sm:col-span-2 flex items-center gap-1 text-xs">
                          <span className="text-[11px] text-slate-500">Qty:</span>
                          <select
                            value={cr.count}
                            onChange={(e) =>
                              setWfCustomRooms((prev) =>
                                prev.map((x) =>
                                  x.id === cr.id
                                    ? { ...x, count: Number(e.target.value) || 1 }
                                    : x
                                )
                              )
                            }
                            className="w-full px-1.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
                          >
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                            <option value={3}>3</option>
                          </select>
                        </div>
                        <div className="sm:col-span-5 flex flex-wrap items-center gap-2 text-xs">
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={cr.includeFlooring}
                              onChange={(e) =>
                                setWfCustomRooms((prev) =>
                                  prev.map((x) =>
                                    x.id === cr.id
                                      ? { ...x, includeFlooring: e.target.checked }
                                      : x
                                  )
                                )
                              }
                            />
                            <span>Flr</span>
                            <input
                              type="number"
                              min="0"
                              value={cr.flooringSqft}
                              onChange={(e) =>
                                setWfCustomRooms((prev) =>
                                  prev.map((x) =>
                                    x.id === cr.id ? { ...x, flooringSqft: e.target.value } : x
                                  )
                                )
                              }
                              className="w-12 px-1 py-0.5 text-[11px] font-mono bg-white border border-slate-300 rounded text-right"
                            />
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={cr.includeSkirting}
                              onChange={(e) =>
                                setWfCustomRooms((prev) =>
                                  prev.map((x) =>
                                    x.id === cr.id
                                      ? { ...x, includeSkirting: e.target.checked }
                                      : x
                                  )
                                )
                              }
                            />
                            <span>Skt</span>
                            <input
                              type="number"
                              min="0"
                              value={cr.skirtingSqft}
                              onChange={(e) =>
                                setWfCustomRooms((prev) =>
                                  prev.map((x) =>
                                    x.id === cr.id ? { ...x, skirtingSqft: e.target.value } : x
                                  )
                                )
                              }
                              className="w-12 px-1 py-0.5 text-[11px] font-mono bg-white border border-slate-300 rounded text-right"
                            />
                          </label>
                        </div>
                        <div className="sm:col-span-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              setWfCustomRooms((prev) => prev.filter((x) => x.id !== cr.id))
                            }
                            aria-label="Remove custom room row"
                            className="p-1 text-slate-500 hover:text-red-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      Quick Site Floor Areas (Select 1 or Multiple)
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const pickCommon = [
                          'Electrical Room Flooring',
                          'Electrical Room Skirting',
                          'Corridor Flooring',
                          'Corridor Skirting',
                        ];
                        setWfPresetSelection((prev) => {
                          const next = { ...prev };
                          for (const lbl of pickCommon) {
                            if (next[lbl]) next[lbl] = { ...next[lbl], selected: true };
                          }
                          return next;
                        });
                      }}
                      className="text-[11px] font-semibold text-orange-700 hover:text-orange-900"
                    >
                      + Select Electrical &amp; Corridor Pack
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                    {WHOLE_FLOOR_CUSTOM_PRESETS.map((preset) => {
                      const entry = wfPresetSelection[preset.label] || {
                        selected: false,
                        sqft: String(preset.defaultSqft),
                      };
                      return (
                        <div
                          key={preset.label}
                          className={`p-2 rounded border flex items-center justify-between gap-2 ${
                            entry.selected
                              ? 'bg-orange-50 border-orange-400'
                              : 'bg-white border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer min-w-0">
                            <input
                              type="checkbox"
                              checked={entry.selected}
                              onChange={(e) =>
                                setWfPresetSelection((prev) => ({
                                  ...prev,
                                  [preset.label]: {
                                    sqft: entry.sqft,
                                    selected: e.target.checked,
                                  },
                                }))
                              }
                              className="rounded border-slate-300 text-orange-700 shrink-0"
                            />
                            <span className="leading-tight">{preset.label}</span>
                          </label>
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="number"
                              min="0"
                              aria-label={`${preset.label} Sq.Ft`}
                              value={entry.sqft}
                              onChange={(e) =>
                                setWfPresetSelection((prev) => ({
                                  ...prev,
                                  [preset.label]: {
                                    selected: true,
                                    sqft: e.target.value,
                                  },
                                }))
                              }
                              className="w-14 px-1.5 py-0.5 text-[11px] font-mono bg-white border border-slate-300 rounded text-right"
                            />
                            <span className="text-[10px] text-slate-500">sf</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Optional Single Custom Area + Category + Status */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div>
                  <label htmlFor="wf-zone-label" className="block text-xs font-medium text-slate-700 mb-1">
                    Additional Single Area Name (Optional)
                  </label>
                  <input
                    id="wf-zone-label"
                    type="text"
                    value={wfZoneLabel}
                    onChange={(e) => setWfZoneLabel(e.target.value)}
                    placeholder="e.g. Service Shaft Wall / Refuge Terrace / Lift Jamb Granite"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-orange-600"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="wf-zone-cat" className="block text-xs font-medium text-slate-700 mb-1">
                      Area Category
                    </label>
                    <select
                      id="wf-zone-cat"
                      value={wfZoneCat}
                      onChange={(e) => setWfZoneCat(e.target.value as TileZoneCategory)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                    >
                      {ZONE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="wf-zone-sqft" className="block text-xs font-medium text-slate-700 mb-1">
                      Area Sq.Ft
                    </label>
                    <input
                      id="wf-zone-sqft"
                      type="number"
                      min="0"
                      value={wfZoneSqft}
                      onChange={(e) => setWfZoneSqft(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                    />
                  </div>

                  <div>
                    <label htmlFor="wf-zone-status" className="block text-xs font-medium text-slate-700 mb-1">
                      Initial Status
                    </label>
                    <select
                      id="wf-zone-status"
                      value={wfZoneStatus}
                      onChange={(e) => setWfZoneStatus(e.target.value as ZoneStatus)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
                    >
                      <option value="not_started">{ZONE_STATUS_LABELS.not_started}</option>
                      <option value="prechecking">{ZONE_STATUS_LABELS.prechecking}</option>
                      <option value="in_progress">{ZONE_STATUS_LABELS.in_progress}</option>
                      <option value="cleaning_in_progress">{ZONE_STATUS_LABELS.cleaning_in_progress}</option>
                      <option value="cleaning_done">{ZONE_STATUS_LABELS.cleaning_done}</option>
                      <option value="completed">{ZONE_STATUS_LABELS.completed}</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Live Generated Areas Preview */}
              {(() => {
                const draftItems = getWholeFloorDraftItems();
                if (draftItems.length === 0) return null;
                return (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-700">
                      Preview ({draftItems.length} area{draftItems.length === 1 ? '' : 's'} per selected floor):
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {draftItems.map((it, idx) => (
                        <span
                          key={`${it.label}_${idx}`}
                          className="px-2 py-0.5 text-[11px] bg-white border border-slate-200 rounded text-slate-800"
                        >
                          {it.label} ({it.sqft} sf)
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowWholeFloorZoneModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={wfBusy}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {(() => {
                    const count = getWholeFloorDraftItems().length;
                    if (wfBusy) return 'Saving Common Areas...';
                    if (wfTargetMode === 'common_unit') {
                      return `Save ${count} Area${count === 1 ? '' : 's'} to ${wfSelectedFloors.length} Floor${wfSelectedFloors.length === 1 ? '' : 's'}`;
                    }
                    const flatCount = towerFlats.filter(
                      (f) => f.floorNumber === Number(wfFloorNum)
                    ).length;
                    return `Add ${Math.max(1, count)} Area${count === 1 ? '' : 's'} to ${flatCount} Units`;
                  })()}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Isolated A4 Vertical Work Progress Report Print Preview */}
      {companyProfile && (
        <PrintPreviewOverlay
          open={showWorkReportPreview}
          mode="report_a4"
          title="Site Tile Work Status Report"
          subtitle={`${workOverviewAllProjects ? 'All Projects' : selectedProject?.name || 'Project'} · ${
            workTowerFilter === 'all'
              ? 'All Towers'
              : workScopeTowers.find((t) => t.id === workTowerFilter)?.name || 'Tower'
          } · ${
            workCustomFloors.length > 0
              ? `Floors ${workCustomFloors.map((n) => formatFloorLabel(n)).join(', ')}`
              : 'All Floors'
          }`}
          onClose={() => setShowWorkReportPreview(false)}
          onDownloadPdf={() => {
            const projLabel = workOverviewAllProjects
              ? `All Projects (${projects.length})`
              : selectedProject?.name || 'Project';
            const twrLabel =
              workTowerFilter === 'all'
                ? 'All Towers'
                : workScopeTowers.find((t) => t.id === workTowerFilter)?.name || 'Tower';
            const flLabel =
              workCustomFloors.length > 0
                ? workCustomFloors.map((n) => formatFloorLabel(n)).join(', ')
                : 'All Floors';
            const areaLbl =
              WORK_AREA_FILTER_OPTIONS.find((a) => a.id === workAreaFilter)?.label || 'All Areas';
            const { blob, fileName } = buildWorkReportPdfBlob({
              company: companyProfile,
              title: 'Tile Work Progress Report',
              scopeSummary: `${projLabel} | ${twrLabel} | Floors: ${flLabel}`,
              filterSummary: `View: ${workBreakdownLevel.toUpperCase()} | Area: ${areaLbl} | Status: ${workStatusFilter}${
                workAreaSearch.trim() ? ` | Search: ${workAreaSearch.trim()}` : ''
              }`,
              breakdownLevel: workBreakdownLevel,
              areaFilter: workAreaFilter,
              overview: workStatusOverview,
            });
            triggerBlobDownload(blob, fileName);
          }}
          renderPrintContent={() => (
            <PrintableWorkReportSheet
              company={companyProfile}
              title="Tile Work Progress Report"
              projectScopeLabel={
                workOverviewAllProjects
                  ? `All Projects (${projects.length})`
                  : selectedProject?.name || 'Selected Project'
              }
              towerFilterLabel={
                workTowerFilter === 'all'
                  ? 'All Towers'
                  : workScopeTowers.find((t) => t.id === workTowerFilter)?.name || 'Selected Tower'
              }
              floorFilterLabel={
                workCustomFloors.length > 0
                  ? workCustomFloors.map((n) => formatFloorLabel(n)).join(', ')
                  : 'All Floors'
              }
              areaFilter={workAreaFilter}
              areaSearch={workAreaSearch}
              statusFilter={workStatusFilter}
              breakdownLevel={workBreakdownLevel}
              overview={workStatusOverview}
            />
          )}
        />
      )}

      <ProjectSitesMapModal
        isOpen={showSiteMapModal}
        projects={projects}
        towers={towers}
        flats={flats}
        tileZoneCatalog={zoneCatalog}
        selectedProjectId={selectedProjectId}
        onSelectProject={(projectId) => {
          setSelectedProjectId(projectId);
          setSelectedFloorFilter('all');
        }}
        onSaveProjectPlaceId={(projectId, placeId) => {
          void updateProject(projectId, { placeId });
        }}
        onClose={() => setShowSiteMapModal(false)}
      />

      <CustomQrStudioModal
        isOpen={showQrStudioModal}
        onClose={() => setShowQrStudioModal(false)}
        employees={employees}
        projects={projects}
        towers={towers}
        defaultTarget="sites"
        initialProjectId={selectedProjectId || undefined}
        initialTowerId={selectedTowerId || undefined}
        onPreviewQrProfile={(scanUrl) => {
          if (onPreviewQrProfile) onPreviewQrProfile(scanUrl);
        }}
      />

      {/* Zone Note, Remarks & Voice Note Modal */}
      {remarkModalZone && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="zone-remark-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 id="zone-remark-modal-title" className="text-base font-semibold text-slate-900">
                  Note, Remarks &amp; Voice Note
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">{remarkModalZone.zoneLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  stopVoiceRecording();
                  setRemarkModalZone(null);
                }}
                aria-label="Close note and voice modal"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveZoneRemark} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label htmlFor="zone-remark-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Manual Note / Defect Remark
                </label>
                <textarea
                  id="zone-remark-notes"
                  rows={3}
                  value={draftZoneNotes}
                  onChange={(e) => setDraftZoneNotes(e.target.value)}
                  placeholder="e.g. Check skirting alignment near balcony door; grout gap 2mm needs rework..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">
                    Voice Note Recording &amp; Transcript
                  </span>
                  <div className="flex items-center gap-2">
                    {!isRecordingVoice ? (
                      <button
                        type="button"
                        onClick={startVoiceRecording}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-700 rounded hover:bg-orange-800"
                      >
                        <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Record Voice Note (6s)</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopVoiceRecording}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-700 rounded hover:bg-red-800"
                      >
                        <Square className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Stop Recording</span>
                      </button>
                    )}
                    {draftVoiceDataUrl && (
                      <button
                        type="button"
                        onClick={() => setDraftVoiceDataUrl('')}
                        className="px-2 py-1 text-xs text-red-700 border border-red-200 bg-white rounded hover:bg-red-50"
                      >
                        Clear Audio
                      </button>
                    )}
                  </div>
                </div>

                {voiceRecordError && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                    {voiceRecordError}
                  </p>
                )}

                {draftVoiceDataUrl && (
                  <audio controls src={draftVoiceDataUrl} className="w-full h-9" />
                )}

                <div>
                  <label
                    htmlFor="zone-voice-transcript"
                    className="block text-[11px] font-medium text-slate-600 mb-1"
                  >
                    Voice Note Transcript / Spoken Remark
                  </label>
                  <input
                    id="zone-voice-transcript"
                    type="text"
                    value={draftVoiceTranscript}
                    onChange={(e) => setDraftVoiceTranscript(e.target.value)}
                    placeholder="Auto-transcribed when mic is used, or type voice summary..."
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-md cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftFlagOpenIssue}
                  onChange={(e) => setDraftFlagOpenIssue(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-orange-700"
                />
                <span className="text-xs text-amber-950">
                  <strong>Flag as Open Issue:</strong> Shows alert on Supervisor dashboard until rectified and pops up automatically on the Assigned Worker&rsquo;s screen.
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    stopVoiceRecording();
                    setRemarkModalZone(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingZoneRemark}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-700 rounded-md hover:bg-orange-800 disabled:opacity-50"
                >
                  {savingZoneRemark ? 'Saving...' : 'Save Note & Remarks'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
