<script lang="ts">
  import type { Issue } from "./api";

  interface Props {
    issues: Issue[];
    /** Whether an issue's ID is something the app can open. */
    canOpen: (id: string) => boolean;
    onselect: (id: string) => void;
    onclose: () => void;
  }

  let { issues, canOpen, onselect, onclose }: Props = $props();

  const RANK = { error: 0, warning: 1, info: 2 };

  // Errors, then warnings, then what is undocumented; one group per file or source, largest first.
  const groups = $derived.by(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      const key = `${issue.severity}\u0000${issue.file}`;
      map.set(key, [...(map.get(key) ?? []), issue]);
    }
    return [...map.values()].sort((a, b) => RANK[a[0]!.severity] - RANK[b[0]!.severity] || b.length - a.length);
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
    {#each groups as group, g (`${group[0]!.severity}${group[0]!.file}`)}
      {#if group[0]!.severity === "info" && groups[g - 1]?.[0]!.severity !== "info"}
        <h3>Found elsewhere, not documented yet</h3>
      {/if}
      <details class={group[0]!.severity} open={group.length <= 10}>
        <summary><span class="file">{group[0]!.file}</span> {group.length}</summary>
        <ul>
          {#each group as issue, i (i)}
            <li>
              {#if issue.id && canOpen(issue.id)}<button class="link" onclick={() => onselect(issue.id!)}>{issue.id}</button>
              {:else if issue.id}<span class="mono">{issue.id}</span>{/if}
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
  details.info {
    border-color: var(--border);
  }
  h3 {
    margin: 20px 0 4px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
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
