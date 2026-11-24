import type { APIRoute } from 'astro';
import { requireCmsAdmin } from '../../../utils/admin-github';
import { createServiceClient } from '../../../utils/service-client';

export const prerender = false;

const TABLE = 'admin_site_feedback';
const BUCKET = 'admin-feedback';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 3;
const MAX_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 5000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type FeedbackAttachment = {
  path: string;
  name: string;
  type: string;
  size: number;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

function supabaseSetupMessage(error: { code?: string; message?: string }) {
  if (error.code === '42P01' || error.code === 'PGRST205' || /relation .* does not exist/i.test(error.message || '')) {
    return 'Le module de retours n’est pas configuré dans Supabase. Exécutez supabase/admin-feedback.sql.';
  }
  if (error.code === '404' || /bucket .* not found|bucket not found/i.test(error.message || '')) {
    return 'Le stockage des captures n’est pas configuré. Exécutez supabase/admin-feedback.sql.';
  }
  return error.message || 'Une erreur Supabase est survenue.';
}

function validImageBytes(type: string, bytes: Uint8Array) {
  if (type === 'image/png') {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50
      && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d
      && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (type === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === 'image/webp') {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}

function safeFileName(name: string) {
  return String(name || 'capture')
    .replace(/[\\/\0]/g, '-')
    .replace(/[^\w.-]+/g, '-')
    .slice(0, 120) || 'capture';
}

async function signedAttachments(
  admin: NonNullable<ReturnType<typeof createServiceClient>>,
  attachments: FeedbackAttachment[],
) {
  const results = await Promise.all(attachments.map(async (attachment) => {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(attachment.path, 3600);
    if (error) throw new Error(supabaseSetupMessage(error));
    return { ...attachment, url: data.signedUrl };
  }));
  return results;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const admin = createServiceClient();
  if (!admin) return json({ message: 'La clé SUPABASE_SERVICE_ROLE_KEY manque.' }, 503);

  let query = admin
    .from(TABLE)
    .select('id, title, body, status, attachments, created_by, created_by_name, created_at, updated_at, resolved_by, resolved_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (auth.role !== 'superadmin') query = query.eq('created_by', auth.login);

  const { data, error } = await query;
  if (error) {
    console.error('[admin/feedback] Could not load feedback:', error);
    return json({ message: supabaseSetupMessage(error) }, 503);
  }

  try {
    const feedback = await Promise.all((data || []).map(async (item) => ({
      ...item,
      attachments: await signedAttachments(admin, (Array.isArray(item.attachments) ? item.attachments : []) as FeedbackAttachment[]),
    })));
    return json({ feedback });
  } catch (error) {
    console.error('[admin/feedback] Could not sign attachments:', error);
    return json({ message: error instanceof Error ? error.message : 'Impossible de charger les captures.' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const admin = createServiceClient();
  if (!admin) return json({ message: 'La clé SUPABASE_SERVICE_ROLE_KEY manque.' }, 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ message: 'Le formulaire est invalide.' }, 400);
  }

  const title = String(form.get('title') || '').trim();
  const body = String(form.get('body') || '').trim();
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return json({ message: 'Le titre doit contenir de 1 à 160 caractères.' }, 400);
  }
  if (!body || body.length > MAX_BODY_LENGTH) {
    return json({ message: 'La description doit contenir de 1 à 5 000 caractères.' }, 400);
  }

  const submittedFiles = form.getAll('screenshots');
  if (submittedFiles.some((item) => !(item instanceof File))) {
    return json({ message: 'Une capture envoyée n’est pas un fichier valide.' }, 400);
  }
  const files = (submittedFiles as File[]).filter((file) => file.size > 0);
  if (files.length > MAX_FILES) return json({ message: 'Ajoutez au maximum 3 captures d’écran.' }, 400);
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) return json({ message: 'Chaque capture doit faire 4 Mo maximum.' }, 413);
    if (!IMAGE_TYPES.has(file.type)) return json({ message: 'Formats acceptés : PNG, JPEG et WebP.' }, 400);
  }

  const uploaded: FeedbackAttachment[] = [];
  try {
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!validImageBytes(file.type, bytes)) {
        if (uploaded.length) {
          const { error } = await admin.storage.from(BUCKET).remove(uploaded.map((item) => item.path));
          if (error) console.error('[admin/feedback] Could not clean up invalid uploads:', error);
        }
        return json({ message: 'Le contenu d’une capture ne correspond pas à son format déclaré.' }, 400);
      }
      const path = `${crypto.randomUUID()}/${safeFileName(file.name)}`;
      const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
        upsert: false,
        contentType: file.type,
        cacheControl: '3600',
      });
      if (error) throw new Error(supabaseSetupMessage(error));
      uploaded.push({ path, name: safeFileName(file.name), type: file.type, size: file.size });
    }

    const { data, error } = await admin
      .from(TABLE)
      .insert({
        title,
        body,
        status: 'pending',
        attachments: uploaded,
        created_by: auth.login,
        created_by_name: auth.githubName || auth.login,
      })
      .select('id')
      .single();
    if (error) throw new Error(supabaseSetupMessage(error));
    return json({ ok: true, id: data.id }, 201);
  } catch (error) {
    if (uploaded.length) {
      const { error: cleanupError } = await admin.storage.from(BUCKET).remove(uploaded.map((item) => item.path));
      if (cleanupError) console.error('[admin/feedback] Could not clean up failed uploads:', cleanupError);
    }
    console.error('[admin/feedback] Could not create feedback:', error);
    return json({ message: error instanceof Error ? error.message : 'Impossible d’enregistrer le retour.' }, 500);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);
  if (auth.role !== 'superadmin') return json({ message: 'Réservé aux superadmins.' }, 403);

  const admin = createServiceClient();
  if (!admin) return json({ message: 'La clé SUPABASE_SERVICE_ROLE_KEY manque.' }, 503);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ message: 'La requête est invalide.' }, 400);
  }

  const id = typeof payload.id === 'string' ? payload.id : '';
  const status = payload.status;
  if (!UUID_PATTERN.test(id)) return json({ message: 'La demande sélectionnée est invalide.' }, 400);
  if (status !== 'pending' && status !== 'resolved') return json({ message: 'Le statut demandé est invalide.' }, 400);

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from(TABLE)
    .update({
      status,
      updated_at: now,
      resolved_by: status === 'resolved' ? auth.login : null,
      resolved_at: status === 'resolved' ? now : null,
    })
    .eq('id', id)
    .select('id, status, updated_at, resolved_by, resolved_at')
    .maybeSingle();

  if (error) {
    console.error('[admin/feedback] Could not update feedback:', error);
    return json({ message: supabaseSetupMessage(error) }, 500);
  }
  if (!data) return json({ message: 'Cette demande n’existe plus.' }, 404);
  return json({ ok: true, feedback: data });
};

export const DELETE: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const admin = createServiceClient();
  if (!admin) return json({ message: 'La clé SUPABASE_SERVICE_ROLE_KEY manque.' }, 503);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ message: 'La requête est invalide.' }, 400);
  }

  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!UUID_PATTERN.test(id)) return json({ message: 'La demande sélectionnée est invalide.' }, 400);

  const { data: item, error: readError } = await admin
    .from(TABLE)
    .select('id, status, created_by, attachments')
    .eq('id', id)
    .maybeSingle();

  if (readError) {
    console.error('[admin/feedback] Could not load feedback for deletion:', readError);
    return json({ message: supabaseSetupMessage(readError) }, 500);
  }
  if (!item) return json({ message: 'Cette demande n’existe plus.' }, 404);

  const isOwner = item.created_by === auth.login;
  const mayCancelOwnRequest = auth.role === 'admin' && isOwner && item.status === 'pending';
  const mayDeleteResolvedRequest = auth.role === 'superadmin' && item.status === 'resolved';
  if (!mayCancelOwnRequest && !mayDeleteResolvedRequest) {
    return json({
      message: auth.role === 'superadmin'
        ? 'Un superadmin peut supprimer uniquement les demandes résolues.'
        : 'Vous pouvez annuler uniquement vos propres demandes en attente.',
    }, 403);
  }

  let deletion = admin
    .from(TABLE)
    .delete()
    .eq('id', id)
    .eq('status', auth.role === 'superadmin' ? 'resolved' : 'pending');
  if (auth.role !== 'superadmin') deletion = deletion.eq('created_by', auth.login);

  const { data, error } = await deletion
    .select('id, attachments')
    .maybeSingle();

  if (error) {
    console.error('[admin/feedback] Could not delete feedback:', error);
    return json({ message: supabaseSetupMessage(error) }, 500);
  }
  if (!data) return json({ message: 'Le statut de cette demande a changé. Actualisez la liste et réessayez.' }, 409);

  const attachments = (Array.isArray(data.attachments) ? data.attachments : []) as FeedbackAttachment[];
  const paths = attachments.map((attachment) => attachment.path).filter((path): path is string => Boolean(path));
  if (paths.length) {
    const { error: storageError } = await admin.storage.from(BUCKET).remove(paths);
    if (storageError) {
      console.error('[admin/feedback] Could not remove feedback attachments:', storageError);
      return json({ message: 'Demande supprimée, mais certaines captures n’ont pas pu être supprimées.' }, 500);
    }
  }
  return json({ ok: true, id });
};
