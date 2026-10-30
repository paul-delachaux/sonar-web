import type { APIRoute } from 'astro';
import { cmsGithubToken, requireCmsAdmin } from '../../../utils/admin-github';
import { loadCmsAccounts } from '../../../utils/cms-accounts-store';
import { editableProfileText, parseAuthorProfiles } from '../../../utils/author-profiles';
import {
  loadAuthorProfiles,
  readLocalAuthorProfiles,
  writeGithubAuthorProfiles,
  writeLocalAuthorProfiles,
} from '../../../utils/author-profiles-store';
import type { AuthorProfile } from '../../../utils/authors';
import { normalizeLogin } from '../../../utils/cms-accounts';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

async function saveProfiles(request: Request, profiles: AuthorProfile[]): Promise<void> {
  const token = cmsGithubToken(request);
  if (import.meta.env.DEV) {
    await writeLocalAuthorProfiles(profiles);
    return;
  }
  if (!token) throw new Error('Connectez-vous à GitHub dans l’admin.');
  await writeGithubAuthorProfiles(token, profiles);
}

async function getAuthorProfiles(request: Request): Promise<AuthorProfile[]> {
  if (import.meta.env.DEV) return readLocalAuthorProfiles();
  return loadAuthorProfiles(cmsGithubToken(request) || undefined);
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const token = cmsGithubToken(request);
  try {
    const profiles = await getAuthorProfiles(request);
    if (auth.role === 'superadmin') {
      const accounts = import.meta.env.DEV
        ? await loadCmsAccounts()
        : await loadCmsAccounts(token || undefined);
      if (!accounts.some((account) => normalizeLogin(account.login) === normalizeLogin(auth.login))) {
        accounts.push({ login: auth.login, role: 'superadmin' });
      }
      return json({ profiles, accounts, login: auth.login, role: auth.role });
    }

    const profile = profiles.find((candidate) =>
      normalizeLogin(candidate.account || '') === normalizeLogin(auth.login)
    );
    if (!profile) return json({ profile: null, login: auth.login, role: auth.role });
    return json({ profile, login: auth.login, role: auth.role });
  } catch (error) {
    return json({
      message: error instanceof Error ? error.message : 'Lecture des profils auteurs impossible.',
    }, 500);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ message: 'Données de profil invalides.' }, 400);
  let current: AuthorProfile[];
  try {
    current = await getAuthorProfiles(request);
  } catch (error) {
    return json({
      message: error instanceof Error ? error.message : 'Lecture des profils auteurs impossible.',
    }, 500);
  }

  let updated: AuthorProfile[];
  try {
    if (auth.role === 'superadmin') {
      if (!Array.isArray(body.profiles)) {
        return json({ message: 'La liste des profils est requise.' }, 400);
      }
      updated = parseAuthorProfiles({ authors: body.profiles });
    } else {
      const currentProfile = current.find((profile) =>
        normalizeLogin(profile.account || '') === normalizeLogin(auth.login)
      );
      if (!currentProfile) return json({ message: 'Aucun profil auteur n’est associé à ce compte.' }, 403);
      const profileInput = body.profile && typeof body.profile === 'object'
        ? body.profile as Record<string, unknown>
        : {};
      const editable = editableProfileText(profileInput);
      updated = current.map((profile) =>
        profile.name === currentProfile.name ? { ...currentProfile, ...editable } : profile
      );
      updated = parseAuthorProfiles({ authors: updated });
    }
  } catch (error) {
    return json({
      message: error instanceof Error ? error.message : 'Enregistrement des profils auteurs impossible.',
    }, 400);
  }

  try {
    await saveProfiles(request, updated);
  } catch (error) {
    return json({
      message: error instanceof Error ? error.message : 'Enregistrement des profils auteurs impossible.',
    }, 500);
  }
  if (auth.role !== 'superadmin') {
    const profile = updated.find((candidate) =>
      normalizeLogin(candidate.account || '') === normalizeLogin(auth.login)
    );
    return json({ ok: true, profile });
  }
  return json({ ok: true, profiles: updated });
};
