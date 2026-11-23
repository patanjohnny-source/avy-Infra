import type {
  AssignmentStatus,
  FlatUnit,
  Project,
  TileZoneCategory,
  TileZoneDefinition,
  TileZoneKey,
  TileZoneState,
  Tower,
  ZoneStatus,
} from '../types/avy';

export type { TileZoneDefinition };

export const TILE_ZONES: TileZoneDefinition[] = [
  { key: 'master_bedroom_flooring', label: 'Master Bedroom Flooring', category: 'Flooring', defaultSqft: 195, isDefault: true },
  { key: 'hall_flooring', label: 'Hall Flooring', category: 'Flooring', defaultSqft: 280, isDefault: true },
  { key: 'hall_skirting', label: 'Hall Skirting', category: 'Skirting', defaultSqft: 68, isDefault: true },
  { key: 'children_bedroom_flooring', label: 'Children Bedroom Flooring', category: 'Flooring', defaultSqft: 150, isDefault: true },
  { key: 'guest_bedroom_flooring', label: 'Guest Bedroom Flooring', category: 'Flooring', defaultSqft: 145, isDefault: true },
  { key: 'main_flooring_hall', label: 'Main Flooring Hall', category: 'Flooring', defaultSqft: 320, isDefault: true },
  { key: 'balcony_flooring', label: 'Balcony Flooring', category: 'Flooring', defaultSqft: 85, isDefault: true },
  { key: 'utility_flooring', label: 'Utility Flooring', category: 'Flooring', defaultSqft: 55, isDefault: true },
  { key: 'dado', label: 'Dado (Kitchen / Bath)', category: 'Wall / Wet', defaultSqft: 240, isDefault: true },
  { key: 'balcony_skirting', label: 'Balcony Skirting', category: 'Skirting', defaultSqft: 38, isDefault: true },
  { key: 'main_flooring_skirting', label: 'Main Flooring Skirting', category: 'Skirting', defaultSqft: 75, isDefault: true },
  { key: 'corridor', label: 'Corridor', category: 'Common', defaultSqft: 110, isDefault: true },
  { key: 'lobby_area', label: 'Lobby Area', category: 'Common', defaultSqft: 140, isDefault: true },
];

export const ZONE_CATEGORIES: TileZoneCategory[] = ['Flooring', 'Skirting', 'Wall / Wet', 'Common'];

export const ZONE_LABEL_MAP: Record<string, string> = TILE_ZONES.reduce(
  (acc, item) => {
    acc[item.key] = item.label;
    return acc;
  },
  {} as Record<string, string>
);

export const ZONE_STATUS_LABELS: Record<ZoneStatus, string> = {
  not_started: 'Not Started',
  prechecking: 'Prechecking',
  in_progress: 'In Progress',
  completed: 'Completed',
  cleaning_in_progress: 'Cleaning In Progress',
  cleaning_done: 'Cleaning Done',
  qc_approved: 'QC Approved',
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  assigned: 'Assigned',
  prechecking: 'Prechecking',
  in_progress: 'In Progress',
  completed: 'Completed',
  cleaning_in_progress: 'Cleaning In Progress',
  cleaning_done: 'Cleaning Done',
  qc_approved: 'QC Approved',
};

export function isFinishedWorkStatus(status: ZoneStatus | AssignmentStatus): boolean {
  return status === 'completed' || status === 'cleaning_done' || status === 'qc_approved';
}

export function isActiveWorkStatus(status: ZoneStatus | AssignmentStatus): boolean {
  return (
    status === 'assigned' ||
    status === 'prechecking' ||
    status === 'in_progress' ||
    status === 'cleaning_in_progress'
  );
}

export function getWorkStatusLabel(status: ZoneStatus | AssignmentStatus): string {
  if (status === 'assigned') return 'Assigned';
  return ZONE_STATUS_LABELS[status] || status;
}

export function getWorkStatusBadgeClass(status: ZoneStatus | AssignmentStatus): string {
  switch (status) {
    case 'qc_approved':
    case 'completed':
      return 'bg-emerald-50 text-emerald-800 border-emerald-300';
    case 'cleaning_done':
      return 'bg-teal-50 text-teal-800 border-teal-300';
    case 'cleaning_in_progress':
      return 'bg-cyan-50 text-cyan-800 border-cyan-300';
    case 'prechecking':
      return 'bg-indigo-50 text-indigo-800 border-indigo-300';
    case 'in_progress':
      return 'bg-amber-50 text-amber-800 border-amber-300';
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200';
  }
}

export interface SpecialLevelPreset {
  id: 'basement_3' | 'basement_2' | 'basement_1' | 'ground' | 'podium';
  label: string;
  shortCode: string;
  floorNumber: number;
  unitPrefix: string;
  defaultUnitType: string;
}

export const SPECIAL_FLOOR_PRESETS: SpecialLevelPreset[] = [
  {
    id: 'basement_3',
    label: 'Basement 3',
    shortCode: 'B3',
    floorNumber: -3,
    unitPrefix: 'B3',
    defaultUnitType: 'Basement 3 Area',
  },
  {
    id: 'basement_2',
    label: 'Basement 2',
    shortCode: 'B2',
    floorNumber: -2,
    unitPrefix: 'B2',
    defaultUnitType: 'Basement 2 Area',
  },
  {
    id: 'basement_1',
    label: 'Basement 1',
    shortCode: 'B1',
    floorNumber: -1,
    unitPrefix: 'B1',
    defaultUnitType: 'Basement 1 Area',
  },
  {
    id: 'ground',
    label: 'Ground Floor',
    shortCode: 'GF',
    floorNumber: 0,
    unitPrefix: 'GF',
    defaultUnitType: 'Ground Floor Unit',
  },
  {
    id: 'podium',
    label: 'Podium',
    shortCode: 'POD',
    floorNumber: 0.5,
    unitPrefix: 'POD',
    defaultUnitType: 'Podium Level Area',
  },
];

export function formatFloorLabel(floorNumber: number, floorLabel?: string): string {
  if (floorLabel && floorLabel.trim()) return floorLabel.trim();
  if (floorNumber === -3) return 'Basement 3';
  if (floorNumber === -2) return 'Basement 2';
  if (floorNumber === -1) return 'Basement 1';
  if (floorNumber < -3) return `Basement ${Math.abs(Math.round(floorNumber))}`;
  if (floorNumber === 0) return 'Ground Floor';
  if (floorNumber === 0.5) return 'Podium';
  return `Floor ${floorNumber}`;
}

export function formatFloorShortTag(floorNumber: number, floorLabel?: string): string {
  if (floorLabel) {
    const low = floorLabel.toLowerCase();
    if (low.includes('podium')) return 'POD';
    if (low.includes('ground')) return 'GF';
    if (low.includes('basement 3')) return 'B3';
    if (low.includes('basement 2')) return 'B2';
    if (low.includes('basement 1')) return 'B1';
  }
  if (floorNumber === -3) return 'B3';
  if (floorNumber === -2) return 'B2';
  if (floorNumber === -1) return 'B1';
  if (floorNumber < -3) return `B${Math.abs(Math.round(floorNumber))}`;
  if (floorNumber === 0) return 'GF';
  if (floorNumber === 0.5) return 'POD';
  return `Fl ${floorNumber}`;
}

export function slugifyZoneKey(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return base || `custom_area_${Date.now().toString(36)}`;
}

export function createDefaultZones(
  overrides?: Partial<Record<TileZoneKey, Partial<TileZoneState>>>,
  catalog: TileZoneDefinition[] = TILE_ZONES
): Record<string, TileZoneState> {
  const zones: Record<string, TileZoneState> = {};
  for (const def of catalog) {
    const patch = overrides?.[def.key];
    const entry: TileZoneState = {
      status: patch?.status ?? 'not_started',
      sqft: patch?.sqft ?? def.defaultSqft,
    };
    if (patch?.label || !def.isDefault) entry.label = patch?.label || def.label;
    if (patch?.category || !def.isDefault) entry.category = patch?.category || def.category;
    if (patch?.assignedEmployeeId) entry.assignedEmployeeId = patch.assignedEmployeeId;
    if (patch?.assignedEmpCode) entry.assignedEmpCode = patch.assignedEmpCode;
    if (patch?.assignedEmployeeName) entry.assignedEmployeeName = patch.assignedEmployeeName;
    if (patch?.updatedDate) entry.updatedDate = patch.updatedDate;
    if (patch?.notes) entry.notes = patch.notes;
    if (patch?.voiceNoteDataUrl) entry.voiceNoteDataUrl = patch.voiceNoteDataUrl;
    if (patch?.voiceNoteTranscript) entry.voiceNoteTranscript = patch.voiceNoteTranscript;
    if (patch?.issueStatus) entry.issueStatus = patch.issueStatus;
    if (patch?.issueReportedBy) entry.issueReportedBy = patch.issueReportedBy;
    if (patch?.issueReportedAt) entry.issueReportedAt = patch.issueReportedAt;
    if (patch?.rectifiedAt) entry.rectifiedAt = patch.rectifiedAt;
    zones[def.key] = entry;
  }
  return zones;
}

export const FLOOR_COMMON_UNIT_TYPE = 'Floor Common Area';

export function isFloorCommonUnit(flat: FlatUnit | null | undefined): boolean {
  if (!flat) return false;
  if ((flat.unitType || '').trim().toLowerCase() === FLOOR_COMMON_UNIT_TYPE.toLowerCase()) {
    return true;
  }
  return (flat.unitNumber || '').trim().toLowerCase().endsWith('-common');
}

export function formatFloorCommonUnitNumber(floorNumber: number, floorLabel?: string): string {
  const shortTag = formatFloorShortTag(floorNumber, floorLabel)
    .replace(/\s+/g, '')
    .toUpperCase();
  const cleanTag = shortTag || `FL${Math.floor(floorNumber)}`;
  return `${cleanTag}-Common`.slice(0, 24);
}

export function getEffectiveZonesForFlat(
  flat: FlatUnit | null | undefined,
  catalog: TileZoneDefinition[] = TILE_ZONES
): TileZoneDefinition[] {
  const byKey = new Map<string, TileZoneDefinition>();

  if (!isFloorCommonUnit(flat)) {
    for (const def of catalog) {
      byKey.set(def.key, def);
    }
  }

  if (flat?.zones) {
    for (const [key, state] of Object.entries(flat.zones)) {
      const existing = byKey.get(key);
      if (!existing) {
        const pretty =
          state.label ||
          ZONE_LABEL_MAP[key] ||
          key
            .split('_')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        byKey.set(key, {
          key,
          label: pretty,
          category: state.category || 'Flooring',
          defaultSqft: state.sqft ?? 100,
        });
      } else if (state.label && state.label !== existing.label) {
        byKey.set(key, {
          ...existing,
          label: state.label,
          category: state.category || existing.category,
        });
      }
    }
  }
  return Array.from(byKey.values());
}

/**
 * Generates standard Indian high-rise unit numbers for a floor:
 * Floor 1 with 3 units -> ['101', '102', '103']
 * Floor 50 with 2 units -> ['5001', '5002']
 * Special levels (-3,-2,-1, 0, 0.5) -> ['B3-01', 'B2-01', 'B1-01', 'GF-01', 'POD-01']
 */
export function generateUnitNumbersForFloor(
  floorNumber: number,
  unitsCount: number,
  prefixOverride?: string
): string[] {
  const safeUnits = Math.max(1, Math.min(50, Math.floor(unitsCount)));
  const result: string[] = [];

  if (prefixOverride && prefixOverride.trim()) {
    const cleanPrefix = prefixOverride.trim().toUpperCase();
    for (let i = 1; i <= safeUnits; i++) {
      result.push(`${cleanPrefix}-${String(i).padStart(2, '0')}`);
    }
    return result;
  }

  if (floorNumber < 0) {
    const bNum = Math.abs(Math.round(floorNumber));
    for (let i = 1; i <= safeUnits; i++) {
      result.push(`B${bNum}-${String(i).padStart(2, '0')}`);
    }
    return result;
  }

  if (floorNumber === 0) {
    for (let i = 1; i <= safeUnits; i++) {
      result.push(`GF-${String(i).padStart(2, '0')}`);
    }
    return result;
  }

  if (floorNumber === 0.5) {
    for (let i = 1; i <= safeUnits; i++) {
      result.push(`POD-${String(i).padStart(2, '0')}`);
    }
    return result;
  }

  const safeFloor = Math.max(1, Math.floor(floorNumber));
  for (let i = 1; i <= safeUnits; i++) {
    const suffix = String(i).padStart(2, '0');
    result.push(`${safeFloor}${suffix}`);
  }
  return result;
}

/**
 * Parses comma- or whitespace-separated custom flat numbers (e.g. "5001, 5002, 5003").
 */
export function parseCustomUnitNumbers(raw: string): string[] {
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 24);
  return Array.from(new Set(tokens));
}

export interface FlatProgressSummary {
  totalZones: number;
  completedCount: number;
  inProgressCount: number;
  notStartedCount: number;
  precheckingCount: number;
  cleaningInProgressCount: number;
  cleaningDoneCount: number;
  percentComplete: number;
  totalSqft: number;
  completedSqft: number;
}

export function calculateFlatProgress(
  flat: FlatUnit,
  catalog: TileZoneDefinition[] = TILE_ZONES
): FlatProgressSummary {
  const zoneDefs = getEffectiveZonesForFlat(flat, catalog);
  let completedCount = 0;
  let inProgressCount = 0;
  let notStartedCount = 0;
  let precheckingCount = 0;
  let cleaningInProgressCount = 0;
  let cleaningDoneCount = 0;
  let totalSqft = 0;
  let completedSqft = 0;

  for (const def of zoneDefs) {
    const zone = flat.zones?.[def.key];
    const sqft = zone?.sqft ?? def.defaultSqft ?? 0;
    totalSqft += sqft;
    if (!zone || zone.status === 'not_started') {
      notStartedCount += 1;
    } else if (zone.status === 'prechecking') {
      precheckingCount += 1;
    } else if (zone.status === 'in_progress') {
      inProgressCount += 1;
    } else if (zone.status === 'cleaning_in_progress') {
      inProgressCount += 1;
      cleaningInProgressCount += 1;
    } else if (zone.status === 'cleaning_done') {
      completedCount += 1;
      cleaningDoneCount += 1;
      completedSqft += sqft;
    } else {
      completedCount += 1;
      completedSqft += sqft;
    }
  }

  const totalZones = zoneDefs.length;
  const percentComplete = totalZones > 0 ? Math.round((completedCount / totalZones) * 100) : 0;

  return {
    totalZones,
    completedCount,
    inProgressCount,
    notStartedCount,
    precheckingCount,
    cleaningInProgressCount,
    cleaningDoneCount,
    percentComplete,
    totalSqft,
    completedSqft,
  };
}

export const MAX_ZONES_PER_FLAT = 40;

export interface WholeFloorPresetZone {
  label: string;
  category: TileZoneCategory;
  defaultSqft: number;
}

export const WHOLE_FLOOR_CUSTOM_PRESETS: WholeFloorPresetZone[] = [
  { label: 'Electrical Room Flooring', category: 'Flooring', defaultSqft: 110 },
  { label: 'Electrical Room Skirting', category: 'Skirting', defaultSqft: 42 },
  { label: 'Corridor Flooring', category: 'Common', defaultSqft: 185 },
  { label: 'Corridor Skirting', category: 'Skirting', defaultSqft: 68 },
  { label: 'Lift Lobby Flooring', category: 'Common', defaultSqft: 155 },
  { label: 'Lift Lobby Skirting', category: 'Skirting', defaultSqft: 52 },
  { label: 'Staircase Flooring', category: 'Common', defaultSqft: 140 },
  { label: 'Staircase Skirting', category: 'Skirting', defaultSqft: 50 },
  { label: 'Pooja Room Flooring', category: 'Flooring', defaultSqft: 64 },
  { label: 'Duct / Shaft Area', category: 'Common', defaultSqft: 48 },
];

export interface MixedBhkSpec {
  unitType: string;
  count: number;
}

export interface GeneratedFlatUnitSpec {
  unitNumber: string;
  unitType: string;
}

export const RESIDENTIAL_BHK_TYPES = [
  '1 BHK',
  '2 BHK',
  '3 BHK',
  '4 BHK',
  '5 BHK',
  'Penthouse',
] as const;

export interface FloorLayoutPreset {
  id: string;
  label: string;
  shortDesc: string;
  slotUnitTypes: string[];
}

export const FLOOR_LAYOUT_PRESETS: FloorLayoutPreset[] = [
  {
    id: 'tower_1_8_mixed',
    label: 'Tower 1 Mix (8 Flats: 3,3,2,2,2,2,3,3 BHK)',
    shortDesc: '01-02: 3BHK · 03-06: 2BHK · 07-08: 3BHK',
    slotUnitTypes: ['3 BHK', '3 BHK', '2 BHK', '2 BHK', '2 BHK', '2 BHK', '3 BHK', '3 BHK'],
  },
  {
    id: 'tower_2_4_mixed',
    label: 'Tower 2 Mix (4 Flats: 4,3,3,4 BHK)',
    shortDesc: '01: 4BHK · 02-03: 3BHK · 04: 4BHK',
    slotUnitTypes: ['4 BHK', '3 BHK', '3 BHK', '4 BHK'],
  },
  {
    id: 'luxury_4_5bhk',
    label: 'Signature Wings (4 Flats: 5,4,4,5 BHK)',
    shortDesc: '01: 5BHK · 02-03: 4BHK · 04: 5BHK',
    slotUnitTypes: ['5 BHK', '4 BHK', '4 BHK', '5 BHK'],
  },
  {
    id: 'standard_4_3bhk',
    label: 'Standard Wing (4 Flats: All 3 BHK)',
    shortDesc: '01-04: All 3 BHK',
    slotUnitTypes: ['3 BHK', '3 BHK', '3 BHK', '3 BHK'],
  },
];

/**
 * Generates sequential unit numbers for a floor paired with exact ordered BHK slot definitions
 * matching real floor plans (e.g. 101=3BHK, 102=3BHK, 103..106=2BHK, 107..108=3BHK from floor 1 to 45).
 */
export function buildOrderedSlotFloorUnits(params: {
  floorNumber: number;
  slotUnitTypes: string[];
  prefixOverride?: string;
}): GeneratedFlatUnitSpec[] {
  const cleanSlots = params.slotUnitTypes
    .map((u) => (u || '').trim().slice(0, 40) || '3 BHK')
    .slice(0, 50);
  if (cleanSlots.length === 0) return [];

  const unitNumbers = generateUnitNumbersForFloor(
    params.floorNumber,
    cleanSlots.length,
    params.prefixOverride
  );

  return unitNumbers.map((unitNumber, idx) => ({
    unitNumber,
    unitType: cleanSlots[idx] || '3 BHK',
  }));
}

/**
 * Generates sequential unit numbers for a floor paired with exact mixed BHK configurations
 * matching real building floor plans (e.g. 3 x 3BHK + 3 x 2BHK + 1 x 4BHK on floor 3).
 */
export function buildMixedBhkFloorUnits(params: {
  floorNumber: number;
  mixedSpecs: MixedBhkSpec[];
  prefixOverride?: string;
}): GeneratedFlatUnitSpec[] {
  const cleanSpecs = params.mixedSpecs
    .map((s) => ({
      unitType: (s.unitType || '').trim().slice(0, 40) || '3 BHK',
      count: Math.max(0, Math.min(30, Math.floor(Number(s.count) || 0))),
    }))
    .filter((s) => s.count > 0);

  const totalCount = Math.min(
    50,
    cleanSpecs.reduce((sum, s) => sum + s.count, 0)
  );
  if (totalCount <= 0) return [];

  const unitNumbers = generateUnitNumbersForFloor(
    params.floorNumber,
    totalCount,
    params.prefixOverride
  );

  const result: GeneratedFlatUnitSpec[] = [];
  let cursor = 0;
  for (const spec of cleanSpecs) {
    for (let i = 0; i < spec.count && cursor < unitNumbers.length; i += 1) {
      result.push({
        unitNumber: unitNumbers[cursor],
        unitType: spec.unitType,
      });
      cursor += 1;
    }
  }
  return result;
}

export interface WholeFloorCustomZoneBatchResult {
  updatedFlats: FlatUnit[];
  modifiedFlatIds: string[];
  modifiedCount: number;
  baseKey: string;
  skippedAtLimitCount: number;
}

export interface WholeFloorCustomZoneItem {
  label: string;
  category: TileZoneCategory;
  sqft: number;
  status?: ZoneStatus;
}

/**
 * Pure helper that adds one custom tile area/zone to every flat on a matching tower + floorNumber.
 * Each flat safely avoids overwriting existing keys by appending _2, _3 if needed.
 */
export function addCustomZoneToFlatsBatch(params: {
  flats: FlatUnit[];
  towerId: string;
  floorNumber: number;
  label: string;
  category: TileZoneCategory;
  sqft: number;
  status?: ZoneStatus;
  updatedDate: string;
  nowIso: string;
}): WholeFloorCustomZoneBatchResult {
  return addCustomZonesToFlatsBatch({
    flats: params.flats,
    towerId: params.towerId,
    floorNumber: params.floorNumber,
    items: [
      {
        label: params.label,
        category: params.category,
        sqft: params.sqft,
        status: params.status,
      },
    ],
    updatedDate: params.updatedDate,
    nowIso: params.nowIso,
  });
}

/**
 * Pure helper that adds multiple custom tile areas/zones (e.g. Electrical Room Flooring,
 * Electrical Room Skirting, Corridor Flooring, Corridor Skirting) across an entire floor
 * while respecting the 40-zone Firestore document ceiling per flat.
 */
export function addCustomZonesToFlatsBatch(params: {
  flats: FlatUnit[];
  towerId: string;
  floorNumber: number;
  items: WholeFloorCustomZoneItem[];
  updatedDate: string;
  nowIso: string;
}): WholeFloorCustomZoneBatchResult {
  const cleanItems = params.items
    .map((item) => ({
      label: (item.label || '').trim().slice(0, 80),
      category: item.category,
      sqft: Math.max(0, Number(item.sqft) || 0),
      status: item.status ?? ('not_started' as ZoneStatus),
    }))
    .filter((item) => item.label.length > 0);

  const firstBaseKey = slugifyZoneKey(cleanItems[0]?.label || 'Custom Area');
  if (cleanItems.length === 0) {
    return {
      updatedFlats: params.flats,
      modifiedFlatIds: [],
      modifiedCount: 0,
      baseKey: firstBaseKey,
      skippedAtLimitCount: 0,
    };
  }

  const modifiedFlatIds: string[] = [];
  let skippedAtLimitCount = 0;

  const updatedFlats = params.flats.map((flat) => {
    if (flat.towerId !== params.towerId || flat.floorNumber !== params.floorNumber) {
      return flat;
    }

    const nextZones: Record<string, TileZoneState> = { ...(flat.zones || {}) };
    let addedAnyToFlat = false;

    for (const item of cleanItems) {
      if (Object.keys(nextZones).length >= MAX_ZONES_PER_FLAT) {
        skippedAtLimitCount += 1;
        break;
      }

      const baseKey = slugifyZoneKey(item.label);
      let zoneKey = baseKey;
      let n = 2;
      while (nextZones[zoneKey]) {
        zoneKey = `${baseKey}_${n++}`;
      }

      nextZones[zoneKey] = {
        status: item.status,
        sqft: item.sqft,
        label: item.label,
        category: item.category,
        updatedDate: params.updatedDate,
      };
      addedAnyToFlat = true;
    }

    if (!addedAnyToFlat) {
      return flat;
    }

    modifiedFlatIds.push(flat.id);
    return {
      ...flat,
      zones: nextZones,
      updatedAt: params.nowIso,
    };
  });

  return {
    updatedFlats,
    modifiedFlatIds,
    modifiedCount: modifiedFlatIds.length,
    baseKey: firstBaseKey,
    skippedAtLimitCount,
  };
}

export interface WholeFloorCommonRoomSpec {
  id: string;
  baseName: string;
  count: number; // 0..4 (e.g., 1 or 2 Electrical Rooms, 1 or 2 Lift Lobbies)
  includeFlooring: boolean;
  includeSkirting: boolean;
  includeDado?: boolean;
  flooringCategory: TileZoneCategory;
  flooringSqft: number;
  skirtingSqft: number;
  dadoSqft?: number;
}

export const WHOLE_FLOOR_COMMON_ROOM_TEMPLATES: WholeFloorCommonRoomSpec[] = [
  {
    id: 'electrical_room',
    baseName: 'Electrical Room',
    count: 1,
    includeFlooring: true,
    includeSkirting: true,
    includeDado: false,
    flooringCategory: 'Flooring',
    flooringSqft: 110,
    skirtingSqft: 42,
    dadoSqft: 0,
  },
  {
    id: 'lift_lobby',
    baseName: 'Lift Lobby',
    count: 1,
    includeFlooring: true,
    includeSkirting: true,
    includeDado: false,
    flooringCategory: 'Common',
    flooringSqft: 165,
    skirtingSqft: 52,
    dadoSqft: 95,
  },
  {
    id: 'corridor',
    baseName: 'Corridor',
    count: 1,
    includeFlooring: true,
    includeSkirting: true,
    includeDado: false,
    flooringCategory: 'Common',
    flooringSqft: 185,
    skirtingSqft: 68,
    dadoSqft: 0,
  },
  {
    id: 'staircase_lobby',
    baseName: 'Staircase Lobby',
    count: 0,
    includeFlooring: true,
    includeSkirting: true,
    includeDado: false,
    flooringCategory: 'Common',
    flooringSqft: 140,
    skirtingSqft: 50,
    dadoSqft: 0,
  },
  {
    id: 'meter_shaft_room',
    baseName: 'Meter / Shaft Room',
    count: 0,
    includeFlooring: true,
    includeSkirting: true,
    includeDado: false,
    flooringCategory: 'Common',
    flooringSqft: 65,
    skirtingSqft: 28,
    dadoSqft: 0,
  },
];

/**
 * Generates clean numbered tile zone items for whole-floor common areas:
 * e.g. 2 Electrical Rooms -> Electrical Room 1 Flooring, Electrical Room 1 Skirting,
 * Electrical Room 2 Flooring, Electrical Room 2 Skirting;
 * 1 Lift Lobby -> Lift Lobby Flooring, Lift Lobby Skirting; etc.
 */
export function buildWholeFloorCommonZoneItems(params: {
  rooms: WholeFloorCommonRoomSpec[];
  extraAreas?: Array<{ label: string; category: TileZoneCategory; sqft: number }>;
  status?: ZoneStatus;
}): WholeFloorCustomZoneItem[] {
  const items: WholeFloorCustomZoneItem[] = [];
  const defaultStatus: ZoneStatus = params.status ?? 'not_started';

  for (const room of params.rooms) {
    const cleanName = (room.baseName || '').trim().slice(0, 50);
    const count = Math.max(0, Math.min(6, Math.floor(Number(room.count) || 0)));
    if (!cleanName || count <= 0) continue;

    for (let idx = 1; idx <= count; idx += 1) {
      const prefix = count === 1 ? cleanName : `${cleanName} ${idx}`;
      if (room.includeFlooring) {
        items.push({
          label: `${prefix} Flooring`,
          category: room.flooringCategory || 'Common',
          sqft: Math.max(0, Number(room.flooringSqft) || 0),
          status: defaultStatus,
        });
      }
      if (room.includeSkirting) {
        items.push({
          label: `${prefix} Skirting`,
          category: 'Skirting',
          sqft: Math.max(0, Number(room.skirtingSqft) || 0),
          status: defaultStatus,
        });
      }
      if (room.includeDado) {
        items.push({
          label: `${prefix} Dado / Wall`,
          category: 'Wall / Wet',
          sqft: Math.max(0, Number(room.dadoSqft) || 0),
          status: defaultStatus,
        });
      }
    }
  }

  for (const extra of params.extraAreas || []) {
    const label = (extra.label || '').trim().slice(0, 80);
    if (!label) continue;
    items.push({
      label,
      category: extra.category || 'Common',
      sqft: Math.max(0, Number(extra.sqft) || 0),
      status: defaultStatus,
    });
  }

  return items;
}

export interface UpsertFloorCommonUnitsResult {
  nextFlats: FlatUnit[];
  createdUnits: FlatUnit[];
  updatedUnits: FlatUnit[];
  addedZonesCount: number;
  skippedExistingCount: number;
  skippedAtLimitCount: number;
}

/**
 * Pure helper that creates or updates a dedicated Floor Common Area unit (`FL{N}-Common`)
 * for one or more floors in a tower without duplicating Electrical Rooms / Lift Lobbies inside
 * every residential flat, and without clobbering existing completed zones or assignments.
 */
export function upsertFloorCommonUnitsBatch(params: {
  existingFlats: FlatUnit[];
  ownerId: string;
  projectId: string;
  towerId: string;
  floorNumbers: number[];
  floorLabelsByNumber?: Record<number, string>;
  items: WholeFloorCustomZoneItem[];
  updatedDate: string;
  nowIso: string;
  makeFlatId?: (towerId: string, floorNumber: number, unitNumber: string) => string;
}): UpsertFloorCommonUnitsResult {
  const cleanItems = params.items
    .map((item) => ({
      label: (item.label || '').trim().slice(0, 80),
      category: item.category,
      sqft: Math.max(0, Number(item.sqft) || 0),
      status: item.status ?? ('not_started' as ZoneStatus),
    }))
    .filter((item) => item.label.length > 0);

  const uniqueFloors = Array.from(
    new Set(params.floorNumbers.filter((n) => Number.isFinite(n)))
  ).sort((a, b) => a - b);

  if (cleanItems.length === 0 || uniqueFloors.length === 0) {
    return {
      nextFlats: params.existingFlats,
      createdUnits: [],
      updatedUnits: [],
      addedZonesCount: 0,
      skippedExistingCount: 0,
      skippedAtLimitCount: 0,
    };
  }

  let nextFlats = [...params.existingFlats];
  const createdUnits: FlatUnit[] = [];
  const updatedUnits: FlatUnit[] = [];
  let addedZonesCount = 0;
  let skippedExistingCount = 0;
  let skippedAtLimitCount = 0;

  for (const floorNum of uniqueFloors) {
    const resolvedLabel = (
      params.floorLabelsByNumber?.[floorNum] || formatFloorLabel(floorNum)
    ).slice(0, 60);

    const existingIdx = nextFlats.findIndex(
      (f) => f.towerId === params.towerId && f.floorNumber === floorNum && isFloorCommonUnit(f)
    );

    if (existingIdx >= 0) {
      const existingFlat = nextFlats[existingIdx];
      const nextZones: Record<string, TileZoneState> = { ...(existingFlat.zones || {}) };
      const existingLabelsLower = new Set(
        Object.values(nextZones)
          .map((z) => (z.label || '').trim().toLowerCase())
          .filter(Boolean)
      );

      let addedToThisUnit = false;
      for (const item of cleanItems) {
        const keyCandidate = slugifyZoneKey(item.label);
        const labelLow = item.label.toLowerCase();
        if (nextZones[keyCandidate] || existingLabelsLower.has(labelLow)) {
          skippedExistingCount += 1;
          continue;
        }
        if (Object.keys(nextZones).length >= MAX_ZONES_PER_FLAT) {
          skippedAtLimitCount += 1;
          break;
        }
        nextZones[keyCandidate] = {
          status: item.status,
          sqft: item.sqft,
          label: item.label,
          category: item.category,
          updatedDate: params.updatedDate,
        };
        existingLabelsLower.add(labelLow);
        addedZonesCount += 1;
        addedToThisUnit = true;
      }

      if (addedToThisUnit) {
        const updatedFlat: FlatUnit = {
          ...existingFlat,
          zones: nextZones,
          updatedAt: params.nowIso,
        };
        nextFlats[existingIdx] = updatedFlat;
        updatedUnits.push(updatedFlat);
      }
    } else {
      let unitNumber = formatFloorCommonUnitNumber(floorNum, resolvedLabel);
      const existingUnitNums = new Set(
        nextFlats
          .filter((f) => f.towerId === params.towerId)
          .map((f) => f.unitNumber.toLowerCase())
      );
      let suffix = 2;
      while (existingUnitNums.has(unitNumber.toLowerCase())) {
        unitNumber = `${formatFloorCommonUnitNumber(floorNum, resolvedLabel).slice(0, 20)}-${suffix++}`;
      }

      const zones: Record<string, TileZoneState> = {};
      for (const item of cleanItems) {
        if (Object.keys(zones).length >= MAX_ZONES_PER_FLAT) {
          skippedAtLimitCount += 1;
          break;
        }
        const baseKey = slugifyZoneKey(item.label);
        let zoneKey = baseKey;
        let k = 2;
        while (zones[zoneKey]) {
          zoneKey = `${baseKey}_${k++}`;
        }
        zones[zoneKey] = {
          status: item.status,
          sqft: item.sqft,
          label: item.label,
          category: item.category,
          updatedDate: params.updatedDate,
        };
        addedZonesCount += 1;
      }

      if (Object.keys(zones).length > 0) {
        const flatId = params.makeFlatId
          ? params.makeFlatId(params.towerId, floorNum, unitNumber)
          : `flat_${params.towerId}_${unitNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now().toString(36)}`
              .slice(0, 96);

        const created: FlatUnit = {
          id: flatId,
          ownerId: params.ownerId,
          projectId: params.projectId,
          towerId: params.towerId,
          floorNumber: floorNum,
          floorLabel: resolvedLabel,
          unitNumber,
          unitType: FLOOR_COMMON_UNIT_TYPE,
          zones,
          createdAt: params.nowIso,
          updatedAt: params.nowIso,
        };
        nextFlats.push(created);
        createdUnits.push(created);
      }
    }
  }

  return {
    nextFlats,
    createdUnits,
    updatedUnits,
    addedZonesCount,
    skippedExistingCount,
    skippedAtLimitCount,
  };
}

export interface OpenZoneIssueSummary {
  flatId: string;
  projectId: string;
  projectName: string;
  towerId: string;
  towerName: string;
  floorNumber: number;
  floorLabel: string;
  unitNumber: string;
  unitType: string;
  zoneKey: string;
  zoneLabel: string;
  zoneStatus: ZoneStatus;
  assignedEmployeeId?: string;
  assignedEmpCode?: string;
  assignedEmployeeName?: string;
  notes: string;
  voiceNoteDataUrl?: string;
  voiceNoteTranscript?: string;
  issueReportedBy?: string;
  issueReportedAt?: string;
}

export function collectOpenZoneIssuesForFlats(params: {
  flats: FlatUnit[];
  projects: Project[];
  towers: Tower[];
  tileZoneCatalog?: TileZoneDefinition[];
  employeeId?: string;
}): OpenZoneIssueSummary[] {
  const { flats, projects, towers, tileZoneCatalog = TILE_ZONES, employeeId } = params;
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const towerMap = new Map(towers.map((t) => [t.id, t]));
  const catalogLabelMap = new Map(tileZoneCatalog.map((z) => [z.key, z.label]));

  const issues: OpenZoneIssueSummary[] = [];
  for (const flat of flats) {
    const project = projectMap.get(flat.projectId);
    const tower = towerMap.get(flat.towerId);
    for (const [zoneKey, zState] of Object.entries(flat.zones || {})) {
      if (!zState || zState.issueStatus !== 'open') continue;
      if (employeeId && zState.assignedEmployeeId !== employeeId) continue;

      const label =
        zState.label || catalogLabelMap.get(zoneKey) || ZONE_LABEL_MAP[zoneKey] || zoneKey;

      issues.push({
        flatId: flat.id,
        projectId: flat.projectId,
        projectName: project?.name || 'Project',
        towerId: flat.towerId,
        towerName: tower?.name || 'Tower',
        floorNumber: flat.floorNumber,
        floorLabel: flat.floorLabel || formatFloorLabel(flat.floorNumber),
        unitNumber: flat.unitNumber,
        unitType: flat.unitType,
        zoneKey,
        zoneLabel: label,
        zoneStatus: zState.status,
        assignedEmployeeId: zState.assignedEmployeeId,
        assignedEmpCode: zState.assignedEmpCode,
        assignedEmployeeName: zState.assignedEmployeeName,
        notes: zState.notes || '',
        voiceNoteDataUrl: zState.voiceNoteDataUrl,
        voiceNoteTranscript: zState.voiceNoteTranscript,
        issueReportedBy: zState.issueReportedBy,
        issueReportedAt: zState.issueReportedAt,
      });
    }
  }

  return issues.sort((a, b) =>
    (b.issueReportedAt || '').localeCompare(a.issueReportedAt || '') ||
    a.unitNumber.localeCompare(b.unitNumber)
  );
}
