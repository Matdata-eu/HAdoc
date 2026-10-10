import type { HouseIndex, Thing } from "./index-house.js";
import type { Cable, Circuit, House, Signal } from "./model.js";

export interface ThingRef {
  kind: Thing["kind"] | "circuit" | "unknown";
  id: string;
  label: string;
  port?: string;
}

export interface CableEnd {
  cable: Cable;
  /** The end of the cable at the subject. */
  here: string;
  /** The other end, or null when it is not documented. */
  there: ThingRef | null;
}

export interface Trace {
  subject: ThingRef;
  location: ThingRef | null;
  /** Devices that sit at this point, e.g. a hidden ESP. */
  contains: ThingRef[];
  /** Power path upwards: the device or circuit that feeds the subject, and what feeds that. */
  poweredBy: ThingRef[];
  circuits: Circuit[];
  cables: CableEnd[];
  signals: Signal[];
}

function label(thing: Thing): string {
  switch (thing.kind) {
    case "point":
      return thing.item.name ?? thing.item.id;
    case "device":
      return [thing.item.label, thing.item.model].filter(Boolean).join(" · ") || thing.item.id;
    case "enclosure":
      return thing.item.name;
  }
}

function refFor(index: HouseIndex, ref: string): ThingRef {
  const circuit = index.circuits.get(ref);
  if (circuit) return { kind: "circuit", id: circuit.id, label: circuit.name ?? circuit.id };
  const r = index.resolve(ref);
  if (!r.ok) return { kind: "unknown", id: ref, label: ref };
  const { thing, port } = r.endpoint;
  return { kind: thing.kind, id: thing.item.id, label: label(thing), port };
}

/** Everything the app shows when someone taps a point, device or enclosure. */
export function traceThing(house: House, index: HouseIndex, id: string): Trace | null {
  const subject = index.things.get(id);
  if (!subject) return null;

  // The subject plus the devices that physically sit in it count as "here".
  const here = new Set<string>([id]);
  const contains: ThingRef[] = [];
  if (subject.kind === "point" && subject.item.device) here.add(subject.item.device);
  for (const d of house.devices) {
    if (d.location === id || here.has(d.id)) here.add(d.id);
  }
  for (const hereId of here) {
    if (hereId === id) continue;
    contains.push(refFor(index, hereId));
  }

  const location =
    subject.kind === "device" && subject.item.location ? refFor(index, subject.item.location) : null;

  // Follow powered_by upwards, guarding against loops in hand-written data.
  const poweredBy: ThingRef[] = [];
  const visited = new Set<string>();
  let next: string | null | undefined;
  for (const h of here) {
    const t = index.things.get(h);
    if (t?.kind === "device" && t.item.powered_by) {
      next = t.item.powered_by;
      break;
    }
  }
  while (next && !visited.has(next)) {
    visited.add(next);
    const ref = refFor(index, next);
    poweredBy.push(ref);
    const t = index.things.get(index.thingId(next));
    next = t?.kind === "device" ? t.item.powered_by : undefined;
  }

  const touches = (ref: string | null | undefined) => ref != null && here.has(index.thingId(ref));
  // A circuit counts when it feeds the subject directly or anything up its power path.
  const feedsHere = (c: Circuit) =>
    c.feeds.some(touches) ||
    poweredBy.some((p) => (p.kind === "circuit" ? p.id === c.id : c.feeds.includes(p.id)));

  const circuits = house.circuits.filter(feedsHere);

  const cables: CableEnd[] = [];
  for (const cable of house.cables) {
    if (touches(cable.from)) cables.push({ cable, here: cable.from!, there: cable.to ? refFor(index, cable.to) : null });
    else if (touches(cable.to)) cables.push({ cable, here: cable.to!, there: cable.from ? refFor(index, cable.from) : null });
  }

  const signals = house.signals.filter((s) => (s.point != null && here.has(s.point)) || touches(s.port));

  return {
    subject: { kind: subject.kind, id, label: label(subject) },
    location,
    contains,
    poweredBy,
    circuits,
    cables,
    signals,
  };
}
