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

export function safeRedirectPath(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
