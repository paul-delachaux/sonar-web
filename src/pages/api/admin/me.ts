import type { APIRoute } from 'astro';
import { cmsGithubToken, requireCmsAdmin } from '../../../utils/admin-github';
import { loadCmsAccounts } from '../../../utils/cms-accounts-store';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) {
    return new Response(JSON.stringify({ message: auth.message }), {
      status: auth.status,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
    });
  }
  const token = cmsGithubToken(request);
  const accounts = await loadCmsAccounts(token || undefined);
  return new Response(
    JSON.stringify({
      login: auth.login,
      role: auth.role,
      superadmin: auth.role === 'superadmin',
      accounts: auth.role === 'superadmin' ? accounts : undefined,
    }),
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
    },
  );
};
