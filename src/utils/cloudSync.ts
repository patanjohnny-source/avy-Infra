import { getTodayIso } from '../data/seedData';
import type { WorkspaceSnapshot } from '../data/seedData';
import { clampString, sanitizeId, stripUndefinedDeep } from '../lib/firebase';
import type { FlatUnit, TileZoneState } from '../types/avy';
import { TILE_ZONES } from './tileZones';
import { DEFAULT_WEEKLY_EXPENSE_BUDGET } from './operations';

export function buildUidNamespacePrefix(uid: string): string {
  const cleanUid = sanitizeId(uid).slice(0, 10) || 'user';
  return `u_${cleanUid}`;
}

export function namespaceDocId(uid: string, rawId: string): string {
  const cleanRaw = sanitizeId(rawId);
  const prefix = buildUidNamespacePrefix(uid);
  if (cleanRaw.startsWith(`${prefix}_`)) {
    return cleanRaw.slice(0, 120);
  }
  return sanitizeId(`${prefix}_${cleanRaw}`).slice(0, 120);
}

function ensureMinString(val: string | undefined, minLen: number, maxLen: number, fallback: string): string {
  const clamped = clampString(val, maxLen);
  return clamped.length >= minLen ? clamped : fallback.slice(0, maxLen);
}

export interface CloudSeedPayload {
  companyProfile: {
    docId: string;
    ownerId: string;
    mutable: Record<string, unknown>;
  };
  projects: Array<{ id: string; data: Record<string, unknown> }>;
  employees: Array<{ id: string; data: Record<string, unknown> }>;
  towers: Array<{ id: string; data: Record<string, unknown> }>;
  flats: Array<{ id: string; data: Record<string, unknown> }>;
  employeeDocuments: Array<{ id: string; data: Record<string, unknown> }>;
  deployments: Array<{ id: string; data: Record<string, unknown> }>;
  assignments: Array<{ id: string; data: Record<string, unknown> }>;
  attendance: Array<{ id: string; data: Record<string, unknown> }>;
  advances: Array<{ id: string; data: Record<string, unknown> }>;
  expenses: Array<{ id: string; data: Record<string, unknown> }>;
  settlements: Array<{ id: string; data: Record<string, unknown> }>;
  dailySiteLogs: Array<{ id: string; data: Record<string, unknown> }>;
  billingDocuments: Array<{ id: string; data: Record<string, unknown> }>;
  companyDocuments: Array<{ id: string; data: Record<string, unknown> }>;
}

export function buildNamespacedCloudSeedPayload(
  uid: string,
  source: WorkspaceSnapshot,
  defaults: {
    adminUsername: string;
    adminPassword: string;
    adminEditPin: string;
    userPin: string;
  }
): CloudSeedPayload {
  const today = getTodayIso();
  const mapId = (raw: string) => namespaceDocId(uid, raw);

  const validProjectIds = new Set(source.projects.map((p) => p.id));
  const validTowerIds = new Set(
    source.towers.filter((t) => validProjectIds.has(t.projectId)).map((t) => t.id)
  );
  const validFlatIds = new Set(
    source.flats
      .filter((f) => validProjectIds.has(f.projectId) && validTowerIds.has(f.towerId))
      .map((f) => f.id)
  );
  const validEmployeeIds = new Set(source.employees.map((e) => e.id));

  const cp = source.companyProfile;
  const catalog =
    cp?.tileZoneCatalog && cp.tileZoneCatalog.length > 0 ? cp.tileZoneCatalog : TILE_ZONES;

  const companyProfile = {
    docId: sanitizeId(`company_${uid}`),
    ownerId: uid,
    mutable: stripUndefinedDeep({
      companyName: ensureMinString(cp?.companyName, 1, 120, 'AVY INFRA'),
      tagline: clampString(cp?.tagline, 160),
      address: clampString(cp?.address, 300),
      hrContact: clampString(cp?.hrContact, 40),
      hrEmail: clampString(cp?.hrEmail, 120),
      gstNumber: clampString(cp?.gstNumber, 40),
      pfEstCode: clampString(cp?.pfEstCode, 60),
      esiCode: clampString(cp?.esiCode, 60),
      signatoryName: clampString(cp?.signatoryName, 100),
      logoDataUrl: (cp?.logoDataUrl || '').slice(0, 120000),
      requireFinishBeforeNewWork: cp?.requireFinishBeforeNewWork !== false,
      adminUsername: clampString(cp?.adminUsername || defaults.adminUsername, 60),
      adminPassword: clampString(cp?.adminPassword || defaults.adminPassword, 80),
      adminEditPin: clampString(cp?.adminEditPin || defaults.adminEditPin, 24),
      supervisorCanEditAttendance: Boolean(cp?.supervisorCanEditAttendance),
      customAdvanceCategories: Array.isArray(cp?.customAdvanceCategories)
        ? cp.customAdvanceCategories.map((c) => clampString(c, 60)).filter(Boolean).slice(0, 30)
        : [],
      customExpenseCategories: Array.isArray(cp?.customExpenseCategories)
        ? cp.customExpenseCategories.map((c) => clampString(c, 60)).filter(Boolean).slice(0, 30)
        : [],
      weeklyExpenseBudget:
        typeof cp?.weeklyExpenseBudget === 'number' && Number.isFinite(cp.weeklyExpenseBudget)
          ? Math.max(0, Math.min(100000000, Math.round(cp.weeklyExpenseBudget)))
          : DEFAULT_WEEKLY_EXPENSE_BUDGET,
      idCardFrontBgDataUrl: (cp?.idCardFrontBgDataUrl || '').slice(0, 120000),
      idCardBackBgDataUrl: (cp?.idCardBackBgDataUrl || '').slice(0, 120000),
      idCardBgColor: clampString(cp?.idCardBgColor || '#ffffff', 24),
      idCardHeaderColor: clampString(cp?.idCardHeaderColor || '#0f172a', 24),
      idCardAccentColor: clampString(cp?.idCardAccentColor || '#c2410c', 24),
      idCardTextColor: clampString(cp?.idCardTextColor || '#0f172a', 24),
      idCardBgOpacity:
        typeof cp?.idCardBgOpacity === 'number' && Number.isFinite(cp.idCardBgOpacity)
          ? Math.max(0, Math.min(1, cp.idCardBgOpacity))
          : 0.22,
      tileZoneCatalog: stripUndefinedDeep(catalog).slice(0, 40),
    }),
  };

  const projects = source.projects.map((p) => ({
    id: mapId(p.id),
    data: stripUndefinedDeep({
      ownerId: uid,
      name: ensureMinString(p.name, 1, 120, 'Site Project'),
      location: clampString(p.location, 160),
      clientName: clampString(p.clientName, 120),
      status: p.status,
      startDate: clampString(p.startDate, 24),
      finishDate: clampString(p.finishDate, 24),
      managerName: clampString(p.managerName, 100),
      managerPhone: clampString(p.managerPhone, 24),
      engineerName: clampString(p.engineerName, 100),
      engineerPhone: clampString(p.engineerPhone, 24),
    }),
  }));

  const employees = source.employees.map((e) => {
    const mappedProjId =
      e.currentProjectId && validProjectIds.has(e.currentProjectId)
        ? mapId(e.currentProjectId)
        : '';
    const mappedTowerId =
      e.currentTowerId && validTowerIds.has(e.currentTowerId)
        ? mapId(e.currentTowerId)
        : '';
    const mappedAssignedTowers = Array.isArray(e.assignedTowerIds)
      ? e.assignedTowerIds
          .filter((tid) => validTowerIds.has(tid))
          .map((tid) => mapId(tid))
          .slice(0, 30)
      : [];

    return {
      id: mapId(e.id),
      data: stripUndefinedDeep({
        ownerId: uid,
        empCode: ensureMinString(sanitizeId(e.empCode), 3, 32, 'AVY-EMP'),
        fullName: ensureMinString(e.fullName, 1, 100, 'Site Worker'),
        role: e.role,
        phone: ensureMinString(e.phone, 7, 24, '9000000000'),
        alternatePhone: clampString(e.alternatePhone, 24),
        email: clampString(e.email, 120),
        joiningDate: ensureMinString(e.joiningDate, 8, 24, today),
        dailyRate: Math.max(0, Math.min(100000, Number(e.dailyRate) || 0)),
        overtimeRate: Math.max(0, Math.min(50000, Number(e.overtimeRate) || 0)),
        foodAllowanceDaily: Math.max(0, Math.min(10000, Number(e.foodAllowanceDaily) || 0)),
        aadharRef: clampString(e.aadharRef, 40),
        pfNumber: clampString(e.pfNumber, 60),
        esiNumber: clampString(e.esiNumber, 60),
        bloodGroup: clampString(e.bloodGroup, 12),
        emergencyContact: clampString(e.emergencyContact, 120),
        photoDataUrl: (e.photoDataUrl || '').slice(0, 120000),
        currentProjectId: mappedProjId,
        currentProjectName: mappedProjId ? clampString(e.currentProjectName, 120) : '',
        currentTowerId: mappedTowerId,
        currentTowerName: mappedTowerId ? clampString(e.currentTowerName, 80) : '',
        assignedTowerIds: mappedAssignedTowers,
        loginPin: clampString(e.loginPin || defaults.userPin, 24),
        qrToken: clampString(e.qrToken, 48),
        status: e.status,
        notes: clampString(e.notes, 400),
      }),
    };
  });

  const towers = source.towers
    .filter((t) => validProjectIds.has(t.projectId))
    .map((t) => ({
      id: mapId(t.id),
      data: stripUndefinedDeep({
        ownerId: uid,
        projectId: mapId(t.projectId),
        name: ensureMinString(t.name, 1, 80, 'Tower'),
        totalFloors: Math.min(180, Math.max(1, Number(t.totalFloors) || 1)),
        unitsPerFloor: Math.min(50, Math.max(1, Number(t.unitsPerFloor) || 1)),
        startDate: clampString(t.startDate, 24),
        finishDate: clampString(t.finishDate, 24),
        inchargeName: clampString(t.inchargeName, 100),
        inchargePhone: clampString(t.inchargePhone, 24),
        supervisorName: clampString(t.supervisorName, 100),
        supervisorPhone: clampString(t.supervisorPhone, 24),
        engineerName: clampString(t.engineerName, 100),
        engineerPhone: clampString(t.engineerPhone, 24),
        managerName: clampString(t.managerName, 100),
        managerPhone: clampString(t.managerPhone, 24),
      }),
    }));

  const flats = source.flats
    .filter((f) => validProjectIds.has(f.projectId) && validTowerIds.has(f.towerId))
    .map((f) => {
      const remappedZones: FlatUnit['zones'] = {};
      const entries = Object.entries(f.zones || {}).slice(0, 40);
      for (const [zKey, zVal] of entries) {
        if (!zVal) continue;
        const nextZone: TileZoneState = { ...zVal };
        if (nextZone.assignedEmployeeId && validEmployeeIds.has(nextZone.assignedEmployeeId)) {
          nextZone.assignedEmployeeId = mapId(nextZone.assignedEmployeeId);
        }
        remappedZones[zKey] = nextZone;
      }

      return {
        id: mapId(f.id),
        data: stripUndefinedDeep({
          ownerId: uid,
          projectId: mapId(f.projectId),
          towerId: mapId(f.towerId),
          floorNumber: Math.min(150, Math.max(-10, Number(f.floorNumber) || 0)),
          floorLabel: clampString(f.floorLabel || `Floor ${f.floorNumber}`, 60),
          unitNumber: ensureMinString(f.unitNumber, 1, 24, 'Unit'),
          unitType: ensureMinString(f.unitType, 1, 40, '3 BHK'),
          zones: stripUndefinedDeep(remappedZones),
        }),
      };
    });

  const employeeDocuments = (source.employeeDocuments || [])
    .filter(
      (d) =>
        validEmployeeIds.has(d.employeeId) &&
        d.sizeBytes >= 1 &&
        d.sizeBytes <= 600000 &&
        Boolean(d.dataUrl) &&
        d.dataUrl.length <= 850000
    )
    .map((d) => ({
      id: mapId(d.id),
      data: stripUndefinedDeep({
        ownerId: uid,
        employeeId: mapId(d.employeeId),
        docCategory: d.docCategory,
        title: ensureMinString(d.title, 1, 100, 'Document'),
        fileName: ensureMinString(d.fileName, 1, 160, 'document.pdf'),
        mimeType: ensureMinString(d.mimeType, 1, 80, 'application/pdf'),
        sizeBytes: d.sizeBytes,
        dataUrl: d.dataUrl,
      }),
    }));

  const deployments = source.deployments
    .filter(
      (d) =>
        validEmployeeIds.has(d.employeeId) &&
        validProjectIds.has(d.projectId) &&
        validTowerIds.has(d.towerId)
    )
    .map((d) => ({
      id: mapId(d.id),
      data: stripUndefinedDeep({
        ownerId: uid,
        employeeId: mapId(d.employeeId),
        empCode: ensureMinString(d.empCode, 1, 32, 'EMP'),
        employeeName: ensureMinString(d.employeeName, 1, 100, 'Worker'),
        employeeRole: ensureMinString(d.employeeRole, 1, 40, 'Mason'),
        projectId: mapId(d.projectId),
        projectName: ensureMinString(d.projectName, 1, 120, 'Project'),
        towerId: mapId(d.towerId),
        towerName: ensureMinString(d.towerName, 1, 80, 'Tower'),
        fromProjectName: clampString(d.fromProjectName, 120),
        fromTowerName: clampString(d.fromTowerName, 80),
        assignedDate: ensureMinString(d.assignedDate, 8, 24, today),
        notes: clampString(d.notes, 300),
      }),
    }));

  const assignments = source.assignments
    .filter(
      (a) =>
        validProjectIds.has(a.projectId) &&
        validTowerIds.has(a.towerId) &&
        validFlatIds.has(a.flatId) &&
        validEmployeeIds.has(a.employeeId)
    )
    .map((a) => ({
      id: mapId(a.id),
      data: stripUndefinedDeep({
        ownerId: uid,
        projectId: mapId(a.projectId),
        projectName: ensureMinString(a.projectName, 1, 120, 'Project'),
        towerId: mapId(a.towerId),
        towerName: ensureMinString(a.towerName, 1, 80, 'Tower'),
        flatId: mapId(a.flatId),
        unitNumber: ensureMinString(a.unitNumber, 1, 24, 'Unit'),
        zoneKey: ensureMinString(a.zoneKey, 1, 64, 'hall_flooring'),
        zoneLabel: ensureMinString(a.zoneLabel, 1, 80, 'Hall Flooring'),
        employeeId: mapId(a.employeeId),
        empCode: ensureMinString(a.empCode, 1, 32, 'EMP'),
        employeeName: ensureMinString(a.employeeName, 1, 100, 'Worker'),
        employeeRole: ensureMinString(a.employeeRole, 1, 40, 'Mason'),
        assignedDate: ensureMinString(a.assignedDate, 8, 24, today),
        completedDate: clampString(a.completedDate, 24),
        targetSqft: Math.max(0, Math.min(100000, Number(a.targetSqft) || 0)),
        status: a.status,
        notes: clampString(a.notes, 400),
      }),
    }));

  const attendance = source.attendance
    .filter((att) => validEmployeeIds.has(att.employeeId))
    .map((att) => ({
      id: mapId(att.id),
      data: stripUndefinedDeep({
        ownerId: uid,
        date: ensureMinString(att.date, 8, 24, today),
        employeeId: mapId(att.employeeId),
        empCode: ensureMinString(att.empCode, 1, 32, 'EMP'),
        employeeName: ensureMinString(att.employeeName, 1, 100, 'Worker'),
        employeeRole: ensureMinString(att.employeeRole, 1, 40, 'Mason'),
        projectId: att.projectId && validProjectIds.has(att.projectId) ? mapId(att.projectId) : '',
        projectName: clampString(att.projectName, 120),
        towerId: att.towerId && validTowerIds.has(att.towerId) ? mapId(att.towerId) : '',
        towerName: clampString(att.towerName, 80),
        status: att.status,
        overtimeHours: Math.max(0, Math.min(24, Number(att.overtimeHours) || 0)),
        dailyWageEarned: Math.max(0, Math.min(100000, Number(att.dailyWageEarned) || 0)),
        overtimePayEarned: Math.max(0, Math.min(100000, Number(att.overtimePayEarned) || 0)),
        notes: clampString(att.notes, 300),
        ...(att.markedByRole === 'admin' || att.markedByRole === 'supervisor'
          ? { markedByRole: att.markedByRole }
          : {}),
        ...(att.markedByName !== undefined ? { markedByName: clampString(att.markedByName, 100) } : {}),
        ...(att.editedByName !== undefined ? { editedByName: clampString(att.editedByName, 100) } : {}),
        ...(att.editedAt !== undefined ? { editedAt: clampString(att.editedAt, 40) } : {}),
        ...(att.editReason !== undefined ? { editReason: clampString(att.editReason, 300) } : {}),
      }),
    }));

  const advances = source.advances
    .filter((adv) => validEmployeeIds.has(adv.employeeId))
    .map((adv) => ({
      id: mapId(adv.id),
      data: stripUndefinedDeep({
        ownerId: uid,
        date: ensureMinString(adv.date, 8, 24, today),
        employeeId: mapId(adv.employeeId),
        empCode: ensureMinString(adv.empCode, 1, 32, 'EMP'),
        employeeName: ensureMinString(adv.employeeName, 1, 100, 'Worker'),
        employeePhone: clampString(adv.employeePhone, 24),
        projectId: adv.projectId && validProjectIds.has(adv.projectId) ? mapId(adv.projectId) : '',
        projectName: clampString(adv.projectName, 120),
        towerId: adv.towerId && validTowerIds.has(adv.towerId) ? mapId(adv.towerId) : '',
        towerName: clampString(adv.towerName, 80),
        isSundayRun: Boolean(adv.isSundayRun),
        advanceType: adv.advanceType,
        ...(adv.customCategory ? { customCategory: clampString(adv.customCategory, 60) } : {}),
        amount: Math.min(1000000, Math.max(1, Number(adv.amount) || 1)),
        paymentMode: adv.paymentMode,
        ...(adv.paymentApp ? { paymentApp: clampString(adv.paymentApp, 40) } : {}),
        ...(adv.transactionId ? { transactionId: clampString(adv.transactionId, 100) } : {}),
        ...(adv.upiId ? { upiId: clampString(adv.upiId, 120) } : {}),
        ...(adv.proofImageDataUrl ? { proofImageDataUrl: adv.proofImageDataUrl.slice(0, 240000) } : {}),
        notes: clampString(adv.notes, 300),
        whatsappShared: Boolean(adv.whatsappShared),
      }),
    }));

  const expenses = (source.expenses || [])
    .filter((exp) => validProjectIds.has(exp.projectId))
    .map((exp) => ({
      id: mapId(exp.id),
      data: stripUndefinedDeep({
        ownerId: uid,
        date: ensureMinString(exp.date, 8, 24, today),
        projectId: mapId(exp.projectId),
        projectName: ensureMinString(exp.projectName, 1, 120, 'Project'),
        towerId: exp.towerId && validTowerIds.has(exp.towerId) ? mapId(exp.towerId) : '',
        towerName: clampString(exp.towerName, 80),
        category: exp.category,
        ...(exp.customCategory ? { customCategory: clampString(exp.customCategory, 60) } : {}),
        description: ensureMinString(exp.description, 1, 160, 'Site Expense'),
        vendorName: clampString(exp.vendorName, 100),
        amount: Math.min(100000000, Math.max(1, Number(exp.amount) || 1)),
        paymentMode: exp.paymentMode,
        ...(exp.paymentApp ? { paymentApp: clampString(exp.paymentApp, 40) } : {}),
        ...(exp.transactionId ? { transactionId: clampString(exp.transactionId, 100) } : {}),
        ...(exp.upiId ? { upiId: clampString(exp.upiId, 120) } : {}),
        ...(exp.proofImageDataUrl ? { proofImageDataUrl: exp.proofImageDataUrl.slice(0, 240000) } : {}),
        notes: clampString(exp.notes, 300),
      }),
    }));

  const settlements = (source.settlements || [])
    .filter((s) => validEmployeeIds.has(s.employeeId))
    .map((s) => ({
      id: mapId(s.id),
      data: stripUndefinedDeep({
        ownerId: uid,
        employeeId: mapId(s.employeeId),
        empCode: ensureMinString(s.empCode, 1, 32, 'EMP'),
        employeeName: ensureMinString(s.employeeName, 1, 100, 'Worker'),
        periodStart: ensureMinString(s.periodStart, 8, 24, today),
        periodEnd: ensureMinString(s.periodEnd, 8, 24, today),
        daysWorked: Math.max(0, Math.min(366, Number(s.daysWorked) || 0)),
        grossWages: Math.max(0, Math.min(10000000, Number(s.grossWages) || 0)),
        overtimePay: Math.max(0, Math.min(10000000, Number(s.overtimePay) || 0)),
        totalAdvances: Math.max(0, Math.min(10000000, Number(s.totalAdvances) || 0)),
        netPaid: Math.max(-10000000, Math.min(10000000, Number(s.netPaid) || 0)),
        paymentMode: s.paymentMode,
        ...(s.paymentApp ? { paymentApp: clampString(s.paymentApp, 40) } : {}),
        ...(s.transactionId ? { transactionId: clampString(s.transactionId, 100) } : {}),
        ...(s.upiId ? { upiId: clampString(s.upiId, 120) } : {}),
        ...(s.proofImageDataUrl ? { proofImageDataUrl: s.proofImageDataUrl.slice(0, 240000) } : {}),
        settledDate: ensureMinString(s.settledDate, 8, 24, today),
        notes: clampString(s.notes, 300),
      }),
    }));

  const dailySiteLogs = (source.dailySiteLogs || [])
    .filter((l) => validProjectIds.has(l.projectId) && validTowerIds.has(l.towerId))
    .map((l) => ({
      id: mapId(l.id),
      data: stripUndefinedDeep({
        ownerId: uid,
        date: ensureMinString(l.date, 8, 24, today),
        projectId: mapId(l.projectId),
        projectName: ensureMinString(l.projectName, 1, 120, 'Project'),
        towerId: mapId(l.towerId),
        towerName: ensureMinString(l.towerName, 1, 80, 'Tower'),
        notes: ensureMinString(l.notes, 1, 600, 'Site progress log'),
        ...(l.photoDataUrl ? { photoDataUrl: l.photoDataUrl.slice(0, 240000) } : {}),
        loggedByRole: l.loggedByRole === 'supervisor' ? 'supervisor' : 'admin',
        loggedByName: ensureMinString(l.loggedByName, 1, 100, 'Site Staff'),
        ...(l.loggedByEmployeeId && validEmployeeIds.has(l.loggedByEmployeeId)
          ? { loggedByEmployeeId: mapId(l.loggedByEmployeeId) }
          : {}),
      }),
    }));

  const billingDocuments = (source.billingDocuments || [])
    .filter((b) => Array.isArray(b.items) && b.items.length >= 1)
    .map((b) => ({
      id: mapId(b.id),
      data: stripUndefinedDeep({
        ownerId: uid,
        docType: b.docType,
        docNumber: ensureMinString(b.docNumber, 1, 48, 'DOC-0001'),
        issueDate: ensureMinString(b.issueDate, 8, 24, today),
        dueDate: clampString(b.dueDate, 24),
        projectId: b.projectId && validProjectIds.has(b.projectId) ? mapId(b.projectId) : '',
        projectName: clampString(b.projectName, 120),
        towerId: b.towerId && validTowerIds.has(b.towerId) ? mapId(b.towerId) : '',
        towerName: clampString(b.towerName, 80),
        clientName: ensureMinString(b.clientName, 1, 140, 'Client'),
        clientPhone: clampString(b.clientPhone, 24),
        clientEmail: clampString(b.clientEmail, 120),
        clientAddress: clampString(b.clientAddress, 300),
        clientGstin: clampString(b.clientGstin, 32),
        placeOfSupply: clampString(b.placeOfSupply, 80),
        taxMode: b.taxMode,
        items: stripUndefinedDeep(b.items).slice(0, 50),
        subtotal: Math.max(0, Number(b.subtotal) || 0),
        cgstTotal: Math.max(0, Number(b.cgstTotal) || 0),
        sgstTotal: Math.max(0, Number(b.sgstTotal) || 0),
        igstTotal: Math.max(0, Number(b.igstTotal) || 0),
        roundOff: Number(b.roundOff) || 0,
        grandTotal: Math.max(0, Number(b.grandTotal) || 0),
        amountPaid: Math.max(0, Number(b.amountPaid) || 0),
        status: b.status,
        notes: clampString(b.notes, 500),
        terms: clampString(b.terms, 800),
        whatsappShared: Boolean(b.whatsappShared),
      }),
    }));

  const companyDocuments = (source.companyDocuments || []).map((d) => ({
    id: mapId(d.id),
    data: stripUndefinedDeep({
      ownerId: uid,
      source: d.source,
      docCategory: d.docCategory,
      fileFormat: d.fileFormat,
      title: ensureMinString(d.title, 1, 160, 'Company Document'),
      fileName: ensureMinString(d.fileName, 1, 180, 'document.doc'),
      mimeType: ensureMinString(d.mimeType, 1, 120, 'application/msword'),
      sizeBytes: Math.max(1, Math.min(600000, Number(d.sizeBytes) || 1024)),
      approvalStatus: d.approvalStatus === 'approved' ? 'approved' : 'draft',
      approvedByName: clampString(d.approvedByName, 100),
      approvedAt: clampString(d.approvedAt, 40),
      employeeId:
        d.employeeId && validEmployeeIds.has(d.employeeId) ? mapId(d.employeeId) : '',
      empCode: clampString(d.empCode, 32),
      employeeName: clampString(d.employeeName, 100),
      refNumber: clampString(d.refNumber, 80),
      issueDate: ensureMinString(d.issueDate, 8, 24, today),
      recipient: clampString(d.recipient, 400),
      subject: clampString(d.subject, 240),
      bodyHtml: (d.bodyHtml || '').slice(0, 120000),
      plainTextSummary: (d.plainTextSummary || '').slice(0, 20000),
      deckJson: (d.deckJson || '').slice(0, 150000),
      dataUrl: (d.dataUrl || '').slice(0, 750000),
    }),
  }));

  return {
    companyProfile,
    projects,
    employees,
    towers,
    flats,
    employeeDocuments,
    deployments,
    assignments,
    attendance,
    advances,
    expenses,
    settlements,
    dailySiteLogs,
    billingDocuments,
    companyDocuments,
  };
}
