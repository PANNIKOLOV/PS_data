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

/**
 * How early a shop may be picked up.
 *
 * `last_sync_at` records when a run *finished*, so every run pushes the next due
 * time out by however long the sync took. Without a grace, a scheduler ticking
 * on the hour arrives seconds before the mark, skips the shop, and waits a whole
 * extra tick — an hourly shop would quietly sync every two hours, and a daily
 * one would drift an hour later each day.
 *
 * Five minutes absorbs that, and is far shorter than any cadence on offer. It is
 * halved against very short intervals so the grace can never swallow one.
 */
const DUE_GRACE_MS = 5 * 60_000;

/** Whether the scheduled runner should pick this shop up on this tick. */
export function isSyncDue(shop: SchedulableShop, now: Date = new Date()): boolean {
  const due = nextSyncDueAt(shop, now);
  if (due === null) return false;

  const grace = Math.min(DUE_GRACE_MS, (shop.sync_interval_minutes * 60_000) / 2);
  return due.getTime() - grace <= now.getTime();
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

/**
 * Whether the scheduled runner itself looks alive.
 *
 * The application never learns what cron expression an admin configured, so the
 * expected gap is read back from the ticks themselves: the median interval
 * between recent runs. That adapts to whatever the admin chose without asking
 * them to tell the app twice, and it is only used to decide when silence has
 * gone on long enough to be worth flagging.
 */

export interface SchedulerTick {
  ran_at: string;
  /** Absent on rows written before refusals were recorded; treated as a run. */
  outcome?: 'ran' | 'unauthorised' | 'not_configured' | null;
}

export interface SchedulerHealth {
  /**
   * `never`    — nothing has called the endpoint.
   * `refused`  — calls are arriving but being turned away.
   * `stale`    — calls ran, then stopped.
   * `healthy`  — calls are arriving and running.
   */
  state: 'never' | 'refused' | 'stale' | 'healthy';
  lastRanAt: string | null;
  ticksLastDay: number;
  /** Observed gap between accepted ticks in minutes, or null with too few. */
  cadenceMinutes: number | null;
  /** Why the most recent call was turned away, when that is what happened. */
  refusedAt: string | null;
  refusedReason: 'unauthorised' | 'not_configured' | null;
}

/** Silence beyond this is flagged even when the cadence is not yet known. */
const UNKNOWN_CADENCE_TOLERANCE_MS = 90 * 60_000;

/** How many missed ticks to allow before saying something is wrong. */
const MISSED_TICKS_ALLOWED = 2.5;

export function schedulerHealth(
  ticks: readonly SchedulerTick[],
  now: Date = new Date(),
): SchedulerHealth {
  const dated = ticks
    .map((tick) => ({ at: new Date(tick.ran_at).getTime(), outcome: tick.outcome ?? 'ran' }))
    .filter((tick) => !Number.isNaN(tick.at))
    // Newest first, matching how the page queries them, but sorted here so the
    // function does not depend on the caller getting the order right.
    .sort((a, b) => b.at - a.at);

  const refused = dated.find((tick) => tick.outcome !== 'ran');
  const refusedAt = refused ? new Date(refused.at).toISOString() : null;
  const refusedReason = refused
    ? (refused.outcome as 'unauthorised' | 'not_configured')
    : null;

  // Only accepted calls describe the schedule; a refused one proves the cron
  // job is alive but says nothing about how often work actually happens.
  const times = dated.filter((tick) => tick.outcome === 'ran').map((tick) => tick.at);

  if (times.length === 0) {
    return {
      // A refusal still means something is calling — the most useful thing an
      // admin can be told, because it rules out the schedule itself.
      state: refused ? 'refused' : 'never',
      lastRanAt: null,
      ticksLastDay: 0,
      cadenceMinutes: null,
      refusedAt,
      refusedReason,
    };
  }

  const lastRan = times[0]!;
  const dayAgo = now.getTime() - 86_400_000;
  const ticksLastDay = times.filter((time) => time >= dayAgo).length;

  const gaps: number[] = [];
  for (let index = 1; index < times.length; index += 1) {
    gaps.push(times[index - 1]! - times[index]!);
  }

  // The median, not the mean: one long gap from a restart or a deploy should
  // not stretch the expectation for every tick after it.
  const cadenceMs =
    gaps.length > 0 ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]! : null;

  const tolerance =
    cadenceMs !== null
      ? Math.max(cadenceMs * MISSED_TICKS_ALLOWED, UNKNOWN_CADENCE_TOLERANCE_MS)
      : UNKNOWN_CADENCE_TOLERANCE_MS;

  // A refusal newer than the last accepted call is the live problem, whatever
  // the older history looks like: the secret changed, or was removed.
  if (refused && refused.at > lastRan) {
    return {
      state: 'refused',
      lastRanAt: new Date(lastRan).toISOString(),
      ticksLastDay,
      cadenceMinutes: cadenceMs === null ? null : Math.round(cadenceMs / 60_000),
      refusedAt,
      refusedReason,
    };
  }

  return {
    state: now.getTime() - lastRan > tolerance ? 'stale' : 'healthy',
    lastRanAt: new Date(lastRan).toISOString(),
    ticksLastDay,
    cadenceMinutes: cadenceMs === null ? null : Math.round(cadenceMs / 60_000),
    refusedAt,
    refusedReason,
  };
}
