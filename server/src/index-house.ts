import type { Device, Enclosure, House, Point } from "./model.js";

export type Thing =
  | { kind: "point"; item: Point }
  | { kind: "device"; item: Device }
  | { kind: "enclosure"; item: Enclosure };

export interface Endpoint {
  /** The point, device or enclosure the endpoint lands on. */
  thing: Thing;
  /** Port name when the endpoint is written as "device:port". */
  port?: string;
}

export type Resolved = { ok: true; endpoint: Endpoint } | { ok: false; reason: string };

/** Lookup tables over a loaded house. Points, devices and enclosures share one ID namespace. */
export function indexHouse(house: House) {
  const things = new Map<string, Thing>();
  for (const item of house.points) if (!things.has(item.id)) things.set(item.id, { kind: "point", item });
  for (const item of house.devices) if (!things.has(item.id)) things.set(item.id, { kind: "device", item });
  for (const item of house.enclosures) if (!things.has(item.id)) things.set(item.id, { kind: "enclosure", item });

  const circuits = new Map(house.circuits.map((c) => [c.id, c]));

  function resolve(ref: string): Resolved {
    const colon = ref.indexOf(":");
    if (colon === -1) {
      const thing = things.get(ref);
      return thing ? { ok: true, endpoint: { thing } } : { ok: false, reason: `"${ref}" does not exist` };
    }
    const id = ref.slice(0, colon);
    const port = ref.slice(colon + 1);
    const thing = things.get(id);
    if (!thing) return { ok: false, reason: `"${id}" does not exist` };
    if (thing.kind !== "device") return { ok: false, reason: `"${id}" is not a device, so it has no ports` };
    const ports = thing.item.ports;
    if (ports && !ports.some((p) => p.name === port)) {
      return { ok: false, reason: `device "${id}" has no port "${port}"` };
    }
    return { ok: true, endpoint: { thing, port } };
  }

  /** The ID of the thing an endpoint reference points at, without the port. */
  function thingId(ref: string): string {
    const colon = ref.indexOf(":");
    return colon === -1 ? ref : ref.slice(0, colon);
  }

  return { things, circuits, resolve, thingId };
}

export type HouseIndex = ReturnType<typeof indexHouse>;
