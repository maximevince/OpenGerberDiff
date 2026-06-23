<script lang="ts" module>
  export interface MenuItem {
    label?: string;
    action?: () => void;
    children?: MenuItem[];
    separator?: boolean;
    disabled?: boolean;
    swatch?: string;
  }
</script>

<script lang="ts">
  interface Props {
    x: number;
    y: number;
    items: MenuItem[];
    onclose: () => void;
  }
  let { x, y, items, onclose }: Props = $props();

  let openSub = $state<number | null>(null);

  function run(item: MenuItem) {
    if (item.disabled || !item.action) return;
    item.action();
    onclose();
  }
</script>

<svelte:window
  onpointerdown={(e) => {
    if (!(e.target as HTMLElement).closest('.ctx-menu')) onclose();
  }}
  onkeydown={(e) => e.key === 'Escape' && onclose()}
/>

<div class="ctx-menu" style:left="{x}px" style:top="{y}px" role="menu" data-testid="context-menu">
  {#each items as item, i (i)}
    {#if item.separator}
      <div class="sep"></div>
    {:else if item.children}
      <div
        class="item has-sub"
        role="menuitem"
        tabindex="-1"
        onclick={() => (openSub = openSub === i ? null : i)}
        onkeydown={(e) => e.key === 'Enter' && (openSub = openSub === i ? null : i)}
      >
        {item.label}<span class="arrow">▸</span>
        {#if openSub === i}
          <div class="submenu">
            {#each item.children as child, j (j)}
              <button
                class="item"
                role="menuitem"
                disabled={child.disabled}
                onclick={(e) => {
                  e.stopPropagation();
                  run(child);
                }}
              >
                {#if child.swatch}<span class="swatch" style:background={child.swatch}></span>{/if}
                {child.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <button class="item" role="menuitem" disabled={item.disabled} onclick={() => run(item)}>
        {#if item.swatch}<span class="swatch" style:background={item.swatch}></span>{/if}
        {item.label}
      </button>
    {/if}
  {/each}
</div>

<style>
  .ctx-menu {
    position: fixed;
    z-index: 1000;
    min-width: 190px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.25rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    font-size: 0.85rem;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    padding: 0.35rem 0.6rem;
    border-radius: 5px;
    white-space: nowrap;
    position: relative;
  }
  .item:hover:not(:disabled),
  .item.has-sub:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .item:disabled {
    opacity: 0.4;
  }
  .has-sub {
    justify-content: space-between;
  }
  .arrow {
    opacity: 0.6;
    margin-left: auto;
    padding-left: 0.5rem;
  }
  .sep {
    height: 1px;
    background: var(--border);
    margin: 0.25rem 0.3rem;
  }
  .submenu {
    position: absolute;
    left: 100%;
    top: -0.25rem;
    margin-left: 2px;
    min-width: 170px;
    max-height: 60vh;
    overflow-y: auto;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.25rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }
  .swatch {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    flex: none;
  }
</style>
