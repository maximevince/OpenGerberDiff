<script lang="ts">
  import type { Image } from '@ogd/core';
  import { renderImage } from '$lib/render/canvas2d';
  import { fitView, panBy, zoomAbout, type Viewport } from '$lib/render/viewport';

  interface Props {
    image: Image | null;
    color?: string;
    background?: string;
  }
  let { image, color = '#00ff88', background = '#1a1a2e' }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let container: HTMLDivElement | undefined = $state();
  let vp: Viewport | null = $state(null);
  let dpr = 1;

  // Cursor world position (mm) for the status line.
  let cursorMm = $state<{ x: number; y: number } | null>(null);

  function deviceSize(): { w: number; h: number } {
    if (!container) return { w: 1, h: 1 };
    dpr = window.devicePixelRatio || 1;
    return {
      w: Math.max(1, container.clientWidth * dpr),
      h: Math.max(1, container.clientHeight * dpr),
    };
  }

  function fit() {
    if (!image) return;
    const { w, h } = deviceSize();
    vp = fitView(image.boundingBox, w, h);
  }

  function draw() {
    if (!canvas || !vp) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== vp.width || canvas.height !== vp.height) {
      canvas.width = vp.width;
      canvas.height = vp.height;
    }
    if (!image) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    renderImage(ctx, image, vp, { color, background });
  }

  // Re-fit whenever a new image arrives.
  $effect(() => {
    if (image) fit();
  });

  // Redraw on any state change.
  $effect(() => {
    void image;
    void color;
    void background;
    void vp;
    draw();
  });

  $effect(() => {
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const { w, h } = deviceSize();
      if (vp) vp = { ...vp, width: w, height: h };
      else fit();
      draw();
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
      const w = (sx - vp.panX) / vp.zoom;
      const h = (vp.panY - sy) / vp.zoom;
      cursorMm = { x: w, y: h };
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

  {#if image}
    <button class="fit-btn" onclick={fit} title="Fit to view (double-click)">Fit</button>
    <div class="coords" data-testid="cursor-coords">
      {#if cursorMm}{cursorMm.x.toFixed(3)}, {cursorMm.y.toFixed(3)} mm{:else}—{/if}
    </div>
  {/if}
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
