import { findAccount, type CmsRole } from './cms-accounts';
import { loadCmsAccounts } from './cms-accounts-store';

export type CmsAuthOk = { ok: true; login: string; role: CmsRole };
export type CmsAuthErr = { ok: false; status: number; message: string };
export type CmsAuth = CmsAuthOk | CmsAuthErr;

export function cmsGithubToken(request: Request): string {
  const sources = [
    request.headers.get('Authorization') || '',
    request.headers.get('X-Sonar-GitHub') || '',
    request.headers.get('X-Github-Token') || '',
  ];
  for (const source of sources) {
    const trimmed = source.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(?:Bearer|token)\s+(.+)$/i);
    if (match) return match[1].trim();
    if (trimmed.length > 8) return trimmed;
  }
  return '';
}

const CMS_REPO = 'paul-delachaux/sonar-web';

async function githubLogin(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'le-sonar-admin',
    },
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Session admin invalide.' : 'GitHub indisponible.');
  const user = await res.json();
  return String(user?.login || '').toLowerCase();
}

async function isGithubRepoAdmin(token: string, login: string): Promise<boolean> {
  const res = await fetch(`https://api.github.com/repos/${CMS_REPO}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'le-sonar-admin',
    },
  });
  if (!res.ok) return false;
  const repo = (await res.json()) as {
    owner?: { login?: string };
    permissions?: { admin?: boolean };
  };
  const owner = String(repo.owner?.login || '').toLowerCase();
  return owner === login || Boolean(repo.permissions?.admin);
}

export async function requireCmsAdmin(request: Request): Promise<CmsAuth> {
  const token = cmsGithubToken(request);

  if (!token) {
    if (import.meta.env.DEV) return { ok: true, login: 'local-dev', role: 'superadmin' };
    return { ok: false, status: 401, message: 'Connectez-vous à l’admin GitHub.' };
  }

  try {
    const login = await githubLogin(token);
    if (!login) {
      return { ok: false, status: 401, message: 'Session admin invalide.' };
    }
    const accounts = await loadCmsAccounts(token);
    const account = findAccount(accounts, login);
    if (account) return { ok: true, login: account.login, role: account.role };
    if (await isGithubRepoAdmin(token, login)) {
      return { ok: true, login, role: 'superadmin' };
    }
    return { ok: false, status: 403, message: 'Compte GitHub non autorisé.' };
  } catch (error) {
    if (import.meta.env.DEV) return { ok: true, login: 'local-dev', role: 'superadmin' };
    const message = error instanceof Error ? error.message : 'Vérification GitHub indisponible.';
    const status = message.includes('invalide') ? 401 : 503;
    return { ok: false, status, message };
  }
}

export async function requireCmsSuperadmin(request: Request): Promise<CmsAuth> {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return auth;
  if (auth.role !== 'superadmin') {
    return { ok: false, status: 403, message: 'Réservé aux superadmins.' };
  }
  return auth;
}
