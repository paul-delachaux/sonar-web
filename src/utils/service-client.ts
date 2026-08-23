import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from './server-env';

function jwtRole(key: string): string {
  if (!key.startsWith('eyJ')) return '';
  try {
    const payload = key.split('.')[1] || '';
    const json = Buffer.from(payload, 'base64').toString('utf8');
    return String(JSON.parse(json)?.role || '');
  } catch {
    return '';
  }
}

export function createServiceClient(): SupabaseClient | null {
  const url = serverEnv('PUBLIC_SUPABASE_URL') || serverEnv('SUPABASE_URL');
  const key = serverEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  if (key.startsWith('sb_publishable_')) return null;
  const role = jwtRole(key);
  if (role === 'anon' || role === 'authenticated') return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
