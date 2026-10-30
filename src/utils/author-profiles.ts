import type { AuthorProfile } from './authors';
import { isGithubLogin, normalizeLogin } from './cms-accounts';

const PROFILE_TEXT_FIELDS = [
  'about',
  'about_en',
  'interests',
  'interests_en',
  'partners',
  'partners_en',
] as const;

export type AuthorProfileText = Pick<AuthorProfile, typeof PROFILE_TEXT_FIELDS[number]>;

export function parseAuthorProfiles(data: unknown): AuthorProfile[] {
  const raw = data && typeof data === 'object'
    ? (data as { authors?: unknown }).authors
    : null;
  if (!Array.isArray(raw)) throw new Error('Le fichier des profils auteurs doit contenir une liste authors.');

  const profiles: AuthorProfile[] = [];
  const names = new Set<string>();
  const accounts = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      throw new Error('Chaque profil auteur doit être un objet valide.');
    }
    const row = item as Record<string, unknown>;
    const name = String(row.name || '').trim().replace(/\s+/g, ' ');
    const nameKey = name.toLocaleLowerCase();
    const account = normalizeLogin(String(row.account || ''));
    const avatar = String(row.avatar || '').trim();
    if (!name || name.length > 100 || names.has(nameKey)) {
      throw new Error('Chaque profil doit avoir un nom unique de 1 à 100 caractères.');
    }
    if (account && (!isGithubLogin(account) || accounts.has(account))) {
      throw new Error('Chaque login GitHub doit être valide et associé à un seul profil.');
    }
    names.add(nameKey);
    if (account) accounts.add(account);

    const profile: AuthorProfile = { name, ...(account ? { account } : {}) };
    if (avatar) {
      if (!/^\/assets\/uploads\/[a-zA-Z0-9._-]+$/.test(avatar)) {
        throw new Error('Le chemin de l’image auteur est invalide.');
      }
      profile.avatar = avatar;
    }
    for (const field of PROFILE_TEXT_FIELDS) {
      const value = String(row[field] || '').trim();
      if (value.length > 10000) {
        throw new Error('Les informations de profil ne peuvent pas dépasser 10 000 caractères.');
      }
      if (value) profile[field] = value;
    }
    profiles.push(profile);
  }
  return profiles;
}

export function serializeAuthorProfiles(profiles: AuthorProfile[]): string {
  return `${JSON.stringify({ authors: profiles }, null, 2)}\n`;
}

export function editableProfileText(data: unknown): AuthorProfileText {
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  return {
    about: String(row.about || '').trim(),
    about_en: String(row.about_en || '').trim(),
    interests: String(row.interests || '').trim(),
    interests_en: String(row.interests_en || '').trim(),
    partners: String(row.partners || '').trim(),
    partners_en: String(row.partners_en || '').trim(),
  };
}
