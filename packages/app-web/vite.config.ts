import { sveltekit } from '@sveltejs/kit/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
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

// `@tracespace` v4 parser/plotter depend on `readable-stream`, which expects Node
// globals (Buffer/process/stream). Polyfill them for the browser bundle — and,
// crucially, for the parse worker (Vite builds workers with a SEPARATE plugin
// pipeline, so the polyfill must be registered under `worker.plugins` too).
const polyfills = () =>
  nodePolyfills({
    include: ['buffer', 'process', 'stream', 'util', 'events', 'string_decoder'],
    globals: { Buffer: true, process: true, global: true },
  });

export default defineConfig({
  plugins: [polyfills(), crossOriginIsolation(), sveltekit()],
  worker: { format: 'es', plugins: () => [polyfills()] },
});
