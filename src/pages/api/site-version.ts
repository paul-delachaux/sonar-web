import type { APIRoute } from 'astro';
import { serverEnv } from '../../utils/server-env';

export const prerender = false;

export const GET: APIRoute = async () => {
  const sha = serverEnv('VERCEL_GIT_COMMIT_SHA') || serverEnv('GITHUB_SHA');
  const deploymentId = serverEnv('VERCEL_DEPLOYMENT_ID');
  const env = serverEnv('VERCEL_ENV') || (import.meta.env.DEV ? 'development' : '');

  return new Response(
    JSON.stringify({
      sha,
      shortSha: sha ? sha.slice(0, 7) : '',
      deploymentId,
      env,
      local: env === 'development' || !sha,
    }),
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    },
  );
};
