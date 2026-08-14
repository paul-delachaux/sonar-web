import type { APIRoute } from 'astro';
import { supabase } from '../../utils/supabase';
import { BANNED_WORDS } from '../../utils/bannedWords'; // 👈 Ton import ici

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.json();
    const { article_slug, author_name, content } = data;

    if (!article_slug || !author_name || !content) {
      return new Response(
        JSON.stringify({ message: 'Tous les champs sont requis.' }),
        { status: 400 }
      );
    }

    // Vérification des mots ban
    const textToCheck = `${author_name} ${content}`.toLowerCase();
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

    // Envoi à Supabase si tout est OK
    const { data: newComment, error } = await supabase
      .from('comments')
      .insert([{ article_slug, author_name, content }])
      .select();

    if (error) {
      return new Response(JSON.stringify({ message: error.message }), {
        status: 500,
      });
    }

    return new Response(JSON.stringify({ success: true, data: newComment }), {
      status: 200,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ message: "Erreur serveur lors de l'envoi.'" }),
      { status: 500 }
    );
  }
};