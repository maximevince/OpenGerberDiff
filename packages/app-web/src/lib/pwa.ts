/**
 * Service-worker registration + update flow for the installable/offline web app.
 * See src/service-worker.ts for the caching side. Not used inside the Electron
 * shell (it ships its own builds) or in `vite dev` (no SW is built there).
 */
import { writable } from 'svelte/store';
import { dev } from '$app/environment';
import { base } from '$app/paths';
import { isElectron } from './platform';

/** True once a new version has been downloaded and is waiting to take over. */
export const updateReady = writable(false);

const UPDATE_CHECK_MS = 60 * 60 * 1000;
let waiting: ServiceWorker | null = null;

function trackWaiting(sw: ServiceWorker | null): void {
  if (!sw) return;
  const ready = () => {
    // Only an *update* if a previous version is already controlling this page;
    // the very first install has nothing to replace.
    if (sw.state === 'installed' && navigator.serviceWorker.controller) {
      waiting = sw;
      updateReady.set(true);
    }
  };
  ready();
  sw.addEventListener('statechange', ready);
}

export async function registerServiceWorker(): Promise<void> {
  if (dev || isElectron() || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register(`${base}/service-worker.js`);
    trackWaiting(reg.waiting);
    reg.addEventListener('updatefound', () => trackWaiting(reg.installing));

    // Long-lived tabs / installed windows: poll for new deploys.
    const check = () => void reg.update().catch(() => {});
    setInterval(check, UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !waiting) return; // ignore first-install clients.claim()
      reloading = true;
      location.reload();
    });
  } catch (err) {
    console.warn('[ogd] service worker registration failed', err);
  }
}

/** Activate the waiting version; the page reloads on `controllerchange`. */
export function applyUpdate(): void {
  waiting?.postMessage('SKIP_WAITING');
}
