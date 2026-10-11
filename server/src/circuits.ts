import type { HouseIndex } from "./index-house.js";
import type { House } from "./model.js";

/**
 * The circuit behind every point and device that has one: fed directly, through
 * the device it holds, or up a powered_by chain. Used to colour the plan by breaker.
 */
export function circuitOf(house: House, index: HouseIndex): Record<string, string> {
  const fed = new Map<string, string>();
  for (const c of house.circuits) for (const f of c.feeds) if (!fed.has(index.thingId(f))) fed.set(index.thingId(f), c.id);

  const forDevice = (id: string | null | undefined, seen = new Set<string>()): string | undefined => {
    if (!id || seen.has(id)) return undefined;
    seen.add(id);
    if (fed.has(id)) return fed.get(id);
    if (index.circuits.has(id)) return id;
    const thing = index.things.get(id);
    return thing?.kind === "device" && thing.item.powered_by ? forDevice(index.thingId(thing.item.powered_by), seen) : undefined;
  };

  const result: Record<string, string> = {};
  for (const d of house.devices) {
    const c = forDevice(d.id);
    if (c) result[d.id] = c;
  }
  for (const p of house.points) {
    const c =
      fed.get(p.id) ??
      (p.device ? result[p.device] : undefined) ??
      house.devices.filter((d) => d.location === p.id).map((d) => result[d.id]).find(Boolean);
    if (c) result[p.id] = c;
  }
  return result;
}
