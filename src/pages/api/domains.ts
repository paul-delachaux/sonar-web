import type { APIRoute } from 'astro';
import { domains, subdomains } from '../../data/domains';

export const prerender = false;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ domains, subdomains }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
