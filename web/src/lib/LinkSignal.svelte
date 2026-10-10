<script lang="ts">
  import type { HouseData, NewPoint, Signal } from "./api";

  interface Props {
    house: HouseData;
    signal: Signal;
    /** Floor shown on the plan, used as the default level for a new point. */
    level: string | null;
    onlink: (point: string) => void;
    oncreate: (point: NewPoint) => void;
  }

  let { house, signal, level: shownLevel, onlink, oncreate }: Props = $props();

  const NEW = "\u0000new";
  let open = $state(false);
  let target = $state("");
  // svelte-ignore state_referenced_locally
  let level = $state(shownLevel ?? house.site.floors[0]?.level ?? "");
  let room = $state("");
  let type = $state("");
  // svelte-ignore state_referenced_locally
  let name = $state(signal.name ?? "");

  const rooms = $derived(house.site.floors.find((f) => f.level === level)?.rooms ?? []);
  const points = $derived([...house.points].sort((a, b) => a.id.localeCompare(b.id)));
  const ready = $derived(target === NEW ? Boolean(level && room && type) : Boolean(target));

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!ready) return;
    if (target === NEW) oncreate({ type, level, room, name: name.trim() || undefined, signal: signal.id });
    else onlink(target);
    open = false;
  }
</script>

{#if !open}
  <button class="small" onclick={() => (open = true)}>Link to a point…</button>
{:else}
  <form onsubmit={submit}>
    <select bind:value={target} aria-label="Point">
      <option value="" disabled>Choose a point</option>
      <option value={NEW}>New point…</option>
      {#each points as p (p.id)}
        <option value={p.id}>{p.id}{p.name ? `: ${p.name}` : ""}</option>
      {/each}
    </select>
    {#if target === NEW}
      <select bind:value={type} aria-label="Type">
        <option value="" disabled>Type</option>
        {#each house.settings.types as t (t.code)}<option value={t.code}>{t.name}</option>{/each}
      </select>
      <select bind:value={level} aria-label="Level" onchange={() => (room = "")}>
        {#each house.site.floors as f (f.level)}
          <option value={f.level}>{house.settings.levels.find((l) => l.code === f.level)?.name ?? f.level}</option>
        {/each}
      </select>
      <select bind:value={room} aria-label="Room">
        <option value="" disabled>Room</option>
        {#each rooms as r (r.code)}<option value={r.code}>{r.name}</option>{/each}
      </select>
      <input bind:value={name} placeholder="Name, e.g. Hall switch by the stairs" aria-label="Name" />
    {/if}
    <div class="buttons">
      <button type="submit" class="small primary" disabled={!ready}>{target === NEW ? "Create and link" : "Link"}</button>
      <button type="button" class="small" onclick={() => (open = false)}>Cancel</button>
    </div>
  </form>
{/if}

<style>
  form {
    display: grid;
    gap: 4px;
    margin: 4px 0 8px;
  }
  select,
  input {
    font: inherit;
    font-size: 14px;
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    min-width: 0;
  }
  .buttons {
    display: flex;
    gap: 6px;
  }
</style>
