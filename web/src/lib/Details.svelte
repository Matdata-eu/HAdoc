<script lang="ts">
  import { api, type EditActions, type HouseData, type LiveDevice, type LiveSnapshot, type Signal, type ThingRef, type Trace } from "./api";
  import { coreBackground } from "./colours";
  import LinkSignal from "./LinkSignal.svelte";

  interface Props {
    house: HouseData;
    trace: Trace | null;
    live?: LiveSnapshot | null;
    loading: boolean;
    /** Edit mode; the actions are only offered then. */
    editing?: boolean;
    /** Floor shown on the plan. */
    level?: string | null;
    actions?: EditActions;
    onselect: (id: string) => void;
    onclose: () => void;
  }

  let { house, trace, live = null, loading, editing = false, level = null, actions, onselect, onclose }: Props = $props();

  const floorName = $derived(house.settings.levels.find((l) => l.code === level)?.name ?? level);

  const point = $derived(trace ? house.points.find((p) => p.id === trace.subject.id) : undefined);
  const device = $derived(trace ? house.devices.find((d) => d.id === trace.subject.id) : undefined);
  const typeName = $derived(point ? house.settings.types.find((t) => t.code === point.type)?.name : undefined);
  const roomName = $derived(
    point
      ? house.site.floors.find((f) => f.level === point.level)?.rooms.find((r) => r.code === point.room)?.name
      : undefined,
  );
  const levelName = $derived(point ? house.settings.levels.find((l) => l.code === point.level)?.name : undefined);

  // A breaker shows what its circuits feed.
  const breakerOf = $derived(trace ? house.circuits.filter((c) => c.breaker === trace.subject.id) : []);
  const fedBy = (circuit: string) =>
    Object.entries(house.circuitOf)
      .filter(([id, c]) => c === circuit && house.points.some((p) => p.id === id))
      .map(([id]) => id);

  // Rule scripts are fetched when someone opens them.
  let scripts = $state<Record<string, string>>({});
  async function loadScript(uid: string) {
    if (scripts[uid] !== undefined) return;
    try {
      scripts[uid] = (await api.rule(uid)).script ?? "(no script; the rule is built in the UI)";
    } catch (err) {
      scripts[uid] = (err as Error).message;
    }
  }

  const pointName = (id: string) => house.points.find((p) => p.id === id)?.name ?? id;

  function canOpen(ref: ThingRef): boolean {
    return (ref.kind === "point" || ref.kind === "device" || ref.kind === "enclosure");
  }
</script>

{#snippet status(d: LiveDevice | undefined)}
  {#if d && d.online !== undefined}
    <span class="status" class:online={d.online} title="According to {d.from.join(', ')}">
      <span class="led"></span>{d.online ? "online" : "offline"}{#if d.ip}<span class="mono">{d.ip}</span>{/if}
    </span>
  {/if}
{/snippet}

{#snippet item(s: Signal)}
  {@const name = s.openhab?.item}
  {@const it = name ? live?.items[name] : undefined}
  {#if name}
    <dt>openHAB</dt>
    <dd>
      <span class="mono">{name}</span>
      {#if it?.state !== undefined}<span class="tag">{it.state}</span>{/if}
      {#if it?.rules.length}
        {#each it.rules as r (r.uid)}
          <details class="rule" ontoggle={(e) => (e.currentTarget as HTMLDetailsElement).open && loadScript(r.uid)}>
            <summary>{r.name} <span class="muted">{r.how === "script" ? "uses it" : `on ${r.how}`}</span></summary>
            <pre>{scripts[r.uid] ?? "Loading…"}</pre>
          </details>
        {/each}
      {:else if it}
        <div class="muted">No rules use it</div>
      {/if}
    </dd>
  {/if}
{/snippet}

{#snippet link(ref: ThingRef | null)}
  {#if ref === null}
    <span class="unknown">not documented</span>
  {:else if canOpen(ref)}
    <button class="link" onclick={() => onselect(ref.id)}>{ref.label}</button>{#if ref.port}<span class="port"
        >{ref.port}</span
      >{/if}{#if ref.kind === "device"}{@render status(live?.devices[ref.id])}{/if}
  {:else}
    <span>{ref.label}</span>
  {/if}
{/snippet}

<aside class="details" aria-live="polite">
  <header>
    <div>
      <h2>{trace?.subject.label ?? "…"}</h2>
      <p class="id">{trace?.subject.id}</p>
    </div>
    <button class="close" onclick={onclose} aria-label="Close">✕</button>
  </header>

  {#if loading && !trace}
    <p class="muted">Loading…</p>
  {:else if trace}
    {#if point}
      <p class="meta">
        {[typeName ?? point.type, roomName ?? point.room, levelName ?? point.level, point.height != null ? `${point.height} cm high` : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {#if point.photo}<img src={point.photo} alt={point.name ?? point.id} />{/if}
      {#if point.if_broken}
        <section class="callout">
          <h3>If it stops working</h3>
          <p>{point.if_broken}</p>
        </section>
      {/if}
      {#if point.notes}<p>{point.notes}</p>{/if}
      {#if !point.pos}<p class="unknown">Not on the plan yet</p>{/if}
      {#if editing && actions}
        <p>
          <button class="small" onclick={() => actions.place(point.id)}>{point.pos ? "Place again" : "Place on the plan"}</button>
          {#if point.pos}<span class="hint">or drag it on the plan</span>{/if}
        </p>
      {/if}
    {/if}

    {#if device}
      {@const ld = live?.devices[device.id]}
      {#if ld}<p>{@render status(ld)}</p>{/if}
      <dl>
        <dt>Kind</dt><dd>{device.kind}</dd>
        {#if device.model}<dt>Model</dt><dd>{device.model}</dd>{/if}
        {#if ld?.firmware ?? device.firmware}<dt>Firmware</dt><dd>{ld?.firmware ?? device.firmware}</dd>{/if}
        {#if device.hostname}<dt>Hostname</dt><dd>{device.hostname}</dd>{/if}
        {#if device.mac ?? ld?.mac}<dt>MAC</dt><dd>{device.mac ?? ld?.mac}</dd>{/if}
      </dl>
      {#if device.notes}<p>{device.notes}</p>{/if}
    {/if}

    {#each breakerOf as c (c.id)}
      <section>
        <h3>Circuit {c.id}{c.name ? `: ${c.name}` : ""}</h3>
        <p class="meta">{[c.rating, c.rcd && `RCD ${c.rcd}`, c.phase].filter(Boolean).join(" · ")}</p>
        <ul>
          {#each fedBy(c.id) as id (id)}<li><button class="link" onclick={() => onselect(id)}>{pointName(id)}</button></li>{/each}
          {#each c.feeds.filter((f) => !house.points.some((p) => p.id === f)) as id (id)}
            <li><button class="link" onclick={() => onselect(id.split(":")[0]!)}>{id}</button></li>
          {/each}
        </ul>
      </section>
    {/each}

    {#if trace.ports.length}
      <section>
        <h3>Ports</h3>
        <table class="ports">
          <tbody>
            {#each trace.ports as port (port.name)}
              <tr>
                <td class="mono">{port.name}</td>
                <td>
                  {#each port.signals as s (s.id)}
                    <div>
                      {#if s.plc?.name}<span class="mono">{s.plc.name}</span>{/if}
                      {#if s.name}{s.name}{/if}
                      {#if s.openhab?.item}<span class="mono">{s.openhab.item}</span>{#if live?.items[s.openhab.item]?.state !== undefined}<span
                            class="tag">{live.items[s.openhab.item]!.state}</span
                          >{/if}{/if}
                      {#if s.point}→ <button class="link" onclick={() => onselect(s.point!)}>{pointName(s.point)}</button>
                        {#if editing && actions}<button class="unlink" title="Unlink from this point" onclick={() => actions.link(s.id, null)}>✕</button>{/if}
                      {/if}
                    </div>
                    {#if editing && actions && !s.point}
                      <LinkSignal {house} signal={s} {level} onlink={(p) => actions.link(s.id, p)} oncreate={actions.create} />
                    {/if}
                  {/each}
                  {#each port.cables as end (end.cable.id)}
                    <div>{end.cable.id} to {@render link(end.there)}</div>
                  {/each}
                  {#if !port.signals.length && !port.cables.length}<span class="spare">{port.use ? `${port.use} (not documented)` : "spare"}</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}

    {#if trace.location}
      <section>
        <h3>Located in</h3>
        <p>{@render link(trace.location)}</p>
      </section>
    {/if}

    {#if trace.contains.length}
      <section>
        <h3>Contains</h3>
        <ul>{#each trace.contains as ref (ref.id)}<li>{@render link(ref)}</li>{/each}</ul>
      </section>
    {/if}

    <section>
      <h3>Power</h3>
      {#if trace.poweredBy.length === 0 && trace.circuits.length === 0}
        <p class="unknown">No power source documented</p>
      {:else}
        <ul>
          {#each trace.poweredBy as ref (ref.id)}<li>Fed by {@render link(ref)}</li>{/each}
          {#each trace.circuits as c (c.id)}
            <li>
              Circuit <strong>{c.id}</strong>{#if c.name}: {c.name}{/if}
              <span class="muted">{[c.rating, c.rcd && `RCD ${c.rcd}`, c.phase].filter(Boolean).join(" · ")}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h3>Cables</h3>
      {#if trace.cables.length === 0}
        <p class="unknown">No cables documented</p>
      {:else}
        <ul>
          {#each trace.cables as end (end.cable.id)}
            <li>
              <strong>{end.cable.id}</strong>
              <span class="muted">{[end.cable.type ?? "type unknown", end.cable.length != null && `${end.cable.length} m`].filter(Boolean).join(" · ")}</span>
              <br />to {@render link(end.there)}
              {#if end.cable.cores?.length}
                <table class="cores">
                  <tbody>
                    {#each end.cable.cores as core, i (i)}
                      <tr>
                        <td><span class="swatch" style:background={coreBackground(core.colour) ?? "transparent"}></span>{core.colour}</td>
                        {#if core.from == null && core.to == null}
                          <td class="spare" colspan="2">spare</td>
                        {:else}
                          <td class="mono">{core.from ?? "?"}</td>
                          <td class="mono">{core.to ?? "?"}</td>
                        {/if}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
              {#if editing && actions && level}
                <button class="small" onclick={() => actions.route(end.cable.id)}>
                  {end.cable.route?.some((r) => r.level === level) ? "Redraw" : "Draw"} route on {floorName}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if trace.signals.length && !trace.ports.length}
      <section>
        <h3>Automation</h3>
        <ul>
          {#each trace.signals as s (s.id)}
            <li>
              <strong>{s.name ?? s.id}</strong>
              {#if s.logic}<span class="tag">logic in {s.logic}</span>{/if}
              <dl>
                {#if s.plc?.name}<dt>PLC</dt><dd>{[s.plc.name, s.plc.address].filter(Boolean).join(" at ")}</dd>{/if}
                {#if s.mqtt}<dt>MQTT</dt><dd class="mono">{s.mqtt}</dd>{/if}
                {@render item(s)}
              </dl>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</aside>

<style>
  .details {
    background: var(--bg);
    border-left: 1px solid var(--border);
    padding: 16px;
    overflow-y: auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: start;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  h3 {
    margin: 16px 0 4px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .id,
  .mono,
  .port {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
  }
  .id {
    margin: 2px 0 0;
    color: var(--muted);
  }
  .port {
    margin-left: 6px;
    color: var(--muted);
  }
  .meta,
  .muted {
    color: var(--muted);
  }
  .muted {
    margin-left: 6px;
    font-size: 13px;
  }
  .unknown {
    color: var(--warning);
    margin: 0;
  }
  .close {
    border: 0;
    background: none;
    font-size: 18px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    text-align: left;
  }
  ul {
    margin: 0;
    padding-left: 18px;
  }
  li {
    margin: 4px 0;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 12px;
    margin: 4px 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  img {
    width: 100%;
    border-radius: 8px;
    margin: 8px 0;
  }
  .callout {
    background: var(--accent-soft);
    border-radius: 8px;
    padding: 4px 12px 8px;
    margin: 12px 0;
  }
  .callout h3 {
    margin-top: 8px;
  }
  .callout p {
    margin: 0;
  }
  .ports {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  .ports td {
    border-top: 1px solid var(--border);
    padding: 4px 6px 4px 0;
    vertical-align: top;
  }
  .ports td:first-child {
    white-space: nowrap;
  }
  .ports .mono {
    margin-right: 6px;
  }
  .spare {
    color: var(--muted);
  }
  .hint {
    color: var(--muted);
    font-size: 13px;
    margin-left: 6px;
  }
  .unlink {
    border: 0;
    background: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0 4px;
  }
  .cores {
    border-collapse: collapse;
    font-size: 13px;
    margin: 4px 0;
  }
  .cores td {
    padding: 1px 8px 1px 0;
    white-space: nowrap;
  }
  .cores .mono {
    font-size: 12px;
  }
  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid var(--border);
    margin-right: 6px;
    vertical-align: -1px;
  }
  .status {
    font-size: 13px;
    color: var(--muted);
    margin-left: 6px;
    white-space: nowrap;
  }
  p > .status:first-child {
    margin-left: 0;
  }
  .status .mono {
    margin-left: 6px;
  }
  .led {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--error);
    margin-right: 4px;
  }
  .status.online .led {
    background: #16a34a;
  }
  .rule summary {
    cursor: pointer;
    font-size: 14px;
  }
  .rule pre {
    font-size: 12px;
    background: var(--surface);
    border-radius: 6px;
    padding: 6px 8px;
    overflow-x: auto;
    margin: 4px 0;
    max-height: 300px;
  }
  .tag {
    font-size: 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0 8px;
    margin-left: 6px;
    color: var(--muted);
  }
</style>
