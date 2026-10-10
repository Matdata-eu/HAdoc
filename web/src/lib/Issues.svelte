<script lang="ts">
  import type { Issue } from "./api";

  interface Props {
    issues: Issue[];
    onselect: (id: string) => void;
    onclose: () => void;
  }

  let { issues, onselect, onclose }: Props = $props();

  const sorted = $derived(
    [...issues].sort((a, b) => (a.severity === b.severity ? a.file.localeCompare(b.file) : a.severity === "error" ? -1 : 1)),
  );
</script>

<aside class="issues">
  <header>
    <h2>To check</h2>
    <button class="close" onclick={onclose} aria-label="Close">✕</button>
  </header>
  {#if sorted.length === 0}
    <p>Everything is documented and consistent.</p>
  {:else}
    <ul>
      {#each sorted as issue, i (i)}
        <li class={issue.severity}>
          <span class="file">{issue.file}</span>
          {#if issue.id}<button class="link" onclick={() => onselect(issue.id!)}>{issue.id}</button>{/if}
          <p>{issue.message}</p>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .issues {
    background: var(--bg);
    border-left: 1px solid var(--border);
    padding: 16px;
    overflow-y: auto;
  }
  header {
    display: flex;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .close {
    border: 0;
    background: none;
    font-size: 18px;
    cursor: pointer;
  }
  ul {
    list-style: none;
    padding: 0;
  }
  li {
    border-left: 3px solid var(--warning);
    padding: 4px 10px;
    margin: 8px 0;
  }
  li.error {
    border-color: var(--error);
  }
  .file {
    color: var(--muted);
    font-size: 13px;
    margin-right: 6px;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
  }
  p {
    margin: 2px 0 0;
  }
</style>
