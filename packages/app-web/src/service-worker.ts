/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

/**
 * Offline service worker. Precaches the whole app (hashed build output + static
 * files + the SPA shell) under a cache keyed by the SvelteKit build `version`, and
 * serves it cache-first, so the app works with no network once installed.
 *
 * Updates: the browser re-fetches this script on navigation; a changed build gets a
 * new `version`, installs alongside the old one and then WAITS. The page (see
 * src/lib/pwa.ts) notices the waiting worker, shows an "update available" prompt and
 * posts `SKIP_WAITING` when the user accepts; it then reloads onto the new version.
 */
import { base, build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `ogd-${version}`;
const SHELL = `${base}/`;

// Host config files in static/ are not app resources.
const HOST_ONLY = /\/(CNAME|_headers|\.nojekyll)$/;
const ASSETS = [SHELL, ...build, ...files.filter((f) => !HOST_ONLY.test(f))];

// `cache: 'reload'` bypasses the HTTP cache so a fresh deploy is never mixed with
// stale assets from a previous one.
const fresh = (url: string) => new Request(url, { cache: 'reload' });

/**
 * `$service-worker`'s `build` list omits Vite worker bundles
 * (`_app/immutable/workers/*`), so find them in the cached chunks that spawn them:
 * `new Worker(new URL("../workers/parse.worker-HASH.js", import.meta.url))`.
 */
async function discoverWorkers(cache: Cache): Promise<string[]> {
  const found = new Set<string>();
  const ref = /["'`]((?:\.{1,2}\/)+workers\/[\w.-]+\.js)["'`]/g;
  for (const path of build) {
    if (!path.endsWith('.js')) continue;
    const text = await (await cache.match(path))?.text();
    if (!text) continue;
    for (const m of text.matchAll(ref)) {
      found.add(new URL(m[1], new URL(path, sw.location.origin)).pathname);
    }
  }
  return [...found].filter((p) => !ASSETS.includes(p));
}

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS.map(fresh));
      const workers = await discoverWorkers(cache);
      await cache.addAll(workers.map(fresh));
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE && key.startsWith('ogd-')) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return; // analytics etc. go straight to network

  // SPA: every navigation gets the cached app shell (client-side routing does the rest).
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => (await caches.match(SHELL, { cacheName: CACHE })) ?? fetch(req))(),
    );
    return;
  }

  // Cache-first for everything precached (only this build's assets live in CACHE);
  // anything else falls through to the network.
  event.respondWith(
    (async () => (await caches.match(url.pathname, { cacheName: CACHE })) ?? fetch(req))(),
  );
});
