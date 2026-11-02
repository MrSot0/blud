// @ts-check
import { defineConfig, envField } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import sitemap from '@astrojs/sitemap';

import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  site: 'https://blud-alpha.vercel.app',

  // Todo el sitio sigue siendo estático; solo /api/chat se ejecuta en el servidor (Vercel).
  // maxDuration: margen para los reintentos de /api/chat cuando Gemini está lento.
  adapter: vercel({ maxDuration: 60 }),

  env: {
    schema: {
      GEMINI_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [sitemap()]
});
