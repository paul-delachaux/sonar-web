const ALLOWED_LOGINS = new Set(['paul-delachaux', 'souslesonar-hash']);

export async function requireCmsAdmin(request: Request): Promise<
  { ok: true } | { ok: false; status: number; message: string }
> {
  const header = request.headers.get('Authorization') || '';
  const tokenMatch = header.match(/^(?:Bearer|token)\s+(.+)$/i);
  const token = tokenMatch ? tokenMatch[1].trim() : '';

  if (!token) {
    if (import.meta.env.DEV) return { ok: true };
    return { ok: false, status: 401, message: 'Connectez-vous à l’admin GitHub.' };
  }

  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'le-sonar-admin',
      },
    });
    if (!res.ok) {
      if (import.meta.env.DEV) return { ok: true };
      return { ok: false, status: 401, message: 'Session admin invalide.' };
    }
    const user = await res.json();
    const login = String(user?.login || '').toLowerCase();
    if (!ALLOWED_LOGINS.has(login)) {
      if (import.meta.env.DEV) return { ok: true };
      return { ok: false, status: 403, message: 'Compte GitHub non autorisé.' };
    }
    return { ok: true };
  } catch {
    if (import.meta.env.DEV) return { ok: true };
    return { ok: false, status: 503, message: 'Vérification GitHub indisponible.' };
  }
}
