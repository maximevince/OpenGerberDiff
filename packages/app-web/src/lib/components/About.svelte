<script lang="ts" module>
  // App provenance + attribution, shared by the About dialog and the status bar.
  export const REPO_URL = 'https://github.com/maximevince/OpenGerberDiff';
  export const LICENSE_URL = 'https://github.com/maximevince/OpenGerberDiff/blob/main/LICENSE';
  export const AUTHOR = 'Maxime Vincent';
  export const AUTHOR_URL = 'https://github.com/maximevince';
  export const VERSION = __APP_VERSION__;
  export const GIT_SHA = __GIT_SHA__;
  export const BUILD_DATE = __BUILD_DATE__;
</script>

<script lang="ts">
  let { open = false, onclose }: { open?: boolean; onclose: () => void } = $props();

  let dialog: HTMLDialogElement | undefined = $state();

  // Drive the native <dialog> from the `open` prop so it gets the built-in modal
  // semantics (focus trap, Esc, inert background) for free.
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  const FORMATS = [
    { name: 'Gerber RS-274X', ext: '.gbr, .ger, .art, layer extensions' },
    { name: 'Excellon drill', ext: '.drl, .xln, .txt' },
    { name: 'Archives', ext: '.zip of the above, or a dropped folder' },
  ];

  const LIBS = [
    { name: '@tracespace gerber-parser / gerber-plotter', what: 'Gerber/Excellon parsing (v4)' },
    { name: 'whats-that-gerber', what: 'layer-type classification' },
    { name: 'Svelte 5 + SvelteKit', what: 'static SPA framework' },
    { name: 'Comlink', what: 'typed Web Worker RPC' },
    { name: 'fflate', what: 'in-browser zip extraction' },
  ];
</script>

<dialog
  bind:this={dialog}
  class="about"
  data-testid="about-dialog"
  {onclose}
  onclick={(e) => {
    // Click on the backdrop (the dialog element itself) closes it.
    if (e.target === dialog) onclose();
  }}
>
  {#if open}
    <div class="sheet">
      <header class="ab-head">
        <h2>OpenGerberDiff</h2>
        <button class="x" aria-label="Close" onclick={onclose}>✕</button>
      </header>

      <p class="tagline">
        Free, open-source, pure-web visual &amp; quantitative diff tool for Gerber/Excellon PCB
        fabrication files.
      </p>
      <p class="purpose">
        Load two revisions of a board and see exactly what copper was added or removed — per layer,
        in real mm² — using a coverage-area diff engine rather than a pixel XOR. Everything runs
        locally in your browser; your files never leave your machine.
      </p>

      <section>
        <h3>Supported formats</h3>
        <ul class="kv">
          {#each FORMATS as f (f.name)}
            <li><span class="k">{f.name}</span><span class="v">{f.ext}</span></li>
          {/each}
        </ul>
      </section>

      <section>
        <h3>Built with</h3>
        <ul class="kv">
          {#each LIBS as l (l.name)}
            <li><span class="k">{l.name}</span><span class="v">{l.what}</span></li>
          {/each}
        </ul>
      </section>

      <footer class="ab-foot">
        <div class="meta">
          <span class="ver">v{VERSION}</span>
          <a
            class="sha"
            href={`${REPO_URL}/commit/${GIT_SHA}`}
            target="_blank"
            rel="noopener noreferrer">{GIT_SHA}</a
          >
          <span class="dim">· {BUILD_DATE}</span>
        </div>
        <div class="links">
          <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">GPL-3.0</a>
          <span class="dim">· by</span>
          <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">{AUTHOR}</a>
          <a class="repo" href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub repo ↗
          </a>
        </div>
      </footer>
    </div>
  {/if}
</dialog>

<style>
  .about {
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 0;
    background: var(--bg-elev);
    color: var(--text);
    max-width: 540px;
    width: calc(100vw - 2rem);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
  }
  .about::backdrop {
    background: rgba(8, 8, 16, 0.6);
    backdrop-filter: blur(2px);
  }
  .sheet {
    padding: 1.4rem 1.6rem 1.2rem;
  }
  .ab-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .ab-head h2 {
    margin: 0;
    font-size: 1.25rem;
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
  .tagline {
    margin: 0 0 0.6rem;
    font-weight: 600;
  }
  .purpose {
    margin: 0 0 1.1rem;
    color: var(--text-dim);
    font-size: 0.9rem;
    line-height: 1.5;
  }
  section {
    margin-bottom: 1.1rem;
  }
  section h3 {
    margin: 0 0 0.4rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
  }
  .kv {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .kv li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.85rem;
  }
  .kv .k {
    color: var(--text);
  }
  .kv .v {
    color: var(--text-dim);
    text-align: right;
    font-family: var(--mono);
    font-size: 0.78rem;
  }
  .ab-foot {
    border-top: 1px solid var(--border);
    padding-top: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--mono);
    font-size: 0.82rem;
  }
  .ver {
    color: var(--text);
  }
  .meta .sha {
    color: var(--accent);
  }
  .dim {
    color: var(--text-dim);
  }
  .links {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 0.85rem;
  }
  .links a {
    color: var(--accent);
    text-decoration: none;
  }
  .links a:hover {
    text-decoration: underline;
  }
  .repo {
    margin-left: auto;
  }
</style>
