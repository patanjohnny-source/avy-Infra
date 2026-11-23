import type { AdvanceApprovalStatus, AdvanceEntry, CompanyProfile } from '../types/avy';
import { formatINR } from './payroll';

export interface WeeklyFoodApprovalBatch {
  batchId: string;
  date: string;
  projectName: string;
  towerName: string;
  submittedByName: string;
  submittedByRole: 'admin' | 'supervisor';
  approvalStatus: AdvanceApprovalStatus;
  entries: AdvanceEntry[];
  totalAmount: number;
  approvedByName?: string;
  approvedAt?: string;
  approvalNote?: string;
}

export function getEffectiveAdvanceApprovalStatus(
  adv: Pick<AdvanceEntry, 'approvalStatus'>
): AdvanceApprovalStatus {
  return adv.approvalStatus || 'approved';
}

export function groupWeeklyFoodApprovalBatches(
  advances: AdvanceEntry[],
  statusFilter?: AdvanceApprovalStatus
): WeeklyFoodApprovalBatch[] {
  const foodEntries = advances.filter(
    (a) => a.advanceType === 'weekly_food' || a.advanceType === 'daily_food'
  );

  const byBatch = new Map<string, AdvanceEntry[]>();
  for (const adv of foodEntries) {
    const status = getEffectiveAdvanceApprovalStatus(adv);
    if (statusFilter && status !== statusFilter) continue;
    const key =
      adv.approvalBatchId?.trim() ||
      `single_${adv.id}`;
    const list = byBatch.get(key) || [];
    list.push(adv);
    byBatch.set(key, list);
  }

  const batches: WeeklyFoodApprovalBatch[] = [];
  for (const [batchId, entries] of byBatch.entries()) {
    const first = entries[0];
    const totalAmount = entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    batches.push({
      batchId,
      date: first.date,
      projectName: first.projectName || 'Project Site',
      towerName: first.towerName || 'All Towers',
      submittedByName: first.submittedByName || 'Site Supervisor',
      submittedByRole: first.submittedByRole || 'supervisor',
      approvalStatus: getEffectiveAdvanceApprovalStatus(first),
      entries: [...entries].sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
      totalAmount,
      approvedByName: first.approvedByName,
      approvedAt: first.approvedAt,
      approvalNote: first.approvalNote,
    });
  }

  return batches.sort((a, b) => b.date.localeCompare(a.date));
}

export function buildWeeklyFoodAdminApprovalWhatsappMessage(params: {
  companyName: string;
  date: string;
  submittedByName: string;
  submittedByRole: 'admin' | 'supervisor';
  siteLabel: string;
  batchId?: string;
  entries: Array<{
    employeeName: string;
    empCode: string;
    amount: number;
    paymentMode: string;
  }>;
}): string {
  const totalAmount = params.entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const lines = [
    `*${params.companyName} — WEEKLY FOOD RUN APPROVAL REQUEST*`,
    `Date: ${params.date}`,
    `Site / Tower: ${params.siteLabel}`,
    `Submitted By: ${params.submittedByName} (${params.submittedByRole.toUpperCase()})`,
    params.batchId ? `Batch Ref: ${params.batchId}` : '',
    `Crew Count: ${params.entries.length} worker(s)`,
    `Total Amount Requested: *${formatINR(totalAmount)}*`,
    ``,
    `*Crew Breakdown:*`,
    ...params.entries.slice(0, 15).map(
      (e, idx) =>
        `${idx + 1}. ${e.employeeName} (${e.empCode}) — ${formatINR(e.amount)} [${e.paymentMode.toUpperCase()}]`
    ),
    params.entries.length > 15 ? `... +${params.entries.length - 15} more workers` : '',
    ``,
    `Please review & APPROVE this Weekly Food Run in the AVY INFRA Admin Dashboard.`,
  ].filter(Boolean);
  return lines.join('\n');
}

export function buildWeeklyFoodDecisionWhatsappMessage(params: {
  companyName: string;
  decision: 'approved' | 'rejected';
  batch: WeeklyFoodApprovalBatch;
  reviewedByName: string;
  note?: string;
}): string {
  const { companyName, decision, batch, reviewedByName, note } = params;
  const statusWord = decision === 'approved' ? 'APPROVED' : 'REJECTED';
  return [
    `*${companyName} — WEEKLY FOOD RUN ${statusWord}*`,
    `Date: ${batch.date} | Site: ${batch.projectName} (${batch.towerName})`,
    `Batch Ref: ${batch.batchId}`,
    `Crew Count: ${batch.entries.length} workers | Total: *${formatINR(batch.totalAmount)}*`,
    `Submitted By: ${batch.submittedByName}`,
    `Reviewed By Admin: ${reviewedByName}`,
    note?.trim() ? `Admin Note: ${note.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function normalizeWhatsappPhone(phone?: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 10 ? `91${digits}` : digits;
}

export function buildWhatsappDirectUrl(phone: string | undefined, message: string): string {
  const normalized = normalizeWhatsappPhone(phone);
  if (!normalized) {
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function resolveAdminApprovalContact(companyProfile: CompanyProfile): {
  adminName: string;
  adminPhone: string;
  adminEmail: string;
} {
  return {
    adminName: companyProfile.signatoryName || 'AVY INFRA Admin',
    adminPhone: companyProfile.hrContact || '',
    adminEmail: companyProfile.hrEmail || '',
  };
}
