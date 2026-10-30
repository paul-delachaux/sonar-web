import type { APIRoute } from 'astro';
import bundledProfiles from '../../data/author-profiles.json';
import { parseAuthorProfiles } from '../../utils/author-profiles';
import { readLocalAuthorProfiles } from '../../utils/author-profiles-store';

export const prerender = false;

export const GET: APIRoute = async () => {
  const profiles = import.meta.env.DEV
    ? await readLocalAuthorProfiles()
    : parseAuthorProfiles(bundledProfiles);
  return new Response(JSON.stringify({ authors: profiles.map(({ name }) => name) }), {
    status: 200,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
};
