<script lang="ts">
  import {
    LAYER_TYPE_COLOR,
    LAYER_TYPE_LABEL,
    layerSortIndex,
    type BoundingBox,
    type LayerSide,
    type LayerType,
  } from '@ogd/core';
  import Viewer from '$lib/components/Viewer.svelte';
  import LayerList from '$lib/components/LayerList.svelte';
  import ContextMenu, { type MenuItem } from '$lib/components/ContextMenu.svelte';
  import DiffSummary, { fmtArea } from '$lib/components/DiffSummary.svelte';
  import { loadProject, type Layer } from '$lib/project';
  import { matchLayers, runDiffs, type PairDiff } from '$lib/diff';
  import { settings } from '$lib/stores/settings';

  const ALL_TYPES = Object.keys(LAYER_TYPE_LABEL) as LayerType[];
  function sideForType(t: LayerType): LayerSide {
    if (t.startsWith('top')) return 'top';
    if (t.startsWith('bottom')) return 'bottom';
    if (t === 'innerCopper') return 'inner';
    if (t === 'other') return 'unknown';
    return 'all';
  }

  type ViewMode = 'diff' | 'overlay' | 'a' | 'b';

  // $state.raw: reactive on reassignment but contents are NOT proxied — required
  // so the parsed images / diff results stay structured-cloneable for the workers
  // (a Svelte state proxy cannot be postMessage'd). We always reassign immutably.
  let slotA = $state.raw<Layer[]>([]);
  let slotB = $state.raw<Layer[]>([]);
  let nameA = $state<string | null>(null);
  let nameB = $state<string | null>(null);
  let viewMode = $state<ViewMode>('a');
  let pairDiffs = $state.raw<PairDiff[]>([]);
  let diffing = $state(false);
  let error = $state<string | null>(null);
  let dragOver = $state<'a' | 'b' | null>(null);
  let loadId = $state(0);
  let regionIdx = $state(-1);
  let focusBox = $state<BoundingBox | null>(null);
  let focusKey = $state(0);
  let inputA: HTMLInputElement | undefined = $state();
  let inputB: HTMLInputElement | undefined = $state();

  const hasA = $derived(slotA.length > 0);
  const hasB = $derived(slotB.length > 0);
  const hasBoth = $derived(hasA && hasB);
  const activeSide = $derived<'a' | 'b'>(viewMode === 'b' ? 'b' : 'a');
  const activeLayers = $derived(activeSide === 'b' ? slotB : slotA);

  const diffRenders = $derived(
    pairDiffs.map((pd) => ({ spec: pd.result.spec, classGrid: pd.result.classGrid })),
  );
  const allRegions = $derived(
    pairDiffs
      .flatMap((pd) => pd.result.clusters.map((c) => ({ ...c, label: pd.label })))
      .sort((a, b) => b.areaMm2 - a.areaMm2),
  );
  const totals = $derived(
    pairDiffs.reduce(
      (t, p) => {
        t.added += p.result.metrics.addedMm2;
        t.removed += p.result.metrics.removedMm2;
        return t;
      },
      { added: 0, removed: 0 },
    ),
  );

  const toRender = (l: Layer) => ({ image: l.image, color: l.color, visible: l.visible });
  const viewerLayers = $derived.by(() => {
    if (viewMode === 'b') return slotB.map(toRender);
    if (viewMode === 'overlay')
      return [
        ...slotA.map((l) => ({ image: l.image, color: $settings.colorA, visible: l.visible })),
        ...slotB.map((l) => ({ image: l.image, color: $settings.colorB, visible: l.visible })),
      ];
    return slotA.map(toRender);
  });

  async function loadInto(side: 'a' | 'b', files: File[]) {
    if (files.length === 0) return;
    error = null;
    try {
      const project = await loadProject(files, files[0]?.name ?? side.toUpperCase());
      if (project.layers.length === 0) throw new Error('No Gerber/Excellon layers found');
      if (side === 'a') {
        slotA = project.layers;
        nameA = project.name;
      } else {
        slotB = project.layers;
        nameB = project.name;
      }
      loadId += 1;
      await recompute();
      if (hasBoth) viewMode = 'diff';
      else viewMode = side;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function recompute() {
    regionIdx = -1;
    if (slotA.length && slotB.length) {
      diffing = true;
      try {
        pairDiffs = await runDiffs(matchLayers(slotA, slotB));
      } finally {
        diffing = false;
      }
    } else {
      pairDiffs = [];
    }
  }

  function onDrop(side: 'a' | 'b', e: DragEvent) {
    e.preventDefault();
    dragOver = null;
    void loadInto(side, Array.from(e.dataTransfer?.files ?? []));
  }

  // Sidebar ops operate on the active project.
  function updateActive(fn: (ls: Layer[]) => Layer[]) {
    if (activeSide === 'a') slotA = fn(slotA);
    else slotB = fn(slotB);
  }
  function toggle(id: string) {
    updateActive((ls) => ls.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));
  }
  function setColor(id: string, color: string) {
    updateActive((ls) => ls.map((l) => (l.id === id ? { ...l, color } : l)));
  }
  function showOnly(id: string) {
    updateActive((ls) => ls.map((l) => ({ ...l, visible: l.id === id })));
  }
  function showAll() {
    updateActive((ls) => ls.map((l) => ({ ...l, visible: true })));
  }
  function hideAll() {
    updateActive((ls) => ls.map((l) => ({ ...l, visible: false })));
  }
  function invertVisibility() {
    updateActive((ls) => ls.map((l) => ({ ...l, visible: !l.visible })));
  }
  function setType(id: string, type: LayerType) {
    updateActive((ls) =>
      ls
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
        .sort((a, b) => layerSortIndex(a.classification) - layerSortIndex(b.classification)),
    );
    void recompute(); // re-pair + re-diff
  }

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  function openMenu(id: string, x: number, y: number) {
    const layer = activeLayers.find((l) => l.id === id);
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

  function gotoRegion(delta: number) {
    if (allRegions.length === 0) return;
    regionIdx = (regionIdx + delta + allRegions.length) % allRegions.length;
    focusRegion(allRegions[regionIdx]!.bboxMm);
  }
  function focusRegion(box: BoundingBox) {
    focusBox = box;
    focusKey += 1;
  }

  function onWindowKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (hasBoth && (e.key === 'n' || e.key === 'N')) gotoRegion(1);
    else if (hasBoth && (e.key === 'p' || e.key === 'P')) gotoRegion(-1);
    else if (!hasProject) return;
    else if (e.key === 'a' || e.key === 'A') showAll();
    else if (e.key === 'h' || e.key === 'H') hideAll();
    else if (e.key === 'i' || e.key === 'I') invertVisibility();
    else if (/^[1-9]$/.test(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      if (idx < activeLayers.length) toggle(activeLayers[idx]!.id);
    }
  }

  const hasProject = $derived(hasA || hasB);

  function reset() {
    slotA = [];
    slotB = [];
    nameA = null;
    nameB = null;
    pairDiffs = [];
    error = null;
    viewMode = 'a';
  }
</script>

<svelte:window onkeydown={onWindowKey} />

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

<div class="app">
  <header class="topbar">
    <h1 class="brand">OpenGerberDiff</h1>
    <div class="slots">
      {#each [{ s: 'a', name: nameA, has: hasA, input: () => inputA?.click() }, { s: 'b', name: nameB, has: hasB, input: () => inputB?.click() }] as slot (slot.s)}
        <button
          class="slot"
          class:filled={slot.has}
          class:over={dragOver === slot.s}
          data-testid="slot-{slot.s}"
          ondragover={(e) => {
            e.preventDefault();
            dragOver = slot.s as 'a' | 'b';
          }}
          ondragleave={() => (dragOver = null)}
          ondrop={(e) => onDrop(slot.s as 'a' | 'b', e)}
          onclick={slot.input}
        >
          <span class="tag">{slot.s.toUpperCase()}</span>
          <span class="sname">{slot.name ?? 'drop / open…'}</span>
        </button>
      {/each}
    </div>
    <span class="spacer"></span>
    {#if hasBoth}
      <div class="modes" data-testid="view-modes">
        {#each ['diff', 'overlay', 'a', 'b'] as m (m)}
          <button class="mode" class:on={viewMode === m} onclick={() => (viewMode = m as ViewMode)}>
            {m === 'a' ? 'A' : m === 'b' ? 'B' : m[0]!.toUpperCase() + m.slice(1)}
          </button>
        {/each}
      </div>
      <div class="regionnav">
        <button class="mode" title="Previous change (P)" onclick={() => gotoRegion(-1)}>‹</button>
        <span class="rcount" data-testid="region-count"
          >{regionIdx >= 0 ? regionIdx + 1 : 0}/{allRegions.length}</span
        >
        <button class="mode" title="Next change (N)" onclick={() => gotoRegion(1)}>›</button>
      </div>
    {/if}
    {#if hasProject}<button class="btn" onclick={reset}>Reset</button>{/if}
    <input
      bind:this={inputA}
      data-testid="file-a"
      type="file"
      multiple
      onchange={(e) => loadInto('a', Array.from((e.target as HTMLInputElement).files ?? []))}
      hidden
    />
    <input
      bind:this={inputB}
      data-testid="file-b"
      type="file"
      multiple
      onchange={(e) => loadInto('b', Array.from((e.target as HTMLInputElement).files ?? []))}
      hidden
    />
  </header>

  <div class="main-area">
    {#if hasProject}
      <LayerList
        layers={activeLayers}
        ontoggle={toggle}
        oncolor={setColor}
        onsolo={showOnly}
        oncontext={openMenu}
      />
    {/if}
    <main class="view-area">
      {#if hasProject}
        <Viewer
          layers={viewerLayers}
          mode={viewMode === 'diff' ? 'diff' : 'layers'}
          diffs={diffRenders}
          background={$settings.backgroundColor}
          fitKey={loadId}
          {focusBox}
          {focusKey}
        />
      {:else}
        <div class="empty" data-testid="dropzone">
          <p class="title">Drop project A and project B (folders or .zip) to diff</p>
          <p class="hint">Everything is parsed and diffed locally — nothing is uploaded.</p>
          {#if error}<p class="err" data-testid="error">⚠ {error}</p>{/if}
        </div>
      {/if}
    </main>
    {#if hasBoth && viewMode === 'diff'}
      <DiffSummary {pairDiffs} onfocus={focusRegion} />
    {/if}
  </div>

  <footer class="statusbar" data-testid="statusbar">
    {#if hasBoth}
      <span data-testid="status-mode">{viewMode}</span>
      <span class="sep">·</span>
      <span data-testid="status-totals" class="added">+{fmtArea(totals.added)}</span>
      <span class="removed">−{fmtArea(totals.removed)}</span>
      <span class="sep">·</span>
      <span>{pairDiffs.length} layer pairs</span>
      {#if diffing}<span class="sep">·</span><span class="busy">diffing…</span>{/if}
    {:else if hasProject}
      <span>{activeLayers.length} layers loaded · add a second project to diff</span>
    {:else}
      <span>Ready</span>
    {/if}
    <span class="spacer"></span>
    {#if error}<span class="err">{error}</span>{/if}
  </footer>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.45rem 1rem;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    margin: 0;
    font-size: 1.1rem;
  }
  .slots {
    display: flex;
    gap: 0.5rem;
  }
  .slot {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--bg);
    border: 1px dashed var(--border);
    border-radius: 6px;
    padding: 0.25rem 0.6rem;
    max-width: 220px;
  }
  .slot.filled {
    border-style: solid;
  }
  .slot.over {
    border-color: var(--accent);
    background: rgba(0, 255, 136, 0.08);
  }
  .slot .tag {
    font-weight: 700;
    color: var(--accent);
  }
  .slot .sname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.82rem;
    color: var(--text-dim);
  }
  .spacer {
    flex: 1;
  }
  .modes,
  .regionnav {
    display: flex;
    gap: 2px;
    align-items: center;
  }
  .mode {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 5px;
    padding: 0.25rem 0.55rem;
    font-size: 0.8rem;
  }
  .mode.on {
    background: var(--accent);
    color: #10101a;
    border-color: var(--accent);
  }
  .rcount {
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--text-dim);
    min-width: 3.2rem;
    text-align: center;
  }
  .btn {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
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
  .added {
    color: #4ea3e0;
  }
  .removed {
    color: #f0903c;
  }
  .busy {
    color: var(--accent);
  }
</style>
