import type { APIRoute } from 'astro';
import { supabase, createSupabaseWithAuth } from '../../utils/supabase';
import { BANNED_WORDS } from '../../utils/bannedWords';

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
    const { article_slug, content } = data;

    if (!article_slug || !content || !String(content).trim()) {
      return new Response(
        JSON.stringify({ message: 'Le commentaire ne peut pas être vide.' }),
        { status: 400 }
      );
    }

    const userClient = createSupabaseWithAuth(token);

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

    const textToCheck = `${account.username} ${content}`.toLowerCase();
    const containsBannedWord = BANNED_WORDS.some((word) =>
      textToCheck.includes(word.toLowerCase())
    );

    if (containsBannedWord) {
      return new Response(
        JSON.stringify({
          message: 'Votre commentaire contient du vocabulaire inapproprié.',
        }),
        { status: 400 }
      );
    }

    const { data: newComment, error } = await userClient
      .from('comments')
      .insert([
        {
          article_slug,
          author_name: account.username,
          content: String(content).trim(),
          account_id: account.id,
        },
      ])
      .select();

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
