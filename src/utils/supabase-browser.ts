import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    __SONAR_SUPABASE_URL__?: string;
    __SONAR_SUPABASE_ANON_KEY__?: string;
  }
}

export type Account = {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  avatar_color: string;
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

  const { data } = await supabase
    .from('accounts')
    .select('id, first_name, last_name, username, email, phone, avatar_url, avatar_color')
    .eq('id', session.user.id)
    .maybeSingle();

  return data as Account | null;
}

export function safeRedirectPath(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
