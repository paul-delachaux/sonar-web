import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { requireCmsAdmin } from '../../../utils/admin-github';
import { createServiceClient } from '../../../utils/service-client';

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
  return error.message || 'Impossible de charger les réponses.';
}

function emptyPollSummaries(polls: Awaited<ReturnType<typeof getCollection<'sondages'>>>) {
  return polls.map((item) => ({
    slug: item.id,
    title: item.data.title,
    question: item.data.question,
    total: 0,
    options: item.data.options.map((option) => ({
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

  const polls = (await getCollection('sondages'))
    .sort((a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id));
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

  type StoredResponse = {
    poll_slug: string;
    option_id: string;
    explanation: string;
    created_at: string;
    updated_at: string;
  };
  const tallies = new Map<string, Map<string, number>>();
  const responses: StoredResponse[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = service
      .from('sondage_responses')
      .select(slug ? 'poll_slug, option_id, explanation, created_at, updated_at' : 'poll_slug, option_id')
      .order('poll_slug', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (slug) query = query.eq('poll_slug', slug).order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) {
      console.error('[admin/sondage-responses] Could not load responses:', error);
      if (!slug && isMissingResponsesTable(error)) {
        return json({
          polls: emptyPollSummaries(polls),
          warning: setupMessage(error),
        });
      }
      return json({ message: setupMessage(error) }, 503);
    }

    const page = (data || []) as Array<{
      poll_slug: string;
      option_id: string;
      explanation?: string;
      created_at?: string;
      updated_at?: string;
    }>;
    page.forEach((response) => {
      const options = tallies.get(response.poll_slug) || new Map<string, number>();
      options.set(response.option_id, (options.get(response.option_id) || 0) + 1);
      tallies.set(response.poll_slug, options);
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
        const total = [...tally.values()].reduce((sum, count) => sum + count, 0);
        return {
          slug: item.id,
          title: item.data.title,
          question: item.data.question,
          total,
          options: item.data.options.map((option) => {
            const count = tally.get(option.id) || 0;
            return {
              id: option.id,
              label: option.label,
              count,
              percentage: total ? Math.round((count / total) * 1000) / 10 : 0,
            };
          }),
        };
      }),
    });
  }

  const selectedPoll = poll!;
  const tally = tallies.get(selectedPoll.id) || new Map<string, number>();
  const total = [...tally.values()].reduce((sum, count) => sum + count, 0);
  const options = selectedPoll.data.options.map((option) => {
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
      title: selectedPoll.data.title,
      question: selectedPoll.data.question,
      total,
      options,
      responses,
    },
  });
};
