import type { APIRoute } from 'astro';
import { requireCmsAdmin } from '../../../utils/admin-github';
import { createServiceClient } from '../../../utils/service-client';

export const prerender = false;

const BUCKET = 'cms-media';
const MAX_BYTES = 4 * 1024 * 1024;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

function safeName(name: string) {
  return String(name || 'image')
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 180);
}

function setupHint(message: string) {
  const lower = String(message || '').toLowerCase();
  return (
    lower.includes('bucket') ||
    lower.includes('not found') ||
    lower.includes('does not exist')
  );
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const admin = createServiceClient();
  if (!admin) {
    return json(
      {
        message:
          'La clé SUPABASE_SERVICE_ROLE_KEY manque. Sans elle, l’aperçu admin pendant le build Vercel est indisponible.',
      },
      500,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ message: 'Formulaire invalide.' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File) || !file.size) {
    return json({ message: 'Fichier manquant.' }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ message: 'Fichier trop lourd (max 12 Mo).' }, 413);
  }

  const name = safeName(file.name);
  const path = 'uploads/' + name;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    upsert: true,
    contentType: file.type || 'application/octet-stream',
    cacheControl: '3600',
  });

  if (error) {
    return json(
      {
        message: setupHint(error.message)
          ? 'Le bucket cms-media n’existe pas encore. Dans Supabase → SQL Editor, exécute supabase/cms-media.sql.'
          : error.message || 'Échec de l’envoi Supabase.',
        setup: setupHint(error.message),
      },
      500,
    );
  }

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return json({
    ok: true,
    name,
    path: '/assets/uploads/' + name,
    url: data.publicUrl,
  });
};
