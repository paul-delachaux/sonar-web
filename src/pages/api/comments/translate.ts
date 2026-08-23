import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../../../utils/supabase';
import { detectCommentLang, isTranslationConfigured, translateCommentText, type CommentLang } from '../../../utils/comment-translate';

export const prerender = false;

function serviceClient() {
  const url =
    import.meta.env.PUBLIC_SUPABASE_URL ||
    import.meta.env.SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!isTranslationConfigured()) {
    return new Response(
      JSON.stringify({ message: 'La traduction n’est pas encore configurée.' }),
      { status: 503 }
    );
  }

  try {
    const data = await request.json();
    const commentId = data?.id;
    const targetRaw = String(data?.target || '').toLowerCase();
    const target: CommentLang = targetRaw === 'en' ? 'en' : 'fr';

    if (commentId == null || commentId === '') {
      return new Response(JSON.stringify({ message: 'Commentaire introuvable.' }), { status: 400 });
    }

    let { data: comment, error } = await supabase
      .from('comments')
      .select('id, content, source_lang, translated_fr, translated_en')
      .eq('id', commentId)
      .maybeSingle();

    if (error) {
      const fallback = await supabase.from('comments').select('id, content').eq('id', commentId).maybeSingle();
      comment = fallback.data as typeof comment;
      error = fallback.error;
    }

    if (error || !comment) {
      return new Response(JSON.stringify({ message: 'Commentaire introuvable.' }), { status: 404 });
    }

    const original = String(comment.content || '').trim();
    const sourceLang = (comment.source_lang === 'en' || comment.source_lang === 'fr'
      ? comment.source_lang
      : detectCommentLang(original)) as CommentLang;

    if (sourceLang === target) {
      return new Response(
        JSON.stringify({ translated: original, source_lang: sourceLang, same: true }),
        { status: 200 }
      );
    }

    const cached = target === 'en' ? comment.translated_en : comment.translated_fr;
    if (cached && String(cached).trim()) {
      return new Response(
        JSON.stringify({ translated: cached, source_lang: sourceLang, cached: true }),
        { status: 200 }
      );
    }

    const translated = await translateCommentText(original.slice(0, 2000), target);
    if (!translated) {
      return new Response(
        JSON.stringify({ message: 'Traduction indisponible pour le moment.' }),
        { status: 502 }
      );
    }

    const admin = serviceClient();
    if (admin) {
      const patch: Record<string, string> = { source_lang: sourceLang };
      if (target === 'en') patch.translated_en = translated;
      else patch.translated_fr = translated;
      await admin.from('comments').update(patch).eq('id', comment.id);
    }

    return new Response(
      JSON.stringify({ translated, source_lang: sourceLang }),
      { status: 200 }
    );
  } catch {
    return new Response(JSON.stringify({ message: 'Erreur serveur.' }), { status: 500 });
  }
};
