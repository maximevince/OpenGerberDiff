import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

// Build-time provenance, exposed to the app as `__APP_VERSION__` / `__GIT_SHA__` /
// `__BUILD_DATE__` (see src/app.d.ts). The short SHA is resolved from git at build,
// falling back to the CI-provided $GITHUB_SHA, then 'dev' for ad-hoc builds.
// Version tracks the monorepo root package.json (the project version), not this
// workspace package's own 0.0.0 placeholder.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev';
  }
}

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
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(gitSha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [polyfills(), crossOriginIsolation(), sveltekit()],
  worker: { format: 'es', plugins: () => [polyfills()] },
});
