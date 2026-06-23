<script lang="ts" module>
  export function fmtArea(mm2: number): string {
    return `${mm2.toFixed(mm2 < 10 ? 3 : 2)} mm²`;
  }
</script>

<script lang="ts">
  import type { BoundingBox } from '@ogd/core';
  import type { PairDiff } from '$lib/diff';

  interface Props {
    pairDiffs: PairDiff[];
    onfocus: (box: BoundingBox) => void;
  }
  let { pairDiffs, onfocus }: Props = $props();

  const totals = $derived(
    pairDiffs.reduce(
      (t, p) => {
        t.added += p.result.metrics.addedMm2;
        t.removed += p.result.metrics.removedMm2;
        t.regions += p.result.clusters.length;
        return t;
      },
      { added: 0, removed: 0, regions: 0 },
    ),
  );
</script>

<div class="summary" data-testid="diff-summary">
  <div class="header">Diff Summary</div>

  <div class="totals">
    <div class="stat added">
      <span>+{fmtArea(totals.added)}</span><span class="lbl">added</span>
    </div>
    <div class="stat removed">
      <span>−{fmtArea(totals.removed)}</span><span class="lbl">removed</span>
    </div>
    <div class="stat">
      <span data-testid="total-regions">{totals.regions}</span><span class="lbl">regions</span>
    </div>
  </div>

  <table class="per-layer">
    <thead><tr><th>Layer</th><th>+mm²</th><th>−mm²</th><th>%</th></tr></thead>
    <tbody>
      {#each pairDiffs as pd (pd.key)}
        <tr class:changed={pd.result.metrics.changedMm2 > 0}>
          <td class="lname">{pd.label}</td>
          <td class="num added">{pd.result.metrics.addedMm2.toFixed(2)}</td>
          <td class="num removed">{pd.result.metrics.removedMm2.toFixed(2)}</td>
          <td class="num">{pd.result.metrics.changedPct.toFixed(2)}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="regions">
    <div class="rh">Change regions</div>
    {#each pairDiffs as pd (pd.key)}
      {#each pd.result.clusters.slice(0, 12) as c (c.id)}
        <button class="region" onclick={() => onfocus(c.bboxMm)}>
          <span class="dot {c.kind}"></span>
          <span class="rlabel">{pd.label}</span>
          <span class="rarea">{fmtArea(c.areaMm2)}</span>
        </button>
      {/each}
    {/each}
  </div>
</div>

<style>
  .summary {
    width: 270px;
    flex: none;
    background: var(--panel);
    border-left: 1px solid var(--border);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .header {
    padding: 0.5rem 0.75rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
  }
  .totals {
    display: flex;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
  }
  .stat {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .stat span {
    font-size: 0.9rem;
    font-family: var(--mono);
  }
  .stat .lbl {
    font-size: 0.68rem;
    color: var(--text-dim);
  }
  .added {
    color: #4ea3e0;
  }
  .removed {
    color: #f0903c;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.78rem;
  }
  th,
  td {
    padding: 0.25rem 0.5rem;
    text-align: right;
  }
  th:first-child,
  td.lname {
    text-align: left;
  }
  thead th {
    color: var(--text-dim);
    font-weight: 500;
    border-bottom: 1px solid var(--border);
  }
  tr.changed .lname {
    color: var(--text);
  }
  td.num {
    font-family: var(--mono);
  }
  .regions {
    padding: 0.5rem 0.4rem;
  }
  .rh {
    font-size: 0.72rem;
    color: var(--text-dim);
    padding: 0.25rem 0.35rem;
  }
  .region {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    background: none;
    border: none;
    color: var(--text);
    padding: 0.25rem 0.35rem;
    border-radius: 4px;
    font-size: 0.78rem;
  }
  .region:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    flex: none;
  }
  .dot.added {
    background: #2c7fb8;
  }
  .dot.removed {
    background: #e6772e;
  }
  .dot.mixed {
    background: linear-gradient(90deg, #2c7fb8 50%, #e6772e 50%);
  }
  .rlabel {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rarea {
    font-family: var(--mono);
    color: var(--text-dim);
    font-size: 0.72rem;
  }
</style>
