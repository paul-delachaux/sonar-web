import type { APIRoute } from 'astro';
import { requireCmsAdmin } from '../../../utils/admin-github';
import { createServiceClient } from '../../../utils/service-client';

export const prerender = false;

const REASON_LABELS: Record<string, string> = {
  insult: 'Insultes ou harcèlement',
  spam: 'Spam',
  illegal: 'Contenu illégal ou dangereux',
  offtopic: 'Hors-sujet',
  other: 'Autre',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const admin = createServiceClient();
  if (!admin) {
    return json(
      {
        message:
          'La clé SUPABASE_SERVICE_ROLE_KEY manque ou n’est pas la clé service_role (ce n’est pas la clé anon). Relance npm run dev après correction du .env.',
      },
      503
    );
  }

  const { data: reports, error } = await admin
    .from('comment_reports')
    .select('id, comment_id, reporter_id, reason, details, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    return json({ message: 'Impossible de charger les signalements.' }, 500);
  }

  const rows = reports || [];
  const commentIds = [...new Set(rows.map((row) => Number(row.comment_id) || row.comment_id))];
  const reporterIds = [...new Set(rows.map((row) => row.reporter_id).filter(Boolean))];

  const commentsById: Record<string, any> = {};
  if (commentIds.length) {
    const { data: comments, error: commentsError } = await admin
      .from('comments')
      .select('id, content, author_name, article_slug, account_id, created_at')
      .in('id', commentIds);
    if (!commentsError) {
      for (const comment of comments || []) {
        commentsById[String(comment.id)] = comment;
      }
    }
  }

  const accountsById: Record<string, { username: string }> = {};
  const accountIds = [
    ...reporterIds,
    ...Object.values(commentsById).map((c) => c.account_id).filter(Boolean),
  ];
  if (accountIds.length) {
    const { data: accounts } = await admin
      .from('accounts')
      .select('id, username')
      .in('id', [...new Set(accountIds)]);
    for (const account of accounts || []) {
      accountsById[account.id] = { username: account.username };
    }
  }

  const grouped = new Map<string, any>();
  for (const row of rows) {
    const key = String(row.comment_id);
    const comment = commentsById[key];
    if (!grouped.has(key)) {
      grouped.set(key, {
        comment_id: comment?.id ?? row.comment_id,
        content: comment?.content || 'Commentaire introuvable (peut-être déjà supprimé).',
        author_name: (comment && accountsById[comment.account_id]?.username) || comment?.author_name || 'Anonyme',
        article_slug: comment?.article_slug || '',
        article_href: comment?.article_slug ? `/articles/${comment.article_slug}` : '#',
        comment_created_at: comment?.created_at || row.created_at,
        reports: [],
      });
    }
    grouped.get(key).reports.push({
      id: row.id,
      reason: row.reason,
      reason_label: REASON_LABELS[row.reason] || row.reason,
      details: row.details || '',
      reporter: accountsById[row.reporter_id]?.username || 'Utilisateur',
      created_at: row.created_at,
    });
  }

  const items = [...grouped.values()].map((item) => ({
    ...item,
    report_count: item.reports.length,
  }));

  return json({ items, count: items.length });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const admin = createServiceClient();
  if (!admin) return json({ message: 'Supabase n’est pas configuré.' }, 503);

  try {
    const body = await request.json();
    const commentId = body?.comment_id;
    const action = String(body?.action || '').trim();
    if (commentId == null || commentId === '') {
      return json({ message: 'Commentaire introuvable.' }, 400);
    }

    if (action === 'keep') {
      const { error } = await admin
        .from('comment_reports')
        .update({ status: 'dismissed', reviewed_at: new Date().toISOString() })
        .eq('comment_id', commentId)
        .eq('status', 'pending');
      if (error) return json({ message: 'Impossible de conserver le commentaire.' }, 500);
      return json({ success: true, action: 'keep' });
    }

    if (action === 'delete') {
      const { error } = await admin.from('comments').delete().eq('id', commentId);
      if (error) return json({ message: 'Impossible de supprimer le commentaire.' }, 500);
      return json({ success: true, action: 'delete' });
    }

    return json({ message: 'Action inconnue.' }, 400);
  } catch {
    return json({ message: 'Erreur serveur.' }, 500);
  }
};
