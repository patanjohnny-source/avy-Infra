import type { AdvanceEntry } from '../types/avy';
import { formatINR } from './payroll';

export const DEFAULT_FOOD_FOLLOWUP_THRESHOLD_HOURS = 24;
export const DEFAULT_FOOD_FOLLOWUP_COOLDOWN_HOURS = 24;

export const DEFAULT_FOOD_FOLLOWUP_TEMPLATE = [
  '*{{companyName}} — Weekly Food Advance Reminder*',
  'Namaste {{workerName}} ({{empCode}}),',
  'Your Weekly Food Advance of *{{amount}}* recorded on {{date}} ({{paymentMode}}) for {{tower}} has not been acknowledged for *{{hoursElapsed}}*.',
  'Please confirm receipt by replying "OK" on WhatsApp or tapping Acknowledge Receipt in your Employee Portal.',
  '— {{companyName}} Site Accounts',
].join('\n');

export const FOOD_FOLLOWUP_STORAGE_KEY = 'avy_infra_food_followup_settings_v1';

export interface FoodFollowUpSettings {
  autoMonitorEnabled: boolean;
  thresholdHours: number;
  cooldownHours: number;
  template: string;
  lastAutoSweepAt?: string;
}

export const DEFAULT_FOOD_FOLLOWUP_SETTINGS: FoodFollowUpSettings = {
  autoMonitorEnabled: true,
  thresholdHours: DEFAULT_FOOD_FOLLOWUP_THRESHOLD_HOURS,
  cooldownHours: DEFAULT_FOOD_FOLLOWUP_COOLDOWN_HOURS,
  template: DEFAULT_FOOD_FOLLOWUP_TEMPLATE,
};

export function loadFoodFollowUpSettings(): FoodFollowUpSettings {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return { ...DEFAULT_FOOD_FOLLOWUP_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(FOOD_FOLLOWUP_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FOOD_FOLLOWUP_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<FoodFollowUpSettings>;
    const threshold = Number(parsed.thresholdHours);
    const cooldown = Number(parsed.cooldownHours);
    return {
      autoMonitorEnabled:
        typeof parsed.autoMonitorEnabled === 'boolean' ? parsed.autoMonitorEnabled : true,
      thresholdHours:
        Number.isFinite(threshold) && threshold >= 1 && threshold <= 168 ? threshold : 24,
      cooldownHours:
        Number.isFinite(cooldown) && cooldown >= 1 && cooldown <= 168 ? cooldown : 24,
      template:
        typeof parsed.template === 'string' && parsed.template.trim().length > 0
          ? parsed.template
          : DEFAULT_FOOD_FOLLOWUP_TEMPLATE,
      lastAutoSweepAt:
        typeof parsed.lastAutoSweepAt === 'string' ? parsed.lastAutoSweepAt : undefined,
    };
  } catch {
    return { ...DEFAULT_FOOD_FOLLOWUP_SETTINGS };
  }
}

export function saveFoodFollowUpSettings(settings: FoodFollowUpSettings): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(FOOD_FOLLOWUP_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export type WeeklyFoodAckStatus = 'acknowledged' | 'overdue_unacknowledged' | 'within_window';

export interface EvaluatedWeeklyFoodAdvance {
  advance: AdvanceEntry;
  status: WeeklyFoodAckStatus;
  recordedAtMs: number;
  elapsedHours: number;
  remainingHours: number;
  hoursOverdue: number;
  isDueForAutoFollowUp: boolean;
  inCooldown: boolean;
  cooldownRemainingHours: number;
}

export interface WeeklyFoodFollowUpSummary {
  allRows: EvaluatedWeeklyFoodAdvance[];
  overdueRows: EvaluatedWeeklyFoodAdvance[];
  dueNowRows: EvaluatedWeeklyFoodAdvance[];
  withinWindowRows: EvaluatedWeeklyFoodAdvance[];
  acknowledgedRows: EvaluatedWeeklyFoodAdvance[];
  overdueCount: number;
  dueNowCount: number;
  withinWindowCount: number;
  acknowledgedCount: number;
}

/**
 * Resolves the effective timestamp (ms) when an advance was recorded.
 * If an advance is backdated (adv.date < createdAt's calendar date), anchors to noon
 * on adv.date so backdated Sunday weekly food runs accurately age past 24 hours.
 */
export function resolveAdvanceRecordedMs(
  adv: Pick<AdvanceEntry, 'date' | 'createdAt'>,
  fallbackNowMs = Date.now()
): number {
  const createdMs = adv.createdAt ? Date.parse(adv.createdAt) : NaN;
  const createdDateIso =
    Number.isFinite(createdMs) && adv.createdAt ? adv.createdAt.slice(0, 10) : '';

  if (adv.date && /^\d{4}-\d{2}-\d{2}$/.test(adv.date)) {
    const dateAnchorMs = Date.parse(`${adv.date}T12:00:00`);
    if (Number.isFinite(dateAnchorMs)) {
      if (!Number.isFinite(createdMs)) return dateAnchorMs;
      if (createdDateIso && adv.date < createdDateIso) {
        return Math.min(createdMs, dateAnchorMs);
      }
    }
  }

  return Number.isFinite(createdMs) ? createdMs : fallbackNowMs;
}

export function formatElapsedDurationLabel(hours: number): string {
  const safeHours = Math.max(0, Math.floor(hours));
  if (safeHours < 1) return '<1 hr';
  if (safeHours < 24) return `${safeHours}h`;
  const days = Math.floor(safeHours / 24);
  const remHours = safeHours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function evaluateWeeklyFoodAdvance(
  adv: AdvanceEntry,
  nowMs = Date.now(),
  options?: { thresholdHours?: number; cooldownHours?: number }
): EvaluatedWeeklyFoodAdvance {
  const thresholdHours = Math.max(1, options?.thresholdHours ?? DEFAULT_FOOD_FOLLOWUP_THRESHOLD_HOURS);
  const cooldownHours = Math.max(1, options?.cooldownHours ?? DEFAULT_FOOD_FOLLOWUP_COOLDOWN_HOURS);
  const recordedAtMs = resolveAdvanceRecordedMs(adv, nowMs);
  const elapsedHours = Math.max(0, (nowMs - recordedAtMs) / (1000 * 60 * 60));

  const lastFollowUpMs = adv.followUpSentAt ? Date.parse(adv.followUpSentAt) : NaN;
  const hoursSinceFollowUp = Number.isFinite(lastFollowUpMs)
    ? Math.max(0, (nowMs - lastFollowUpMs) / (1000 * 60 * 60))
    : Infinity;
  const inCooldown = Number.isFinite(hoursSinceFollowUp) && hoursSinceFollowUp < cooldownHours;
  const cooldownRemainingHours = inCooldown ? Math.max(0, cooldownHours - hoursSinceFollowUp) : 0;

  if (adv.acknowledged) {
    return {
      advance: adv,
      status: 'acknowledged',
      recordedAtMs,
      elapsedHours,
      remainingHours: 0,
      hoursOverdue: 0,
      isDueForAutoFollowUp: false,
      inCooldown: false,
      cooldownRemainingHours: 0,
    };
  }

  if (elapsedHours >= thresholdHours) {
    return {
      advance: adv,
      status: 'overdue_unacknowledged',
      recordedAtMs,
      elapsedHours,
      remainingHours: 0,
      hoursOverdue: elapsedHours - thresholdHours,
      isDueForAutoFollowUp: !inCooldown,
      inCooldown,
      cooldownRemainingHours,
    };
  }

  return {
    advance: adv,
    status: 'within_window',
    recordedAtMs,
    elapsedHours,
    remainingHours: Math.max(0, thresholdHours - elapsedHours),
    hoursOverdue: 0,
    isDueForAutoFollowUp: false,
    inCooldown,
    cooldownRemainingHours,
  };
}

export function computeWeeklyFoodFollowUpSummary(
  advances: AdvanceEntry[],
  nowMs = Date.now(),
  options?: { thresholdHours?: number; cooldownHours?: number }
): WeeklyFoodFollowUpSummary {
  const weeklyAdvances = advances.filter((adv) => adv.advanceType === 'weekly_food');
  const allRows = weeklyAdvances
    .map((adv) => evaluateWeeklyFoodAdvance(adv, nowMs, options))
    .sort((a, b) => {
      const rank = (s: WeeklyFoodAckStatus) =>
        s === 'overdue_unacknowledged' ? 0 : s === 'within_window' ? 1 : 2;
      const diff = rank(a.status) - rank(b.status);
      if (diff !== 0) return diff;
      return b.elapsedHours - a.elapsedHours;
    });

  const overdueRows = allRows.filter((r) => r.status === 'overdue_unacknowledged');
  const dueNowRows = overdueRows.filter((r) => r.isDueForAutoFollowUp);
  const withinWindowRows = allRows.filter((r) => r.status === 'within_window');
  const acknowledgedRows = allRows.filter((r) => r.status === 'acknowledged');

  return {
    allRows,
    overdueRows,
    dueNowRows,
    withinWindowRows,
    acknowledgedRows,
    overdueCount: overdueRows.length,
    dueNowCount: dueNowRows.length,
    withinWindowCount: withinWindowRows.length,
    acknowledgedCount: acknowledgedRows.length,
  };
}

export function buildFoodAdvanceFollowUpMessage(
  adv: Pick<
    AdvanceEntry,
    | 'employeeName'
    | 'empCode'
    | 'amount'
    | 'date'
    | 'paymentMode'
    | 'paymentApp'
    | 'transactionId'
    | 'projectName'
    | 'towerName'
  >,
  options: {
    companyName?: string;
    elapsedHours: number;
    template?: string;
  }
): string {
  const companyName = (options.companyName || 'AVY INFRA').trim();
  const template =
    options.template && options.template.trim().length > 0
      ? options.template
      : DEFAULT_FOOD_FOLLOWUP_TEMPLATE;

  const siteParts = [adv.projectName, adv.towerName ? `(${adv.towerName})` : ''].filter(Boolean);
  const towerLabel = siteParts.length > 0 ? siteParts.join(' ') : 'Site Crew';
  const modeParts = [
    adv.paymentMode.toUpperCase(),
    adv.paymentApp?.trim() ? adv.paymentApp.trim() : '',
    adv.transactionId?.trim() ? `Ref: ${adv.transactionId.trim()}` : '',
  ].filter(Boolean);
  const paymentModeLabel = modeParts.join(' · ');
  const elapsedLabel = formatElapsedDurationLabel(options.elapsedHours);

  const replacements: Record<string, string> = {
    '{{companyName}}': companyName,
    '{{workerName}}': adv.employeeName,
    '{{empCode}}': adv.empCode,
    '{{amount}}': formatINR(adv.amount),
    '{{date}}': adv.date,
    '{{tower}}': towerLabel,
    '{{paymentMode}}': paymentModeLabel,
    '{{hoursElapsed}}': elapsedLabel,
  };

  let rendered = template;
  for (const [token, val] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(val);
  }
  return rendered;
}
