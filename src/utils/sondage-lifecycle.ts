import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const TABLE = 'sondage_lifecycle';
const DEVELOPMENT_PREFIX = 'dev:';
const DEVELOPMENT_HASH_PREFIX = 'dev-sha256:';
const MAX_SLUG_LENGTH = 160;

export function pollLifecycleStorageSlug(slug: string): string {
  if (import.meta.env.PROD) return slug;

  const prefixedSlug = `${DEVELOPMENT_PREFIX}${slug}`;
  if (prefixedSlug.length > MAX_SLUG_LENGTH) {
    return `${DEVELOPMENT_HASH_PREFIX}${createHash('sha256').update(slug).digest('hex')}`;
  }
  return prefixedSlug;
}

export type PollLifecyclePoll = {
  id: string;
  data: {
    duration_hours: number;
    isVisible?: boolean;
  };
};

export type PollLifecycleRecord = {
  poll_slug: string;
  started_at: string;
  stopped_at: string | null;
};

export type PollLifecycleStatus = {
  startedAt: string | null;
  endsAt: string | null;
  stoppedAt: string | null;
  isStopped: boolean;
  isExpired: boolean;
  isClosed: boolean;
};

export async function loadPollLifecycles(
  service: SupabaseClient,
  polls: PollLifecyclePoll[],
  initializeVisible = false,
): Promise<Map<string, PollLifecycleRecord>> {
  const timedPolls = polls.filter((poll) => poll.data.duration_hours > 0);
  if (!timedPolls.length) return new Map();
  const storageSlugs = new Map(
    timedPolls.map((poll) => [pollLifecycleStorageSlug(poll.id), poll.id]),
  );

  if (initializeVisible) {
    const toStart = timedPolls
      .filter((poll) => poll.data.isVisible)
      .map((poll) => ({ poll_slug: pollLifecycleStorageSlug(poll.id) }));
    if (toStart.length) {
      const { error } = await service
        .from(TABLE)
        .upsert(toStart, { onConflict: 'poll_slug', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
  }

  const { data, error } = await service
    .from(TABLE)
    .select('poll_slug, started_at, stopped_at')
    .in('poll_slug', Array.from(storageSlugs.keys()));
  if (error) throw new Error(error.message);

  const records = new Map<string, PollLifecycleRecord>();
  for (const record of (data || []) as PollLifecycleRecord[]) {
    const pollSlug = storageSlugs.get(record.poll_slug);
    if (pollSlug) records.set(pollSlug, record);
  }
  return records;
}

export function pollLifecycleStatus(
  poll: PollLifecyclePoll,
  records: Map<string, PollLifecycleRecord>,
  now = Date.now(),
): PollLifecycleStatus {
  const record = records.get(poll.id);
  if (!record) {
    return { startedAt: null, endsAt: null, stoppedAt: null, isStopped: false, isExpired: false, isClosed: false };
  }

  const startedAtMs = Date.parse(record.started_at);
  if (!Number.isFinite(startedAtMs)) throw new Error(`Date de démarrage invalide pour le sondage ${poll.id}.`);
  const durationMs = poll.data.duration_hours * 60 * 60 * 1000;
  const endsAtMs = startedAtMs + durationMs;
  const isStopped = Boolean(record.stopped_at);
  const isExpired = endsAtMs <= now;

  return {
    startedAt: new Date(startedAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
    stoppedAt: record.stopped_at,
    isStopped,
    isExpired,
    isClosed: isStopped || isExpired,
  };
}
