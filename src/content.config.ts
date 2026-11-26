import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

function timecodeSeconds(value: string | null | undefined) {
  const parts = String(value || '').trim().split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (parts.some((part) => !/^\d+$/.test(part))) return null;

  const numbers = parts.map(Number);
  const seconds = numbers[numbers.length - 1];
  const minutes = numbers[numbers.length - 2];
  if (seconds > 59 || (parts.length === 3 && minutes > 59)) return null;

  const total = parts.length === 2
    ? numbers[0] * 60 + seconds
    : numbers[0] * 3600 + minutes * 60 + seconds;
  return Number.isSafeInteger(total) ? total : null;
}

const revueTrackSchema = z.object({
  file: z.string().nullish().optional(),
  url: z.string().nullish().optional(),
  title: z.string().nullish().optional(),
  title_en: z.string().nullish().optional(),
  use_excerpt: z.boolean().nullish().optional(),
  start_time: z.string().nullish().optional(),
  end_time: z.string().nullish().optional(),
}).superRefine((track, context) => {
  if (!track.use_excerpt) return;

  const start = timecodeSeconds(track.start_time);
  const end = timecodeSeconds(track.end_time);
  if (start === null) {
    context.addIssue({ code: 'custom', path: ['start_time'], message: 'Le début doit être au format mm:ss ou hh:mm:ss.' });
  }
  if (end === null) {
    context.addIssue({ code: 'custom', path: ['end_time'], message: 'La fin doit être au format mm:ss ou hh:mm:ss.' });
  }
  if (start !== null && end !== null && end <= start) {
    context.addIssue({ code: 'custom', path: ['end_time'], message: 'La fin doit être après le début.' });
  }
});

const articles = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: "./src/content/articles" }),

  schema: z.object({
    title: z.string(),
    description: z.union([
      z.string(),
      z.object({
        mode: z.enum(['text', 'image']).optional(),
        text: z.string().optional(),
        image: z.string().optional(),
        caption: z.string().optional(),
      }),
    ]).nullish().optional(),

    // --- NOUVEAU : TYPE DE LAYOUT ---
    layout_type: z.enum(['classique', 'breve', 'revue_musicale']).default('classique'),

    date: z.coerce.date(),

    // --- CHAMPS ANGLAIS ---
    title_en: z.string().nullish().optional(),
    description_en: z.union([
      z.string(),
      z.object({
        mode: z.enum(['text', 'image']).optional(),
        text: z.string().optional(),
        image: z.string().optional(),
        caption: z.string().optional(),
      }),
    ]).nullish().optional(),
    description_mode: z.enum(['text', 'image']).nullish().optional(),
    description_mode_en: z.enum(['text', 'image']).nullish().optional(),
    description_image: z.string().nullish().optional(),
    description_image_en: z.string().nullish().optional(),
    description_image_alt: z.string().nullish().optional(),
    description_image_alt_en: z.string().nullish().optional(),
    description_image_caption: z.string().nullish().optional(),
    description_image_caption_en: z.string().nullish().optional(),
    body_en: z.string().nullish().optional(),
    category_en: z.string().nullish().optional(),
    author_about_en: z.string().nullish().optional(),
    author_interests_en: z.string().nullish().optional(),
    image_caption_en: z.string().nullish().optional(),
    article_image_caption_en: z.string().nullish().optional(),

    category: z.string().min(1),

    image: z.string().nullish().optional(),
    image_caption: z.string().nullish().optional(), // NOUVEAU
    
    tweet_url: z.string().url().optional(),
    tweet_position: z.union([z.number(), z.string()]).nullish().optional()
      .transform(v => {
      const n = typeof v === 'string' ? parseInt(v, 10) : v;
      return typeof n === 'number' && !isNaN(n) ? n : undefined;
    }),

    media_blocks: z.array(
      z.object({
        id: z.string().optional(),
        type: z.enum(['image', 'tweet']).default('image'),
        src: z.string().nullish().optional(),
        caption: z.string().nullish().optional(),
        caption_en: z.string().nullish().optional(),
        url: z.string().nullish().optional(),
        after: z.union([z.number(), z.string()]).nullish().optional()
          .transform(v => {
            const n = typeof v === 'string' ? parseInt(v, 10) : v;
            return typeof n === 'number' && !isNaN(n) ? n : 0;
          }),
        width: z.union([z.number(), z.string()]).nullish().optional()
          .transform(v => {
            const n = typeof v === 'string' ? parseInt(v, 10) : v;
            if (typeof n !== 'number' || isNaN(n) || n <= 0) return undefined;
            return Math.min(100, Math.max(1, Math.round(n)));
          }),
        height: z.union([z.number(), z.string()]).nullish().optional()
          .transform(v => {
            const n = typeof v === 'string' ? parseInt(v, 10) : v;
            if (typeof n !== 'number' || isNaN(n) || n <= 0) return undefined;
            return Math.min(100, Math.max(1, Math.round(n)));
          }),
        align: z.enum(['left', 'center']).nullish().optional()
          .transform(v => (v === 'left' ? 'left' : 'center')),
      })
    ).optional(),
    
    // --- CHAMPS ARTICLE ---
    article_image: z.string().nullish().optional(),
    image_info: z.array(
      z.object({
        image_caption: z.string().optional(),
        image_caption_en: z.string().nullish().optional(),
      })
    ).optional(),
    author: z.string().nullish().optional(),
    author2: z.string().nullish().optional(),
    reading_time: z.number().optional(),
    author_info: z.array(
      z.object({
        author_about: z.string().optional(),
        author_about_en: z.string().nullish().optional(),
        author_interests: z.string().optional(),
        author_interests_en: z.string().nullish().optional(),
        author_partners: z.string().optional(),
        author_partners_en: z.string().nullish().optional()
      })
    ).optional(),
    image_position: z.union([z.number(), z.string()]).nullish().optional()
      .transform(v => {
      const n = typeof v === 'string' ? parseInt(v, 10) : v;
      return typeof n === 'number' && !isNaN(n) ? n : undefined;
    }),
    overlay_opacity: z.union([z.number(), z.string()]).nullish().optional()
      .transform(v => {
      const n = typeof v === 'string' ? parseInt(v, 10) : v;
      return typeof n === 'number' && !isNaN(n) ? n : undefined;
    }),
    consulted_sources: z.array(
      z.object({
        source_title: z.string(),
        source_title_en: z.string().nullish().optional(),
        source_url: z.string().nullish().optional()
      })
    ).optional(),

    definitions: z.array(
      z.object({
        term: z.string().nullish().optional(),
        definition: z.string().nullish().optional(),
        term_en: z.string().nullish().optional(),
        definition_en: z.string().nullish().optional()
      })
    ).optional(),

    revue_rows: z.array(
      z.object({
        full_width: z.boolean().default(false),
        editor_title: z.string().nullish().optional(),
        left: z.object({
          type: z.enum(['texte', 'intertitre', 'image', 'audio']).default('texte'),
          text: z.string().nullish().optional(),
          text_en: z.string().nullish().optional(),
          image: z.string().nullish().optional(),
          image_caption: z.string().nullish().optional(),
          image_caption_en: z.string().nullish().optional(),
          tracks: z.array(revueTrackSchema).optional(),
        }).optional(),
        right: z.object({
          type: z.enum(['texte', 'intertitre', 'image', 'audio']).default('texte'),
          text: z.string().nullish().optional(),
          text_en: z.string().nullish().optional(),
          image: z.string().nullish().optional(),
          image_caption: z.string().nullish().optional(),
          image_caption_en: z.string().nullish().optional(),
          tracks: z.array(revueTrackSchema).optional(),
        }).optional(),
      })
    ).optional(),

    isVisible: z.preprocess(
      val => val === undefined ? true : val,
      z.boolean()
    ),
    isHero: z.boolean().default(false),
    source: z.string().nullish().optional(),

    // --- THUMBNAILS (Rétrocompatibilité / Générateur) ---
    use_thumbnail: z.boolean().optional(),
    thumbnail_bg: z.string().nullish().optional(),
    // Positionnement + zoom du fond, et positionnement + style des blocs de
    // texte de la miniature, édités via l'éditeur visuel "glisser-déposer"
    // (widget CMS custom "thumbnail-editor").
    thumbnail_layout: z.object({
      format: z.enum(['hero', 'sidebar', 'strip', 'brief', 'tile', 'custom', 'square', 'landscape']).optional(),
      frame: z.object({
        w: z.number().optional(),
        h: z.number().optional()
      }).optional(),
      images: z.array(
        z.object({
          src: z.string().optional(),
          x: z.number().optional(),
          y: z.number().optional(),
          w: z.number().optional(),
          h: z.number().optional(),
          z: z.number().optional()
        })
      ).optional(),
      bg: z.object({
        x: z.number().optional(),
        y: z.number().optional(),
        zoom: z.number().optional()
      }).optional(),
      blocks: z.array(
        z.object({
          line: z.string().optional(),
          x: z.number().optional(),
          y: z.number().optional(),
          w: z.number().optional(),
          h: z.number().optional(),
          size: z.number().optional(),
          weight: z.union([z.string(), z.number()]).nullish().optional(),
          font: z.string().nullish().optional(),
          color: z.string().nullish().optional(),
          z: z.number().optional()
        })
      ).optional()
    }).optional()
  }),
});

const sondages = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/sondages' }),
  schema: z.object({
    layout: z.enum(['single_choice']).default('single_choice'),
    title: z.string().min(1),
    title_en: z.string().nullish().optional(),
    question: z.string().min(1),
    question_en: z.string().nullish().optional(),
    order: z.coerce.number().int().min(0).default(0),
    isVisible: z.boolean().default(false),
    options: z.array(z.object({
      id: z.string().min(1).max(64),
      label: z.string().min(1),
      label_en: z.string().nullish().optional(),
    })).min(2),
  }).superRefine((poll, context) => {
    const seen = new Set<string>();
    poll.options.forEach((option, index) => {
      if (seen.has(option.id)) {
        context.addIssue({
          code: 'custom',
          path: ['options', index, 'id'],
          message: 'Chaque option doit avoir un identifiant unique.',
        });
      }
      seen.add(option.id);
    });
  }),
});

export const collections = { articles, sondages };