import type { APIRoute } from 'astro';
import { cmsGithubToken, requireCmsSuperadmin } from '../../../utils/admin-github';
import {
  accountsError,
  findAccount,
  isGithubLogin,
  normalizeLogin,
  parseAccounts,
  parseSiteAccess,
} from '../../../utils/cms-accounts';
import {
  inviteGithubCollaborator,
  loadCmsFile,
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
  const file = await loadCmsFile(cmsGithubToken(request) || undefined);
  return json({
    accounts: file.accounts,
    siteAccess: file.siteAccess,
    login: auth.login,
    role: auth.role,
  });
};

export const PUT: APIRoute = async ({ request }) => {
  const auth = await requireCmsSuperadmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const body = await request.json().catch(() => ({}));
  const current = await loadCmsFile(cmsGithubToken(request) || undefined);
  const accounts = Object.prototype.hasOwnProperty.call(body, 'accounts')
    ? parseAccounts(body)
    : current.accounts;
  const siteAccess = Object.prototype.hasOwnProperty.call(body, 'siteAccess')
    ? parseSiteAccess(body)
    : current.siteAccess;
  const error = accountsError(accounts);
  if (error) return json({ message: error }, 400);

  const self = findAccount(accounts, auth.login);
  if (auth.login !== 'local-dev' && (!self || self.role !== 'superadmin')) {
    return json({ message: 'Vous ne pouvez pas retirer votre propre droit superadmin.' }, 400);
  }

  const token = cmsGithubToken(request);
  if (import.meta.env.DEV) {
    await writeLocalAccounts(accounts, siteAccess);
  } else {
    if (!token) return json({ message: 'Connectez-vous à GitHub dans l’admin.' }, 401);
    await writeGithubAccounts(token, accounts, siteAccess);
  }

  let invite: { ok: boolean; message: string } | null = null;
  const inviteLogin = normalizeLogin(String(body?.invite || ''));
  if (inviteLogin && token && isGithubLogin(inviteLogin)) {
    invite = await inviteGithubCollaborator(token, inviteLogin);
  }

  return json({ ok: true, accounts, siteAccess, invite });
};
