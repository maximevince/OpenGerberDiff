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
  import About, { VERSION, GIT_SHA } from '$lib/components/About.svelte';
  import Help from '$lib/components/Help.svelte';
  import Splash from '$lib/components/Splash.svelte';
  import { loadProject, type Layer } from '$lib/project';
  import { matchLayers, pairKey, runDiffs, type PairDiff } from '$lib/diff';
  import { settings } from '$lib/stores/settings';
  import { onMenuAction, pickFiles, saveBytes } from '$lib/platform';
  import {
    buildSession,
    isSessionFile,
    parseSession,
    PCBDIFF_EXT,
    type LayerOverride,
    type RawFileBytes,
    type SessionSide,
  } from '$lib/session';
  import { onMount } from 'svelte';

  const ALL_TYPES = Object.keys(LAYER_TYPE_LABEL) as LayerType[];
  function sideForType(t: LayerType): LayerSide {
    if (t.startsWith('top')) return 'top';
    if (t.startsWith('bottom')) return 'bottom';
    if (t === 'innerCopper') return 'inner';
    if (t === 'other') return 'unknown';
    return 'all';
  }

  type ViewMode = 'diff' | 'changes' | 'xor' | 'overlay' | 'onion' | 'a' | 'b';
  const VIEW_MODES: { id: ViewMode; label: string; title: string }[] = [
    { id: 'diff', label: 'Diff', title: 'Added / removed / common' },
    { id: 'changes', label: 'Changes', title: 'Only added & removed (no common)' },
    { id: 'xor', label: 'XOR', title: 'Any change in one color' },
    { id: 'overlay', label: 'Overlay', title: 'A and B tinted together' },
    { id: 'onion', label: 'Onion', title: 'Blend A↔B with a slider' },
    { id: 'a', label: 'A', title: 'Project A only' },
    { id: 'b', label: 'B', title: 'Project B only' },
  ];
  const DIFF_MODES = new Set<ViewMode>(['diff', 'changes', 'xor']);
  let onionMix = $state(0.5);

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
  let progress = $state<{ phase: string; done: number; total: number } | null>(null);
  let error = $state<string | null>(null);
  let dragOver = $state<'a' | 'b' | null>(null);
  let loadId = $state(0);
  let regionIdx = $state(-1);
  let focusBox = $state<BoundingBox | null>(null);
  let focusKey = $state(0);
  let inputA: HTMLInputElement | undefined = $state();
  let inputB: HTMLInputElement | undefined = $state();
  // The intro dual-dropzone stays up until BOTH projects are loaded, so a second
  // file can be dropped without the view collapsing. User can opt out via a button.
  let forceSingle = $state(false);
  let aboutOpen = $state(false);
  let helpOpen = $state(false);
  // The splash shows on the truly-empty initial screen until dismissed; once any
  // project is loaded it never reappears (the picker takes over).
  let splashDismissed = $state(false);

  // Raw source bytes per slot, held in memory ONLY (never persisted to browser
  // storage) so an explicit .pcbdiff export can bundle the original files.
  let rawA = $state.raw<RawFileBytes[]>([]);
  let rawB = $state.raw<RawFileBytes[]>([]);

  // Undo/redo over the review state (visibility, color, classification, order).
  // Snapshots hold the immutable layer arrays — cheap, since every edit already
  // reassigns them immutably.
  type Snap = { a: Layer[]; b: Layer[] };
  let undoStack = $state.raw<Snap[]>([]);
  let redoStack = $state.raw<Snap[]>([]);
  const UNDO_LIMIT = 100;
  function snapshot() {
    undoStack = [...undoStack, { a: slotA, b: slotB }].slice(-UNDO_LIMIT);
    redoStack = [];
  }
  function undo() {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1]!;
    undoStack = undoStack.slice(0, -1);
    redoStack = [...redoStack, { a: slotA, b: slotB }];
    slotA = prev.a;
    slotB = prev.b;
    void recompute();
  }
  function redo() {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1]!;
    redoStack = redoStack.slice(0, -1);
    undoStack = [...undoStack, { a: slotA, b: slotB }];
    slotA = next.a;
    slotB = next.b;
    void recompute();
  }

  const hasA = $derived(slotA.length > 0);
  const hasB = $derived(slotB.length > 0);
  const hasBoth = $derived(hasA && hasB);
  const showWorkspace = $derived(hasBoth || forceSingle);
  const activeSide = $derived<'a' | 'b'>(viewMode === 'b' ? 'b' : 'a');
  const activeLayers = $derived(activeSide === 'b' ? slotB : slotA);

  // A pair's diff is shown only if its layer is visible (in A, else B).
  function pairVisible(key: string): boolean {
    const la = slotA.find((l) => pairKey(l.classification) === key);
    if (la) return la.visible;
    const lb = slotB.find((l) => pairKey(l.classification) === key);
    return lb ? lb.visible : true;
  }
  // Vector diff pairs: the actual A/B geometry + alignment offset, re-rendered each
  // frame (crisp at any zoom). The class grid stays in pd.result for metrics/regions.
  const diffRenders = $derived(
    pairDiffs
      .filter((pd) => pairVisible(pd.key))
      .map((pd) => {
        const a = slotA.find((l) => pairKey(l.classification) === pd.key) ?? null;
        const b = slotB.find((l) => pairKey(l.classification) === pd.key) ?? null;
        return {
          aImage: a?.image ?? null,
          bImage: b?.image ?? null,
          offsetX: pd.result.offset.x,
          offsetY: pd.result.offset.y,
        };
      }),
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

  // Matched filenames per active layer: its own side + the counterpart side, so the
  // sidebar shows which A and B files were paired together.
  const layerFiles = $derived.by(() => {
    const m = new Map<string, { a: string | null; b: string | null }>();
    for (const l of activeLayers) {
      const k = pairKey(l.classification);
      m.set(l.id, {
        a: slotA.find((x) => pairKey(x.classification) === k)?.fileName ?? null,
        b: slotB.find((x) => pairKey(x.classification) === k)?.fileName ?? null,
      });
    }
    return m;
  });

  const toRender = (l: Layer) => ({ image: l.image, color: l.color, visible: l.visible });
  const viewerLayers = $derived.by(() => {
    if (viewMode === 'a') return slotA.map(toRender);
    if (viewMode === 'b') return slotB.map(toRender);
    // Multi-project modes frame to both projects. For diff/changes/xor the layers
    // are used only for framing (change geometry can extend beyond A's bbox); for
    // overlay/onion they're drawn — onion blends via per-side opacity.
    const aOp = viewMode === 'onion' ? 1 - onionMix : 1;
    const bOp = viewMode === 'onion' ? onionMix : 1;
    return [
      ...slotA.map((l) => ({
        image: l.image,
        color: $settings.colorA,
        visible: l.visible,
        opacity: aOp,
      })),
      ...slotB.map((l) => ({
        image: l.image,
        color: $settings.colorB,
        visible: l.visible,
        opacity: bOp,
      })),
    ];
  });

  const viewerMode = $derived(DIFF_MODES.has(viewMode) ? 'diff' : 'layers');
  const viewerDiffOpts = $derived(
    viewMode === 'changes'
      ? { showCommon: false }
      : viewMode === 'xor'
        ? { showCommon: false, mono: '#ffd166' }
        : { showCommon: true },
  );

  async function loadInto(
    side: 'a' | 'b',
    files: File[],
    overrides: LayerOverride[] | undefined = undefined,
  ) {
    if (files.length === 0) return;
    // A dropped/opened .pcbdiff is a session, not a layer set.
    if (files.length === 1 && isSessionFile(files[0]!.name)) {
      void openSessionFile(files[0]!);
      return;
    }
    error = null;
    try {
      progress = { phase: `Parsing ${side.toUpperCase()}`, done: 0, total: 0 };
      const raw: RawFileBytes[] = await Promise.all(
        files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
      );
      const project = await loadProject(
        files,
        files[0]?.name ?? side.toUpperCase(),
        (done, total) => (progress = { phase: `Parsing ${side.toUpperCase()}`, done, total }),
      );
      if (project.layers.length === 0) throw new Error('No Gerber/Excellon layers found');
      const layers = overrides ? applyOverrides(project.layers, overrides) : project.layers;
      if (side === 'a') {
        slotA = layers;
        nameA = project.name;
        rawA = raw;
      } else {
        slotB = layers;
        nameB = project.name;
        rawB = raw;
      }
      loadId += 1;
      await recompute();
      if (hasBoth) viewMode = 'diff';
      else viewMode = side;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      progress = null;
    }
  }

  /** Re-apply saved per-file review state (type/color/visibility) after a fresh parse. */
  function applyOverrides(layers: Layer[], overrides: LayerOverride[]): Layer[] {
    const byName = new Map(overrides.map((o) => [o.fileName, o]));
    return layers
      .map((l) => {
        const o = byName.get(l.fileName);
        if (!o) return l;
        return {
          ...l,
          color: o.color,
          visible: o.visible,
          classification: {
            ...l.classification,
            type: o.type,
            side: sideForType(o.type),
            source: 'filename' as const,
            confidence: 1,
          },
          displayName: o.type === 'innerCopper' ? l.displayName : LAYER_TYPE_LABEL[o.type],
        };
      })
      .sort((a, b) => layerSortIndex(a.classification) - layerSortIndex(b.classification));
  }

  function overridesFor(layers: Layer[]): LayerOverride[] {
    return layers.map((l) => ({
      fileName: l.fileName,
      type: l.classification.type,
      color: l.color,
      visible: l.visible,
    }));
  }

  function sideSession(name: string | null, raw: RawFileBytes[], layers: Layer[]): SessionSide {
    return { name: name ?? '', files: raw, layers: overridesFor(layers) };
  }

  async function saveSession() {
    if (!hasProject) return;
    const baseName = (nameA ?? nameB ?? 'review').replace(/\.(zip|pcbdiff)$/i, '');
    const bytes = buildSession({
      viewMode,
      createdAt: new Date().toISOString(),
      a: hasA ? sideSession(nameA, rawA, slotA) : undefined,
      b: hasB ? sideSession(nameB, rawB, slotB) : undefined,
    });
    await saveBytes(`${baseName}${PCBDIFF_EXT}`, bytes);
  }

  async function openSessionFile(file: File) {
    error = null;
    try {
      progress = { phase: 'Opening session', done: 0, total: 0 };
      const { manifest, aFiles, bFiles } = parseSession(new Uint8Array(await file.arrayBuffer()));
      reset();
      if (aFiles.length) await loadInto('a', aFiles, manifest.a?.layers);
      if (bFiles.length) await loadInto('b', bFiles, manifest.b?.layers);
      if (hasBoth) forceSingle = false;
      else forceSingle = true;
      viewMode = (manifest.viewMode as ViewMode) ?? viewMode;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      progress = null;
    }
  }

  async function openWithDialog() {
    const files = await pickFiles({ multiple: true });
    if (files.length) void loadInto('a', files);
  }

  async function recompute() {
    regionIdx = -1;
    if (slotA.length && slotB.length) {
      diffing = true;
      try {
        pairDiffs = await runDiffs(matchLayers(slotA, slotB), (done, total, label) => {
          progress = { phase: `Diffing ${label}`, done, total };
        });
      } finally {
        diffing = false;
        progress = null;
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

  // Sidebar ops are keyed by layer pair (classification) and applied to BOTH
  // projects, so visibility/color stay in sync across A/B and every view mode.
  function updateBoth(fn: (ls: Layer[]) => Layer[]) {
    slotA = fn(slotA);
    slotB = fn(slotB);
  }
  function keyOfId(id: string): string | null {
    const l = slotA.find((x) => x.id === id) ?? slotB.find((x) => x.id === id);
    return l ? pairKey(l.classification) : null;
  }
  function toggle(id: string) {
    const k = keyOfId(id);
    if (!k) return;
    snapshot();
    const cur = slotA.find((x) => x.id === id) ?? slotB.find((x) => x.id === id);
    const next = !(cur?.visible ?? true);
    updateBoth((ls) =>
      ls.map((l) => (pairKey(l.classification) === k ? { ...l, visible: next } : l)),
    );
  }
  function setColor(id: string, color: string) {
    const k = keyOfId(id);
    if (!k) return;
    snapshot();
    updateBoth((ls) => ls.map((l) => (pairKey(l.classification) === k ? { ...l, color } : l)));
  }
  function showOnly(id: string) {
    const k = keyOfId(id);
    if (!k) return;
    snapshot();
    updateBoth((ls) => ls.map((l) => ({ ...l, visible: pairKey(l.classification) === k })));
  }
  function showAll() {
    snapshot();
    updateBoth((ls) => ls.map((l) => ({ ...l, visible: true })));
  }
  function hideAll() {
    snapshot();
    updateBoth((ls) => ls.map((l) => ({ ...l, visible: false })));
  }
  function invertVisibility() {
    snapshot();
    updateBoth((ls) => ls.map((l) => ({ ...l, visible: !l.visible })));
  }
  function setType(id: string, type: LayerType) {
    snapshot();
    // Reclassification targets one specific file → active side only.
    const apply = (ls: Layer[]): Layer[] =>
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
        .sort((a, b) => layerSortIndex(a.classification) - layerSortIndex(b.classification));
    if (activeSide === 'a') slotA = apply(slotA);
    else slotB = apply(slotB);
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
    // Editor shortcuts (work with or without a project).
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void saveSession();
      return;
    }
    if (e.key === '?') {
      helpOpen = true;
      return;
    }
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
    rawA = [];
    rawB = [];
    nameA = null;
    nameB = null;
    pairDiffs = [];
    undoStack = [];
    redoStack = [];
    error = null;
    viewMode = 'a';
    forceSingle = false;
  }

  // Native-shell menu actions (Electron) map onto the same handlers as the toolbar.
  onMount(() => {
    onMenuAction((action) => {
      if (action === 'open') void openWithDialog();
      else if (action === 'save-session') void saveSession();
      else if (action === 'reset') reset();
      else if (action === 'undo') undo();
      else if (action === 'redo') redo();
      else if (action === 'about') aboutOpen = true;
      else if (action === 'help') helpOpen = true;
    });
  });
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
        {#each VIEW_MODES as m (m.id)}
          <button
            class="mode"
            class:on={viewMode === m.id}
            title={m.title}
            onclick={() => (viewMode = m.id)}>{m.label}</button
          >
        {/each}
      </div>
      {#if viewMode === 'onion'}
        <input
          class="onion"
          data-testid="onion-mix"
          type="range"
          min="0"
          max="1"
          step="0.01"
          bind:value={onionMix}
          title="Blend A ↔ B"
        />
      {/if}
      <div class="regionnav">
        <button class="mode" title="Previous change (P)" onclick={() => gotoRegion(-1)}>‹</button>
        <span class="rcount" data-testid="region-count"
          >{regionIdx >= 0 ? regionIdx + 1 : 0}/{allRegions.length}</span
        >
        <button class="mode" title="Next change (N)" onclick={() => gotoRegion(1)}>›</button>
      </div>
    {/if}
    {#if hasProject}
      <div class="modes">
        <button
          class="mode"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          data-testid="undo"
          disabled={undoStack.length === 0}
          onclick={undo}>↶</button
        >
        <button
          class="mode"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          data-testid="redo"
          disabled={redoStack.length === 0}
          onclick={redo}>↷</button
        >
      </div>
      <button
        class="btn"
        data-testid="save-session"
        title="Save review (Ctrl+S)"
        onclick={saveSession}>Save</button
      >
    {/if}
    <button
      class="btn"
      data-testid="open-btn"
      title="Open files or a .pcbdiff"
      onclick={openWithDialog}>Open</button
    >
    {#if hasProject}<button class="btn" onclick={reset}>Reset</button>{/if}
    <button
      class="iconbtn"
      data-testid="help-btn"
      title="Keyboard shortcuts (?)"
      aria-label="Keyboard shortcuts"
      onclick={() => (helpOpen = true)}>?</button
    >
    <button
      class="iconbtn"
      data-testid="about-btn"
      title="About OpenGerberDiff"
      aria-label="About OpenGerberDiff"
      onclick={() => (aboutOpen = true)}>ⓘ</button
    >
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
    {#if showWorkspace}
      <LayerList
        layers={activeLayers}
        files={layerFiles}
        dual={hasBoth}
        ontoggle={toggle}
        oncolor={setColor}
        onsolo={showOnly}
        oncontext={openMenu}
      />
      <main class="view-area">
        <Viewer
          layers={viewerLayers}
          mode={viewerMode}
          diffs={diffRenders}
          diffOpts={viewerDiffOpts}
          unit={$settings.measurementUnit}
          background={$settings.backgroundColor}
          fitKey={loadId}
          {focusBox}
          {focusKey}
        />
      </main>
      {#if DIFF_MODES.has(viewMode)}
        <DiffSummary {pairDiffs} onfocus={focusRegion} />
      {/if}
    {:else if !hasProject && !splashDismissed}
      <main class="view-area">
        <Splash onstart={() => (splashDismissed = true)} />
      </main>
    {:else}
      <main class="view-area">
        <div class="dual-drop" data-testid="dropzone">
          {#each [{ side: 'a', name: nameA, has: hasA, count: slotA.length, open: () => inputA?.click() }, { side: 'b', name: nameB, has: hasB, count: slotB.length, open: () => inputB?.click() }] as z (z.side)}
            <button
              class="bigzone"
              class:filled={z.has}
              class:over={dragOver === z.side}
              data-testid="bigdrop-{z.side}"
              ondragover={(e) => {
                e.preventDefault();
                dragOver = z.side as 'a' | 'b';
              }}
              ondragleave={() => (dragOver = null)}
              ondrop={(e) => onDrop(z.side as 'a' | 'b', e)}
              onclick={z.open}
            >
              <div class="bz-badge" class:done={z.has}>{z.has ? '✓' : z.side.toUpperCase()}</div>
              {#if z.has}
                <div class="bz-name">{z.name}</div>
                <div class="bz-sub">{z.count} layers · click or drop to replace</div>
              {:else}
                <div class="bz-title">Drop project {z.side.toUpperCase()}</div>
                <div class="bz-sub">folder or .zip — or click to open</div>
              {/if}
            </button>
          {/each}
        </div>
        {#if hasA !== hasB}
          <div class="continue-bar">
            <span class="hint">Drop the second project to diff, or</span>
            <button class="btn" data-testid="continue-single" onclick={() => (forceSingle = true)}>
              Continue with project {hasA ? 'A' : 'B'} only →
            </button>
          </div>
        {/if}
        {#if error}<p class="err drop-err" data-testid="error">⚠ {error}</p>{/if}
      </main>
    {/if}

    {#if progress}
      <div class="progress-overlay" data-testid="progress">
        <div class="progress-card">
          <div class="pc-phase">{progress.phase}…</div>
          {#if progress.total > 0}
            <div class="pc-bar">
              <div
                class="pc-fill"
                style:width="{Math.round((progress.done / progress.total) * 100)}%"
              ></div>
            </div>
            <div class="pc-count">{progress.done} / {progress.total}</div>
          {:else}
            <div class="spinner"></div>
          {/if}
        </div>
      </div>
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
    {#if error}<span class="err">{error}</span><span class="sep">·</span>{/if}
    {#if hasProject}
      <div class="unitsel" data-testid="unit-toggle" title="Measurement unit">
        {#each ['mm', 'mil', 'inch'] as u (u)}
          <button
            class="unit"
            class:on={$settings.measurementUnit === u}
            onclick={() => ($settings.measurementUnit = u as typeof $settings.measurementUnit)}
            >{u === 'inch' ? 'in' : u}</button
          >
        {/each}
      </div>
      <span class="sep">·</span>
    {/if}
    <button
      class="build"
      data-testid="build-info"
      title="About — version {VERSION}, build {GIT_SHA}"
      onclick={() => (aboutOpen = true)}
    >
      OGD v{VERSION}<span class="sep">·</span><span class="sha">{GIT_SHA}</span>
    </button>
  </footer>
</div>

<About open={aboutOpen} onclose={() => (aboutOpen = false)} />
<Help open={helpOpen} onclose={() => (helpOpen = false)} />

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
    gap: 0.5rem;
    background: var(--bg);
    border: 1px dashed var(--border);
    border-radius: 8px;
    padding: 0.4rem 0.9rem;
    min-width: 150px;
    max-width: 240px;
  }
  .slot:hover {
    border-color: var(--accent);
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
  .mode:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .onion {
    width: 90px;
    accent-color: var(--accent);
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
  .iconbtn {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 6px;
    padding: 0.3rem 0.5rem;
    font-size: 0.95rem;
    line-height: 1;
  }
  .iconbtn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .main-area {
    position: relative;
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .view-area {
    flex: 1;
    min-width: 0;
  }
  .dual-drop {
    height: 100%;
    display: flex;
    gap: 1.5rem;
    padding: 2rem 2rem 4.5rem;
  }
  .continue-bar {
    position: absolute;
    bottom: 1.1rem;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
  }
  .continue-bar .hint {
    color: var(--text-dim);
    font-size: 0.85rem;
  }
  .bigzone {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    border: 2px dashed var(--border);
    border-radius: 16px;
    background: var(--panel);
    color: var(--text);
    transition:
      border-color 0.12s,
      background 0.12s;
  }
  .bigzone:hover {
    border-color: var(--accent);
  }
  .bigzone.over {
    border-color: var(--accent);
    background: rgba(0, 255, 136, 0.08);
  }
  .bigzone.filled {
    border-style: solid;
  }
  .bz-badge {
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 1.2rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--text-dim);
  }
  .bz-badge.done {
    background: var(--accent);
    color: #10101a;
    border-color: var(--accent);
  }
  .bz-title,
  .bz-name {
    font-size: 1.2rem;
  }
  .bz-sub {
    color: var(--text-dim);
    font-size: 0.85rem;
  }
  .err {
    color: #ff6b6b;
    font-family: var(--mono);
    font-size: 0.85rem;
  }
  .drop-err {
    position: absolute;
    bottom: 1rem;
    left: 0;
    right: 0;
    text-align: center;
  }
  .progress-overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(10, 10, 20, 0.55);
    z-index: 20;
  }
  .progress-card {
    min-width: 280px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.25rem 1.5rem;
    text-align: center;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }
  .pc-phase {
    font-size: 0.95rem;
    margin-bottom: 0.75rem;
  }
  .pc-bar {
    height: 8px;
    background: var(--bg);
    border-radius: 6px;
    overflow: hidden;
  }
  .pc-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.15s ease;
  }
  .pc-count {
    margin-top: 0.5rem;
    font-family: var(--mono);
    font-size: 0.8rem;
    color: var(--text-dim);
  }
  .spinner {
    width: 28px;
    height: 28px;
    margin: 0.25rem auto 0;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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
  .unitsel {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 5px;
    overflow: hidden;
  }
  .unit {
    background: var(--bg);
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 0.72rem;
    padding: 0.1rem 0.4rem;
    cursor: pointer;
  }
  .unit:last-child {
    border-right: none;
  }
  .unit.on {
    background: var(--accent);
    color: #10101a;
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
  .build {
    background: transparent;
    border: none;
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 0.78rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.1rem 0.3rem;
    border-radius: 5px;
  }
  .build:hover {
    color: var(--text);
    background: var(--bg);
  }
  .build .sha {
    color: var(--accent);
  }
</style>
