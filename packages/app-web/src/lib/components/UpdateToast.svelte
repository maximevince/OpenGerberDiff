<script lang="ts">
  import { updateReady, applyUpdate } from '$lib/pwa';

  let dismissed = $state(false);
</script>

{#if $updateReady && !dismissed}
  <div class="update" role="status" data-testid="update-toast">
    <span>A new version of OpenGerberDiff is available.</span>
    <button class="primary" onclick={applyUpdate}>Reload</button>
    <button class="later" onclick={() => (dismissed = true)}>Later</button>
  </div>
{/if}

<style>
  .update {
    position: fixed;
    right: 16px;
    bottom: 40px;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: calc(100vw - 32px);
    padding: 10px 12px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
    font-size: 13px;
  }
  button {
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--border);
    background: transparent;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #000;
    font-weight: 600;
  }
  .later {
    color: var(--text-dim);
  }
</style>
