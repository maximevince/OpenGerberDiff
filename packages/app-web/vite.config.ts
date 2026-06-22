import { sveltekit } from '@sveltejs/kit/vite';
import {
  defineConfig,
  type Connect,
  type Plugin,
  type PreviewServer,
  type ViteDevServer,
} from 'vite';
import type { ServerResponse } from 'node:http';

/**
 * Cross-origin isolation headers (COOP/COEP) so `crossOriginIsolated === true`
 * and SharedArrayBuffer is available in dev + preview. Production hosting sets the
 * same headers via `static/_headers`.
 */
function crossOriginIsolation(): Plugin {
  const setHeaders = (
    _req: Connect.IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction,
  ) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    next();
  };
  return {
    name: 'ogd-cross-origin-isolation',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(setHeaders);
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(setHeaders);
    },
  };
}

export default defineConfig({
  plugins: [crossOriginIsolation(), sveltekit()],
});
