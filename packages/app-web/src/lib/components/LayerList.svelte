<script lang="ts">
  import type { Layer } from '$lib/project';

  interface Props {
    layers: Layer[];
    /** Per-layer matched filenames (A side + B side). */
    files?: Map<string, { a: string | null; b: string | null }>;
    /** Two projects loaded → label filenames A/B. */
    dual?: boolean;
    ontoggle: (id: string) => void;
    oncolor: (id: string, color: string) => void;
    onsolo?: (id: string) => void;
    oncontext?: (id: string, x: number, y: number) => void;
  }
  let { layers, files, dual = false, ontoggle, oncolor, onsolo, oncontext }: Props = $props();
</script>

<div class="layers" data-testid="layer-list">
  <div class="header">
    <span>Layers</span>
    <span class="count" data-testid="layer-count">{layers.length}</span>
  </div>
  <ul>
    {#each layers as layer (layer.id)}
      <li
        class="row"
        class:hidden={!layer.visible}
        data-testid="layer-row"
        oncontextmenu={(e) => {
          if (oncontext) {
            e.preventDefault();
            oncontext(layer.id, e.clientX, e.clientY);
          }
        }}
      >
        <button
          class="vis"
          title={layer.visible ? 'Hide layer' : 'Show layer'}
          aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
          onclick={() => ontoggle(layer.id)}
        >
          {layer.visible ? '●' : '○'}
        </button>
        <input
          class="swatch"
          type="color"
          value={layer.color}
          title="Layer color"
          aria-label="Layer color for {layer.displayName}"
          oninput={(e) => oncolor(layer.id, (e.target as HTMLInputElement).value)}
        />
        <button class="name" title="Solo this layer" onclick={() => onsolo?.(layer.id)}>
          <span class="display">{layer.displayName}</span>
          {#if files?.get(layer.id)}
            {@const f = files.get(layer.id)!}
            {#if dual}
              <span class="file" class:missing={!f.a}><span class="side">A</span>{f.a ?? '—'}</span>
              <span class="file" class:missing={!f.b}><span class="side">B</span>{f.b ?? '—'}</span>
            {:else}
              <span class="file">{f.a ?? f.b ?? layer.fileName}</span>
            {/if}
          {:else}
            <span class="file">{layer.fileName}</span>
          {/if}
        </button>
        {#if layer.classification.source === 'fallback' || layer.classification.confidence < 0.4}
          <span class="warn" title="Low-confidence classification">?</span>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .layers {
    display: flex;
    flex-direction: column;
    width: 250px;
    flex: none;
    background: var(--panel);
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  .header {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--panel);
  }
  .count {
    opacity: 0.7;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .row.hidden {
    opacity: 0.45;
  }
  .vis {
    background: none;
    border: none;
    color: var(--text);
    width: 1.7rem;
    height: 1.7rem;
    flex: none;
    font-size: 1.2rem;
    cursor: pointer;
    border-radius: 4px;
  }
  .vis:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .swatch {
    width: 1.6rem;
    height: 1.6rem;
    flex: none;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: none;
    cursor: pointer;
  }
  .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    display: flex;
    flex-direction: column;
    gap: 1px;
    line-height: 1.2;
  }
  .display {
    font-size: 0.9rem;
  }
  .file {
    font-size: 0.72rem;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file.missing {
    color: #e0703c;
    font-style: italic;
  }
  .side {
    display: inline-block;
    width: 1rem;
    margin-right: 0.25rem;
    font-weight: 700;
    color: var(--accent);
    font-family: var(--mono);
  }
  .file.missing .side {
    color: #e0703c;
  }
  .warn {
    color: #ffb454;
    font-weight: 700;
    cursor: help;
  }
</style>
