import type { Employee, FlatUnit, Project, Tower } from '../types/avy';
import { formatFloorLabel } from './tileZones';

export type GlobalSearchEntityType = 'project' | 'employee' | 'flat';

export interface GlobalSearchResultItem {
  key: string;
  type: GlobalSearchEntityType;
  id: string;
  title: string;
  code: string;
  subtitle: string;
  projectId?: string;
  towerId?: string;
  flatId?: string;
  employeeId?: string;
  score: number;
}

export interface GlobalSearchResultGroup {
  query: string;
  totalCount: number;
  projects: GlobalSearchResultItem[];
  employees: GlobalSearchResultItem[];
  flats: GlobalSearchResultItem[];
  ordered: GlobalSearchResultItem[];
}

function scoreMatch(queryLower: string, fields: Array<{ value?: string; weight: number }>): number {
  if (!queryLower) return 0;
  let best = 0;

  for (const field of fields) {
    const val = (field.value || '').trim().toLowerCase();
    if (!val) continue;
    if (val === queryLower) {
      best = Math.max(best, 1000 + field.weight);
    } else if (val.startsWith(queryLower)) {
      best = Math.max(best, 700 + field.weight);
    } else {
      const idx = val.indexOf(queryLower);
      if (idx >= 0) {
        best = Math.max(best, 400 + field.weight - Math.min(idx, 50));
      }
    }
  }

  return best;
}

export function searchWorkspaceEntities(params: {
  query: string;
  projects: Project[];
  towers: Tower[];
  flats: FlatUnit[];
  employees: Employee[];
  limitPerGroup?: number;
}): GlobalSearchResultGroup {
  const rawQuery = params.query.trim();
  const limitPerGroup = Math.max(1, params.limitPerGroup ?? 6);
  if (!rawQuery) {
    return {
      query: '',
      totalCount: 0,
      projects: [],
      employees: [],
      flats: [],
      ordered: [],
    };
  }

  const q = rawQuery.toLowerCase();
  const projectMap = new Map(params.projects.map((p) => [p.id, p]));
  const towerMap = new Map(params.towers.map((t) => [t.id, t]));

  const matchedProjects: GlobalSearchResultItem[] = [];
  for (const proj of params.projects) {
    const score = scoreMatch(q, [
      { value: proj.id, weight: 90 },
      { value: proj.name, weight: 85 },
      { value: proj.clientName, weight: 50 },
      { value: proj.location, weight: 45 },
      { value: proj.managerName, weight: 30 },
    ]);
    if (score > 0) {
      const towerCount = params.towers.filter((t) => t.projectId === proj.id).length;
      matchedProjects.push({
        key: `project:${proj.id}`,
        type: 'project',
        id: proj.id,
        title: proj.name,
        code: proj.id,
        subtitle: `${proj.clientName || 'Client'} · ${proj.location || 'Site'} · ${towerCount} Tower${towerCount === 1 ? '' : 's'}`,
        projectId: proj.id,
        score,
      });
    }
  }

  const matchedEmployees: GlobalSearchResultItem[] = [];
  for (const emp of params.employees) {
    const score = scoreMatch(q, [
      { value: emp.empCode, weight: 95 },
      { value: emp.fullName, weight: 85 },
      { value: emp.id, weight: 75 },
      { value: emp.phone, weight: 55 },
      { value: emp.role, weight: 40 },
      { value: emp.currentProjectName, weight: 25 },
      { value: emp.currentTowerName, weight: 25 },
    ]);
    if (score > 0) {
      const siteInfo = emp.currentProjectName
        ? `${emp.currentProjectName}${emp.currentTowerName ? ` (${emp.currentTowerName})` : ''}`
        : 'Unassigned Site';
      matchedEmployees.push({
        key: `employee:${emp.id}`,
        type: 'employee',
        id: emp.id,
        title: emp.fullName,
        code: emp.empCode,
        subtitle: `${emp.role} · ${siteInfo} · ${emp.status === 'active' ? 'Active' : 'Inactive'}`,
        employeeId: emp.id,
        projectId: emp.currentProjectId,
        towerId: emp.currentTowerId,
        score,
      });
    }
  }

  const matchedFlats: GlobalSearchResultItem[] = [];
  for (const flat of params.flats) {
    const proj = projectMap.get(flat.projectId);
    const twr = towerMap.get(flat.towerId);
    const floorLbl = formatFloorLabel(flat.floorNumber, flat.floorLabel);
    const score = scoreMatch(q, [
      { value: flat.unitNumber, weight: 95 },
      { value: flat.id, weight: 90 },
      { value: flat.unitType, weight: 45 },
      { value: floorLbl, weight: 35 },
      { value: twr?.name, weight: 25 },
      { value: proj?.name, weight: 20 },
    ]);
    if (score > 0) {
      matchedFlats.push({
        key: `flat:${flat.id}`,
        type: 'flat',
        id: flat.id,
        title: `Flat / Unit ${flat.unitNumber}`,
        code: flat.id,
        subtitle: `${proj?.name || 'Project'} · ${twr?.name || 'Tower'} · ${floorLbl} · ${flat.unitType}`,
        projectId: flat.projectId,
        towerId: flat.towerId,
        flatId: flat.id,
        score,
      });
    }
  }

  const sortByScoreThenTitle = (a: GlobalSearchResultItem, b: GlobalSearchResultItem) =>
    b.score - a.score || a.title.localeCompare(b.title);

  const projects = matchedProjects.sort(sortByScoreThenTitle).slice(0, limitPerGroup);
  const employees = matchedEmployees.sort(sortByScoreThenTitle).slice(0, limitPerGroup);
  const flats = matchedFlats.sort(sortByScoreThenTitle).slice(0, limitPerGroup);
  const ordered = [...projects, ...employees, ...flats];

  return {
    query: rawQuery,
    totalCount: matchedProjects.length + matchedEmployees.length + matchedFlats.length,
    projects,
    employees,
    flats,
    ordered,
  };
}
