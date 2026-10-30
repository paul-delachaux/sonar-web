import type { APIRoute } from 'astro';
import { cmsGithubToken, requireCmsAdmin } from '../../../utils/admin-github';
import { loadCmsAccounts } from '../../../utils/cms-accounts-store';
import { editableProfileText, parseAuthorProfiles } from '../../../utils/author-profiles';
import {
  loadAuthorProfiles,
  replaceAuthorProfiles,
  saveAuthorProfile,
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

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const token = cmsGithubToken(request);
  try {
    const profiles = await loadAuthorProfiles();
    if (auth.role === 'superadmin') {
      const accounts = import.meta.env.DEV
        ? await loadCmsAccounts()
        : await loadCmsAccounts(token || undefined);
      if (!accounts.some((account) => normalizeLogin(account.login) === normalizeLogin(auth.login))) {
        accounts.push({ login: auth.login, role: 'superadmin' });
      }
      return json({
        profiles,
        accounts,
        login: auth.login,
        role: auth.role,
        githubName: auth.githubName || '',
        avatarUrl: auth.avatarUrl || '',
      });
    }

    const profile = profiles.find((candidate) =>
      normalizeLogin(candidate.account || '') === normalizeLogin(auth.login)
    );
    if (!profile) return json({
      profile: null,
      login: auth.login,
      role: auth.role,
      githubName: auth.githubName || '',
      avatarUrl: auth.avatarUrl || '',
    });
    return json({
      profile,
      login: auth.login,
      role: auth.role,
      githubName: auth.githubName || '',
      avatarUrl: auth.avatarUrl || '',
    });
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
    current = await loadAuthorProfiles();
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
    if (auth.role === 'superadmin') {
      await replaceAuthorProfiles(updated);
    } else {
      const profile = updated.find((candidate) =>
        normalizeLogin(candidate.account || '') === normalizeLogin(auth.login)
      );
      if (!profile) return json({ message: 'Aucun profil auteur n’est associé à ce compte.' }, 403);
      await saveAuthorProfile(profile);
    }
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
