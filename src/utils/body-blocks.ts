export type MediaBlock = {
  id: string;
  type: 'image' | 'tweet';
  src?: string;
  caption?: string;
  caption_en?: string;
  url?: string;
  after: number;
  width?: number;
  height?: number;
  align?: 'left' | 'center';
};

export function asMediaAlign(value: unknown): 'left' | 'center' {
  return value === 'left' ? 'left' : 'center';
}

export function clampMediaWidth(value: unknown): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(100, Math.max(1, Math.round(n)));
}

export function clampMediaHeight(value: unknown): number | undefined {
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(100, Math.max(1, Math.round(n)));
}

function asAfter(value: unknown): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function newId(prefix: string): string {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}

export function splitParagraphs(md: string): string[] {
  return String(md || '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

export function paragraphSnippet(md: string, max = 90): string {
  const plain = String(md || '')
    .replace(/[#>*_`\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  return plain.slice(0, max).trim() + '…';
}

export function tweetStatusUrl(url: string): string {
  const raw = String(url || '').trim();
  const match = raw.match(
    /(?:twitter\.com|x\.com)\/(?:[^/]+\/status|i\/web\/status|i\/status)\/(\d+)/i,
  );
  if (match) return 'https://twitter.com/i/status/' + match[1];
  return raw;
}

function fromRaw(item: unknown, index: number): MediaBlock | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const type = row.type === 'tweet' ? 'tweet' : row.type === 'image' ? 'image' : '';
  if (!type) return null;
  const id = String(row.id || newId(type === 'tweet' ? 'tw' : 'img'));
  if (type === 'tweet') {
    const url = String(row.url || row.tweet_url || '').trim();
    if (!url) return null;
    return {
      id,
      type: 'tweet',
      url,
      after: asAfter(row.after ?? row.tweet_position),
      width: clampMediaWidth(row.width),
      height: clampMediaHeight(row.height),
      align: asMediaAlign(row.align),
    };
  }
  const src = String(row.src || row.image || row.article_image || '').trim();
  if (!src) return null;
  return {
    id,
    type: 'image',
    src,
    caption: String(row.caption || row.image_caption || ''),
    caption_en: String(row.caption_en || row.image_caption_en || ''),
    after: asAfter(row.after ?? row.image_position),
    width: clampMediaWidth(row.width),
    height: clampMediaHeight(row.height),
    align: asMediaAlign(row.align),
  };
}

type LegacyData = {
  media_blocks?: unknown;
  article_image?: string | null;
  image?: string | null;
  image_position?: number;
  tweet_url?: string;
  tweet_position?: number;
  image_info?: Array<{ image_caption?: string; image_caption_en?: string }>;
  image_caption?: string | null;
  article_image_caption?: string | null;
  image_caption_en?: string | null;
  article_image_caption_en?: string | null;
  layout_type?: string;
};

export function normalizeMediaBlocks(data: LegacyData): MediaBlock[] {
  const raw = data.media_blocks;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => fromRaw(item, 0))
      .filter((item): item is MediaBlock => Boolean(item));
  }

  const blocks: MediaBlock[] = [];
  const inBodyImage =
    data.layout_type === 'breve'
      ? data.image || data.article_image
      : data.article_image || data.image;
  if (inBodyImage) {
    const info = data.image_info?.[0];
    blocks.push({
      id: 'legacy-image',
      type: 'image',
      src: inBodyImage,
      caption:
        info?.image_caption ||
        data.article_image_caption ||
        data.image_caption ||
        '',
      caption_en:
        info?.image_caption_en ||
        data.article_image_caption_en ||
        data.image_caption_en ||
        '',
      after: asAfter(data.image_position),
    });
  }
  if (data.tweet_url) {
    blocks.push({
      id: 'legacy-tweet',
      type: 'tweet',
      url: data.tweet_url,
      after: asAfter(data.tweet_position),
    });
  }
  return blocks;
}
