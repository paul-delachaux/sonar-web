import { createHash } from 'node:crypto';
import type { APIRoute } from 'astro';
import { requireCmsAdmin } from '../../../utils/admin-github';
import { loadAuthorProfiles, uploadAuthorAvatar } from '../../../utils/author-profiles-store';
import { authorSlug, type AuthorProfile } from '../../../utils/authors';
import { normalizeLogin } from '../../../utils/cms-accounts';

export const prerender = false;

const MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES: Record<string, { extension: string; signature: (bytes: Uint8Array) => boolean }> = {
  'image/png': {
    extension: 'png',
    signature: (bytes) =>
      bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a,
  },
  'image/jpeg': {
    extension: 'jpg',
    signature: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  'image/webp': {
    extension: 'webp',
    signature: (bytes) =>
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP',
  },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ message: 'Formulaire invalide.' }, 400);
  }
  const name = String(form.get('name') || '').trim();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return json({ message: 'Image manquante.' }, 400);
  if (file.size > MAX_BYTES) return json({ message: 'Image trop lourde (maximum 4 Mo).' }, 413);

  const imageType = IMAGE_TYPES[file.type];
  if (!imageType) {
    return json({ message: 'Format non pris en charge. Utilisez une image PNG, JPEG ou WebP.' }, 415);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!imageType.signature(bytes)) return json({ message: 'Le contenu du fichier ne correspond pas à son format image.' }, 400);

  let profiles: AuthorProfile[];
  try {
    profiles = await loadAuthorProfiles();
  } catch (error) {
    return json({
      message: error instanceof Error ? error.message : 'Lecture des profils auteurs impossible.',
    }, 500);
  }
  const profile = profiles.find((candidate) =>
    candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  );
  if (!profile) return json({ message: 'Profil auteur introuvable.' }, 404);
  if (auth.role !== 'superadmin' &&
      normalizeLogin(profile.account || '') !== normalizeLogin(auth.login)) {
    return json({ message: 'Vous ne pouvez modifier que votre propre profil auteur.' }, 403);
  }

  const slug = authorSlug(profile.name);
  if (!slug) return json({ message: 'Le nom du profil ne permet pas de créer un nom de fichier.' }, 400);
  const imageHash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const fileName = `avatar-${slug}-${imageHash}.${imageType.extension}`;
  try {
    const savedProfile = await uploadAuthorAvatar(profile.name, fileName, bytes, file.type);
    return json({
      ok: true,
      profile: savedProfile,
      ...(auth.role === 'superadmin'
        ? { profiles: profiles.map((candidate) => candidate.name === profile.name ? savedProfile : candidate) }
        : {}),
    });
  } catch (error) {
    return json({
      message: error instanceof Error ? error.message : 'Enregistrement de l’image auteur impossible.',
    }, 500);
  }
};
