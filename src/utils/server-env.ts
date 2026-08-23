/** Secrets serveur : Vite n’expose pas les variables sans préfixe PUBLIC_ dans import.meta.env. */
export function serverEnv(name: string): string {
  const fromProcess =
    typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  const fromMeta = (import.meta.env as Record<string, string | undefined>)[name];
  return String(fromProcess || fromMeta || '')
    .trim()
    .replace(/^["']|["']$/g, '');
}
