<script lang="ts">
  import type { Cable, Floor, Point, Settings } from "./api";

  interface Props {
    floor: Floor;
    points: Point[];
    cables: Cable[];
    settings: Settings;
    layers: Record<string, boolean>;
    selected: string | null;
    highlight: Set<string>;
    onselect: (id: string | null) => void;
  }

  let { floor, points, cables, settings, layers, selected, highlight, onselect }: Props = $props();

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
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  let pinchDist = 0;

  function onpointerdown(e: PointerEvent) {
    svg!.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
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

    if (pointers.size === 1) {
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
    if (!wasTap) return;
    const target = (e.target as Element).closest("[data-id]");
    onselect(target?.getAttribute("data-id") ?? null);
  }
</script>

<svg
  bind:this={svg}
  class="plan"
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
    <g
      class="point layer-{info?.layer ?? 'power'}"
      class:selected={selected === p.id}
      class:lit={highlight.has(p.id)}
      data-id={p.id}
      transform="translate({p.pos![0]} {p.pos![1]})"
    >
      <title>{p.name ?? p.id}</title>
      <circle r={r} stroke-width={r / 6} />
      <text font-size={r * 0.75} dy={r * 0.28}>{info?.symbol ?? p.type}</text>
    </g>
  {/each}
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
