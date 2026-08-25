import type { APIRoute } from 'astro';
import { requireCmsAdmin } from '../../utils/admin-github';
import { loadCmsAccounts, readLocalAccounts } from '../../utils/cms-accounts-store';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const token =
    request.headers.get('Authorization') || request.headers.get('X-Sonar-GitHub') || '';
  const accounts = token
    ? await loadCmsAccounts(token.replace(/^(?:Bearer|token)\s+/i, '').trim())
    : await readLocalAccounts();
  return new Response(JSON.stringify({ accounts }), {
    status: 200,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
};
