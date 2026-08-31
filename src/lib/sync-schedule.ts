/**
 * Sync cadence: how often a shop refreshes, and how many manual refreshes a
 * marketer may run.
 *
 * The cadence is stored as plain minutes rather than a named enum so a value
 * can be added here without a migration, and so "is this shop due?" is simple
 * arithmetic in both SQL and TypeScript. The presets below are what the admin
 * form offers; the database accepts any value in range.
 *
 * Imported by client components, so nothing here may reach for the server.
 */

export interface SyncCadence {
  /** Minutes between scheduled runs. 0 means the shop is manual-only. */
  minutes: number;
  label: string;
  /** A short aside for the option list; kept brief so a narrow select can show it. */
  description: string;
}

/** Cadences offered in the admin form, coarsest interval last. */
export const SYNC_CADENCES: readonly SyncCadence[] = [
  { minutes: 0, label: 'Manual only', description: 'never on a schedule' },
  { minutes: 60, label: 'Every hour', description: 'heaviest on the shop' },
  { minutes: 180, label: 'Every 3 hours', description: '8 runs a day' },
  { minutes: 360, label: 'Every 6 hours', description: '4 runs a day' },
  { minutes: 720, label: 'Every 12 hours', description: '2 runs a day' },
  { minutes: 1440, label: 'Once a day', description: 'a good default' },
  { minutes: 10080, label: 'Once a week', description: 'for quiet shops' },
] as const;

/** Bounds enforced by the shops_sync_interval_range check constraint. */
export const MIN_SYNC_INTERVAL_MINUTES = 0;
export const MAX_SYNC_INTERVAL_MINUTES = 10080;

/** Daily caps offered for marketer-initiated syncs. Matches shops_manual_sync_limit_range. */
export const MANUAL_SYNC_LIMITS = [0, 1, 3, 5, 10, 20, 50] as const;
export const MAX_MANUAL_SYNC_LIMIT = 50;

/**
 * A readable cadence for any stored value, including ones with no preset.
 *
 * An admin could set 90 minutes directly in the database; the interface should
 * still describe it rather than fall back to a blank or a raw number.
 */
export function describeCadence(minutes: number): string {
  const preset = SYNC_CADENCES.find((cadence) => cadence.minutes === minutes);
  if (preset) return preset.label;

  if (minutes <= 0) return 'Manual only';
  if (minutes < 60) return `Every ${minutes} minutes`;

  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? 'Once a day' : `Every ${days} days`;
  }

  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? 'Every hour' : `Every ${hours} hours`;
  }

  return `Every ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The scheduling fields the due-check needs, so callers can select just these. */
export interface SchedulableShop {
  is_active: boolean;
  sync_interval_minutes: number;
  last_sync_at: string | null;
}

/**
 * When a shop should next be synced, or null when nothing is scheduled.
 *
 * A shop that has never synced is due immediately: waiting a full interval
 * before the first run would leave a newly connected shop empty for a day.
 */
export function nextSyncDueAt(shop: SchedulableShop, now: Date = new Date()): Date | null {
  if (!shop.is_active || shop.sync_interval_minutes <= 0) return null;
  if (!shop.last_sync_at) return now;

  const last = new Date(shop.last_sync_at);
  if (Number.isNaN(last.getTime())) return now;

  return new Date(last.getTime() + shop.sync_interval_minutes * 60_000);
}

/** Whether the scheduled runner should pick this shop up on this tick. */
export function isSyncDue(shop: SchedulableShop, now: Date = new Date()): boolean {
  const due = nextSyncDueAt(shop, now);
  return due !== null && due.getTime() <= now.getTime();
}

/**
 * Clamps a cadence to what the database will accept.
 *
 * Returns null for anything that is not a number, so a caller can report a bad
 * input rather than silently storing a default the admin did not choose.
 */
export function parseSyncInterval(value: unknown): number | null {
  const minutes = Number(value);
  if (!Number.isInteger(minutes)) return null;
  if (minutes < MIN_SYNC_INTERVAL_MINUTES || minutes > MAX_SYNC_INTERVAL_MINUTES) return null;
  return minutes;
}

export function parseManualSyncLimit(value: unknown): number | null {
  const limit = Number(value);
  if (!Number.isInteger(limit)) return null;
  if (limit < 0 || limit > MAX_MANUAL_SYNC_LIMIT) return null;
  return limit;
}
