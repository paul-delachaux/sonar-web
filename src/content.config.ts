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

    image: z.string().optional(),
    isHero: z.boolean().default(false),
    source: z.string().optional(),

    // ===== AJOUTS =====

    use_thumbnail: z.boolean().optional(),

    thumbnail_bg: z.string().optional(),
    thumbnail_bg_position: z.string().optional(),
    thumbnail_bg_zoom: z.number().optional(),

    thumbnail_title: z.string().optional(),

    title_x: z.number().optional(),
    title_y: z.number().optional(),
    title_size: z.number().optional(),

    title_weight: z.union([
      z.string(),
      z.number()
    ]).optional(),

    title_font: z.string().optional(),
    title_color: z.string().optional(),

    thumbnail_descs: z.array(
      z.object({
        x: z.number().optional(),
        y: z.number().optional(),
        size: z.number().optional(),

        weight: z.union([
          z.string(),
          z.number()
        ]).optional(),

        font: z.string().optional(),
        color: z.string().optional(),

        line: z.string()
      })
    ).optional()
  }),
});

export const collections = { articles };