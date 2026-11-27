import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { createServiceClient } from '../../../utils/service-client';
import { loadPollLifecycles, pollLifecycleStatus } from '../../../utils/sondage-lifecycle';
import { orderSondages } from '../../../utils/sondages-order';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async () => {
  const polls = orderSondages(await getCollection('sondages'));
  const service = createServiceClient();
  if (!service) return json({ message: 'Le service de sondage n’est pas configuré.' }, 503);

  try {
    const records = await loadPollLifecycles(service, polls, true);
    return json({
      polls: polls.map((poll) => ({
        slug: poll.id,
        isVisible: poll.data.isVisible,
        ...pollLifecycleStatus(poll, records),
        showLiveResults: poll.data.show_live_results,
      })),
    });
  } catch (error) {
    console.error('[sondages/state] Could not load poll lifecycle:', error);
    return json({ message: 'Impossible de charger l’état des sondages.' }, 503);
  }
};
