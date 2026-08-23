import type { APIRoute } from 'astro';
import { requireCmsAdmin } from '../../../utils/admin-github';
import { createServiceClient } from '../../../utils/service-client';
import { supabase } from '../../../utils/supabase';

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

function asCommentId(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseReasons(row: { reason?: string | null; reasons?: string[] | null }): string[] {
  if (Array.isArray(row.reasons) && row.reasons.length) {
    return row.reasons.filter(Boolean);
  }
  const raw = String(row.reason || '');
  if (!raw) return [];
  return raw.split(',').map((part) => part.trim()).filter(Boolean);
}

function reasonLabels(codes: string[]): string {
  return codes.map((code) => REASON_LABELS[code] || code).join(', ');
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

  let reportQuery = await admin
    .from('comment_reports')
    .select('id, comment_id, reporter_id, reason, reasons, details, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (reportQuery.error) {
    reportQuery = await admin
      .from('comment_reports')
      .select('id, comment_id, reporter_id, reason, details, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
  }

  const { data: reports, error } = reportQuery;

  if (error) {
    return json({ message: error.message || 'Impossible de charger les signalements.' }, 500);
  }

  const rows = reports || [];
  const commentIds = [...new Set(rows.map((row) => asCommentId(row.comment_id)).filter((id): id is number => id != null))];
  const reporterIds = [...new Set(rows.map((row) => row.reporter_id).filter(Boolean))];

  const commentsById: Record<string, any> = {};
  for (const id of commentIds) {
    const { data: comment } = await supabase.from('comments').select('*').eq('id', id).maybeSingle();
    if (comment) commentsById[String(comment.id)] = comment;
  }

  const accountsById: Record<string, { username: string }> = {};
  const accountIds = [
    ...reporterIds,
    ...Object.values(commentsById).map((c) => c.account_id).filter(Boolean),
  ];
  if (accountIds.length) {
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, username')
      .in('id', [...new Set(accountIds)]);
    for (const account of accounts || []) {
      accountsById[account.id] = { username: account.username };
    }
  }

  const grouped = new Map<string, any>();
  for (const row of rows) {
    const key = String(asCommentId(row.comment_id) ?? row.comment_id);
    const comment = commentsById[key];
    if (!grouped.has(key)) {
      grouped.set(key, {
        comment_id: asCommentId(comment?.id) ?? asCommentId(row.comment_id),
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
      reason: parseReasons(row)[0] || row.reason,
      reasons: parseReasons(row),
      reason_label: reasonLabels(parseReasons(row)),
      details: row.details || '',
      reporter: accountsById[row.reporter_id]?.username || 'Utilisateur',
      created_at: row.created_at,
    });
  }

  const items = [...grouped.values()].map((item) => {
    const allReasons = [...new Set((item.reports || []).flatMap((report: any) => report.reasons || []))];
    const latest = (item.reports || []).reduce((max: number, report: any) => {
      const ts = new Date(report.created_at || 0).getTime();
      return ts > max ? ts : max;
    }, 0);
    return {
      ...item,
      report_count: item.reports.length,
      reason_sort: reasonLabels(allReasons),
      latest_report_at: latest ? new Date(latest).toISOString() : item.comment_created_at,
    };
  });

  return json({ items, count: items.length });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const admin = createServiceClient();
  if (!admin) return json({ message: 'Supabase n’est pas configuré.' }, 503);

  try {
    const body = await request.json();
    const commentId = asCommentId(body?.comment_id);
    const action = String(body?.action || '').trim();
    if (commentId == null) {
      return json({ message: 'Commentaire introuvable.' }, 400);
    }

    if (action === 'keep') {
      const { error } = await admin
        .from('comment_reports')
        .update({ status: 'dismissed', reviewed_at: new Date().toISOString() })
        .eq('comment_id', commentId)
        .eq('status', 'pending');
      if (error) return json({ message: error.message || 'Impossible de conserver le commentaire.' }, 500);
      return json({ success: true, action: 'keep' });
    }

    if (action === 'delete') {
      const rpc = await admin.rpc('moderation_delete_comment', { p_comment_id: commentId });
      if (!rpc.error) return json({ success: true, action: 'delete' });

      const reportsDelete = await admin.from('comment_reports').delete().eq('comment_id', commentId);
      if (reportsDelete.error) {
        return json({ message: reportsDelete.error.message || 'Impossible de retirer les signalements.' }, 500);
      }
      const commentDelete = await admin.from('comments').delete().eq('id', commentId);
      if (commentDelete.error) {
        return json({ message: commentDelete.error.message || 'Impossible de supprimer le commentaire.' }, 500);
      }
      return json({ success: true, action: 'delete' });
    }

    return json({ message: 'Action inconnue.' }, 400);
  } catch {
    return json({ message: 'Erreur serveur.' }, 500);
  }
};
