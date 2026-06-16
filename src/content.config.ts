import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: "./src/content/articles" }),

  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),

    category: z.enum([
      'politique',
      'culture',
      'societe',
      'technologie'
    ]),

    image: z.string().nullish().optional(),
    
    // --- NOUVEAUX CHAMPS CMS ---
    article_image: z.string().nullish().optional(),
    author: z.string().optional(),
    reading_time: z.number().optional(),
    author_about: z.string().optional(),
    author_interests: z.string().optional(),
    consulted_sources: z.array(
      z.object({
        source_title: z.string(),
        source_url: z.string().nullish().optional()
      })
    ).optional(),
    // ---------------------------

    isVisible: z.preprocess(
      val => val === undefined ? true : val,
      z.boolean()
    ),
    isHero: z.boolean().default(false),
    source: z.string().nullish().optional(), // Conservé au cas où de vieux articles l'utilisent encore

    use_thumbnail: z.boolean().optional(),

    thumbnail_bg: z.string().nullish().optional(),
    thumbnail_bg_position: z.string().nullish().optional(),
    thumbnail_bg_zoom: z.union([z.number(), z.string()]).nullish().optional()
      .transform(v => typeof v === 'number' ? v : undefined),

    thumbnail_title: z.string().nullish().optional(),

    title_x: z.union([z.number(), z.string()]).nullish().optional()
      .transform(v => typeof v === 'number' ? v : undefined),

    title_y: z.union([z.number(), z.string()]).nullish().optional()
      .transform(v => typeof v === 'number' ? v : undefined),

    title_size: z.union([z.number(), z.string()]).nullish().optional()
      .transform(v => typeof v === 'number' ? v : undefined),

    title_weight: z.union([z.string(), z.number()]).nullish().optional(),
    title_font: z.string().nullish().optional(),
    title_color: z.string().nullish().optional(),

    thumbnail_descs: z.array(
      z.object({
        x: z.number().optional(),
        y: z.number().optional(),
        size: z.number().optional(),

        weight: z.union([
          z.string(),
          z.number()
        ]).nullish().optional(),

        font: z.string().nullish().optional(),
        color: z.string().nullish().optional(),

        line: z.string()
      })
    ).optional()
  }),
});

export const collections = { articles };