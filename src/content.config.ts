import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders'; // On importe glob ET file

const articles = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: "./src/content/articles" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    category: z.enum(['politique', 'culture', 'societe', 'technologie']),
    image: z.string().optional(),
    isHero: z.boolean().default(false),
    source: z.string().optional(),
  }),
});

export const collections = {articles};