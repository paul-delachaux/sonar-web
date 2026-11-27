import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { requireCmsAdmin } from '../../../utils/admin-github';
import { createServiceClient } from '../../../utils/service-client';
import { loadPollLifecycles, pollLifecycleStatus, pollLifecycleStorageSlug } from '../../../utils/sondage-lifecycle';
import { orderSondages } from '../../../utils/sondages-order';
import { sondageOptions } from '../../../utils/sondages';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

function setupMessage(error: { code?: string; message?: string }) {
  if (error.code === '42P01' || error.code === 'PGRST205' || /relation .* does not exist/i.test(error.message || '')) {
    return 'Les réponses de La Sonde ne sont pas configurées dans Supabase. Exécutez supabase/sondage-responses.sql.';
  }
  if (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist/i.test(error.message || '')) {
    return 'La base Supabase doit être mise à jour avec supabase/sondage-responses.sql.';
  }
  return error.message || 'Impossible de charger les réponses.';
}

function pollAdminStatus(
  poll: Awaited<ReturnType<typeof getCollection<'sondages'>>>[number],
  lifecycle: Awaited<ReturnType<typeof loadPollLifecycles>>,
) {
  const status = pollLifecycleStatus(poll, lifecycle);
  return {
    durationHours: poll.data.duration_hours,
    showLiveResults: poll.data.show_live_results,
    isVisible: poll.data.isVisible,
    isActive: poll.data.isVisible && !status.isClosed,
    ...status,
  };
}

function emptyPollSummaries(
  polls: Awaited<ReturnType<typeof getCollection<'sondages'>>>,
  lifecycle: Awaited<ReturnType<typeof loadPollLifecycles>> = new Map(),
) {
  return polls.map((item) => ({
    slug: item.id,
    layout: item.data.layout,
    title: item.data.title,
    question: item.data.question,
    total: 0,
    ...pollAdminStatus(item, lifecycle),
    options: sondageOptions(item).map((option) => ({
      id: option.id,
      label: option.label,
      count: 0,
      percentage: 0,
    })),
  }));
}

function isMissingResponsesTable(error: { code?: string; message?: string }) {
  return error.code === '42P01' || error.code === 'PGRST205' || /relation .* does not exist/i.test(error.message || '');
}

export const GET: APIRoute = async ({ request, url }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const polls = orderSondages(await getCollection('sondages'));
  const slug = url.searchParams.get('poll')?.trim() || '';
  if (slug.length > 160) return json({ message: 'Sélectionnez un sondage valide.' }, 400);
  const poll = slug ? polls.find((item) => item.id === slug) : null;
  if (slug && !poll) return json({ message: 'Ce sondage n’existe plus dans le CMS.' }, 404);

  const service = createServiceClient();
  if (!service) {
    if (!slug) {
      return json({
        polls: emptyPollSummaries(polls),
        warning: 'La clé SUPABASE_SERVICE_ROLE_KEY manque : les sondages sont affichés sans résultats.',
      });
    }
    return json({ message: 'La clé SUPABASE_SERVICE_ROLE_KEY manque.' }, 503);
  }

  let lifecycle = new Map<string, { poll_slug: string; started_at: string; stopped_at: string | null }>();
  let lifecycleWarning = '';
  try {
    lifecycle = await loadPollLifecycles(service, polls);
  } catch (error) {
    console.error('[admin/sondage-responses] Could not load poll lifecycle:', error);
    lifecycleWarning = 'Les durées et clôtures ne sont pas disponibles. Vérifiez la table sondage_lifecycle dans Supabase.';
  }

  type StoredResponse = {
    poll_slug: string;
    option_id: string;
    option_ids: string[] | null;
    explanation: string;
    created_at: string;
    updated_at: string;
  };
  const tallies = new Map<string, Map<string, number>>();
  const responseCounts = new Map<string, number>();
  const responses: StoredResponse[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = service
      .from('sondage_responses')
      .select(slug ? 'poll_slug, option_id, option_ids, explanation, created_at, updated_at' : 'poll_slug, option_id, option_ids')
      .order('poll_slug', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (slug) query = query.eq('poll_slug', slug).order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) {
      console.error('[admin/sondage-responses] Could not load responses:', error);
      if (!slug && isMissingResponsesTable(error)) {
        return json({
          polls: emptyPollSummaries(polls, lifecycle),
          warning: [setupMessage(error), lifecycleWarning].filter(Boolean).join(' '),
        });
      }
      return json({ message: setupMessage(error) }, 503);
    }

    const page = (data || []) as Array<{
      poll_slug: string;
      option_id: string;
      option_ids: string[] | null;
      explanation?: string;
      created_at?: string;
      updated_at?: string;
    }>;
    page.forEach((response) => {
      const options = tallies.get(response.poll_slug) || new Map<string, number>();
      const selectedIds = Array.isArray(response.option_ids) && response.option_ids.length
        ? response.option_ids
        : [response.option_id];
      selectedIds.forEach((optionId) => {
        options.set(optionId, (options.get(optionId) || 0) + 1);
      });
      tallies.set(response.poll_slug, options);
      responseCounts.set(response.poll_slug, (responseCounts.get(response.poll_slug) || 0) + 1);
    });
    if (slug) {
      responses.push(...page as StoredResponse[]);
    }
    if (page.length < pageSize) break;
  }

  if (!slug) {
    return json({
      polls: polls.map((item) => {
        const tally = tallies.get(item.id) || new Map<string, number>();
        const total = responseCounts.get(item.id) || 0;
        const options = sondageOptions(item).map((option) => {
          const count = tally.get(option.id) || 0;
          return {
            id: option.id,
            label: option.label,
            count,
            percentage: total ? Math.round((count / total) * 1000) / 10 : 0,
          };
        });
        return {
          slug: item.id,
          layout: item.data.layout,
          title: item.data.title,
          question: item.data.question,
          total,
          ...pollAdminStatus(item, lifecycle),
          ...(item.data.layout === 'scale' && total
            ? { average: Math.round(options.reduce((sum, option) => sum + Number(option.id) * option.count, 0) / total * 10) / 10 }
            : {}),
          options,
        };
      }),
      ...(lifecycleWarning ? { warning: lifecycleWarning } : {}),
    });
  }

  const selectedPoll = poll!;
  const tally = tallies.get(selectedPoll.id) || new Map<string, number>();
  const total = responseCounts.get(selectedPoll.id) || 0;
  const options = sondageOptions(selectedPoll).map((option) => {
    const count = tally.get(option.id) || 0;
    return {
      id: option.id,
      label: option.label,
      count,
      percentage: total ? Math.round((count / total) * 1000) / 10 : 0,
    };
  });
  return json({
    poll: {
      slug: selectedPoll.id,
      layout: selectedPoll.data.layout,
      title: selectedPoll.data.title,
      question: selectedPoll.data.question,
      total,
      ...pollAdminStatus(selectedPoll, lifecycle),
      ...(selectedPoll.data.layout === 'scale' && total
        ? { average: Math.round(options.reduce((sum, option) => sum + Number(option.id) * option.count, 0) / total * 10) / 10 }
        : {}),
      options,
      responses,
    },
    ...(lifecycleWarning ? { warning: lifecycleWarning } : {}),
  });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ message: 'La demande envoyée est invalide.' }, 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ message: 'La demande envoyée est invalide.' }, 400);
  }

  const body = payload as Record<string, unknown>;
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  if (body.action !== 'stop' || !slug || slug.length > 160 || /[\/\\\u0000]/.test(slug)) {
    return json({ message: 'Sélectionnez un sondage valide à arrêter.' }, 400);
  }

  const poll = (await getCollection('sondages')).find((item) => item.id === slug);
  if (!poll) return json({ message: 'Ce sondage n’existe plus dans le CMS.' }, 404);
  const service = createServiceClient();
  if (!service) return json({ message: 'La clé SUPABASE_SERVICE_ROLE_KEY manque.' }, 503);

  try {
    const records = await loadPollLifecycles(service, [poll]);
    const current = records.get(poll.id);
    if (current?.stopped_at) {
      return json({ ok: true, ...pollAdminStatus(poll, records) });
    }

    const { error } = await service
      .from('sondage_lifecycle')
      .upsert({ poll_slug: pollLifecycleStorageSlug(poll.id), stopped_at: new Date().toISOString() }, { onConflict: 'poll_slug' });
    if (error) {
      console.error('[admin/sondage-responses] Could not stop poll:', error);
      return json({ message: 'Impossible d’arrêter le sondage.' }, 503);
    }

    const updatedRecords = await loadPollLifecycles(service, [poll]);
    return json({ ok: true, ...pollAdminStatus(poll, updatedRecords) });
  } catch (error) {
    console.error('[admin/sondage-responses] Could not stop poll:', error);
    return json({ message: 'Impossible de vérifier ou d’arrêter le sondage.' }, 503);
  }
};
