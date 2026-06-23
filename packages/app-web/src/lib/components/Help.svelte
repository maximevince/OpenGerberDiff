<script lang="ts">
  let { open = false, onclose }: { open?: boolean; onclose: () => void } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  const GROUPS: { title: string; keys: [string, string][] }[] = [
    {
      title: 'View',
      keys: [
        ['Mouse wheel', 'Zoom'],
        ['Drag', 'Pan'],
        ['Double-click', 'Fit to view'],
        ['M', 'Measure tool (click two points)'],
        ['Esc', 'Cancel measuring'],
      ],
    },
    {
      title: 'Layers',
      keys: [
        ['1 – 9', 'Toggle layer N'],
        ['A', 'Show all layers'],
        ['H', 'Hide all layers'],
        ['I', 'Invert visibility'],
        ['Right-click', 'Layer menu (solo, reassign type)'],
      ],
    },
    {
      title: 'Diff',
      keys: [
        ['N', 'Next change region'],
        ['P', 'Previous change region'],
      ],
    },
    {
      title: 'Session',
      keys: [
        ['Ctrl/⌘ + Z', 'Undo'],
        ['Ctrl/⌘ + Shift + Z', 'Redo'],
        ['Ctrl/⌘ + S', 'Save .pcbdiff review'],
        ['?', 'This help'],
      ],
    },
  ];
</script>

<dialog
  bind:this={dialog}
  class="help"
  data-testid="help-dialog"
  {onclose}
  onclick={(e) => {
    if (e.target === dialog) onclose();
  }}
>
  {#if open}
    <div class="sheet">
      <header class="hd">
        <h2>Keyboard &amp; mouse</h2>
        <button class="x" aria-label="Close" onclick={onclose}>✕</button>
      </header>
      <div class="grid">
        {#each GROUPS as g (g.title)}
          <section>
            <h3>{g.title}</h3>
            <ul>
              {#each g.keys as [k, v] (k)}
                <li><kbd>{k}</kbd><span>{v}</span></li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    </div>
  {/if}
</dialog>

<style>
  .help {
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 0;
    background: var(--bg-elev);
    color: var(--text);
    max-width: 620px;
    width: calc(100vw - 2rem);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
  }
  .help::backdrop {
    background: rgba(8, 8, 16, 0.6);
    backdrop-filter: blur(2px);
  }
  .sheet {
    padding: 1.4rem 1.6rem 1.2rem;
  }
  .hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.8rem;
  }
  .hd h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  .x {
    background: transparent;
    border: none;
    color: var(--text-dim);
    font-size: 1rem;
    padding: 0.2rem 0.4rem;
    border-radius: 6px;
  }
  .x:hover {
    color: var(--text);
    background: var(--bg);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem 1.6rem;
  }
  section h3 {
    margin: 0 0 0.4rem;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
  }
  ul {
    list-style: none;
    margin: 0 0 0.8rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    font-size: 0.85rem;
  }
  kbd {
    flex: none;
    min-width: 5.5rem;
    font-family: var(--mono);
    font-size: 0.72rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.1rem 0.35rem;
    color: var(--text);
  }
  li span {
    color: var(--text-dim);
  }
</style>
