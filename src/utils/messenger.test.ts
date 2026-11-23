import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedWorkspace } from '../data/seedData';
import type { TeamMessage } from '../types/avy';
import {
  ADMIN_ACTOR_ID,
  TEAM_BROADCAST_THREAD_ID,
  buildDirectThreadId,
  buildMessengerThreadsForSession,
  buildTowerThreadId,
  countUnreadMessengerMessages,
} from './messenger';

test('messenger builds scoped threads and counts unread messages cleanly for admin, supervisor, and employee', () => {
  const seed = createSeedWorkspace('test-owner');
  const adminSession = {
    role: 'admin' as const,
    displayName: 'Admin',
    assignedTowerIds: [],
    loginAt: '2026-11-22T00:00:00Z',
  };
  const supSession = {
    role: 'supervisor' as const,
    displayName: 'Prakash Reddy',
    employeeId: 'emp_avy_sup_005',
    empCode: 'AVY-SUP-005',
    assignedTowerIds: ['twr_skyline_a'],
    loginAt: '2026-11-22T00:00:00Z',
  };
  const empSession = {
    role: 'employee' as const,
    displayName: 'Raju',
    employeeId: 'emp_avy_msn_001',
    empCode: 'AVY-MSN-001',
    assignedTowerIds: ['twr_skyline_a'],
    loginAt: '2026-11-22T00:00:00Z',
  };

  const messages: TeamMessage[] = [
    {
      id: 'm1',
      ownerId: 'test-owner',
      threadId: TEAM_BROADCAST_THREAD_ID,
      channelType: 'broadcast',
      senderId: ADMIN_ACTOR_ID,
      senderName: 'Admin HQ',
      senderRole: 'admin',
      body: 'Safety briefing at 8 AM sharp',
      readByIds: [ADMIN_ACTOR_ID],
      createdAt: '2026-11-22T08:00:00Z',
      updatedAt: '2026-11-22T08:00:00Z',
    },
    {
      id: 'm2',
      ownerId: 'test-owner',
      threadId: buildTowerThreadId('twr_skyline_b'),
      channelType: 'tower',
      towerId: 'twr_skyline_b',
      towerName: 'Tower B',
      senderId: ADMIN_ACTOR_ID,
      senderName: 'Admin HQ',
      senderRole: 'admin',
      body: 'Tower B tile delivery arrived',
      readByIds: [ADMIN_ACTOR_ID],
      createdAt: '2026-11-22T08:05:00Z',
      updatedAt: '2026-11-22T08:05:00Z',
    },
    {
      id: 'm3',
      ownerId: 'test-owner',
      threadId: buildDirectThreadId('emp_avy_sup_005', 'emp_avy_msn_001'),
      channelType: 'direct',
      senderId: 'emp_avy_msn_001',
      senderName: 'Raju',
      senderRole: 'employee',
      recipientId: 'emp_avy_sup_005',
      recipientName: 'Prakash Reddy',
      recipientRole: 'supervisor',
      body: 'Need spacers on Floor 2 Flat 201',
      readByIds: ['emp_avy_msn_001'],
      createdAt: '2026-11-22T08:10:00Z',
      updatedAt: '2026-11-22T08:10:00Z',
    },
  ];

  // Supervisor on Tower A sees broadcast + unread DM from Raju, but NOT Tower B channel message
  const supUnread = countUnreadMessengerMessages({
    session: supSession,
    companyProfile: seed.companyProfile,
    employees: seed.employees,
    messages,
  });
  assert.equal(supUnread, 2); // m1 broadcast + m3 DM (m2 is Tower B)

  const supThreads = buildMessengerThreadsForSession({
    session: supSession,
    companyProfile: seed.companyProfile,
    employees: seed.employees,
    towers: seed.towers,
    messages,
  });
  assert.equal(supThreads.some((t) => t.towerId === 'twr_skyline_b'), false);
  assert.equal(supThreads.some((t) => t.towerId === 'twr_skyline_a'), true);

  // Employee Raju sees broadcast (1 unread) + Tower A channel + Admin HQ DM + Prakash DM
  const empUnread = countUnreadMessengerMessages({
    session: empSession,
    companyProfile: seed.companyProfile,
    employees: seed.employees,
    messages,
  });
  assert.equal(empUnread, 1);

  const empThreads = buildMessengerThreadsForSession({
    session: empSession,
    companyProfile: seed.companyProfile,
    employees: seed.employees,
    towers: seed.towers,
    messages,
  });
  assert.equal(empThreads.some((t) => t.recipientId === ADMIN_ACTOR_ID), true);
  assert.equal(empThreads.some((t) => t.recipientId === 'emp_avy_sup_005'), true);

  // Admin sees all towers & all crew DMs
  const adminThreads = buildMessengerThreadsForSession({
    session: adminSession,
    companyProfile: seed.companyProfile,
    employees: seed.employees,
    towers: seed.towers,
    messages,
  });
  assert.ok(adminThreads.some((t) => t.towerId === 'twr_skyline_b'));
});
