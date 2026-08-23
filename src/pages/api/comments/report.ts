import type { APIRoute } from 'astro';
import { supabase, createSupabaseWithAuth } from '../../../utils/supabase';

export const prerender = false;

const REPORT_REASONS = ['insult', 'spam', 'illegal', 'offtopic', 'other'] as const;

async function insertReport(
  userClient: ReturnType<typeof createSupabaseWithAuth>,
  payload: { comment_id: string | number; reporter_id: string; reasons: string[]; details: string | null }
) {
  const withArray = await userClient.from('comment_reports').insert({
    comment_id: payload.comment_id,
    reporter_id: payload.reporter_id,
    reason: payload.reasons[0],
    reasons: payload.reasons,
    details: payload.details,
  });
  if (!withArray.error) return withArray;

  return userClient.from('comment_reports').insert({
    comment_id: payload.comment_id,
    reporter_id: payload.reporter_id,
    reason: payload.reasons.join(','),
    details: payload.details,
  });
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return new Response(
        JSON.stringify({ message: 'Connectez-vous pour signaler un commentaire.' }),
        { status: 401 }
      );
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return new Response(
        JSON.stringify({ message: 'Session expirée. Reconnectez-vous.' }),
        { status: 401 }
      );
    }

    const body = await request.json();
    const commentId = body?.comment_id;
    const rawReasons = Array.isArray(body?.reasons) ? body.reasons : [body?.reason];
    const reasons = [...new Set(
      rawReasons
        .map((value: unknown) => String(value || '').trim())
        .filter((value: string) => (REPORT_REASONS as readonly string[]).includes(value))
    )];
    const details = String(body?.details || '').trim().slice(0, 500);

    if (commentId == null || commentId === '') {
      return new Response(JSON.stringify({ message: 'Commentaire introuvable.' }), { status: 400 });
    }
    if (!reasons.length) {
      return new Response(JSON.stringify({ message: 'Choisissez au moins un motif de signalement.' }), { status: 400 });
    }

    const userClient = createSupabaseWithAuth(token);
    const { data: comment, error: commentError } = await userClient
      .from('comments')
      .select('id, account_id')
      .eq('id', commentId)
      .maybeSingle();

    if (commentError || !comment) {
      return new Response(JSON.stringify({ message: 'Commentaire introuvable.' }), { status: 404 });
    }
    if (comment.account_id && comment.account_id === authData.user.id) {
      return new Response(
        JSON.stringify({ message: 'Vous ne pouvez pas signaler votre propre commentaire.' }),
        { status: 400 }
      );
    }

    const { error } = await insertReport(userClient, {
      comment_id: comment.id,
      reporter_id: authData.user.id,
      reasons,
      details: details || null,
    });

    if (error) {
      if (error.code === '23505') {
        return new Response(
          JSON.stringify({ message: 'Vous avez déjà signalé ce commentaire.' }),
          { status: 409 }
        );
      }
      return new Response(
        JSON.stringify({ message: 'Impossible d’enregistrer le signalement pour le moment.' }),
        { status: 500 }
      );
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch {
    return new Response(JSON.stringify({ message: 'Erreur serveur.' }), { status: 500 });
  }
};
