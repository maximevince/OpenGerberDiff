<script lang="ts">
  // Phase 0: visual placeholder only. Real ingest (drag-drop / File System Access
  // API / zip) is wired in Phase 1.
  interface Props {
    label: string;
    accent: string;
  }
  let { label, accent }: Props = $props();
</script>

<div class="dropzone" data-testid="dropzone-{label.toLowerCase()}">
  <div class="badge" style:background={accent}>{label}</div>
  <p class="title">Drop project {label} here</p>
  <p class="hint">Gerber / Excellon files, a folder, or a .zip</p>
</div>

<style>
  .dropzone {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 2px dashed var(--border);
    border-radius: 12px;
    background: var(--panel);
    min-height: 240px;
    padding: 2rem;
    text-align: center;
  }
  .badge {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 700;
    color: #10101a;
  }
  .title {
    margin: 0;
    font-size: 1.05rem;
  }
  .hint {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.85rem;
  }
</style>
