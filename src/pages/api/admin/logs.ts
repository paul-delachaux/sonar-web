import type { APIRoute } from 'astro';
import { requireCmsAdmin, requireCmsSuperadmin } from '../../../utils/admin-github';
import { createServiceClient } from '../../../utils/service-client';

export const prerender = false;

const MAX_MESSAGE = 4000;
const MAX_STACK = 8000;
const MAX_HREF = 500;
const LIST_LIMIT = 200;
const DEDUP_MS = 2 * 60 * 1000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

function missingTable(error: { message?: string; code?: string } | null) {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '42P01' ||
    message.includes('does not exist') ||
    message.includes('schema cache')
  );
}

function tableHint() {
  return 'La table cms_error_logs n’existe pas encore. Dans Supabase → SQL Editor, exécute le fichier supabase/cms-error-logs.sql.';
}

function clip(value: unknown, max: number) {
  return String(value || '').slice(0, max);
}

function adminClient() {
  const admin = createServiceClient();
  if (!admin) {
    return {
      ok: false as const,
      response: json(
        {
          message:
            'La clé SUPABASE_SERVICE_ROLE_KEY manque ou n’est pas la clé service_role. Relance npm run dev après correction du .env.',
        },
        500,
      ),
    };
  }
  return { ok: true as const, admin };
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireCmsSuperadmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const client = adminClient();
  if (!client.ok) return client.response;

  const { data, error } = await client.admin
    .from('cms_error_logs')
    .select('id, created_at, level, source, message, stack, href, login, collection, entry_slug, status, extra, user_agent')
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);

  if (error) {
    if (missingTable(error)) return json({ message: tableHint(), setup: true, items: [] }, 200);
    return json({ message: error.message || 'Impossible de lire les logs.' }, 500);
  }

  return json({ items: data || [] });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const client = adminClient();
  if (!client.ok) return client.response;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return json({ message: 'JSON invalide.' }, 400);
  }

  const message = clip(body.message, MAX_MESSAGE).trim();
  if (!message) return json({ message: 'Message vide.' }, 400);

  const since = new Date(Date.now() - DEDUP_MS).toISOString();
  const { data: recent, error: recentError } = await client.admin
    .from('cms_error_logs')
    .select('id')
    .eq('login', auth.login)
    .eq('message', message)
    .gte('created_at', since)
    .limit(1);

  if (recentError) {
    if (missingTable(recentError)) return json({ message: tableHint(), setup: true }, 503);
    return json({ message: recentError.message || 'Impossible d’enregistrer le log.' }, 500);
  }

  if (recent && recent.length) {
    return json({ ok: true, duplicate: true, id: recent[0].id });
  }

  const extra = body.extra && typeof body.extra === 'object' ? body.extra : null;
  const { data, error } = await client.admin
    .from('cms_error_logs')
    .insert({
      level: clip(body.level || 'error', 20),
      source: clip(body.source || 'cms', 40),
      message,
      stack: clip(body.stack, MAX_STACK) || null,
      href: clip(body.href, MAX_HREF) || null,
      login: auth.login,
      collection: clip(body.collection, 120) || null,
      entry_slug: clip(body.entry_slug, 200) || null,
      status: Number.isFinite(Number(body.status)) ? Number(body.status) : null,
      extra,
      user_agent: clip(body.user_agent || request.headers.get('user-agent'), 400) || null,
    })
    .select('id')
    .single();

  if (error) {
    if (missingTable(error)) return json({ message: tableHint(), setup: true }, 503);
    return json({ message: error.message || 'Impossible d’enregistrer le log.' }, 500);
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  void client.admin.from('cms_error_logs').delete().lt('created_at', cutoff);

  return json({ ok: true, id: data?.id });
};

export const DELETE: APIRoute = async ({ request }) => {
  const auth = await requireCmsSuperadmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const client = adminClient();
  if (!client.ok) return client.response;

  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';

  if (id) {
    const { error } = await client.admin.from('cms_error_logs').delete().eq('id', id);
    if (error) return json({ message: error.message || 'Impossible de supprimer ce log.' }, 500);
    return json({ ok: true });
  }

  if (url.searchParams.get('all') === '1') {
    const { error } = await client.admin.from('cms_error_logs').delete().gte('created_at', '1970-01-01T00:00:00Z');
    if (error) return json({ message: error.message || 'Impossible de vider les logs.' }, 500);
    return json({ ok: true });
  }

  return json({ message: 'Précise id=… ou all=1.' }, 400);
};
