import type { APIRoute } from 'astro';
import { requireCmsAdmin } from '../../../utils/admin-github';
import { listAdminArticles } from '../../../utils/admin-articles';
import { createServiceClient } from '../../../utils/service-client';
import { serverEnv } from '../../../utils/server-env';
import { supabase } from '../../../utils/supabase';

export const prerender = false;

type Period = 'today' | 'yesterday' | 'week' | 'month' | 'all';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function parisYmd(date = new Date()) {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function tzOffsetMs(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const hour = value('hour') === 24 ? 0 : value('hour');
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), hour, value('minute'), value('second'));
  return asUtc - instant.getTime();
}

function parisMidnight(y: number, m: number, d: number) {
  const utc = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = tzOffsetMs(new Date(utc), 'Europe/Paris');
  return new Date(utc - offset);
}

function addDays(ymd: { y: number; m: number; d: number }, delta: number) {
  const dt = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + delta));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function parisWeekdayMon1(date = new Date()) {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
  }).format(date);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[wd] || 1;
}

function periodBounds(period: string): { gte?: string; lt?: string } {
  const today = parisYmd();
  const todayStart = parisMidnight(today.y, today.m, today.d);
  if (period === 'today') return { gte: todayStart.toISOString() };
  if (period === 'yesterday') {
    const yesterday = addDays(today, -1);
    return {
      gte: parisMidnight(yesterday.y, yesterday.m, yesterday.d).toISOString(),
      lt: todayStart.toISOString(),
    };
  }
  if (period === 'week') {
    const monday = addDays(today, -(parisWeekdayMon1() - 1));
    return { gte: parisMidnight(monday.y, monday.m, monday.d).toISOString() };
  }
  if (period === 'month') {
    return { gte: parisMidnight(today.y, today.m, 1).toISOString() };
  }
  return {};
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const auth = await requireCmsAdmin(request);
    if (!auth.ok) return json({ message: auth.message }, auth.status);

    const admin = createServiceClient();
    const db = admin || supabase;
    if (!admin) {
      const url = serverEnv('PUBLIC_SUPABASE_URL') || serverEnv('SUPABASE_URL');
      const anon = serverEnv('PUBLIC_SUPABASE_ANON_KEY') || serverEnv('SUPABASE_ANON_KEY');
      if (!url || !anon) {
        return json({ message: 'Supabase n’est pas configuré (URL / clé).' }, 503);
      }
    }

    const search = new URL(request.url).searchParams;
    const articleFilter = search.get('article')?.trim() || '';
    const period = (search.get('period')?.trim() || 'all') as Period;
    const bounds = periodBounds(period);

    let query = db
      .from('comments')
      .select('id, content, author_name, article_slug, account_id, created_at, parent_id')
      .order('created_at', { ascending: false })
      .limit(500);

    if (articleFilter) query = query.eq('article_slug', articleFilter);
    if (bounds.gte) query = query.gte('created_at', bounds.gte);
    if (bounds.lt) query = query.lt('created_at', bounds.lt);

    const { data: comments, error } = await query;
    if (error) {
      return json({ message: error.message || 'Impossible de charger les commentaires.' }, 500);
    }

    const rows = comments || [];
    const accountIds = [...new Set(rows.map((row) => row.account_id).filter(Boolean))];
    const accountsById: Record<string, { username: string }> = {};
    if (accountIds.length) {
      const { data: accounts } = await db.from('accounts').select('id, username').in('id', accountIds);
      for (const account of accounts || []) {
        accountsById[account.id] = { username: account.username };
      }
    }

    const catalog = await listAdminArticles();
    const titleBySlug: Record<string, string> = {};
    for (const article of catalog) {
      titleBySlug[article.slug] = article.title;
    }

    const items = rows.map((row) => {
      const slug = String(row.article_slug || '');
      return {
        comment_id: row.id,
        content: row.content,
        author_name: accountsById[row.account_id]?.username || row.author_name || 'Anonyme',
        article_slug: slug,
        article_title: titleBySlug[slug] || slug,
        article_href: slug ? `/articles/${slug}` : '#',
        comment_created_at: row.created_at,
        is_reply: Boolean(row.parent_id),
      };
    });

    return json({ items, count: items.length, period });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Impossible de charger les commentaires.';
    return json({ message }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireCmsAdmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const admin = createServiceClient();
  if (!admin) return json({ message: 'Supabase n’est pas configuré.' }, 503);

  const body = await request.json().catch(() => ({}));
  const commentId = Number(body?.comment_id);
  if (!Number.isFinite(commentId)) {
    return json({ message: 'Commentaire introuvable.' }, 400);
  }

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
};
