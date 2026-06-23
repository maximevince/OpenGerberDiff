# @ogd/app-shell-electron

An **optional, minimal** Electron desktop wrapper for OpenGerberDiff.

It loads the **unmodified** `@ogd/app-web` static build (the exact same bundle
that runs in a browser and on GitHub Pages) inside a single `BrowserWindow`,
served over a loopback HTTP server. The only additions are native conveniences,
exposed to the web app through a tiny preload bridge (`window.nativeAPI`):

- **Open** files via the native file dialog
- **Save** `.pcbdiff` reviews via the native save dialog
- An application **menu** (Open / Save / Undo / Redo / Help / About) that drives
  the same actions as the in-app toolbar
- Auto-update against GitHub Releases (`electron-updater`) when packaged

**Critical invariant:** `app-web` never imports Electron. It feature-detects
`window.nativeAPI` and falls back to the standard browser mechanisms when absent,
so the same build keeps working as a pure web app.

## Develop

```sh
# from the repo root — builds core + app-web, then launches Electron on it
pnpm electron:dev
```

## Package installers

```sh
pnpm electron:dist:linux   # AppImage + deb (verified locally)
pnpm electron:dist         # current OS defaults
# CI runs electron-builder per-OS to produce macOS (dmg) and Windows (nsis) too.
```

Output lands in `packages/app-shell-electron/dist/`. macOS/Windows artifacts
require their respective runners (or CI); the config in `electron-builder.yml`
covers all three.
