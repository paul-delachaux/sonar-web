import type { APIRoute } from 'astro';
import { supabase, createSupabaseWithAuth } from '../../utils/supabase';
import { moderateComment } from '../../utils/comment-moderation';
import { detectCommentLang } from '../../utils/comment-translate';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return new Response(
        JSON.stringify({ message: 'Vous devez être connecté pour commenter.' }),
        { status: 401 }
      );
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return new Response(
        JSON.stringify({ message: 'Session expirée. Reconnectez-vous pour commenter.' }),
        { status: 401 }
      );
    }

    const data = await request.json();
    const { article_slug, content, parent_id, reply_to_id } = data;

    if (!article_slug || !content || !String(content).trim()) {
      return new Response(
        JSON.stringify({ message: 'Le commentaire ne peut pas être vide.' }),
        { status: 400 }
      );
    }

    const userClient = createSupabaseWithAuth(token);

    let rootParentId: string | number | null = null;
    let replyToId: string | number | null = null;
    if (parent_id) {
      const { data: parent, error: parentError } = await userClient
        .from('comments')
        .select('id, parent_id, article_slug')
        .eq('id', parent_id)
        .maybeSingle();

      if (parentError || !parent || parent.article_slug !== article_slug) {
        return new Response(
          JSON.stringify({ message: 'Commentaire parent introuvable.' }),
          { status: 400 }
        );
      }
      rootParentId = parent.parent_id || parent.id;
      replyToId = reply_to_id || parent.id;

      if (reply_to_id && String(reply_to_id) !== String(parent.id)) {
        const { data: replyTarget } = await userClient
          .from('comments')
          .select('id, article_slug')
          .eq('id', reply_to_id)
          .maybeSingle();
        if (replyTarget && replyTarget.article_slug === article_slug) {
          replyToId = replyTarget.id;
        }
      }
    }

    const { data: account, error: accountError } = await userClient
      .from('accounts')
      .select('id, username, avatar_url, avatar_color')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ message: 'Profil introuvable. Reconnectez-vous.' }),
        { status: 403 }
      );
    }

    const textToCheck = `${account.username} ${content}`;
    const moderation = await moderateComment(textToCheck);
    if (moderation.blocked) {
      return new Response(
        JSON.stringify({
          message: 'Votre commentaire contient du vocabulaire inapproprié.',
        }),
        { status: 400 }
      );
    }

    const insertRow: Record<string, unknown> = {
      article_slug,
      author_name: account.username,
      content: String(content).trim(),
      account_id: account.id,
      source_lang: detectCommentLang(String(content)),
    };
    if (rootParentId) insertRow.parent_id = rootParentId;
    if (replyToId) insertRow.reply_to_id = replyToId;

    let { data: newComment, error } = await userClient
      .from('comments')
      .insert([insertRow])
      .select();

    if (error && insertRow.reply_to_id) {
      const { reply_to_id: _ignored, ...withoutReplyTo } = insertRow;
      const retry = await userClient.from('comments').insert([withoutReplyTo]).select();
      newComment = retry.data;
      error = retry.error;
    }

    if (error) {
      const fallback: Record<string, unknown> = {
        article_slug,
        author_name: account.username,
        content: String(content).trim(),
        account_id: account.id,
      };
      if (rootParentId) fallback.parent_id = rootParentId;
      const retry = await userClient.from('comments').insert([fallback]).select();
      newComment = retry.data;
      error = retry.error;
    }

    if (error) {
      return new Response(JSON.stringify({ message: error.message }), {
        status: 500,
      });
    }

    const inserted = Array.isArray(newComment) ? newComment[0] : newComment;

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          ...inserted,
          username: account.username,
          avatar_url: account.avatar_url,
          avatar_color: account.avatar_color,
        },
      }),
      { status: 200 }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ message: "Erreur serveur lors de l'envoi.'" }),
      { status: 500 }
    );
  }
};
