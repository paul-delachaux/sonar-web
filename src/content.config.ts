import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: "./src/content/articles" }),

  schema: z.object({
    title: z.string(),
    description: z.string().nullish().optional(), // Rend-le optionnel au cas où une brève n'a pas de description

    // --- NOUVEAU : TYPE DE LAYOUT ---
    layout_type: z.enum(['classique', 'breve']).default('classique'),

    date: z.coerce.date(),

    // --- CHAMPS ANGLAIS ---
    title_en: z.string().nullish().optional(),
    description_en: z.string().nullish().optional(),
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
    
    // --- CHAMPS ARTICLE ---
    article_image: z.string().nullish().optional(),
    image_info: z.array(
      z.object({
        image_caption: z.string().optional(),
        image_caption_en: z.string().nullish().optional(),
      })
    ).optional(),
    author: z.string().optional(),
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

export const collections = { articles };