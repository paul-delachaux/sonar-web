import type { APIRoute } from 'astro';
import { cmsGithubToken, requireCmsSuperadmin } from '../../../utils/admin-github';
import { applyBulkGithub, applyBulkLocal, type BulkAction } from '../../../utils/admin-bulk';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await requireCmsSuperadmin(request);
    if (!auth.ok) return json({ message: auth.message }, auth.status);

    const body = await request.json().catch(() => ({}));
    const action = body?.action as BulkAction;
    const slugs = Array.isArray(body?.slugs)
      ? body.slugs.map((slug: unknown) => String(slug || '').trim()).filter(Boolean)
      : [];
    if (action !== 'show' && action !== 'hide' && action !== 'delete') {
      return json({ message: 'Action inconnue.' }, 400);
    }
    if (!slugs.length) return json({ message: 'Aucun contenu sélectionné.' }, 400);

    const token = cmsGithubToken(request);
    if (import.meta.env.DEV) {
      const local = await applyBulkLocal(action, slugs);
      return json({ ok: true, source: 'local', ...local });
    }
    if (!token) {
      return json({ message: 'Connectez-vous à GitHub dans l’admin.' }, 401);
    }
    const remote = await applyBulkGithub(token, action, slugs);
    return json({ ok: true, source: 'github', ...remote });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action impossible.';
    return json({ message }, 500);
  }
};
