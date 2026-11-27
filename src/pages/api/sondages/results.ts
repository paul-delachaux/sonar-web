import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { createServiceClient } from '../../../utils/service-client';
import { supabase } from '../../../utils/supabase';
import { loadPollLifecycles, pollLifecycleStatus } from '../../../utils/sondage-lifecycle';
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
    return 'Les réponses de La Sonde ne sont pas configurées dans Supabase.';
  }
  if (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist/i.test(error.message || '')) {
    return 'La base Supabase doit être mise à jour avec supabase/sondage-responses.sql.';
  }
  return 'Impossible de charger les résultats de La Sonde.';
}

export const GET: APIRoute = async ({ request, url }) => {
  const polls = await getCollection('sondages');
  const service = createServiceClient();
  if (!service) return json({ message: 'Le service de sondage n’est pas configuré.' }, 503);

  try {
    const lifecycle = await loadPollLifecycles(service, polls);
    const liveResultsRequested = url.searchParams.get('scope') === 'live';
    const closedPolls = polls.filter((poll) => {
      const status = pollLifecycleStatus(poll, lifecycle);
      return status.isClosed && Boolean(status.startedAt);
    });
    const livePolls = polls.filter((poll) => {
      const status = pollLifecycleStatus(poll, lifecycle);
      return !status.isClosed && poll.data.isVisible && poll.data.show_live_results;
    });
    const candidates = liveResultsRequested ? livePolls : closedPolls;
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    let respondentOptions = new Map<string, string[]>();
    if (token && candidates.length) {
      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (!authError && authData.user) {
        const { data: responses, error: responseError } = await service
          .from('sondage_responses')
          .select('poll_slug, option_id, option_ids')
          .eq('account_id', authData.user.id)
          .in('poll_slug', candidates.map((poll) => poll.id));
        if (responseError) {
          console.error('[sondages/results] Could not verify response ownership:', responseError);
          return json({ message: setupMessage(responseError) }, 503);
        }
        respondentOptions = new Map((responses || []).map((response) => [
          response.poll_slug,
          Array.isArray(response.option_ids) && response.option_ids.length
            ? response.option_ids
            : [response.option_id],
        ]));
      }
    }
    const eligible = liveResultsRequested
      ? livePolls.filter((poll) => respondentOptions.has(poll.id))
      : closedPolls;
    if (!eligible.length) return json({ polls: [] });

    const tallies = new Map<string, Map<string, number>>();
    const responseCounts = new Map<string, number>();
    const slugs = eligible.map((poll) => poll.id);
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await service
        .from('sondage_responses')
        .select('poll_slug, option_id, option_ids')
        .in('poll_slug', slugs)
        .order('poll_slug', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) {
        console.error('[sondages/results] Could not load public result totals:', error);
        return json({ message: setupMessage(error) }, 503);
      }

      const page = (data || []) as Array<{ poll_slug: string; option_id: string; option_ids: string[] | null }>;
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
      if (page.length < pageSize) break;
    }

    return json({
      polls: eligible.map((poll) => {
        const status = pollLifecycleStatus(poll, lifecycle);
        const tally = tallies.get(poll.id) || new Map<string, number>();
        const total = responseCounts.get(poll.id) || 0;
        const options = sondageOptions(poll).map((option) => {
          const count = tally.get(option.id) || 0;
          return {
            id: option.id,
            label: option.label,
            labelEn: option.label_en || option.label,
            count,
            percentage: total ? Math.round((count / total) * 1000) / 10 : 0,
          };
        });
        const average = poll.data.layout === 'scale' && total
          ? Math.round(options.reduce((sum, option) => sum + Number(option.id) * option.count, 0) / total * 10) / 10
          : null;
        return {
          slug: poll.id,
          layout: poll.data.layout,
          title: poll.data.title,
          titleEn: poll.data.title_en || poll.data.title,
          question: poll.data.question,
          questionEn: poll.data.question_en || poll.data.question,
          total,
          isClosed: status.isClosed,
          endsAt: status.endsAt,
          closedAt: status.stoppedAt || (status.isExpired ? status.endsAt : null),
          ...(average === null ? {} : { average }),
          ...(respondentOptions.has(poll.id)
            ? {
              myOptionIds: respondentOptions.get(poll.id),
              myOptionId: respondentOptions.get(poll.id)?.[0],
            }
            : {}),
          options,
        };
      }),
    });
  } catch (error) {
    console.error('[sondages/results] Could not resolve poll lifecycle:', error);
    return json({ message: 'Impossible de charger l’état des résultats.' }, 503);
  }
};
