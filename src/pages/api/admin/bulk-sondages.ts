import type { APIRoute } from 'astro';
import { cmsGithubToken, requireCmsSuperadmin } from '../../../utils/admin-github';
import { applyBulkGithub, applyBulkLocal, type BulkAction } from '../../../utils/admin-bulk';
import { createServiceClient } from '../../../utils/service-client';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

function responseTableMessage(error: { code?: string; message?: string }) {
  if (error.code === '42P01' || error.code === 'PGRST205' || /relation .* does not exist/i.test(error.message || '')) {
    return 'Les réponses de La Sonde ne sont pas configurées dans Supabase. Exécutez supabase/sondage-responses.sql.';
  }
  return 'Impossible de vérifier ou supprimer les réponses du sondage dans Supabase.';
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireCmsSuperadmin(request);
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

  const action = body.action as BulkAction;
  if (action !== 'show' && action !== 'hide' && action !== 'delete') {
    return json({ message: 'Action inconnue.' }, 400);
  }
  if (!Array.isArray(body.slugs) || body.slugs.length === 0 || body.slugs.length > 200) {
    return json({ message: 'Sélectionnez entre 1 et 200 sondages.' }, 400);
  }
  if (body.slugs.some((slug) => typeof slug !== 'string')) {
    return json({ message: 'La sélection contient un identifiant de sondage invalide.' }, 400);
  }
  const uniqueSlugs = [...new Set((body.slugs as string[]).map((slug) => slug.trim()))];
  if (uniqueSlugs.some((slug) =>
    !slug ||
    slug.length > 160 ||
    /[\/\\\u0000]/.test(slug) ||
    slug === '.' ||
    slug === '..'
  )) {
    return json({ message: 'La sélection contient un identifiant de sondage invalide.' }, 400);
  }

  const service = action === 'delete' ? createServiceClient() : null;
  if (action === 'delete' && !service) {
    return json({ message: 'La clé de service Supabase manque : les sondages ne peuvent pas être supprimés.' }, 503);
  }

  try {
    if (service) {
      const { error } = await service.from('sondage_responses').select('poll_slug').limit(1);
      if (error) {
        console.error('[admin/bulk-sondages] Could not verify response table:', error);
        return json({ message: responseTableMessage(error) }, 503);
      }
    }

    const source = import.meta.env.DEV
      ? await applyBulkLocal(action, uniqueSlugs, 'sondages')
      : await (async () => {
        const token = cmsGithubToken(request);
        if (!token) throw new Error('Connectez-vous à GitHub dans l’admin.');
        return applyBulkGithub(token, action, uniqueSlugs, 'sondages');
      })();

    if (action === 'delete' && service) {
      const { error } = await service
        .from('sondage_responses')
        .delete()
        .in('poll_slug', uniqueSlugs);
      if (error) {
        console.error('[admin/bulk-sondages] Poll content deleted, but response cleanup failed:', error);
        return json({
          message: 'Le sondage a été supprimé du contenu, mais ses réponses n’ont pas pu être supprimées de Supabase. Réessayez la suppression pour terminer le nettoyage.',
          done: source.done,
          missing: source.missing,
          partial: true,
        }, 502);
      }
    }

    return json({ ok: true, source: import.meta.env.DEV ? 'local' : 'github', ...source });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action impossible.';
    console.error('[admin/bulk-sondages] Bulk operation failed:', error);
    return json({ message }, 500);
  }
};
