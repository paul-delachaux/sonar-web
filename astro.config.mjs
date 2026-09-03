import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://le-sonar.vercel.app', // Indique l'adresse de votre site pour le sitemap
  adapter: vercel(),
  integrations: [
    sitemap(),
  ],
});