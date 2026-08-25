import type { APIRoute } from 'astro';
import { readLocalCmsFile } from '../../utils/cms-accounts-store';

export const prerender = false;

export const GET: APIRoute = async () => {
  const file = await readLocalCmsFile();
  return new Response(JSON.stringify({ siteAccess: file.siteAccess }), {
    status: 200,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
};
