<script lang="ts">
  import type { Image, Diagnostic } from '@ogd/core';
  import { boundingBoxWidth, boundingBoxHeight } from '@ogd/core';
  import Viewer from '$lib/components/Viewer.svelte';
  import { expandFile, looksLikeGerber, parseRawFile } from '$lib/ingest';
  import { settings } from '$lib/stores/settings';

  let image = $state<Image | null>(null);
  let fileName = $state<string | null>(null);
  let diagnostics = $state<Diagnostic[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let dragOver = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  const errorCount = $derived(diagnostics.filter((d) => d.severity === 'error').length);
  const warnCount = $derived(diagnostics.filter((d) => d.severity === 'warning').length);

  async function loadFiles(files: File[]) {
    if (files.length === 0) return;
    loading = true;
    error = null;
    try {
      const raws = (await Promise.all(files.map(expandFile))).flat();
      const pick = raws.find((r) => looksLikeGerber(r.name)) ?? raws[0];
      if (!pick) throw new Error('No files found');
      const res = await parseRawFile(pick);
      image = res.image;
      diagnostics = res.diagnostics;
      fileName = pick.name;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      image = null;
    } finally {
      loading = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    void loadFiles(files);
  }

  function onPick(e: Event) {
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    void loadFiles(files);
  }

  function reset() {
    image = null;
    fileName = null;
    diagnostics = [];
    error = null;
  }
</script>

<div
  class="app"
  class:drag={dragOver}
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={onDrop}
  role="application"
  aria-label="OpenGerberDiff viewer"
>
  <header class="topbar">
    <h1 class="brand">OpenGerberDiff</h1>
    <span class="tag">visual + quantitative PCB diff · runs 100% in your browser</span>
    <span class="spacer"></span>
    <button class="btn" onclick={() => fileInput?.click()}>Open file / zip…</button>
    {#if image}<button class="btn" onclick={reset}>Reset</button>{/if}
    <input
      bind:this={fileInput}
      type="file"
      multiple
      accept=".gbr,.ger,.gtl,.gbl,.gts,.gbs,.gto,.gbo,.gko,.gm1,.drl,.xln,.exc,.zip,*"
      onchange={onPick}
      hidden
    />
  </header>

  <main class="view-area">
    {#if image}
      <Viewer {image} color={$settings.colorA} background={$settings.backgroundColor} />
    {:else}
      <div class="empty" data-testid="dropzone">
        <p class="title">{loading ? 'Parsing…' : 'Drop a Gerber/Excellon file, or a .zip'}</p>
        <p class="hint">
          or use “Open file / zip…”. Everything is parsed locally — nothing is uploaded.
        </p>
        {#if error}<p class="err" data-testid="error">⚠ {error}</p>{/if}
      </div>
    {/if}
  </main>

  <footer class="statusbar" data-testid="statusbar">
    {#if image && fileName}
      <span data-testid="status-file">{fileName}</span>
      <span class="sep">·</span>
      <span
        >{boundingBoxWidth(image.boundingBox).toFixed(2)} × {boundingBoxHeight(
          image.boundingBox,
        ).toFixed(2)} mm</span
      >
      <span class="sep">·</span>
      <span
        >{image.stats.padCount} pads · {image.stats.strokeCount} traces · {image.stats.fillCount} fills</span
      >
      {#if errorCount + warnCount > 0}
        <span class="sep">·</span>
        <span class="diag" data-testid="diag-count">{errorCount} err / {warnCount} warn</span>
      {/if}
    {:else}
      <span>Ready</span>
    {/if}
    <span class="spacer"></span>
    <span class="dim">format: {image?.source.format ?? '—'}</span>
  </footer>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .app.drag::after {
    content: 'Drop to load';
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 255, 136, 0.08);
    border: 3px dashed var(--accent);
    font-size: 1.5rem;
    pointer-events: none;
    z-index: 10;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 1rem;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    margin: 0;
    font-size: 1.15rem;
  }
  .tag {
    color: var(--text-dim);
    font-size: 0.82rem;
  }
  .spacer {
    flex: 1;
  }
  .btn {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
  }
  .btn:hover {
    border-color: var(--accent);
  }
  .view-area {
    flex: 1;
    min-height: 0;
  }
  .empty {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    text-align: center;
    padding: 2rem;
  }
  .empty .title {
    font-size: 1.15rem;
    margin: 0;
  }
  .empty .hint {
    color: var(--text-dim);
    margin: 0;
    font-size: 0.9rem;
  }
  .err {
    color: #ff6b6b;
    font-family: var(--mono);
    font-size: 0.85rem;
  }
  .statusbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 1rem;
    background: var(--bg-elev);
    border-top: 1px solid var(--border);
    font-size: 0.8rem;
    color: var(--text-dim);
    font-family: var(--mono);
  }
  .sep {
    opacity: 0.5;
  }
  .diag {
    color: #ffb454;
  }
  .dim {
    opacity: 0.7;
  }
</style>
