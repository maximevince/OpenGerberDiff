// Pure client-side SPA: disable SSR for the whole app. Combined with
// adapter-static's fallback page, this produces a CSR-only static build.
export const ssr = false;
export const prerender = false;
