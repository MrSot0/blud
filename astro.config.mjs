// @ts-check
import { defineConfig, envField } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import sitemap from '@astrojs/sitemap';

import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  site: 'https://blud-alpha.vercel.app',

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [sitemap()],
  adapter: vercel(),
  env: {
    schema: {
      GEMINI_API_KEY: envField.string({
        context: 'server',
        access: 'secret',
        optional: false, // Set to true if you want builds to pass even if the key isn't set yet
      }),
    },
  },


});