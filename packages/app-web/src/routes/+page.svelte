<script lang="ts">
  import {
    LAYER_TYPE_COLOR,
    LAYER_TYPE_LABEL,
    layerSortIndex,
    type LayerSide,
    type LayerType,
  } from '@ogd/core';
  import Viewer from '$lib/components/Viewer.svelte';
  import LayerList from '$lib/components/LayerList.svelte';
  import ContextMenu, { type MenuItem } from '$lib/components/ContextMenu.svelte';
  import { loadProject, type Layer } from '$lib/project';
  import { settings } from '$lib/stores/settings';

  const ALL_TYPES = Object.keys(LAYER_TYPE_LABEL) as LayerType[];

  function sideForType(t: LayerType): LayerSide {
    if (t.startsWith('top')) return 'top';
    if (t.startsWith('bottom')) return 'bottom';
    if (t === 'innerCopper') return 'inner';
    if (t === 'other') return 'unknown';
    return 'all';
  }

  let layers = $state<Layer[]>([]);
  let projectName = $state<string | null>(null);
  let skipped = $state<string[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let dragOver = $state(false);
  let loadId = $state(0);
  let fileInput: HTMLInputElement | undefined = $state();

  const hasProject = $derived(layers.length > 0);
  const totalDiagnostics = $derived(
    layers.reduce((n, l) => n + l.diagnostics.filter((d) => d.severity !== 'info').length, 0),
  );
  const renderLayers = $derived(
    layers.map((l) => ({ image: l.image, color: l.color, visible: l.visible })),
  );

  async function loadFiles(files: File[]) {
    if (files.length === 0) return;
    loading = true;
    error = null;
    try {
      const project = await loadProject(files, files[0]?.name ?? 'Project');
      if (project.layers.length === 0) throw new Error('No Gerber/Excellon layers found');
      layers = project.layers;
      projectName = project.name;
      skipped = project.skipped;
      loadId += 1;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      layers = [];
    } finally {
      loading = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    void loadFiles(Array.from(e.dataTransfer?.files ?? []));
  }
  function onPick(e: Event) {
    void loadFiles(Array.from((e.target as HTMLInputElement).files ?? []));
  }

  function toggle(id: string) {
    layers = layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
  }
  function setColor(id: string, color: string) {
    layers = layers.map((l) => (l.id === id ? { ...l, color } : l));
  }
  function showOnly(id: string) {
    layers = layers.map((l) => ({ ...l, visible: l.id === id }));
  }
  function showAll() {
    layers = layers.map((l) => ({ ...l, visible: true }));
  }
  function hideAll() {
    layers = layers.map((l) => ({ ...l, visible: false }));
  }
  function invertVisibility() {
    layers = layers.map((l) => ({ ...l, visible: !l.visible }));
  }
  function setType(id: string, type: LayerType) {
    layers = layers
      .map((l) =>
        l.id === id
          ? {
              ...l,
              classification: {
                ...l.classification,
                type,
                side: sideForType(type),
                source: 'filename' as const,
                confidence: 1,
              },
              displayName: LAYER_TYPE_LABEL[type],
              color: LAYER_TYPE_COLOR[type],
            }
          : l,
      )
      .sort((a, b) => layerSortIndex(a.classification) - layerSortIndex(b.classification));
  }

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  function openMenu(id: string, x: number, y: number) {
    const layer = layers.find((l) => l.id === id);
    if (!layer) return;
    menu = {
      x,
      y,
      items: [
        { label: 'Show Only This Layer', action: () => showOnly(id) },
        { label: layer.visible ? 'Hide This Layer' : 'Show This Layer', action: () => toggle(id) },
        { separator: true },
        { label: 'Show All Layers', action: showAll },
        { label: 'Hide All Layers', action: hideAll },
        { label: 'Invert Visibility', action: invertVisibility },
        { separator: true },
        {
          label: 'Set Layer Type',
          children: ALL_TYPES.map((t) => ({
            label: LAYER_TYPE_LABEL[t],
            swatch: LAYER_TYPE_COLOR[t],
            action: () => setType(id, t),
          })),
        },
        {
          label: 'Reset Color',
          action: () => setColor(id, LAYER_TYPE_COLOR[layer.classification.type]),
        },
      ],
    };
  }

  function onWindowKey(e: KeyboardEvent) {
    if (!hasProject) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'a' || e.key === 'A') showAll();
    else if (e.key === 'h' || e.key === 'H') hideAll();
    else if (e.key === 'i' || e.key === 'I') invertVisibility();
    else if (/^[1-9]$/.test(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      if (idx < layers.length) toggle(layers[idx]!.id);
    }
  }

  function reset() {
    layers = [];
    projectName = null;
    skipped = [];
    error = null;
  }
</script>

<svelte:window onkeydown={onWindowKey} />

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

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
    <button class="btn" onclick={() => fileInput?.click()}>Open files / folder / zip…</button>
    {#if hasProject}<button class="btn" onclick={reset}>Reset</button>{/if}
    <input bind:this={fileInput} type="file" multiple onchange={onPick} hidden />
  </header>

  <div class="main-area">
    {#if hasProject}
      <LayerList
        {layers}
        ontoggle={toggle}
        oncolor={setColor}
        onsolo={showOnly}
        oncontext={openMenu}
      />
    {/if}
    <main class="view-area">
      {#if hasProject}
        <Viewer layers={renderLayers} background={$settings.backgroundColor} fitKey={loadId} />
      {:else}
        <div class="empty" data-testid="dropzone">
          <p class="title">
            {loading ? 'Parsing layers…' : 'Drop a folder or .zip of Gerber/Excellon files'}
          </p>
          <p class="hint">
            or use “Open files / folder / zip…”. Everything is parsed locally — nothing is uploaded.
          </p>
          {#if error}<p class="err" data-testid="error">⚠ {error}</p>{/if}
        </div>
      {/if}
    </main>
  </div>

  <footer class="statusbar" data-testid="statusbar">
    {#if hasProject}
      <span data-testid="status-project">{projectName}</span>
      <span class="sep">·</span>
      <span data-testid="status-layers">{layers.length} layers</span>
      <span class="sep">·</span>
      <span>{layers.filter((l) => l.visible).length} visible</span>
      {#if skipped.length}
        <span class="sep">·</span>
        <span class="dim">{skipped.length} skipped</span>
      {/if}
      {#if totalDiagnostics > 0}
        <span class="sep">·</span>
        <span class="diag" data-testid="diag-count">{totalDiagnostics} warnings</span>
      {/if}
    {:else}
      <span>Ready</span>
    {/if}
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
  .main-area {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .view-area {
    flex: 1;
    min-width: 0;
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
