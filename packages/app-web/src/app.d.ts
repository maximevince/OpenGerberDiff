// Build-time constants injected by Vite `define` (see vite.config.ts).
declare global {
  const __APP_VERSION__: string;
  const __GIT_SHA__: string;
  const __BUILD_DATE__: string;
}

export {};
