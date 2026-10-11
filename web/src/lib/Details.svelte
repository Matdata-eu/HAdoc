<script lang="ts">
  import type { HouseData, ThingRef, Trace } from "./api";

  interface Props {
    house: HouseData;
    trace: Trace | null;
    loading: boolean;
    onselect: (id: string) => void;
    onclose: () => void;
  }

  let { house, trace, loading, onselect, onclose }: Props = $props();

  const point = $derived(trace ? house.points.find((p) => p.id === trace.subject.id) : undefined);
  const device = $derived(trace ? house.devices.find((d) => d.id === trace.subject.id) : undefined);
  const typeName = $derived(point ? house.settings.types.find((t) => t.code === point.type)?.name : undefined);
  const roomName = $derived(
    point
      ? house.site.floors.find((f) => f.level === point.level)?.rooms.find((r) => r.code === point.room)?.name
      : undefined,
  );
  const levelName = $derived(point ? house.settings.levels.find((l) => l.code === point.level)?.name : undefined);

  const pointName = (id: string) => house.points.find((p) => p.id === id)?.name ?? id;

  function canOpen(ref: ThingRef): boolean {
    return (ref.kind === "point" || ref.kind === "device" || ref.kind === "enclosure");
  }
</script>

{#snippet link(ref: ThingRef | null)}
  {#if ref === null}
    <span class="unknown">not documented</span>
  {:else if canOpen(ref)}
    <button class="link" onclick={() => onselect(ref.id)}>{ref.label}</button>{#if ref.port}<span class="port"
        >{ref.port}</span
      >{/if}
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
    {/if}

    {#if device}
      <dl>
        <dt>Kind</dt><dd>{device.kind}</dd>
        {#if device.model}<dt>Model</dt><dd>{device.model}</dd>{/if}
        {#if device.firmware}<dt>Firmware</dt><dd>{device.firmware}</dd>{/if}
        {#if device.hostname}<dt>Hostname</dt><dd>{device.hostname}</dd>{/if}
        {#if device.mac}<dt>MAC</dt><dd>{device.mac}</dd>{/if}
      </dl>
      {#if device.notes}<p>{device.notes}</p>{/if}
    {/if}

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
                      {#if s.point}→ <button class="link" onclick={() => onselect(s.point!)}>{pointName(s.point)}</button>{/if}
                    </div>
                  {/each}
                  {#each port.cables as end (end.cable.id)}
                    <div>{end.cable.id} to {@render link(end.there)}</div>
                  {/each}
                  {#if !port.signals.length && !port.cables.length}<span class="spare">spare</span>{/if}
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
              <span class="muted">{end.cable.type ?? "type unknown"}</span>
              <br />to {@render link(end.there)}
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
                {#if s.openhab?.item}<dt>openHAB</dt><dd class="mono">{s.openhab.item}</dd>{/if}
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
  .tag {
    font-size: 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0 8px;
    margin-left: 6px;
    color: var(--muted);
  }
</style>
