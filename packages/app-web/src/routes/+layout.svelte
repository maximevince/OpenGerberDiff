<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import UpdateToast from '$lib/components/UpdateToast.svelte';
  import { registerServiceWorker } from '$lib/pwa';

  let { children } = $props();

  onMount(() => void registerServiceWorker());
</script>

{@render children()}
<UpdateToast />
