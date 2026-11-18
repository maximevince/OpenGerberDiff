import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Pure static SPA: no SSR (see src/routes/+layout.ts), single fallback page.
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: false,
    }),
    // Offline/installable PWA: src/service-worker.ts is bundled by SvelteKit, but we
    // register it ourselves (src/lib/pwa.ts) so we can drive the update prompt and
    // skip registration inside the Electron shell.
    serviceWorker: { register: false },
  },
};

export default config;
