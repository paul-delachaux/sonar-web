import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    __SONAR_SUPABASE_URL__?: string;
    __SONAR_SUPABASE_ANON_KEY__?: string;
  }
}

export type ArticleFont = 'sans' | 'serif' | 'editorial';
export type ArticleFontSize = 'small' | 'medium' | 'large';

export type Account = {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  avatar_color: string;
  article_font?: ArticleFont | null;
  article_font_size?: ArticleFontSize | null;
};

let client: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (client) return client;

  const url = window.__SONAR_SUPABASE_URL__;
  const key = window.__SONAR_SUPABASE_ANON_KEY__;
  if (!url || !key) {
    throw new Error("Supabase n'est pas configuré.");
  }

  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return client;
}

export async function getCurrentAccount(): Promise<Account | null> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return null;

  const baseSelect = 'id, first_name, last_name, username, email, phone, avatar_url, avatar_color';
  const withPrefs = `${baseSelect}, article_font, article_font_size`;

  let { data, error } = await supabase
    .from('accounts')
    .select(withPrefs)
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) {
    const fallback = await supabase
      .from('accounts')
      .select(baseSelect)
      .eq('id', session.user.id)
      .maybeSingle();
    data = fallback.data;
  }

  return data as Account | null;
}

export async function saveArticlePrefs(accountId: string, prefs: {
  article_font?: ArticleFont;
  article_font_size?: ArticleFontSize;
}): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await supabase.from('accounts').update(prefs).eq('id', accountId);
  if (error) throw error;
}

export type ArticleFavorite = {
  article_slug: string;
  created_at: string;
};

export async function listFavoriteSlugs(): Promise<ArticleFavorite[]> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return [];

  const { data, error } = await supabase
    .from('article_favorites')
    .select('article_slug, created_at')
    .eq('account_id', session.user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as ArticleFavorite[];
}

export async function isArticleFavorite(slug: string): Promise<boolean> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return false;

  const { data, error } = await supabase
    .from('article_favorites')
    .select('article_slug')
    .eq('account_id', session.user.id)
    .eq('article_slug', slug)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function setArticleFavorite(slug: string, favorite: boolean): Promise<boolean> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    const err = new Error('AUTH_REQUIRED');
    err.name = 'AuthRequired';
    throw err;
  }

  if (favorite) {
    const { error } = await supabase.from('article_favorites').insert({
      account_id: session.user.id,
      article_slug: slug,
    });
    if (error && error.code !== '23505') throw error;
    return true;
  }

  const { error } = await supabase
    .from('article_favorites')
    .delete()
    .eq('account_id', session.user.id)
    .eq('article_slug', slug);

  if (error) throw error;
  return false;
}

export type ReadLaterItem = {
  article_slug: string;
  title: string;
  title_en: string | null;
  created_at: string;
  next_remind_at: string;
};

export type AppNotification = {
  id: string;
  type: string;
  article_slug: string | null;
  title: string;
  title_en: string | null;
  body?: string | null;
  comment_id?: number | string | null;
  actor_usernames?: string[] | null;
  read_at: string | null;
  created_at: string;
};

function requireSessionError(): never {
  const err = new Error('AUTH_REQUIRED');
  err.name = 'AuthRequired';
  throw err;
}

export async function listReadLaterItems(): Promise<ReadLaterItem[]> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return [];

  const { data, error } = await supabase
    .from('article_read_later')
    .select('article_slug, title, title_en, created_at, next_remind_at')
    .eq('account_id', session.user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as ReadLaterItem[];
}

export async function isArticleReadLater(slug: string): Promise<boolean> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return false;

  const { data, error } = await supabase
    .from('article_read_later')
    .select('article_slug')
    .eq('account_id', session.user.id)
    .eq('article_slug', slug)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function setArticleReadLater(
  slug: string,
  enabled: boolean,
  meta?: { title?: string; title_en?: string | null; next_remind_at?: string }
): Promise<boolean> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) requireSessionError();

  if (enabled) {
    const { error } = await supabase.from('article_read_later').insert({
      account_id: session.user.id,
      article_slug: slug,
      title: meta?.title || '',
      title_en: meta?.title_en || null,
      next_remind_at: meta?.next_remind_at,
    });
    if (error && error.code !== '23505') throw error;
    return true;
  }

  const { error } = await supabase
    .from('article_read_later')
    .delete()
    .eq('account_id', session.user.id)
    .eq('article_slug', slug);

  if (error) throw error;
  return false;
}

export async function snoozeReadLater(slug: string, nextRemindAt: string): Promise<void> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) requireSessionError();

  const { error } = await supabase
    .from('article_read_later')
    .update({ next_remind_at: nextRemindAt })
    .eq('account_id', session.user.id)
    .eq('article_slug', slug);

  if (error) throw error;
}

export async function snoozeReadLaterMany(slugs: string[], nextRemindAt: string): Promise<void> {
  const unique = [...new Set(slugs.filter(Boolean))];
  if (unique.length === 0) return;

  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) requireSessionError();

  const { error } = await supabase
    .from('article_read_later')
    .update({ next_remind_at: nextRemindAt })
    .eq('account_id', session.user.id)
    .in('article_slug', unique);

  if (error) throw error;
}

export async function listNotifications(): Promise<AppNotification[]> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return [];

  const fullSelect = 'id, type, article_slug, title, title_en, body, comment_id, actor_usernames, read_at, created_at';
  let { data, error } = await supabase
    .from('notifications')
    .select(fullSelect)
    .eq('account_id', session.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    const fallback = await supabase
      .from('notifications')
      .select('id, type, article_slug, title, title_en, read_at, created_at')
      .eq('account_id', session.user.id)
      .order('created_at', { ascending: false });
    if (fallback.error) throw fallback.error;
    data = fallback.data;
  }

  return (data || []).map((row: any) => ({
    ...row,
    comment_id: row.comment_id == null ? null : row.comment_id,
    actor_usernames: Array.isArray(row.actor_usernames) ? row.actor_usernames : [],
  })) as AppNotification[];
}

export type AccountPreview = {
  username: string;
  avatar_url: string | null;
  avatar_color: string;
};

export async function listAccountPreviewsByUsernames(
  usernames: string[]
): Promise<Map<string, AccountPreview>> {
  const unique = [...new Set(usernames.map((name) => String(name || '').trim()).filter(Boolean))];
  const result = new Map<string, AccountPreview>();
  if (unique.length === 0) return result;

  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from('accounts')
    .select('username, avatar_url, avatar_color')
    .in('username', unique);

  if (error) throw error;
  for (const row of data || []) {
    const preview: AccountPreview = {
      username: row.username,
      avatar_url: row.avatar_url ?? null,
      avatar_color: row.avatar_color || '#ea580c',
    };
    result.set(String(row.username).toLowerCase(), preview);
  }
  return result;
}

export async function setNotificationRead(id: string, read: boolean): Promise<void> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) requireSessionError();

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: read ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('account_id', session.user.id);

  if (error) throw error;
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) requireSessionError();

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('account_id', session.user.id)
    .is('read_at', null);

  if (error) throw error;
}

export async function deleteNotifications(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;

  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) requireSessionError();

  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('account_id', session.user.id)
    .in('id', unique);

  if (error) throw error;
}

export async function deleteAllNotifications(): Promise<void> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) requireSessionError();

  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('account_id', session.user.id);

  if (error) throw error;
}

export async function syncReadLaterReminders(defaultRemindAt: string): Promise<void> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return;

  const nowIso = new Date().toISOString();
  const items = await listReadLaterItems();
  const existing = await listNotifications();

  for (const item of items) {
    if (item.next_remind_at > nowIso) continue;

    const hasUnread = existing.some(
      (notif) =>
        notif.type === 'read_later' &&
        notif.article_slug === item.article_slug &&
        !notif.read_at
    );
    if (hasUnread) continue;

    const { error: insertError } = await supabase.from('notifications').insert({
      account_id: session.user.id,
      type: 'read_later',
      article_slug: item.article_slug,
      title: item.title,
      title_en: item.title_en,
    });
    if (insertError) throw insertError;

    const { error: updateError } = await supabase
      .from('article_read_later')
      .update({ next_remind_at: defaultRemindAt })
      .eq('account_id', session.user.id)
      .eq('article_slug', item.article_slug);
    if (updateError) throw updateError;
  }
}

export async function listMyCommentLikes(commentIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(commentIds.filter(Boolean))];
  if (unique.length === 0) return new Set();

  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return new Set();

  const { data, error } = await supabase
    .from('comment_likes')
    .select('comment_id')
    .eq('account_id', session.user.id)
    .in('comment_id', unique);

  if (error) throw error;
  return new Set((data || []).map((row) => String(row.comment_id)));
}

export async function setCommentLiked(commentId: string, liked: boolean): Promise<void> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    const err = new Error('AUTH_REQUIRED');
    err.name = 'AuthRequired';
    throw err;
  }

  if (liked) {
    const { error } = await supabase.from('comment_likes').insert({
      comment_id: commentId,
      account_id: session.user.id,
    });
    if (error && error.code !== '23505') throw error;
    return;
  }

  const { error } = await supabase
    .from('comment_likes')
    .delete()
    .eq('comment_id', commentId)
    .eq('account_id', session.user.id);

  if (error) throw error;
}

export async function deleteOwnComment(commentId: string): Promise<void> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    const err = new Error('AUTH_REQUIRED');
    err.name = 'AuthRequired';
    throw err;
  }

  const { error } = await supabase
    .from('comments')
    .delete()
    .eq('id', commentId)
    .eq('account_id', session.user.id);

  if (error) throw error;
}

export function safeRedirectPath(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export const PRODUCTION_SITE_URL = 'https://le-sonar.vercel.app';

export function getAuthRedirectUrl(path = '/auth/confirm'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (typeof window === 'undefined') return `${PRODUCTION_SITE_URL}${normalized}`;
  const origin = window.location.origin;
  const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');
  return `${isLocal ? origin : PRODUCTION_SITE_URL}${normalized}`;
}
