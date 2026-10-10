<script lang="ts">
  import type { Issue } from "./api";

  interface Props {
    issues: Issue[];
    onselect: (id: string) => void;
    onclose: () => void;
  }

  let { issues, onselect, onclose }: Props = $props();

  // Errors first, then one group per file or import, largest first.
  const groups = $derived.by(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      const key = `${issue.severity}\u0000${issue.file}`;
      map.set(key, [...(map.get(key) ?? []), issue]);
    }
    return [...map.values()].sort(
      (a, b) => (a[0]!.severity === b[0]!.severity ? b.length - a.length : a[0]!.severity === "error" ? -1 : 1),
    );
  });
</script>

<aside class="issues">
  <header>
    <h2>To check</h2>
    <button class="close" onclick={onclose} aria-label="Close">✕</button>
  </header>
  {#if groups.length === 0}
    <p>Everything is documented and consistent.</p>
  {:else}
    {#each groups as group (`${group[0]!.severity}${group[0]!.file}`)}
      <details class={group[0]!.severity} open={group.length <= 10}>
        <summary><span class="file">{group[0]!.file}</span> {group.length}</summary>
        <ul>
          {#each group as issue, i (i)}
            <li>
              {#if issue.id}<button class="link" onclick={() => onselect(issue.id!)}>{issue.id}</button>{/if}
              <span>{issue.message}</span>
            </li>
          {/each}
        </ul>
      </details>
    {/each}
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
  details {
    border-left: 3px solid var(--warning);
    padding: 4px 10px;
    margin: 12px 0;
  }
  details.error {
    border-color: var(--error);
  }
  summary {
    cursor: pointer;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 4px 0 0;
  }
  li {
    margin: 4px 0;
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
</style>
