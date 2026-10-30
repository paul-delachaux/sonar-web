import bundledProfiles from '../data/author-profiles.json';
import { parseAuthorProfiles } from './author-profiles';
import { createServiceClient } from './service-client';
import type { AuthorProfile } from './authors';

const PROFILE_COLUMNS =
  'name, account, avatar, about, about_en, interests, interests_en, partners, partners_en';

function database() {
  const client = createServiceClient();
  if (!client) {
    throw new Error('La configuration Supabase serveur (SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY) est indisponible.');
  }
  return client;
}

function fromRows(rows: unknown): AuthorProfile[] {
  return parseAuthorProfiles({ authors: rows });
}

export async function loadAuthorProfiles(): Promise<AuthorProfile[]> {
  const { data, error } = await database()
    .from('author_profiles')
    .select(PROFILE_COLUMNS)
    .order('name');
  if (error) {
    throw new Error(
      error.code === '42P01'
        ? 'La table author_profiles manque dans Supabase. Exécutez supabase/author-profiles.sql.'
        : error.message || 'Lecture des profils auteurs impossible.',
    );
  }
  return fromRows(data || []);
}

export async function loadAuthorProfilesOrBundled(): Promise<AuthorProfile[]> {
  try {
    const profiles = await loadAuthorProfiles();
    return profiles.length ? profiles : fromRows((bundledProfiles as { authors?: unknown[] }).authors || []);
  } catch (error) {
    console.error('[author-profiles] Supabase read failed; using bundled profile data:', error);
    return fromRows((bundledProfiles as { authors?: unknown[] }).authors || []);
  }
}

export async function saveAuthorProfile(profile: AuthorProfile): Promise<AuthorProfile> {
  const { data, error } = await database()
    .from('author_profiles')
    .upsert({ ...profile, updated_at: new Date().toISOString() }, { onConflict: 'name' })
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw new Error(error.message || 'Enregistrement du profil auteur impossible.');
  return fromRows([data])[0];
}

export async function replaceAuthorProfiles(profiles: AuthorProfile[]): Promise<AuthorProfile[]> {
  const client = database();
  const { data: existing, error: listError } = await client
    .from('author_profiles')
    .select('name');
  if (listError) throw new Error(listError.message || 'Lecture des profils auteurs impossible.');

  if (profiles.length) {
    const { error } = await client
      .from('author_profiles')
      .upsert(profiles.map((profile) => ({
        ...profile,
        updated_at: new Date().toISOString(),
      })), { onConflict: 'name' });
    if (error) throw new Error(error.message || 'Enregistrement des profils auteurs impossible.');
  }

  const names = new Set(profiles.map((profile) => profile.name));
  for (const row of existing || []) {
    if (names.has(row.name)) continue;
    const { error } = await client.from('author_profiles').delete().eq('name', row.name);
    if (error) throw new Error(error.message || 'Suppression des profils auteurs retirés impossible.');
  }
  return profiles;
}

export async function uploadAuthorAvatar(
  profileName: string,
  fileName: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<AuthorProfile> {
  const client = database();
  const path = `${profileName.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}/${fileName}`;
  const { error: uploadError } = await client.storage
    .from('author-avatars')
    .upload(path, bytes, { upsert: true, contentType, cacheControl: '31536000' });
  if (uploadError) {
    throw new Error(
      uploadError.message.toLowerCase().includes('bucket')
        ? 'Le bucket author-avatars manque. Exécutez supabase/author-profiles.sql.'
        : uploadError.message || 'Envoi de l’image auteur impossible.',
    );
  }
  const { data } = client.storage.from('author-avatars').getPublicUrl(path);
  const { data: saved, error: saveError } = await client
    .from('author_profiles')
    .update({ avatar: data.publicUrl, updated_at: new Date().toISOString() })
    .eq('name', profileName)
    .select(PROFILE_COLUMNS)
    .single();
  if (saveError) throw new Error(saveError.message || 'Enregistrement de l’image auteur impossible.');
  return fromRows([saved])[0];
}
