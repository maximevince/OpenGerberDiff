# OpenGerberDiff (OGD)

**Free, open-source, pure-web visual + quantitative diff tool for Gerber/Excellon
PCB fabrication files.** Load two revisions of a board, see exactly what copper was
added or removed, per layer, in real physical units — all in your browser. Your
files never leave your machine.

> Status: **early development**, built in gated phases.

## What it is

- A **SvelteKit static SPA** — no backend, no accounts, no licensing, no telemetry.
- Runs in any modern browser; installable as a PWA; optional thin Electron wrapper
  and optional CLI share the same core (later phases).
- Parser front-end via `@tracespace` v4 (`gerber-parser` + `gerber-plotter`),
  isolated behind an adapter so it stays swappable.
- A purpose-built **coverage-area diff engine** that reports _added vs removed_
  copper in **mm²** (not a symmetric pixel XOR), robust to anti-aliasing.

## Monorepo

| Package        | Purpose                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `@ogd/core`    | Pure-TS: parse adapter, geometry model, rasterizer, diff, classify, align, report. No DOM/canvas/Node-fs. |
| `@ogd/app-web` | SvelteKit static SPA — the canonical app.                                                                 |

(Further packages — `render-gpu`, `cli`, `app-shell-electron` — arrive in later
phases.)

## Develop

```sh
pnpm install
pnpm dev        # run the web app (Vite dev server)
pnpm build      # build @ogd/core then the static SPA
pnpm preview    # serve the static build (cross-origin isolated)
pnpm test       # unit/property tests (Vitest)
pnpm e2e        # end-to-end tests (Playwright)
pnpm typecheck  # type-check all packages
pnpm lint       # prettier + eslint
```

## License

[GPL-3.0-or-later](./LICENSE).
