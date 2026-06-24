<script lang="ts">
  import { VERSION, AUTHOR, AUTHOR_URL, REPO_URL } from '$lib/components/About.svelte';

  let { onstart }: { onstart: () => void } = $props();

  const BMC_URL = 'https://www.buymeacoffee.com/maximevince';
</script>

<div class="splash" data-testid="splash">
  <div class="card">
    <svg class="logo" viewBox="0 0 32 32" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#1a1a2e" />
      <rect x="7" y="7" width="13" height="13" rx="2" fill="#ff5252" opacity="0.85" />
      <rect x="12" y="12" width="13" height="13" rx="2" fill="#00e5ff" opacity="0.7" />
    </svg>

    <h1 class="name">OpenGerberDiff</h1>
    <p class="tag">Visual &amp; quantitative diff for Gerber/Excellon PCB files</p>

    <p class="desc">
      Load two revisions of a board and see exactly what copper changed — per layer, in real mm² —
      with a coverage-area diff engine rather than a pixel XOR. Free, open-source, and fully local:
      your files never leave your machine.
    </p>

    <button class="start" data-testid="splash-start" onclick={onstart}>Get started →</button>

    <div class="bmc-row">
      <a
        class="bmc"
        href={BMC_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="bmc-link"
      >
        <span class="cup" aria-hidden="true">☕</span>
        <span>Buy me a coffee</span>
      </a>
    </div>

    <footer class="meta">
      <span>v{VERSION}</span>
      <span class="sep">·</span>
      <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">GPL-3.0</a
      >
      <span class="sep">·</span>
      <span>by <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">{AUTHOR}</a></span>
      <span class="sep">·</span>
      <a href={REPO_URL} target="_blank" rel="noopener noreferrer">GitHub ↗</a>
    </footer>
  </div>
</div>

<style>
  .splash {
    position: relative;
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: radial-gradient(120% 120% at 50% 0%, #20203a 0%, var(--bg) 60%);
  }
  .card {
    position: relative;
    text-align: center;
    max-width: 540px;
    padding: 2rem;
  }
  .logo {
    width: 76px;
    height: 76px;
    margin-bottom: 1.1rem;
  }
  .name {
    margin: 0;
    font-size: 2.6rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    background: linear-gradient(180deg, #fff, #aeb6c8);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .tag {
    margin: 0.4rem 0 0;
    color: var(--text);
    font-weight: 600;
  }
  .desc {
    margin: 1.1rem auto 1.6rem;
    color: var(--text-dim);
    font-size: 0.92rem;
    line-height: 1.6;
    max-width: 460px;
  }
  .start {
    background: var(--accent);
    color: #10101a;
    border: none;
    border-radius: 10px;
    padding: 0.7rem 1.6rem;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    transition: filter 0.1s ease;
  }
  .start:hover {
    filter: brightness(1.08);
  }
  .bmc-row {
    margin-top: 1.4rem;
  }
  .bmc {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: #ffdd00;
    color: #0d0c22;
    text-decoration: none;
    font-weight: 700;
    font-size: 0.9rem;
    padding: 0.5rem 1rem;
    border-radius: 10px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    transition: transform 0.1s ease;
  }
  .bmc:hover {
    transform: translateY(-1px);
  }
  .cup {
    font-size: 1.1rem;
  }
  .meta {
    margin-top: 1.8rem;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--text-dim);
  }
  .meta a {
    color: var(--accent);
    text-decoration: none;
  }
  .meta a:hover {
    text-decoration: underline;
  }
  .meta .sep {
    opacity: 0.5;
  }
</style>
