import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { createServiceClient } from '../../../utils/service-client';
import { supabase } from '../../../utils/supabase';
import { loadPollLifecycles, pollLifecycleStatus } from '../../../utils/sondage-lifecycle';
import { sondageOptions } from '../../../utils/sondages';

export const prerender = false;

const TABLE = 'sondage_responses';
const MAX_EXPLANATION_LENGTH = 200;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

async function authenticatedAccount(request: Request) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return { error: json({ message: 'Connectez-vous pour répondre à ce sondage.' }, 401) };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { error: json({ message: 'Votre session a expiré. Reconnectez-vous.' }, 401) };
  }

  const service = createServiceClient();
  if (!service) return { error: json({ message: 'Le service de sondage n’est pas configuré.' }, 503) };

  const { data: account, error: accountError } = await service
    .from('accounts')
    .select('id')
    .eq('id', data.user.id)
    .maybeSingle();
  if (accountError) {
    console.error('[sondages] Could not verify account:', accountError);
    return { error: json({ message: 'Impossible de vérifier votre compte.' }, 503) };
  }
  if (!account) return { error: json({ message: 'Votre profil de lecteur est introuvable.' }, 403) };

  return { accountId: account.id, service };
}

async function findPoll(slug: string) {
  const polls = await getCollection('sondages');
  return polls.find((poll) => poll.id === slug);
}

async function pollIsClosed(
  poll: NonNullable<Awaited<ReturnType<typeof findPoll>>>,
  service: NonNullable<ReturnType<typeof createServiceClient>>,
) {
  const records = await loadPollLifecycles(service, [poll], import.meta.env.PROD);
  return pollLifecycleStatus(poll, records).isClosed;
}

export const GET: APIRoute = async ({ request, url }) => {
  const auth = await authenticatedAccount(request);
  if ('error' in auth) return auth.error;

  const slug = url.searchParams.get('poll')?.trim() || '';
  if (!slug || slug.length > 160) return json({ message: 'Le sondage demandé est invalide.' }, 400);

  const poll = await findPoll(slug);
  if (!poll || !poll.data.isVisible) return json({ message: 'Ce sondage n’est pas disponible.' }, 404);
  try {
    if (await pollIsClosed(poll, auth.service)) {
      return json({ message: 'Ce sondage est terminé et n’accepte plus de réponses.' }, 410);
    }
  } catch (error) {
    console.error('[sondages] Could not verify poll lifecycle:', error);
    return json({ message: 'Impossible de vérifier si ce sondage est encore ouvert.' }, 503);
  }

  const { data, error } = await auth.service
    .from(TABLE)
    .select('option_id, option_ids, explanation')
    .eq('poll_slug', poll.id)
    .eq('account_id', auth.accountId)
    .maybeSingle();
  if (error) {
    console.error('[sondages] Could not load the account response:', error);
    return json({ message: 'Impossible de charger votre réponse.' }, 503);
  }

  return json({ response: data || null });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticatedAccount(request);
  if ('error' in auth) return auth.error;

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ message: 'La réponse envoyée est invalide.' }, 400);
  }

  const slug = typeof payload.poll_slug === 'string' ? payload.poll_slug.trim() : '';
  let optionIds: string[];
  if (Array.isArray(payload.option_ids)) {
    if (!payload.option_ids.every((optionId) => typeof optionId === 'string')) {
      return json({ message: 'La sélection envoyée est invalide.' }, 400);
    }
    optionIds = payload.option_ids.map((optionId) => (optionId as string).trim());
  } else {
    const optionId = typeof payload.option_id === 'string' ? payload.option_id.trim() : '';
    optionIds = optionId ? [optionId] : [];
  }
  const rawExplanation = typeof payload.explanation === 'string' ? payload.explanation : '';
  if (rawExplanation.length > MAX_EXPLANATION_LENGTH) {
    return json({ message: `Votre complément ne peut pas dépasser ${MAX_EXPLANATION_LENGTH} caractères.` }, 400);
  }
  const explanation = rawExplanation.trim();
  if (!slug || slug.length > 160) return json({ message: 'Le sondage demandé est invalide.' }, 400);

  const poll = await findPoll(slug);
  if (!poll || !poll.data.isVisible) return json({ message: 'Ce sondage n’est pas disponible.' }, 404);
  try {
    if (await pollIsClosed(poll, auth.service)) {
      return json({ message: 'Ce sondage est terminé et n’accepte plus de réponses.' }, 410);
    }
  } catch (error) {
    console.error('[sondages] Could not verify poll lifecycle:', error);
    return json({ message: 'Impossible de vérifier si ce sondage est encore ouvert.' }, 503);
  }
  const validOptions = sondageOptions(poll);
  const multipleChoice = poll.data.layout === 'multiple_choice';
  if (!optionIds.length
    || (!multipleChoice && optionIds.length !== 1)
    || new Set(optionIds).size !== optionIds.length
    || optionIds.some((optionId) => !validOptions.some((option) => option.id === optionId))) {
    return json({ message: 'Choisissez une réponse proposée.' }, 400);
  }

  const { error } = await auth.service
    .from(TABLE)
    .insert({
      poll_slug: poll.id,
      account_id: auth.accountId,
      option_id: optionIds[0],
      option_ids: optionIds,
      explanation,
    });
  if (error) {
    if (error.code === '23505') {
      return json({ message: 'Vous avez déjà répondu à ce sondage.' }, 409);
    }
    console.error('[sondages] Could not save the response:', error);
    return json({ message: 'Impossible d’enregistrer votre réponse pour le moment.' }, 503);
  }

  return json({ success: true });
};
