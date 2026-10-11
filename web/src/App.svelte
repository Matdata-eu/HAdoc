<script lang="ts">
  import { onMount } from "svelte";
  import { api, type EditActions, type HouseData, type Issue, type LiveSnapshot, type Trace, type XY } from "./lib/api";
  import { circuitColours } from "./lib/colours";
  import Details from "./lib/Details.svelte";
  import FloorPlan from "./lib/FloorPlan.svelte";
  import Issues from "./lib/Issues.svelte";

  let house = $state<HouseData | null>(null);
  let live = $state<LiveSnapshot | null>(null);
  let error = $state<string | null>(null);
  let level = $state<string | null>(null);
  let selected = $state<string | null>(null);
  let trace = $state<Trace | null>(null);
  let loadingTrace = $state(false);
  let showIssues = $state(false);
  let issues = $state<Issue[]>([]);
  let query = $state("");
  let layers = $state<Record<string, boolean>>({ power: true, automation: true, data: true, hidden: true, cables: true });
  let byCircuit = $state(false);
  let editing = $state(false);
  /** What a tap on the plan does in edit mode: place a point, or add a corner to a cable route. */
  let tool = $state<{ kind: "place"; id: string } | { kind: "route"; id: string; path: XY[] } | null>(null);
  let toast = $state<{ text: string; error?: boolean } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const LAYERS = [
    ["power", "Power"],
    ["automation", "Automation"],
    ["data", "Data"],
    ["hidden", "Hidden"],
    ["cables", "Cables"],
  ] as const;

  const floor = $derived(house?.site.floors.find((f) => f.level === level) ?? house?.site.floors[0]);
  const levelName = (code: string) => house?.settings.levels.find((l) => l.code === code)?.name ?? code;

  const circuitColour = $derived(circuitColours(house?.circuits.map((c) => c.id) ?? []));
  const pointColours = $derived.by(() => {
    if (!byCircuit || !house) return null;
    const map = new Map<string, string>();
    for (const p of house.points) {
      const c = house.circuitOf[p.id];
      if (c) map.set(p.id, circuitColour.get(c)!);
    }
    return map;
  });

  // Everything on the traced path lights up on the plan.
  const highlight = $derived.by(() => {
    const ids = new Set<string>();
    if (!trace) return ids;
    ids.add(trace.subject.id);
    // A breaker lights up everything on its circuit.
    for (const c of house?.circuits ?? []) {
      if (c.breaker !== trace.subject.id) continue;
      for (const [id, circuit] of Object.entries(house!.circuitOf)) if (circuit === c.id) ids.add(id);
    }
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
        .filter((s) => hit(s.id, s.name, s.plc?.name, s.openhab?.item, s.mqtt) && (s.point || s.port))
        .map((s) => ({
          // A signal opens its point, or else the device its port is on.
          id: s.point ?? s.port!.split(":")[0]!,
          label: `${s.name ?? s.id} (${s.openhab?.item ?? s.plc?.name ?? s.mqtt ?? ""})`,
        })),
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

  /** Signals, cables, circuits and ports have no page of their own; open the thing they belong to. */
  function selectable(id: string): string {
    if (!house) return id;
    if (id.includes(":")) return id.split(":")[0]!;
    const signal = house.signals.find((s) => s.id === id);
    if (signal) return signal.point ?? signal.port?.split(":")[0] ?? id;
    const cable = house.cables.find((c) => c.id === id);
    if (cable) return (cable.from ?? cable.to ?? id).split(":")[0]!;
    const circuit = house.circuits.find((c) => c.id === id);
    if (circuit?.breaker) return circuit.breaker;
    return id;
  }

  async function select(target: string | null) {
    const id = target === null ? null : selectable(target);
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

  function say(text: string, error = false) {
    toast = { text, error };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), error ? 6000 : 2500);
  }

  /** Runs an edit, then reloads so the plan and the panel show the saved state. */
  async function save(edit: () => Promise<{ id: string; file: string; committed: boolean }>, reselect?: (id: string) => string | null) {
    try {
      const result = await edit();
      await load();
      const next = reselect ? reselect(result.id) : selected;
      if (next) await select(next);
      say(`Saved in ${result.file}${result.committed ? " and committed" : ""}`);
      return result;
    } catch (err) {
      say((err as Error).message, true);
      return null;
    }
  }

  const actions: EditActions = {
    place: (id) => {
      const p = house?.points.find((q) => q.id === id);
      if (p) level = p.level;
      tool = { kind: "place", id };
    },
    route: (id) => (tool = { kind: "route", id, path: [] }),
    link: (signal, point) => void save(() => api.linkSignal(signal, point)),
    create: async (point) => {
      // A new point opens straight away, ready to be placed.
      const created = await save(() => api.createPoint(point), (id) => id);
      if (created) tool = { kind: "place", id: created.id };
    },
  };

  function onplan(pos: XY) {
    if (tool?.kind === "place") {
      const id = tool.id;
      tool = null;
      void save(() => api.movePoint(id, pos));
    } else if (tool?.kind === "route") {
      tool = { ...tool, path: [...tool.path, pos] };
    }
  }

  function saveRoute(path: XY[] | null) {
    if (tool?.kind !== "route" || !floor) return;
    const { id } = tool;
    tool = null;
    void save(() => api.setRoute(id, floor.level, path));
  }

  function toggleEditing() {
    editing = !editing;
    tool = null;
  }

  function canOpen(id: string): boolean {
    if (!house) return false;
    const target = selectable(id);
    return [house.points, house.devices, house.enclosures].some((list) => list.some((t) => t.id === target));
  }

  async function refreshLive() {
    try {
      live = await api.live();
    } catch {
      // The plan works without live data.
    }
  }

  async function openIssues() {
    issues = await api.issues();
    selected = null;
    trace = null;
    showIssues = true;
  }

  onMount(() => {
    void (async () => {
      await load();
      const fromHash = decodeURIComponent(location.hash.slice(1));
      if (fromHash) void select(fromHash);
    })();
    void refreshLive();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshLive();
    }, 30000);
    return () => clearInterval(timer);
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

      {#if house.editable}
        <button class="edit-btn" class:active={editing} onclick={toggleEditing}>{editing ? "Done" : "Edit"}</button>
      {/if}
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
          cables={tool?.kind === "route" ? house.cables.filter((c) => c.id !== tool!.id) : house.cables}
          settings={house.settings}
          {layers}
          {selected}
          {highlight}
          colours={pointColours}
          {editing}
          draft={tool?.kind === "route" ? tool.path : null}
          onselect={select}
          onplan={tool ? onplan : null}
          onmove={(id, pos) => void save(() => api.movePoint(id, pos))}
        />

        {#if tool}
          <div class="toolbar" role="toolbar">
            {#if tool.kind === "place"}
              <span>Tap where <strong>{tool.id}</strong> is on {levelName(floor.level)}.</span>
            {:else}
              {@const route = tool}
              {@const existing = house.cables.find((c) => c.id === route.id)?.route?.some((r) => r.level === floor.level)}
              <span>Tap the corners of <strong>{route.id}</strong> on {levelName(floor.level)}; tapping a point snaps to it.</span>
              <button class="small" disabled={!route.path.length} onclick={() => (tool = { ...route, path: route.path.slice(0, -1) })}>Undo</button>
              {#if existing}<button class="small" onclick={() => saveRoute(null)}>Remove route</button>{/if}
              <button class="small primary" disabled={route.path.length < 2} onclick={() => saveRoute(route.path)}>Save</button>
            {/if}
            <button class="small" onclick={() => (tool = null)}>Cancel</button>
          </div>
        {/if}

        {#if toast}
          <div class="toast" class:error={toast.error} role="status">{toast.text}</div>
        {/if}

        {#if byCircuit}
          <ul class="legend" aria-label="Circuits">
            {#each house.circuits as c (c.id)}
              <li>
                <button onclick={() => select(c.id)}>
                  <span class="swatch" style:background={circuitColour.get(c.id)}></span>
                  <strong>{c.id}</strong> {c.name ?? ""}
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="overlay">
          <div class="layers" role="group" aria-label="Layers">
            {#each LAYERS as [key, name] (key)}
              <label class="layer-{key}"><input type="checkbox" bind:checked={layers[key]} /> {name}</label>
            {/each}
            <label><input type="checkbox" bind:checked={byCircuit} /> Colour by circuit</label>
          </div>
        </div>
      </div>
    {:else if house}
      <p class="message">No floors yet. Add one to site.yaml.</p>
    {:else}
      <p class="message">Loading…</p>
    {/if}

    {#if house && selected}
      <Details
        {house}
        {trace}
        {live}
        loading={loadingTrace}
        {editing}
        level={floor?.level ?? null}
        {actions}
        onselect={select}
        onclose={() => select(null)}
      />
    {:else if showIssues}
      <Issues {issues} {canOpen} onselect={select} onclose={() => (showIssues = false)} />
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
  .edit-btn,
  .issues-btn {
    border: 1px solid var(--border);
    background: var(--bg);
    border-radius: 999px;
    padding: 4px 12px;
    cursor: pointer;
  }
  .floors button.active,
  .edit-btn.active {
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
  .overlay {
    position: absolute;
    left: 12px;
    bottom: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
    display: grid;
    gap: 6px;
    justify-items: start;
  }
  .legend {
    position: absolute;
    top: 12px;
    right: 12px;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 13px;
    max-height: 40vh;
    overflow-y: auto;
  }
  .legend button {
    border: 0;
    background: none;
    padding: 2px 6px;
    cursor: pointer;
    text-align: left;
  }
  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 4px;
  }
  .toolbar {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 14px;
  }
  .toolbar span {
    flex: 1 1 200px;
  }
  .toast {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--text);
    color: var(--bg);
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 14px;
    pointer-events: none;
  }
  .toast.error {
    background: var(--error);
    color: #fff;
  }
  .toolbar ~ .legend {
    display: none;
  }
  .toolbar ~ .toast {
    top: auto;
    bottom: 64px;
  }
  .layers {
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
    .overlay {
      right: 12px;
    }
  }
</style>
