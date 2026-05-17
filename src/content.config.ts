import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  // Utilisons un chemin plus direct
  loader: glob({ pattern: '**/[^_]*.md', base: "./src/content/articles" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    category: z.enum(['politique', 'culture', 'societe']),
    image: z.string().optional(),
    isHero: z.boolean().default(false),
    source: z.string().optional(),
  }),
});

export const collections = { articles };