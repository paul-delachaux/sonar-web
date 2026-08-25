import fs from 'node:fs/promises';
import path from 'node:path';
import bundledAccounts from '../data/cms-accounts.json';
import {
  accountsError,
  FALLBACK_ACCOUNTS,
  parseAccounts,
  serializeAccounts,
  type CmsAccount,
} from './cms-accounts';

const REPO = 'paul-delachaux/sonar-web';
const BRANCH = 'main';
const FILE_PATH = 'src/data/cms-accounts.json';
const LOCAL_FILE = path.join(process.cwd(), FILE_PATH);

async function gh<T>(token: string, apiPath: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'le-sonar-admin',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message || `GitHub HTTP ${res.status}`);
  return data;
}

export async function readLocalAccounts(): Promise<CmsAccount[]> {
  try {
    const raw = await fs.readFile(LOCAL_FILE, 'utf8');
    const parsed = parseAccounts(JSON.parse(raw));
    if (parsed.length) return parsed;
  } catch {
    /* JSON bundlé, puis repli */
  }
  const bundled = parseAccounts(bundledAccounts);
  return bundled.length ? bundled : FALLBACK_ACCOUNTS;
}

export async function readGithubAccounts(token: string): Promise<CmsAccount[] | null> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'le-sonar-admin',
      },
    },
  );
  if (!res.ok) return null;
  const text = await res.text();
  try {
    return parseAccounts(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function loadCmsAccounts(token?: string): Promise<CmsAccount[]> {
  if (token) {
    try {
      const remote = await readGithubAccounts(token);
      if (remote && remote.length) return remote;
    } catch {
      /* fichier local en repli */
    }
  }
  return readLocalAccounts();
}

export async function writeLocalAccounts(accounts: CmsAccount[]): Promise<void> {
  const error = accountsError(accounts);
  if (error) throw new Error(error);
  await fs.writeFile(LOCAL_FILE, serializeAccounts(accounts), 'utf8');
}

export async function writeGithubAccounts(token: string, accounts: CmsAccount[]): Promise<void> {
  const error = accountsError(accounts);
  if (error) throw new Error(error);
  const current = await gh<{ sha?: string }>(
    token,
    `/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
  );
  await gh(token, `/repos/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'cms: mise à jour des comptes admin',
      content: Buffer.from(serializeAccounts(accounts), 'utf8').toString('base64'),
      sha: current.sha,
      branch: BRANCH,
    }),
  });
}

export async function inviteGithubCollaborator(
  token: string,
  login: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/collaborators/${encodeURIComponent(login)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'le-sonar-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ permission: 'push' }),
    },
  );
  if (res.status === 201 || res.status === 204) {
    return {
      ok: true,
      message:
        res.status === 201
          ? `Invitation GitHub envoyée à ${login}.`
          : `${login} est déjà collaborateur du dépôt.`,
    };
  }
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  return {
    ok: false,
    message:
      data.message ||
      `Invitation GitHub impossible (${res.status}). Ajoutez ${login} manuellement comme collaborateur Write du dépôt.`,
  };
}
