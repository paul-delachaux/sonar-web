import type { APIRoute } from 'astro';
import { authorAvatarUrl } from '../../utils/authors';
import { loadAuthorProfilesOrBundled } from '../../utils/author-profiles-store';

export const prerender = false;

export const GET: APIRoute = async () => {
  const profiles = await loadAuthorProfilesOrBundled();
  return new Response(JSON.stringify({
    authors: profiles.map(({ name }) => name),
    avatars: Object.fromEntries(profiles.map(({ name }) => [name, authorAvatarUrl(name, profiles)])),
  }), {
    status: 200,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
};
