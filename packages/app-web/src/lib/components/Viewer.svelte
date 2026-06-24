<script lang="ts">
  import {
    emptyBoundingBox,
    formatLength,
    isFiniteBoundingBox,
    unionBoundingBox,
    type BoundingBox,
    type DisplayUnit,
  } from '@ogd/core';
  import {
    renderDiff,
    renderLayers,
    type DiffPair,
    type DiffRenderOptions,
    type RenderLayer,
  } from '$lib/render/canvas2d';
  import { fitView, panBy, worldToScreen, zoomAbout, type Viewport } from '$lib/render/viewport';
  import { untrack } from 'svelte';

  interface Props {
    /** Layers in top-first order (rendered bottom-first) — also used for framing. */
    layers: RenderLayer[];
    mode?: 'layers' | 'diff';
    diffs?: DiffPair[];
    diffOpts?: DiffRenderOptions;
    background?: string;
    /** Change to trigger a re-fit (e.g. when a new project loads). */
    fitKey?: unknown;
    /** Box to zoom to (e.g. a change region); bump focusKey to apply. */
    focusBox?: BoundingBox | null;
    focusKey?: unknown;
    /** Unit for the measurement readout. */
    unit?: DisplayUnit;
  }
  let {
    layers,
    mode = 'layers',
    diffs = [],
    diffOpts = {},
    background = '#1a1a2e',
    fitKey = undefined,
    focusBox = null,
    focusKey = undefined,
    unit = 'mm',
  }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let container: HTMLDivElement | undefined = $state();
  let vp: Viewport | null = $state(null);
  let dpr = 1;
  let cursorMm = $state<{ x: number; y: number } | null>(null);

  function deviceSize(): { w: number; h: number } {
    if (!container) return { w: 1, h: 1 };
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    return {
      w: Math.max(1, Math.round(container.clientWidth * dpr)),
      h: Math.max(1, Math.round(container.clientHeight * dpr)),
    };
  }

  function visibleBounds(): BoundingBox {
    let box = emptyBoundingBox();
    for (const l of layers) {
      if (l.visible && isFiniteBoundingBox(l.image.boundingBox)) {
        box = unionBoundingBox(box, l.image.boundingBox);
      }
    }
    return box;
  }

  function fit() {
    const { w, h } = deviceSize();
    vp = fitView(visibleBounds(), w, h);
  }

  let rafId = 0;
  function scheduleDraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      draw();
    });
  }

  function draw() {
    if (!canvas || !vp) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== vp.width || canvas.height !== vp.height) {
      canvas.width = vp.width;
      canvas.height = vp.height;
    }
    if (mode === 'diff') renderDiff(ctx, diffs, vp, background, diffOpts);
    else renderLayers(ctx, layers.slice().reverse(), vp, background);
  }

  // Fit ONLY when fitKey changes (new project / explicit re-fit). `fit()` reads
  // `layers` via visibleBounds(), so without untrack() every visibility toggle
  // would reactively re-fit and rezoom the view — jarring. untrack keeps the
  // layer reads out of this effect's dependency set.
  $effect(() => {
    void fitKey;
    untrack(fit);
  });

  // Focus on a region.
  $effect(() => {
    void focusKey;
    if (focusBox && isFiniteBoundingBox(focusBox)) {
      const { w, h } = deviceSize();
      vp = fitView(focusBox, w, h, 0.5);
    }
  });

  $effect(() => {
    void layers;
    void diffs;
    void diffOpts;
    void mode;
    void background;
    void vp;
    scheduleDraw();
  });

  $effect(() => () => {
    if (rafId) cancelAnimationFrame(rafId);
  });

  $effect(() => {
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const { w, h } = deviceSize();
      if (vp) vp = { ...vp, width: w, height: h };
      else fit();
      scheduleDraw();
    });
    ro.observe(container);
    return () => ro.disconnect();
  });

  function localDevice(e: { clientX: number; clientY: number }): [number, number] {
    const rect = canvas!.getBoundingClientRect();
    return [(e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr];
  }

  function onWheel(e: WheelEvent) {
    if (!vp) return;
    e.preventDefault();
    const [sx, sy] = localDevice(e);
    vp = zoomAbout(vp, sx, sy, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  let dragging = $state(false);
  let last: [number, number] = [0, 0];

  // Measurement: click two points to read ΔX/ΔY/distance in `unit`.
  let measuring = $state(false);
  let mPts = $state<Array<{ x: number; y: number }>>([]);
  function screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - vp!.panX) / vp!.zoom, y: (vp!.panY - sy) / vp!.zoom };
  }
  function toggleMeasure() {
    measuring = !measuring;
    if (!measuring) mPts = [];
  }
  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'm' || e.key === 'M') toggleMeasure();
    else if (e.key === 'Escape' && measuring) {
      measuring = false;
      mPts = [];
    }
  }
  const measurement = $derived.by(() => {
    if (mPts.length < 2) return null;
    const [p, q] = mPts as [{ x: number; y: number }, { x: number; y: number }];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    return { p, q, dx, dy, dist: Math.hypot(dx, dy) };
  });
  /** World mm → CSS px within the container (worldToScreen is in device px). */
  function worldCss(x: number, y: number): [number, number] {
    const [sx, sy] = worldToScreen(vp!, x, y);
    return [sx / dpr, sy / dpr];
  }

  function onPointerDown(e: PointerEvent) {
    if (!vp) return;
    if (measuring) {
      const [sx, sy] = localDevice(e);
      const w = screenToWorld(sx, sy);
      mPts = mPts.length >= 2 ? [w] : [...mPts, w];
      return;
    }
    dragging = true;
    last = [e.clientX, e.clientY];
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (vp && canvas) {
      const [sx, sy] = localDevice(e);
      cursorMm = { x: (sx - vp.panX) / vp.zoom, y: (vp.panY - sy) / vp.zoom };
    }
    if (!dragging || !vp) return;
    const dx = (e.clientX - last[0]) * dpr;
    const dy = (e.clientY - last[1]) * dpr;
    last = [e.clientX, e.clientY];
    vp = panBy(vp, dx, dy);
  }
  function onPointerUp(e: PointerEvent) {
    dragging = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="viewer" bind:this={container}>
  <canvas
    bind:this={canvas}
    data-testid="board-canvas"
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointerleave={() => (cursorMm = null)}
    ondblclick={fit}
    class:grabbing={dragging}
    class:measuring
  ></canvas>

  {#if vp && mPts.length > 0}
    <svg class="measure-overlay" aria-hidden="true">
      {#if measurement}
        {@const [x1, y1] = worldCss(measurement.p.x, measurement.p.y)}
        {@const [x2, y2] = worldCss(measurement.q.x, measurement.q.y)}
        <line {x1} {y1} {x2} {y2} class="m-line" />
        <circle cx={x1} cy={y1} r="3.5" class="m-dot" />
        <circle cx={x2} cy={y2} r="3.5" class="m-dot" />
        <foreignObject x={(x1 + x2) / 2 - 70} y={(y1 + y2) / 2 - 38} width="140" height="34">
          <div class="m-label" data-testid="measure-label">
            Δ {formatLength(Math.abs(measurement.dx), unit)} · {formatLength(
              Math.abs(measurement.dy),
              unit,
            )}
            <br />⟂ {formatLength(measurement.dist, unit)}
          </div>
        </foreignObject>
      {:else}
        {@const [x1, y1] = worldCss(mPts[0]!.x, mPts[0]!.y)}
        <circle cx={x1} cy={y1} r="3.5" class="m-dot" />
      {/if}
    </svg>
  {/if}

  <div class="tools">
    <button
      class="tool-btn"
      class:on={measuring}
      data-testid="measure-btn"
      title="Measure (M) — click two points"
      onclick={toggleMeasure}>⟺</button
    >
    <button class="tool-btn" onclick={fit} title="Fit to view (double-click)">Fit</button>
  </div>
  <div class="coords" data-testid="cursor-coords">
    {#if cursorMm}{cursorMm.x.toFixed(3)}, {cursorMm.y.toFixed(3)} mm{:else}—{/if}
  </div>
</div>

<style>
  .viewer {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    cursor: crosshair;
  }
  canvas.grabbing {
    cursor: grabbing;
  }
  canvas.measuring {
    cursor: crosshair;
  }
  .tools {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: flex;
    gap: 0.3rem;
  }
  .tool-btn {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 0.25rem 0.55rem;
    font-size: 0.85rem;
    line-height: 1;
  }
  .tool-btn:hover {
    border-color: var(--accent);
  }
  .tool-btn.on {
    background: var(--accent);
    color: #10101a;
    border-color: var(--accent);
  }
  .measure-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  .m-line {
    stroke: #ffd166;
    stroke-width: 1.5;
    stroke-dasharray: 5 3;
  }
  .m-dot {
    fill: #ffd166;
    stroke: #1a1a2e;
    stroke-width: 1;
  }
  .m-label {
    font-family: var(--mono);
    font-size: 0.7rem;
    color: #10101a;
    background: #ffd166;
    border-radius: 4px;
    padding: 0.15rem 0.35rem;
    text-align: center;
    line-height: 1.25;
    white-space: nowrap;
    display: inline-block;
  }
  .coords {
    position: absolute;
    bottom: 0.4rem;
    left: 0.5rem;
    font-family: var(--mono);
    font-size: 0.75rem;
    color: var(--text-dim);
    background: rgba(0, 0, 0, 0.35);
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
  }
</style>
