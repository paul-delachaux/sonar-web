import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { requireCmsAdmin } from '../../../utils/admin-github';
import { createServiceClient } from '../../../utils/service-client';
import { loadPollLifecycles, pollLifecycleStatus } from '../../../utils/sondage-lifecycle';
import { orderSondages } from '../../../utils/sondages-order';
import { sondageOptions } from '../../../utils/sondages';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const polls = orderSondages(await getCollection('sondages'));
  const service = createServiceClient();
  let lifecycle = new Map<string, { poll_slug: string; started_at: string; stopped_at: string | null }>();
  if (service) {
    try {
      lifecycle = await loadPollLifecycles(service, polls);
    } catch (error) {
      console.error('[admin/sondages] Could not load poll lifecycle:', error);
      return json({ message: 'Impossible de charger l’état des sondages.' }, 503);
    }
  }

  return json({
    polls: polls.map((poll) => {
      const status = pollLifecycleStatus(poll, lifecycle);
      return {
        slug: poll.id,
        layout: poll.data.layout,
        title: poll.data.title,
        title_en: poll.data.title_en || '',
        question: poll.data.question,
        question_en: poll.data.question_en || '',
        isVisible: Boolean(poll.data.isVisible),
        isClosed: status.isClosed,
        isStopped: status.isStopped,
        isExpired: status.isExpired,
        startedAt: status.startedAt,
        endsAt: status.endsAt,
        stoppedAt: status.stoppedAt,
        lifecycleAvailable: Boolean(service),
        durationHours: poll.data.duration_hours,
        showLiveResults: poll.data.show_live_results,
        options: sondageOptions(poll),
      };
    }),
  });
};
