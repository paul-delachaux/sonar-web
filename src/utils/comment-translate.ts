import { serverEnv } from './server-env';

export type CommentLang = 'fr' | 'en';

const FR_HINTS =
  /\b(le|la|les|des|une|est|pas|pour|que|avec|dans|cette|vous|nous|mais|plus|tout|bien|comme|aussi|très|etre|être|j'ai|c'est|ça)\b/gi;
const EN_HINTS =
  /\b(the|and|is|are|this|that|with|for|you|have|not|just|from|they|what|about|because|would|could)\b/gi;

export function detectCommentLang(text: string): CommentLang {
  const sample = String(text || '').slice(0, 600);
  const frAccents = /[éèêëàâùûçîïôœ]/i.test(sample);
  const frHits = (sample.match(FR_HINTS) || []).length + (frAccents ? 2 : 0);
  const enHits = (sample.match(EN_HINTS) || []).length;
  if (enHits > frHits + 1) return 'en';
  return 'fr';
}

async function translateWithDeepL(text: string, target: CommentLang): Promise<string | null> {
  const apiKey = serverEnv('DEEPL_API_KEY');
  if (!apiKey) return null;
  const hosts = String(apiKey).endsWith(':fx')
    ? ['https://api-free.deepl.com']
    : ['https://api-free.deepl.com', 'https://api.deepl.com'];
  const body = new URLSearchParams();
  body.set('text', text);
  body.set('target_lang', target === 'en' ? 'EN' : 'FR');
  body.set('preserve_formatting', '1');

  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/v2/translate`, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!res.ok) continue;
      const payload = await res.json();
      const translated = payload?.translations?.[0]?.text;
      if (typeof translated === 'string' && translated.trim()) return translated.trim();
    } catch {
      /* on tente l’autre hôte DeepL */
    }
  }
  return null;
}

export function isTranslationConfigured(): boolean {
  return Boolean(serverEnv('DEEPL_API_KEY'));
}

export async function translateCommentText(text: string, target: CommentLang): Promise<string | null> {
  const input = String(text || '').trim();
  if (!input) return null;
  return translateWithDeepL(input, target);
}
