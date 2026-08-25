import type { APIRoute } from 'astro';
import { cmsGithubToken, requireCmsSuperadmin } from '../../../utils/admin-github';
import {
  accountsError,
  findAccount,
  isGithubLogin,
  normalizeLogin,
  parseAccounts,
} from '../../../utils/cms-accounts';
import {
  inviteGithubCollaborator,
  loadCmsAccounts,
  writeGithubAccounts,
  writeLocalAccounts,
} from '../../../utils/cms-accounts-store';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireCmsSuperadmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);
  const accounts = await loadCmsAccounts(cmsGithubToken(request) || undefined);
  return json({ accounts, login: auth.login, role: auth.role });
};

export const PUT: APIRoute = async ({ request }) => {
  const auth = await requireCmsSuperadmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const body = await request.json().catch(() => ({}));
  const accounts = parseAccounts(body);
  const error = accountsError(accounts);
  if (error) return json({ message: error }, 400);

  const self = findAccount(accounts, auth.login);
  if (auth.login !== 'local-dev' && (!self || self.role !== 'superadmin')) {
    return json({ message: 'Vous ne pouvez pas retirer votre propre droit superadmin.' }, 400);
  }

  const token = cmsGithubToken(request);
  if (import.meta.env.DEV) {
    await writeLocalAccounts(accounts);
  } else {
    if (!token) return json({ message: 'Connectez-vous à GitHub dans l’admin.' }, 401);
    await writeGithubAccounts(token, accounts);
  }

  let invite: { ok: boolean; message: string } | null = null;
  const inviteLogin = normalizeLogin(String(body?.invite || ''));
  if (inviteLogin && token && isGithubLogin(inviteLogin)) {
    invite = await inviteGithubCollaborator(token, inviteLogin);
  }

  return json({ ok: true, accounts, invite });
};
