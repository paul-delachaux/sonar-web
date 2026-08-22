export function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Échappe le texte puis met les @pseudos en évidence. */
export function formatCommentBody(value: string) {
  return escapeHtml(value).replace(
    /(^|\s)(@[A-Za-zÀ-ÿ0-9_]+)/g,
    '$1<span class="comment-mention">$2</span>'
  );
}

export function commentPermalink(slug: string, commentId: string | number | null | undefined) {
  const base = `/articles/${slug}`;
  if (commentId == null || commentId === '') return base;
  return `${base}?comment=${encodeURIComponent(String(commentId))}`;
}

export function formatLikeActors(names: string[], lang: 'FR' | 'EN') {
  const list = names.map((name) => String(name || '').trim()).filter(Boolean);
  const others = Math.max(0, list.length - 3);
  const shown = list.slice(0, 3);

  if (lang === 'EN') {
    if (shown.length === 0) return 'Someone liked your comment';
    if (shown.length === 1) return `${shown[0]} liked your comment`;
    if (shown.length === 2) return `${shown[0]} and ${shown[1]} liked your comment`;
    if (others === 0) return `${shown[0]}, ${shown[1]} and ${shown[2]} liked your comment`;
    return `${shown[0]}, ${shown[1]}, ${shown[2]} and ${others} other${others > 1 ? 's' : ''} liked your comment`;
  }

  if (shown.length === 0) return 'Quelqu’un a liké votre commentaire';
  if (shown.length === 1) return `${shown[0]} a liké votre commentaire`;
  if (shown.length === 2) return `${shown[0]} et ${shown[1]} ont liké votre commentaire`;
  if (others === 0) return `${shown[0]}, ${shown[1]} et ${shown[2]} ont liké votre commentaire`;
  return `${shown[0]}, ${shown[1]}, ${shown[2]} et ${others} autres ont liké votre commentaire`;
}

export function formatReplyActor(name: string | null | undefined, lang: 'FR' | 'EN') {
  const actor = String(name || '').trim();
  if (lang === 'EN') {
    return actor ? `${actor} replied to your comment` : 'Someone replied to your comment';
  }
  return actor ? `${actor} a répondu à votre commentaire` : 'Quelqu’un a répondu à votre commentaire';
}
