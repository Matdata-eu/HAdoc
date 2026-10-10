<script lang="ts">
  import { onMount } from "svelte";
  import { api, type HouseData, type Issue, type Trace } from "./lib/api";
  import Details from "./lib/Details.svelte";
  import FloorPlan from "./lib/FloorPlan.svelte";
  import Issues from "./lib/Issues.svelte";

  let house = $state<HouseData | null>(null);
  let error = $state<string | null>(null);
  let level = $state<string | null>(null);
  let selected = $state<string | null>(null);
  let trace = $state<Trace | null>(null);
  let loadingTrace = $state(false);
  let showIssues = $state(false);
  let issues = $state<Issue[]>([]);
  let query = $state("");
  let layers = $state<Record<string, boolean>>({ power: true, automation: true, data: true, hidden: true, cables: true });

  const LAYERS = [
    ["power", "Power"],
    ["automation", "Automation"],
    ["data", "Data"],
    ["hidden", "Hidden"],
    ["cables", "Cables"],
  ] as const;

  const floor = $derived(house?.site.floors.find((f) => f.level === level) ?? house?.site.floors[0]);
  const levelName = (code: string) => house?.settings.levels.find((l) => l.code === code)?.name ?? code;

  // Everything on the traced path lights up on the plan.
  const highlight = $derived.by(() => {
    const ids = new Set<string>();
    if (!trace) return ids;
    ids.add(trace.subject.id);
    if (trace.location) ids.add(trace.location.id);
    for (const c of trace.contains) ids.add(c.id);
    for (const end of trace.cables) {
      ids.add(end.cable.id);
      if (end.there) ids.add(end.there.id);
    }
    for (const s of trace.signals) if (s.point) ids.add(s.point);
    // Devices are drawn through the point they sit in, e.g. a hidden ESP.
    for (const p of house?.points ?? []) if (p.device && ids.has(p.device)) ids.add(p.id);
    for (const d of house?.devices ?? []) if (d.location && ids.has(d.id)) ids.add(d.location);
    return ids;
  });

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!house || q.length < 2) return [];
    const hit = (...fields: (string | null | undefined)[]) => fields.some((f) => f?.toLowerCase().includes(q));
    return [
      ...house.points.filter((p) => hit(p.id, p.name, p.room)).map((p) => ({ id: p.id, label: p.name ?? p.id })),
      ...house.devices
        .filter((d) => hit(d.id, d.model, d.label, d.hostname))
        .map((d) => ({ id: d.id, label: d.label ?? d.model ?? d.id })),
      ...house.signals
        .filter((s) => hit(s.id, s.name, s.plc?.name, s.openhab?.item, s.mqtt) && s.point)
        .map((s) => ({ id: s.point!, label: `${s.name ?? s.id} (${s.openhab?.item ?? s.plc?.name ?? s.mqtt ?? ""})` })),
    ].slice(0, 12);
  });

  async function load() {
    try {
      house = await api.house();
      level ??= house.site.floors[0]?.level ?? null;
      error = null;
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function select(id: string | null) {
    selected = id;
    query = "";
    showIssues = false;
    if (location.hash.slice(1) !== (id ?? "")) history.replaceState(null, "", id ? `#${encodeURIComponent(id)}` : " ");
    if (!id) {
      trace = null;
      return;
    }
    const point = house?.points.find((p) => p.id === id);
    if (point) level = point.level;
    loadingTrace = true;
    try {
      trace = await api.trace(id);
      // A device: show the floor of the point it sits in.
      const at = trace.location && house?.points.find((p) => p.id === trace!.location!.id);
      if (!point && at) level = at.level;
    } catch {
      trace = null;
    } finally {
      loadingTrace = false;
    }
  }

  async function openIssues() {
    issues = await api.issues();
    selected = null;
    trace = null;
    showIssues = true;
  }

  onMount(async () => {
    await load();
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (fromHash) void select(fromHash);
  });
</script>

<div class="app" class:has-panel={selected || showIssues}>
  <header class="bar">
    <h1>{house?.settings.name ?? "HAdoc"}</h1>

    {#if house}
      <nav class="floors" aria-label="Floors">
        {#each house.site.floors as f (f.level)}
          <button class:active={floor?.level === f.level} onclick={() => (level = f.level)}>{levelName(f.level)}</button>
        {/each}
      </nav>

      <div class="search">
        <input type="search" placeholder="Search room, ID, item…" bind:value={query} aria-label="Search" />
        {#if results.length}
          <ul class="results">
            {#each results as r, i (`${r.id}-${i}`)}
              <li><button onclick={() => select(r.id)}><span class="mono">{r.id}</span> {r.label}</button></li>
            {/each}
          </ul>
        {/if}
      </div>

      <button class="issues-btn" onclick={openIssues} title="Errors and undocumented items">
        {#if house.issueCount.errors}<span class="dot error"></span>{house.issueCount.errors}{/if}
        {#if house.issueCount.warnings}<span class="dot warning"></span>{house.issueCount.warnings}{/if}
        {#if !house.issueCount.errors && !house.issueCount.warnings}✓{/if}
      </button>
    {/if}
  </header>

  <main>
    {#if error}
      <p class="message">Cannot load the house data: {error}</p>
    {:else if house && floor}
      <div class="plan-wrap">
        <FloorPlan
          {floor}
          points={house.points}
          cables={house.cables}
          settings={house.settings}
          {layers}
          {selected}
          {highlight}
          onselect={select}
        />
        <div class="layers" role="group" aria-label="Layers">
          {#each LAYERS as [key, name] (key)}
            <label class="layer-{key}"><input type="checkbox" bind:checked={layers[key]} /> {name}</label>
          {/each}
        </div>
      </div>
    {:else if house}
      <p class="message">No floors yet. Add one to site.yaml.</p>
    {:else}
      <p class="message">Loading…</p>
    {/if}

    {#if house && selected}
      <Details {house} {trace} loading={loadingTrace} onselect={select} onclose={() => select(null)} />
    {:else if showIssues}
      <Issues {issues} onselect={select} onclose={() => (showIssues = false)} />
    {/if}
  </main>
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 8px 16px;
    padding-top: max(8px, env(safe-area-inset-top));
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  h1 {
    margin: 0;
    font-size: 17px;
  }
  .floors {
    display: flex;
    gap: 4px;
  }
  .floors button,
  .issues-btn {
    border: 1px solid var(--border);
    background: var(--bg);
    border-radius: 999px;
    padding: 4px 12px;
    cursor: pointer;
  }
  .floors button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .search {
    position: relative;
    flex: 1 1 200px;
  }
  .search input {
    width: 100%;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  .results {
    position: absolute;
    z-index: 10;
    left: 0;
    right: 0;
    margin: 4px 0 0;
    padding: 4px;
    list-style: none;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
  }
  .results button {
    width: 100%;
    text-align: left;
    border: 0;
    background: none;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
  }
  .results button:hover {
    background: var(--surface);
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    color: var(--muted);
    margin-right: 6px;
  }
  .issues-btn {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
  .dot.error {
    background: var(--error);
  }
  .dot.warning {
    background: var(--warning);
    margin-left: 4px;
  }
  main {
    display: grid;
    grid-template-columns: 1fr;
    min-height: 0;
  }
  .has-panel main {
    grid-template-columns: 1fr minmax(300px, 380px);
  }
  .plan-wrap {
    position: relative;
    min-height: 0;
  }
  .layers {
    position: absolute;
    left: 12px;
    bottom: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 13px;
  }
  .message {
    padding: 24px;
    color: var(--muted);
  }

  /* Phones: the panel becomes a bottom sheet over the plan. */
  @media (max-width: 700px) {
    .has-panel main {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr 55%;
    }
    .has-panel main :global(aside) {
      border-left: 0;
      border-top: 1px solid var(--border);
      border-radius: 12px 12px 0 0;
    }
    .layers {
      right: 12px;
    }
  }
</style>
