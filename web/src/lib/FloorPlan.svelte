<script lang="ts">
  import type { Cable, Floor, Point, Settings, XY } from "./api";

  interface Props {
    floor: Floor;
    points: Point[];
    cables: Cable[];
    settings: Settings;
    layers: Record<string, boolean>;
    selected: string | null;
    highlight: Set<string>;
    /** Fill colour per point, e.g. by circuit; points without one are drawn neutral. */
    colours?: Map<string, string> | null;
    /** In edit mode points can be dragged. */
    editing?: boolean;
    /** Route being drawn; shown on top and not selectable. */
    draft?: XY[] | null;
    onselect: (id: string | null) => void;
    /** A tap while a tool is active, already snapped to a point when one was tapped. */
    onplan?: ((pos: XY) => void) | null;
    onmove?: (id: string, pos: XY) => void;
  }

  let {
    floor,
    points,
    cables,
    settings,
    layers,
    selected,
    highlight,
    colours = null,
    editing = false,
    draft = null,
    onselect,
    onplan = null,
    onmove,
  }: Props = $props();

  const margin = 40;
  let view = $state({ x: -margin, y: -margin, w: 0, h: 0 });
  let svg: SVGSVGElement | undefined = $state();

  // Reset the view whenever another floor is shown.
  $effect(() => {
    view = { x: -margin, y: -margin, w: floor.width + 2 * margin, h: floor.height + 2 * margin };
  });

  const typeInfo = $derived(new Map(settings.types.map((t) => [t.code, t])));
  const visiblePoints = $derived(
    points.filter((p) => p.level === floor.level && p.pos && layers[typeInfo.get(p.type)?.layer ?? "power"] !== false),
  );
  const routes = $derived(
    layers.cables === false
      ? []
      : cables.flatMap((c) =>
          (c.route ?? []).filter((r) => r.level === floor.level).map((r) => ({ id: c.id, path: r.path })),
        ),
  );
  // Symbols keep the same size on screen while zooming.
  const r = $derived(view.w / 70);

  function centroid(outline: [number, number][]): [number, number] {
    const n = outline.length;
    return [outline.reduce((s, p) => s + p[0], 0) / n, outline.reduce((s, p) => s + p[1], 0) / n];
  }

  function toPlan(clientX: number, clientY: number): [number, number] {
    const rect = svg!.getBoundingClientRect();
    // The viewBox is letterboxed to keep its aspect ratio; work out the real scale.
    const scale = Math.max(view.w / rect.width, view.h / rect.height);
    const offX = (rect.width * scale - view.w) / 2;
    const offY = (rect.height * scale - view.h) / 2;
    return [view.x - offX + (clientX - rect.left) * scale, view.y - offY + (clientY - rect.top) * scale];
  }

  function zoomAt(clientX: number, clientY: number, factor: number) {
    const [px, py] = toPlan(clientX, clientY);
    const w = Math.min(Math.max(view.w * factor, 50), (floor.width + 2 * margin) * 4);
    const k = w / view.w;
    view = { x: px - (px - view.x) * k, y: py - (py - view.y) * k, w, h: view.h * k };
  }

  function onwheel(e: WheelEvent) {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015));
  }

  // Pointer handling: one finger pans, two fingers pinch, a short tap selects.
  // In edit mode, a finger that starts on a point drags the point instead.
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  let pinchDist = 0;
  let drag = $state<{ id: string; pos: XY } | null>(null);

  const pointAt = (e: Event) => {
    const id = (e.target as Element).closest(".point")?.getAttribute("data-id");
    return id ? points.find((p) => p.id === id) : undefined;
  };

  function onpointerdown(e: PointerEvent) {
    svg!.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    const p = editing && !onplan && pointers.size === 1 ? pointAt(e) : undefined;
    drag = p?.pos ? { id: p.id, pos: p.pos } : null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  function onpointermove(e: PointerEvent) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, next);
    moved += Math.hypot(next.x - prev.x, next.y - prev.y);

    if (drag && pointers.size === 1) {
      drag = { id: drag.id, pos: toPlan(next.x, next.y) };
    } else if (pointers.size === 1) {
      const [x0, y0] = toPlan(prev.x, prev.y);
      const [x1, y1] = toPlan(next.x, next.y);
      view = { ...view, x: view.x - (x1 - x0), y: view.y - (y1 - y0) };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinchDist / dist);
      pinchDist = dist;
    }
  }

  function onpointerup(e: PointerEvent) {
    const wasTap = pointers.size === 1 && moved < 8;
    pointers.delete(e.pointerId);
    if (drag) {
      const done = drag;
      drag = null;
      if (!wasTap) {
        onmove?.(done.id, [Math.round(done.pos[0]), Math.round(done.pos[1])]);
        return;
      }
    }
    if (!wasTap) return;
    if (onplan) {
      const snap = pointAt(e)?.pos;
      const [x, y] = snap ?? toPlan(e.clientX, e.clientY);
      onplan([Math.round(x), Math.round(y)]);
      return;
    }
    const target = (e.target as Element).closest("[data-id]");
    onselect(target?.getAttribute("data-id") ?? null);
  }
</script>

<svg
  bind:this={svg}
  class="plan"
  class:tool={onplan}
  viewBox="{view.x} {view.y} {view.w} {view.h}"
  role="application"
  aria-label="Floor plan"
  {onwheel}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={(e) => pointers.delete(e.pointerId)}
>
  {#if floor.underlay}
    <image
      href={floor.underlay.file}
      x={floor.underlay.x ?? 0}
      y={floor.underlay.y ?? 0}
      width={floor.underlay.width ?? floor.width}
      height={floor.underlay.height ?? floor.height}
      opacity={floor.underlay.opacity ?? 0.5}
      preserveAspectRatio="none"
    />
  {/if}

  {#each floor.rooms as room (room.code)}
    {@const [cx, cy] = centroid(room.outline)}
    <g class="room">
      <polygon points={room.outline.map((p) => p.join(",")).join(" ")} />
      <text x={cx} y={cy} font-size={r * 1.3}>{room.name}</text>
    </g>
  {/each}

  {#each routes as route, i (`${route.id}-${i}`)}
    <polyline
      class="cable"
      class:lit={highlight.has(route.id)}
      points={route.path.map((p) => p.join(",")).join(" ")}
      stroke-width={r / (highlight.has(route.id) ? 3 : 5)}
    />
  {/each}

  {#each visiblePoints as p (p.id)}
    {@const info = typeInfo.get(p.type)}
    {@const pos = drag?.id === p.id ? drag.pos : p.pos!}
    <g
      class="point layer-{info?.layer ?? 'power'}"
      class:selected={selected === p.id}
      class:lit={highlight.has(p.id)}
      class:movable={editing && !onplan}
      class:dragging={drag?.id === p.id}
      style={colours ? `--c: ${colours.get(p.id) ?? "var(--muted)"}` : undefined}
      data-id={p.id}
      transform="translate({pos[0]} {pos[1]})"
    >
      <title>{p.name ?? p.id}</title>
      <circle r={r} stroke-width={r / 6} />
      <text font-size={r * 0.75} dy={r * 0.28}>{info?.symbol ?? p.type}</text>
    </g>
  {/each}

  {#if draft}
    <g class="draft">
      {#if draft.length > 1}
        <polyline points={draft.map((p) => p.join(",")).join(" ")} stroke-width={r / 3} />
      {/if}
      {#each draft as [x, y], i (i)}
        <circle cx={x} cy={y} r={r / 3} />
      {/each}
    </g>
  {/if}
</svg>

<style>
  .plan {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    user-select: none;
    cursor: grab;
  }
  .plan.tool,
  .plan.tool .point {
    cursor: crosshair;
  }
  .point.movable {
    cursor: move;
  }
  .point.dragging {
    opacity: 0.7;
  }
  .draft polyline {
    fill: none;
    stroke: var(--accent);
    stroke-linejoin: round;
    pointer-events: none;
  }
  .draft circle {
    fill: var(--accent);
    pointer-events: none;
  }
  .room polygon {
    fill: var(--room);
    stroke: var(--room-stroke);
    stroke-width: 2;
  }
  .room text {
    fill: var(--muted);
    text-anchor: middle;
    pointer-events: none;
  }
  .cable {
    fill: none;
    stroke: var(--cable);
    stroke-dasharray: 6 4;
    stroke-linejoin: round;
  }
  .cable.lit {
    stroke: var(--accent);
    stroke-dasharray: none;
  }
  .point {
    cursor: pointer;
    --c: var(--layer-power);
  }
  .point.layer-automation {
    --c: var(--layer-automation);
  }
  .point.layer-data {
    --c: var(--layer-data);
  }
  .point.layer-hidden {
    --c: var(--layer-hidden);
  }
  .point circle {
    fill: var(--bg);
    stroke: var(--c);
  }
  .point text {
    fill: var(--c);
    text-anchor: middle;
    font-weight: 600;
    pointer-events: none;
  }
  .point.lit circle {
    fill: var(--accent-soft);
  }
  .point.selected circle {
    fill: var(--c);
  }
  .point.selected text {
    fill: var(--bg);
  }
</style>
