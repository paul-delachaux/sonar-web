import type { APIRoute } from 'astro';
import { supabase, createSupabaseWithAuth } from '../../../utils/supabase';

export const prerender = false;

const REPORT_REASONS = ['insult', 'spam', 'illegal', 'offtopic', 'other'] as const;

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
    const reason = String(body?.reason || '').trim();
    const details = String(body?.details || '').trim().slice(0, 500);

    if (commentId == null || commentId === '') {
      return new Response(JSON.stringify({ message: 'Commentaire introuvable.' }), { status: 400 });
    }
    if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
      return new Response(JSON.stringify({ message: 'Choisissez un motif de signalement.' }), { status: 400 });
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

    const { error } = await userClient.from('comment_reports').insert({
      comment_id: comment.id,
      reporter_id: authData.user.id,
      reason,
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
