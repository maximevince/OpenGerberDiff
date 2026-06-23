<script lang="ts">
  import {
    emptyBoundingBox,
    isFiniteBoundingBox,
    unionBoundingBox,
    type BoundingBox,
  } from '@ogd/core';
  import { renderLayers, type RenderLayer } from '$lib/render/canvas2d';
  import { fitView, panBy, zoomAbout, type Viewport } from '$lib/render/viewport';

  interface Props {
    /** Layers in top-first order (rendered bottom-first). */
    layers: RenderLayer[];
    background?: string;
    /** Change this to trigger a re-fit (e.g. when a new project loads). */
    fitKey?: unknown;
  }
  let { layers, background = '#1a1a2e', fitKey = undefined }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let container: HTMLDivElement | undefined = $state();
  let vp: Viewport | null = $state(null);
  let dpr = 1;
  let cursorMm = $state<{ x: number; y: number } | null>(null);

  function deviceSize(): { w: number; h: number } {
    if (!container) return { w: 1, h: 1 };
    // Cap DPR at 2 to bound fill cost on HiDPI displays.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    return {
      w: Math.max(1, Math.round(container.clientWidth * dpr)),
      h: Math.max(1, Math.round(container.clientHeight * dpr)),
    };
  }

  // Coalesce bursts of pan/zoom updates into one draw per animation frame.
  let rafId = 0;
  function scheduleDraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      draw();
    });
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

  function draw() {
    if (!canvas || !vp) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== vp.width || canvas.height !== vp.height) {
      canvas.width = vp.width;
      canvas.height = vp.height;
    }
    // Render bottom-first (layers come in top-first order).
    renderLayers(ctx, layers.slice().reverse(), vp, background);
  }

  // Re-fit only when the project identity changes.
  $effect(() => {
    void fitKey;
    fit();
  });

  // Redraw on layer/visibility/color/viewport change (throttled to one per frame).
  $effect(() => {
    void layers;
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

  function onPointerDown(e: PointerEvent) {
    if (!vp) return;
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
  ></canvas>

  <button class="fit-btn" onclick={fit} title="Fit to view (double-click)">Fit</button>
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
  .fit-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
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
