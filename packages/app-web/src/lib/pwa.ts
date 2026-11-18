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
let applying = false;

function trackWaiting(sw: ServiceWorker | null, isUpdate: boolean): void {
  // The very first install has nothing to replace, so it's never an update.
  if (!sw || !isUpdate) return;
  const ready = () => {
    if (sw.state === 'installed') {
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
    // Is a version already controlling this page? Checked when a worker shows up —
    // a first install only gets a controller later, via clients.claim().
    const isUpdate = () => !!navigator.serviceWorker.controller;
    trackWaiting(reg.waiting, isUpdate());
    reg.addEventListener('updatefound', () => trackWaiting(reg.installing, isUpdate()));

    // Long-lived tabs / installed windows: poll for new deploys.
    const check = () => void reg.update().catch(() => {});
    setInterval(check, UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });

    // Reload only when the user asked for the update — never on a first-install
    // clients.claim() or a version activated by another tab.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!applying) return;
      applying = false;
      location.reload();
    });
  } catch (err) {
    console.warn('[ogd] service worker registration failed', err);
  }
}

/** Activate the waiting version; the page reloads on `controllerchange`. */
export function applyUpdate(): void {
  if (!waiting) return;
  applying = true;
  waiting.postMessage('SKIP_WAITING');
}
