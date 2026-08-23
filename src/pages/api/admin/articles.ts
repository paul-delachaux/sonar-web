import type { APIRoute } from 'astro';
import { requireCmsAdmin } from '../../../utils/admin-github';
import { listAdminArticles } from '../../../utils/admin-articles';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const auth = await requireCmsAdmin(request);
    if (!auth.ok) return json({ message: auth.message }, auth.status);
    const articles = await listAdminArticles();
    return json({ articles, count: articles.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Impossible de charger les articles.';
    return json({ message }, 500);
  }
};
