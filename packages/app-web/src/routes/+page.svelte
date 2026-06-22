<script lang="ts">
  import { OGD_CORE_VERSION } from '@ogd/core';
  import Dropzone from '$lib/components/Dropzone.svelte';
  import { settings } from '$lib/stores/settings';

  // Surfaced in the status bar so we can confirm cross-origin isolation in tests.
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
</script>

<div class="app">
  <header class="topbar">
    <h1 class="brand">OpenGerberDiff</h1>
    <span class="tag">visual + quantitative PCB diff · runs 100% in your browser</span>
  </header>

  <main class="view-area">
    <div class="dual">
      <Dropzone label="A" accent={$settings.colorA} />
      <Dropzone label="B" accent={$settings.colorB} />
    </div>
  </main>

  <footer class="statusbar" data-testid="statusbar">
    <span>Ready</span>
    <span class="sep">·</span>
    <span data-testid="iso-flag">isolated: {isolated ? 'yes' : 'no'}</span>
    <span class="spacer"></span>
    <span class="dim">core v{OGD_CORE_VERSION}</span>
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
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.6rem 1rem;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    margin: 0;
    font-size: 1.15rem;
    letter-spacing: 0.3px;
  }
  .tag {
    color: var(--text-dim);
    font-size: 0.82rem;
  }
  .view-area {
    flex: 1;
    padding: 1.5rem;
    overflow: auto;
  }
  .dual {
    display: flex;
    gap: 1.5rem;
    height: 100%;
    min-height: 0;
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
  .spacer {
    flex: 1;
  }
  .dim {
    opacity: 0.7;
  }
</style>
