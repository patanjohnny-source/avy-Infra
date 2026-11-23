import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOOR_COMMON_UNIT_TYPE,
  FLOOR_LAYOUT_PRESETS,
  RESIDENTIAL_BHK_TYPES,
  TILE_ZONES,
  WHOLE_FLOOR_CUSTOM_PRESETS,
  addCustomZoneToFlatsBatch,
  addCustomZonesToFlatsBatch,
  buildMixedBhkFloorUnits,
  buildOrderedSlotFloorUnits,
  buildWholeFloorCommonZoneItems,
  calculateFlatProgress,
  collectOpenZoneIssuesForFlats,
  createDefaultZones,
  formatFloorCommonUnitNumber,
  formatFloorLabel,
  generateUnitNumbersForFloor,
  getEffectiveZonesForFlat,
  isFloorCommonUnit,
  parseCustomUnitNumbers,
  slugifyZoneKey,
  upsertFloorCommonUnitsBatch,
} from './tileZones';
import type { FlatUnit, TileZoneDefinition } from '../types/avy';

test('TILE_ZONES includes all 13 requested tile-laying rooms and areas', () => {
  assert.equal(TILE_ZONES.length, 13);
  const labels = TILE_ZONES.map((z) => z.label);
  for (const required of [
    'Master Bedroom Flooring',
    'Hall Flooring',
    'Hall Skirting',
    'Children Bedroom Flooring',
    'Guest Bedroom Flooring',
    'Main Flooring Hall',
    'Balcony Flooring',
    'Utility Flooring',
    'Dado (Kitchen / Bath)',
    'Balcony Skirting',
    'Main Flooring Skirting',
    'Corridor',
    'Lobby Area',
  ]) {
    assert.ok(labels.includes(required), `Missing zone: ${required}`);
  }
});

test('createDefaultZones omits undefined values for Firestore compatibility', () => {
  const zones = createDefaultZones();
  for (const z of Object.values(zones)) {
    for (const [k, v] of Object.entries(z)) {
      assert.notEqual(v, undefined, `Zone property ${k} should not be undefined`);
    }
  }
});

test('generateUnitNumbersForFloor builds 101..103, 5001..5002, and B1/B2/B3/GF/POD levels', () => {
  assert.deepEqual(generateUnitNumbersForFloor(1, 3), ['101', '102', '103']);
  assert.deepEqual(generateUnitNumbersForFloor(50, 2), ['5001', '5002']);
  assert.deepEqual(generateUnitNumbersForFloor(-3, 2), ['B3-01', 'B3-02']);
  assert.deepEqual(generateUnitNumbersForFloor(-2, 2), ['B2-01', 'B2-02']);
  assert.deepEqual(generateUnitNumbersForFloor(-1, 2), ['B1-01', 'B1-02']);
  assert.deepEqual(generateUnitNumbersForFloor(0, 2), ['GF-01', 'GF-02']);
  assert.deepEqual(generateUnitNumbersForFloor(0.5, 2), ['POD-01', 'POD-02']);
  assert.equal(formatFloorLabel(-3), 'Basement 3');
  assert.equal(formatFloorLabel(0), 'Ground Floor');
  assert.equal(formatFloorLabel(0.5), 'Podium');
});

test('parseCustomUnitNumbers parses and deduplicates custom flat numbers', () => {
  assert.deepEqual(parseCustomUnitNumbers('5001, 5002  5003, 5001'), ['5001', '5002', '5003']);
});

test('calculateFlatProgress counts custom tile areas accurately', () => {
  const customCatalog: TileZoneDefinition[] = [
    ...TILE_ZONES,
    { key: slugifyZoneKey('Pooja Room Flooring'), label: 'Pooja Room Flooring', category: 'Flooring', defaultSqft: 65 },
  ];

  const flat: FlatUnit = {
    id: 'f1',
    ownerId: 'u1',
    projectId: 'p1',
    towerId: 't1',
    floorNumber: 1,
    unitNumber: '101',
    unitType: '3 BHK',
    zones: {
      ...createDefaultZones(
        {
          master_bedroom_flooring: { status: 'completed', sqft: 200 },
          hall_flooring: { status: 'qc_approved', sqft: 300 },
          dado: { status: 'in_progress', sqft: 240 },
        },
        customCatalog
      ),
      staircase_granite: {
        status: 'completed',
        sqft: 90,
        label: 'Staircase Granite',
        category: 'Common',
      },
    },
    createdAt: '2026-11-16T00:00:00Z',
    updatedAt: '2026-11-16T00:00:00Z',
  };

  const zones = getEffectiveZonesForFlat(flat, customCatalog);
  assert.equal(zones.length, 15);

  const progress = calculateFlatProgress(flat, customCatalog);
  assert.equal(progress.totalZones, 15);
  assert.equal(progress.completedCount, 3);
  assert.equal(progress.inProgressCount, 1);
  assert.equal(progress.notStartedCount, 11);
  assert.equal(progress.completedSqft, 590);
});

test('calculateFlatProgress tracks prechecking, cleaning_in_progress, and cleaning_done accurately', () => {
  const flat: FlatUnit = {
    id: 'f2',
    ownerId: 'u1',
    projectId: 'p1',
    towerId: 't1',
    floorNumber: 2,
    unitNumber: '201',
    unitType: '2 BHK',
    zones: {
      hall_flooring: { status: 'prechecking', sqft: 250 },
      dado: { status: 'cleaning_in_progress', sqft: 180 },
      balcony_flooring: { status: 'cleaning_done', sqft: 90 },
      utility_flooring: { status: 'not_started', sqft: 55 },
    },
    createdAt: '2026-11-16T00:00:00Z',
    updatedAt: '2026-11-16T00:00:00Z',
  };

  const p = calculateFlatProgress(flat, []);
  assert.equal(p.totalZones, 4);
  assert.equal(p.precheckingCount, 1);
  assert.equal(p.cleaningInProgressCount, 1);
  assert.equal(p.cleaningDoneCount, 1);
  assert.equal(p.inProgressCount, 1);
  assert.equal(p.completedCount, 1);
  assert.equal(p.notStartedCount, 1);
  assert.equal(p.completedSqft, 90);
});

test('addCustomZoneToFlatsBatch adds custom area to every flat on matching tower and floor only', () => {
  const mkFlat = (id: string, towerId: string, floorNumber: number, unitNumber: string): FlatUnit => ({
    id,
    ownerId: 'u1',
    projectId: 'p1',
    towerId,
    floorNumber,
    unitNumber,
    unitType: '3 BHK',
    zones: { hall_flooring: { status: 'not_started', sqft: 250 } },
    createdAt: '2026-11-16T00:00:00Z',
    updatedAt: '2026-11-16T00:00:00Z',
  });

  const flats: FlatUnit[] = [
    mkFlat('f1', 'twrA', 1, '101'),
    mkFlat('f2', 'twrA', 1, '102'),
    mkFlat('f3', 'twrA', 2, '201'),
    mkFlat('f4', 'twrB', 1, '101'),
  ];

  const res = addCustomZoneToFlatsBatch({
    flats,
    towerId: 'twrA',
    floorNumber: 1,
    label: 'Pooja Room Flooring',
    category: 'Flooring',
    sqft: 64,
    status: 'prechecking',
    updatedDate: '2026-11-18',
    nowIso: '2026-11-18T10:00:00Z',
  });

  assert.equal(res.modifiedCount, 2);
  assert.deepEqual(res.modifiedFlatIds, ['f1', 'f2']);
  assert.equal(res.updatedFlats[0].zones.pooja_room_flooring?.sqft, 64);
  assert.equal(res.updatedFlats[0].zones.pooja_room_flooring?.status, 'prechecking');
  assert.equal(res.updatedFlats[1].zones.pooja_room_flooring?.label, 'Pooja Room Flooring');
  assert.equal(res.updatedFlats[2].zones.pooja_room_flooring, undefined);
  assert.equal(res.updatedFlats[3].zones.pooja_room_flooring, undefined);
});

test('WHOLE_FLOOR_CUSTOM_PRESETS includes Electrical Room & Corridor Flooring/Skirting presets and batch adds all selected items', () => {
  const labels = WHOLE_FLOOR_CUSTOM_PRESETS.map((p) => p.label);
  for (const required of [
    'Electrical Room Flooring',
    'Electrical Room Skirting',
    'Corridor Flooring',
    'Corridor Skirting',
  ]) {
    assert.ok(labels.includes(required), `Missing whole-floor preset: ${required}`);
  }

  const mkFlat = (id: string, unitNumber: string): FlatUnit => ({
    id,
    ownerId: 'u1',
    projectId: 'p1',
    towerId: 'twrA',
    floorNumber: 5,
    unitNumber,
    unitType: '3 BHK',
    zones: { hall_flooring: { status: 'not_started', sqft: 250 } },
    createdAt: '',
    updatedAt: '',
  });

  const batch = addCustomZonesToFlatsBatch({
    flats: [mkFlat('f1', '501'), mkFlat('f2', '502')],
    towerId: 'twrA',
    floorNumber: 5,
    items: [
      { label: 'Electrical Room Flooring', category: 'Flooring', sqft: 110 },
      { label: 'Electrical Room Skirting', category: 'Skirting', sqft: 42 },
      { label: 'Corridor Flooring', category: 'Common', sqft: 185 },
      { label: 'Corridor Skirting', category: 'Skirting', sqft: 68 },
    ],
    updatedDate: '2026-11-19',
    nowIso: '2026-11-19T10:00:00Z',
  });

  assert.equal(batch.modifiedCount, 2);
  assert.equal(batch.skippedAtLimitCount, 0);
  assert.equal(batch.updatedFlats[0].zones.electrical_room_flooring?.sqft, 110);
  assert.equal(batch.updatedFlats[0].zones.electrical_room_skirting?.category, 'Skirting');
  assert.equal(batch.updatedFlats[1].zones.corridor_flooring?.sqft, 185);
  assert.equal(batch.updatedFlats[1].zones.corridor_skirting?.label, 'Corridor Skirting');
});

test('buildMixedBhkFloorUnits builds mixed 3 BHK + 2 BHK + 4 BHK configurations per floor accurately', () => {
  const specs = buildMixedBhkFloorUnits({
    floorNumber: 3,
    mixedSpecs: [
      { unitType: '3 BHK', count: 3 },
      { unitType: '2 BHK', count: 3 },
      { unitType: '4 BHK', count: 1 },
    ],
  });

  assert.equal(specs.length, 7);
  assert.deepEqual(specs, [
    { unitNumber: '301', unitType: '3 BHK' },
    { unitNumber: '302', unitType: '3 BHK' },
    { unitNumber: '303', unitType: '3 BHK' },
    { unitNumber: '304', unitType: '2 BHK' },
    { unitNumber: '305', unitType: '2 BHK' },
    { unitNumber: '306', unitType: '2 BHK' },
    { unitNumber: '307', unitType: '4 BHK' },
  ]);
});

test('buildWholeFloorCommonZoneItems generates numbered 1 or 2 Electrical Rooms, Lift Lobby, Corridor & custom floor areas', () => {
  const items = buildWholeFloorCommonZoneItems({
    rooms: [
      {
        id: 'electrical_room',
        baseName: 'Electrical Room',
        count: 2,
        includeFlooring: true,
        includeSkirting: true,
        flooringCategory: 'Flooring',
        flooringSqft: 115,
        skirtingSqft: 44,
      },
      {
        id: 'lift_lobby',
        baseName: 'Lift Lobby',
        count: 1,
        includeFlooring: true,
        includeSkirting: true,
        includeDado: true,
        flooringCategory: 'Common',
        flooringSqft: 170,
        skirtingSqft: 54,
        dadoSqft: 95,
      },
      {
        id: 'corridor',
        baseName: 'Corridor',
        count: 1,
        includeFlooring: true,
        includeSkirting: false,
        flooringCategory: 'Common',
        flooringSqft: 190,
        skirtingSqft: 68,
      },
    ],
    extraAreas: [{ label: 'Refuge Terrace Flooring', category: 'Common', sqft: 210 }],
    status: 'not_started',
  });

  assert.deepEqual(
    items.map((i) => `${i.label} (${i.category}:${i.sqft})`),
    [
      'Electrical Room 1 Flooring (Flooring:115)',
      'Electrical Room 1 Skirting (Skirting:44)',
      'Electrical Room 2 Flooring (Flooring:115)',
      'Electrical Room 2 Skirting (Skirting:44)',
      'Lift Lobby Flooring (Common:170)',
      'Lift Lobby Skirting (Skirting:54)',
      'Lift Lobby Dado / Wall (Wall / Wet:95)',
      'Corridor Flooring (Common:190)',
      'Refuge Terrace Flooring (Common:210)',
    ]
  );
});

test('upsertFloorCommonUnitsBatch creates dedicated FL{N}-Common units, merges new rooms without overwriting existing progress, and isolates getEffectiveZonesForFlat', () => {
  assert.equal(formatFloorCommonUnitNumber(1), 'FL1-Common');
  assert.equal(formatFloorCommonUnitNumber(0), 'GF-Common');
  assert.equal(formatFloorCommonUnitNumber(-1), 'B1-Common');
  assert.equal(formatFloorCommonUnitNumber(0.5), 'POD-Common');

  const existingFlat: FlatUnit = {
    id: 'flat_101',
    ownerId: 'u1',
    projectId: 'p1',
    towerId: 'twrA',
    floorNumber: 1,
    floorLabel: 'Floor 1',
    unitNumber: '101',
    unitType: '3 BHK',
    zones: { hall_flooring: { status: 'not_started', sqft: 280 } },
    createdAt: '2026-11-19T00:00:00Z',
    updatedAt: '2026-11-19T00:00:00Z',
  };

  // First run: 1 Electrical Room + 1 Lift Lobby on Floors 1 & 2
  const firstRun = upsertFloorCommonUnitsBatch({
    existingFlats: [existingFlat],
    ownerId: 'u1',
    projectId: 'p1',
    towerId: 'twrA',
    floorNumbers: [1, 2],
    items: buildWholeFloorCommonZoneItems({
      rooms: [
        {
          id: 'electrical_room',
          baseName: 'Electrical Room',
          count: 1,
          includeFlooring: true,
          includeSkirting: true,
          flooringCategory: 'Flooring',
          flooringSqft: 110,
          skirtingSqft: 40,
        },
        {
          id: 'lift_lobby',
          baseName: 'Lift Lobby',
          count: 1,
          includeFlooring: true,
          includeSkirting: true,
          flooringCategory: 'Common',
          flooringSqft: 165,
          skirtingSqft: 52,
        },
      ],
    }),
    updatedDate: '2026-11-19',
    nowIso: '2026-11-19T10:00:00Z',
  });

  assert.equal(firstRun.createdUnits.length, 2);
  assert.equal(firstRun.createdUnits[0].unitNumber, 'FL1-Common');
  assert.equal(firstRun.createdUnits[0].unitType, FLOOR_COMMON_UNIT_TYPE);
  assert.equal(isFloorCommonUnit(firstRun.createdUnits[0]), true);
  assert.equal(isFloorCommonUnit(existingFlat), false);

  // Common unit should NOT include 13 residential bedroom zones
  const effectiveCommonZones = getEffectiveZonesForFlat(firstRun.createdUnits[0], TILE_ZONES);
  assert.equal(effectiveCommonZones.length, 4);
  assert.ok(!effectiveCommonZones.some((z) => z.key === 'master_bedroom_flooring'));

  // Simulate Electrical Room Flooring marked completed on Floor 1, then add Electrical Room 2
  const fl1Completed = firstRun.nextFlats.map((f) =>
    f.unitNumber === 'FL1-Common'
      ? {
          ...f,
          zones: {
            ...f.zones,
            electrical_room_flooring: {
              ...f.zones.electrical_room_flooring,
              status: 'completed' as const,
            },
          },
        }
      : f
  );

  const secondRun = upsertFloorCommonUnitsBatch({
    existingFlats: fl1Completed,
    ownerId: 'u1',
    projectId: 'p1',
    towerId: 'twrA',
    floorNumbers: [1],
    items: [
      { label: 'Electrical Room Flooring', category: 'Flooring', sqft: 110 },
      { label: 'Electrical Room 2 Flooring', category: 'Flooring', sqft: 110 },
      { label: 'Electrical Room 2 Skirting', category: 'Skirting', sqft: 40 },
    ],
    updatedDate: '2026-11-19',
    nowIso: '2026-11-19T11:00:00Z',
  });

  assert.equal(secondRun.createdUnits.length, 0);
  assert.equal(secondRun.updatedUnits.length, 1);
  assert.equal(secondRun.skippedExistingCount, 1);
  const updatedFl1 = secondRun.updatedUnits[0];
  assert.equal(updatedFl1.zones.electrical_room_flooring?.status, 'completed');
  assert.equal(updatedFl1.zones.electrical_room_2_flooring?.label, 'Electrical Room 2 Flooring');
  assert.equal(updatedFl1.zones.electrical_room_2_skirting?.category, 'Skirting');
});

test('buildOrderedSlotFloorUnits supports 5 BHK and exact Tower 1 (8 flats) & Tower 2 (4 flats) presets up to floor 45', () => {
  assert.ok(RESIDENTIAL_BHK_TYPES.includes('5 BHK'));
  const t1Preset = FLOOR_LAYOUT_PRESETS.find((p) => p.id === 'tower_1_8_mixed')!;
  const t2Preset = FLOOR_LAYOUT_PRESETS.find((p) => p.id === 'tower_2_4_mixed')!;

  const t1Floor1 = buildOrderedSlotFloorUnits({
    floorNumber: 1,
    slotUnitTypes: t1Preset.slotUnitTypes,
  });
  assert.deepEqual(t1Floor1, [
    { unitNumber: '101', unitType: '3 BHK' },
    { unitNumber: '102', unitType: '3 BHK' },
    { unitNumber: '103', unitType: '2 BHK' },
    { unitNumber: '104', unitType: '2 BHK' },
    { unitNumber: '105', unitType: '2 BHK' },
    { unitNumber: '106', unitType: '2 BHK' },
    { unitNumber: '107', unitType: '3 BHK' },
    { unitNumber: '108', unitType: '3 BHK' },
  ]);

  const t1Floor45 = buildOrderedSlotFloorUnits({
    floorNumber: 45,
    slotUnitTypes: t1Preset.slotUnitTypes,
  });
  assert.equal(t1Floor45[0].unitNumber, '4501');
  assert.equal(t1Floor45[0].unitType, '3 BHK');
  assert.equal(t1Floor45[3].unitNumber, '4504');
  assert.equal(t1Floor45[3].unitType, '2 BHK');
  assert.equal(t1Floor45[7].unitNumber, '4508');
  assert.equal(t1Floor45[7].unitType, '3 BHK');

  const t2Floor45 = buildOrderedSlotFloorUnits({
    floorNumber: 45,
    slotUnitTypes: t2Preset.slotUnitTypes,
  });
  assert.deepEqual(t2Floor45, [
    { unitNumber: '4501', unitType: '4 BHK' },
    { unitNumber: '4502', unitType: '3 BHK' },
    { unitNumber: '4503', unitType: '3 BHK' },
    { unitNumber: '4504', unitType: '4 BHK' },
  ]);

  const fiveBhkFloor = buildOrderedSlotFloorUnits({
    floorNumber: 12,
    slotUnitTypes: ['5 BHK', '4 BHK', '5 BHK'],
  });
  assert.deepEqual(fiveBhkFloor, [
    { unitNumber: '1201', unitType: '5 BHK' },
    { unitNumber: '1202', unitType: '4 BHK' },
    { unitNumber: '1203', unitType: '5 BHK' },
  ]);
});

test('collectOpenZoneIssuesForFlats filters open remarks & voice notes for supervisor alert and assigned worker popup', () => {
  const flats: FlatUnit[] = [
    {
      id: 'f101',
      ownerId: 'u1',
      projectId: 'p1',
      towerId: 't1',
      floorNumber: 1,
      floorLabel: 'Floor 1',
      unitNumber: '101',
      unitType: '3 BHK',
      zones: {
        hall_flooring: {
          status: 'in_progress',
          sqft: 280,
          assignedEmployeeId: 'emp1',
          assignedEmployeeName: 'Raju',
          notes: 'Check corner tile hollowness',
          voiceNoteTranscript: 'Re-bed corner tile before grouting',
          issueStatus: 'open',
          issueReportedAt: '2026-11-22T09:00:00Z',
        },
        dado: {
          status: 'completed',
          sqft: 240,
          assignedEmployeeId: 'emp2',
          notes: 'Fixed spacer gap',
          issueStatus: 'rectified',
          rectifiedAt: '2026-11-22T10:00:00Z',
        },
      },
      createdAt: '',
      updatedAt: '',
    },
  ];
  const projects = [{ id: 'p1', ownerId: 'u1', name: 'Skyline', location: 'Hyd', clientName: 'C1', status: 'active' as const, createdAt: '', updatedAt: '' }];
  const towers = [{ id: 't1', ownerId: 'u1', projectId: 'p1', name: 'Tower A', totalFloors: 10, unitsPerFloor: 4, createdAt: '', updatedAt: '' }];

  const allOpen = collectOpenZoneIssuesForFlats({ flats, projects, towers });
  assert.equal(allOpen.length, 1);
  assert.equal(allOpen[0].zoneKey, 'hall_flooring');
  assert.equal(allOpen[0].voiceNoteTranscript, 'Re-bed corner tile before grouting');

  const emp1Open = collectOpenZoneIssuesForFlats({ flats, projects, towers, employeeId: 'emp1' });
  assert.equal(emp1Open.length, 1);
  const emp2Open = collectOpenZoneIssuesForFlats({ flats, projects, towers, employeeId: 'emp2' });
  assert.equal(emp2Open.length, 0);
});





