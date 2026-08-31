import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_SYNC_INTERVAL_MINUTES,
  SYNC_CADENCES,
  describeCadence,
  isSyncDue,
  nextSyncDueAt,
  parseManualSyncLimit,
  parseSyncInterval,
  schedulerHealth,
  type SchedulableShop,
} from '@/lib/sync-schedule';
import { formatRelativeTime } from '@/lib/utils';

const NOW = new Date('2026-08-31T12:00:00Z');

function shop(overrides: Partial<SchedulableShop> = {}): SchedulableShop {
  return {
    is_active: true,
    sync_interval_minutes: 360,
    last_sync_at: '2026-08-31T09:00:00Z',
    ...overrides,
  };
}

describe('cadence descriptions', () => {
  it('names every preset the admin form offers', () => {
    for (const cadence of SYNC_CADENCES) {
      assert.equal(describeCadence(cadence.minutes), cadence.label);
    }
  });

  it('describes an interval with no preset', () => {
    // An admin could set these directly in the database; the interface still
    // has to render something readable.
    assert.equal(describeCadence(90), 'Every 1h 30m');
    assert.equal(describeCadence(30), 'Every 30 minutes');
    assert.equal(describeCadence(120), 'Every 2 hours');
    assert.equal(describeCadence(2880), 'Every 2 days');
  });

  it('treats zero and negatives as manual only', () => {
    assert.equal(describeCadence(0), 'Manual only');
    assert.equal(describeCadence(-60), 'Manual only');
  });
});

describe('when a shop is next due', () => {
  it('adds the interval to the last successful run', () => {
    const due = nextSyncDueAt(shop(), NOW);
    assert.equal(due?.toISOString(), '2026-08-31T15:00:00.000Z');
    assert.equal(isSyncDue(shop(), NOW), false);
  });

  it('is due once the interval has elapsed', () => {
    assert.equal(isSyncDue(shop({ last_sync_at: '2026-08-31T05:59:00Z' }), NOW), true);
  });

  it('is due when the tick lands just short of the mark', () => {
    /*
     * The reason this grace exists: last_sync_at is when a run *finished*, so
     * a run started by the 06:00 tick stamps 06:00:12, and the 12:00 tick then
     * arrives twelve seconds early. Without the grace an hourly shop on an
     * hourly cron would sync every two hours.
     */
    assert.equal(isSyncDue(shop({ last_sync_at: '2026-08-31T06:00:12Z' }), NOW), true);
    // Four minutes early still counts; ten does not.
    assert.equal(isSyncDue(shop({ last_sync_at: '2026-08-31T06:04:00Z' }), NOW), true);
    assert.equal(isSyncDue(shop({ last_sync_at: '2026-08-31T06:10:00Z' }), NOW), false);
  });

  it('never lets the grace swallow a short interval', () => {
    // A four-minute interval gets two minutes of grace, not five, so a shop is
    // not permanently due.
    const brisk = shop({ sync_interval_minutes: 4, last_sync_at: '2026-08-31T11:59:00Z' });
    assert.equal(isSyncDue(brisk, NOW), false);
    assert.equal(isSyncDue({ ...brisk, last_sync_at: '2026-08-31T11:57:00Z' }, NOW), true);
  });

  it('is due immediately when the shop has never synced', () => {
    // Otherwise a newly connected shop would sit empty for a whole interval.
    assert.equal(isSyncDue(shop({ last_sync_at: null }), NOW), true);
  });

  it('treats an unreadable timestamp as due rather than never', () => {
    assert.equal(isSyncDue(shop({ last_sync_at: 'not a date' }), NOW), true);
  });

  it('never schedules a paused shop', () => {
    assert.equal(nextSyncDueAt(shop({ is_active: false }), NOW), null);
    assert.equal(isSyncDue(shop({ is_active: false, last_sync_at: null }), NOW), false);
  });

  it('never schedules a manual-only shop', () => {
    assert.equal(nextSyncDueAt(shop({ sync_interval_minutes: 0 }), NOW), null);
    assert.equal(isSyncDue(shop({ sync_interval_minutes: 0, last_sync_at: null }), NOW), false);
  });
});

describe('parsing admin input', () => {
  it('accepts values inside the range the check constraint allows', () => {
    assert.equal(parseSyncInterval('1440'), 1440);
    assert.equal(parseSyncInterval(0), 0);
    assert.equal(parseSyncInterval(MAX_SYNC_INTERVAL_MINUTES), MAX_SYNC_INTERVAL_MINUTES);
  });

  it('rejects what the database would reject, so the form reports it first', () => {
    assert.equal(parseSyncInterval(MAX_SYNC_INTERVAL_MINUTES + 1), null);
    assert.equal(parseSyncInterval(-1), null);
    assert.equal(parseSyncInterval('hourly'), null);
    assert.equal(parseSyncInterval(90.5), null);
  });

  it('bounds the daily manual limit', () => {
    assert.equal(parseManualSyncLimit('5'), 5);
    assert.equal(parseManualSyncLimit(0), 0);
    assert.equal(parseManualSyncLimit(51), null);
    assert.equal(parseManualSyncLimit(-1), null);
  });
});

describe('relative time for a scheduled run', () => {
  it('reads forwards for an instant in the future', () => {
    // The next scheduled sync is normally still ahead, which the past-only
    // version of this rendered as "just now".
    const inThreeHours = new Date(Date.now() + 3 * 3600 * 1000);
    assert.equal(formatRelativeTime(inThreeHours), 'in 3 hours');
  });

  it('still reads backwards for an instant in the past', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    assert.equal(formatRelativeTime(twoHoursAgo), '2 hours ago');
  });

  it('collapses the minute either side of now', () => {
    assert.equal(formatRelativeTime(new Date(Date.now() - 5_000)), 'just now');
    assert.equal(formatRelativeTime(new Date(Date.now() + 5_000)), 'in under a minute');
  });
});

describe('scheduler health', () => {
  /** `count` ticks ending `endedMinutesAgo` before NOW, `everyMinutes` apart. */
  function ticks(count: number, everyMinutes: number, endedMinutesAgo = 0) {
    return Array.from({ length: count }, (_, index) => ({
      ran_at: new Date(
        NOW.getTime() - (endedMinutesAgo + index * everyMinutes) * 60_000,
      ).toISOString(),
    }));
  }

  it('reports never when the endpoint has not been reached', () => {
    const health = schedulerHealth([], NOW);
    assert.equal(health.state, 'never');
    assert.equal(health.lastRanAt, null);
    assert.equal(health.cadenceMinutes, null);
  });

  it('reads the cadence back from the ticks themselves', () => {
    const health = schedulerHealth(ticks(12, 60), NOW);
    assert.equal(health.state, 'healthy');
    assert.equal(health.cadenceMinutes, 60);
    assert.equal(health.ticksLastDay, 12);
  });

  it('is not fooled by one long gap', () => {
    // A restart leaves a six-hour hole; the median ignores it, the mean would not.
    const health = schedulerHealth(
      [...ticks(5, 60), ...ticks(5, 60, 360)],
      NOW,
    );
    assert.equal(health.cadenceMinutes, 60);
    assert.equal(health.state, 'healthy');
  });

  it('flags a scheduler that has stopped', () => {
    // Hourly ticks, then four hours of silence.
    const health = schedulerHealth(ticks(6, 60, 240), NOW);
    assert.equal(health.state, 'stale');
  });

  it('tolerates a couple of missed ticks', () => {
    const health = schedulerHealth(ticks(6, 60, 120), NOW);
    assert.equal(health.state, 'healthy');
  });

  it('gives a frequent scheduler the same benefit of the doubt', () => {
    // Every 15 minutes: 2.5 missed ticks is under 40 minutes, but silence is
    // only worth flagging after the floor, so an hour's gap is still healthy.
    assert.equal(schedulerHealth(ticks(8, 15, 60), NOW).state, 'healthy');
    assert.equal(schedulerHealth(ticks(8, 15, 120), NOW).state, 'stale');
  });

  it('counts only the last day, however long the log is', () => {
    // 48 hourly ticks span two days; the 24-hour boundary is inclusive, so the
    // one landing exactly on it counts.
    const health = schedulerHealth(ticks(48, 60), NOW);
    assert.equal(health.ticksLastDay, 25);
  });

  it('ignores an unreadable timestamp rather than throwing', () => {
    const health = schedulerHealth([{ ran_at: 'nonsense' }, ...ticks(3, 60)], NOW);
    assert.equal(health.state, 'healthy');
  });
});
