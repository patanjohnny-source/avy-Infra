import type {
  CompanyProfile,
  Employee,
  TeamMessage,
  TeamMessageActorRole,
  Tower,
} from '../types/avy';
import type { WorkspaceSession } from './authAccess';

export const TEAM_BROADCAST_THREAD_ID = 'channel:all';
export const ADMIN_ACTOR_ID = 'admin_hq';

export function buildTowerThreadId(towerId: string): string {
  return `channel:tower:${towerId}`;
}

export function buildDirectThreadId(actorIdA: string, actorIdB: string): string {
  const [first, second] = [actorIdA, actorIdB].sort((a, b) => a.localeCompare(b));
  return `dm:${first}__${second}`;
}

export interface MessengerActor {
  actorId: string;
  name: string;
  role: TeamMessageActorRole;
  empCode?: string;
  towerId?: string;
}

export function resolveSessionMessengerActor(
  session: WorkspaceSession | null,
  companyProfile: CompanyProfile
): MessengerActor | null {
  if (!session) return null;
  if (session.role === 'admin') {
    return {
      actorId: ADMIN_ACTOR_ID,
      name: companyProfile.signatoryName || session.displayName || 'AVY INFRA Admin',
      role: 'admin',
    };
  }
  if (!session.employeeId) return null;
  return {
    actorId: session.employeeId,
    name: session.displayName,
    role: session.role,
    empCode: session.empCode,
    towerId: session.assignedTowerIds?.[0],
  };
}

export interface MessengerThreadDescriptor {
  threadId: string;
  channelType: 'broadcast' | 'tower' | 'direct';
  title: string;
  subtitle: string;
  projectId?: string;
  towerId?: string;
  towerName?: string;
  recipientId?: string;
  recipientName?: string;
  recipientRole?: TeamMessageActorRole;
  unreadCount: number;
  lastMessage?: TeamMessage;
}

export function canActorSeeMessage(params: {
  message: TeamMessage;
  actor: MessengerActor;
  session: WorkspaceSession;
  employees: Employee[];
}): boolean {
  const { message, actor, session, employees } = params;
  if (session.role === 'admin') return true;

  if (message.channelType === 'broadcast') return true;

  if (message.channelType === 'tower') {
    if (session.role === 'supervisor') {
      return Boolean(message.towerId && session.assignedTowerIds.includes(message.towerId));
    }
    const me = employees.find((e) => e.id === actor.actorId);
    const myTowerId = me?.currentTowerId || actor.towerId;
    return Boolean(message.towerId && myTowerId && message.towerId === myTowerId);
  }

  // Direct message: visible only to the two participants
  return message.senderId === actor.actorId || message.recipientId === actor.actorId;
}

export function buildMessengerThreadsForSession(params: {
  session: WorkspaceSession | null;
  companyProfile: CompanyProfile;
  employees: Employee[];
  towers: Tower[];
  messages: TeamMessage[];
}): MessengerThreadDescriptor[] {
  const { session, companyProfile, employees, towers, messages } = params;
  const actor = resolveSessionMessengerActor(session, companyProfile);
  if (!session || !actor) return [];

  const visibleMessages = messages.filter((msg) =>
    canActorSeeMessage({ message: msg, actor, session, employees })
  );

  const byThread = new Map<string, TeamMessage[]>();
  for (const msg of visibleMessages) {
    const arr = byThread.get(msg.threadId) || [];
    arr.push(msg);
    byThread.set(msg.threadId, arr);
  }

  const getThreadStats = (threadId: string) => {
    const list = (byThread.get(threadId) || []).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
    const lastMessage = list[list.length - 1];
    const unreadCount = list.filter(
      (m) => m.senderId !== actor.actorId && !(m.readByIds || []).includes(actor.actorId)
    ).length;
    return { lastMessage, unreadCount };
  };

  const threads: MessengerThreadDescriptor[] = [];

  // 1. All-Sites Broadcast channel
  const bStats = getThreadStats(TEAM_BROADCAST_THREAD_ID);
  threads.push({
    threadId: TEAM_BROADCAST_THREAD_ID,
    channelType: 'broadcast',
    title: 'All Sites & Crew Broadcast',
    subtitle: 'Admin · Supervisors · Site Workforce',
    unreadCount: bStats.unreadCount,
    lastMessage: bStats.lastMessage,
  });

  // 2. Scoped Tower Channels
  const me = employees.find((e) => e.id === actor.actorId);
  const allowedTowers =
    session.role === 'admin'
      ? towers
      : session.role === 'supervisor'
        ? towers.filter((t) => session.assignedTowerIds.includes(t.id))
        : towers.filter((t) => t.id === (me?.currentTowerId || actor.towerId));

  for (const twr of allowedTowers) {
    const threadId = buildTowerThreadId(twr.id);
    const stats = getThreadStats(threadId);
    threads.push({
      threadId,
      channelType: 'tower',
      title: `${twr.name} Crew Channel`,
      subtitle: twr.supervisorName ? `Sup: ${twr.supervisorName}` : 'Tower Channel',
      projectId: twr.projectId,
      towerId: twr.id,
      towerName: twr.name,
      unreadCount: stats.unreadCount,
      lastMessage: stats.lastMessage,
    });
  }

  // 3. Direct Message Peers
  const activeEmps = employees.filter((e) => e.status === 'active');
  if (session.role === 'admin') {
    for (const emp of activeEmps) {
      const dmRole: TeamMessageActorRole =
        emp.role === 'Supervisor' || (emp.assignedTowerIds && emp.assignedTowerIds.length > 0)
          ? 'supervisor'
          : 'employee';
      const threadId = buildDirectThreadId(actor.actorId, emp.id);
      const stats = getThreadStats(threadId);
      threads.push({
        threadId,
        channelType: 'direct',
        title: emp.fullName,
        subtitle: `${emp.role} · ${emp.empCode}${emp.currentTowerName ? ` · ${emp.currentTowerName}` : ''}`,
        recipientId: emp.id,
        recipientName: emp.fullName,
        recipientRole: dmRole,
        projectId: emp.currentProjectId,
        towerId: emp.currentTowerId,
        towerName: emp.currentTowerName,
        unreadCount: stats.unreadCount,
        lastMessage: stats.lastMessage,
      });
    }
  } else if (session.role === 'supervisor') {
    // Direct with Admin HQ
    const adminThreadId = buildDirectThreadId(actor.actorId, ADMIN_ACTOR_ID);
    const adminStats = getThreadStats(adminThreadId);
    threads.push({
      threadId: adminThreadId,
      channelType: 'direct',
      title: companyProfile.signatoryName || 'Admin HQ',
      subtitle: 'Admin Management',
      recipientId: ADMIN_ACTOR_ID,
      recipientName: companyProfile.signatoryName || 'Admin HQ',
      recipientRole: 'admin',
      unreadCount: adminStats.unreadCount,
      lastMessage: adminStats.lastMessage,
    });

    // Direct with assigned tower employees
    const allowedSet = new Set(session.assignedTowerIds);
    const towerCrew = activeEmps.filter(
      (e) => e.id !== actor.actorId && e.currentTowerId && allowedSet.has(e.currentTowerId)
    );
    for (const emp of towerCrew) {
      const dmRole: TeamMessageActorRole =
        emp.role === 'Supervisor' ? 'supervisor' : 'employee';
      const threadId = buildDirectThreadId(actor.actorId, emp.id);
      const stats = getThreadStats(threadId);
      threads.push({
        threadId,
        channelType: 'direct',
        title: emp.fullName,
        subtitle: `${emp.role} · ${emp.empCode}`,
        recipientId: emp.id,
        recipientName: emp.fullName,
        recipientRole: dmRole,
        projectId: emp.currentProjectId,
        towerId: emp.currentTowerId,
        towerName: emp.currentTowerName,
        unreadCount: stats.unreadCount,
        lastMessage: stats.lastMessage,
      });
    }
  } else {
    // Employee: Direct with Admin HQ + Tower Supervisor(s)
    const adminThreadId = buildDirectThreadId(actor.actorId, ADMIN_ACTOR_ID);
    const adminStats = getThreadStats(adminThreadId);
    threads.push({
      threadId: adminThreadId,
      channelType: 'direct',
      title: companyProfile.signatoryName || 'Admin HQ',
      subtitle: 'Company Admin',
      recipientId: ADMIN_ACTOR_ID,
      recipientName: companyProfile.signatoryName || 'Admin HQ',
      recipientRole: 'admin',
      unreadCount: adminStats.unreadCount,
      lastMessage: adminStats.lastMessage,
    });

    const myTowerId = me?.currentTowerId || actor.towerId;
    const supervisors = activeEmps.filter(
      (e) =>
        e.id !== actor.actorId &&
        (e.role === 'Supervisor' ||
          (myTowerId && Array.isArray(e.assignedTowerIds) && e.assignedTowerIds.includes(myTowerId)))
    );
    for (const sup of supervisors) {
      const threadId = buildDirectThreadId(actor.actorId, sup.id);
      const stats = getThreadStats(threadId);
      threads.push({
        threadId,
        channelType: 'direct',
        title: sup.fullName,
        subtitle: `Site Supervisor · ${sup.empCode}`,
        recipientId: sup.id,
        recipientName: sup.fullName,
        recipientRole: 'supervisor',
        projectId: sup.currentProjectId,
        towerId: sup.currentTowerId,
        towerName: sup.currentTowerName,
        unreadCount: stats.unreadCount,
        lastMessage: stats.lastMessage,
      });
    }
  }

  return threads;
}

export function countUnreadMessengerMessages(params: {
  session: WorkspaceSession | null;
  companyProfile: CompanyProfile;
  employees: Employee[];
  messages: TeamMessage[];
}): number {
  const { session, companyProfile, employees, messages } = params;
  const actor = resolveSessionMessengerActor(session, companyProfile);
  if (!session || !actor) return 0;

  return messages.filter(
    (msg) =>
      canActorSeeMessage({ message: msg, actor, session, employees }) &&
      msg.senderId !== actor.actorId &&
      !(msg.readByIds || []).includes(actor.actorId)
  ).length;
}
