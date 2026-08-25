export type CmsRole = 'superadmin' | 'admin';

export type CmsAccount = {
  login: string;
  role: CmsRole;
  label?: string;
};

const GITHUB_LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

export function normalizeLogin(login: string): string {
  return String(login || '').trim().replace(/^@/, '').toLowerCase();
}

export function isGithubLogin(login: string): boolean {
  return GITHUB_LOGIN.test(String(login || '').trim().replace(/^@/, ''));
}

export function parseAccounts(data: unknown): CmsAccount[] {
  const raw = data && typeof data === 'object' ? (data as { accounts?: unknown }).accounts : data;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CmsAccount[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { login?: unknown; role?: unknown; label?: unknown };
    const login = normalizeLogin(String(row.login || ''));
    if (!login || !isGithubLogin(login) || seen.has(login)) continue;
    const role: CmsRole = row.role === 'superadmin' ? 'superadmin' : 'admin';
    const label = String(row.label || '').trim();
    seen.add(login);
    out.push(label ? { login, role, label } : { login, role });
  }
  return out;
}

export function findAccount(accounts: CmsAccount[], login: string): CmsAccount | null {
  const needle = normalizeLogin(login);
  return accounts.find((account) => account.login === needle) || null;
}

export function accountsError(accounts: CmsAccount[]): string | null {
  if (!accounts.length) return 'Ajoutez au moins un compte.';
  if (!accounts.some((account) => account.role === 'superadmin')) {
    return 'Il doit rester au moins un superadmin.';
  }
  for (const account of accounts) {
    if (!isGithubLogin(account.login)) {
      return `Identifiant GitHub invalide : ${account.login}`;
    }
  }
  return null;
}

export function serializeAccounts(accounts: CmsAccount[]): string {
  return `${JSON.stringify({ accounts }, null, 2)}\n`;
}

/** Repli si le JSON n’est pas encore déployé ou illisible sur le serveur. */
export const FALLBACK_ACCOUNTS: CmsAccount[] = [
  { login: 'paul-delachaux', role: 'superadmin', label: 'Paul Delachaux' },
];
